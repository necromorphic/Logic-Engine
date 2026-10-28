# Remote accepted-head service protocol

Status: **implementation candidate; no production storage adapter or deployment**.

This protocol handler is in `src/security/remote-accepted-head-authority.js`. It is a service boundary for the remote monotonic anchor selected in the restore-resistance decision. It is not safe to deploy with a normal SQLite/file store.

## Configuration

The service is constructed with:
- an append-only storage adapter implementing the interface below;
- a mapping from provisioned installation IDs to high-entropy service credentials and explicit recovery permissions;
- an Ed25519 private signing key, kept outside the Core/Provider host and preferably held by an HSM/KMS signer;
- a fixed authority epoch ID, key ID, and contract version.

The handler does not generate or persist secrets, provision installation IDs, terminate TLS, install a service, or configure the OS. Deployment must expose it only behind authenticated HTTPS. Do not expose the raw HTTP listener to an untrusted network.

## Endpoints

### `GET /v1/installations/{installation_id}/head`

Requires `Authorization: Bearer <installation-token>`. Returns the latest signed envelope:
- `record`: exact fixed-shape record;
- `signature`: base64url Ed25519 signature over the canonical UTF-8 JSON bytes.

Returns 404 if no first record has been enrolled. No unauthenticated status endpoint exists.

### `POST /v1/installations/{installation_id}/records`

Requires the same bearer token and `Content-Type: application/json`.

The body has exactly:
- `expected_sequence`: current sequence the caller observed; 0 means no record yet;
- `expected_digest`: SHA-256 digest of the current canonical record, or null when sequence is 0;
- `core_head_digest`: SHA-256 digest of the accepted Core source-ledger/inventory head;
- `provider_readiness_digest`: SHA-256 digest of the accepted Provider compatibility/readiness state;
- `contract_version`: exact configured contract version;
- `record_type`: ADVANCE or RECOVERY;
- `recovery_reason`: required for RECOVERY, null for ADVANCE.

The server, not the caller, assigns installation ID, epoch/key ID, sequence, previous digest, and signature. RECOVERY requires a separately provisioned credential with `allowRecovery: true`. Re-enrollment/key-rotation epoch transitions are intentionally unsupported and rejected until a separately reviewed protocol is implemented.

Responses:
- 201: signed record durably appended and read back successfully;
- 400/413/415: malformed, oversized, or wrong-content-type request;
- 403: missing/invalid credential or insufficient recovery permission;
- 404: no head yet on GET;
- 409: expected head is stale or compare-and-append lost a race;
- 503: store/signature/read-back failure; caller must treat outcome as unknown and reconcile, never assume no append occurred.

## Mandatory storage adapter contract

The adapter provides:
- `getHead(installationId)`: returns the latest immutable envelope or null;
- `appendIfHead({ installationId, expectedSequence, expectedDigest, envelope })`: one atomic compare-and-append. It succeeds only if the durable current head still matches both expected values, then appends exactly one immutable record.

The operation must be linearizable across all service instances. A read followed by a separate write is not acceptable. Records must be immutable and ordered; an older record cannot be restored as the current head. The backing store must live outside the Core/Provider host backup domain and must have independently evidenced anti-rollback protection. A regular SQLite database on another server does not satisfy this requirement.

The service verifies the stored head's signature and schema before using it, and verifies read-back after append before returning success. A timeout after append can produce an ambiguous client outcome; clients must GET the head and reconcile. They must not retry by inventing a new expected head.

## Security and deployment gates

Before use:
1. select and implement a rollback-resistant store with atomic conditional append;
2. prove the store itself detects rollback or fails closed after its own backup restore;
3. keep the signing key and service credentials outside Core/Provider backups;
4. configure TLS and service authentication, secret rotation, monitoring, and audited recovery;
5. test concurrent appends, stale replay, duplicate-sequence mutation, wrong installation, key rotation, remote outage, partial failure, and store restore;
6. integrate Core mutations and Gateway dispatch-start into the accepted serialization order;
7. run A→B→restore-A against the real independent store and prove the old head cannot be accepted and outbound dispatch remains zero.

Until these pass, this handler is a protocol candidate only. Production remains NON_READY and Memory→NPC remains DISABLED / FAIL-CLOSED.
