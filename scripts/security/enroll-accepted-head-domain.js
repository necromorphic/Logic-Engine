import { enrollAcceptedHeadDomain } from '../../src/security/enroll-accepted-head-domain.js';

const domain = process.env.LOGIC_ENGINE_ACCEPTED_HEAD_DOMAIN;
const token = domain === 'core'
  ? process.env.LOGIC_ENGINE_ACCEPTED_HEAD_CORE_TOKEN
  : domain === 'provider'
    ? process.env.LOGIC_ENGINE_ACCEPTED_HEAD_PROVIDER_TOKEN
    : undefined;
const port = Number(process.env.LOGIC_ENGINE_ACCEPTED_HEAD_PORT);
const databasePath = process.env.LOGIC_ENGINE_ENROLL_DATABASE_PATH;
const coordinatorPath = process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
const approvalId = process.env.LOGIC_ENGINE_ACCEPTED_HEAD_APPROVAL_ID;
const baselineDigest = process.env.LOGIC_ENGINE_ACCEPTED_HEAD_BASELINE_DIGEST;

try {
  const result = enrollAcceptedHeadDomain({
    domain,
    databasePath,
    coordinatorPath,
    port,
    token,
    approvalId,
    baselineDigest,
  });
  process.stdout.write(JSON.stringify({
    status: result.status,
    domain: result.domain,
    head: result.head,
    approval_id: result.approval_id,
    operation_id: result.operation_id,
  }) + '\n');
} catch (error) {
  const code = typeof error?.message === 'string' && /^ACCEPTED_HEAD_[A-Z_]+$/.test(error.message)
    ? error.message : 'ACCEPTED_HEAD_ENROLLMENT_FAILED';
  process.stderr.write(code + '\n');
  process.exitCode = 1;
}
