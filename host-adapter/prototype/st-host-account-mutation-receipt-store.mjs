import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_RECORD_BYTES = 4 * 1024 * 1024;
const OPERATIONS = new Map([
  ['POST /api/characters/edit', 'characters-edit'],
  ['POST /api/characters/create', 'characters-create'],
  ['POST /api/characters/edit-avatar', 'characters-edit-avatar'],
  ['POST /api/characters/edit-attribute', 'characters-edit-attribute'],
  ['POST /api/quick-replies/save', 'quick-replies-save'],
  ['POST /api/stats/update', 'stats-update'],
]);
const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const within = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
};
const safeRelative = value => typeof value === 'string' && value.length > 0 && value.length <= 1024
  && !value.includes('\\') && !value.startsWith('/')
  && value.split('/').every(part => part && part !== '.' && part !== '..');

function validateScope(scope) {
  if (!scope || !UUID.test(scope.host_installation_id ?? '')
    || !UUID.test(scope.authenticated_account_id ?? '')
    || !UUID.test(scope.host_session_id ?? '')
    || !UUID.test(scope.mutation_id ?? '')
    || !UUID.test(scope.event_id ?? '')
    || !SHA256.test(scope.mutation_digest ?? '')
    || typeof scope.route !== 'string'
    || OPERATIONS.get(scope.method + ' ' + scope.route) !== scope.operation) {
    throw new TypeError('HOST_ACCOUNT_MUTATION_SCOPE_INVALID');
  }
}

function normalizeInventory(inventory) {
  if (!inventory || inventory.status !== 'complete' || !Array.isArray(inventory.entries)) {
    throw new Error('HOST_ACCOUNT_MUTATION_INVENTORY_NON_READY');
  }
  const seen = new Set();
  const entries = inventory.entries.map(entry => {
    if (!entry || !safeRelative(entry.path) || !SHA256.test(entry.sha256 ?? '')
      || seen.has(entry.path)) throw new Error('HOST_ACCOUNT_MUTATION_INVENTORY_INVALID');
    seen.add(entry.path);
    return { path: entry.path, sha256: entry.sha256 };
  }).sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

function diffInventory(before, after) {
  const left = new Map(before.map(entry => [entry.path, entry.sha256]));
  const right = new Map(after.map(entry => [entry.path, entry.sha256]));
  const paths = [...new Set([...left.keys(), ...right.keys()])].sort();
  return paths.filter(filePath => left.get(filePath) !== right.get(filePath)).map(filePath => ({
    path: filePath,
    before_sha256: left.get(filePath) ?? null,
    after_sha256: right.get(filePath) ?? null,
  }));
}

/**
 * Account-root mutation receipts for pinned SillyTavern operations.
 *
 * The caller must run this protocol around the native route handler. The injected
 * inventory function must perform a complete, no-follow filesystem scan rooted
 * at the authenticated user's data directory. The receipt store deliberately
 * does not infer filesystem safety from request payloads.
 *
 * A per-account exclusive lock is held from prepare through commit/abort. A crash
 * leaves the lock behind and therefore fails closed; automatic stale-lock removal
 * is intentionally not attempted.
 */
export class HostAccountMutationReceiptStore {
  constructor({ directory, enumerate } = {}) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || typeof enumerate !== 'function') {
      throw new TypeError('HostAccountMutationReceiptStore requires an absolute protected directory and inventory enumerator.');
    }
    this.directory = path.resolve(directory);
    this.enumerate = enumerate;
  }

  async #ensureDirectory() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('HOST_ACCOUNT_MUTATION_STORE_UNSAFE');
  }

  #key(scope) {
    return digest(canonical({
      host_installation_id: scope.host_installation_id,
      authenticated_account_id: scope.authenticated_account_id,
      mutation_id: scope.mutation_id,
    }));
  }

  #paths(scope) {
    const key = this.#key(scope);
    const lockKey = digest(canonical({
      host_installation_id: scope.host_installation_id,
      authenticated_account_id: scope.authenticated_account_id,
    }));
    return {
      prepared: path.join(this.directory, key + '.prepared.json'),
      terminal: path.join(this.directory, key + '.terminal.json'),
      lock: path.join(this.directory, lockKey + '.account.lock'),
    };
  }

  async #read(filePath) {
    let handle;
    try {
      handle = await fs.open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
      const before = await handle.stat({ bigint: true });
      if (!before.isFile() || before.size > BigInt(MAX_RECORD_BYTES)) throw new Error('HOST_ACCOUNT_MUTATION_RECORD_INVALID');
      const bytes = await handle.readFile();
      const after = await handle.stat({ bigint: true });
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs || BigInt(bytes.length) !== after.size) {
        throw new Error('HOST_ACCOUNT_MUTATION_RECORD_CHANGED');
      }
      const record = JSON.parse(bytes.toString('utf8'));
      if (canonical(record) !== bytes.toString('utf8')) throw new Error('HOST_ACCOUNT_MUTATION_RECORD_NONCANONICAL');
      return record;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    } finally { await handle?.close().catch(() => {}); }
  }

  async #writeOnce(filePath, record) {
    const bytes = canonical(record);
    if (Buffer.byteLength(bytes) > MAX_RECORD_BYTES) throw new Error('HOST_ACCOUNT_MUTATION_RECORD_TOO_LARGE');
    const temporary = path.join(this.directory, '.tmp-' + randomUUID());
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(bytes, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.link(temporary, filePath);
      const directory = await fs.open(this.directory, fsConstants.O_RDONLY).catch(() => null);
      try { await directory?.sync(); } catch { /* Windows filesystems may not support directory fsync. */ }
      finally { await directory?.close().catch(() => {}); }
    } finally {
      await handle?.close().catch(() => {});
      await fs.unlink(temporary).catch(() => {});
    }
  }

  async #snapshot(directories, scope) {
    const inventory = await this.enumerate({ directories, scope });
    return normalizeInventory(inventory);
  }

  async prepare(scope, { directories, allowedPaths } = {}) {
    validateScope(scope);
    if (!Array.isArray(allowedPaths) || allowedPaths.length === 0
      || allowedPaths.some(item => !safeRelative(item)) || new Set(allowedPaths).size !== allowedPaths.length) {
      throw new TypeError('HOST_ACCOUNT_MUTATION_ALLOWED_PATHS_INVALID');
    }
    await this.#ensureDirectory();
    const paths = this.#paths(scope);
    // Reject known replays before taking the account-wide lock. The second
    // check below closes the race with another request using the same mutation id.
    if (await this.#read(paths.prepared) || await this.#read(paths.terminal)) {
      throw new Error('HOST_ACCOUNT_MUTATION_REPLAY');
    }
    if (!path.isAbsolute(directories?.root ?? '')) {
      throw new Error('HOST_ACCOUNT_MUTATION_ROOT_INVALID');
    }
    const realRoot = await fs.realpath(path.resolve(directories.root));
    const realStore = await fs.realpath(this.directory);
    const rootStat = await fs.stat(realRoot);
    if (!rootStat.isDirectory() || within(realRoot, realStore)) {
      throw new Error('HOST_ACCOUNT_MUTATION_STORE_MUST_BE_OUTSIDE_ROOT');
    }
    const lockToken = randomUUID();
    let lock;
    try {
      lock = await fs.open(paths.lock, 'wx', 0o600);
      await lock.writeFile(canonical({
        protocol_version: 1,
        lock_token: lockToken,
        host_installation_id: scope.host_installation_id,
        authenticated_account_id: scope.authenticated_account_id,
        mutation_id: scope.mutation_id,
      }), 'utf8');
      await lock.sync();
    } catch (error) {
      if (error?.code === 'EEXIST') throw new Error('HOST_ACCOUNT_MUTATION_BUSY_OR_RECOVERY_REQUIRED');
      throw error;
    } finally { await lock?.close().catch(() => {}); }

    try {
      if (await this.#read(paths.prepared) || await this.#read(paths.terminal)) {
        await fs.unlink(paths.lock);
        throw new Error('HOST_ACCOUNT_MUTATION_REPLAY');
      }
      const before = await this.#snapshot(directories, scope);
      const record = {
        protocol_version: 1,
        status: 'PREPARED',
        ...scope,
        allowed_paths: [...allowedPaths].sort(),
        lock_token: lockToken,
        before,
        before_digest: digest(canonical(before)),
        prepared_at: new Date().toISOString(),
      };
      await this.#writeOnce(paths.prepared, record);
      return Object.freeze({ status: 'PREPARED', lock_token: lockToken, mutation_id: scope.mutation_id });
    } catch (error) {
      // Retain the account lock: uncertainty after lock acquisition is a recovery gate.
      throw error;
    }
  }

  async commit(scope, { directories, lock_token } = {}) {
    validateScope(scope);
    if (!UUID.test(lock_token ?? '')) throw new TypeError('HOST_ACCOUNT_MUTATION_LOCK_TOKEN_INVALID');
    const paths = this.#paths(scope);
    const prepared = await this.#read(paths.prepared);
    if (!prepared || prepared.status !== 'PREPARED' || prepared.lock_token !== lock_token
      || prepared.mutation_digest !== scope.mutation_digest || prepared.operation !== scope.operation
      || prepared.route !== scope.route || prepared.event_id !== scope.event_id
      || prepared.host_installation_id !== scope.host_installation_id
      || prepared.authenticated_account_id !== scope.authenticated_account_id
      || prepared.host_session_id !== scope.host_session_id) {
      throw new Error('HOST_ACCOUNT_MUTATION_PREPARE_MISSING_OR_MISMATCHED');
    }
    const lock = await this.#read(paths.lock);
    if (!lock || lock.lock_token !== lock_token) throw new Error('HOST_ACCOUNT_MUTATION_LOCK_LOST');
    const after = await this.#snapshot(directories, scope);
    const changes = diffInventory(prepared.before, after);
    if (changes.length === 0 || changes.some(change => !prepared.allowed_paths.includes(change.path))) {
      throw new Error('HOST_ACCOUNT_MUTATION_PERSISTED_STATE_MISMATCH');
    }
    const receipt = {
      protocol_version: 1,
      host_installation_id: scope.host_installation_id,
      authenticated_account_id: scope.authenticated_account_id,
      host_session_id: scope.host_session_id,
      mutation_id: scope.mutation_id,
      event_id: scope.event_id,
      operation: scope.operation,
      route: scope.route,
      mutation_digest: scope.mutation_digest,
      before_digest: prepared.before_digest,
      after_digest: digest(canonical(after)),
      changes,
    };
    const terminal = {
      protocol_version: 1,
      status: 'COMMITTED',
      receipt,
      receipt_digest: digest(canonical(receipt)),
      committed_at: new Date().toISOString(),
    };
    await this.#writeOnce(paths.terminal, terminal);
    await fs.unlink(paths.lock);
    return { status: 'COMMITTED', receipt_digest: terminal.receipt_digest };
  }

  async abort(scope, { directories, lock_token } = {}) {
    validateScope(scope);
    if (!UUID.test(lock_token ?? '')) throw new TypeError('HOST_ACCOUNT_MUTATION_LOCK_TOKEN_INVALID');
    const paths = this.#paths(scope);
    const prepared = await this.#read(paths.prepared);
    const lock = await this.#read(paths.lock);
    if (!prepared || prepared.lock_token !== lock_token || !lock || lock.lock_token !== lock_token) {
      throw new Error('HOST_ACCOUNT_MUTATION_PREPARE_MISSING_OR_MISMATCHED');
    }
    const after = await this.#snapshot(directories, scope);
    if (canonical(after) !== canonical(prepared.before)) throw new Error('HOST_ACCOUNT_MUTATION_ABORT_STATE_CHANGED');
    const receipt = {
      protocol_version: 1,
      status: 'ABORTED',
      host_installation_id: scope.host_installation_id,
      authenticated_account_id: scope.authenticated_account_id,
      host_session_id: scope.host_session_id,
      mutation_id: scope.mutation_id,
      event_id: scope.event_id,
      operation: scope.operation,
      route: scope.route,
      mutation_digest: scope.mutation_digest,
      before_digest: prepared.before_digest,
      after_digest: digest(canonical(after)),
      outcome: 'VERIFIED_NO_CHANGE',
    };
    const terminal = { protocol_version: 1, status: 'ABORTED', receipt, receipt_digest: digest(canonical(receipt)) };
    await this.#writeOnce(paths.terminal, terminal);
    await fs.unlink(paths.lock);
    return { status: 'ABORTED', receipt_digest: terminal.receipt_digest };
  }

  async hasPending({ host_installation_id, authenticated_account_id }) {
    if (!UUID.test(host_installation_id ?? '') || !UUID.test(authenticated_account_id ?? '')) {
      throw new TypeError('HOST_ACCOUNT_MUTATION_IDENTITY_INVALID');
    }
    await this.#ensureDirectory();
    const lockKey = digest(canonical({ host_installation_id, authenticated_account_id }));
    try {
      const stat = await fs.lstat(path.join(this.directory, lockKey + '.account.lock'));
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('HOST_ACCOUNT_MUTATION_LOCK_UNSAFE');
      return true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    // A prepared record without its lock is an integrity failure, not readiness.
    const names = await fs.readdir(this.directory);
    for (const name of names.filter(item => item.endsWith('.prepared.json'))) {
      const record = await this.#read(path.join(this.directory, name));
      if (record?.host_installation_id === host_installation_id
        && record?.authenticated_account_id === authenticated_account_id) {
        const terminal = await this.#read(path.join(this.directory, name.replace(/\.prepared\.json$/, '.terminal.json')));
        if (!terminal || !['COMMITTED', 'ABORTED'].includes(terminal.status)) return true;
      }
    }
    return false;
  }
}
