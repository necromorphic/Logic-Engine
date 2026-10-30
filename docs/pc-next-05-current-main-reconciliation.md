# PC-NEXT-05 — current-main reconciliation and Gateway security review

**Status:** source review complete; documentation-only checkpoint.  
**Base:** current `main` at branch creation.  
**No production code, API, schema, database, process, PR review state, or merge was changed.**

## 1. Why this checkpoint supersedes parts of PC-NEXT-04

PC-NEXT-04 was written against an earlier repository snapshot. Current-main reconciliation changes several statements:

| Item | Current disposition | Consequence |
|---|---|---|
| Core coordinator PR #398 | **Merged** | Shared coordinator primitive is part of current main; #380 is historical prototype evidence. |
| Provider coordinator PR #383 | **Closed unmerged / superseded** | Do not treat #383 as the active integration branch. Current-main `sqlite-memory-provider.js` imports and uses the coordinator helper; review the merged current-main implementation, not #383 as a merge dependency. |
| Core source-version/inventory PR #709 | **Merged** | Durable `core-entity-v1:N` source versions and canonical entity inventory are on main. Old #681 is not the current dependency. |
| Gateway PR #646 | **Open Draft** | Still a candidate, not main runtime. It needs rebase/port against the accepted #709 contract and fresh exact-head validation. |
| Host lifecycle PR #680 | **Closed unmerged** | Its branch is preserved as candidate evidence, not installed Host runtime. |
| Host persisted-save receipt PR #689 | **Open Draft stacked on #680** | Cannot be treated as main or as a complete Host lifecycle implementation. |
| NPC reader PR #744 | **Closed unmerged** | Candidate only; the private adapter contract still identifies it as not shipped. |
| NPC reducer PR #695 | **Closed unmerged** | Candidate only; not production admission wiring. |

The current private adapter contract (`docs/57-private-host-core-memory-npc-adapter-contract.md`) explicitly says the source-ingestion base #683 and source-version/inventory #709 are on main, while #744, #695, #680, #689 and #646 do not establish an end-to-end Host → Core/NPC → sole-Gateway path.

## 2. Current-main code facts

### 2.1 Coordinator

`src/storage/coordinator-lock.js` is present on main. It opens a file-backed SQLite coordinator and uses `BEGIN IMMEDIATE` for a synchronous lease. The helper rejects async callbacks and is documented as a lock primitive, not a business-data store.

`src/application/sqlite-memory-provider.js` on main imports `beginCoordinatorLock` and `openCoordinatorDatabase`. The Provider implementation includes coordinator path validation and wraps its own local mutation paths. This is stronger than the earlier statement that Provider participation existed only on the unmerged #383 branch.

Limits remain:
- The coordinator is cooperative. It serializes only participants that actually acquire it.
- A separate process with direct write access to Core/Provider DB files can bypass application wrappers.
- A coordinator lease is not a cross-database atomic commit. Core and Provider still commit their local stores separately.
- Deployment-level single-writer/ACL/restore isolation remains a separate gate.

### 2.2 Core source-version/inventory

PR #709 is merged. Current main uses durable opaque source tokens `core-entity-v1:<counter>`, rather than the earlier `updated_revision` proposal. The token advances with canonical mutation/rollback handling. Core also provides snapshot-pinned canonical entity inventory support for Provider reconciliation.

This closes the old #681 dependency statement in #646's description only at the level of the Core source-version/inventory feature. It does **not** automatically port #646 to the new schema/reader contract or prove complete Host chat history, deleted-message inventory, import/restore coverage, or final-send integration.

### 2.3 Current-main Gateway

`src/security/memory-dispatch-gateway.js` exists on main, but its current signature and evidence wiring are older than the #646 candidate:
- current main does not contain `src/security/memory-dispatch-sqlite-evidence.js`;
- current main signature does not bind `adapter_id` and `conversation_id` in the request canonicalization;
- the Gateway constructor expects injected trusted readers;
- current main's implementation is not evidence that the #646 server-owned identity/readers are shipped;
- PC-NEXT-04's critical-section concern remains relevant to the current-main implementation.

PR #646 adds the read-only Core/Provider evidence reader, adapter/conversation binding in the signed request and ledger, and synchronous transport-start while holding the coordinator. It is still Draft and its exact-head tests are candidate evidence only.

## 3. Confirmed security finding in PR #646

An inline security review on PR #646 (30 Oct 2026) identifies a concrete missing check in its new `src/security/memory-dispatch-sqlite-evidence.js`:

- Provider query reads `content_disposition` and `lineage_json` from `memory_records`.
- It requires `content_disposition === 'usable'`.
- It does **not** select or validate `evidence_assessment`.
- The Provider schema persists `evidence_assessment`.
- Current NPC admission contract permits only `evidence_assessment === 'supported'`; `unassessed`, `disputed`, and `insufficient` must not be admitted for model disclosure.

The finding is valid against the inspected PR #646 diff. Current Host inventory hard-stop (`inventory_status: NOT_READY`) prevents the candidate from reaching a positive dispatch in the tested real-reader fixture, but that does not remove the latent positive-path defect. If inventory later becomes READY, a usable-but-unassessed/disputed/insufficient record could pass the Gateway reader unless Gateway itself revalidates the assessment.

**Required correction before any positive-path acceptance:**
1. Read `evidence_assessment` from the persisted Provider row.
2. Require exact `supported` (fail closed on missing, unknown, or any other value).
3. Add real SQLite-reader negative tests for `unassessed`, `disputed`, `insufficient`, missing column/schema, and unknown value.
4. Confirm the same approved NPC admission semantics are being applied; do not invent a new assessment mapping in Gateway.
5. Re-run exact-head Runtime and Provider boundary workflows after the correction.

This is a review finding, not a production defect report: #646 is unmerged and current main does not contain its evidence reader.

## 4. Host egress integration remains the dominant missing link

The PR #646 discussion itself records that the pinned SillyTavern server routes remain provider-specific:
- Chat Completions: `src/endpoints/backends/chat-completions.js`, `POST /generate`, multiple provider-specific send functions and `fetch` sites.
- Text Completions: `src/endpoints/backends/text-completions.js`, separate `POST /generate` and send sites.
- Additional multimodal, extension, and alternate backend paths exist outside the single selected route.

The Gateway PR does not wire these actual final-send paths. The Host lifecycle candidate #680/#689 addresses capture/persistence lifecycle and receipts, not sole protected egress. A browser-side hook or a single generic sender hook cannot be assumed to cover provider branches that send directly.

Minimum safe initial scope:
- One specifically approved pinned Chat Completions route only.
- Trusted server-side binding of adapter, stable conversation, world, actor, purpose, and exact source/candidate set.
- Gateway invocation after provider-specific request transformation but before any upstream bytes are handed off.
- Gateway owns the one transport-start operation; no direct fallback if Gateway is absent or returns non-ready.
- All other routes reject protected payloads; they must not silently use their ordinary direct provider sender.

The actual server-side prompt/context serializer and trusted handoff are not yet proven. Do not invent a new browser header or accept browser-supplied identity fields as authority.

## 5. Reconciled dependency graph

| Component | Main / candidate state | Required next action |
|---|---|---|
| Coordinator primitive | Main, PR #398 merged | Keep; verify every relevant writer and OS-level bypass boundary. |
| Core source-version + inventory | Main, PR #709 merged | Use this exact token/inventory contract when porting Gateway evidence readers. |
| Provider coordinator participation | Present in current-main Provider source | Build a current-main writer call-site matrix; do not cherry-pick stale #383 blindly. |
| Gateway | Current-main primitive; #646 Draft candidate | Port/rebase against #709 and current Provider/NPC assessment contract; fix evidence_assessment omission. |
| Host lifecycle | #680 closed unmerged; #689 Draft stacked | Preserve as candidate; do not treat as installed or complete. |
| NPC acquisition reader | #744 closed unmerged | Separate lane; no direct raw-value serialization to model. |
| NPC admission reducer | #695 closed unmerged | Gateway must enforce its approved metadata boundary; helper alone is not authorization. |
| SillyTavern final-send | Not wired | New separately reviewed Host integration is required. |
| PC deployment | Not proven | Separate identities, DB/WAL/SHM ACLs, restore anti-rollback, and phone↔PC auth evidence. |

## 6. Updated gate status

| Gate | Status |
|---|---|
| Shared coordinator code exists on main | VERIFIED (primitive only) |
| Core source-version/inventory contract on main | VERIFIED (PR #709) |
| Every Core/Provider writer forced to participate | NOT PROVEN |
| Direct DB bypass excluded by target-PC OS boundary | NOT PROVEN |
| Current-main Gateway has final evidence readers | NO |
| #646 Gateway candidate binds Host identity | CANDIDATE |
| #646 enforces NPC evidence assessment | FAIL — review finding |
| #646 starts transport under coordinator | CANDIDATE |
| Pinned ST final-send calls Gateway as sole transport | NOT WIRED |
| Unsupported provider routes fail closed for protected payloads | NOT PROVEN |
| Host complete all-time inventory / anti-rollback | NON_READY |
| Production deployment and restore proof | BLOCKED |
| Memory → NPC | DISABLED / FAIL-CLOSED |

## 7. PC-NEXT-05 conclusion

The correct next step is **not** to merge #646 or to start production integration immediately.

First, port/reconcile the Gateway candidate against current main after #709, fix the missing `evidence_assessment === 'supported'` check, and test it with real persisted Provider rows. In parallel, map current-main Core/Provider writers and establish which can bypass the coordinator. Only after those pieces are reviewed should a separate Host change bind the trusted server-side context to one exact pinned final-send path.

The previous PC-NEXT-04 conclusion remains valid at the broad boundary level (no sole egress integration), but its dependency references are superseded: #398 and #709 are merged; #383 is closed unmerged; #681 is no longer the active Core source-version candidate.

No production code or runtime state was changed. Host remains `NON_READY`; Stage 2 remains `NO-GO`; Memory → NPC remains `DISABLED / FAIL-CLOSED`.
