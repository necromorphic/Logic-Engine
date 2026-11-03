# ST-VectorService boundary audit

**Source reviewed:** user-supplied `ST-VectorService.zip`, package `st-vectorservice@1.0.0`.  
**Disposition:** separate sidecar storage and trust boundary; no vectorization code changed.

## Storage boundary

The service stores its data under:

- `ST_VECTOR_ROOT` when configured, otherwise `process.cwd()`;
- `vector_storage/vectors.sqlite`;
- Vectra index directories below `vector_storage/`.

This location is not derived from SillyTavern's authenticated `request.user.directories.root`. It is therefore outside the Host per-user root manifest and outside the Core `AUTHORITATIVE_COMPLETE` proof scope.

## Routes and mutations

- `GET /health`: unauthenticated database health check.
- `POST /api/embed` and `POST /api/embeddings`: bearer-protected Ollama embedding proxy.
- `POST /v1/list`, `/v1/query`, `/v1/query-multi`, `/v1/stats`: bearer-protected reads.
- `POST /v1/insert`: writes vector rows and index data.
- `POST /v1/delete`: deletes vector rows.
- `POST /api/vector/hashes`: bearer-protected hash listing.

The `/v1` namespace is protected by `app.use('/v1', requireBearer)`; the hash alias applies the same middleware explicitly. Startup migration also imports existing Vectra indexes into SQLite and mutates the sidecar's own storage.

## Identity and security findings

- The service authenticates one shared bearer key only. It does not bind requests to a SillyTavern installation, authenticated account, ST session, conversation UUID, or Core authority generation.
- Insert/delete operations do not produce Host lifecycle receipts or a manifest that Core verifies.
- The server defaults to `0.0.0.0:8787`; network exposure therefore depends on deployment firewalling and the bearer secret.
- Authentication diagnostics log token length and a stable SHA-256 fingerprint. The raw token is not logged, but the fingerprint is unnecessary credential metadata and should be removed in a separate sidecar hardening change.

## Integration consequence

The Host proof in this PR is explicitly scoped to one authenticated SillyTavern per-user data root containing regular files. It does **not** attest to the external VectorService database or Vectra indexes. SillyTavern's own `/api/vectors` mutation routes remain guarded by the pinned Host patch, but direct calls to the sidecar's `/v1/insert` or `/v1/delete` bypass those ST routes.

Do not expand the Host proof to cover this sidecar by trusting its current bearer-only API. A separate sidecar contract is required: stable installation/account/collection binding, authenticated request identity, append-only mutation receipts, complete SQLite/index inventory, restart reconciliation, and fail-closed behavior for direct writes. This audit does not change the existing vectorization patch.
