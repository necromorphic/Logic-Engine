# Personality Block — World Pack Relationship Dimension Template

Status: schema-neutral authoring template. This document defines what a World Pack author must specify before a relationship dimension is treated as supported. It does not define universal relationship dimensions, a wire format, a database schema, or a runtime API.

## 1. Purpose and authority

A relationship dimension describes one specific aspect of entity A's relation toward entity B. The World Pack owns the domain meaning and allowed value/transition rules. The Personality block owns the semantic requirements in this template. The core owns canonical identity, authorization, atomic commits, event/revision/audit lifecycle, safe reads, and projection rebuild.

A World Pack may support different dimensions from another World Pack. An omitted dimension is not implicitly supported. A familiar label such as `trust`, `attraction`, `fear`, `loyalty`, or `respect` is only an illustrative name until the active World Pack defines it.

## 2. Required definition for each dimension

Complete every field below for each supported dimension.

| Field | Required definition |
|---|---|
| Stable identifier | Unique, stable identifier within the World Pack; renaming/migration policy if it changes. |
| Display name | Human-readable name; not used as an identity key. |
| Meaning | Precisely what the dimension represents and what it explicitly does not represent. |
| Subject and target | Confirm direction: A's relation toward B. State whether self-relations are meaningful; default is unsupported. |
| Value domain | Enumerated values or bounded scale, including endpoints and interpretation. Do not rely on an unspoken universal scale. |
| Neutral value | If one exists, its exact meaning. Neutral is an explicit value, not the same as unknown/unset. If there is no neutral value, say so. |
| Initial-state rules | Which values may be authored/imported initially and any constraints. |
| Transition rules | Allowed transitions, preconditions, and transitions that must be rejected. If arbitrary changes are allowed, say so explicitly. |
| Update semantics | Whether partial updates are meaningful; omitted dimensions must remain unchanged. Define whether the dimension can be explicitly cleared. |
| Non-implications | Facts that this dimension must never imply by itself (for example knowledge, consent, reciprocity, obligation, or truth of a claim). List only those relevant to the dimension. |
| Evidence and provenance | Which domain events/evidence can support a change; what attribution is needed. Do not confuse value semantics with causal support. |
| Conflict policy | What to do if valid inputs conflict or evidence is insufficient: retain conflict/unknown, apply a declared precedence rule, or request author resolution. Never invent a resolution. |
| Decision use | How the dimension may influence NPC interpretation or candidate actions, and what it cannot authorize. |
| Read visibility | Any World Pack-specific sensitivity/visibility constraints for core authorization to enforce. This field supplements rather than replaces core authorization. |
| Rollback expectations | Whether the current value is replay-reconstructible from surviving typed transitions. If not, document the unresolved need; do not claim independent-support handling exists. |
| Examples | At least one valid transition, one invalid transition, one partial update, and one case where the dimension does not imply a related fact. |
| Acceptance cases | Stable test IDs and expected outcomes for valid, invalid, unknown/neutral/clear, conflict, and rollback cases where applicable. |

## 3. State distinctions every dimension must preserve

These concepts must not be collapsed into one value:

- **Unset/unknown:** no canonical value has been established.
- **Explicit neutral:** the domain intentionally assigns its defined neutral value.
- **Withheld/inaccessible:** the read boundary does not disclose the canonical value to this caller. This does not reveal whether a value exists.
- **Cleared:** an authorized operation explicitly removes a previously established value, where clearing is supported by the domain and approved operation contract.
- **Conflict/insufficient support:** available valid evidence does not yield one justified result under the domain rules.

The first four are not interchangeable. Conflict is an epistemic/reconciliation result, not a convenient extra relationship value unless the domain explicitly models it as such. The exact wire/storage representation remains a core contract decision.

## 4. Cross-dimension rules

For each dimension, authors must explicitly declare any permitted cross-dimension rule. Absence of a rule means no automatic cross-dimension mutation or inference.

A change to dimension X must not silently change dimension Y. In particular, labels associated with affection, attraction, trust, consent, knowledge, obligation, loyalty, or reciprocity must not be treated as synonyms. If a world intentionally links them, define the rule as a separate, testable domain rule with preconditions, provenance, direction, and rollback behavior.

Cross-dimension rules must state:
1. triggering event and source dimension;
2. target dimension and exact transition;
3. required preconditions and authorized actor;
4. whether the target transition is deterministic or only a candidate interpretation;
5. causal dependency and rollback behavior;
6. behavior on conflicts or unsupported target values.

Do not encode a cross-dimension implication as an undocumented natural-language assumption.

## 5. Transition policy worksheet

For every permitted transition or transition family, record:

- source state (including whether unset is possible);
- requested target state;
- triggering event/evidence;
- required preconditions;
- who/what is authorized to request it;
- whether it is a canonical transition or only a narrative inference;
- provenance expected on the committed event;
- rejection behavior when validation fails;
- effect of rollback on the current projection;
- acceptance-test identifier.

A rejected transition must not partially mutate canonical state. A narrative sentence, co-presence, a model-generated interpretation, or a character-card edit is not by itself a canonical transition.

## 6. Minimal authoring checklist

A dimension is **not ready for runtime use** until:
- [ ] its meaning and non-implications are explicit;
- [ ] its value domain and neutral/unset distinction are explicit;
- [ ] valid and invalid transitions are specified;
- [ ] partial update and clear behavior are specified;
- [ ] cross-dimension rules are explicit or expressly absent;
- [ ] provenance and conflict handling are specified;
- [ ] decision-use and visibility constraints are documented;
- [ ] rollback/replay assumptions are declared;
- [ ] acceptance cases are written.

This checklist establishes semantic readiness only. It does not prove that the core write, read, audit, authorization, or rollback paths implement the contract.

## 7. Unresolved core dependencies

World Pack authors must not invent the core's exact payload/API, storage encoding, revision behavior, event shape, authorized-read interface, or author-operation permission mechanism. These remain governed by the core integration gates in [03-core-decision-and-integration-gates.md](./03-core-decision-and-integration-gates.md). A World Pack can define the intended semantics while clearly marking runtime integration as blocked.
