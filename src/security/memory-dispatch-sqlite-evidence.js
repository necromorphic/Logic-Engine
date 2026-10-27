import { DatabaseSync } from 'node:sqlite';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value) => typeof value === 'string' && value === value.trim()
  && value.length > 0 && value.length <= 200
  && ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });

function openReadOnly(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || !existsSync(path)) {
    throw new TypeError('DISPATCH_EVIDENCE_DATABASE_UNAVAILABLE');
  }
  const db = new DatabaseSync(resolve(path), { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA query_only=ON;');
    return db;
  } catch (error) {
    try { db.close(); } catch {}
    throw error;
  }
}

function sameFile(left, right) {
  const a = realpathSync(left);
  const b = realpathSync(right);
  if (a === b) return true;
  const statA = statSync(a, { bigint: true });
  const statB = statSync(b, { bigint: true });
  return statA.dev === statB.dev && statA.ino === statB.ino;
}

function normalizeSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0 || sources.length > 256) return null;
  const result = [];
  for (const source of sources) {
    if (!object(source) || source.source_kind !== 'canonical_entity'
      || !validId(source.source_entity_id) || !validId(source.source_version)
      || Object.keys(source).some((key) => !['source_kind', 'source_entity_id', 'source_version'].includes(key))) return null;
    result.push({
      source_kind: 'canonical_entity',
      source_entity_id: source.source_entity_id,
      source_version: source.source_version,
    });
  }
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  result.sort((a, b) => compare(a.source_entity_id, b.source_entity_id)
    || compare(a.source_version, b.source_version));
  for (let i = 1; i < result.length; i += 1) {
    if (result[i - 1].source_entity_id === result[i].source_entity_id
      && result[i - 1].source_version === result[i].source_version) return null;
  }
  return result;
}

function normalizeCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > 50) return null;
  const result = [];
  for (const candidate of candidates) {
    if (!object(candidate) || Object.keys(candidate).some((key) => ![
      'record_ref', 'record_version', 'source_kind', 'source_entity_id', 'source_version',
    ].includes(key))
      || !validId(candidate.record_ref) || !validId(candidate.record_version)
      || candidate.source_kind !== 'canonical_entity'
      || !validId(candidate.source_entity_id) || !validId(candidate.source_version)) return null;
    result.push({
      record_ref: candidate.record_ref,
      record_version: candidate.record_version,
      source_kind: candidate.source_kind,
      source_entity_id: candidate.source_entity_id,
      source_version: candidate.source_version,
    });
  }
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  result.sort((a, b) => compare(a.record_ref, b.record_ref)
    || compare(a.record_version, b.record_version)
    || compare(a.source_entity_id, b.source_entity_id)
    || compare(a.source_version, b.source_version));
  for (let i = 1; i < result.length; i += 1) {
    if (result[i - 1].record_ref === result[i].record_ref
      && result[i - 1].record_version === result[i].record_version) return null;
  }
  return result;
}

function sourcesFromCandidates(candidates) {
  const unique = new Map();
  for (const candidate of candidates) {
    unique.set(JSON.stringify([candidate.source_entity_id, candidate.source_version]), {
      source_kind: candidate.source_kind,
      source_entity_id: candidate.source_entity_id,
      source_version: candidate.source_version,
    });
  }
  return normalizeSources([...unique.values()]);
}

function notReadyCore() {
  return Object.freeze({
    world_id: null, actor_id: null, readiness: 'NOT_READY',
    inventory_status: 'NOT_READY', head: 0, sources: Object.freeze([]),
  });
}

function notReadyProvider() {
  return Object.freeze({
    world_id: null, actor_id: null, purpose: null, granted: false,
    readiness: 'NOT_READY', head: 0, sources: Object.freeze([]), candidates: Object.freeze([]),
  });
}

/**
 * Opens existing Core and Provider SQLite stores read-only and derives
 * dispatch evidence from persisted canonical rows. No caller-supplied readiness,
 * grant, source version, world assignment, or actor binding is trusted.
 *
 * IMPORTANT: Core currently has no proven complete Host historical/deleted
 * inventory. Therefore inventory_status is always NOT_READY and the final
 * dispatch gate must refuse disclosure until Host inventory/rollback evidence
 * is implemented and tested against the pinned SillyTavern runtime.
 */
export function createSqliteMemoryDispatchEvidenceReaders({ coreDatabasePath, providerDatabasePath }) {
  if (typeof coreDatabasePath !== 'string' || !isAbsolute(coreDatabasePath)
    || typeof providerDatabasePath !== 'string' || !isAbsolute(providerDatabasePath)
    || !existsSync(coreDatabasePath) || !existsSync(providerDatabasePath)) {
    throw new TypeError('DISPATCH_EVIDENCE_DATABASE_UNAVAILABLE');
  }
  if (sameFile(coreDatabasePath, providerDatabasePath)) {
    throw new Error('DISPATCH_EVIDENCE_DATABASE_PATH_ALIAS');
  }

  const coreDb = openReadOnly(coreDatabasePath);
  let providerDb;
  try {
    providerDb = openReadOnly(providerDatabasePath);
  } catch (error) {
    coreDb.close();
    throw error;
  }

  function readCoreEvidence({ adapterId, conversationId, worldId, actorId, sources }) {
    const normalizedSources = normalizeSources(sources);
    if (!validId(adapterId) || !validId(conversationId) || !validId(worldId)
      || !validId(actorId) || !normalizedSources) return notReadyCore();
    try {
      const state = coreDb.prepare(
        'SELECT head,enrolled FROM accepted_head_state WHERE singleton=1',
      ).get();
      if (!state || state.enrolled !== 1 || !Number.isSafeInteger(state.head) || state.head < 1) return notReadyCore();

      const world = coreDb.prepare('SELECT status FROM worlds WHERE world_id=?').get(worldId);
      if (!world || world.status !== 'active') return notReadyCore();

      const conversation = coreDb.prepare('SELECT world_id,active FROM host_conversation_world_bindings '
        + 'WHERE adapter_id=? AND conversation_id=?').get(adapterId, conversationId);
      if (!conversation || conversation.active !== 1 || conversation.world_id !== worldId) return notReadyCore();

      const actorBinding = coreDb.prepare('SELECT active FROM actor_bindings '
        + 'WHERE world_id=? AND adapter_id=? AND entity_id=?').get(worldId, adapterId, actorId);
      if (!actorBinding || actorBinding.active !== 1) return notReadyCore();

      const actor = coreDb.prepare('SELECT status FROM entities WHERE world_id=? AND entity_id=?')
        .get(worldId, actorId);
      if (!actor || actor.status !== 'active') return notReadyCore();

      for (const source of normalizedSources) {
        const entity = coreDb.prepare('SELECT e.status,v.source_version '
          + 'FROM entities e JOIN entity_source_versions v '
          + 'ON v.world_id=e.world_id AND v.entity_id=e.entity_id '
          + 'WHERE e.world_id=? AND e.entity_id=?').get(worldId, source.source_entity_id);
        if (!entity || entity.status !== 'active'
          || !Number.isSafeInteger(entity.source_version)
          || source.source_version !== 'core-entity-v1:' + String(entity.source_version)) {
          return notReadyCore();
        }
      }

      return Object.freeze({
        world_id: worldId,
        actor_id: actorId,
        readiness: 'READY',
        inventory_status: 'NOT_READY',
        head: state.head,
        sources: Object.freeze(normalizedSources),
      });
    } catch {
      return notReadyCore();
    }
  }

  function readProviderEvidence({ worldId, actorId, purpose, sources, candidates }) {
    const normalizedSources = normalizeSources(sources);
    const normalizedCandidates = normalizeCandidates(candidates);
    if (!validId(worldId) || !validId(actorId) || !validId(purpose)
      || !normalizedSources || !normalizedCandidates
      || JSON.stringify(sourcesFromCandidates(normalizedCandidates)) !== JSON.stringify(normalizedSources)) {
      return notReadyProvider();
    }
    try {
      const state = providerDb.prepare(
        'SELECT head,enrolled FROM accepted_head_state WHERE singleton=1',
      ).get();
      if (!state || state.enrolled !== 1 || !Number.isSafeInteger(state.head) || state.head < 1) return notReadyProvider();

      const queryGrant = providerDb.prepare('SELECT allowed FROM memory_query_grants '
        + 'WHERE world_id=? AND subject_id=? AND purpose=?').get(worldId, actorId, purpose);
      if (!queryGrant || queryGrant.allowed !== 1) return notReadyProvider();

      const indexState = providerDb.prepare('SELECT index_health,source_reconciliation FROM memory_index_state '
        + 'WHERE world_id=?').get(worldId);
      if (!indexState || indexState.index_health !== 'ready'
        || indexState.source_reconciliation !== 'current') return notReadyProvider();

      for (const candidate of normalizedCandidates) {
        const row = providerDb.prepare('SELECT subject_id,purpose,source_kind,source_entity_id,source_version, '
          + 'content_disposition,lineage_json FROM memory_records '
          + 'WHERE world_id=? AND record_ref=? AND record_version=?')
          .get(worldId, candidate.record_ref, candidate.record_version);
        if (!row || row.subject_id !== actorId || row.purpose !== purpose
          || row.source_kind !== candidate.source_kind
          || row.source_entity_id !== candidate.source_entity_id
          || row.source_version !== candidate.source_version
          || row.content_disposition !== 'usable') return notReadyProvider();

        const grant = providerDb.prepare('SELECT allowed FROM memory_record_grants '
          + 'WHERE world_id=? AND subject_id=? AND purpose=? AND record_ref=? AND record_version=?')
          .get(worldId, actorId, purpose, candidate.record_ref, candidate.record_version);
        if (!grant || grant.allowed !== 1) return notReadyProvider();

        const indexed = providerDb.prepare('SELECT 1 AS ok FROM memory_index_entries '
          + 'WHERE world_id=? AND record_ref=? AND record_version=?')
          .get(worldId, candidate.record_ref, candidate.record_version);
        if (!indexed) return notReadyProvider();

        let lineage;
        try { lineage = JSON.parse(row.lineage_json); } catch { return notReadyProvider(); }
        if (!Array.isArray(lineage) || lineage.length !== 1 || !object(lineage[0])
          || lineage[0].source_kind !== 'canonical_entity'
          || lineage[0].entity_id !== candidate.source_entity_id
          || lineage[0].source_version !== candidate.source_version) return notReadyProvider();
      }

      return Object.freeze({
        world_id: worldId,
        actor_id: actorId,
        purpose,
        granted: true,
        readiness: 'READY',
        head: state.head,
        sources: Object.freeze(normalizedSources),
        candidates: Object.freeze(normalizedCandidates),
      });
    } catch {
      return notReadyProvider();
    }
  }

  return Object.freeze({
    readCoreEvidence,
    readProviderEvidence,
    close() {
      try { coreDb.close(); } finally { providerDb.close(); }
    },
  });
}
