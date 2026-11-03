import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installer = fs.readFileSync(
  path.join(root, 'deploy', 'sqlite-security', 'install-windows-service.ps1'),
  'utf8',
);

test('Windows service installer rejects reparse points in protected trees before ACL mutation', () => {
  assert.match(installer, /function Assert-NoReparsePoints/);
  assert.match(installer, /FileAttributes\]::ReparsePoint/);
  assert.match(installer, /Assert-NoReparsePoints \$InstallDirectory/);
  assert.match(installer, /Assert-NoReparsePoints \$StateDirectory/);
  assert.ok(
    installer.indexOf('Assert-NoReparsePoints $InstallDirectory')
      < installer.indexOf('Set-PrivateTreeAcl $InstallDirectory'),
    'reparse-point preflight must precede recursive ACL changes',
  );
});

test('Windows service installer resets and applies ACLs recursively to every existing descendant', () => {
  assert.match(installer, /icacls\.exe \$Path \/reset \/T \/C/);
  assert.match(installer, /icacls\.exe \$Path \/inheritance:r \/T \/C/);
  assert.match(installer, /\/grant:r .*\/T \/C/);
  assert.match(installer, /Get-ChildItem -LiteralPath \$Path -Force -Recurse/);
  assert.match(installer, /AreAccessRulesProtected/);
  assert.match(installer, /Unexpected ACL principal or deny rule remains/);
  assert.match(installer, /Required ACL is missing for \$sid/);
});

test('Windows service installer keeps binaries read-only and state writable for the service SID', () => {
  assert.match(installer, /Set-PrivateTreeAcl \$InstallDirectory \$sid "RX"/);
  assert.match(installer, /Set-PrivateTreeAcl \$StateDirectory \$sid "F"/);
  assert.match(installer, /InstallDirectory and StateDirectory must be separate, non-overlapping trees/);
});

test('Windows service environment file ACL is reset, restricted and verified', () => {
  assert.match(installer, /function Set-PrivateFileAcl/);
  assert.match(installer, /Set-PrivateFileAcl \$EnvironmentFile \$sid/);
  assert.match(installer, /icacls\.exe \$Path \/reset \/C/);
  assert.match(installer, /icacls\.exe \$Path \/inheritance:r \/C/);
  assert.match(installer, /AreAccessRulesProtected/);
  assert.match(installer, /Unexpected environment-file ACL principal or deny rule remains/);
});

test('Windows service installer rejects reparse-point ancestors before creating state or service', () => {
  assert.match(installer, /function Assert-NoReparsePointAncestors/);
  assert.match(installer, /Assert-NoReparsePointAncestors \$InstallDirectory/);
  assert.match(installer, /Assert-NoReparsePointAncestors \$StateDirectory/);
  assert.match(installer, /Assert-NoReparsePointAncestors \$NodePath/);
  assert.match(installer, /if \(\$EnvironmentFile\) \{ Assert-NoReparsePointAncestors \$EnvironmentFile \}/);
  const preflight = installer.indexOf('Assert-NoReparsePointAncestors $InstallDirectory');
  const shouldProcess = installer.indexOf('if ($PSCmdlet.ShouldProcess(');
  const stateCreate = installer.indexOf('New-Item -ItemType Directory -Path $StateDirectory');
  const serviceCreate = installer.indexOf('Invoke-Sc @("create", $ServiceName');
  assert.ok(preflight >= 0 && preflight < stateCreate, 'path-chain validation must precede state-directory creation');
  assert.ok(preflight < serviceCreate, 'path-chain validation must precede service creation');
  assert.ok(shouldProcess >= 0 && shouldProcess < stateCreate, 'state-directory creation must be inside ShouldProcess so -WhatIf has no side effects');
  assert.ok(stateCreate < serviceCreate, 'state directory must exist before the service is created');
});

test('Windows service installer does not report provisioning success for WhatIf or declined confirmation', () => {
  assert.match(installer, /No provisioning changes were made \(WhatIf or confirmation declined\)/);
  const successMessage = installer.indexOf('Write-Output "Provisioned service: $ServiceName"');
  const noChangeMessage = installer.indexOf('Write-Output "No provisioning changes were made');
  assert.ok(successMessage >= 0 && noChangeMessage > successMessage);
  assert.match(installer, /if \(\$PSCmdlet\.ShouldProcess\([\s\S]*?Write-Output "Provisioned service: \$ServiceName"[\s\S]*?\} else \{/);
});
