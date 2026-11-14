import { types as utilTypes } from 'node:util';

const MODEL_STANCES = new Set(['supported', 'contradicted', 'uncertain', 'dropped']);
const MAX_OUTPUT_BYTES = 16 * 1024;
const MAX_EVIDENCE_HANDLES = 200;

function plainDataObject(value) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value) || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every(key => {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, 'value');
    });
  } catch { return false; }
}

function exactDataObject(value, keys) {
  return plainDataObject(value) && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function denseArray(value) {
  if (utilTypes.isProxy(value) || !Array.isArray(value) || value.length > MAX_EVIDENCE_HANDLES) return false;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
    }
    return true;
  } catch { return false; }
}

/**
 * Walk JSON syntax before JSON.parse so duplicate keys (including escaped
 * spellings of the same key) are rejected instead of silently overwritten.
 */
function assertNoDuplicateJsonKeys(source) {
  let offset = 0;
  let nodes = 0;
  const fail = () => { throw new SyntaxError('Malformed or ambiguous JSON.'); };
  const whitespace = () => {
    while (offset < source.length && /[\u0009\u000a\u000d\u0020]/.test(source[offset])) offset += 1;
  };
  const string = () => {
    if (source[offset] !== '"') fail();
    const start = offset;
    offset += 1;
    while (offset < source.length) {
      const code = source.charCodeAt(offset);
      const character = source[offset];
      offset += 1;
      if (character === '"') return JSON.parse(source.slice(start, offset));
      if (code < 0x20) fail();
      if (character === '\\') {
        if (offset >= source.length) fail();
        offset += 1;
      }
    }
    fail();
  };
  const value = depth => {
    nodes += 1;
    if (depth > 32 || nodes > 10000) fail();
    whitespace();
    const character = source[offset];
    if (character === '{') {
      offset += 1;
      whitespace();
      if (source[offset] === '}') { offset += 1; return; }
      const keys = new Set();
      while (offset < source.length) {
        whitespace();
        const key = string();
        if (keys.has(key)) fail();
        keys.add(key);
        whitespace();
        if (source[offset] !== ':') fail();
        offset += 1;
        value(depth + 1);
        whitespace();
        if (source[offset] === '}') { offset += 1; return; }
        if (source[offset] !== ',') fail();
        offset += 1;
      }
      fail();
    }
    if (character === '[') {
      offset += 1;
      whitespace();
      if (source[offset] === ']') { offset += 1; return; }
      while (offset < source.length) {
        value(depth + 1);
        whitespace();
        if (source[offset] === ']') { offset += 1; return; }
        if (source[offset] !== ',') fail();
        offset += 1;
      }
      fail();
    }
    if (character === '"') { string(); return; }
    if (source.startsWith('true', offset)) { offset += 4; return; }
    if (source.startsWith('false', offset)) { offset += 5; return; }
    if (source.startsWith('null', offset)) { offset += 4; return; }
    const number = source.slice(offset).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!number) fail();
    offset += number[0].length;
  };

  value(0);
  whitespace();
  if (offset !== source.length) fail();
}

/**
 * Parse only the agreed top-level proposal envelope. No markdown extraction,
 * free-text recovery, scope fields, Core IDs, or model-controlled idempotency.
 * Stance/modality are retained as uncommitted semantic fields for Core review.
 */
export function parseNpcBeliefProposalOutput(rawOutput) {
  if (typeof rawOutput !== 'string' || rawOutput.length === 0
    || Buffer.byteLength(rawOutput, 'utf8') > MAX_OUTPUT_BYTES) {
    return Object.freeze({ status: 'non_ready', reason: 'invalid_output_size_or_type' });
  }

  let parsed;
  try {
    assertNoDuplicateJsonKeys(rawOutput);
    parsed = JSON.parse(rawOutput);
  } catch {
    return Object.freeze({ status: 'non_ready', reason: 'invalid_or_ambiguous_json' });
  }

  const keys = [
    'schema_version', 'context_handle', 'proposition_handle', 'object',
    'modality', 'stance', 'supporting_evidence_handles', 'contradicting_evidence_handles',
  ];
  if (!exactDataObject(parsed, keys)
    || parsed.schema_version !== 1
    || typeof parsed.context_handle !== 'string'
    || !/^nctx1\.[A-Za-z0-9_-]{22}\.[0-9]{13}\.[A-Za-z0-9_-]{43}$/.test(parsed.context_handle)
    || typeof parsed.proposition_handle !== 'string'
    || !/^prh1\.[A-Za-z0-9_-]{43}$/.test(parsed.proposition_handle)
    || typeof parsed.modality !== 'string'
    || !/^[a-z][a-z0-9_.-]{0,63}$/.test(parsed.modality)
    || !MODEL_STANCES.has(parsed.stance)
    || !denseArray(parsed.supporting_evidence_handles)
    || !denseArray(parsed.contradicting_evidence_handles)) {
    return Object.freeze({ status: 'non_ready', reason: 'proposal_schema_invalid' });
  }

  const handles = [...parsed.supporting_evidence_handles, ...parsed.contradicting_evidence_handles];
  if (handles.length === 0 || handles.length > MAX_EVIDENCE_HANDLES
    || new Set(handles).size !== handles.length
    || handles.some(handle => typeof handle !== 'string' || !/^evh1\.[A-Za-z0-9_-]{43}$/.test(handle))) {
    return Object.freeze({ status: 'non_ready', reason: 'evidence_handles_invalid_or_duplicated' });
  }

  return Object.freeze({
    status: 'parsed',
    stance: parsed.stance,
    modality: parsed.modality,
    proposal: Object.freeze({
      schema_version: parsed.schema_version,
      context_handle: parsed.context_handle,
      proposition_handle: parsed.proposition_handle,
      object: parsed.object,
      supporting_evidence_handles: Object.freeze([...parsed.supporting_evidence_handles]),
      contradicting_evidence_handles: Object.freeze([...parsed.contradicting_evidence_handles]),
    }),
  });
}
