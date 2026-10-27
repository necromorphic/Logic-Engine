import { DatabaseSync } from 'node:sqlite';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createServer } from 'node:http';

const DOMAINS = new Set(['core', 'provider']);
const validText = (value, max = 200) => typeof value === 'string'
  && value.length > 0
  && value.length <= max
  && value === value.trim()
  && ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });

function canonicalPath(path) {
  const absolute = resolve(path);
  let candidate = absolute;
  const suffix = [];
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) throw new TypeError('Cannot resolve authority database path.');
    suffix.unshift(candidate.slice(parent.length).replace(/^[/\\\\]+/, ''));
    candidate = parent;
  }
  return resolve(realpathSync(candidate), ...suffix);
}

function safeTokenEqual(expected, received) {
  if (typeof expected !== 'string' || expected.length < 32 || typeof received !== 'string') return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Durable monotonic accepted-head store.
 *
 * Deployment contract: this DB must be writable only by the authority service
 * identity. Core/Provider clients use the authenticated authority IPC, never
 * direct DB writes. The class itself does not create OS ACLs or install a service.
 */
export class AcceptedHeadAuthority {
  #db;
  #installationId;

  constructor({ path, installationId }) {
    if (typeof path !== 'string' || !path.trim() || path === ':memory:' || !path.startsWith('/') && !/^[A-Za-z]:[\\\\/]/.test(path)) {
      throw new TypeError('Accepted-head database path must be absolute and file-backed.');
    }
    if (!validText(installationId, 160)) throw new TypeError('A stable installation identity is required.');
    this.#installationId = installationId;
    const absolutePath = canonicalPath(path);
    const wasExisting = existsSync(absolutePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    this.#db = new DatabaseSync(absolutePath);
    try {
      this.#db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      if (!wasExisting) {
        this.#db.exec(`
          CREATE TABLE authority_installation (
            singleton INTEGER PRIMARY KEY CHECK (singleton=1),
            installation_id TEXT NOT NULL
          );
          CREATE TABLE authority_domain_heads (
            domain TEXT PRIMARY KEY CHECK (domain IN ('core','provider')),
            head INTEGER NOT NULL CHECK (head >= 0),
            enrolled INTEGER NOT NULL DEFAULT 0 CHECK (enrolled IN (0,1))
          );
          CREATE TABLE authority_operations (
            operation_id TEXT PRIMARY KEY,
            domain TEXT NOT NULL CHECK (domain IN ('core','provider')),
            resulting_head INTEGER NOT NULL CHECK (resulting_head > 0),
            operation_digest TEXT NOT NULL,
            operation_kind TEXT NOT NULL CHECK (operation_kind IN ('enroll','mutation')),
            status TEXT NOT NULL CHECK (status IN ('pending','committed')),
            created_at TEXT NOT NULL
          );
        `);
        this.#db.exec('BEGIN IMMEDIATE;');
        try {
          this.#db.prepare('INSERT INTO authority_installation(singleton, installation_id) VALUES(1, ?)').run(installationId);
          this.#db.prepare('INSERT INTO authority_domain_heads(domain, head, enrolled) VALUES(?, 0, 0)').run('core');
          this.#db.prepare('INSERT INTO authority_domain_heads(domain, head, enrolled) VALUES(?, 0, 0)').run('provider');
          this.#db.exec('COMMIT;');
        } catch (error) {
          try { this.#db.exec('ROLLBACK;'); } catch {}
          throw error;
        }
      } else {
        const requiredTables = ['authority_installation', 'authority_domain_heads', 'authority_operations'];
        const existingTables = new Set(this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
        if (requiredTables.some((table) => !existingTables.has(table))) {
          throw new Error('ACCEPTED_HEAD_SCHEMA_INCOMPLETE');
        }
        const requiredColumns = {
          authority_installation: ['singleton', 'installation_id'],
          authority_domain_heads: ['domain', 'head', 'enrolled'],
          authority_operations: ['operation_id', 'domain', 'resulting_head', 'operation_digest', 'operation_kind', 'status', 'created_at'],
        };
        for (const [table, columns] of Object.entries(requiredColumns)) {
          const actual = new Set(this.#db.prepare('PRAGMA table_info(' + table + ')').all().map((row) => row.name));
          if (columns.some((column) => !actual.has(column))) throw new Error('ACCEPTED_HEAD_SCHEMA_INCOMPLETE');
        }
        const installationRows = this.#db.prepare('SELECT installation_id FROM authority_installation WHERE singleton=1').all();
        const domainRows = this.#db.prepare('SELECT domain, head, enrolled FROM authority_domain_heads ORDER BY domain').all();
        if (installationRows.length !== 1 || installationRows[0].installation_id !== installationId
          || domainRows.length !== 2
          || domainRows[0].domain !== 'core' || domainRows[1].domain !== 'provider'
          || domainRows.some((row) => !Number.isSafeInteger(row.head) || row.head < 0 || ![0, 1].includes(row.enrolled))) {
          throw new Error(installationRows.length === 1 && installationRows[0].installation_id !== installationId
            ? 'ACCEPTED_HEAD_INSTALLATION_MISMATCH' : 'ACCEPTED_HEAD_STATE_INVALID');
        }
        const inconsistent = this.#db.prepare(`
          SELECT h.domain FROM authority_domain_heads h
          WHERE h.head <> COALESCE((SELECT MAX(o.resulting_head) FROM authority_operations o WHERE o.domain=h.domain), 0)
             OR (h.enrolled=0 AND h.head<>0)
             OR (h.enrolled=1 AND h.head=0)
          LIMIT 1
        `).get();
        if (inconsistent) throw new Error('ACCEPTED_HEAD_STATE_INVALID');
      }
    } catch (error) {
      try { this.#db.close(); } catch {}
      if (error?.message === 'ACCEPTED_HEAD_INSTALLATION_MISMATCH') throw error;
      throw error;
    }
  }

  getHeads() {
    const rows = this.#db.prepare('SELECT domain, head FROM authority_domain_heads ORDER BY domain').all();
    const heads = Object.fromEntries(rows.map((row) => [row.domain, row.head]));
    if (!Number.isSafeInteger(heads.core) || !Number.isSafeInteger(heads.provider)) {
      throw new Error('ACCEPTED_HEAD_STATE_INVALID');
    }
    return Object.freeze({ core: heads.core, provider: heads.provider });
  }

  getPendingDomains() {
    const rows = this.#db.prepare("SELECT domain FROM authority_operations WHERE status='pending' GROUP BY domain").all();
    const pending = { core: false, provider: false };
    for (const row of rows) {
      if (!DOMAINS.has(row.domain)) throw new Error('ACCEPTED_HEAD_STATE_INVALID');
      pending[row.domain] = true;
    }
    return Object.freeze(pending);
  }

  getPendingOperations() {
    const rows = this.#db.prepare(`
      SELECT domain, operation_id, resulting_head, operation_digest, operation_kind
      FROM authority_operations
      WHERE status='pending'
      ORDER BY domain
    `).all();
    const operations = { core: null, provider: null };
    for (const row of rows) {
      if (!DOMAINS.has(row.domain) || operations[row.domain] !== null
        || !Number.isSafeInteger(row.resulting_head) || !/^[a-f0-9]{64}$/.test(row.operation_digest)) {
        throw new Error('ACCEPTED_HEAD_STATE_INVALID');
      }
      operations[row.domain] = Object.freeze({
        operation_id: row.operation_id,
        head: row.resulting_head,
        operation_digest: row.operation_digest,
        operation_kind: row.operation_kind,
      });
    }
    return Object.freeze(operations);
  }

  getEnrollmentStatus() {
    const rows = this.#db.prepare('SELECT domain, enrolled FROM authority_domain_heads ORDER BY domain').all();
    const enrolled = Object.fromEntries(rows.map((row) => [row.domain, row.enrolled === 1]));
    if (typeof enrolled.core !== 'boolean' || typeof enrolled.provider !== 'boolean') {
      throw new Error('ACCEPTED_HEAD_STATE_INVALID');
    }
    return Object.freeze({ core: enrolled.core, provider: enrolled.provider });
  }

  enroll({ domain, operationId, operationDigest, expectedHead }) {
    if (!DOMAINS.has(domain) || !validText(operationId, 200)
      || typeof operationDigest !== 'string' || !/^[a-f0-9]{64}$/.test(operationDigest)
      || expectedHead !== 0) {
      throw new TypeError('Invalid accepted-head enrollment request.');
    }
    this.#db.exec('BEGIN IMMEDIATE;');
    try {
      const existing = this.#db.prepare(
        'SELECT domain, resulting_head, operation_digest, operation_kind, status FROM authority_operations WHERE operation_id=?',
      ).get(operationId);
      if (existing) {
        if (existing.domain !== domain || existing.operation_digest !== operationDigest || existing.operation_kind !== 'enroll') {
          throw new Error('ACCEPTED_HEAD_OPERATION_ID_CONFLICT');
        }
        if (existing.status !== 'committed') throw new Error('ACCEPTED_HEAD_OPERATION_PENDING');
        this.#db.exec('COMMIT;');
        return Object.freeze({ domain, head: existing.resulting_head, operation_id: operationId, replayed: true, status: 'committed' });
      }
      const row = this.#db.prepare('SELECT head, enrolled FROM authority_domain_heads WHERE domain=?').get(domain);
      if (!row || row.head !== 0 || row.enrolled !== 0) throw new Error('ACCEPTED_HEAD_ALREADY_ENROLLED');
      const pending = this.#db.prepare("SELECT operation_id FROM authority_operations WHERE domain=? AND status='pending' LIMIT 1").get(domain);
      if (pending) throw new Error('ACCEPTED_HEAD_OPERATION_PENDING');
      this.#db.prepare('UPDATE authority_domain_heads SET head=1 WHERE domain=?').run(domain);
      this.#db.prepare(
        'INSERT INTO authority_operations(operation_id, domain, resulting_head, operation_digest, operation_kind, status, created_at) VALUES(?,?,?,?,?,?,?)',
      ).run(operationId, domain, 1, operationDigest, 'enroll', 'pending', new Date().toISOString());
      this.#db.exec('COMMIT;');
      return Object.freeze({ domain, head: 1, operation_id: operationId, replayed: false, status: 'pending' });
    } catch (error) {
      try { this.#db.exec('ROLLBACK;'); } catch {}
      throw error;
    }
  }

  advance({ domain, operationId, operationDigest, expectedHead }) {
    if (!DOMAINS.has(domain) || !validText(operationId, 200)
      || typeof operationDigest !== 'string' || !/^[a-f0-9]{64}$/.test(operationDigest)
      || !Number.isSafeInteger(expectedHead) || expectedHead < 0) {
      throw new TypeError('Invalid accepted-head advance request.');
    }
    this.#db.exec('BEGIN IMMEDIATE;');
    try {
      const existing = this.#db.prepare(
        'SELECT domain, resulting_head, operation_digest, operation_kind, status FROM authority_operations WHERE operation_id=?',
      ).get(operationId);
      if (existing) {
        if (existing.domain !== domain || existing.operation_digest !== operationDigest || existing.operation_kind !== 'mutation') throw new Error('ACCEPTED_HEAD_OPERATION_ID_CONFLICT');
        if (existing.status !== 'committed') throw new Error('ACCEPTED_HEAD_OPERATION_PENDING');
        this.#db.exec('COMMIT;');
        return Object.freeze({ domain, head: existing.resulting_head, operation_id: operationId, replayed: true, status: 'committed' });
      }
      const row = this.#db.prepare('SELECT head, enrolled FROM authority_domain_heads WHERE domain=?').get(domain);
      if (!row || row.enrolled !== 1) throw new Error('ACCEPTED_HEAD_NOT_ENROLLED');
      if (!Number.isSafeInteger(row.head) || row.head < 0 || row.head >= Number.MAX_SAFE_INTEGER) {
        throw new Error('ACCEPTED_HEAD_STATE_INVALID');
      }
      if (row.head !== expectedHead) throw new Error('ACCEPTED_HEAD_HEAD_MISMATCH');
      const pending = this.#db.prepare("SELECT operation_id FROM authority_operations WHERE domain=? AND status='pending' LIMIT 1").get(domain);
      if (pending) throw new Error('ACCEPTED_HEAD_OPERATION_PENDING');
      const next = row.head + 1;
      this.#db.prepare('UPDATE authority_domain_heads SET head=? WHERE domain=?').run(next, domain);
      this.#db.prepare(
        'INSERT INTO authority_operations(operation_id, domain, resulting_head, operation_digest, operation_kind, status, created_at) VALUES(?,?,?,?,?,?,?)',
      ).run(operationId, domain, next, operationDigest, 'mutation', 'pending', new Date().toISOString());
      this.#db.exec('COMMIT;');
      return Object.freeze({ domain, head: next, operation_id: operationId, replayed: false, status: 'pending' });
    } catch (error) {
      try { this.#db.exec('ROLLBACK;'); } catch {}
      throw error;
    }
  }

  finalize({ domain, operationId, operationDigest }) {
    if (!DOMAINS.has(domain) || !validText(operationId, 200)
      || typeof operationDigest !== 'string' || !/^[a-f0-9]{64}$/.test(operationDigest)) {
      throw new TypeError('Invalid accepted-head finalize request.');
    }
    this.#db.exec('BEGIN IMMEDIATE;');
    try {
      const row = this.#db.prepare(
        'SELECT domain, operation_digest, operation_kind, status, resulting_head FROM authority_operations WHERE operation_id=?',
      ).get(operationId);
      if (!row || row.domain !== domain || row.operation_digest !== operationDigest) {
        throw new Error('ACCEPTED_HEAD_OPERATION_ID_CONFLICT');
      }
      if (row.status === 'pending') {
        this.#db.prepare("UPDATE authority_operations SET status='committed' WHERE operation_id=?").run(operationId);
        if (row.operation_kind === 'enroll') {
          this.#db.prepare('UPDATE authority_domain_heads SET enrolled=1 WHERE domain=?').run(domain);
        }
      }
      this.#db.exec('COMMIT;');
      return Object.freeze({
        domain, head: row.resulting_head, operation_id: operationId,
        replayed: row.status === 'committed', status: 'committed',
      });
    } catch (error) {
      try { this.#db.exec('ROLLBACK;'); } catch {}
      throw error;
    }
  }

  close() {
    this.#db.close();
  }
}

/**
 * Create the local authority HTTP endpoint. Bind only to loopback. Deployment
 * must protect the service DB with a distinct service identity and provide
 * distinct 256-bit-or-stronger tokens to the Core and Provider service accounts.
 * The endpoint does not dispatch model requests or return stored Memory content.
 */
export function createAcceptedHeadAuthorityServer({
  authority,
  coreToken,
  providerToken,
  host = '127.0.0.1',
  port = 0,
  maxBodyBytes = 4096,
}) {
  if (!(authority instanceof AcceptedHeadAuthority)) throw new TypeError('An accepted-head authority store is required.');
  if (host !== '127.0.0.1') throw new TypeError('Accepted-head authority must bind to IPv4 loopback only.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid authority port.');
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 256 || maxBodyBytes > 65536) {
    throw new TypeError('Invalid authority request-size limit.');
  }
  if (typeof coreToken !== 'string' || coreToken.length < 32
    || typeof providerToken !== 'string' || providerToken.length < 32
    || coreToken === providerToken) {
    throw new TypeError('Distinct strong Core and Provider authority tokens are required.');
  }
  const tokens = { core: coreToken, provider: providerToken };

  const reply = (response, status, payload) => {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'connection': 'close',
    });
    response.end(JSON.stringify(payload));
  };

  return createServer((request, response) => {
    response.setTimeout(2000, () => response.destroy());
    if (request.method === 'GET' && request.url === '/v1/heads') {
      const token = request.headers.authorization?.startsWith('Bearer ')
        ? request.headers.authorization.slice(7) : '';
      if (!safeTokenEqual(tokens.core, token) && !safeTokenEqual(tokens.provider, token)) {
        reply(response, 403, { error: 'DENIED' });
        return;
      }
      try {
        reply(response, 200, { heads: authority.getHeads(), pending: authority.getPendingDomains(), operations: authority.getPendingOperations(), enrolled: authority.getEnrollmentStatus() });
      } catch {
        reply(response, 503, { error: 'AUTHORITY_UNAVAILABLE' });
      }
      return;
    }
    if (request.method !== 'POST' || !['/v1/enroll', '/v1/advance', '/v1/finalize'].includes(request.url)) {
      reply(response, 404, { error: 'NOT_FOUND' });
      return;
    }

    let body = '';
    let overflow = false;
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > maxBodyBytes) {
        overflow = true;
        reply(response, 413, { error: 'REQUEST_TOO_LARGE' });
        request.destroy();
      }
    });
    request.on('end', () => {
      if (overflow || response.writableEnded) return;
      let input;
      try { input = JSON.parse(body); } catch {
        reply(response, 400, { error: 'INVALID_REQUEST' });
        return;
      }
      const domain = input?.domain;
      const token = request.headers.authorization?.startsWith('Bearer ')
        ? request.headers.authorization.slice(7) : '';
      if (!DOMAINS.has(domain) || !safeTokenEqual(tokens[domain], token)) {
        reply(response, 403, { error: 'DENIED' });
        return;
      }
      try {
        const result = request.url === '/v1/enroll'
          ? authority.enroll({ domain, operationId: input.operation_id, operationDigest: input.operation_digest, expectedHead: input.expected_head })
          : request.url === '/v1/advance'
            ? authority.advance({ domain, operationId: input.operation_id, operationDigest: input.operation_digest, expectedHead: input.expected_head })
            : authority.finalize({ domain, operationId: input.operation_id, operationDigest: input.operation_digest });
        reply(response, 200, { result });
      } catch (error) {
        if (error?.message === 'ACCEPTED_HEAD_OPERATION_ID_CONFLICT') {
          reply(response, 409, { error: 'OPERATION_ID_CONFLICT' });
        } else if (error?.message === 'ACCEPTED_HEAD_OPERATION_PENDING') {
          reply(response, 409, { error: 'OPERATION_PENDING' });
        } else if (error?.message === 'ACCEPTED_HEAD_HEAD_MISMATCH') {
          reply(response, 409, { error: 'HEAD_MISMATCH' });
        } else if (error?.message === 'ACCEPTED_HEAD_NOT_ENROLLED') {
          reply(response, 409, { error: 'NOT_ENROLLED' });
        } else if (error?.message === 'ACCEPTED_HEAD_ALREADY_ENROLLED') {
          reply(response, 409, { error: 'ALREADY_ENROLLED' });
        } else if (error instanceof TypeError) {
          reply(response, 400, { error: 'INVALID_REQUEST' });
        } else {
          reply(response, 503, { error: 'AUTHORITY_UNAVAILABLE' });
        }
      }
    });
    request.on('error', () => {
      if (!response.writableEnded) reply(response, 400, { error: 'INVALID_REQUEST' });
    });
  });
}

export function closeAuthorityServer(server) {
  return new Promise((resolveClose, reject) => {
    if (!server.listening) return resolveClose();
    server.close((error) => error ? reject(error) : resolveClose());
  });
}
