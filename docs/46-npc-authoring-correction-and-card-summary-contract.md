# NPC Authoring, Correction, and Card-Summary Contract

Status: documentation-only semantic contract on `feat/npc-subsystem`. It defines authoring and presentation requirements without choosing a runtime API, database schema, prompt format, or card JSON shape. It does not authorize runtime, API, schema, storage, prompt, vectorization, or SillyTavern changes.

## 1. Purpose and boundary

The NPC subsystem needs a predictable way to distinguish what an author configures, what happens in the simulated world, what an NPC comes to know or believe, and what a character card summarizes for a human or model.

This contract fills the semantic gap between:
- the normative subsystem rules in `docs/31-npc-subsystem-contract.md`;
- the author decisions in `docs/38-npc-author-decisions-and-semantic-delta.md`;
- the optional social-identity editor in `docs/40-npc-social-identities-editor-contract.md`;
- the relationship-state proposal in `docs/42-npc-relationship-state-contract-proposal.md`;
- the separate character-card contract proposal.

It is a domain contract, not a claim that an editor, card projection, or correction command exists in the current runtime.

## 2. Four kinds of information must not be conflated

Every future authoring, decision, and card-projection boundary must preserve these distinctions:

1. **Author configuration** — instructions or initial setup explicitly entered by the author. It may constrain the story or define initial state only through an authorized authoring/import boundary.
2. **Canonical world state** — what the simulation currently records as true or as having occurred.
3. **Subject-relative information and belief** — what a particular NPC acquired, remembers, suspects, believes, disputes, or rejects. This is not implied by a canonical fact, profile text, retrieval hit, or prompt inclusion.
4. **Presentation summary** — a compact, possibly lossy view of selected records for a card or decision. It must not become a second authority or silently fill missing records.

A card description such as “knows the family secret” is not evidence that the NPC was authorized to receive that secret. A note saying “is the heir” does not create canonical kinship. A correction to an authoring note must not retroactively change a committed event.

## 3. Author edits, corrections, and in-world change

### 3.1 Authoring intent is explicit

An authoring operation should identify whether the author is:
- defining stable profile guidance;
- setting authorized initial/imported state;
- correcting an erroneous author-entered record;
- requesting a future in-world event or outcome;
- annotating a record for editorial use without changing simulation state.

These are different intents. A generic text edit must not silently choose among them.

### 3.2 Corrections do not rewrite history by implication

A correction may amend an incorrect editable profile/configuration field through the eventual authorized editor boundary. It must not silently rewrite:
- already committed events or their prior payloads;
- dialogue or actions already presented as having occurred;
- canonical consequences;
- another subject's acquisition history or belief;
- the historical version of a social identity used in an earlier scene.

If an author wants the world itself to change, that is a separate explicit world-state/event operation through the core's supported path. If the author wants an NPC to learn a correction, that requires a valid acquisition/delivery path; editing canonical truth alone is insufficient.

### 3.3 Corrections need traceable scope

A future editor or command should make clear what target is being corrected and which category of state it affects. The implementation may reuse the existing core audit/history mechanism, but this document does not prescribe an API, revision counter, or storage structure. If the target or authority cannot be resolved, the edit must be rejected or sent for review rather than applied to a guessed entity or state category.

## 4. Unknown, neutral, absent, and withheld

These outcomes are not interchangeable:

- **Unknown/unset:** no supported value is established in the relevant record.
- **Explicit neutral:** a real value chosen by an authorized source, and only meaningful where the World Pack or domain contract defines neutral for that field.
- **Known absent:** trusted, complete evidence establishes that a value or item is absent within a declared scope.
- **Withheld:** the information exists or may exist but is not authorized for this reader/purpose.
- **Incomplete:** the read cannot establish the whole required result.
- **Unsupported/unavailable:** the requested field or operation has no implemented evidence/contract at this boundary.
- **Conflicted/disputed:** supported records disagree, or the subject explicitly disputes a proposition.

Do not convert missing values to neutral, withheld values to false, incomplete reads to known absence, or unsupported features to plausible-looking defaults. An unset relationship dimension does not mean indifference; lack of a card entry does not mean a character has no history or relationship.

## 5. Decision-input requirements

The decision layer should receive a bounded context adequate for the specific decision, not a full character dossier by default. The domain requirements are:

- include only facts, relationship dimensions, goals, constraints, resources, and prior commitments relevant to the current decision;
- preserve the distinction between established information, rumor, inference, hypothesis, belief, and canonical truth;
- carry uncertainty/completeness status when it could change the decision;
- do not present profile prose, summaries, retrieval results, or narrative claims as proof of acquisition or delivery;
- do not expose author-reserved secrets or unauthorized records before model input;
- do not invent values to complete a schema or make the context look tidy;
- keep the exact source/snapshot binding and authorization responsibility in the core-owned integration contract, not in this domain document.

If a missing field is decision-critical, the result is review/deferral or another supported safe path—not an invented default. If it is not decision-critical, the NPC may proceed based on the available information and its own uncertainty, subject to established rules and risk.

## 6. Character-card summary requirements

A future character-card projection should be useful without pretending to be complete or canonical in its own right.

### 6.1 Summary content

Where the underlying source records exist and the reader is authorized, a card may summarize:
- stable traits, values, habits, capabilities, and explicit boundaries;
- current goals or commitments, marked as current and time-sensitive where appropriate;
- relationship dimensions separately rather than flattening them to one score;
- significant acquired information or beliefs only when supported by subject-relative records;
- relevant uncertainty, contradiction, or unresolved status;
- social identities and their active/inactive status, with the underlying character link kept explicit.

### 6.2 Summary exclusions and safeguards

A card must not:
- invent missing biography, relationships, credentials, documents, motives, or knowledge;
- turn author notes into public in-world facts;
- treat a cover identity as a second NPC or infer canonical documents from claimed credentials;
- disclose author-reserved secrets to an unauthorized reader;
- present a derived relationship summary as a substitute for directional, multidimensional relationship state;
- erase uncertainty because a compact card has limited space;
- treat an omitted item as proof of nonexistence or lack of knowledge.

If a compact view cannot represent an important distinction, it should omit the unsafe detail or mark the summary as incomplete rather than collapse materially different states.

### 6.3 Summary freshness

A generated summary is a view over source records. When source records change, the projection must be refreshed or marked stale using the approved source-versioning mechanism. This document does not create a separate card revision counter. A stale summary must not outrank the underlying current records.

## 7. Author-reserved information and editorial notes

The author may reserve a secret or retain private editorial notes. These controls must be explicit and distinct from ordinary secrecy in the fictional world:

- ordinary in-world secrecy governs what fictional actors can know or disclose through valid channels;
- author-reserved secrecy constrains what the autonomous system may reveal or decide, including through model context and summaries;
- editorial notes may guide authoring but do not automatically become facts known to any character.

The future implementation must identify a real pre-model filtering boundary and fail closed if reservation policy cannot be resolved. This document does not implement that filter and does not permit a prompt-only substitute.

## 8. Semantic acceptance cases

These cases are requirements, not executable-test claims. Test the actual production boundary when it exists; do not use a mock to claim that persistence, authorization, or event history works.

### NPC-AUTH-001 — Profile correction does not rewrite canon

**Given** an author corrects an editable profile note that conflicts with a previously committed event.

**When** the correction is applied through an authorized profile-edit boundary.

**Then**
- the editable profile/configuration is corrected within its declared scope;
- the committed event and its consequences remain historical facts unless a separate supported correction/rollback operation is explicitly invoked;
- the system does not silently rewrite past dialogue or other characters' knowledge.

### NPC-AUTH-002 — Canonical correction does not teach every NPC

**Given** a canonical proposition is corrected or invalidated.

**When** NPC context is prepared.

**Then**
- no NPC is assumed to have learned the correction merely because canonical state changed;
- prior acquisition history is retained or reconciled according to its own source validity;
- belief revision requires a supported subject-relative update/evidence path.

### NPC-AUTH-003 — Unknown is not neutral

**Given** a relationship dimension, trait, or other optional field has no supported value.

**When** the decision layer or card projection reads it.

**Then**
- it remains unknown/unset;
- no neutral, negative, positive, or default value is invented;
- any domain-specific neutral value is used only when explicitly represented and permitted by the relevant contract.

### NPC-AUTH-004 — Withheld is not known absent

**Given** a value is withheld from a particular actor or purpose.

**When** the decision context is assembled.

**Then**
- the value itself is not exposed;
- the result does not claim the value is absent or false;
- the access/completeness status remains distinct without leaking the secret through diagnostics.

### NPC-AUTH-005 — Card summary is not a source of truth

**Given** a card summary disagrees with current canonical or subject-relative source records.

**When** a consumer requests the underlying state.

**Then**
- the authorized current source records outrank the summary;
- the summary is refreshed or marked stale through the approved mechanism;
- the system does not mutate canonical state merely to match the card.

### NPC-AUTH-006 — Missing card entry does not imply nonexistence

**Given** a card does not show a relationship, document, event, or item of knowledge.

**When** a consumer interprets the card.

**Then**
- omission alone proves neither absence nor lack of knowledge;
- a complete authorized source read is required to establish known absence;
- an incomplete or withheld view remains incomplete or withheld.

### NPC-AUTH-007 — Reserved editorial secret stays outside model input

**Given** an author-reserved secret is present in an editable note, retrieved result, or source record.

**When** a decision context or card summary is prepared for an unauthorized purpose.

**Then**
- the secret is excluded before model serialization;
- it is not reproduced in diagnostics or fallback output;
- inability to prove the filter's authorization result blocks the unsafe output.

### NPC-AUTH-008 — Author target is not a committed event

**Given** the author requests a mandatory future outcome.

**When** the system cannot yet establish a supported causal path.

**Then**
- the required outcome remains explicit and is not silently cancelled;
- missing rationale or causal steps remain prospective or under review;
- no invented past event is presented as canon and no world event is committed merely because it was requested.

### NPC-AUTH-009 — Social identity claim is not canonical evidence

**Given** a cover profile claims a name, age, relative, credential, or document.

**When** the identity is selected or summarized.

**Then**
- the claim remains a claim unless supported by a separate canonical/evidence record;
- the identity does not create a second NPC, family relation, or document by implication;
- observer suspicion/exposure depends on valid evidence and circumstances, not the mere existence of the editor entry.

### NPC-AUTH-010 — Compact summary preserves material uncertainty

**Given** the underlying source records contain a conflict, uncertainty, or incomplete read.

**When** a short card summary is produced.

**Then**
- the summary preserves the material uncertainty or omits the unsafe claim;
- it does not collapse disputed, unknown, withheld, and known-false into one label;
- compression does not grant new access or create new knowledge.

## 9. Implementation gates and non-goals

This contract does not authorize:
- a new NPC-local truth, memory, relationship, authorization, or event store;
- direct database edits that bypass the canonical commit/audit path;
- new public APIs, tables, migrations, or schema fields;
- raw snapshot or full-profile output to the model;
- claims that a card/editor/runtime capability exists merely because its semantics are specified;
- tests that mock absent production behavior and report an integration pass.

Safe work in the NPC branch can refine semantic cases, source mappings, review checklists, and documentation consistency. Runtime work must wait for the relevant core-owned authoring, actor-relative access, projection, and history boundaries to be verified.

## 10. Cross-document mapping

- Normative subsystem rules: `docs/31-npc-subsystem-contract.md`
- Consolidated author choices: `docs/38-npc-author-decisions-and-semantic-delta.md`
- Social identity editing/lifecycle: `docs/40-npc-social-identities-editor-contract.md`
- Relationship state and card projection: `docs/42-npc-relationship-state-contract-proposal.md`
- Relationship core integration gates: `docs/43-npc-relationship-core-integration-decision.md`
- Relationship semantic cases: `docs/44-npc-relationship-semantic-acceptance.md`
- Existing test-boundary map: `docs/35-npc-test-boundary-map.md`
- Core knowledge/acquisition and pre-model filter gate: `docs/39-npc-core-knowledge-contract-proposal.md`

No runtime tests were run for this document. It records semantic requirements and does not establish implementation readiness.
