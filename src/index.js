import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SQLiteStore } from './storage/sqlite-store.js';
import { LogicEngine } from './application/engine.js';
import { createApiServer } from './api/server.js';

const token = process.env.ENGINE_API_TOKEN;
const internalToken = process.env.ENGINE_INTERNAL_TOKEN || null;
const approvalToken = process.env.ENGINE_APPROVAL_TOKEN || null;
if (!token || token.length < 16) {
  process.stderr.write('ENGINE_API_TOKEN must be set and at least 16 characters long.\\n');
  process.exit(1);
}
for (const [name, value] of [['ENGINE_INTERNAL_TOKEN', internalToken], ['ENGINE_APPROVAL_TOKEN', approvalToken]]) {
  if (value !== null && value.length < 16) {
    process.stderr.write(name + ' must be at least 16 characters long when set.\\n');
    process.exit(1);
  }
}
if (internalToken && internalToken === token) throw new Error('ENGINE_INTERNAL_TOKEN must differ from ENGINE_API_TOKEN.');
if (approvalToken && (approvalToken === token || approvalToken === internalToken)) throw new Error('ENGINE_APPROVAL_TOKEN must differ from other configured tokens.');

const dbPath = process.env.ENGINE_DB_PATH || './data/logic-engine.sqlite';
if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
const port = Number(process.env.ENGINE_PORT || 8787), host = process.env.ENGINE_HOST || '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('ENGINE_PORT must be between 1 and 65535.');
if (!['127.0.0.1', '::1', 'localhost'].includes(host) && process.env.ENGINE_ALLOW_REMOTE !== 'true') throw new Error('Remote binding is disabled unless ENGINE_ALLOW_REMOTE=true.');

const store = new SQLiteStore(dbPath);
const server = createApiServer({ engine: new LogicEngine(store), token, internalToken, approvalToken });
server.listen(port, host, () => process.stdout.write(
  'Logic-Engine API listening on http://' + host + ':' + port + '\\nDatabase: ' + dbPath +
  '\\nDirect commit: ' + (internalToken ? 'enabled for internal credential' : 'disabled') +
  '\\nProposal approval: ' + (approvalToken ? 'enabled' : 'disabled') + '\\n',
));
function stop() { server.close(() => { store.close(); process.exit(0); }); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
