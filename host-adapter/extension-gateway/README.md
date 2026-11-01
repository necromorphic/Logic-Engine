# SillyTavern Extension Gateway

**Status: review-only candidate. Protected Memory → NPC dispatch remains NON_READY / FAIL-CLOSED until the Core endpoint and durable assertion replay protection pass exact-head integration tests.**

## Single integration boundary

The browser extension uses SillyTavern's native `generate_interceptor` to stop native generation for an explicitly armed protected request. It then sends only a bounded request envelope to the single authenticated server-plugin namespace:

`/api/plugins/logic-engine-extension-gateway/*`

The server plugin is loaded by SillyTavern after `requireLoginMiddleware`. It owns the only public Host ingress and performs bounded envelope routing only. It delegates to an internal Authenticated Host Adapter; that component verifies the ST session, resolves installation/account/session/conversation from server-controlled identity and inventory, and calls Core using server-held credentials plus a short-lived signed Host assertion. The Gateway does not authenticate sessions, assign World/Actor, authorize, access Memory/NPC/Mechanics, handle AI sending, or implement the Final-Send Hook. Adapter helpers do not register separate Express routes.

No `/api/logic-engine/*` route is mounted. The pinned lifecycle patch adds only internal middleware hooks to existing SillyTavern mutation routes and a private helper import; it does not create another Host API route or contact Core directly.

## Pinned lifecycle integration

The exact pinned SillyTavern build requires the reviewed patch at
`host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch`.
Apply it only to commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`:

```sh
git -C /path/to/SillyTavern apply --unidiff-zero --check /path/to/Logic-Engine/host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch
git -C /path/to/SillyTavern apply --unidiff-zero /path/to/Logic-Engine/host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch
git -C /path/to/SillyTavern diff --check
```

The patch is restricted to the reviewed client mutation entry points, existing
chat/group/character/backup/Data Maid/settings/account-reset endpoint middleware, the bounded Gateway JSON body
limit, and a private helper re-export. Its allowlist is enforced in CI. The
helper imports the installed plugin's server-owned guard functions; it mounts
no Express route. All browser-facing Host calls remain under
`/api/plugins/logic-engine-extension-gateway/*`. Internal ST endpoint middleware
cannot call Core and cannot bypass the Gateway's server-side receipt endpoints.

## Installation layout

Install the browser extension directory under:

`public/scripts/extensions/third-party/logic-engine-extension-gateway/`

Copy every `.mjs` and `.js` file plus `package.json` from `server-plugin/` under:

`plugins/logic-engine-extension-gateway/`

Enable SillyTavern's native `enableServerPlugins: true` setting. Keep server-plugin auto-update disabled unless the plugin source is pinned and reviewed. The plugin routes remain behind ST's login middleware and CSRF protection.

## Identity contract

- Installation and account IDs are generated and persisted by the server-side `HostIdentityStore`.
- The Host session UUID is generated in SillyTavern's signed session and rotates when the authenticated account changes. Core validates this session separately from the stable conversation tuple.
- Stable conversation identity is `installation_id:account_id:conversation_uuid`; session identity is carried separately in the signed assertion.
- The browser's localStorage and chat metadata are consistency/enrollment inputs, not authentication authorities.
- `LOGIC_ENGINE_HOST_IDENTITY_DIR` must be an absolute deployment-owned directory outside SillyTavern's global `DATA_ROOT`, not merely outside the current account's `request.user.directories.root`. The server checks the resolved path on both identity reads and Host-to-Core context resolution; a path inside global `DATA_ROOT`, including one reached through a symlinked parent, is NON_READY.
- `LOGIC_ENGINE_HOST_RECEIPT_DIR` must also be outside global `DATA_ROOT`. Neither identity nor receipt state may be restored together with ST user data.
- These directory checks prevent accidental co-restoration with ST data; they do not make local state independently rollback-resistant. Core's accepted root-inventory authority remains required.
- `LOGIC_ENGINE_HOST_BUILD_SHA` is a deployment claim matched to the pinned commit, not runtime attestation.
- The Authenticated Host Adapter resolves the conversation UUID against server-side inventory before signing any assertion.
- The Gateway does not assign World or Actor. World and Actor are never accepted from the browser; the Host Adapter obtains them from Core-owned durable binding resolution and signs them into the trusted Host assertion.
- Core Security Gateway independently re-resolves those bindings and remains the sole authorization authority.

## Dispatch boundary

The browser sends only `request_id`, `conversation_uuid`, `context_size`, and `generation_type`. It does not send chat text, world ID, actor ID, Core URL, or credentials.

The server Gateway signs the exact installation/account/session/conversation tuple with the configured adapter secret and sends it to Core at `/v1/host/memory-npc/retrieve`. If Core's matching authenticated endpoint is unavailable, the Gateway returns NON_READY and never falls through to native SillyTavern generation.

Before a request can acquire a Host context, the Adapter sends the complete VSS-aligned user-root manifest to Core's root-inventory journal. It requires Core to return `AUTHORITATIVE_COMPLETE`, `INTEGRITY_OK`, a monotonic sequence and a manifest digest. A local scan, first baseline, unchanged review-only result, or missing Core journal is insufficient. Current Core behavior is review-only, so production dispatch remains NON_READY even when a test fixture supplies an authoritative source inventory.

The endpoint is deliberately fail-closed until Core-side root-inventory authority, assertion verification, durable replay prevention, Provider retrieval and final response revalidation are integrated and tested on the same HEAD.

## Pinned-source evidence

Target SillyTavern commit: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

The integration uses the native server-plugin loader and extension generation interceptor. CI verifies that the plugin mounts after `requireLoginMiddleware`, that `generate_interceptor` is invoked before provider dispatch, that the exact pinned lifecycle patch applies, and that its source changes stay within the reviewed allowlist. The patch does not add another public Host route.
