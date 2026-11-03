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
