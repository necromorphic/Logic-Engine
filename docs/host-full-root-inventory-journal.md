# Host full-root inventory journal setup

This optional integration persists the digest-only manifest produced by the pinned SillyTavern 1.19.0 Host scanner into Core's append-only SQLite root-inventory journal.

It is **review-only**. A baseline or observed delta never sets Host inventory READY and never authorizes Memory disclosure.

## Enablement

1. Configure the same adapter ID and secret on the SillyTavern server and Core:
   - Core: `ENGINE_ADAPTER_TOKENS`
   - SillyTavern: `LOGIC_ENGINE_ADAPTER_ID` and `LOGIC_ENGINE_ADAPTER_TOKEN`
2. Configure the SillyTavern server-side identity directory:
   - `LOGIC_ENGINE_HOST_IDENTITY_DIR`
   - The signed-session `/api/logic-engine/host/identity` route returns the opaque installation/account IDs.
3. Compute the root digest from the exact absolute SillyTavern `directories.root` path:
   `sha256(UTF-8(path.resolve(directories.root)))`.
   The Host proxy uses Node's `path.resolve` and SHA-256. Do not hash a display path, relative path, or a different path spelling.
4. Add an exact deployment-owned record to Core's `ENGINE_HOST_ROOT_IDENTITIES` JSON array:

```json
[
  {
    "adapter_id": "sillytavern-main",
    "host_installation_id": "11111111-1111-4111-8111-111111111111",
    "authenticated_account_id": "22222222-2222-4222-8222-222222222222",
    "root_id": "64-lowercase-hex-characters"
  }
]
```

5. Set `ENGINE_HOST_LIFECYCLE_DB_PATH` to an absolute path separate from the Core database, Host Version Ledger database, and Coordinator database. The journal uses the shared Coordinator lease.
6. Restart Core and SillyTavern. If the registry is empty, the Core endpoint remains unavailable (503); no implicit enrollment is performed.

## Runtime behavior

The Host inventory handler scans the full configured per-user data root and sends only relative file paths, file identity metadata, sizes/timestamps and SHA-256 digests to Core. It never sends file bytes or chat text.

- First scan: `BASELINED_REVIEW_ONLY`.
- Later identical scan: `UNCHANGED_REVIEW_ONLY`.
- Any changed manifest: the file-level delta is appended and returns `NON_READY`.
- Replayed event IDs are idempotent; changed content under a reused event ID conflicts.
- A restored baseline does not erase an earlier observed delta.
- Request bounds are 8 MiB and 25,000 files.

The browser response contains only reconciliation status, sequence and digests/counts; it does not contain the root manifest or file paths.

## Remaining limitations

This does not prove a complete SillyTavern installation inventory. Global installation/extensions directories remain outside the per-user data root. It does not establish pre-enrollment/deleted history, semantic character/persona identity, application-level atomicity, complete mutation-route coverage, rollback-resistant accepted-head authority, or secure SQLite VFS open.

No operation-specific receipt acceptance is implemented. Therefore all unexplained file drift remains `NON_READY`. The Host bridge continues to report `complete: false`; Memory→NPC remains `DISABLED / FAIL-CLOSED`.
