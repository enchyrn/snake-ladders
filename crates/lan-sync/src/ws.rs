//! Just enough of RFC 6455 for a browser to join a natively hosted room.
//!
//! Deliberately partial: this speaks text, close, ping and pong, and refuses
//! everything else rather than guessing. See ADR 0019 for why the framing is
//! hand-written and what it consciously does not support.

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use sha1::{Digest, Sha1};
use std::io::{BufRead, Error, ErrorKind, Write};

/// The magic string every RFC 6455 handshake appends before hashing.
const GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/// The largest frame we will accept. The biggest real one is a welcome
/// carrying the whole action log; a peer that claims more than this is either
/// broken or trying to make us allocate on its say-so.
const MAX_PAYLOAD: u64 = 1024 * 1024;

/// The `Sec-WebSocket-Accept` value proving we read the client's key.
pub fn accept_key(client_key: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(client_key.as_bytes());
    hasher.update(GUID.as_bytes());
    STANDARD.encode(hasher.finalize())
}

/// Find a header's value, case-insensitively: browsers do not agree on casing
/// and the RFC does not require any.
fn header<'a>(request: &'a str, name: &str) -> Option<&'a str> {
    request.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        if key.trim().eq_ignore_ascii_case(name) {
            Some(value.trim())
        } else {
            None
        }
    })
}

/// The full HTTP 101 response, or `None` when this is not a version 13
/// WebSocket upgrade and the caller should treat the socket as something else.
pub fn handshake_response(request: &str) -> Option<String> {
    if !header(request, "Upgrade")?.eq_ignore_ascii_case("websocket") {
        return None;
    }
    // `Connection` is a comma-separated list, and Firefox sends
    // "keep-alive, Upgrade" rather than "Upgrade" alone.
    if !header(request, "Connection")?
        .split(',')
        .any(|part| part.trim().eq_ignore_ascii_case("upgrade"))
    {
        return None;
    }
    if header(request, "Sec-WebSocket-Version")? != "13" {
        return None;
    }
    let key = header(request, "Sec-WebSocket-Key")?;
    Some(format!(
        "HTTP/1.1 101 Switching Protocols\r\n\
         Upgrade: websocket\r\n\
         Connection: Upgrade\r\n\
         Sec-WebSocket-Accept: {}\r\n\r\n",
        accept_key(key)
    ))
}

fn invalid(message: &str) -> Error {
    Error::new(ErrorKind::InvalidData, message)
}

/// Read one text message. `Ok(None)` means the peer closed, cleanly or by
/// simply going away — both are end of stream, not failures.
pub fn read_text(reader: &mut impl BufRead) -> std::io::Result<Option<String>> {
    loop {
        let mut head = [0u8; 2];
        match reader.read_exact(&mut head) {
            Ok(()) => {}
            Err(e) if e.kind() == ErrorKind::UnexpectedEof => return Ok(None),
            Err(e) => return Err(e),
        }

        let fin = head[0] & 0x80 != 0;
        let opcode = head[0] & 0x0f;
        let masked = head[1] & 0x80 != 0;

        let length = match head[1] & 0x7f {
            126 => {
                let mut ext = [0u8; 2];
                reader.read_exact(&mut ext)?;
                u16::from_be_bytes(ext) as u64
            }
            127 => {
                let mut ext = [0u8; 8];
                reader.read_exact(&mut ext)?;
                u64::from_be_bytes(ext)
            }
            short => short as u64,
        };

        // Checked against the header, before anything is allocated.
        if length > MAX_PAYLOAD {
            return Err(invalid("websocket frame exceeds the payload cap"));
        }

        let mask = if masked {
            let mut key = [0u8; 4];
            reader.read_exact(&mut key)?;
            Some(key)
        } else {
            None
        };

        let mut payload = vec![0u8; length as usize];
        reader.read_exact(&mut payload)?;
        if let Some(key) = mask {
            for (i, byte) in payload.iter_mut().enumerate() {
                *byte ^= key[i % 4];
            }
        }

        match opcode {
            0x8 => return Ok(None),
            // Ping and pong are dropped: the protocol has its own ping frame in
            // the JSON layer, so a transport-level keepalive needs no answer to
            // stay correct.
            0x9 | 0xA => continue,
            0x1 if fin => {
                return String::from_utf8(payload)
                    .map(Some)
                    .map_err(|_| invalid("websocket text frame is not utf-8"))
            }
            // Fragmentation is refused rather than mis-decoded. No frame this
            // protocol sends comes near a fragment boundary, so reassembly
            // would be untested code on a path no test can reach.
            0x0 | 0x1 => return Err(invalid("fragmented websocket messages are not supported")),
            _ => return Err(invalid("unsupported websocket opcode")),
        }
    }
}

/// Write one unmasked text frame. A server never masks.
pub fn write_text(w: &mut impl Write, text: &str) -> std::io::Result<()> {
    let payload = text.as_bytes();
    let mut frame = Vec::with_capacity(payload.len() + 10);
    frame.push(0x81);
    match payload.len() {
        n if n < 126 => frame.push(n as u8),
        n if n <= u16::MAX as usize => {
            frame.push(126);
            frame.extend_from_slice(&(n as u16).to_be_bytes());
        }
        n => {
            frame.push(127);
            frame.extend_from_slice(&(n as u64).to_be_bytes());
        }
    }
    frame.extend_from_slice(payload);
    w.write_all(&frame)
}

#[cfg(test)]
mod tests {
    use super::*;

    // The key and its accept value are the worked example in RFC 6455 §1.3.
    #[test]
    fn computes_the_rfc_example_accept_key() {
        assert_eq!(
            accept_key("dGhlIHNhbXBsZSBub25jZQ=="),
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        );
    }

    #[test]
    fn refuses_a_request_that_is_not_an_upgrade() {
        assert!(handshake_response("GET / HTTP/1.1\r\nHost: x\r\n\r\n").is_none());
    }

    #[test]
    fn answers_a_real_upgrade_request() {
        let request = "GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n";
        let response = handshake_response(request).expect("upgrade");
        assert!(response.starts_with("HTTP/1.1 101 "));
        assert!(response.contains("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo="));
    }

    #[test]
    fn header_names_are_case_insensitive() {
        let request = "GET / HTTP/1.1\r\nupgrade: WebSocket\r\nCONNECTION: keep-alive, Upgrade\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n";
        assert!(handshake_response(request).is_some());
    }

    #[test]
    fn round_trips_a_masked_client_frame() {
        // Every client frame is masked; a server's never is.
        let mask = [0x37u8, 0xfa, 0x21, 0x3d];
        let mut framed = vec![0x81, 0x85];
        framed.extend_from_slice(&mask);
        for (i, byte) in b"Hello".iter().enumerate() {
            framed.push(byte ^ mask[i % 4]);
        }
        let mut reader = std::io::BufReader::new(&framed[..]);
        assert_eq!(read_text(&mut reader).unwrap(), Some("Hello".to_string()));
    }

    #[test]
    fn writes_an_unmasked_server_frame() {
        let mut out = Vec::new();
        write_text(&mut out, "Hi").unwrap();
        assert_eq!(out, vec![0x81, 0x02, b'H', b'i']);
    }

    #[test]
    fn writes_the_two_byte_length_form_past_125() {
        let mut out = Vec::new();
        let payload = "x".repeat(200);
        write_text(&mut out, &payload).unwrap();
        assert_eq!(&out[..4], &[0x81, 126, 0, 200]);
    }

    #[test]
    fn reads_the_two_byte_length_form() {
        let payload = "y".repeat(300);
        let mut framed = vec![0x81, 254, 1, 44];
        framed.extend_from_slice(&[0, 0, 0, 0]);
        framed.extend_from_slice(payload.as_bytes());
        let mut reader = std::io::BufReader::new(&framed[..]);
        assert_eq!(read_text(&mut reader).unwrap(), Some(payload));
    }

    #[test]
    fn reports_a_close_frame_as_end_of_stream() {
        let framed = [0x88u8, 0x80, 0x00, 0x00, 0x00, 0x00];
        let mut reader = std::io::BufReader::new(&framed[..]);
        assert_eq!(read_text(&mut reader).unwrap(), None);
    }

    #[test]
    fn skips_a_ping_and_returns_the_text_after_it() {
        let mask = [0u8; 4];
        let mut framed = vec![0x89, 0x80];
        framed.extend_from_slice(&mask);
        framed.extend_from_slice(&[0x81, 0x82]);
        framed.extend_from_slice(&mask);
        framed.extend_from_slice(b"ok");
        let mut reader = std::io::BufReader::new(&framed[..]);
        assert_eq!(read_text(&mut reader).unwrap(), Some("ok".to_string()));
    }

    #[test]
    fn refuses_a_payload_larger_than_the_cap() {
        // A 64-bit length of 2 MiB, claimed but never sent: the guard has to
        // fire on the header, not after allocating what the peer asked for.
        let framed = [0x81u8, 255, 0, 0, 0, 0, 0, 0x20, 0, 0];
        let mut reader = std::io::BufReader::new(&framed[..]);
        assert!(read_text(&mut reader).is_err());
    }

    #[test]
    fn refuses_a_fragmented_message() {
        let framed = [0x01u8, 0x80, 0, 0, 0, 0];
        let mut reader = std::io::BufReader::new(&framed[..]);
        assert!(read_text(&mut reader).is_err());
    }

    #[test]
    fn a_clean_disconnect_is_end_of_stream_not_an_error() {
        let mut reader = std::io::BufReader::new(&[][..]);
        assert_eq!(read_text(&mut reader).unwrap(), None);
    }
}
