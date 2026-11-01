#!/usr/bin/env node
import {
  inspectSillyTavernPatchTarget,
  installSillyTavernPatchPackage,
  recoverSillyTavernPatchTransaction,
  uninstallSillyTavernPatchPackage,
} from '../src/deployment/sillytavern-patch-manager.js';

function argumentsMap(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    if (!key?.startsWith('--') || typeof values[index + 1] !== 'string' || values[index + 1].startsWith('--')) {
      throw new Error('Arguments must be supplied as --name value pairs.');
    }
    const name = key.slice(2);
    if (Object.hasOwn(result, name)) throw new Error('Duplicate argument: ' + key);
    result[name] = values[index + 1];
  }
  return result;
}

function required(args, name) {
  if (!args[name]) throw new Error('Missing required argument --' + name + '.');
  return args[name];
}

try {
  const [command, ...rest] = process.argv.slice(2);
  const args = argumentsMap(rest);
  let result;
  if (command === 'inspect') {
    result = inspectSillyTavernPatchTarget(required(args, 'st'));
  } else if (command === 'install') {
    result = installSillyTavernPatchPackage({ stPath: required(args, 'st'), manifestPath: required(args, 'manifest') });
  } else if (command === 'uninstall') {
    result = uninstallSillyTavernPatchPackage({ stPath: required(args, 'st'), packageId: required(args, 'package') });
  } else if (command === 'recover') {
    result = recoverSillyTavernPatchTransaction(required(args, 'st'));
  } else {
    throw new Error('Command must be inspect, install, uninstall, or recover.');
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (error) {
  process.stderr.write('Patch Manager: ' + error.message + '\n');
  process.exitCode = 1;
}
