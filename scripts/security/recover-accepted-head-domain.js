import { recoverAcceptedHeadDomain } from '../../src/security/recover-accepted-head-domain.js';

const domain = process.env.LOGIC_ENGINE_ACCEPTED_HEAD_DOMAIN;
const token = domain === 'core'
  ? process.env.LOGIC_ENGINE_ACCEPTED_HEAD_CORE_TOKEN
  : domain === 'provider'
    ? process.env.LOGIC_ENGINE_ACCEPTED_HEAD_PROVIDER_TOKEN
    : undefined;
const port = Number(process.env.LOGIC_ENGINE_ACCEPTED_HEAD_PORT);
const databasePath = process.env.LOGIC_ENGINE_ENROLL_DATABASE_PATH;
const coordinatorPath = process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;

try {
  const result = recoverAcceptedHeadDomain({ domain, databasePath, coordinatorPath, port, token });
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  const code = typeof error?.message === 'string' && /^ACCEPTED_HEAD_[A-Z_]+$/.test(error.message)
    ? error.message : 'ACCEPTED_HEAD_RECOVERY_FAILED';
  process.stderr.write(code + '\n');
  process.exitCode = 1;
}
