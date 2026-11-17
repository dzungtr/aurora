# Artifacts are immutable snapshots on local disk, never live references

Every artifact push — including media — copies its bytes into aurora's own store (`~/.local/share/aurora/artifacts/`) at receipt time. A pushed `path`, `base64`, or remote `url` is fetched and snapshotted server-side; the original source may disappear without breaking the artifact. The trade-off is disk duplication vs. dangling references and TOCTOU drift; we chose duplication because localhost disk is cheap and agent temp files are short-lived. Ordinary sessions have no TTL — deletion is an explicit human action. The single exception is a session the agent explicitly declared a channel, which prunes its own artifacts by retention on push (ADR-0009). Sessions and artifacts survive server restarts by construction (plain files + meta JSON, atomic writes).

## Amendments

_Pointers only — current decision above. Fallback `git log -p` on this file._

| Date | PR | Change |
|---|---|---|
| 2026-11-17 | docs PR for #86 | No-TTL rule scoped to ordinary sessions; channel sessions prune by retention (ADR-0009). |
