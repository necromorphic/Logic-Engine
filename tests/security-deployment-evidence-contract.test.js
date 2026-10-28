import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const collectorUrl = new URL('../scripts/security/Collect-DeploymentEvidence.ps1', import.meta.url);

test('deployment evidence collector fails closed when required path inputs are absent', async () => {
  const source = await readFile(collectorUrl, 'utf8');

  assert.match(source, /\$requestedDataPaths\.Count -eq 0/);
  assert.match(source, /\$requestedBackupPaths\.Count -eq 0/);
  assert.match(source, /A supplied data database path is missing, inaccessible, invalid, or not a file\./);
  assert.match(source, /collectionStatus = if \(\$incompleteReasons\.Count -gt 0\) \{ "INCOMPLETE" \}/);
});

test('deployment evidence report is created without overwriting an existing file', async () => {
  const source = await readFile(collectorUrl, 'utf8');

  assert.match(source, /\[System\.IO\.FileMode\]::CreateNew/);
  assert.match(source, /OutputPath already exists; choose a new path/);
  assert.match(source, /OutputPath must not use an NTFS alternate data stream/);
});
