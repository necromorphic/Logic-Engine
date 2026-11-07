import assert from 'node:assert/strict';
import { test } from 'node:test';

test('ST-VectorService POSIX bootstrap fails closed on Windows', {
  skip: process.platform !== 'win32',
}, async () => {
  await assert.rejects(
    import('../integrations/st-vectorservice/logic-engine-vfs-bootstrap.mjs'),
    /requires Linux POSIX broker support; Windows lifecycle integration is not available/i,
  );
});
