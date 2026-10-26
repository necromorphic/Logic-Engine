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

### Explicit non-equivalences

- Provider `record_version` versions a Provider record; it is not a canonical source revision.
- Provider `source_version` is currently an opaque supplied token. It has no approved mapping to Core `updated_revision`.
- `world_revision + commit_sequence` is a snapshot freshness marker, not a per-source change/retraction journal.
- Canonical truth does not imply subject knowledge; admission does not imply delivery, receipt, acquisition, or belief.
- A green unit/fixture suite, proposed document, browser guard, or Provider-local adapter does not prove production composition or end-to-end authorization.

### Work allowed before the contract is approved

Owner blocks may continue isolated, non-production work within their existing code and scope: Core may draft the narrow contract and acceptance criteria; Provider may harden Provider-local persistence, identity/lineage validation, tombstone/reconciliation and fail-closed behavior without retaining raw Host text or claiming Core authority; Host may inspect/test the pinned ST lifecycle and actual pre-send boundary, with unsupported paths remaining fail-closed; NPC may finish independent review of NPC-only PRs and preserve the existing admission seam without fabricating a receiver. None of these permissions authorizes a new cross-block API/schema/store, a positive fixture-backed production validator, raw ST-text retention, production wiring, or enabling Memory→NPC.

Before runtime implementation crosses block boundaries, Core, Memory Provider, NPC, and Host must agree on the exact semantic contract and ownership. The coordinator records that agreement in the existing critical-path tracker; it does not unilaterally approve fields or invent wire shapes.
