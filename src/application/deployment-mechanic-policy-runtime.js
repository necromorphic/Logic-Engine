import { AuthorizedReadService } from './authorized-read-service.js';
import { CanonicalEntityAttributeContextProvider } from './entity-attribute-context-provider.js';
import { DeploymentMechanicPolicyAuthority } from './deployment-mechanic-policy-authority.js';
import { trustedMechanicPolicyRevision, validateTrustedMechanicPolicyConfig } from './trusted-mechanic-policy-config.js';

/**
 * Build the production mechanic policy runtime from one deployment-owned source.
 * The same config loader governs AuthorizedReadService visibility and the
 * authority's context provider; the returned authority is shared by evaluation
 * and ProposalService. The loader must return trusted deployment configuration.
 */
export function createDeploymentMechanicPolicyRuntime({ engine, actorBindingService, loadPolicyConfig } = {}) {
  if (!engine || typeof engine.getState !== 'function') throw new TypeError('A LogicEngine is required.');
  if (typeof actorBindingService?.resolve !== 'function') throw new TypeError('A trusted ActorBindingService is required.');
  if (typeof loadPolicyConfig !== 'function') throw new TypeError('A trusted deployment policy config loader is required.');

  const readPolicy = () => {
    const config = validateTrustedMechanicPolicyConfig(loadPolicyConfig());
    if (config.recipient !== 'model' || config.purpose !== 'npc_decision') {
      throw new TypeError('The bounded mechanic runtime requires recipient=model and purpose=npc_decision.');
    }
    return config;
  };
  const fieldPolicy = (context, entity, field) => {
    let config;
    try { config = readPolicy(); } catch { return false; }
    if (context?.authenticatedAdapterId !== config.adapter_id
      || context?.actor?.entity_id !== config.actor_entity_id
      || context?.recipient !== config.recipient
      || context?.purpose !== config.purpose) return false;
    if (entity?.entity_id === context.actor.entity_id
      && ['entity_id', 'entity_type', 'status'].includes(field)) return true;
    if (typeof field !== 'string' || !field.startsWith('attributes.')) return false;
    const attribute = field.slice('attributes.'.length);
    return config.allowed_fields.some((item) => item.entity_id === entity?.entity_id && item.attribute === attribute);
  };

  const authorizedReadService = new AuthorizedReadService(engine, actorBindingService, fieldPolicy);
  const authority = new DeploymentMechanicPolicyAuthority({
    resolveActivePolicy: () => {
      const config = readPolicy();
      const contextProvider = new CanonicalEntityAttributeContextProvider(engine, {
        policyVersion: trustedMechanicPolicyRevision(config),
        authorizationScope: config.authorization_scope,
        bindings: config.bindings,
        authorizedReadService,
        adapterId: config.adapter_id,
        actorEntityId: config.actor_entity_id,
        recipient: config.recipient,
        purpose: config.purpose,
      });
      return {
        authority_id: config.authority_id,
        generation: config.generation,
        contextProvider,
      };
    },
  });
  return Object.freeze({ authorizedReadService, authority });
}
