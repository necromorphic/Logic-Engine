# 07. Knowledge, narrative and visibility boundaries

Status: proposed core contract.

## 1. Separate four concepts

1. **Canonical fact:** what the engine currently accepts as true in the world.
2. **Subject knowledge/belief:** what a specific entity knows, suspects, disputes or falsely believes.
3. **Narrative delivery:** what text was selected/injected/shown to a user or actor.
4. **Search retrieval:** which archive fragments were retrieved for a model call.

None of these automatically implies the others. A retrieved fragment is not automatically valid; text shown to the player is not automatically known by every NPC; a generated statement is not automatically a canonical fact.

## 2. Knowledge provenance

Every KnowledgeRecord must identify one or more valid sources and the path by which the holder could acquire the proposition. Allowed source kinds are declared by the core contract and/or World Pack, for example:
- direct observation with location/time/visibility constraints;
- communication from a source, with channel and delivery evidence;
- document or recording;
- inference from known premises using a declared rule;
- authorized author-provided knowledge;
- imported initial state with explicit provenance.

The model cannot invent a source retroactively to justify knowledge.

## 3. Access filtering

Before building an actor context, filter:
- world scope;
- subject/role access;
- public/private visibility;
- source validity;
- current knowledge validity;
- sensitivity or secrecy policy;
- confidence and epistemic status;
- whether the fact is current, historical, disputed or retracted.

Vector search must be followed by this access and validity filter. Embedding similarity is not permission to reveal a secret.

## 4. Multiple sources and belief updates

A proposition can be supported by several sources. Invalidating one source triggers reconciliation, not unconditional deletion. If at least one valid source still supports knowledge under the acquisition rules, preserve it. If sources disagree, use the pack's reconciliation rule or mark disputed. A subject may retain a false belief if they have not learned a valid correction.

Do not automatically erase a memory just because objective truth changed; distinguish learning, forgetting, contradiction and rollback of the source event.

## 5. Narrative generation contract

Narrative generation receives a bounded, permission-filtered result package containing:
- confirmed effects that may be narrated;
- unresolved outcomes explicitly marked;
- permitted viewpoint and visibility;
- actor dialogue/action intents approved by simulation;
- player-agency constraints;
- facts intentionally withheld from the current viewpoint.

Narration may add sensory language and stylistic detail but may not create consequential canonical events, change time, reveal inaccessible knowledge, or decide the player's voluntary actions.

## 6. Delivery receipts

A receipt identifies the target, payload/event references, attempt, state and any host confirmation available. Use `injected_unconfirmed` when the host accepted injection but did not confirm visible rendering. Only an actual supported signal can set `shown`.

A delivery failure can be retried without recommitting the underlying world event. A rolled-back event invalidates associated deliveries but does not use delivery state as evidence that the event happened.


## 7. Current implementation boundary and cross-block authorization gate (2026-10-26)

**Status: proposed semantic contract; not an executable authorization service. Production Memory→NPC remains DISABLED / FAIL-CLOSED.**

Core's source review in [issue #140](https://github.com/necromorphic/Logic-Engine/issues/140#issuecomment-6409471135) found no existing callable, executable subject-relative knowledge/acquisition authority. `AuthorizedReadService.readEntityFields()` authorizes selected canonical entity fields; it does not prove that a particular NPC acquired the information. No fields are approved for production disclosure to recipient `model`, purpose `npc_decision`.

### Required evidence for any future subject-relative admission
A future approved contract must establish, using trusted owner-controlled evidence:

1. Authenticated world and recipient/subject scope; caller labels and context-manifest membership are not authority.
2. Exact proposition/source identity and version/lineage, plus authoritative source currentness and retraction status.
3. An allowed acquisition mechanism and its mechanism-specific evidence. Retrieval, candidate assembly, context inclusion, or model-generated claims alone do not establish delivery, receipt, acquisition, or belief.
4. Invalidation/reconciliation semantics for edit, delete, revoke, rollback, rebuild, restart/replay, and missing, unknown, partial, or inconsistent state. Unknown or incomplete evidence fails closed.
5. A final disclosure-time revalidation boundary and a defined consistency guarantee; sequential checks must not be described as atomic.

### Mechanism-specific evidence required (not yet implemented as a callable contract)

The following are candidate semantic requirements for owner review, not a new schema or a claim that these evidence sources exist today:

- **Observation:** authenticated subject, source/event identity, location/time and visibility/access conditions sufficient to establish that the subject could perceive the proposition. World truth or co-location alone is insufficient.
- **Delivered communication:** sender, intended recipient, exact source/version and channel plus a real supported delivery/receipt signal. Candidate assembly, attempted injection, or an unconfirmed send is insufficient.
- **Document/recording:** exact artifact identity/version, source lineage and evidence that the subject accessed or perceived the relevant content; mere archive presence or retrieval is insufficient.
- **Inference:** identified premises already admissible for this subject, a declared inference rule/version, and deterministic replayable derivation evidence. The model's unsupported assertion is not evidence.
- **Authorized author knowledge / imported initial state:** explicit product/World Pack authorization and provenance identifying the initial scope and source. A caller-supplied label is not authority.
- **Unknown or unimplemented mechanism:** UNSUPPORTED / NON_READY; do not infer acquisition from canonical truth, retrieval metadata, Provider row metadata, or a fixture callback.

### Lifecycle and stage invariants

- Source edit/version change requires revalidation against authoritative source identity, lineage and currentness; an unknown version comparison is NON_READY.
- Source deletion/retraction and access-grant revocation are distinct invalidation causes and must be tested separately.
- Rollback/rebuild may restore an earlier projection revision without a monotonically increasing per-source token. Re-evaluate from authoritative restored state; do not use updated_revision, world_revision, or commit_sequence as a substitute for a source journal.
- Restart/replay may reconstruct a claim only from durable, validated evidence and deterministic implemented rules. Missing/corrupt lineage, partial inventory, validator errors, or changing inventory during reconciliation fail closed.
- Multiple independent valid acquisition paths may support one proposition. Invalidating one path triggers reconciliation; it must not erase a still-valid independent path or preserve a claim with no valid path.
- Keep these stages distinct: candidate retrieval → NPC admission → final model disclosure → outbound delivery → recipient receipt → subject acquisition → belief update. Each later stage requires its own supported evidence and cannot be inferred from the previous stage.

### Owner decisions still required before implementation

- **Core / product owner:** confirm the first permitted subject-relative acquisition mechanism and its authoritative source/currentness/retraction authority; decide whether any recipient model, purpose npc_decision field visibility is ever allowed. Current policy remains DENY / NON_READY; no field is approved.
- **Memory Provider:** confirm which immutable record/version/lineage and lifecycle guarantees its existing operations actually provide, and identify where trusted Core/Host authority is absent. Provider metadata cannot mint acquisition evidence.
- **NPC:** confirm the existing consumer's representable input/evidence and narrow projection; do not equate ready/admission with knowledge, delivery, receipt, acquisition or belief.
- **Host/Adapter:** identify the actual outbound send boundary and all enabled/bypassable routes; prove edit/delete/revoke after candidate assembly and before actual release, or mark the route unsupported. Raw ST text retention is not approved.
- **Coordinator:** consolidate one owner-reviewed decision in #264 before any cross-block API/schema design. Each owner must respond ACCEPT, REJECT (with concrete incompatibility), or UNSUPPORTED (with exact missing callable runtime evidence) against this same proposal.

### Acceptance criteria before any production enablement

Using real owner components—not fixture-only validators—prove: source v1→v2 invalidation; delete/retraction distinct from grant revocation; rollback/rebuild even without an increased commit sequence; restart/replay; missing/corrupt lineage and incomplete inventory fail closed; a valid independent second source survives invalidation of the first; authorization/source invalidation after candidate assembly but before actual outbound release results in zero protected content or metadata leakage; and unsupported generation routes remain disabled. Separately evidence admission, disclosure, delivery, receipt, acquisition and belief. These criteria do not themselves authorize production enablement.

### Explicit non-equivalences

- Provider `record_version` versions a Provider record; it is not a canonical source revision.
- Provider `source_version` is currently an opaque supplied token. It has no approved mapping to Core `updated_revision`.
- `world_revision + commit_sequence` is a snapshot freshness marker, not a per-source change/retraction journal.
- Canonical truth does not imply subject knowledge; admission does not imply delivery, receipt, acquisition, or belief.
- A green unit/fixture suite, proposed document, browser guard, or Provider-local adapter does not prove production composition or end-to-end authorization.

### Work allowed before the contract is approved

Owner blocks may continue isolated, non-production work within their existing code and scope: Core may draft the narrow contract and acceptance criteria; Provider may harden Provider-local persistence, identity/lineage validation, tombstone/reconciliation and fail-closed behavior without retaining raw Host text or claiming Core authority; Host may inspect/test the pinned ST lifecycle and actual pre-send boundary, with unsupported paths remaining fail-closed; NPC may finish independent review of NPC-only PRs and preserve the existing admission seam without fabricating a receiver. None of these permissions authorizes a new cross-block API/schema/store, a positive fixture-backed production validator, raw ST-text retention, production wiring, or enabling Memory→NPC.

Before runtime implementation crosses block boundaries, Core, Memory Provider, NPC, and Host must agree on the exact semantic contract and ownership. The coordinator records that agreement in the existing critical-path tracker; it does not unilaterally approve fields or invent wire shapes.

## 8. Execution permissions and the actual disclosure boundary (coordinator clarification, 2026-10-26)

This section records the current evidence and permission boundary; it does not approve a runtime contract or any production field.

### Current owner findings

- Core #140: no executable/callable subject-relative acquisition authority exists. The proposed KnowledgeRecord semantics are not implemented as a callable authority. Policy B remains DENY / NON_READY for `model / npc_decision`; no fields are approved.
- Provider #181: `record_version` versions a Provider record. `source_version` remains opaque and is not mapped to Core `updated_revision`; Provider records do not prove which subject acquired a proposition through an allowed mechanism.
- NPC #149: `MemoryNpcConsumer.retrieveForNpc(request)` is an injected internal seam, not a production receiver. It performs retrieval/admission and a canonical-field read; it cannot establish subject-relative acquisition.
- Host #258: on pinned SillyTavern SHA `06bde939fb1e9c4c8d8641d810f0a916b5bce127`, the inspected `CHAT_COMPLETION_SETTINGS_READY` point precedes serialization for one browser Chat Completions path only. The current candidate patch does not intercept the actual provider-send path; server/provider branches, Text Completions, native/server callers, extensions/custom routes, and other generation families remain unsupported or bypassable. Complete Host inventory and revoke/edit/delete-after-assembly-before-send are not proven.

### Safe permissions before cross-block approval

- **Core:** finish the narrow semantic proposal and list product-owner decisions. Documentation and tests for existing behavior are allowed; no runtime authority, fields, or schema are implicitly approved.
- **Provider:** continue Provider-local immutable identity/version/lineage, duplicate/conflict, tombstone, reconciliation, restart/replay, and fail-closed hardening. Do not treat injected validators or Provider rows as Core or acquisition authority.
- **Host:** continue source-backed investigation and patch applicability/lifecycle tests on the pinned target; classify every route as intercepted, unsupported, or unverified. No claim of a final-send gate unless the actual outbound path is intercepted and tested.
- **NPC:** continue independent review of NPC-only PRs and prepare a minimal consumer adaptation plan against the actual signature. No oracle-only test churn absent a demonstrated defect; no production receiver.

### What would unlock a cross-block implementation

First, Core, Provider, NPC and Host must review the same semantic proposal and explicitly identify what they accept, reject, or cannot implement. The agreement must cover trusted world/subject scope; proposition and source identity; source currentness/retraction; acquisition mechanism and evidence; edit/delete/revoke/rollback/rebuild/restart/replay; unknown/incomplete states; and separate admission, disclosure, delivery, receipt, acquisition and belief stages.

Only then may the coordinator authorize a **specific, minimal implementation diff** with named files, owners, and acceptance tests. That authorization is not permission to enable production. Release remains blocked until an actual callable owner-component path and the real pre-dispatch revalidation/revocation test pass across every enabled generation route. If a route cannot be covered, it must remain disabled/unsupported.

A source-inspected hook, fixture test, patch-apply CI, or sequential recheck is not proof of atomic revocation or complete end-to-end enforcement.
