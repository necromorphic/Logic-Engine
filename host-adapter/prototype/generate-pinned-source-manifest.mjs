import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_INVENTORY_COVERAGE_ID, PINNED_HOST_COMMIT, SOURCE_FILE_PATHS } from '../extension-gateway/server-plugin/st-source-attestation.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = path.resolve(process.env.SILLYTAVERN_DIR || path.join(repoRoot, 'Sillytavern'));
const outputPath = path.join(sourceRoot, 'plugins', 'logic-engine-extension-gateway', 'pinned-source-manifest.json');

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const gitBlobSha = bytes => createHash('sha1')
  .update(Buffer.from('blob ' + bytes.length + '\0', 'utf8'))
  .update(bytes).digest('hex');

const actualCommit = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (actualCommit !== PINNED_HOST_COMMIT) {
  throw new Error('HOST_SOURCE_MANIFEST_REQUIRES_EXACT_PINNED_COMMIT');
}

const lifecyclePatch = await readFile(path.join(repoRoot, 'host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch'));
const rootMutationPatch = await readFile(path.join(repoRoot, 'host-adapter/prototype/patches/sillytavern-1.19.0-root-mutation-guards.patch'));
const handlerSource = await readFile(path.join(repoRoot, 'host-adapter/prototype/st-host-inventory-handler.mjs'));
const lifecycleBlobSha = gitBlobSha(lifecyclePatch);
const rootMutationBlobSha = gitBlobSha(rootMutationPatch);
const patchBlobSha = sha256(Buffer.from(lifecycleBlobSha + '\n' + rootMutationBlobSha, 'utf8'));
const handlerBlobSha = gitBlobSha(handlerSource);
const installedHandlerSource = await readFile(path.join(sourceRoot, 'plugins/logic-engine-extension-gateway/st-host-inventory-handler.mjs'));
if (gitBlobSha(installedHandlerSource) !== handlerBlobSha) {
  throw new Error('HOST_INSTALLED_HANDLER_DIFFERS_FROM_PINNED_HANDLER');
}

const files = [];
for (const relativePath of SOURCE_FILE_PATHS) {
  const absolutePath = path.resolve(sourceRoot, relativePath);
  const relative = path.relative(sourceRoot, absolutePath);
  if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('HOST_SOURCE_MANIFEST_PATH_ESCAPE');
  }
  files.push({ path: relativePath, sha256: sha256(await readFile(absolutePath)) });
}

const proof = {
  protocol_version: 1,
  pinned_host_commit: PINNED_HOST_COMMIT,
  coverage_id: HOST_INVENTORY_COVERAGE_ID,
  patch_blob_sha: patchBlobSha,
  host_handler_blob_sha: handlerBlobSha,
  files,
};
const manifest = { ...proof, manifest_sha256: sha256(Buffer.from(canonical(proof), 'utf8')) };
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
process.stdout.write('Pinned Host source manifest generated for ' + files.length + ' files.\n');
