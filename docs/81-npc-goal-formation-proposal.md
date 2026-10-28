# NPC Goal Formation — Isolated Capability Proposal

**Status:** proposal for owner review; no runtime contract or implementation authorized.  
**Owner:** NPC block.  
**Purpose:** define the smallest safe next step after the merged NPC intention selector, goal lifecycle and plan-progress helpers.

## 1. Current gap

The existing NPC helpers can select an intention from caller-supplied active goals and eligible action candidates, validate caller-proposed goal transitions, and advance a supplied ordered plan. They do not create goals.

The current autonomy inventory identifies no verified interface that joins:
- authorized, decision-relevant personality traits or motives;
- relationship information permitted for this NPC and decision;
- current world facts and applicable rule results;
- existing NPC-local goals and their lifecycle;
- an authoritative decision about which goal categories are admissible.

Therefore a goal generator that reads these sources directly would have to invent an interface or trust boundary. This proposal does not do that.

## 2. Proposed responsibility split

- **Personality owner:** defines the meaning and authority of stable traits, motives and temporary character state. NPC must not reinterpret missing profile data as an absent motive.
- **Relationships owner:** defines relationship semantics and provides only fields permitted by an approved actor-specific read contract. NPC must not maintain a competing canonical relationship store.
- **Core / mechanic owner:** owns canonical world facts, applicable rules, snapshot/revision semantics, actor binding, and supported causal checks. A model-generated claim is not a world fact or a successful precondition check.
- **NPC:** proposes a bounded set of goal candidates from inputs explicitly supplied for the current decision; ranks or defers them; preserves uncertainty; and does not commit world effects.
- **Trusted caller:** must be identified by the owners and must bind the acting NPC, decision purpose and a consistent permitted input snapshot. This caller is currently **UNCONFIRMED**.
- **Core proposal/commit path:** remains responsible for validating and applying supported world effects. Goal creation in NPC-local state must not be represented as a canonical world event unless an approved persistence contract says so.

This is a responsibility proposal, not a JSON schema, API, storage design, or approval to add cross-block interfaces.

## 3. First vertical slice proposed for review

Keep the first slice deliberately narrow:

1. Accept only an explicit, bounded decision input prepared by a trusted caller.
2. Accept existing NPC-local goals as input so that new proposals can be compared with active, blocked, completed and abandoned goals.
3. Allow the NPC to return one of: `goal_proposed`, `no_goal`, or `needs_review`.
4. Every proposed goal must state its motivation/reference inputs, required world conditions, assumptions, and unresolved dependencies using only identifiers/fields approved by their owners.
5. Unknown, incomplete, inaccessible, contradictory, or unsupported inputs must not be silently converted into negative facts or filled by model invention.
6. A proposal must not automatically become an active persisted goal, execute an action, change canonical world state, grant knowledge, or alter relationships.
7. If an existing goal already expresses the same intent, the caller must not create a duplicate. Exact identity/idempotency semantics are **UNCONFIRMED** and require an owner decision before persistence is designed.

The actual input/output field names and allowed goal vocabulary are intentionally not specified until the owners identify approved source contracts.

## 4. Required decisions before implementation

### A — Goal inputs and admissibility
- Which existing Personality contract supplies stable traits and motives to a particular NPC decision?
- Which Relationships read contract supplies actor-permitted relationship facts, and how is completeness represented?
- Which Core read/mechanic contract supplies current world facts and rule/precondition results at one consistent snapshot?
- Who owns the allowed goal categories and the authoritative rule for whether a proposed goal is admissible?
- Which source references and revision/snapshot markers must accompany each input?

### B — NPC-local state and duplicate goals
- Is there an existing authoritative NPC-local goal store or only caller-supplied transient values?
- Who owns persistence, stable goal identity, duplicate detection, cancellation and restart recovery?
- Until approved, should goal proposals remain transient and non-committing? **Proposed default: yes.**

### C — First supported goal family
Select one goal family whose inputs and admissibility rules already exist and can be tested. Do not claim general motive-driven autonomy until the selected family is verified. If no family has an approved source path, implementation remains blocked pending that decision.

## 5. Acceptance tests for a later implementation

Once the required owners approve the contracts, tests should prove:

- complete permitted inputs can produce a bounded proposal without mutating inputs or canonical state;
- missing, inaccessible, incomplete and contradictory inputs remain distinct and fail closed where required;
- model-generated rationale cannot certify source authority, world truth, or precondition success;
- a proposal cannot become an active/persisted goal without the approved caller and lifecycle path;
- duplicate goal intent is handled only under approved identity semantics;
- existing terminal goals are not silently reopened;
- unsupported goal categories and unknown enum values return `needs_review` or the approved generic non-ready result;
- deterministic outcomes for identical approved inputs;
- no Memory retrieval candidate becomes NPC knowledge through this path.

No test can claim an end-to-end path until the real owner-approved input and persistence/execution paths are exercised.

## 6. Explicit exclusions

This proposal does not implement or authorize:
- Personality, Relationships, Core, Memory Provider, Host/Adapter or shared-schema changes;
- a new public API, storage table, queue, scheduler, worker, process type or cross-store transaction;
- automatic Memory → NPC;
- action execution or canonical world mutation by NPC code;
- wall-clock-driven off-screen autonomy;
- unrestricted goal generation from arbitrary model text.

Production Memory → NPC remains **DISABLED / FAIL-CLOSED**.

## 7. Decision requested

Please identify the approved source contracts and owners for the four goal inputs (Personality, Relationships, Core world/rules, existing NPC goals), and select the first supported goal family. If these contracts do not exist, approve only the separate contract-definition work—not an implementation that guesses their shape.
