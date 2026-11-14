import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../native/windows-namespace-broker/windows_broker_service.c', import.meta.url), 'utf8');
const docs = await readFile(new URL('../native/windows-namespace-broker/README.md', import.meta.url), 'utf8');
const store = await readFile(new URL('../native/windows-namespace-broker/windows_manifest_store.c', import.meta.url), 'utf8');
const storeHeader = await readFile(new URL('../native/windows-namespace-broker/windows_manifest_store.h', import.meta.url), 'utf8');
const namespace = await readFile(new URL('../native/windows-namespace-broker/windows_namespace_adapter.c', import.meta.url), 'utf8');
const namespaceHeader = await readFile(new URL('../native/windows-namespace-broker/windows_namespace_adapter.h', import.meta.url), 'utf8');
const smoke = await readFile(new URL('../native/windows-namespace-broker/windows_manifest_store_smoke.c', import.meta.url), 'utf8');
const validator = await readFile(new URL('../native/windows-namespace-broker/windows_manifest_validator.c', import.meta.url), 'utf8');
const validatorHeader = await readFile(new URL('../native/windows-namespace-broker/windows_manifest_validator.h', import.meta.url), 'utf8');
const vfsSource = await readFile(new URL('../native/secure-vfs-probe/secure_vfs_probe.c', import.meta.url), 'utf8');

test('Windows broker authenticates local pipe clients by configured SID', () => {
  assert.match(source, /ImpersonateNamedPipeClient/);
  assert.match(source, /OpenThreadToken/);
  assert.match(source, /CheckTokenMembership\(token,allowed_sid,&member\)/);
  assert.doesNotMatch(source, /EqualSid\(u->User\.Sid,allowed_sid\)/);
  assert.match(source, /PIPE_REJECT_REMOTE_CLIENTS/);
  assert.match(source, /readn_timeout\(pipe,&q,sizeof\(q\),5000\)/);
  assert.match(source, /readn_timeout\(pipe,payload,q\.payload_length,5000\)/);
  assert.match(source, /PeekNamedPipe\(h,NULL,0,NULL,&available,NULL\)/);
  assert.match(source, /ERROR_TIMEOUT/);
  assert.match(source, /OpenProcessToken/);
  assert.match(source, /PROCESS_DUP_HANDLE/);
});

test('Windows broker transfers manifest-verified file handles to the authenticated client process', () => {
  assert.match(source, /q\.operation==2\|\|q\.operation==3\|\|q\.operation==5\|\|q\.operation==7/);
  assert.match(source, /open_role_file_for_operation/);
  assert.match(source, /le_win_open_role_file/);
  assert.match(source, /le_win_create_role_sidecar/);
  assert.match(source, /DuplicateHandle\(GetCurrentProcess\(\),source,process,&remote,0,FALSE,DUPLICATE_SAME_ACCESS\)/);
  assert.match(source, /DUPLICATE_SAME_ACCESS\|DUPLICATE_CLOSE_SOURCE/);
  assert.match(source, /r\.payload_length=net32\(has_remote_handle\?/);
  assert.match(source, /wire_handle=net64\(remote_handle\)/);
  assert.match(source, /logic_engine_win_identity_equal\(&created_identity,&reopened_identity\)/);
  assert.match(source, /PROCESS_DUP_HANDLE/);
  assert.match(source, /q\.operation==8/);
  assert.match(source, /q\.operation==4/);
  assert.match(source, /le_win_delete_role_sidecar\(&metadata_store,namespace_root,role,kind\)/);
  assert.match(source, /operation_error==ERROR_FILE_NOT_FOUND\?LEB_STATUS_NOT_FOUND:LEB_STATUS_INTERNAL/);
  assert.doesNotMatch(source, /q\.operation>=2&&q\.operation<=8\)response_status=LEB_STATUS_UNSUPPORTED/);
  assert.match(docs, /OPEN_MAIN,[\s\S]*OPEN_SIDECAR, CREATE_SIDECAR and OPEN_OR_CREATE_SIDECAR/);
  assert.match(docs, /DuplicateHandle/);
  assert.match(docs, /must not be treated as production-ready/);
});

test('manifest-bound Windows VFS opens main and sidecar handles through the broker', () => {
  assert.match(vfsSource, /PROBE_WIN_BROKER_OP_OPEN_MAIN 2u/);
  assert.match(vfsSource, /PROBE_WIN_BROKER_OP_OPEN_SIDECAR 3u/);
  assert.match(vfsSource, /PROBE_WIN_BROKER_OP_CREATE_SIDECAR 5u/);
  assert.match(vfsSource, /PROBE_WIN_BROKER_OP_OPEN_OR_CREATE_SIDECAR 7u/);
  assert.match(vfsSource, /probe_win_broker_open_role_request/);
  assert.match(vfsSource, /role->manifest_bound/);
  assert.match(vfsSource, /probe_win_sidecar_identity_record_locked\(role_index, suffix, &info_identity, role->manifest_bound\)/);
  assert.match(vfsSource, /GetHandleInformation\(candidate,&handle_flags\)/);
});

test('Windows native smoke launches a separate broker process and verifies transferred handles', () => {
  assert.match(source, /LE_BROKER_ENABLE_CONSOLE_TEST/);
  assert.match(source, /--console-test/);
  assert.match(smoke, /CreateProcessW/);
  assert.match(smoke, /LOGIC_ENGINE_BROKER_EXE/);
  assert.match(smoke, /broker_test_request\(2,"main","main"/);
  assert.match(smoke, /broker_test_request\(7,"main","wal"/);
  assert.match(smoke, /broker_test_request\(3,"main","wal"/);
  assert.match(smoke, /broker_test_request\(8,"main","wal"/);
  assert.match(smoke, /broker_test_request\(4,"main","wal"/);
  assert.match(smoke, /broker_test_request\(5,"main","shm"/);
  assert.match(smoke, /TerminateProcess/);
});

test('Windows broker metadata store enforces pinned ancestry, NTFS and protected ACLs', () => {
  assert.match(store, /le_store_open_parent_chain\(configured_directory/);
  assert.match(store, /#include \"\.\.\/secure-vfs-probe\/windows_relative_open\.h\"/);
  assert.match(store, /le_store_parent_acl_safe\(current\)/);
  assert.match(store, /INHERIT_ONLY_ACE/);
  const parentMutationMask = store.match(/DWORD mutation_mask = ([\s\S]*?);/)?.[1] ?? '';
  assert.match(parentMutationMask, /FILE_DELETE_CHILD/);
  assert.match(parentMutationMask, /WRITE_DAC/);
  assert.match(parentMutationMask, /WRITE_OWNER/);
  assert.doesNotMatch(parentMutationMask, /FILE_ADD_FILE|FILE_ADD_SUBDIRECTORY/,
    'creating a new sibling cannot replace a pinned existing path component');
  assert.match(store, /logic_engine_win_open_relative\(parent, basename/);
  assert.doesNotMatch(store, /CreateFileW\(configured_directory/);
  assert.match(store, /FILE_FLAG_OPEN_REPARSE_POINT/);
  assert.match(store, /LockFileEx\(lock,\s*LOCKFILE_EXCLUSIVE_LOCK/);
  assert.match(store, /FILE_CREATE/);
  assert.match(store, /FlushFileBuffers\(file\)/);
  assert.match(store, /le_win_rename_relative\(file,\s*store->directory,\s*target\)/);
  const renameImplementation = store.slice(
    store.indexOf('static int le_win_rename_relative'),
    store.indexOf('static int le_win_store_replace'),
  );
  assert.match(renameImplementation, /NtSetInformationFile/);
  assert.match(renameImplementation, /FileRenameInformationEx is 65/);
  assert.match(renameImplementation, /RootDirectory\s*=\s*directory/);
  assert.doesNotMatch(renameImplementation, /SetFileInformationByHandle/);
  assert.match(store, /FlushFileBuffers\(store->directory\)/);
  assert.match(store, /validate_manifest/);
  assert.match(store, /validate_intent/);
  assert.match(store, /LE_STORE_MAX_BYTES/);
  assert.match(storeHeader, /le_win_store_open/);
  assert.match(storeHeader, /le_win_store_open_validated/);
  assert.match(store, /le_win_store_open_validated/);
  assert.match(store, /le_win_validate_manifest/);
  assert.match(store, /le_win_validate_intent/);
  assert.match(storeHeader, /le_win_store_write_manifest/);
  assert.match(storeHeader, /le_win_store_remove_intent/);
  assert.match(store, /le_store_acl_is_private/);
  assert.match(store, /SE_DACL_PROTECTED/);
  assert.match(store, /dacl->AclRevision != ACL_REVISION/);
  assert.match(store, /header->AceFlags != \(OBJECT_INHERIT_ACE \| CONTAINER_INHERIT_ACE\)/);
  assert.match(store, /ace->Mask != FILE_ALL_ACCESS/);
  assert.match(store, /GetSecurityInfo/);
  assert.match(store, /ACCESS_ALLOWED_ACE_TYPE/);
  assert.match(store, /GetFinalPathNameByHandleW/);
  assert.match(store, /GetVolumeInformationW/);
  assert.match(store, /le_win_store_open_namespace_root/);
  assert.match(store, /le_win_store_validate_private_directory/);
  assert.match(store, /wcscmp\(filesystem, L"NTFS"\)/);
});

test('Windows metadata store exposes only fixed metadata names and no path fallback', () => {
  assert.match(store, /LE_STORE_MANIFEST L"manifest\.json"/);
  assert.match(store, /LE_STORE_INTENT L"intent\.json"/);
  assert.match(store, /LE_STORE_LOCK L"store\.lock"/);
  assert.match(store, /le_win_store_read\(store, LE_STORE_MANIFEST/);
  assert.match(store, /never caller-provided paths/);
});

test('Windows SQLite sidecar adapter is handle-relative and identity-bound', () => {
  assert.match(namespace, /logic_engine_win_open_relative\(parent, basename/);
  assert.match(namespace, /FILE_CREATE/);
  assert.match(namespace, /FILE_OPEN/);
  assert.match(namespace, /FILE_NON_DIRECTORY_FILE/);
  assert.match(namespace, /logic_engine_win_identity_equal\(expected, &observed\)/);
  assert.match(namespace, /SetFileInformationByHandle\(\*opened, FileDispositionInfo/);
  assert.match(namespace, /CloseHandle\(\*opened\)/);
  assert.match(namespace, /FlushFileBuffers\(parent\)/);
  assert.match(namespace, /le_win_namespace_valid_sidecar/);
  assert.match(namespaceHeader, /le_win_namespace_create_sidecar/);
  assert.match(namespaceHeader, /le_win_namespace_open_sidecar/);
  assert.match(namespaceHeader, /le_win_namespace_delete_sidecar/);
  assert.match(namespaceHeader, /le_win_namespace_flush_parent/);
});


test('Windows startup recovery holds the manifest lock and preserves intent on ambiguity', () => {
  assert.match(storeHeader, /LE_STORE_RECOVER/);
  assert.match(storeHeader, /le_win_store_startup_recover/);
  const recovery = store.slice(
    store.indexOf('int le_win_store_startup_recover'),
    store.indexOf('void le_win_store_close'),
  );
  assert.match(recovery, /le_win_store_lock\(store\)/);
  assert.match(recovery, /le_win_store_read_manifest\(store/);
  assert.match(recovery, /le_win_store_read_intent\(store/);
  assert.match(recovery, /if \(!recover\(store/);
  assert.match(recovery, /if \(has_intent && !le_win_store_remove_intent\(store\)\)/);
  assert.ok(
    recovery.indexOf('if (!recover(store') < recovery.indexOf('le_win_store_remove_intent(store)'),
    'the pending intent must remain until reconciliation succeeds',
  );
  assert.match(recovery, /le_win_store_unlock\(store\)/);
});


test('Windows native recovery smoke covers pending, clean and missing-manifest startup', () => {
  assert.match(smoke, /retain intent when recovery callback rejects/);
  assert.match(smoke, /complete startup recovery and retire intent/);
  assert.match(smoke, /recover clean startup with no pending intent/);
  assert.match(smoke, /reject startup without a manifest/);
  assert.match(smoke, /ERROR_FILE_NOT_FOUND\) goto unlock_store/);
});


test('native Windows validator enforces strict manifest and intent envelopes', () => {
  assert.match(validator, /LE_JSON_MAX_BYTES/);
  assert.match(validator, /LE_JSON_MAX_DEPTH/);
  assert.match(validator, /duplicate|scan/i);
  assert.match(validator, /jvalidate_manifest/);
  assert.match(validator, /jvalidate_intent/);
  assert.match(validator, /target!=base\+1/);
  assert.match(validator, /directoryMutationBoundary/);
  assert.match(validatorHeader, /le_win_validate_manifest/);
  assert.match(validatorHeader, /le_win_validate_intent/);
  assert.match(smoke, /test_native_schema_validator/);
  assert.match(smoke, /valid_manifest/);
  assert.match(smoke, /duplicate_key/);
  assert.match(smoke, /bad_intent/);
});


test('Windows SCM readiness is gated by validated manifest and physical namespace reconciliation', () => {
  assert.match(source, /--metadata-dir/);
  assert.match(source, /--namespace-root/);
  assert.match(source, /int wmain\(int argc,wchar_t \*\*argv\)/);
  assert.match(source, /static VOID WINAPI service_main\(DWORD argc,LPWSTR \*argv\)/);
  assert.match(source, /le_win_store_open_validated/);
  assert.match(source, /le_win_store_startup_recover/);
  assert.match(source, /le_win_reconcile_manifest_namespace/);
  assert.match(source, /if\(intent\|\|intent_length\)/);
  const serviceMain = source.slice(source.indexOf('static VOID WINAPI service_main'));
  assert.ok(serviceMain.indexOf('le_win_store_startup_recover') < serviceMain.indexOf('run();'),
    'SCM must not enter RUNNING before startup reconciliation');
  assert.match(validator, /jreconcile_role/);
  assert.match(validator, /jopen_verified/);
  assert.match(validator, /le_win_store_open_namespace_root/);
  assert.match(validator, /le_win_store_validate_private_directory/);
  assert.match(store, /wcscmp\(filesystem,\s*L"NTFS"\)/);
  assert.match(validator, /metadataRootIdentity/);
});


test('Windows startup recovers create and delete sidecar intents', () => {
  assert.match(validatorHeader, /le_win_recover_lifecycle_intent/);
  assert.match(validator, /le_win_recover_lifecycle_intent/);
  assert.match(validator, /jmanifest_add_active_sidecar/);
  assert.match(validator, /jmanifest_retire_sidecar/);
  assert.match(validator, /identity-match/);
  assert.match(validator, /generation==target/);
  assert.match(validator, /generation==base/);
  assert.match(validator, /jopen_role_parent/);
  assert.match(source, /le_win_recover_lifecycle_intent/);
  assert.match(smoke, /recover uncommitted create-sidecar intent/);
  assert.match(smoke, /reconcile committed create-sidecar intent/);
  assert.match(smoke, /recover create intent when CREATE_NEW never produced a file/);
  assert.match(smoke, /recover uncommitted create-sidecar intent and enroll identity/);
  assert.match(smoke, /verify recovered sidecar remains openable/);
  assert.match(smoke, /recover identity-bound delete before manifest commit/);
  assert.match(smoke, /reconcile committed delete intent after manifest commit/);
  assert.match(smoke, /verify retired sidecar path remains absent/);
});


test('Windows create recovery requires an explicit absent precondition', () => {
  assert.match(validator, /precondition/);
  assert.match(validator, /"absent"/);
  assert.match(validator, /"identity-match"/);
  assert.match(smoke, /missing_precondition_intent/);
  assert.match(smoke, /le_win_validate_intent\(missing_precondition_intent/);
});


test('Windows broker dispatches manifest-backed access and sidecar deletion requests', () => {
  assert.match(source, /LEB_STATUS_NOT_FOUND 5u/);
  assert.match(source, /parse_access_payload/);
  assert.match(source, /q\.operation==8/);
  assert.match(source, /le_win_store_lock\(&metadata_store\)/);
  assert.match(source, /le_win_access_role_file\(&metadata_store,namespace_root,role,kind,&exists\)/);
  assert.match(source, /exists\?LEB_STATUS_OK:LEB_STATUS_NOT_FOUND/);
  assert.match(validatorHeader, /le_win_access_role_file/);
  assert.match(validator, /int le_win_access_role_file/);
  assert.match(validatorHeader, /le_win_open_role_file/);
  assert.match(validator, /int le_win_open_role_file/);
  assert.match(validatorHeader, /le_win_create_role_sidecar/);
  assert.match(validator, /int le_win_create_role_sidecar/);
  assert.match(validatorHeader, /le_win_delete_role_sidecar/);
  assert.match(validator, /int le_win_delete_role_sidecar/);
  assert.match(validator, /jmanifest_retire_sidecar/);
  assert.match(validator, /FILE_DISPOSITION_INFO disposition/);
  assert.match(smoke, /runtime delete-sidecar transaction writes intent and retires manifest entry/);
  assert.match(smoke, /runtime delete rejects unknown role instead of treating it as absent sidecar/);
  assert.match(validator, /if\(role==0xffffffffu\)\{SetLastError\(ERROR_INVALID_NAME\);goto done;\}/);
  assert.match(smoke, /runtime-deleted SHM is absent from manifest-backed access/);
  assert.match(smoke, /runtime-deleted SHM cannot be reopened by role identity/);
  assert.match(validator, /le_win_store_write_intent/);
  assert.match(validator, /le_win_namespace_create_sidecar/);
  assert.match(validator, /jmanifest_add_active_sidecar/);
  assert.match(validator, /le_win_store_remove_intent/);
  assert.match(smoke, /runtime create-sidecar transaction writes intent and commits manifest/);
  assert.match(smoke, /runtime-created SHM is active in manifest-backed access/);
  assert.match(smoke, /runtime sidecar transactions retire their intents/);
  assert.match(validator, /jopen_role_parent\(&p,role,root_handle,&parent\)/);
  assert.match(validator, /FILE_SHARE_READ\|FILE_SHARE_WRITE\|FILE_SHARE_DELETE,FILE_OPEN/);
  assert.match(smoke, /open registered main database by manifest identity/);
  assert.match(smoke, /open active WAL sidecar by manifest identity/);
  assert.match(smoke, /reject open for unregistered role/);
  assert.match(smoke, /manifest-backed access recognizes registered main file/);
  assert.match(smoke, /manifest-backed access recognizes active WAL sidecar/);
  assert.match(smoke, /manifest-backed access reports absent SHM sidecar/);
  assert.match(smoke, /manifest-backed access reports retired WAL sidecar absent/);
  assert.match(source, /q\.operation==2\|\|q\.operation==3\|\|q\.operation==5\|\|q\.operation==7/);
});


test('Windows manifest-bound VFS sidecar deletes use authenticated broker transactions', () => {
  assert.match(vfsSource, /PROBE_WIN_BROKER_PIPE/);
  assert.match(vfsSource, /probe_win_broker_role_request/);
  assert.match(vfsSource, /PROBE_WIN_BROKER_OP_DELETE_SIDECAR 4u/);
  assert.match(vfsSource, /PROBE_WIN_BROKER_OP_ACCESS_ROLE_FILE 8u/);
  assert.match(vfsSource, /role->manifest_bound && flags == SQLITE_ACCESS_EXISTS/);
  assert.match(vfsSource, /probe_win_broker_role_request\(role->role,PROBE_WIN_BROKER_OP_ACCESS_ROLE_FILE/);
  assert.match(vfsSource, /probe_win_broker_role_request\(role->role/);
  assert.match(vfsSource, /probe_win_sidecar_identity_retire\(role_index,suffix,&expected_sidecar,1\)/);
  const manifestDelete = vfsSource.slice(vfsSource.indexOf('if (role->manifest_bound) {'),
    vfsSource.indexOf('  if (!is_main) {', vfsSource.indexOf('if (role->manifest_bound) {')));
  assert.match(manifestDelete, /if \(is_main/);
  assert.match(manifestDelete, /PROBE_WIN_BROKER_STATUS_OK/);
  assert.match(manifestDelete, /PROBE_WIN_BROKER_STATUS_NOT_FOUND/);
  assert.doesNotMatch(manifestDelete, /SetFileInformationByHandle/);
});
