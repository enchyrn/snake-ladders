# Vendored skills

The skill directories here come from [Superpowers](https://github.com/obra/superpowers)
by Jesse Vincent, MIT licensed. The licence is kept alongside them as
`LICENSE.superpowers`.

- Upstream version: 6.3.0
- Vendored at commit: b36e082

They are vendored rather than installed as a plugin because
`/plugin marketplace add` is a local-only command and is not available in a
remote Claude Code session. Vendoring puts them in project scope instead, so
they work for anyone who clones this repository, in any session, with no
per-machine setup.

To refresh them, re-copy `skills/` from the upstream repository at the version
you want and update the commit above. Nothing here is patched, so a refresh is
a straight overwrite.

Run `/reload-skills` after a change to pick it up in a running session.
