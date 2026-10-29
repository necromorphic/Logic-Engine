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
| `DELETE /v1/host-conversation-bindings/:adapter_id/:conversation_id` | Revoke a conversation binding | `x-admin-token` (verify against the current route implementation) | The binding is revoked; subsequent resolve/capture must fail closed |
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
3. Test Core health and all four Host routes with a disposable test world and test adapter credentials. Create a binding, verify resolve and digest capture work only for the authenticated bound adapter, then call `DELETE /v1/host-conversation-bindings/:adapter_id/:conversation_id`; confirm resolve and capture both fail closed after revocation. Also verify unauthenticated, unbound, malformed-digest, raw-text and caller-supplied-world requests fail closed.
4. In isolated SillyTavern, test create → edit → swipe/regenerate → delete → chat switch → reload/restart; compare persisted history and Host digest inventory after each operation.
5. Test import, backup restore/delete, group/character deletion, duplicate replay, journal corruption, missing/partial inventory, and external file modification. Expected disposition remains `NON_READY` for unsupported or incomplete coverage.
6. Verify Core reconciliation remains `NON_READY` while the deny-only verifier is active. Do not enable Memory → NPC or outbound dispatch.

**PC acceptance is not yet complete.** Automated Core CI passing does not replace the isolated live Host/Core route test. After these checks, review any failures before expanding scope.
