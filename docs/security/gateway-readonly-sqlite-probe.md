# Gateway read-only SQLite WAL/SHM probe

**Status: disposable CI experiment; not deployment evidence and not an ACL deployment script.**

This probe tests the exact unresolved deployment assumption in the selected dispatch-authority design: can a separate Gateway Windows identity perform a SQLite `mode=ro` read from both Core and Provider stores while a writer keeps WAL and SHM files live, with the Gateway denied database writes and directory create/rename/delete rights?

## What the Windows job does

- Creates a disposable local Gateway account and separate Core/Provider fixture directories.
- Grants that account read/execute only on each store directory and inherited files; it does not grant Modify.
- Keeps a writer connection open with journal mode WAL and verifies that `state.sqlite-wal` and `state.sqlite-shm` exist.
- Runs a separate Python process under the Gateway account. It must read via SQLite URI `mode=ro`, fail a SQL INSERT, and fail filesystem create/rename/delete probes.
- Uses only temporary runner fixtures. It does not touch a developer's PC or project databases.

## Decision rule

- **PASS** means this narrow Windows fixture can read the tested live WAL/SHM state under the read-only ACL. It does not prove all SQLite timing/race cases, complete effective ACLs, service-token provisioning, parent-path safety, backup/restore isolation, accepted-head anti-rollback, or the sole-egress contract.
- **FAIL** on SQLite open/read, WAL/SHM access, or ACL probes means do not grant Gateway Modify rights as a workaround. Record the exact failing operation and return the topology to Core/Security for a reviewed alternative.
- No runtime/API/schema/store is added and no production path is enabled by this probe.
