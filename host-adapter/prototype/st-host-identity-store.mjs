import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FILE_BYTES = 16 * 1024;
const validHandle = (value) => typeof value === 'string' && value.trim() === value
  && value.length > 0 && value.length <= 200
  && ![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

async function syncDirectory(directory) {
  let handle;
  try { handle = await fs.open(directory, fsConstants.O_RDONLY); await handle.sync(); }
  catch { /* Directory fsync is not available on every supported Windows filesystem. */ }
  finally { await handle?.close().catch(() => {}); }
}

/**
 * Server-owned persistent identity registry. Account handles are never stored;
 * their digest names an opaque account UUID file. Renaming an account produces
 * a new UUID and requires explicit re-enrollment. The protected directory is
 * deployment state and must not be restored independently of accepted-head
 * authority. This store is not itself rollback-resistant.
 */
export class HostIdentityStore {
  constructor({ directory, createId = randomUUID }) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || typeof createId !== 'function') {
      throw new TypeError('HostIdentityStore requires an absolute directory and ID generator.');
    }
    this.directory = path.resolve(directory);
    this.createId = createId;
  }

  async #prepareDirectory() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(this.directory).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error('HOST_IDENTITY_DIRECTORY_UNSAFE');
  }

  async #read(filePath) {
    let handle;
    try {
      const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
      handle = await fs.open(filePath, fsConstants.O_RDONLY | noFollow);
      const before = await handle.stat({ bigint: true });
      if (!before.isFile() || before.size > BigInt(MAX_FILE_BYTES)) throw new Error('HOST_IDENTITY_FILE_INVALID');
      const bytes = await handle.readFile();
      const after = await handle.stat({ bigint: true });
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs || BigInt(bytes.length) !== after.size) {
        throw new Error('HOST_IDENTITY_FILE_CHANGED');
      }
      let value;
      try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('HOST_IDENTITY_FILE_CORRUPT'); }
      return value;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    } finally { await handle?.close().catch(() => {}); }
  }

  async #create(filePath, value) {
    let handle;
    try {
      handle = await fs.open(filePath, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(value), 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await syncDirectory(this.directory);
      return value;
    } catch (error) {
      if (error?.code === 'EEXIST') return null;
      throw error;
    } finally { await handle?.close().catch(() => {}); }
  }

  #newId() {
    const value = this.createId();
    if (typeof value !== 'string' || !UUID.test(value)) throw new Error('HOST_IDENTITY_GENERATION_FAILED');
    return value;
  }

  async #getOrCreateInstallation() {
    const filePath = path.join(this.directory, 'installation.json');
    const existing = await this.#read(filePath);
    if (existing !== null) {
      if (!existing || Object.keys(existing).sort().join(',') !== 'installation_id,schema_version'
        || existing.schema_version !== 1 || !UUID.test(existing.installation_id)) {
        throw new Error('HOST_INSTALLATION_IDENTITY_CORRUPT');
      }
      return existing.installation_id;
    }
    const created = await this.#create(filePath, { schema_version: 1, installation_id: this.#newId() });
    return created ? created.installation_id : this.#getOrCreateInstallation();
  }

  async #getOrCreateAccount(handle) {
    const handleSha = sha256(handle);
    const filePath = path.join(this.directory, 'account-' + handleSha + '.json');
    const existing = await this.#read(filePath);
    if (existing !== null) {
      if (!existing || Object.keys(existing).sort().join(',') !== 'account_id,handle_sha256,schema_version'
        || existing.schema_version !== 1 || existing.handle_sha256 !== handleSha || !UUID.test(existing.account_id)) {
        throw new Error('HOST_ACCOUNT_IDENTITY_CORRUPT');
      }
      return existing.account_id;
    }
    const created = await this.#create(filePath, {
      schema_version: 1, handle_sha256: handleSha, account_id: this.#newId(),
    });
    return created ? created.account_id : this.#getOrCreateAccount(handle);
  }

  async resolveAuthenticatedAccount(handle) {
    if (!validHandle(handle)) throw new TypeError('Authenticated SillyTavern account handle is required.');
    await this.#prepareDirectory();
    const [hostInstallationId, authenticatedAccountId] = await Promise.all([
      this.#getOrCreateInstallation(), this.#getOrCreateAccount(handle),
    ]);
    return Object.freeze({
      host_installation_id: hostInstallationId,
      authenticated_account_id: authenticatedAccountId,
      identity_source: 'SERVER_PERSISTED_OPAQUE_IDENTITY',
    });
  }
}
