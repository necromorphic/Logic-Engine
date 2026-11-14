import { HostLifecycleReceiptStore } from './st-host-lifecycle-receipt-store.mjs';

export function createHostMutationRuntimeAcceptanceVerifier({ receiptStore } = {}) {
  if (!(receiptStore instanceof HostLifecycleReceiptStore)) {
    throw new TypeError('A durable Host lifecycle receipt store is required for runtime acceptance.');
  }
  return async function verifyHostMutationRuntimeAcceptance(input = {}) {
    if (input.signal?.aborted === true) return { status: 'NON_READY', reason: 'HOST_GENERATION_CANCELLED' };
    try {
      const result = await receiptStore.verifyRuntimeAcceptance({
        pinnedHostCommit: input.pinnedHostCommit,
        rootPath: input.rootPath,
        rootId: input.rootId,
        entries: input.entries,
        snapshotAlignment: input.snapshotAlignment,
        snapshotId: input.snapshotId,
        snapshotSha256: input.snapshotSha256,
        sourceIdentity: input.sourceIdentity,
        mutationCoverage: input.mutationCoverage,
        hostInstallationId: input.hostInstallationId,
        authenticatedAccountId: input.authenticatedAccountId,
      });
      if (input.signal?.aborted === true) return { status: 'NON_READY', reason: 'HOST_GENERATION_CANCELLED' };
      return result;
    } catch {
      return { status: 'NON_READY', reason: 'HOST_MUTATION_RUNTIME_ACCEPTANCE_AUDIT_FAILED' };
    }
  };
}
