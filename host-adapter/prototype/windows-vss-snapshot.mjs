import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const activeLeases = new WeakSet();
const GUID = /^[{]?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[}]?$/i;

// Static PowerShell source: paths and identifiers are passed through the child
// environment, never interpolated into executable PowerShell text.
const CREATE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($env:LE_VSS_ROOT)
$volumeRoot = [System.IO.Path]::GetPathRoot($root)
$relative = $root.Substring($volumeRoot.Length).TrimStart('\')
$created = $null
# VSS serializes snapshot creation system-wide. Concurrent host scans may
# receive WMI return code 9; retry that transient busy state, but fail closed
# after a bounded wait rather than racing or falling back to the live tree.
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  $created = ([WmiClass]'Win32_ShadowCopy').Create($volumeRoot, 'ClientAccessible')
  if ([int]$created.ReturnValue -ne 9) { break }
  Start-Sleep -Milliseconds 500
}
if ($created.ReturnValue -ne 0) {
  if ([int]$created.ReturnValue -eq 9) { throw 'HOST_VSS_CREATE_BUSY:9' }
  throw "HOST_VSS_CREATE_FAILED:$($created.ReturnValue)"
}
$id = [string]$created.ShadowID
Write-Output "HOST_VSS_SNAPSHOT_ID:$id"
try {
  $shadow = Get-WmiObject -Class Win32_ShadowCopy | Where-Object { $_.ID -eq $id } | Select-Object -First 1
  if (-not $shadow) { throw 'HOST_VSS_SNAPSHOT_NOT_FOUND' }
  $snapshotVolumeRoot = $shadow.DeviceObject.TrimEnd('\') + '\'
  $snapshotRoot = $snapshotVolumeRoot
  if ($relative.Length -gt 0) {
    foreach ($component in $relative.Split([System.IO.Path]::DirectorySeparatorChar)) {
      $snapshotRoot = Join-Path $snapshotRoot $component
      $componentAttributes = [System.IO.File]::GetAttributes($snapshotRoot)
      if (($componentAttributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'HOST_VSS_REPARSE_POINT_PRESENT'
      }
      if (($componentAttributes -band [System.IO.FileAttributes]::Directory) -eq 0) {
        throw 'HOST_VSS_ROOT_NOT_DIRECTORY'
      }
    }
  }
  $stack = New-Object 'System.Collections.Generic.Stack[string]'
  $stack.Push($snapshotRoot)
  $entryCount = 0
  while ($stack.Count -gt 0) {
    $directory = $stack.Pop()
    foreach ($entry in [System.IO.Directory]::EnumerateFileSystemEntries($directory)) {
      $entryCount++
      if ($entryCount -gt 100000) { throw 'HOST_VSS_ENTRY_COUNT_LIMIT' }
      $attributes = [System.IO.File]::GetAttributes($entry)
      if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'HOST_VSS_REPARSE_POINT_PRESENT'
      }
      if (($attributes -band [System.IO.FileAttributes]::Directory) -ne 0) {
        $stack.Push($entry)
      }
    }
  }
  [pscustomobject]@{ snapshotId = $id; snapshotRoot = $snapshotRoot; root = $root } | ConvertTo-Json -Compress
} catch {
  # Preserve the original provider/audit error. Resolve by snapshot ID even
  # when the failure happened before the shadow object was assigned.
  $failure = $_
  $cleanupFailure = $null
  try {
    $cleanupShadow = Get-WmiObject -Class Win32_ShadowCopy | Where-Object { $_.ID -eq $id } | Select-Object -First 1
    if ($cleanupShadow) {
      $cleanupResult = $cleanupShadow.Delete()
      $cleanupCode = if ($cleanupResult -is [System.Management.ManagementBaseObject]) { [int]$cleanupResult.ReturnValue } else { [int]$cleanupResult }
      if ($cleanupCode -ne 0) { throw "HOST_VSS_CLEANUP_FAILED:$cleanupCode" }
    }
  } catch {
    $cleanupFailure = $_
  }
  if ($cleanupFailure) {
    throw "HOST_VSS_CLEANUP_FAILED_AFTER_PROVIDER_ERROR; original=$($failure.Exception.Message); cleanup=$($cleanupFailure.Exception.Message)"
  }
  throw $failure
}
`;

const DELETE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$id = $env:LE_VSS_SNAPSHOT_ID
if ($id -notmatch '^[{]?[0-9a-fA-F-]{36}[}]?$') { throw 'HOST_VSS_INVALID_SNAPSHOT_ID' }
$shadow = Get-WmiObject -Class Win32_ShadowCopy | Where-Object { $_.ID -eq $id } | Select-Object -First 1
if ($shadow) {
  $result = $shadow.Delete()
  $returnCode = if ($result -is [System.Management.ManagementBaseObject]) { [int]$result.ReturnValue } else { [int]$result }
  if ($returnCode -ne 0) { throw "HOST_VSS_DELETE_FAILED:$returnCode" }
}
'HOST_VSS_RELEASED'
`;

async function runPowerShell(script, env, timeout = 120_000) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  try {
    return await execFileAsync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encoded,
    ], { windowsHide: true, timeout, maxBuffer: 1024 * 1024, env: { ...process.env, ...env } });
  } catch (error) {
    const output = [error?.stdout, error?.stderr, error?.message].filter(Boolean).join('\\n');
    const markers = [...output.matchAll(/HOST_VSS_[A-Z0-9_]+(?::[0-9]+)?/g)].map(match => match[0]);
    const marker = markers.find(value => value !== 'HOST_VSS_SNAPSHOT_ID');
    if (marker) throw new Error(marker);
    // Preserve a short, path-scrubbed diagnostic for CI and deployment review;
    // never include the encoded command or environment values.
    const diagnostic = String(error?.stderr || error?.message || error?.code || 'unknown')
      .replace(/[A-Z]:\\\\[^\\r\\n"]+/gi, '<path>')
      .replace(/\\s+/g, ' ')
      .slice(0, 320);
    throw new Error('HOST_VSS_POWERSHELL_FAILED: ' + diagnostic);
  }
}

/**
 * Creates a point-in-time, read-only Volume Shadow Copy and rejects every
 * filesystem entry carrying FILE_ATTRIBUTE_REPARSE_POINT before Node reads it.
 * VSS creation generally requires an elevated Windows service account and a
 * functioning shadow-copy provider; failure is intentionally fail-closed.
 *
 * The lease is process-local and unforgeable by callers. Its root is valid only
 * inside the callback and is released in finally.
 */
export async function withWindowsVssSnapshot(rootPath, callback) {
  if (process.platform !== 'win32') throw new Error('HOST_VSS_PLATFORM_UNSUPPORTED');
  if (typeof rootPath !== 'string' || !rootPath.trim() || !isAbsolute(rootPath)) throw new Error('HOST_VSS_ROOT_INVALID');
  if (typeof callback !== 'function') throw new Error('HOST_VSS_CALLBACK_INVALID');

  const requestedRoot = resolve(rootPath);
  const { stdout } = await runPowerShell(CREATE_SCRIPT, { LE_VSS_ROOT: requestedRoot });
  const idLine = stdout.match(/^HOST_VSS_SNAPSHOT_ID:([{}0-9a-f-]+)$/im);
  const snapshotId = idLine?.[1] ?? null;
  let descriptor;
  try {
    const jsonLine = stdout.split(/\r?\n/).map(line => line.trim())
      .find(line => line.startsWith('{') && line.endsWith('}'));
    if (!snapshotId || !GUID.test(snapshotId) || !jsonLine) throw new Error('invalid response');
    descriptor = JSON.parse(jsonLine);
    if (!descriptor || typeof descriptor.snapshotId !== 'string' || !GUID.test(descriptor.snapshotId)
      || descriptor.snapshotId.toLowerCase() !== snapshotId.toLowerCase()
      || typeof descriptor.snapshotRoot !== 'string' || !descriptor.snapshotRoot.startsWith('\\\\?\\GLOBALROOT\\Device\\HarddiskVolumeShadowCopy')
      || typeof descriptor.root !== 'string') {
      throw new Error('invalid descriptor');
    }
  } catch {
    // If the provider created a snapshot but its response was malformed, release
    // only the exact ID emitted by this child process before rejecting it.
    if (snapshotId && GUID.test(snapshotId)) {
      try {
        await runPowerShell(DELETE_SCRIPT, { LE_VSS_SNAPSHOT_ID: snapshotId }, 60_000);
      } catch {
        throw new Error('HOST_VSS_CLEANUP_FAILED_AFTER_INVALID_PROVIDER_RESPONSE');
      }
    }
    throw new Error('HOST_VSS_INVALID_PROVIDER_RESPONSE');
  }

  const lease = Object.freeze({
    snapshotId: descriptor.snapshotId,
    snapshotRoot: descriptor.snapshotRoot,
    root: descriptor.root,
    provider: 'windows-vss-client-accessible',
    consistency: 'VSS_POINT_IN_TIME_READ_ONLY',
    reparsePoints: 'ALL_FILE_ATTRIBUTE_REPARSE_POINT_ENTRIES_REJECTED',
  });
  activeLeases.add(lease);
  try {
    return await callback(lease);
  } finally {
    activeLeases.delete(lease);
    await runPowerShell(DELETE_SCRIPT, { LE_VSS_SNAPSHOT_ID: descriptor.snapshotId }, 60_000);
  }
}

export function isActiveWindowsVssSnapshot(lease) {
  return Boolean(lease && activeLeases.has(lease)
    && lease.provider === 'windows-vss-client-accessible'
    && lease.consistency === 'VSS_POINT_IN_TIME_READ_ONLY'
    && lease.reparsePoints === 'ALL_FILE_ATTRIBUTE_REPARSE_POINT_ENTRIES_REJECTED');
}
