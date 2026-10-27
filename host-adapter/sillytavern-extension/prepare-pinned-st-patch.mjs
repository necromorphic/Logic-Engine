import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const sourcePatch = resolve(repo, 'host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch');
const proxySource = resolve(repo, 'host-adapter/prototype/st-server-digest-proxy.mjs');
const output = resolve(here, 'patches/sillytavern-1.19.0-logic-engine-bridge.patch');

let patch = await readFile(sourcePatch, 'utf8');
const providerSpecificHunk = 'diff --git a/src/endpoints/backends/chat-completions.js b/src/endpoints/backends/chat-completions.js';
if (!patch.includes(providerSpecificHunk)) {
  throw new Error('Expected provider-specific hunk was not found; refusing to generate an unreviewed patch.');
}
patch = patch.slice(0, patch.indexOf(providerSpecificHunk)).trimEnd() + '\n\n';

const proxy = await readFile(proxySource, 'utf8');
const lines = proxy.trimEnd().split('\n');
patch += [
  'diff --git a/src/endpoints/logic-engine-lifecycle-proxy.mjs b/src/endpoints/logic-engine-lifecycle-proxy.mjs',
  'new file mode 100644',
  'index 0000000..0000000',
  '--- /dev/null',
  '+++ b/src/endpoints/logic-engine-lifecycle-proxy.mjs',
  `@@ -0,0 +1,${lines.length} @@`,
  ...lines.map(line => '+' + line),
  '',
].join('\n');

await writeFile(output, patch, 'utf8');
process.stdout.write(`Generated provider-neutral pinned ST patch: ${output}\n`);
