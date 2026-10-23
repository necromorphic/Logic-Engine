# NPC Social Identities — Editor Contract Proposal

Status: author-requested semantic/editor proposal on `feat/npc-subsystem`. Documentation only. This does not approve a final character-card schema, UI, API, persistence model, or runtime behavior.

## 1. Purpose

Add an optional editor capability for defining one or more **social identities** used by the same underlying character: cover identities, aliases with separate claimed biographies, false identities, assumed names, double-agent covers, and similar public-facing representations.

A social identity is a way one character presents themself to other people. It is **not** a separate psychological personality and does not automatically create another in-world entity/NPC. The feature is world-agnostic and optional; ordinary characters need no extra identity records.

The editor should support shallow entries for simple aliases and detailed entries for complex covers. No field is globally mandatory merely because the feature exists.

## 2. Identity model and invariant

Keep these concepts distinct:

- **Underlying character/entity:** the canonical person who owns the social identity.
- **Primary identity/profile:** the character's default authored identity and stable profile.
- **Social identity:** a named representation that the underlying character may present in specified contexts.
- **Claimed persona data:** name, age, history, origin, relatives, occupation, affiliation, and other statements made under that identity.
- **Canonical world facts:** what is actually true in the simulated world.
- **Audience-specific knowledge and belief:** what each other character has learned, suspects, or believes about the identity and its connection to the underlying character.

A social identity must link to the same underlying character through an explicit authored relationship. Similar names, shared appearance, or matching biographies must not automatically merge entities. Conversely, creating a cover identity must not create a separate person, sibling, spouse, history, inventory, relationship graph, or independent NPC unless the author separately creates those as real world entities.

The identity record is authored configuration/profile data, not by itself a canonical event, proof of document issuance, or evidence that any other character knows about it.

## 3. Optional editor sections

Each social identity may contain any relevant subset of these fields. Empty or absent fields remain unknown/unprovided; the engine must not fill them by invention.

### 3.1 Display and claimed identity
- Display name, family name, aliases, pronunciation or presentation notes.
- Claimed age/date of birth, occupation, origin, affiliation, or other declared attributes.
- Intended contexts, audience, and whether this identity is currently available/active, if the future editor/runtime supports such controls.
- Author notes about how the character introduces or refers to themself.

### 3.2 Claimed biography and social links
- Claimed history, education, residence, employment, origin, and life events.
- Claimed relatives, contacts, memberships, or relationships.
- For each important claim, optional status/notes identifying whether it is true, false, partly true, fabricated, borrowed from a real person, unverified, or deliberately left undecided.
- Explicit references to any actual world entity or event that supports the claim, where such references already exist.

Claimed relationships are not canonical family/relationship edges. A claim that the character is someone's twin does not create a real twin. If a real person is impersonated, link to that person only through an explicit author-specified relationship; do not conflate the two entities.

### 3.3 Appearance differences and disguise
- Only differences from the underlying character's stable appearance: wig, hair styling, contact lenses, makeup, prosthetics, clothing, voice/presentation, posture, accessories, or other setting-appropriate disguise.
- Optional limits, failure conditions, detectability notes, and contexts where disguise is unavailable.
- If no difference is specified, inherit the underlying character's appearance.
- Disguise changes the presented appearance, not the underlying person's actual anatomy, abilities, limitations, or stable traits.

The feature must not require a visual disguise: a social identity may rely only on a name, claimed biography, forged records, or a changed social role.

### 3.4 Documents and supporting evidence
- Optional references to documents, credentials, registrations, photographs, recordings, witnesses, or other evidence.
- For each item, distinguish at minimum when applicable: author-declared to exist; proposed/needed; verified existing canonical item; forged/fabricated; missing; disputed; invalidated; or unknown.
- Record source/reference and known limitations when supported by existing core identity/provenance mechanisms.

A text note saying a document exists must not silently create a canonical document entity, official registration, event, or database record. The editor may record author intent, but existence/issuance/validity in the world must be established through the existing world configuration or approved core operation. If the current system cannot reference such evidence, mark it as an unresolved author declaration, not a verified document.

### 3.5 Basis and rationale
- Why this social identity exists and what it is intended to accomplish.
- Who created, supplied, or maintains it, if known.
- How the claimed biography and supporting evidence could plausibly have arisen.
- Known collaborators, costs, risks, dependencies, and reasons the cover may fail.
- Whether the identity is improvised, borrowed, inherited, fabricated, or based on a real person's identity.

Rationale explains the author's model; it does not automatically establish the stated history as canonical fact.

### 3.6 Weak points, contradictions, and free notes
- Missing records, inconsistencies, dates that do not line up, implausible claims, unverified details, exposed links to the underlying person, or other vulnerabilities.
- Free-form author notes for setting-specific requirements.

A recorded vulnerability is a possible basis for questions, investigation, or suspicion when discovered. It is not an automatic revelation or an automatic suspicion in every observer.

## 4. Inheritance and conflict rules

1. The underlying character remains the owner of stable physical traits, abilities, weaknesses, core characterization, and other shared properties.
2. A social identity overrides only the presentation/claimed fields explicitly defined for that identity.
3. Unspecified appearance differences inherit the underlying character's appearance.
4. Claimed biography, age, occupation, relatives, credentials, and public reputation remain claims until independently grounded as world facts.
5. Do not duplicate shared data into each identity as separately writable copies.
6. If the social identity contradicts the underlying profile, treat that as a potentially intentional cover claim or an explicit unresolved conflict according to its authored status; do not silently rewrite either side.
7. An identity can be inactive or unavailable in a particular scene without ceasing to exist as authored configuration, if the eventual model supports context availability.

## 5. Logic and NPC behavior

When an identity is used in a scene, the eventual NPC decision/context layer should be able to distinguish:
- the underlying canonical character;
- the currently presented social identity;
- claims made under that identity;
- evidence that exists and is available for inspection;
- evidence that is absent, invalid, inconsistent, or unverified;
- what the observer actually knows or has access to;
- what the observer merely suspects or believes.

A mismatch or missing document may prompt questions, a check, suspicion, rejection, or no consequence, depending on the setting rules, stakes, observer knowledge, available procedure, and opportunity to inspect. There is no universal automatic “cover detected” rule.

Contradictions do not automatically reveal the underlying identity. They create only the possibilities justified by the current scene and the observer's evidence. A character cannot act on a weakness they have not discovered or received through a valid information path.

The NPC layer may propose an investigation or consequence; canonical discoveries, document issuance, exposure, and other consequential world changes must use the core's approved state/event path. Do not turn editor metadata into an event that already happened.

## 6. Knowledge and disclosure boundary

Creating or editing a social identity:
- does not automatically tell any NPC or the player about it;
- does not grant observers access to its private editor fields;
- does not prove that a document was shown, received, read, or accepted;
- does not turn a claimed biography into canonical truth;
- does not create a knowledge record or delivery event.

Audience-specific knowledge and belief follow the core-owned knowledge/acquisition/delivery contract when implemented. Until then, the editor can store author-defined profile data, but runtime claims about who knows what remain deferred. The editor must not create its own knowledge store, delivery tracker, event journal, revision counter, or rollback mechanism.

Author-reserved secrets must remain excluded before model input according to the existing NPC contract.

## 7. Editor interaction requirements

The eventual character editor should:
- show the primary identity and an optional list of additional social identities;
- allow zero, one, or many entries;
- support add, rename, edit, duplicate-as-draft, and remove actions, subject to the editor's eventual persistence/confirmation design;
- present the sections above as optional/collapsible groups rather than one mandatory questionnaire;
- distinguish author-entered claims from references to verified world entities/documents;
- show unresolved contradictions and missing support without auto-correcting them;
- make inherited values visible as inherited/read-only until the author explicitly supplies an override;
- avoid presenting an identity as “verified” merely because the author filled its form;
- preserve one underlying character identity and avoid generating extra NPCs from extra social identities.

These are UI requirements for future design, not a claim that a character editor currently exists in the repository.

## 8. Integration and ownership boundaries

- **Character editor/profile layer:** captures authored social identity data and references. It does not create canonical world facts by implication.
- **Character-card projection:** should present identity data as a view over authoritative/authored records and preserve source/reference status; it must not become a second writable store for canonical fields.
- **Core:** owns canonical entities, world facts/events, validated document/registration existence, causal links, and rollback according to the existing architecture.
- **Knowledge/delivery contract:** owns authoritative acquisition/provenance/delivery records when implemented.
- **NPC reasoning/context preparation:** chooses the relevant presented identity and filters information for a particular actor/viewpoint using approved rules. It does not own persistent truth, access-control, or knowledge stores.
- **World Pack:** may define setting-specific identity/document procedures, what counts as plausible inspection, and consequences. Do not bake one genre's forgery rules into the universal editor.
- **Host/UI adapter:** may render and edit the authored profile but cannot bypass validated core operations.

The existing character-card planning document (`docs/23-character-and-control-architecture.md`) describes cards as structured views over canonical records and leaves final card fields/UI open. This proposal extends that planned profile model; it does not assert that a character editor or social-identity implementation currently exists.

## 9. Suggested semantic acceptance scenarios

- **NPC-SID-001 — Optionality:** an ordinary character with no additional social identity remains valid and needs no placeholder identity.
- **NPC-SID-002 — Same underlying character:** adding a cover does not create another NPC/entity, independent life history, or duplicate writable copy of shared traits.
- **NPC-SID-003 — Claim is not truth:** a claimed age, biography, relative, or job does not become canonical solely because it is entered in the editor.
- **NPC-SID-004 — No implicit document creation:** declaring a credential in a profile does not create an issued/valid canonical document.
- **NPC-SID-005 — Appearance inheritance:** absent disguise differences, the identity inherits the primary appearance; explicit differences affect presentation only.
- **NPC-SID-006 — No automatic disclosure:** creating or activating a social identity does not make other characters aware of it.
- **NPC-SID-007 — No automatic exposure:** an inconsistency or missing document creates a possible situational risk, not automatic discovery of the underlying identity.
- **NPC-SID-008 — Observer-relative suspicion:** suspicion depends on evidence available to that observer and the applicable world procedure; inaccessible private editor notes cannot be used.
- **NPC-SID-009 — Unknown stays unknown:** unfilled fields and unsupported document references remain unknown/unverified and are never filled with invented details.
- **NPC-SID-010 — Real person remains distinct:** impersonating a real person does not merge the impersonator with that person or create fictional relatives by implication.
- **NPC-SID-011 — No psychological-personality conflation:** multiple social identities remain representations of one character, not separate psychological personalities.
- **NPC-SID-012 — Core integration:** canonical exposure, registration, document creation, or discovery must pass through the existing core validation/event path; editor changes alone are authored configuration, not in-world events.

These are requirements for future tests, not evidence of runtime support. Each executable test must call a real production boundary; do not simulate absent editor, identity, knowledge, or document primitives with a mock that merely repeats the intended behavior.

## 10. Deferred decisions

Before implementation, confirm:
1. How the existing character identity/profile projection will represent the link from a social identity to one underlying character.
2. Which profile fields are author configuration versus canonical world references in the current card contract.
3. How the editor distinguishes an author-declared document from an existing verified world entity.
4. Whether and how a social identity can be activated/deactivated in runtime, and which rules determine its use in a particular scene.
5. Which World Pack procedures govern checks, document verification, disguise detection, and consequences.
6. How actor-relative knowledge/access will eventually determine what observers know about the identity.
7. Which actual editor UI, persistence API, and test boundaries exist; do not assume they exist based on this proposal.

Until these are answered, keep the work documentation-only. Do not change runtime, public API, schemas, SQLite, vectorization, prompts, SillyTavern, or core state semantics.
