# Host Adapter — Extension Gateway candidate

<badge>NON_READY</badge>

**Pinned Host:** SillyTavern 1.19.0, commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

## Active transport

The active ST transport is the self-contained server plugin in `server-plugin/`. Install the complete directory as:

`SillyTavern/plugins/logic-engine-extension-gateway/`

Enable `enableServerPlugins: true` in the SillyTavern server configuration. The pinned ST loader mounts the plugin after authenticated session middleware at:

`/api/plugins/logic-engine-extension-gateway`

The browser extension in `../sillytavern-extension/` sends Host requests only to this same-origin namespace. It does not call Core directly and does not receive Core or adapter credentials.

The plugin currently exposes:
- `GET /session` — server-generated Host session identity inside the signed ST cookie session.
- `GET /identity` — server-persisted installation/account identity from `HostIdentityStore`.
- `GET /inventory` — bounded Host data-root inventory; review-only and non-authoritative.
- `POST /context` — deliberately returns `NON_READY` until the signed assertion handoff to Core is implemented.

There is no active ST source patch dependency and no direct `/api/logic-engine/*` Core proxy route. The old patch files and old proxy modules are retained only as historical review artifacts; do not apply them or deploy their routes.

## Unified identity contract

The canonical durable conversation identity is:

`installationId:accountId:conversationUuid`

The signed `hostSessionId` is a separate, transient session dimension. It is not part of the durable conversation ID. This matches Core's Host session context contract.

- Installation and account IDs are resolved by the server-owned `HostIdentityStore`.
- Conversation UUID is resolved by a trusted server-side resolver over canonical Host state.
- The Host request gate brands only the exact authenticated request object in a private `WeakMap`.
- Default-user mode may omit `request.session.handle`; the authenticated `request.user.profile.handle` remains authoritative. If `session.handle` is present, it must match.
- Body, query and header values cannot choose installation, account, conversation, World or Actor identity.

The identity gate is a process-local capability, not a cross-process assertion protocol. The actual signed Host assertion transport and Core context verification remain incomplete.

## Validation

The active Host CI stages the plugin into a disposable pinned SillyTavern checkout and runs source/identity/Gateway tests. It no longer applies SillyTavern source patches. Browser extension tests assert that the only Host transport URL is the same-origin Gateway session route.

## Explicit blockers

- `POST /context` is closed; signed cross-process assertion handoff to Core is not wired.
- Core-side verification of the authenticated conversation → World → Actor binding is not connected to this ST plugin.
- No real Core Memory consumer call is made from Host.
- Full lifecycle receipts for chat deletion, rename, group cascade, import, export and restore remain incomplete.
- Root inventory remains review-only; Core inventory reconciliation remains deny-only.
- No final-send or Memory → NPC dispatch is enabled.

Do not mark this candidate READY or merge it as production integration.

## Supporting specifications

- [Host Lifecycle Journal v1](./HOST-LIFECYCLE-JOURNAL-V1.md)
- [Pinned ST operation inventory](./PINNED-ST-OPERATION-INVENTORY-2026-10-30.md)
- [Pinned ST mutation inventory](./PINNED-ST-MUTATION-INVENTORY-2026-10-30.md)
- [Pinned ST source route audit](./SILLYTAVERN-1.19.0-SOURCE-ROUTE-AUDIT.md)
