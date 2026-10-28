import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function writeTestWorldPackCatalog(directory) {
  const artifactPath = join(directory, 'test-world-pack.json');
  const catalogPath = join(directory, 'world-pack-catalog.json');
  const bytes = Buffer.from(JSON.stringify({
    world_pack_id: 'test.world',
    version: '1.0.0',
    schema_version: 'test-fixture',
  }, null, 2) + '\n');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(artifactPath, bytes);
  writeFileSync(catalogPath, JSON.stringify({
    schema_version: 1,
    entries: [{
      world_pack_id: 'test.world',
      version: '1.0.0',
      artifact_path: 'test-world-pack.json',
      sha256,
    }],
  }, null, 2) + '\n');
  return catalogPath;
}
