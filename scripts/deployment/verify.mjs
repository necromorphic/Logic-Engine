import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assessDeployment } from '../../src/deployment/index.js';

const manifestPath = process.env.LOGIC_ENGINE_DEPLOYMENT_MANIFEST;
const deploymentRoot = process.env.LOGIC_ENGINE_DEPLOYMENT_ROOT;
if (!manifestPath || !deploymentRoot) {
  process.stderr.write('Set LOGIC_ENGINE_DEPLOYMENT_MANIFEST and LOGIC_ENGINE_DEPLOYMENT_ROOT.\n');
  process.exit(2);
}

try {
  const manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8'));
  const result = await assessDeployment({ manifest, deploymentRoot });
  process.stdout.write(JSON.stringify(result.report, null, 2) + '\n');
  if (!['PASS', 'DEGRADED'].includes(result.report.overall_status)) process.exitCode = 1;
} catch (error) {
  process.stderr.write('Deployment verification failed: ' + (error?.message ?? 'unknown error') + '\n');
  process.exitCode = 1;
}
