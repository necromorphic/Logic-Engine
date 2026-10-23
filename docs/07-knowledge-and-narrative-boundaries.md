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
