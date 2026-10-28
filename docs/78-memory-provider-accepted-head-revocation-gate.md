# Memory Provider accepted-head and revocation gate

**Status:** implemented on the current-main draft branch and tested; production dispatch remains disabled.

## What the implementation protects

Core `SQLiteStore.tx()` and file-backed `SQLiteMemoryProvider` writes participate in a shared coordinator order. For an enrolled store, each changed transaction:

1. captures a SQLite changeset and before/after schema digests;
2. advances the independent accepted-head authority before local commit;
3. writes the returned head and operation identity in the same local transaction;
4. finalizes the authority operation after local commit.

If authority is unavailable, a head mismatches, a pending operation cannot be reconciled with the exact local checkpoint, or the schema is incomplete, the operation fails closed. Startup does not silently repair required schema. An enrolled Provider refuses to start when accepted-head enforcement is required but its authority configuration is missing.

Provider writes covered by the common transaction boundary include query/record grants and revocations, record persistence, index changes, readiness transitions, reconciliation state, exact-version tombstone, and purge. Raw Host/SillyTavern capture, raw disclosure, active-version selection, and derived-copy registration remain explicitly unapproved and disabled.

## Authority service

Run `scripts/security/run-accepted-head-authority.js` as a separate local service identity. It binds only to `127.0.0.1` and requires these environment variables:

- `LOGIC_ENGINE_ACCEPTED_HEAD_AUTHORITY_DB_PATH`: absolute, file-backed authority DB path;
- `LOGIC_ENGINE_ACCEPTED_HEAD_INSTALLATION_ID`: stable installation identifier;
- `LOGIC_ENGINE_ACCEPTED_HEAD_CORE_TOKEN`;
- `LOGIC_ENGINE_ACCEPTED_HEAD_PROVIDER_TOKEN`;
- `LOGIC_ENGINE_ACCEPTED_HEAD_READ_TOKEN`: separate read-only token for Gateway;
- `LOGIC_ENGINE_ACCEPTED_HEAD_PORT`: fixed local port, 1–65535.

Use three distinct strong tokens (at least 32 characters). Do not put tokens in source control or logs. The authority database must be writable only by the authority service identity; Core, Provider, and Gateway must not write it directly. The code does not install OS ACLs or a Windows service automatically.

Core and Provider also need the same absolute `LOGIC_ENGINE_COORDINATOR_DB_PATH`, and their respective service environments must set `LOGIC_ENGINE_ACCEPTED_HEAD_REQUIRED=1` plus the matching authority port and domain token:
- Core: `LOGIC_ENGINE_ACCEPTED_HEAD_CORE_TOKEN`
- Provider: `LOGIC_ENGINE_ACCEPTED_HEAD_PROVIDER_TOKEN`

Do not enroll a real database until its current state and source inventory have been independently reviewed. Enrollment scripts require an explicit approval ID and baseline digest; these values are evidence references, not automatic proof of inventory completeness. After an interrupted transaction or restore, run the explicit recovery procedure only after verifying that the local head, operation ID, and operation digest exactly match the authority's pending operation. Otherwise keep the store non-ready and restore from a trusted current snapshot.

## Executable evidence

- Focused accepted-head/Provider/Gateway gate: [23/23 tests passed](https://github.com/necromorphic/Logic-Engine/actions/runs/40700013471) (includes the runnable authority service entrypoint test).
- Native Windows Runtime and recalculation oracle: [1,022/1,022 Runtime tests and 20/20 oracle tests passed](https://github.com/necromorphic/Logic-Engine/actions/runs/40700013443).
- Tested code head: `9c4f6d279124b13441b0fcdd028c7d824c29a41f`. The subsequent change to this note is documentation-only; exact-head CI is rerun on the updated PR head.

## Boundary that remains blocked

These tests prove the Provider/Gateway primitive under controlled file-backed fixtures. They do not prove that the pinned SillyTavern build routes every protected request through this Gateway as its sole egress, nor that production ACLs, backup controls, Host inventory completeness, or final-send reauthorization are deployed. Keep Memory→NPC **DISABLED / FAIL-CLOSED** until the pinned Host sole-egress and deployment/restore acceptance gates pass.
