# Protected Memory acceptance preflight

This is a **read-only diagnostic**, not an activation or enrollment tool.

Run it from the same PowerShell process/environment that will launch Core, after setting the deployment paths and authority read-only credential:

```powershell
node scripts/acceptance/protected-memory-preflight.mjs
```

The acceptance launcher now provisions a separate `memory-provider.sqlite` in the disposable Core data directory and configures the narrow `attributes.public_note` field allowlist. On an already-running environment, this takes effect only after a controlled restart using `-ResumeExisting`; it does not alter the current process. The Memory → NPC runtime flag remains false. The wrapper reports only presence/state, never secret values. Exit codes:

- `0`: no blocker detected by this limited preflight; this is **not** an acceptance pass.
- `1`: one or more prerequisites are absent or not enrolled.
- `2`: a configured database or authority check failed.

It inspects the configured Core, Provider, Coordinator, Accepted Head Authority, Host nonce, Host lifecycle and Host version-ledger files. It checks SQLite integrity, required accepted-head tables/state, database-file separation, authority enrollment/pending operations, and the explicit NPC content-field allowlist.

Environment inputs:

- `ENGINE_DB_PATH`
- `ENGINE_MEMORY_PROVIDER_DB_PATH`
- `LOGIC_ENGINE_COORDINATOR_DB_PATH`
- `LOGIC_ENGINE_ACCEPTED_HEAD_AUTHORITY_DB_PATH` (or `LOGIC_ENGINE_ACCEPTED_HEAD_DB_PATH`)
- `ENGINE_HOST_ASSERTION_NONCE_DB_PATH`
- `ENGINE_HOST_LIFECYCLE_DB_PATH`
- `ENGINE_HOST_VERSION_LEDGER_DB_PATH`
- `LOGIC_ENGINE_ACCEPTED_HEAD_PORT`
- `LOGIC_ENGINE_ACCEPTED_HEAD_READ_TOKEN`
- `ENGINE_MEMORY_NPC_CONTENT_FIELDS`

The accepted-head authority must already be running on loopback. The read credential is used only to inspect authority status. No Core/Provider write credential is needed.

## Deliberate limitations

The preflight does **not**:
- create or enroll an Accepted Head Authority;
- manufacture an approval ID or baseline digest;
- seed Provider records or grants;
- change Core World/Actor bindings;
- promote Host inventory from review-only to authoritative-complete;
- alter the existing SillyTavern profile or any database;
- set `LOGIC_ENGINE_MEMORY_NPC_ENABLED` or `ENGINE_MEMORY_NPC_ENABLED`.

A clean preflight still does not prove the pinned SillyTavern native routes, shared Coordinator evidence readers, NPC one-time handoff, or Final-Send revalidation. Those remain separate live acceptance gates. Keep Memory → NPC disabled until those gates pass.

Accepted-head enrollment is an explicit security-sensitive operation. Use `enrollAcceptedHeadDomain()` only after independently reviewing the exact baseline and recording its approval/digest; never automate enrollment at startup.
