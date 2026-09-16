//! What the host serves to a browser, and the rules for deciding it.
//!
//! Separated from `host.rs` because these are the decisions a mistake in which
//! would serve a file nobody meant to publish, and they need no socket to test.

/// One servable file. Deliberately owned rather than borrowed: the Tauri asset
/// resolver hands back owned bytes, and a lifetime here would infect the trait.
pub struct Asset {
    pub bytes: Vec<u8>,
    pub content_type: String,
}

/// Where the host gets the page it serves. Injected so `lan-sync` never learns
/// what a Tauri app is — the same reason `SessionSink` exists.
pub trait AssetSource: Send + Sync + 'static {
    fn get(&self, path: &str) -> Option<Asset>;
}

/// The path a request line asks for, or `None` if it is not a `GET` we will
/// answer. The returned path is always relative with no `..` segment, so a
/// caller cannot be talked into climbing out of wherever it resolves paths.
pub fn request_path(request_line: &str) -> Option<String> {
    let mut parts = request_line.split_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    let target = parts.next()?;
    // Strip the fragment first: a hash-routed URL carries the route after `#`,
    // and browsers do not send it, but a hand-written request might.
    let target = target.split('#').next()?;
    let target = target.split('?').next()?;

    // Reject before decoding, and reject every decoded form too. Deciding on
    // the decoded string alone is the classic traversal bug; deciding on the
    // raw one alone misses `%2e%2e`.
    //
    // Decoding to a fixpoint rather than once is what makes the answer safe to
    // hand to a consumer that decodes again — Tauri's asset resolver does
    // exactly that, so a single decode here would let `%252e%252e` through as
    // the literal `%2e%2e` and let the resolver turn it back into `..`.
    let mut decoded = target.to_string();
    if !is_safe(&decoded) {
        return None;
    }
    for _ in 0..DECODE_ROUNDS {
        let next = percent_decode(&decoded);
        if next == decoded {
            break;
        }
        if !is_safe(&next) {
            return None;
        }
        decoded = next;
    }
    // Still changing after the cap: pathological, and not worth reasoning about.
    if percent_decode(&decoded) != decoded {
        return None;
    }

    let trimmed = decoded.trim_start_matches('/');
    if trimmed.is_empty() {
        return Some("index.html".to_string());
    }
    Some(trimmed.to_string())
}

/// How many times a path may decode to something new before it is refused.
/// A real asset URL decodes once; anything needing more is an attempt.
const DECODE_ROUNDS: usize = 4;

/// The segments that let a path leave the root, in any encoding stage.
fn is_safe(candidate: &str) -> bool {
    !candidate.contains("..") && !candidate.contains('\\') && !candidate.contains('\0')
}

/// Minimal percent-decoding. Only needs to be good enough to spot an escape
/// attempt; a byte it cannot decode is left alone, which keeps the check
/// conservative rather than clever.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(byte) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn http_response(asset: &Asset) -> Vec<u8> {
    let mut out = format!(
        "HTTP/1.1 200 OK\r\n\
         Content-Type: {}\r\n\
         Content-Length: {}\r\n\
         Cache-Control: no-store\r\n\
         Connection: close\r\n\r\n",
        asset.content_type,
        asset.bytes.len()
    )
    .into_bytes();
    out.extend_from_slice(&asset.bytes);
    out
}

pub fn not_found() -> Vec<u8> {
    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_root_to_the_index() {
        assert_eq!(
            request_path("GET / HTTP/1.1").as_deref(),
            Some("index.html")
        );
    }

    #[test]
    fn keeps_a_normal_asset_path() {
        assert_eq!(
            request_path("GET /assets/main.js HTTP/1.1").as_deref(),
            Some("assets/main.js")
        );
    }

    #[test]
    fn strips_the_query_and_fragment() {
        assert_eq!(
            request_path("GET /assets/a.js?v=2 HTTP/1.1").as_deref(),
            Some("assets/a.js")
        );
        // The hash router means a real request can carry one.
        assert_eq!(
            request_path("GET /#/lobby HTTP/1.1").as_deref(),
            Some("index.html")
        );
    }

    #[test]
    fn refuses_a_path_that_climbs_out() {
        assert_eq!(request_path("GET /../etc/passwd HTTP/1.1"), None);
        assert_eq!(request_path("GET /assets/../../etc/passwd HTTP/1.1"), None);
    }

    #[test]
    fn refuses_a_percent_encoded_climb() {
        // %2e%2e is "..", and decoding before checking is the classic bug.
        assert_eq!(request_path("GET /%2e%2e/etc/passwd HTTP/1.1"), None);
        assert_eq!(request_path("GET /%2E%2E%2Fetc/passwd HTTP/1.1"), None);
    }

    #[test]
    fn refuses_a_double_encoded_climb() {
        // The consumer decodes again: Tauri's asset resolver percent-decodes
        // whatever it is handed, so a single decode here would hand it
        // `%2e%2e` and let it produce `..` itself.
        assert_eq!(request_path("GET /%252e%252e/etc/passwd HTTP/1.1"), None);
        assert_eq!(request_path("GET /%25252e%25252e/x HTTP/1.1"), None);
    }

    #[test]
    fn leaves_a_safe_path_fully_decoded() {
        // Decoding to a fixpoint means the consumer's own decode is a no-op,
        // which is the property that makes the double decode harmless.
        assert_eq!(
            request_path("GET /assets/a%20b.js HTTP/1.1").as_deref(),
            Some("assets/a b.js")
        );
    }

    #[test]
    fn refuses_a_backslash_climb() {
        assert_eq!(request_path("GET /..\\etc\\passwd HTTP/1.1"), None);
    }

    #[test]
    fn refuses_anything_that_is_not_a_get() {
        assert_eq!(request_path("POST / HTTP/1.1"), None);
        assert_eq!(request_path("garbage"), None);
    }

    #[test]
    fn writes_a_response_with_the_length_and_type() {
        let asset = Asset {
            bytes: b"hi".to_vec(),
            content_type: "text/html".into(),
        };
        let out = String::from_utf8_lossy(&http_response(&asset)).to_string();
        assert!(out.starts_with("HTTP/1.1 200 OK\r\n"), "got: {out}");
        assert!(out.contains("Content-Type: text/html\r\n"), "got: {out}");
        assert!(out.contains("Content-Length: 2\r\n"), "got: {out}");
        assert!(out.ends_with("\r\n\r\nhi"), "got: {out}");
    }

    #[test]
    fn not_found_is_a_404() {
        let out = String::from_utf8_lossy(&not_found()).to_string();
        assert!(out.starts_with("HTTP/1.1 404 "), "got: {out}");
        assert!(out.contains("Content-Length: 0\r\n"), "got: {out}");
    }
}
