/**
 * Experimental recalculation harness. This is deliberately not wired into the
 * production Core. It is a test instrument for comparing full, incremental,
 * and guarded-incremental recomputation against independently asserted results.
 *
 * Model:
 * - inputs is a plain JSON-compatible object;
 * - each node has { id, dependsOn: string[], evaluate(ctx) };
 * - dependencies name either an input key or another node id;
 * - evaluate must read through ctx.read(name), so executed reads can be audited.
 */
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function assertModel(inputs, nodes) {
  if (!isRecord(inputs)) throw new TypeError('inputs must be a plain object');
  if (!Array.isArray(nodes)) throw new TypeError('nodes must be an array');
  const byId = new Map();
  for (const node of nodes) {
    if (!isRecord(node) || typeof node.id !== 'string' || !node.id.trim()) {
      throw new TypeError('every node needs a non-empty id');
    }
    if (byId.has(node.id) || Object.hasOwn(inputs, node.id)) {
      throw new Error('duplicate input/node identity: ' + node.id);
    }
    if (!Array.isArray(node.dependsOn) || node.dependsOn.some((x) => typeof x !== 'string' || !x)) {
      throw new TypeError('node ' + node.id + ' needs a string dependsOn array');
    }
    if (typeof node.evaluate !== 'function') throw new TypeError('node ' + node.id + ' needs evaluate(ctx)');
    byId.set(node.id, node);
  }
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!Object.hasOwn(inputs, dep) && !byId.has(dep)) {
        throw new Error('unknown dependency ' + dep + ' declared by ' + node.id);
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const order = [];
  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error('DEPENDENCY_CYCLE:' + [...visiting, id].join(' -> '));
    visiting.add(id);
    for (const dep of byId.get(id).dependsOn) if (byId.has(dep)) visit(dep);
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  }
  for (const node of nodes) visit(node.id);
  return { byId, order };
}

function evaluateSelected(inputs, nodes, selected, priorValues = {}) {
  const { byId, order } = assertModel(inputs, nodes);
  const values = { ...priorValues };
  const readSets = {};
  const violations = [];

  for (const id of order) {
    if (!selected.has(id)) continue;
    const node = byId.get(id);
    const reads = new Set();
    const ctx = Object.freeze({
      read(name) {
        reads.add(name);
        if (Object.hasOwn(inputs, name)) return inputs[name];
        if (Object.hasOwn(values, name)) return values[name];
        throw new Error('READ_BEFORE_VALUE:' + id + ':' + name);
      },
    });
    values[id] = node.evaluate(ctx);
    readSets[id] = [...reads].sort();
    const declared = new Set(node.dependsOn);
    for (const name of reads) {
      if (!declared.has(name)) violations.push({ node: id, read: name, code: 'UNDECLARED_READ' });
    }
    // Declared dependencies may be a conservative union of conditional reads.
    // Not reading one on this execution is not a contract violation.
  }
  return { values, readSets, violations, order };
}

function allNodeIds(nodes) {
  return new Set(nodes.map((node) => node.id));
}

function impactedNodes(inputs, nodes, changedInputs) {
  const { order } = assertModel(inputs, nodes);
  const dirty = new Set();
  for (const node of nodes) {
    if (node.dependsOn.some((dep) => changedInputs.has(dep))) dirty.add(node.id);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (!dirty.has(node.id) && node.dependsOn.some((dep) => dirty.has(dep))) {
        dirty.add(node.id);
        changed = true;
      }
    }
  }
  return new Set(order.filter((id) => dirty.has(id)));
}

export function runRecalculation({ inputs, nodes, strategy = 'A', changedInputs = [], previousValues = {}, invariants = [] }) {
  if (!['A', 'B', 'C'].includes(strategy)) throw new TypeError('strategy must be A, B, or C');
  if (!Array.isArray(changedInputs) || changedInputs.some((x) => typeof x !== 'string')) {
    throw new TypeError('changedInputs must be an array of input names');
  }
  if (!isRecord(previousValues)) throw new TypeError('previousValues must be an object');
  if (!Array.isArray(invariants) || invariants.some((fn) => typeof fn !== 'function')) {
    throw new TypeError('invariants must be an array of functions');
  }
  // Validate change coordinates against canonical model inputs before selecting
  // nodes. An unknown coordinate must not become a successful no-op in B/C.
  assertModel(inputs, nodes);
  for (const name of changedInputs) {
    if (!Object.hasOwn(inputs, name)) throw new Error('UNKNOWN_CHANGED_INPUT:' + name);
  }
  const changed = new Set(changedInputs);
  const selected = strategy === 'A' ? allNodeIds(nodes) : impactedNodes(inputs, nodes, changed);
  // Full recomputation must not inherit cached values: removed/stale node IDs
  // are not part of the current projection and must not survive strategy A.
  const incremental = evaluateSelected(inputs, nodes, selected, strategy === 'A' ? {} : previousValues);
  const invariantFailures = [];
  for (let i = 0; i < invariants.length; i++) {
    let result;
    try { result = invariants[i](Object.freeze({ inputs, values: incremental.values })); }
    catch { result = false; }
    if (result !== true) invariantFailures.push({ index: i, code: 'INVARIANT_NOT_PROVEN' });
  }

  const mustFallback = strategy === 'C' &&
    (invariantFailures.length > 0 || incremental.violations.some((v) => v.code === 'UNDECLARED_READ'));
  if (mustFallback) {
    // Fallback A is a true rebuild, not a merge with the incremental cache.
    const full = evaluateSelected(inputs, nodes, allNodeIds(nodes), {});
    const fallbackFailures = [];
    for (let i = 0; i < invariants.length; i++) {
      let result;
      try { result = invariants[i](Object.freeze({ inputs, values: full.values })); }
      catch { result = false; }
      if (result !== true) fallbackFailures.push({ index: i, code: 'INVARIANT_NOT_PROVEN' });
    }
    return {
      strategy,
      executed: [...selected],
      values: full.values,
      readSets: { ...incremental.readSets, ...full.readSets },
      dependencyViolations: [...incremental.violations, ...full.violations],
      invariantFailures,
      fallback: { used: true, reason: invariantFailures.length ? 'INVARIANT_NOT_PROVEN' : 'UNDECLARED_READ' },
      fallbackInvariantFailures: fallbackFailures,
      status: fallbackFailures.length || full.violations.some((v) => v.code === 'UNDECLARED_READ') ? 'needs_review' : 'ready',
    };
  }

  return {
    strategy,
    executed: [...selected],
    values: incremental.values,
    readSets: incremental.readSets,
    dependencyViolations: incremental.violations,
    invariantFailures,
    fallback: { used: false, reason: null },
    fallbackInvariantFailures: [],
    status: invariantFailures.length || incremental.violations.some((v) => v.code === 'UNDECLARED_READ') ? 'needs_review' : 'ready',
  };
}

/**
 * Independent test oracle: compare the returned projection to a literal expected
 * projection authored separately from the graph. It intentionally does not
 * infer expected values from the graph or from another strategy's output.
 */
export function assertProjection(actual, expected) {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error('ORACLE_KEY_MISMATCH: expected ' + expectedKeys.join(',') + '; got ' + actualKeys.join(','));
  }
  for (const key of expectedKeys) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) {
      throw new Error('ORACLE_VALUE_MISMATCH:' + key + ': expected ' + JSON.stringify(expected[key]) + '; got ' + JSON.stringify(actual[key]));
    }
  }
}
