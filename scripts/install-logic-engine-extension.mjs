import { resolve } from 'node:path';
import { SillyTavernPatchManager } from './sillytavern-patch-manager.mjs';

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--st-root') options.stRoot = argv[++index];
    else throw new Error('UNKNOWN_ARGUMENT: ' + argv[index]);
  }
  options.stRoot ??= process.env.LOGIC_ENGINE_SILLYTAVERN_ROOT;
  if (typeof options.stRoot !== 'string' || !options.stRoot.trim()) {
    throw new Error('LOGIC_ENGINE_SILLYTAVERN_ROOT_OR_ST_ROOT_REQUIRED');
  }
  return options;
}

// This is the Logic-Engine Extension deployment entrypoint. The Extension
// installer must invoke it as part of installation; it is intentionally not
// an ST server plugin or a separate resident process.
try {
  const { stRoot } = parseArgs(process.argv.slice(2));
  const manager = new SillyTavernPatchManager({
    extensionRoot: resolve(process.cwd()),
    stRoot: resolve(stRoot),
  });
  const result = await manager.execute('install');
  process.stdout.write(JSON.stringify({ component: 'logic-engine-extension', patchManager: result }) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ status: 'DENY_FAIL_CLOSED', code: error.message }) + '\n');
  process.exitCode = 1;
}
