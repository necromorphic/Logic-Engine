# Event type taxonomy and trust contract

Status: adopted contract for Core 1.x.

## 1. Taxonomy is intentionally open

The canonical event_type field is a required, bounded string, not a Core-owned allowlist. World Packs and domain integrations may use their own event names. The Core does not reserve a namespace merely by string prefix.

This preserves extensibility for worlds whose event vocabulary is not known to the engine. A future versioned allowlist or namespace policy would be a separate compatibility change, not an implicit tightening of this contract.

## 2. Event type is not authority

**No caller or consumer may grant permission, approval, privileged execution, or trust solely because of event_type.**

Authorization is established by the relevant route and credential boundary; proposal commits require the approval lifecycle and internal commit credential. Admin-only registry and relationship operations keep their own route-level gates. A string such as a system-looking or admin-looking event type cannot bypass those gates.

The Core may use event_type as one input to structural validation where the existing contract explicitly requires it (for example, the current allowed event types for a positive time advance). That does not make the string a credential or provenance proof.

## 3. Consumer requirements

- Treat event_type as descriptive domain metadata unless a versioned consumer contract says otherwise.
- If a consumer needs to distinguish Core-generated, adapter-generated, author-approved, or externally asserted events, inspect authenticated provenance and the canonical operation/approval history; do not infer it from the name.
- Do not execute privileged side effects or reveal protected state because an event uses a reserved-looking prefix.
- Keep effect validation and operation-specific authorization separate from the event name.
- Domain namespaces are recommended for clarity (for example, world-specific prefixes), but are conventions rather than security boundaries.

## 4. Verification

The API test suite verifies that a caller with only the general bearer cannot directly commit an event by choosing a custom event_type; the route still rejects direct commit without the separate internal credential. Core tests verify that an authorized canonical commit can retain a domain-specific event type. Unknown event names remain compatible by design.
