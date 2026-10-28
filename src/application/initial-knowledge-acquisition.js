import { createHash } from 'node:crypto';
import { EngineError, assert } from '../core/errors.js';
import { hashRequest } from '../core/request-hash.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value) => typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 200;
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

/**
 * Core-internal author/import assignment primitive.
 *
 * This is deliberately not mounted on the HTTP API. A trusted authoring/import
 * integration must authenticate its caller before invoking it. NPC, Memory and
 * Host adapters have no route that can call this operation or supply provenance.
 *
 * The acquisition is persisted as a canonical Core event effect. The SQLite
 * table is only a rebuildable projection of valid events, never a second source
 * of truth. Each assignment points to one exact valid fact-claim event.
 */
export class InitialKnowledgeAcquisitionService {
  constructor(engine) {
    if (typeof engine?.prepareEvent !== 'function' || !engine?.store?.db || typeof engine.store.commit !== 'function') {
      throw new TypeError('InitialKnowledgeAcquisitionService requires a LogicEngine with a persistent Core store');
    }
    this.engine = engine;
    this.store = engine.store;
    this.db = engine.store.db;
  }

  assign(input) {
    assert(object(input), 'INVALID_INITIAL_ACQUISITION', 'Request must be an object.');
    const allowed = [
      'world_id', 'subject_entity_id', 'source_fact_id', 'source_event_id',
      'acquisition_kind', 'import_id', 'import_version', 'import_sha256',
      'expected_revision', 'expected_commit_sequence', 'idempotency_key',
    ];
    assert(Object.keys(input).every((key) => allowed.includes(key)),
      'UNSUPPORTED_INITIAL_ACQUISITION_FIELD', 'Request contains an unsupported field.');
    for (const key of ['world_id', 'subject_entity_id', 'source_fact_id', 'source_event_id', 'idempotency_key']) {
      assert(validId(input[key]), 'INVALID_INITIAL_ACQUISITION', key + ' must be a non-empty identifier of at most 200 characters.');
    }
    assert(['author_initial', 'imported'].includes(input.acquisition_kind),
      'UNSUPPORTED_ACQUISITION_KIND', 'Only author_initial and imported are supported in this stage.');
    if (input.acquisition_kind === 'imported') {
      throw new EngineError('UNSUPPORTED_TRUSTED_IMPORT_SOURCE',
        'Imported acquisition is disabled until a trusted Core import-source resolver can verify the package and source-event binding.', 409);
    }
    assert(Number.isSafeInteger(input.expected_revision) && input.expected_revision >= 0,
      'INVALID_REVISION', 'expected_revision must be a non-negative integer.');
    assert(Number.isSafeInteger(input.expected_commit_sequence) && input.expected_commit_sequence >= 0,
      'INVALID_COMMIT_SEQUENCE', 'expected_commit_sequence must be a non-negative integer.');

    let importMetadata = null;
    if (input.acquisition_kind === 'imported') {
      assert(validId(input.import_id) && validId(input.import_version)
        && typeof input.import_sha256 === 'string' && /^[a-f0-9]{64}$/i.test(input.import_sha256),
      'INVALID_IMPORT_PROVENANCE', 'imported acquisition requires import_id, import_version and a SHA-256 import artifact digest.');
      importMetadata = {
        import_id: input.import_id,
        import_version: input.import_version,
        import_sha256: input.import_sha256.toLowerCase(),
      };
    } else {
      assert(input.import_id === undefined && input.import_version === undefined && input.import_sha256 === undefined,
        'INVALID_IMPORT_PROVENANCE', 'author_initial acquisition cannot contain import-only provenance fields.');
    }

    const identity = {
      world_id: input.world_id,
      subject_entity_id: input.subject_entity_id,
      source_fact_id: input.source_fact_id,
      source_event_id: input.source_event_id,
      acquisition_kind: input.acquisition_kind,
      ...(importMetadata ? { import: importMetadata } : {}),
    };
    const operationHash = hashRequest({ operation: 'knowledge.acquire.initial', ...identity });
    const storageKey = 'knowledge-acquisition:' + hashRequest({
      world_id: input.world_id,
      idempotency_key: input.idempotency_key,
    });
    const requestHash = hashRequest({
      operation: operationHash,
      world_id: input.world_id,
      expected_revision: input.expected_revision,
      expected_commit_sequence: input.expected_commit_sequence,
    });
    const prior = this.store.replay(input.world_id, storageKey, requestHash);
    if (prior) return { ...prior, idempotent_replay: true };
    const acquisitionId = 'acq_' + sha256(JSON.stringify(identity));
    const existing = this.db.prepare("SELECT acquisition_event_id FROM knowledge_acquisitions WHERE world_id=? AND acquisition_id=? AND status='active'")
      .get(input.world_id, acquisitionId);
    if (existing) {
      throw new EngineError('INITIAL_ACQUISITION_ALREADY_EXISTS', 'This exact initial acquisition is already active.', 409, {
        acquisition_id: acquisitionId,
        acquisition_event_id: existing.acquisition_event_id,
      });
    }

    const world = this.store.world(input.world_id);
    if (!world) throw new EngineError('WORLD_NOT_FOUND', 'World not found.', 404);
    const currentSequence = this.store.currentCommitSequence(input.world_id);
    if (world.world_revision !== input.expected_revision || currentSequence !== input.expected_commit_sequence) {
      throw new EngineError('INITIAL_ACQUISITION_SNAPSHOT_STALE', 'World revision or commit sequence changed before initial acquisition.', 409, {
        expected_revision: input.expected_revision,
        current_revision: world.world_revision,
        expected_commit_sequence: input.expected_commit_sequence,
        current_commit_sequence: currentSequence,
      });
    }

    const subject = this.db.prepare('SELECT entity_id,status FROM entities WHERE world_id=? AND entity_id=?')
      .get(input.world_id, input.subject_entity_id);
    if (!subject || subject.status === 'destroyed') {
      throw new EngineError('INITIAL_ACQUISITION_SUBJECT_NOT_ELIGIBLE', 'Subject must be an existing non-destroyed canonical entity in this world.', 409);
    }

    const sourceEvent = this.db.prepare('SELECT event_id,world_id,commit_sequence,validity FROM world_events WHERE world_id=? AND event_id=?')
      .get(input.world_id, input.source_event_id);
    if (!sourceEvent || sourceEvent.validity !== 'valid' || sourceEvent.commit_sequence > currentSequence) {
      throw new EngineError('INITIAL_ACQUISITION_SOURCE_NOT_ELIGIBLE', 'Source event must be valid in the same world.', 409);
    }
    const claim = this.db.prepare('SELECT predicate,value_json FROM fact_claims WHERE world_id=? AND fact_id=? AND event_id=?')
      .get(input.world_id, input.source_fact_id, input.source_event_id);
    if (!claim) {
      throw new EngineError('INITIAL_ACQUISITION_SOURCE_NOT_ELIGIBLE', 'Source event must contain a currently valid claim for source_fact_id.', 409);
    }

    const provenance = {
      issuer: 'core_trusted_authoring',
      acquisition_kind: input.acquisition_kind,
      source_fact_id: input.source_fact_id,
      source_event_id: input.source_event_id,
      source_claim_sha256: sha256(JSON.stringify({
        predicate: claim.predicate,
        value: JSON.parse(claim.value_json),
      })),
      ...(importMetadata ? { import: importMetadata } : {}),
    };

    const effect = {
      kind: 'knowledge.acquire',
      acquisition_id: acquisitionId,
      subject_entity_id: input.subject_entity_id,
      source_fact_id: input.source_fact_id,
      source_event_id: input.source_event_id,
      source_predicate: claim.predicate,
      source_value: JSON.parse(claim.value_json),
      acquisition_kind: input.acquisition_kind,
      provenance,
      observed_world_revision: input.expected_revision,
      observed_commit_sequence: input.expected_commit_sequence,
      visibility_status: 'unclassified',
    };
    const prepared = this.engine.prepareEvent({
      idempotency_key: storageKey,
      turn_id: 'knowledge-acquisition:' + acquisitionId.slice(4, 36),
      event_type: 'knowledge.initial_acquisition',
      expected_revision: input.expected_revision,
      expected_commit_sequence: input.expected_commit_sequence,
      caused_by: [input.source_event_id],
      depends_on: [input.source_event_id],
      read_set: ['entity:' + input.subject_entity_id, 'fact:' + input.source_fact_id],
      causal_links: [
        { relation: 'READS_ENTITY', target_id: input.subject_entity_id },
        { relation: 'READS_CLAIM', target_id: input.source_fact_id },
      ],
      effects: [effect],
    }, { allowKnowledgeAcquisition: true });
    // The stable request hash binds the exact assignment identity, while the
    // source claim and snapshot cursor are independently revalidated by commit.
    prepared.request_hash = requestHash;
    return this.store.commit(input.world_id, prepared, { allowKnowledgeAcquisition: true });
  }
}
