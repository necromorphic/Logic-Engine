import {
  AcceptedHeadAuthority,
  createAcceptedHeadAuthorityServer,
  closeAuthorityServer,
} from '../../src/security/accepted-head-authority.js';

const databasePath = process.env.LOGIC_ENGINE_ACCEPTED_HEAD_AUTHORITY_DB_PATH;
const installationId = process.env.LOGIC_ENGINE_ACCEPTED_HEAD_INSTALLATION_ID;
const coreToken = process.env.LOGIC_ENGINE_ACCEPTED_HEAD_CORE_TOKEN;
const providerToken = process.env.LOGIC_ENGINE_ACCEPTED_HEAD_PROVIDER_TOKEN;
const readToken = process.env.LOGIC_ENGINE_ACCEPTED_HEAD_READ_TOKEN;
const port = Number(process.env.LOGIC_ENGINE_ACCEPTED_HEAD_PORT);

function requiredText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

if (!requiredText(databasePath) || !requiredText(installationId)
  || !Number.isInteger(port) || port < 1 || port > 65535
  || typeof coreToken !== 'string' || coreToken.length < 32
  || typeof providerToken !== 'string' || providerToken.length < 32
  || typeof readToken !== 'string' || readToken.length < 32
  || new Set([coreToken, providerToken, readToken]).size !== 3) {
  process.stderr.write('ACCEPTED_HEAD_AUTHORITY_CONFIGURATION_INVALID\n');
  process.exitCode = 1;
} else {
  let authority;
  let server;
  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    try { await closeAuthorityServer(server); } catch {}
    try { authority?.close(); } catch {}
  };
  try {
    authority = new AcceptedHeadAuthority({ path: databasePath, installationId });
    server = createAcceptedHeadAuthorityServer({
      authority, coreToken, providerToken, readToken, host: '127.0.0.1', port,
    });
    server.on('error', () => {
      process.stderr.write('ACCEPTED_HEAD_AUTHORITY_START_FAILED\n');
      process.exitCode = 1;
      void stop();
    });
    server.listen(port, '127.0.0.1', () => {
      process.stdout.write(JSON.stringify({
        status: 'listening',
        host: '127.0.0.1',
        port,
      }) + '\n');
    });
    process.once('SIGINT', () => { void stop().finally(() => process.exit()); });
    process.once('SIGTERM', () => { void stop().finally(() => process.exit()); });
    // A controlled stdin command is useful for service wrappers and tests on
    // Windows, where POSIX signal delivery differs from Unix.
    let controlBuffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      controlBuffer += chunk;
      if (controlBuffer.length > 1024) {
        controlBuffer = '';
        return;
      }
      const lines = controlBuffer.split(/\r?\n/);
      controlBuffer = lines.pop() ?? '';
      if (lines.some((line) => line.trim() === 'stop')) {
        void stop().finally(() => process.exit());
      }
    });
  } catch {
    process.stderr.write('ACCEPTED_HEAD_AUTHORITY_START_FAILED\n');
    process.exitCode = 1;
    try { authority?.close(); } catch {}
  }
}
