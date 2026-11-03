import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../native/windows-namespace-broker/windows_broker_service.c',import.meta.url),'utf8');
const docs=await readFile(new URL('../native/windows-namespace-broker/README.md',import.meta.url),'utf8');
test('Windows broker authenticates local pipe clients by configured SID',()=>{
 assert.match(source,/ImpersonateNamedPipeClient/);assert.match(source,/OpenThreadToken/);
 assert.match(source,/EqualSid\(u->User\.Sid,allowed_sid\)/);
 assert.match(source,/PIPE_REJECT_REMOTE_CLIENTS/);
 assert.match(source,/OpenProcessToken/);
 assert.match(source,/PROCESS_DUP_HANDLE/);
});
test('Windows broker keeps filesystem operations disabled without backend',()=>{
 assert.match(source,/q\.operation>=2&&q\.operation<=8\)r\.flags=3/);
 assert.match(docs,/Only PING is implemented/);assert.match(docs,/Do not connect the SQLite VFS/);
});

const store = await readFile(new URL('../native/windows-namespace-broker/windows_manifest_store.c', import.meta.url), 'utf8');
const storeHeader = await readFile(new URL('../native/windows-namespace-broker/windows_manifest_store.h', import.meta.url), 'utf8');

test('Windows broker authenticates local pipe clients by configured SID', () => {
  assert.match(source, /ImpersonateNamedPipeClient/);
  assert.match(source, /OpenThreadToken/);
  assert.match(source, /EqualSid\(u->User\.Sid,allowed_sid\)/);
  assert.match(source, /PIPE_REJECT_REMOTE_CLIENTS/);
  assert.match(source, /OpenProcessToken/);
  assert.match(source, /PROCESS_DUP_HANDLE/);
});

test('Windows broker keeps filesystem operations disabled without backend', () => {
  assert.match(source, /q\.operation>=2&&q\.operation<=8\)r\.flags=3/);
  assert.match(docs, /Only PING is implemented/);
  assert.match(docs, /Do not connect the SQLite VFS/);
});

test('Windows broker metadata store uses a pinned directory and durable handle-relative updates', () => {
  assert.match(store, /CreateFileW\(configured_directory/);
  assert.match(store, /FILE_FLAG_OPEN_REPARSE_POINT/);
  assert.match(store, /logic_engine_win_open_relative\(store->directory/);
  assert.match(store, /LockFileEx\(lock,\s*LOCKFILE_EXCLUSIVE_LOCK/);
  assert.match(store, /FILE_CREATE/);
  assert.match(store, /FlushFileBuffers\(file\)/);
  assert.match(store, /SetFileInformationByHandle\(file,\s*FileRenameInfo/);
  assert.match(store, /RootDirectory\s*=\s*store->directory/);
  assert.match(store, /FlushFileBuffers\(store->directory\)/);
  assert.match(store, /validate_manifest/);
  assert.match(store, /validate_intent/);
  assert.match(store, /LE_STORE_MAX_BYTES/);
  assert.match(storeHeader, /le_win_store_open/);
  assert.match(storeHeader, /le_win_store_write_manifest/);
  assert.match(storeHeader, /le_win_store_remove_intent/);
  assert.match(store, /le_store_acl_is_private/);
  assert.match(store, /SE_DACL_PROTECTED/);
  assert.match(store, /GetSecurityInfo/);
  assert.match(store, /ACCESS_ALLOWED_ACE_TYPE/);
  assert.match(store, /GetFinalPathNameByHandleW/);
  assert.match(store, /GetVolumeInformationW/);
  assert.match(store, /wcscmp\(filesystem, L\"NTFS\"\)/);
});

test('Windows metadata store exposes only fixed metadata names and no path fallback', () => {
  assert.match(store, /LE_STORE_MANIFEST L"manifest\.json"/);
  assert.match(store, /LE_STORE_INTENT L"intent\.json"/);
  assert.match(store, /LE_STORE_LOCK L"store\.lock"/);
  assert.match(store, /le_win_store_read\(store, LE_STORE_MANIFEST/);
  assert.match(store, /never caller-provided paths/);
});
