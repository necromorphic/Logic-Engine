import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Test-only shared coordinator path, inherited by spawned runtime/test processes.
// Production startup requires an explicitly configured absolute path.
if (!process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH) {
  process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH = join(
    tmpdir(),
    'logic-engine-test-coordinator-' + process.pid + '.sqlite',
  );
}
