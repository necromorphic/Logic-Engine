import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PINNED_LOGIC_ENGINE_PLUGIN_GIT_BLOB_SHAS } from '../host-adapter/extension-gateway/server-plugin/st-source-attestation.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--plugin-root');
const rootArgument = rootIndex >= 0 ? args[rootIndex + 1] : undefined;
const pluginRoot = typeof rootArgument === 'string' && rootArgument.length ? path.resolve(rootArgument) : null;
if (!pluginRoot) {
  process.stderr.write('Usage: node scripts/verify-host-plugin-pins.mjs --plugin-root <repository-or-plugin-root>\n');
  process.exit(2);
}

function gitBlobSha(bytes) {
  const normalized = Buffer.from(bytes.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8');
  return createHash('sha1')
    .update(Buffer.from('blob ' + normalized.length + '\0', 'utf8'))
    .update(normalized)
    .digest('hex');
}

const failures = [];
for (const [relativePath, expected] of Object.entries(PINNED_LOGIC_ENGINE_PLUGIN_GIT_BLOB_SHAS)) {
  const target = path.resolve(pluginRoot, relativePath);
  const relative = path.relative(pluginRoot, target);
  if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    failures.push({ path: relativePath, code: 'PATH_ESCAPE' });
    continue;
  }
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) {
      failures.push({ path: relativePath, code: 'NOT_REGULAR_FILE' });
      continue;
    }
    const actual = gitBlobSha(await readFile(target));
    if (actual !== expected) failures.push({ path: relativePath, code: 'PIN_MISMATCH', expected, actual });
  } catch {
    failures.push({ path: relativePath, code: 'FILE_UNAVAILABLE' });
  }
}

if (failures.length) {
  process.stderr.write(JSON.stringify({
    status: 'DENY_FAIL_CLOSED',
    code: 'HOST_PLUGIN_PIN_PREFLIGHT_FAILED',
    failures,
  }) + '\n');
  process.exit(1);
}

process.stdout.write(JSON.stringify({
  status: 'HOST_PLUGIN_PINS_VERIFIED',
  verifiedFileCount: Object.keys(PINNED_LOGIC_ENGINE_PLUGIN_GIT_BLOB_SHAS).length,
}) + '\n');
