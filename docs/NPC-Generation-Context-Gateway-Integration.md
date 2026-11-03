# NPC Generation Context — Gateway Candidate Integration

Status: integrated Core-side candidate; protected model dispatch remains disabled.

## Context construction

The Core Memory NPC adapter exposes `npcGenerationContext` only when the deployment has configured both synchronous Core NPC read and per-acquisition visibility authorizers. The runtime resolves World, Actor, conversation, adapter, purpose and snapshot from the branded authenticated Host session and active Core bindings. Request metadata supplies correlation identifiers only.

## Lane separation

- Lane A: complete Core knowledge-acquisition read, independently filtered by per-acquisition visibility authorization.
- Lane B: MemoryNpcConsumer result, retaining Core purpose `npc_turn_context`, Provider purpose `npc_decision`, admission, grants and canonical source-version lineage. It also retains the Provider's complete-result cursor (`data_version` + `candidate_digest`) through immutable context, revalidation and `HostBridge.consume()` as `laneB.provider_evidence_cursor`.
- The Builder freezes copied data and keeps both lanes separate. Memory evidence is not promoted to canonical truth.

## Handoff

The Builder/Receiver issues a private, one-shot, object-identity handoff. The Host bridge binds it to the exact Host request and response objects in WeakMaps. Preparation returns no context payload. Dispatch consumption is synchronous and one-shot; JSON/HTTP serialization, cloning, replay and cross-request reuse are rejected.

## Remaining Gateway contract

The Gateway must consume the handoff, pass `laneB.provider_evidence_cursor` unchanged as `providerEvidenceCursor` to its Provider reader, and, while holding the shared Coordinator/revocation-ordering boundary, synchronously compare the live Provider cursor and revalidate grants/source versions:
1. revalidate Lane A acquisition visibility;
2. independently validate Lane B admission, Provider grants, index/reconciliation state and source versions;
3. bind both purpose namespaces separately;
4. durably record DISPATCH_STARTED before synchronously starting transport;
5. suppress the first response write unless final Core response revalidation succeeds.

This PR does not implement those Gateway operations and does not enable Memory → NPC. The existing Gateway remains fail-closed.