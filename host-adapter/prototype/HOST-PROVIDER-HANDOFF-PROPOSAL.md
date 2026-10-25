# Host → Memory Provider handoff proposal (not an approved contract)

Status: proposal for owner review only. No Provider/Core API, schema, source-authority policy, or production handoff is created by this document.

Related: [#258 Host lifecycle](https://github.com/necromorphic/Logic-Engine/issues/258), [#264 shared Host → Provider gate](https://github.com/necromorphic/Logic-Engine/issues/264), [pinned-source audit](./SOURCE-LIFECYCLE-AUDIT.md).

## 1. Current facts versus proposals

| Concern | Confirmed Host/source fact | Host prototype implementation | Proposed next step / owner |
|---|---|---|---|
| Host source | Pinned ST revision is 06bde939fb1e9c4c8d8641d810f0a916b5bce127. | Patch artifact apply-checks against this exact source in CI. | Host owns pin and source-level hook proof; Core/Provider must reject unknown host revision. |
| Native identity | ST message indexes and swipe_id are mutable; alternatives are represented by swipes / swipe_info. | Enrollment-forward random message/version IDs and content digests; active swipe tracked separately. | Provider must not treat an index or timestamp as durable identity. Owners must agree how IDs survive copy/import/restore. |
| Event identity | ST does not supply a durable event ID for the lifecycle callbacks used here. | Journal creates random event IDs; identical event-ID/payload replay is idempotent; conflicting reuse fails closed. | Provider must confirm how it deduplicates a Host retry versus a new Host event. No shared event-ID contract exists yet. |
| Content | The sidecar journal deliberately does not store raw message text. ST holds current text/swipe content. | Digests are journaled; the bridge reads native content for fingerprint/version checks. | A Provider read/write operation must be explicitly agreed before any content transfer. Digest-only journal rows are not enough to reconstruct message text. |
| Persistence | Some ST paths await a save; others use debounced save. | Host candidate has a strict IndexedDB journal transaction, but native ST persistence is a separate transaction. | Provider must not infer native chat persistence from journal append or vice versa. Need failure semantics agreed across the boundary. |
| Deletes | ST exposes mutation paths and a MESSAGE_DELETED event with index semantics; that event alone does not preserve the deleted version. | Pre-delete journal records affected version identities for hooked delete paths. | Provider must define whether delete is a tombstone/revocation, how historical versions remain addressable, and how missing delete events are detected. |
| Restore/import/copy | These can occur outside the currently hooked in-memory mutation paths. | No complete coverage yet; fingerprint and identity snapshot comparison detects some divergences when reconciliation runs. | Provider/Core must require reconciliation before using restored/copied data and define collision handling. |
| Authority/access | Host observation is not proof of authorization, admission, acquisition, belief, rendering, delivery, or receipt. | No authorization grant is issued by this prototype. | Provider owns persistence/authority policy; Core owns authorization/admission decision according to the agreed contract; NPC remains disabled until proven. |
| Completeness | The prototype is enrollment-forward only; pre-enrollment deleted history is UNKNOWN_UNRECOVERABLE. | Readiness remains NON_READY while required lifecycle paths are missing. | Provider/Core must reject a claimed complete inventory unless the source attestation, lineage, version inventory, revocation and reconciliation gates are independently proven. |

## 2. Candidate conceptual handoff stages (not API names)

1. **Observe:** Host observes a pinned-source event or a reconciled native snapshot. Record whether it is a pre-mutation observation, post-mutation observation, or startup reconciliation.
2. **Identify:** associate the observation with a Host instance, conversation/source, logical message, version, and event/replay identity. These are semantic requirements, not approved schema fields.
3. **Verify:** compare the native-source fingerprint and sidecar identity/version snapshot to the journal checkpoint. Any mismatch, missing journal, unknown hook path, duplicate ID, or digest conflict yields NON_READY.
4. **Transfer candidate:** only after owners approve a concrete Provider operation and content representation. Do not send a digest-only record as if it were message content.
5. **Provider persistence acknowledgement:** Provider must return its own documented persistence/result evidence. A Host-side append is not that acknowledgement.
6. **Core authorization/admission:** Core must independently validate the exact Provider result and authority/lineage/version state before any NPC context can consume it.
7. **Reconcile/revoke:** a missed event, deletion, restore, changed source fingerprint, or access revocation must invalidate readiness until Provider and Core reconcile the affected lineage. No automatic fallback to stale data.

## 3. Required failure semantics

- **Duplicate same event and same payload:** idempotent retry; no second logical version or duplicate admission.
- **Same event ID, different payload:** explicit conflict; stop and retain evidence. Never choose one payload silently.
- **Same logical/version identity, different content digest:** conflict and NON_READY; do not overwrite.
- **Missing delete or version history:** inventory is incomplete; do not infer that the item still exists or that the delete never happened.
- **Restored older snapshot / copied metadata:** compare against the journaled identity snapshot and native fingerprint. If either disagrees, stop until reconciliation. Exact same native content alone does not prove identity lineage.
- **Provider write succeeded but acknowledgement was lost:** retry using an agreed idempotency key and retrieve the existing result; never create a second fact by guessing.
- **Access revoked after capture:** Provider/Core must recheck authorization at read/admission and at the final disclosure boundary. Host capture is not permission to disclose.
- **Unknown event, unsupported host version, or uncovered mutation path:** NON_READY; no production handoff.

## 4. Questions that must be answered by owners before implementation

### Memory Provider owner
- Which existing Provider operation is the supported write/read path for a Host-originated message/version observation?
- Which existing persisted fields can carry provenance, host/source identity, version lineage, deletion/revocation and idempotency evidence? Cite exact code and schema; do not add new fields by assumption.
- How does Provider report duplicate replay, identity conflict, missing version, deletion, restore and access revocation?
- What exact acknowledgement proves Provider persistence, and how is it read back after restart?
- Can Provider expose an authoritative inventory that includes active and historical/deleted versions, or must the Host remain NON_READY?

### Core owner
- Which existing Core read/admission gate validates Provider lineage and authority before context inclusion?
- Which exact revision/snapshot and revocation evidence must be checked immediately before serializer/transport?
- What result is returned for stale, revoked, conflicting, incomplete, or restored data?
- How is the final serializer → transport race closed without treating rendering/delivery as acquisition or belief?

## 5. Current disposition

**No handoff is wired. No shared API/schema is approved. Production Memory→NPC remains DISABLED / FAIL-CLOSED.**

The current Host PR proves only code-level journal behavior and exact pinned-source patch checks in CI. It does not prove real Android/Termux IndexedDB durability, all-time inventory, all mutation paths, Provider persistence, Core admission, or final disclosure safety. The next cross-block step is a code-mapped method-call matrix from Provider and an explicit Core acceptance of the proposed semantic boundary before any production handoff code is added.
