import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { SQLiteStore } from './storage/sqlite-store.js';
import { LogicEngine } from './application/engine.js';
import { createApiServer } from './api/server.js';
import { HostVersionDigestLedger } from './application/host-version-digest-ledger.js';
import { parseHealthAllowedOrigins } from './api/health-cors.js';

const token = process.env.ENGINE_API_TOKEN;
const internalToken = process.env.ENGINE_INTERNAL_TOKEN || null;
const approvalToken = process.env.ENGINE_APPROVAL_TOKEN || null;
const adminToken = process.env.ENGINE_ADMIN_TOKEN || null;
let adapterTokens = {};
try { adapterTokens = JSON.parse(process.env.ENGINE_ADAPTER_TOKENS || '{}'); } catch { throw new Error('ENGINE_ADAPTER_TOKENS must be a JSON object mapping adapter IDs to secrets.'); }
if (!adapterTokens || typeof adapterTokens !== 'object' || Array.isArray(adapterTokens)) throw new Error('ENGINE_ADAPTER_TOKENS must be a JSON object mapping adapter IDs to secrets.');
if (!token || token.length < 16) {
  process.stderr.write('ENGINE_API_TOKEN must be set and at least 16 characters long.\n');
  process.exit(1);
}
for (const [name, value] of [['ENGINE_INTERNAL_TOKEN', internalToken], ['ENGINE_APPROVAL_TOKEN', approvalToken], ['ENGINE_ADMIN_TOKEN', adminToken]]) {
  if (value !== null && value.length < 16) {
    process.stderr.write(name + ' must be at least 16 characters long when set.\n');
    process.exit(1);
  }
}
if (internalToken && internalToken === token) throw new Error('ENGINE_INTERNAL_TOKEN must differ from ENGINE_API_TOKEN.');
if (approvalToken && (approvalToken === token || approvalToken === internalToken || approvalToken === adminToken)) throw new Error('ENGINE_APPROVAL_TOKEN must differ from other configured tokens.');
if (adminToken && [token, internalToken, approvalToken].includes(adminToken)) throw new Error('ENGINE_ADMIN_TOKEN must differ from other configured tokens.');
const configuredAdapterSecrets = Object.values(adapterTokens);
if (new Set(configuredAdapterSecrets).size !== configuredAdapterSecrets.length) throw new Error('ENGINE_ADAPTER_TOKENS secrets must be unique per adapter.');
for (const [id, secret] of Object.entries(adapterTokens)) {
  if (!id.trim() || typeof secret !== 'string' || secret.length < 16 || [token, internalToken, approvalToken, adminToken].includes(secret)) throw new Error('Each ENGINE_ADAPTER_TOKENS entry must have a non-empty ID and a distinct secret of at least 16 characters.');
}

function aliasesSameFile(left, right) {
  const identity = (value) => {
    const absolute = resolve(value);
    if (existsSync(absolute)) {
      try {
        const stat = statSync(absolute);
        return 'inode:' + stat.dev + ':' + stat.ino;
      } catch {}
    }
    try { return 'path:' + realpathSync(absolute); } catch {}
    try { return 'path:' + join(realpathSync(dirname(absolute)), basename(absolute)); } catch {}
    return 'path:' + absolute;
  };
  return identity(left) === identity(right);
}

const dbPath = process.env.ENGINE_DB_PATH || './data/logic-engine.sqlite';
const coordinatorPath = process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
if (typeof coordinatorPath !== 'string' || !coordinatorPath.trim() || !isAbsolute(coordinatorPath)) {
  process.stderr.write('LOGIC_ENGINE_COORDINATOR_DB_PATH must be set to an absolute path for runtime.\n');
  process.exit(1);
}
if (dbPath !== ':memory:' && aliasesSameFile(dbPath, coordinatorPath)) {
  throw new Error('LOGIC_ENGINE_COORDINATOR_DB_PATH must be separate from ENGINE_DB_PATH, including filesystem aliases.');
}
if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
const port = Number(process.env.ENGINE_PORT || 8787), host = process.env.ENGINE_HOST || '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('ENGINE_PORT must be between 1 and 65535.');
if (!['127.0.0.1', '::1', 'localhost'].includes(host) && process.env.ENGINE_ALLOW_REMOTE !== 'true') throw new Error('Remote binding is disabled unless ENGINE_ALLOW_REMOTE=true.');

const store = new SQLiteStore(dbPath);
const hostVersionLedgerPath = process.env.ENGINE_HOST_VERSION_LEDGER_DB_PATH
  ? resolve(process.env.ENGINE_HOST_VERSION_LEDGER_DB_PATH)
  : resolve('./data/logic-engine-host-versions.sqlite');
if (dbPath !== ':memory:' && aliasesSameFile(hostVersionLedgerPath, dbPath)) {
  throw new Error('ENGINE_HOST_VERSION_LEDGER_DB_PATH must be separate from ENGINE_DB_PATH, including filesystem aliases.');
}
if (aliasesSameFile(hostVersionLedgerPath, coordinatorPath)) {
  throw new Error('ENGINE_HOST_VERSION_LEDGER_DB_PATH must be separate from LOGIC_ENGINE_COORDINATOR_DB_PATH, including filesystem aliases.');
}
// This deny-only verifier is deliberately not source authority. Until the trusted
// Host/Core complete-inventory adapter is wired, reconciliation can never set READY.
const hostVersionLedger = new HostVersionDigestLedger({
  path: hostVersionLedgerPath,
  coordinatorPath,
  verifyInventorySnapshot: async () => false,
});
const server = createApiServer({
  engine: new LogicEngine(store), token, internalToken, approvalToken, adminToken, adapterTokens,
  hostVersionLedger,
  healthAllowedOrigins: parseHealthAllowedOrigins(process.env.ENGINE_HEALTH_ALLOWED_ORIGINS || ''),
});
server.listen(port, host, () => process.stdout.write(
  'Logic-Engine API listening on http://' + host + ':' + port + '\nDatabase: ' + dbPath +
  '\nDirect commit: ' + (internalToken ? 'enabled for internal credential' : 'disabled') +
  '\nProposal approval: ' + (approvalToken ? 'enabled' : 'disabled') + '\nAdmin registry: ' + (adminToken ? 'enabled' : 'disabled') + '\nConfigured adapters: ' + Object.keys(adapterTokens).length + '\n',
));
function stop() { server.close(() => { try { hostVersionLedger.close(); } finally { store.close(); process.exit(0); } }); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
