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


## 7. Core 1.9 subject-relative acquisition contract proposal

**Status: semantic proposal for cross-block review only; not a callable runtime contract.** No production field is approved, and Memory→NPC remains DISABLED / FAIL-CLOSED.

A knowledge claim concerns one authenticated subject in one trusted world, about one proposition or source reference. To be admissible, its evidence must establish:
- trusted subject/world binding, not caller-supplied labels;
- source identity and lineage, plus authoritative currentness/retraction status;
- one declared acquisition mechanism: observation, delivered communication, document/recording, inference from admissible premises, authorized author knowledge, or imported initial state with provenance;
- mechanism-specific evidence. Retrieval, candidate assembly, context inclusion, or attempted send alone does not prove delivery, receipt, acquisition, or belief;
- epistemic status distinct from canonical truth: knowledge, suspicion, dispute, and false belief must not be silently collapsed.

Lifecycle rules proposed for review:
- source edit/update: revalidate identity, lineage and version; unsupported comparison => NON_READY;
- source deletion/retraction and access-grant revocation are distinct invalidations;
- rollback/rebuild: re-evaluate against restored source projection and lineage; world_revision + commit_sequence are not a per-source journal;
- restart/replay: reconstruct only from durable evidence and implemented deterministic rules;
- missing/unknown version, incomplete inventory, validator error, unsupported source kind or missing lineage => NON_READY;
- multiple sources require reconciliation: invalidating one source need not erase a claim if another independently valid acquisition path remains;
- recheck authorization/currentness at the actual Host pre-dispatch boundary when a source or grant can change after candidate assembly. Core API send is not the pinned SillyTavern model sender.

Existing mechanisms and limits:
- AuthorizedReadService.readEntityFields() authorizes a finite canonical-field read, not subject knowledge; no production NPC field policy is approved.
- entities.updated_revision is a projection's last applicable event revision and can revert on rollback/rebuild; no approved equivalence to Provider source_version exists.
- Provider record_version versions a Provider record; source_version is opaque and its authority comes only from an injected validator.
- MemoryNpcConsumer.retrieveForNpc() is an injected admission seam, not a production receiver or acquisition mechanism.
- Host browser/lifecycle CI does not prove complete mutation inventory, live Android/Termux behavior, or final-send enforcement.
- Raw Host/ST text retention and disclosure remain unapproved.

Owners:
- **Core:** trusted subject/world binding, canonical source validity/currentness, disclosure policy.
- **Provider:** record identity/version/lineage and durable reconciliation; Provider metadata cannot create acquisition authority.
- **NPC:** subject-relative admission and epistemic-state compatibility; admission cannot imply acquisition or belief.
- **Host:** real capture/inventory evidence and actual pre-dispatch interception/revocation behavior.
- **Coordinator:** consolidate one agreed contract before any callable shape is designed.

Acceptance before production enablement must use real components and prove update/edit staleness; delete/retraction separately from grant revocation; rollback/rebuild even without an increased commit_sequence; restart/replay and corrupt/missing lineage; incomplete inventory/unknown sources fail-closed; no protected fields/content leakage; revocation between assembly and send blocks dispatch; and separate evidence for admission, disclosure, delivery, receipt/acquisition and belief. Provider-local callbacks or fixture-only green tests do not satisfy these gates.

Cross-block decisions still required before API/schema design: supported first acquisition mechanism and its evidence; authoritative source type/currentness/retraction; source-version owner and semantics; durable NPC representation; actual Host release/receipt signals; and any finite disclosure fields/purpose. Until these are agreed, no source fields are approved and no runtime/schema implementation is authorized.
