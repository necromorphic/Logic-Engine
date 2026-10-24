/**
 * Internal import-only test seam for the Memory Provider.
 *
 * Intentionally not re-exported from public application entry points and not
 * connected to the HTTP API or default runtime. This is a one-record operation:
 * it makes no batch atomicity guarantee and does not bypass provider validation.
 */
export function createInternalMemoryImportFacadeForTest(provider) {
  if (!provider || typeof provider.putRecord !== 'function') {
    throw new TypeError('Internal Memory import facade requires a provider with putRecord');
  }

  return Object.freeze({
    importRecord(record) {
      return provider.putRecord(record);
    },
  });
}
