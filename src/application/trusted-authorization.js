import { EngineError } from '../core/errors.js';
import { ActorBindingService } from './actor-bindings.js';
import { AuthorizedReadService } from './authorized-read-service.js';
import { HostConversationWorldBindingService } from './host-conversation-world-bindings.js';
import {
  createProcessScopedMechanicPolicyAuthority,
  defaultMechanicPolicyFieldPolicy,
  isMechanicPolicyAuthority,
} from './mechanic-policy-authority.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validate a mechanic-policy provider against the exact Core-owned authority. */
export function createActiveMechanicPolicyValidator(getActiveMechanicContextProvider, policyAuthority = null) {
  if (typeof getActiveMechanicContextProvider !== 'function') {
    throw new TypeError('getActiveMechanicContextProvider must be a trusted application callback.');
  }
  return identity => {
    if (!isMechanicPolicyAuthority(policyAuthority)) return false;
    try {
      const provider = getActiveMechanicContextProvider();
      return provider?.getPolicyAuthority?.() === policyAuthority
        && provider?.validateMechanicPolicy?.(identity) === true;
    } catch {
      return false;
    }
  };
}

/**
 * The sole Core composition point for trusted authorization services.
 *
 * HTTP request data never supplies authorizers, world IDs or actor IDs. The
 * authenticated Host adapter plus stable conversation ID resolves a Core-owned
 * conversation/world binding, then a unique Core-owned actor binding.
 */
export function createCoreTrustedAuthorization({
  engine,
  policyAuthority = null,
  authorizedReadFieldPolicy = null,
  authorityId = 'logic-engine.default-visibility-policy',
  generation = 1,
  getActiveMechanicContextProvider = () => null,
} = {}) {
  if (!engine?.store?.db || typeof engine.getSnapshot !== 'function') {
    throw new TypeError('Core trusted authorization requires a persistent LogicEngine.');
  }
  if (policyAuthority !== null && authorizedReadFieldPolicy !== null) {
    throw new TypeError('Provide policyAuthority or authorizedReadFieldPolicy, not both.');
  }
  if (policyAuthority !== null && !isMechanicPolicyAuthority(policyAuthority)) {
    throw new TypeError('policyAuthority must be a trusted Core policy authority.');
  }
  if (authorizedReadFieldPolicy !== null && typeof authorizedReadFieldPolicy !== 'function') {
    throw new TypeError('authorizedReadFieldPolicy must be trusted application configuration.');
  }

  const actorBindings = new ActorBindingService(engine);
  const hostConversationBindings = new HostConversationWorldBindingService(engine);
  const trustedPolicyAuthority = policyAuthority || createProcessScopedMechanicPolicyAuthority({
    authorityId,
    generation,
    fieldPolicy: authorizedReadFieldPolicy || defaultMechanicPolicyFieldPolicy,
  });
  const authorizedReads = new AuthorizedReadService(engine, actorBindings, trustedPolicyAuthority);
  const validateMechanicPolicy = createActiveMechanicPolicyValidator(
    getActiveMechanicContextProvider,
    trustedPolicyAuthority,
  );

  function resolveHostScope(identity) {
    if (!isRecord(identity)
      || Object.keys(identity).some(key => key !== 'adapterId' && key !== 'conversationId')
      || typeof identity.adapterId !== 'string'
      || typeof identity.conversationId !== 'string') {
      throw new EngineError('HOST_IDENTITY_REQUIRED', 'Authenticated Host identity and conversation binding are required.', 403);
    }
    const conversation = hostConversationBindings.resolve({
      adapterId: identity.adapterId,
      conversationId: identity.conversationId,
    });
    const actor = actorBindings.resolveUnique(conversation.world_id, identity.adapterId);
    return Object.freeze({
      adapterId: identity.adapterId,
      conversationId: identity.conversationId,
      worldId: conversation.world_id,
      actorEntityId: actor.actor.entity_id,
    });
  }

  function readHostNpcContext(request) {
    if (!isRecord(request)
      || Object.keys(request).some(key => !['adapterId', 'conversationId', 'entityIds', 'fields'].includes(key))) {
      throw new EngineError('INVALID_AUTHORIZED_READ', 'Host authorized read contains unsupported fields.', 400);
    }
    const scope = resolveHostScope({
      adapterId: request.adapterId,
      conversationId: request.conversationId,
    });
    return authorizedReads.readEntityFields({
      worldId: scope.worldId,
      adapterId: scope.adapterId,
      actorEntityId: scope.actorEntityId,
      recipient: 'model',
      purpose: 'npc_decision',
      entityIds: request.entityIds === undefined ? [scope.actorEntityId] : request.entityIds,
      fields: request.fields,
    });
  }

  return Object.freeze({
    actorBindings,
    hostConversationBindings,
    policyAuthority: trustedPolicyAuthority,
    authorizedReads,
    validateMechanicPolicy,
    resolveHostScope,
    readHostNpcContext,
  });
}
