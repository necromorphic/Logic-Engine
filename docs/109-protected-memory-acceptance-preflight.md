# Protected Memory acceptance preflight

This is a **read-only diagnostic**, not an activation or enrollment tool.

Run it from the same PowerShell process/environment that will launch Core, after setting the deployment paths and authority read-only credential:

```powershell
node scripts/acceptance/protected-memory-preflight.mjs
```

The Windows acceptance launcher now provisions a separate `memory-provider.sqlite` after Core has created the shared Coordinator. The schema-only bootstrap uses the real Provider constructor with fail-closed callbacks; it creates no Memory records, grants, index entries, or content. If the DB already exists, it verifies it read-only and preserves its data. The launcher configures the narrow `attributes.public_note` field allowlist. On an already-running environment, these changes take effect only after a controlled restart using `-ResumeExisting`; they do not alter the current process. The Memory → NPC runtime flag remains false. The wrapper reports only presence/state, never secret values. Exit codes:

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

The Windows acceptance launcher now starts the authority as a separate loopback process and records its port plus read-only credential in the ACL-restricted acceptance secrets file. The authority database is created independently from Core and Provider. In this disposable acceptance setup, the process runs under the same Windows user as the launcher; this is **not** evidence of production service-identity or ACL isolation. The read credential is used only to inspect authority status. No Core/Provider write credential is passed to the preflight.

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
