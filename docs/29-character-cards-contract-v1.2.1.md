# Character Cards Contract v1.2.1

**Status:** Reviewed design contract proposed for repository review; runtime implementation is separate
**Scope:** Character-card domain and its integration points with the
Logic-Engine core
**Normative language:** "MUST", "MUST NOT", "SHOULD", and "MAY" describe
requirements, recommendations, and optional behavior.

This document records the agreed character-card concept and defines
implementation boundaries. It does **not** claim that the described
card, knowledge, note, or access-filtering subsystems are already
implemented.

## 1. Purpose and placement in the architecture

A character card is a readable, versioned **projection of authoritative
world data**, not an independent source of truth. It presents the
current supported description of an entity and links to the records that
justify it.

The card subsystem is part of the Logic-Engine architecture. Its
implementation may be staged alongside core development, but it MUST
reuse core mechanisms for identity, world scoping, revisions, events,
provenance, validation, knowledge, access control, and rollback rather
than creating parallel versions of them.

The architecture retains three distinct layers:

1.  **Authorial canon and world rules:** authored facts, character
    baselines, hidden information, and world-pack rules.
2.  **Simulation and authoritative state:** accepted events, facts,
    relations, knowledge, processes, and causal/audit records.
3.  **Presentation:** card projections, player-facing views, author
    views, summaries, and narrative context.

A model-generated description or narrative sentence MUST NOT, by itself,
establish a canonical fact or mutate a card.

This document specializes the character-card direction in
[docs/23-character-and-control-architecture.md](23-character-and-control-architecture.md).
That file remains a broader planning note; this contract does not claim
that the runtime already implements the card, knowledge, note, or access
subsystems described here.

## 2. Design invariants

1.  Every character/entity has a stable system-generated ID scoped to
    its world. Authors do not manually choose internal IDs; ordinary
    player UI does not expose them.
2.  The authoritative state and event/audit history outrank card text,
    summaries, caches, vector search, and narrative prose.
3.  A card MUST be rebuildable from authoritative records and their
    valid provenance. A cache MAY be used only as a derived
    optimization.
4.  Every consequential change MUST have a supported source/provenance
    path and be validated through the core mutation boundary.
5.  Objective facts, a subject's knowledge/beliefs, the protagonist's
    knowledge, the protagonist's notes, and narrative delivery MUST
    remain distinct.
6.  Information available to an author MUST NOT automatically be
    included in a player-facing card or model context.
7.  A rollback MUST reconcile dependent projections and records while
    preserving independently supported facts and append-only audit
    history.
8.  A missing value MUST NOT be interpreted as a negative assertion.
    "Unknown" in the ordinary UI may cover multiple internal causes.
9.  A generated NPC detail MUST NOT override or silently contradict
    author-established canon.
10. The subsystem MUST preserve player agency: it cannot invent the
    player character's voluntary actions, dialogue, intentions,
    decisions, or private thoughts.

## 3. Card identity and lifecycle

### 3.1 Stable identity

The core entity ID is the canonical identity. A card is associated with
that entity; it MUST NOT create a second identity for the same
character. Duplicate detection and entity merging must be handled by
explicit, auditable core operations, not by fuzzy card-text matching
alone.

### 3.2 Short records and full cards

A background NPC does not require a full card on first appearance. The
system MAY create a minimal identity record containing only established
information and source links. A character can be promoted to a full card
when repeated interaction, significant events, a stable relationship, or
notable plot influence makes it useful. These are alternative signals,
not a checklist that must all be satisfied.

Promotion MUST reuse the existing entity and carry forward established
data. It MUST NOT invent a retroactive biography merely because the NPC
becomes important. Promotion and any persisted change to promotion status
MUST pass through the core's canonical mutation/commit boundary and its
validation, revision, provenance, transaction, and audit mechanisms. It
MUST NOT be implemented as a parallel card-only write path. The exact
event/effect representation is an implementation decision and MUST reuse
an existing supported mutation form where possible.

### 3.3 Author-created and system-created characters

For an author-authored character, supplied canon and explicit author
constraints are authoritative. Missing details MUST remain unspecified
unless the author explicitly requests generation.

For a system-created NPC, the engine MAY generate a useful background,
motives, goals, habits, skills, and relationships when the world rules
permit it and no established fact is contradicted. Generated details
MUST carry provenance indicating system-generated, non-authoritative
origin until accepted under the world's authoring policy. They MUST NOT
override author canon. If a generated detail conflicts with established
author canon, it MUST be rejected or placed in an explicit review flow;
it MUST NOT be silently accepted, silently discarded, or used to
overwrite the author-defined value.

## 4. Card projection and data ownership

### 4.1 Preferred architecture

Use a **projection over normalized authoritative records**, with an
optional revision-keyed cache. Do not create an independent mutable
"card truth" that competes with Entity, StateFact, Relation,
KnowledgeRecord, WorldEvent, or other core records.

The card projection combines:
- current authoritative facts and relations relevant to the character;
- authored baseline/profile data, where the authoring contract stores it;
- valid event/history references;
- current-state summaries derived from current facts and events;
- fields permitted by the requesting audience's access policy.

The projection MUST be deterministic for the same authoritative
revision, pinned world-pack/rule version, and access policy. Cache keys
MUST include world identity, entity identity, relevant world revision,
schema/projection version, and access-policy context. Cache entries MUST
NOT contain data unauthorized for the audience identified by the cache
key. Filtering MUST occur before restricted data is written into an
audience-scoped cache. Cache entries MUST be invalidated or revalidated
when an access-policy change affects the cache key or the audience's
authorization. A cache is disposable and MUST be rebuildable.

### 4.2 Do not duplicate normalized data

Membership, occupation, formal role, authority, access, resources,
relationships, and knowledge remain core/world records or derived
decisions according to existing domain contracts. The card may show a
concise summary and links, but MUST NOT become their competing canonical
storage.

Relationships are separate linked records and may be directed,
asymmetric, and multidimensional. A card may summarize them; it must not
flatten away important distinctions such as internal feelings,
self-awareness, outward behavior, or issue-specific trust where the
domain model supports those distinctions.

### 4.3 Schema evolution

The card projection and any authored profile schema MUST be versioned.
Migration or projection failure MUST NOT silently rewrite canonical
facts. Unsupported fields or incompatible authored data must enter an
explicit error/review path. The exact storage schema and migration
mechanism are implementation decisions to be checked against existing
storage contracts before coding. The implementation review MUST define
the meaning and source of the pinned world-pack/rule version and the
schema/projection version used for deterministic projections and cache
keys; these names do not prescribe a new versioning subsystem.

## 5. Card content contract

Only fields needed by the current character and world are required.
Other sections may be absent or added as needed. The UI may display a
simple "unknown" state, while the internal model may distinguish unknown
to the protagonist, not yet established, not authored, unavailable, or
not applicable when this affects logic.

The conceptual sections are:

1.  **Identity and base profile:** stable identity plus established
    world information.
2.  **Personality:** authored baseline for author-created characters;
    later changes require causal support. System-created characters may
    develop from established events and patterns.
3.  **Skills:** only established or explicitly authored skills.
    Represent category/proficiency where supported, concrete abilities,
    and limitations. Knowing that a character has a skill does not prove
    mastery.
4.  **Physiology and limitations:** an internal section always supported
    by the model, but empty/unknown data does not mean the character has
    no limitations. Permanent, temporary, and context-dependent
    limitations must be distinguished where relevant.
5.  **Biography and history:** one coherent current biography may be
    presented alongside structured confirmed facts and key events. Prior
    versions remain available for author/audit purposes.
6.  **Current state:** derived from current facts/events and limited to
    significant, currently valid circumstances.
7.  **Relationships:** summary only; authoritative relationship data
    stays separate.
8.  **Knowledge and secrets:** author view can access author-authorized
    information; player view is restricted to what the protagonist has
    justifiably learned.
9.  **Roles, status, occupation, and organizations:** sourced from
    separate world facts/relations; membership does not imply
    unrestricted authority or access.
10. **Resources and access:** derived by the engine from authority,
    relations, circumstances, and constraints; not a free-text grant of
    capabilities.
11. **Origin:** optional and never invented solely because the field is
    empty.
12. **Habits and behavior patterns:** authored or cautiously derived
    from repeated established behavior. A single action does not
    establish a stable habit.
13. **Speech and emotional traits:** may be authored. If absent, the
    engine may interpret context cautiously, but an interpretation is
    not automatically canon. Repeated established patterns may support
    later updates.
14. **Sources and history:** retained internally. Current projection is
    the default view; original baseline and detailed change history are
    separate views.
15. **Player notes:** explicitly excluded from the card's canonical data
    model; see Section 9.

The ordinary player UI shows only information the protagonist has
learned or can legitimately access. The author/editor view may show full
authored canon, hidden traits, provenance, current projection, baseline,
and detailed history.

## 6. Change and development rules

All changes are validated against authoritative events, world rules,
provenance, and the type of field. A generated or inferred update is a
proposal until accepted through the appropriate mutation policy.

-   **Temporary state:** remains active until a supported resolution is
    established. Do not remove it merely because time passed unless a
    rule/process confirms resolution.
-   **Mutable appearance:** update the current trait when a change is
    established; preserve prior values in history.
-   **Stable characteristic:** update only after a supported change;
    retain the prior value and its provenance.
-   **Irreversible change:** update current state and retain
    consequential history.
-   **Personality, values, and beliefs:** do not change because of one
    isolated behavior. Strong events may challenge, reinforce, or leave
    them unchanged; no particular change is mandatory.
-   **Habits:** may be established from repeated behavior or author
    input. External compliance does not prove internal change.
-   **Skills:** may be learned, developed, forgotten, lost, or
    temporarily unavailable only with appropriate causes. Potential is
    not possession. Physical limitation does not automatically erase a
    skill.
-   **Treatment/recovery:** treatment does not prove symptom or
    condition resolution unless confirmed.
-   **Relationships:** update dimensions independently when evidence
    supports it. One kind of trust does not imply trust in every matter;
    affection and harmful behavior can coexist.
-   **Organization membership and authority:** membership, formal role,
    actual permissions, resources, and current access are distinct.
    Suspension of access need not erase membership.
-   **Player character:** record confirmed events and consequences, but
    never invent voluntary player actions, dialogue, intentions,
    decisions, or private thoughts.

If evidence supports only an interpretation, retain it as an inference
or hypothesis in the relevant epistemic subsystem rather than silently
converting it into objective fact.

## 7. Provenance, revision, and concurrency

Each accepted change must be traceable to supported event/fact/source
references and the revision at which it was accepted. Use existing world
revision, event history, and audit mechanisms where possible; do not
introduce a parallel card revision counter unless the implementation
review demonstrates a specific need.

Card edits or generated updates must be staged as drafts/proposals. A
draft MUST record the base world revision and the base commit sequence
when required by the core's current proposal/commit protocol, together
with any additional snapshot token that protocol requires. The current
core uses a global world revision: an accepted change to any entity may
therefore make a draft stale even when the edited character itself did
not change. Under this conservative policy, such a conflict is valid and
MUST preserve the draft; the engine MUST NOT silently overwrite newer
state. Entity-scoped concurrency tokens MAY be considered later as an
optimization, but are not required by this contract and MUST NOT be
introduced without an implementation review.

On save/commit:
- revalidate against current authoritative state;
- reject stale drafts by default with a stable conflict response. An
  implementation MAY offer creation of a new draft version after
  explicit revalidation, but this is optional and MUST NOT be treated
  as implicit acceptance of the stale draft;
- preserve the user's edited draft and original input for conflict
  resolution. The conflict response SHOULD provide enough information
  for the user to understand why the save was rejected and what next
  step is available, without exposing unauthorized data;
- never silently overwrite newer canon or discard a prior draft;
- bind any approval to the exact immutable normalized payload/version
  being approved.

Authoritative mutations must go through the same canonical commit
boundary as other world changes. Card presentation/cache updates must
not bypass the event, validation, transaction, or audit path.

## 8. Rollback and reconstruction

A rollback is an audited state transition, not deletion of history. For
every affected card field/projection, the engine must classify the
outcome as invalidate, preserve, recompute, conflict, or review
according to the existing causal rollback contract.

-   If a field is supported by another valid, sufficient source,
    preserve it.
-   If all support is invalidated, remove it from the current projection
    while retaining audit history.
-   If a derived result depends on changed state, recompute it only when
    deterministic and safe.
-   If independent confirmed events conflict or required provenance is
    missing, create an explicit conflict/review outcome; do not invent a
    reconciliation.

Knowledge records must be re-evaluated from remaining valid sources.
Removing a source must not erase knowledge that remains sufficiently
supported by an independent source. A card rollback/rebuild must not
imply that a subject has forgotten something unless the knowledge rules
and valid causal history establish that result.

### Causal-completeness limitation

Implementation review MUST consult
[docs/21-stage1-causality-contract.md](21-stage1-causality-contract.md)
and [docs/22-causality-semantics.md](22-causality-semantics.md), and
verify their current contents against the implementation and tests.
These documents define the current causal metadata and rollback boundary;
they do not, by themselves, prove causal completeness.

Declared caused_by, depends_on, read_set, or context-manifest
references do not prove that all relevant causes or reads were declared.
Until the engine has a validated completeness mechanism, the system MUST
NOT describe a change or rollback as causally complete solely because
the declared references pass existing checks.

Where missing causality could change canon, the engine MUST use the
review/conflict path defined by the core contract, or an explicitly
documented weaker assurance policy that already exists in that contract.
A routine rollback may proceed when the core's validated rules establish
that the declared dependencies are sufficient for that operation;
absence of a complete global causal proof alone must not be
misrepresented as proof of failure or proof of safety. The
implementation and tests MUST state which assurance level applies.
This contract does not authorize bypassing a core rollback guard merely
to make a test pass.

## 9. Knowledge, access filtering, and player notes

### 9.1 Epistemic separation

Keep separate: - canonical objective fact/state; - each subject's
knowledge, belief, suspicion, dispute, or false belief; - the
protagonist's justified knowledge; - the protagonist's personal
note/hypothesis; - narrative delivery (what was actually shown or said
to the player).

Objective truth does not automatically become NPC knowledge. A fact
about a character's past does not guarantee that the character remembers
or knows it. Access to a card is not proof that the protagonist learned
its contents.

### 9.2 Access filtering

Filtering MUST be enforced server-side in API responses and during
model-context assembly, **before** restricted data is selected, returned,
or assembled for that audience. UI-only hiding is insufficient if the
API or model has already received the secret. Every request must identify
the audience/subject and apply world-scoped authorization and knowledge
rules before selecting fields and linked records. The same rule applies
to direct state endpoints, nested/linked records, summaries, exports, and
other derived responses.

The current runtime does not yet implement the complete
card/knowledge/access subsystem. This contract defines the target
behavior, not an existing guarantee. Tests must include attempts to leak
secrets through direct state responses, projections, summaries, linked
records, caches, and model-context assembly.

### 9.3 Player notes

Player notes are a separate feature/entity, not part of the
character-card model and not canonical facts. A note can contain an
observation, theory, guess, or question and may link to known
events/facts without asserting them as true.

-   Notes remain available in the player's note store until the player
    deletes them. Deletion MUST remove the note from player-facing access.
    Whether a minimal deletion/audit record is retained is governed by the
    core's existing audit and data-retention policy; a deleted note MUST
    NOT remain available as an active note or become canonical world data.
-   Unverified notes have no confirmation marker.
-   Fully confirmed notes may show a positive marker; fully disproved
    notes may show a negative marker.
-   Partial confirmation remains unmarked until fully resolved.
-   New evidence may change the current marker; previous assessments
    remain in history.
-   Confirming a note establishes objective support for the proposition
    only under the confirmation rules. A positive marker means the claim
    is objectively supported; it does **not** mean the protagonist knows
    it. The confirmation may provide evidence that can support a later
    knowledge update, but protagonist knowledge must be acquired through
    a valid in-world channel and recorded separately in the knowledge
    subsystem. The UI SHOULD distinguish objective confirmation from
    what the protagonist has personally learned.
-   A note must never directly mutate a card or canonical world state.
-   The exact note schema is an implementation decision. It MUST include
    at least a stable note ID, world scope, author/player reference, text
    content, optional links to known facts/events, and a status/history
    field. This minimum does not make a note canonical data or require
    notes to be stored inside character cards.

The exact UI placement of notes is intentionally deferred; the data and
epistemic separation are not.

## 10. Personality and behavioral development

Personality is structured enough to guide behavior while preserving
nuanced interpretation. Suggested categories are temperament/core
traits, values, beliefs, habits, emotional characteristics, motivation,
behavior style, and optional speech style. These categories are
conceptual and should map to the smallest practical schema supported by
the world pack.

-   Author-defined baseline is preserved.
-   Current personality may evolve only with supported causal
    justification.
-   A strong event may challenge or reinforce a trait without forcing a
    change.
-   Inner feelings, self-awareness, and outward behavior may differ.
-   Author/editor views can access hidden traits; player views only
    expose justified knowledge.
-   If emotional traits or speech style are unspecified,
    context-sensitive interpretation is allowed but is not itself canon.
    Stable patterns may be promoted only through the same
    evidence/change policy as other profile data.
-   Detailed behavior-selection rules belong to the engine/NPC autonomy
    contract, not to the card presentation schema.

## 11. Acceptance tests and implementation gates

The subsystem is not complete until automated tests establish at least
the following:

1.  A card projection is deterministic for the same world revision, rule
    version, entity, and audience.
2.  Rebuilding the projection from authoritative records yields the same
    result as the live projection.
3.  Updating a card cannot bypass the canonical mutation/validation
    boundary. Promotion from a short NPC record to a full card must also
    use that boundary and produce the appropriate event/audit evidence.
4.  A stale draft cannot overwrite a newer accepted change; the conflict
    preserves the draft for resolution. Include a cross-entity case where
    a change to character B advances global world_revision while a draft
    for character A is open; under the current global-revision policy,
    the conflict is expected even if A itself did not change.
5.  A generated NPC draft cannot override author-established canon
    without the explicit authoring flow. A generated detail that conflicts
    with author canon is rejected or routed to review, never silently
    accepted or silently discarded.
6.  A rollback preserves a fact supported by an independent valid
    source.
7.  A rollback removes unsupported derived state and retains append-only
    audit history.
8.  Knowledge survives removal of one source when remaining sources are
    sufficient, and is reconciled when no valid source remains.
9.  Objective confirmation of a player note does not itself add
    protagonist knowledge.
10. API responses, player-facing projections, and model contexts exclude
    unauthorized secrets server-side before selection/assembly; UI-only
    hiding is insufficient.
11. Cache keys and reads are world-scoped and access-policy-aware;
    filtering occurs before cache writes, and stale or unauthorized cache
    entries cannot leak.
12. Player-character updates never synthesize voluntary player actions,
    words, intentions, decisions, or private thoughts.
13. Missing/ambiguous causal metadata produces the assurance outcome
    specified by the core rollback contract; the engine never falsely
    claims causal completeness, and canon-affecting uncertainty enters
    review/conflict rather than being silently resolved.
14. Missing optional fields do not imply a negative fact or absence of a
    limitation.
15. Promotion from short NPC record to full card preserves identity and
    established data without inventing a past, and uses the canonical
    mutation/commit boundary with event/audit evidence.
16. A generated detail conflicting with author canon is rejected or
    explicitly reviewed, never silently accepted or discarded.
17. Deleting a player note removes it from active player-facing access;
    any retained deletion record follows the core's existing audit policy.

## 12. Implementation sequencing

The card contract can be reviewed now while core development continues.
Implementation should follow dependency readiness rather than wait for
every planned core feature to be complete.

Recommended sequence: 1. Confirm contracts for identity, world revision,
event/provenance, rollback, and current canonical projections. 2.
Implement a read-only card projection over existing authoritative
records, with no separate card truth. 3. Add authored baseline/profile
data and versioned draft/edit flow through the existing mutation
boundary. 4. Integrate access filtering and knowledge only when their
authoritative contracts and enforcement points are clear; never expose
unrestricted data in the interim. 5. Add player notes as a separate
feature. 6. Add causal change reconciliation, personality/skill
development rules, promotion from short records, and author UI in
dependency-sized increments. 7. Run cross-subsystem rollback, security,
concurrency, and reconstruction tests before declaring integration
complete.

This sequence is a recommendation, not a claim that any listed feature
currently exists.

## 13. Existing contracts and open technical checks

Before implementation, reviewers must verify compatibility with the
current versions of: - core domain model and entity/fact/relation
records; - persistence, world revision, and event/audit transaction
boundaries; - causal rollback and reconstruction; - NPC autonomy/process
lifecycle; - knowledge and narrative boundaries; - proposal-to-commit
validation and stale-proposal handling; - world-pack/schema versioning
and access-policy configuration.

Reviewers must distinguish: - **already implemented and tested**; -
**partially implemented**; - **specified but absent**; - **contradictory
and requiring correction**; - **not verifiable from reviewed
source/tests**. The current global world_revision is a conservative
concurrency token: unrelated world changes may invalidate a draft. This
is an accepted interim behavior, not a guarantee of entity-scoped
conflict detection.

Do not assume a documented target is implemented merely because a
contract describes it. Do not alter the existing vectorization adapter
as part of this work; vector/search results remain derived retrieval
material and must be revalidated against authoritative state and access
rules.

## 14. Review questions

1.  Does the projection architecture fit current storage and revision
    semantics without duplicating canonical records?
2.  Which existing records can hold authored baseline/profile fields,
    and which new schema elements are genuinely necessary?
3.  What exact pre-commit enforcement point can filter restricted fields
    before player/model context assembly?
4.  Which rollback/rebuild APIs can the projection reuse, and what is
    their tested behavior under independent sources and incomplete
    causal metadata?
5.  How should projection schema versions and caches be invalidated on
    world-pack changes and access-policy changes?
6.  What are the minimum implementation slices that preserve a working
    core and avoid parallel truth stores?

Reviewers should provide evidence paths/symbols/test names and classify
each claim by implementation status. No source modifications, commits,
or merges are authorized by this draft.
