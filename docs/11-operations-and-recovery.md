# 11. Operations, backup and recovery

Status: proposed operational contract for a future local runtime.

## 1. Runtime boundary

Initial target: engine service on the user's PC; SillyTavern remains on Android/Termux and connects over a private trusted network. This is a target, not yet verified on the actual device setup.

- Bind the API to loopback by default during local development.
- Remote access must require explicit configuration and authentication; never expose an unauthenticated engine API to the public internet.
- Store provider credentials only in the selected secret store/environment configuration, never in world state, logs, chat, or Git.
- Redact secrets and sensitive narrative content from diagnostic logs by default.
- Use bounded request sizes, timeouts, concurrency and model retries.

## 2. Backup and restore

Create backup:
- before schema migration;
- before World Pack migration;
- before bulk author edits;
- before rollback engine upgrades;
- at configured startup/scheduled intervals where safe.

A backup is only accepted as useful after a restore test confirms the world can be loaded and its canonical state/revision verified. Keep backups outside the Git repository.

## 3. Startup recovery

At startup:
1. validate storage schema and migration level;
2. verify pinned World Pack versions are available;
3. recover incomplete delivery jobs without recommitting world effects;
4. reconcile durable scheduler jobs with canonical process records;
5. rebuild derived projections and retrieval indexes as needed;
6. identify incomplete rollback plans and resume idempotently or mark needs_review;
7. report unresolved corruption or missing packs instead of silently inventing replacements.

## 4. Observability

Every diagnostic event should include correlation IDs (world, turn, generation, event, revision and rollback where applicable) without dumping full secrets or unrestricted NPC memories. Logs should distinguish proposal, validation, commit, projection, and delivery errors.

## 5. Data safety

Never commit:
- world databases or snapshots;
- chat archives and embeddings;
- API keys, cookies, tokens or .env files;
- private character/persona data;
- runtime logs containing private content.

Use repository ignore rules before the first runtime database is created.


## 6. Remote deployment security boundary

The built-in HTTP listener is not a TLS endpoint and does not provide request rate limiting. The default loopback binding is intentional and must not be weakened.

When remote access is explicitly enabled with `ENGINE_ALLOW_REMOTE=true`:

- Place the service behind a TLS-terminating reverse proxy or another explicitly approved encrypted transport boundary. Do not send bearer, admin, internal, approval, or adapter credentials over an unencrypted network.
- Enforce request-rate and connection limits at that boundary. The built-in server currently has no rate limiter; remote exposure without upstream limits is unsupported.
- Restrict network reachability to the intended trusted clients; do not expose the listener directly to the public internet.
- Keep all credential classes distinct and out of model-visible context and logs. The service does not treat a general bearer token as proof of adapter, admin, or internal identity.
- Treat `/health` as a non-secret liveness response. Do not add configuration, identity, database, or credential details to it.
- Review proxy forwarding headers and access logs so they do not capture authorization headers or secret-bearing custom headers.

The runtime compares request credentials using fixed-length SHA-256 digests and Node's `timingSafeEqual`; this reduces content-dependent comparison timing but does not replace TLS, rate limiting, access controls, or secret rotation. Timing behavior is not a complete security guarantee.


## 7. API capability policy — Core 1.x

The general `ENGINE_API_TOKEN` authenticates a caller to the HTTP API; it does not grant administrative, internal, approval, or adapter identity. Privileged routes require their separate credential in addition to the bearer token.

| Capability | Required credential beyond the general bearer | Contract |
| --- | --- | --- |
| Create a world | `x-admin-token` | Administrative setup; adapter credentials alone are insufficient. |
| Read immutable mechanic-template and rule-module definitions | `x-admin-token` | Global registry inventory is administrative under the adopted least-privilege policy. |
| Read registry audit history | `x-admin-token` | Operational history is restricted to administrators. |
| Register immutable mechanic-template or rule-module definitions | `x-admin-token` | Registry writes are administrative; existing immutable versions cannot be overwritten with different content. |
| Create/cancel/read an adapter proposal | Configured `x-adapter-id` + `x-adapter-token` | Proposal ownership is enforced per adapter. |
| Approve a proposal | `x-approval-token` | Shared-secret approval gate; not a named human identity or a complete multi-user authorization system. |
| Register context manifests or use the restricted internal commit/read path | `x-engine-internal-token` | Trusted host-only operation; commits still require an approved proposal. |
| Read raw canonical world state/events/audit | `x-admin-token` or `x-engine-internal-token` | General bearer and adapter identity alone do not authorize raw canonical reads. |
| Roll back a world, manage actor bindings, relationship transitions, or mechanic instances | `x-admin-token` | Explicit administrative mutation. |

The service fails closed for privileged routes if the corresponding credential is not configured. Keep credentials distinct, scoped to the smallest set of processes, and outside model-visible context. This matrix describes API capabilities, not human identity or a multi-user role system. Do not infer that registry definitions are public merely because they are immutable; authenticated global registry reads are admin-only under policy A.
