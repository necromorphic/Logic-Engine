import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Test-only default. Each npm test invocation gets an absolute coordinator path,
// inherited by its child processes. Production startup still requires explicit config.
if (!process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH) {
  process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = join(
    tmpdir(),
    'logic-engine-test-coordinator-' + process.pid + '.sqlite',
  );
}
