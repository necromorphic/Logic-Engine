export const PROTECTED_FINAL_SEND_CAPABILITIES = Object.freeze([
  'host.patch.integrity',
  'final-send.route-coverage',
  'final-send.dispatch-start.sync',
  'coordinator.shared-lease',
  'final-send.revoke-inflight-fence',
  'final-send.response-revalidation',
  'final-send.ambiguous-recovery',
  'final-send.upstream-call-count',
]);

export const CAPABILITY_STATUSES = Object.freeze([
  'PASS',
  'FAIL',
  'UNSUPPORTED',
  'NOT_TESTED',
  'DEGRADED',
]);

export function createCapabilityEvidence({
  id,
  status = 'NOT_TESTED',
  required = false,
  evidenceSource = 'not-collected',
  observedSummary,
  adapterVersion = 'unknown',
  limitations = [],
  timestamp = new Date().toISOString(),
}) {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9._-]{1,127}$/.test(id)) {
    throw new TypeError('CAPABILITY_EVIDENCE_ID_INVALID');
  }
  if (!CAPABILITY_STATUSES.includes(status)) throw new TypeError('CAPABILITY_EVIDENCE_STATUS_INVALID');
  if (typeof required !== 'boolean' || !Array.isArray(limitations)) {
    throw new TypeError('CAPABILITY_EVIDENCE_SHAPE_INVALID');
  }
  return Object.freeze({
    id,
    status,
    required,
    evidence_source: evidenceSource,
    ...(typeof observedSummary === 'string' ? { observed_summary: observedSummary } : {}),
    adapter_version: adapterVersion,
    limitations: Object.freeze([...limitations]),
    timestamp,
  });
}

export function evaluateDeploymentGates({ profile, components, capabilities }) {
  if (!['portable-desktop', 'hardened-service'].includes(profile)) {
    throw new TypeError('DEPLOYMENT_PROFILE_INVALID');
  }
  const byId = new Map();
  for (const evidence of capabilities) {
    if (byId.has(evidence.id)) throw new Error('DUPLICATE_CAPABILITY_EVIDENCE:' + evidence.id);
    byId.set(evidence.id, evidence);
  }
  const gates = [];
  for (const component of components) {
    if (!component.enabled) continue;
    const requiredIds = new Set(component.requires_capabilities ?? []);
    const protectedFinalSendMissing = PROTECTED_FINAL_SEND_CAPABILITIES.filter((id) => byId.get(id)?.status !== 'PASS');
  gates.push({
    id: 'memory:protected-final-send-production',
    status: protectedFinalSendMissing.length === 0 ? 'PASS' : 'BLOCKED',
    affected_features: ['memory.protected-final-send'],
    reason: protectedFinalSendMissing.length === 0
      ? undefined
      : 'Protected Memory final-send production gate lacks verified evidence: ' + protectedFinalSendMissing.join(', ') + '.',
  });
  if (profile === 'hardened-service') {
      requiredIds.add('process.identity.separate');
      requiredIds.add('filesystem.access.effective');
      requiredIds.add('ipc.peer-authentication');
    }
    for (const id of requiredIds) {
      const evidence = byId.get(id);
      const status = evidence?.status ?? 'NOT_TESTED';
      gates.push({
        id: component.id + ':' + id,
        status: status === 'PASS' ? 'PASS' : 'BLOCKED',
        affected_features: [component.id],
        reason: status === 'PASS' ? undefined : 'Required capability status is ' + status + '.',
      });
    }
  }
  if (profile === 'hardened-service') {
    const anchor = byId.get('backup.freshness-anchor.available');
    const status = anchor?.status ?? 'NOT_TESTED';
    gates.push({
      id: 'backup:independent-freshness-anchor',
      status: status === 'PASS' ? 'PASS' : 'BLOCKED',
      affected_features: ['backup.restore', 'authority.recovery'],
      reason: status === 'PASS' ? undefined : 'Independent backup freshness anchor is ' + status + '.',
    });
  }
  return Object.freeze(gates.map((gate) => Object.freeze(gate)));
}

export function aggregateDeploymentStatus({ profile, capabilities, gates }) {
  const required = capabilities.filter((item) => item.required);
  const statuses = required.map((item) => item.status);
  if (gates.some((gate) => gate.status === 'BLOCKED')) {
    const failures = statuses.filter((status) => status !== 'PASS');
    if (failures.includes('FAIL')) return 'FAIL';
    if (failures.includes('UNSUPPORTED')) return 'UNSUPPORTED';
    return 'NOT_TESTED';
  }
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('UNSUPPORTED')) return 'UNSUPPORTED';
  if (statuses.includes('NOT_TESTED')) return 'NOT_TESTED';
  if (statuses.includes('DEGRADED')) return 'DEGRADED';
  if (capabilities.some((item) => item.status !== 'PASS')) return 'DEGRADED';
  if (profile === 'portable-desktop') return 'DEGRADED';
  return 'PASS';
}

export function buildDeploymentReport({
  deploymentId,
  profile,
  platform,
  runtime,
  components,
  capabilities,
  gates,
  limitations = [],
  generatedAt = new Date().toISOString(),
}) {
  const overallStatus = aggregateDeploymentStatus({ profile, capabilities, gates });
  return Object.freeze({
    schema_version: 1,
    deployment_id: deploymentId,
    generated_at: generatedAt,
    platform,
    runtime,
    profile,
    overall_status: overallStatus,
    components: components.map((component) => ({
      id: component.id,
      execution_mode: component.execution_mode,
      status: gates.some((gate) => gate.affected_features.includes(component.id) && gate.status === 'BLOCKED')
        ? 'NOT_TESTED'
        : profile === 'portable-desktop' ? 'DEGRADED' : 'PASS',
    })),
    capabilities: capabilities.map((item) => ({
      id: item.id,
      status: item.status,
      required: item.required,
      evidence_source: item.evidence_source,
      ...(item.observed_summary ? { observed_summary: item.observed_summary } : {}),
      adapter_version: item.adapter_version,
      limitations: [...item.limitations],
    })),
    gates: gates.map((gate) => ({
      id: gate.id,
      status: gate.status,
      affected_features: [...gate.affected_features],
      ...(gate.reason ? { reason: gate.reason } : {}),
    })),
    limitations: [...limitations],
  });
}
