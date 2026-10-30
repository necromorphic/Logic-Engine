# Host/Adapter ↔ Core contract and PC acceptance gate

**Snapshot:** 2026-10-29  
**Disposition:** Host capture prototype = `NON_READY`; Stage 2 = `NO-GO`; production Memory → NPC = `DISABLED / FAIL-CLOSED`.

This document separates the contract that exists in Core `main`, the review-only SillyTavern patch, and the evidence still required on the target PC.

## 1. Current Core contract

The Core API exposes:

| Route | Purpose | Required authority | What success proves |
|---|---|---|---|
| `POST /v1/host-conversation-bindings` | Bind configured adapter + stable conversation ID to a canonical world | `x-admin-token`; adapter ID must already be configured | Binding was accepted; not that the Host inventory is complete |
| `POST /v1/host-conversation-bindings/resolve` | Resolve the authenticated adapter's conversation binding | Authenticated adapter | A binding exists for that scope |
| `DELETE /v1/host-conversation-bindings/:adapter_id/:conversation_id` | Revoke a conversation binding | Separate `x-admin-token`; body accepts only a string `reason` | The binding is revoked; subsequent resolve/capture must fail closed |
| `POST /v1/host-version-ledger/capture` | Capture a digest-only message-version record | Authenticated adapter + existing binding | That one submitted record was accepted; not that all versions/events were captured |

Capture requires `conversation_id`, `message_id`, `version_id`, explicit `parent_version_id` (string or null), lowercase 64-character SHA-256 `content_sha256`, and boolean `active` and `deleted`. It rejects raw text and caller-provided `world_id`. The Host ledger is stored separately from Core's world database and the shared coordinator.

## 2. Host contract and its limit

The SillyTavern candidate targets exact source SHA `06bde939fb1e9c4c8d8641d810f0a916b5bce127`. Its browser lifecycle journal records IDs, ancestry and digests rather than raw text; a server-side proxy holds Core credentials. The candidate intercepts selected UI and server routes and fails closed for some unsupported destructive/import operations.

That is **not** a complete lifecycle inventory. Known gaps include external filesystem changes, every extension/plugin route, branch/copy lineage, restore/migration paths, pre-enrollment history, and independently trusted rollback detection. A source event such as `MESSAGE_RECEIVED` is not proof of durable save or delivery to an NPC.

## 3. The explicit Core fail-closed gate

The current Core startup code passes `verifyInventorySnapshot: async () => false` to the Host digest ledger. Therefore reconciliation cannot declare the inventory ready. This is intentional. A successful HTTP response from capture is not readiness and is not authorization to disclose content to an NPC.

The Host patch is a separate review-only candidate (PR [#680](https://github.com/necromorphic/Logic-Engine/pull/680)); its CI evidence is not proof that the patch is installed on the target SillyTavern instance or that every mutation path is covered. The Core-owned NPC candidate is [PR #702](https://github.com/necromorphic/Logic-Engine/pull/702); it passed its exact-head automated workflows, but remains an unmerged draft and must be reconciled against the Host acceptance gates.

## 4. Documentation discrepancies identified

1. `docs/20-minimal-runtime.md` described SillyTavern as a future adapter without documenting the already-present digest-only Host API. This wording obscured the difference between a partial API surface and a complete integration.
2. The Host prototype README describes digest capture and binding, but those operations do not prove completeness. This document makes the deny-only verifier explicit alongside the route contract.
3. Host lifecycle documentation contains historical source-audit and candidate-HEAD snapshots. They must be read as evidence for the exact SHA stated in each document, not as current `main` state or proof that the patch is installed.
4. The Core/NPC integration candidate and Host candidate are separate PRs. Green CI on either branch does not prove their combined end-to-end behavior.

## 5. PC test sequence

Run against the isolated SillyTavern copy on port `8010` and its isolated data directory only. Do not touch the main SillyTavern on port `8000`, the existing Core process/database, or production Memory → NPC configuration.

1. Record actual Core process, listening port, Core revision, configured DB paths, and whether the Host ledger/coordinator files already exist. Do not start a second Core or initialize a guessed database.
2. Verify the Host patch applies cleanly to the isolated SillyTavern checkout and confirm the exact target SHA before installing anything.
3. Test Core health and all four Host routes with a disposable test world and test adapter credentials. Create a binding, verify resolve and digest capture work only for the authenticated bound adapter, then call `DELETE /v1/host-conversation-bindings/:adapter_id/:conversation_id` with the admin token and an audit `reason`; confirm resolve and capture both fail closed after revocation. Also verify unauthenticated, unbound, malformed-digest, raw-text and caller-supplied-world requests fail closed.
4. In isolated SillyTavern, test create → edit → swipe/regenerate → delete → chat switch → reload/restart; compare persisted history and Host digest inventory after each operation.
5. Test import, backup restore/delete, group/character deletion, duplicate replay, journal corruption, missing/partial inventory, and external file modification. Expected disposition remains `NON_READY` for unsupported or incomplete coverage.
6. Verify Core reconciliation remains `NON_READY` while the deny-only verifier is active. Do not enable Memory → NPC or outbound dispatch.

**PC acceptance is not yet complete.** Automated Core CI passing does not replace the isolated live Host/Core route test. After these checks, review any failures before expanding scope.


## 6. Priority-1 integration refresh — 30 Oct 2026

The pinned ST archive supplied for this project matches upstream commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127` by Git blob SHA for `public/script.js`, `src/server-startup.js`, `src/server-main.js`, `src/endpoints/chats.js`, and `src/endpoints/characters.js`.

Current review candidates:

- [#780](https://github.com/necromorphic/Logic-Engine/pull/780): bounded current-file inventory route candidate and pinned source audit.
- [#785](https://github.com/necromorphic/Logic-Engine/pull/785): Direction A delete-safety overlay.
- [#787](https://github.com/necromorphic/Logic-Engine/pull/787): combined patch composition candidate.

The combined CI patch order is lifecycle hooks → inventory route → Direction A delete-safety overlay. On the pinned ST 1.19.0 checkout, this exact composition applied cleanly; patched modules passed syntax checks and Host prototype tests 75/75. This is source/CI evidence, not a live installation.

### Important non-equivalence: file inventory vs message-version inventory

The consolidated #783 route parses each chat's first JSONL header, extracts persisted `chat_metadata.logic_engine_conversation_id`, validates UUID format, rejects duplicates, and marks the identity set incomplete when a chat has no persisted UUID. Its handler additionally requires `request.session.handle` to match `request.user.profile.handle`, denying SillyTavern's unauthenticated `DEFAULT_USER` case. It returns file locators, physical identities, sizes, timestamps, hashes and persisted conversation UUIDs. It remains a bounded, pathname-based double scan, not an atomic filesystem snapshot. The separate lifecycle bridge's in-memory version inventory is not itself an atomic file snapshot and remains REVIEW_ONLY until every mutation path is instrumented. The separate browser lifecycle identity helper prefixes its conversation UUID with an installation UUID stored in localStorage; the server inventory route returns the persisted UUID only and does not attest the localStorage installation UUID or create a durable installation/session identity. The route does not enumerate deleted historical identities, message/version/swipe parent chains, branch/import/restore lineage, or a monotonic installation snapshot sequence.

The existing `HostVersionDigestLedger.reconcileConversation()` expects `world_id`, `conversation_id`, `complete: true`, and a complete `versions[]` set containing exact message/version IDs, parent version, content digest, active and deleted flags. The ST lifecycle bridge already assembles this per-message `versions[]` inventory from `_logicEngineLifecycle` metadata, including parent lineage, active selection and explicit tombstones. However, `publishCurrentDigestInventory()` sends those entries one-by-one through the digest-capture callback and returns `CAPTURED_REVIEW_ONLY`; it does not call `reconcileConversation()` with one complete snapshot. Its `reconcileCurrentConversation()` verifies journal integrity, current fingerprint and identity snapshot, but explicitly returns NON_READY while `CURRENTLY_HOOKED_PATHS` is incomplete. Pre-enrollment messages without lifecycle metadata remain `UNKNOWN_UNRECOVERABLE`. The file inventory route's persisted UUID is not the bridge's installation-prefixed conversation identity. No production adapter currently converts the bridge's assembled versions into the ledger's complete snapshot contract or invokes the existing reconciliation method.

Core startup still constructs `HostVersionDigestLedger` with `verifyInventorySnapshot: async () => false`. This is intentional: no Host snapshot can publish READY until Core/Host approve and implement the missing authority/lineage contract. A successful per-version digest-capture HTTP response is not complete inventory attestation. There is currently no API route that invokes `reconcileConversation()`; exposing the existing snapshot contract over the authenticated adapter boundary requires explicit Core contract approval, not an invented cursor/outbox/schema.

### Final-send boundary remains separate

The pinned Chat Completions route has 13 provider-specific early-return senders plus a separate OpenAI-compatible fetch path. The inventory route and delete-safety overlay do not intercept these sends. The dispatch-start primitive in Security PR #777 is not wired to this ST server-side boundary. Protected Memory remains fail-closed for every provider until a single transport-start interface or complete per-sender coverage is implemented and tested for zero-egress denial/revocation.

**Current disposition:** Host patch composition = PASS in disposable CI; Host complete historical/version inventory = NON_READY; Core world/session authorization = NON_READY; production final-send Gateway = NOT WIRED; Memory → NPC = DISABLED / FAIL-CLOSED. Vectorization remains out of scope and unchanged.


The bridge's exact current `CURRENTLY_HOOKED_PATHS` is:

`create-message`, `message-send`, `message-receive`, `create-swipe`, `select-swipe`, `delete-swipe`, `delete-message`, `edit-message`, `rename-chat`.

This is the current bounded hook set, not a complete SillyTavern lifecycle inventory. Whole-chat deletion, group-chat deletion, character deletion, import/export, copy/branch/restore, and out-of-band filesystem changes are not in this list. The bridge itself documents that integrity is not completeness. `HostLifecycleJournal.status()` returns NON_READY while required mutation paths are missing; even after that list is complete, it still returns NON_READY because no trusted pinned-source attestation is currently supplied. Therefore the bridge has no current path to READY and cannot yet call the snapshot reconciliation route.


### Dispatch-start process/runtime compatibility gate

Pinned SillyTavern 1.19.0 `package.json` declares `engines.node: >=20`. Logic-Engine's current runtime requires Node `>=22.13.0` for its `node:sqlite` implementation. Therefore embedding the current Gateway directly in the SillyTavern server process is not guaranteed by SillyTavern's declared minimum; it can only be considered after the deployed ST runtime is explicitly verified as Node >=22.13.0 and the shared Coordinator/accepted-head connections are proven compatible.

A remote Core HTTP authorize-then-send call is not a substitute for dispatch-start linearization: Core would release its Coordinator lease before SillyTavern initiates the actual provider fetch. The final transport must either (1) run in the ST process and invoke the Gateway's synchronous transport-start callback while holding the shared lease, or (2) move the provider transport itself into Core/Gateway so the actual outbound request starts under the lease. This decision must precede implementation across the 13 provider-specific early-return senders and the OpenAI-compatible fetch path. No such final-send integration is currently wired.


## 7. Authenticated Host session identity candidate — 30 Oct 2026

The current Host patch stack now adds `GET /api/logic-engine/host/session`. The route requires `request.session.handle === request.user.profile.handle`, generates a server-side UUID in the signed SillyTavern cookie-session object, and returns that ID without exposing cookie material. The ID is stable while that authenticated session cookie remains valid; it rotates when the authenticated account changes or the session is reset.

The browser lifecycle identity is now scoped as `hostSessionId:installationId:conversationUuid`. This makes Core conversation bindings session-specific: a different authenticated ST session cannot silently reuse an old binding. Existing enrollments using the prior `installationId:conversationUuid` format are intentionally not migrated; mismatched old markers/locator bindings fail closed and require explicit re-binding.

This is **authenticated session identity**, not a durable server installation attestation. Persistence across ST restart depends on the same cookie-signing secret and a still-valid browser cookie. Cookie loss, logout/login, secret rotation, or account change produces a new identity. The localStorage installation UUID remains a client-side namespace and is not itself trusted. Core still trusts the configured server-side adapter credential; this change does not configure Core read/visibility authorizers, does not prove a complete Host inventory, and does not enable Memory→NPC.

Exact candidate components: PR #783 session handler/route and stacked Host session-identity follow-up to PR #788. Required validation: pinned-source patch composition, session handler tests, browser lifecycle identity tests, and full exact-head Runtime CI. Live target-PC cookie persistence/restart remains unverified.


## Complete Host snapshot reconciliation transport — Draft integration

The session-bound Host candidate now has a matching Core transport seam: `POST /v1/host-version-ledger/reconcile`. It accepts a complete digest-only message-version inventory with explicit parent lineage and active/deleted state. The ST server proxy additionally checks that the signed cookie session's account handle matches the authenticated user and that its server-generated Host session UUID prefixes the conversation ID. Core derives world scope from the authenticated adapter's active conversation binding; callers cannot provide `world_id` or raw content. The endpoint limits requests to 8 MiB and 25,000 versions.

The ledger performs its final binding revalidation synchronously while holding the shared Coordinator lease after the async snapshot verifier completes. Revocation and READY publication therefore serialize. Revocation after a previous READY state also invalidates that inventory before acknowledging success. This does not make inventory status an authorization token: every consumer must independently re-resolve the binding at its own read/disclosure/dispatch boundary.

The production verifier remains deny-only. The endpoint is NON_READY in production and does not grant Memory/NPC access. The Host lifecycle bridge still needs to send its assembled complete snapshot through this route only after the pinned-source attestation and complete mutation-path coverage exist. Current hooks are not complete; import/export, whole-chat/group deletion, copy/branch/restore, migrations and external filesystem edits remain unsupported. Live ST session-cookie persistence and target-PC validation remain untested.
