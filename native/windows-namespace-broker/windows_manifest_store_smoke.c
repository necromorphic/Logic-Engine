#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <string.h>
#include <sddl.h>
#include <strsafe.h>
#define LE_COUNT_OF(value) (sizeof(value) / sizeof((value)[0]))
#define LE_STORE_DIAGNOSTICS 1
#include "windows_manifest_store.c"
#include "windows_namespace_adapter.c"
#include "windows_manifest_validator.c"

static int validate_test_json(const unsigned char *bytes, DWORD length, void *context) {
  static const unsigned char expected[] = { 0x7b, 0x22, 0x6f, 0x6b, 0x22, 0x3a, 0x74, 0x72, 0x75, 0x65, 0x7d };
  (void)context;
  return length == sizeof(expected) && memcmp(bytes, expected, sizeof(expected)) == 0;
}

static int recover_test(
    LE_WIN_MANIFEST_STORE *store,
    const unsigned char *manifest, DWORD manifest_length,
    const unsigned char *intent, DWORD intent_length,
    void *context) {
  static const unsigned char expected[] =
      { 0x7b, 0x22, 0x6f, 0x6b, 0x22, 0x3a, 0x74, 0x72, 0x75, 0x65, 0x7d };
  (void)store;
  if (!manifest || manifest_length != sizeof(expected)
      || memcmp(manifest, expected, sizeof(expected)) != 0) return 0;
  if (intent && (intent_length != sizeof(expected)
      || memcmp(intent, expected, sizeof(expected)) != 0)) return 0;
  if (context == NULL || *(const int *)context != 0) return 0;
  return le_win_store_write_manifest(store, manifest, manifest_length);
}

static int test_native_schema_validator(void) {
  static const unsigned char valid_manifest[] =
    "{\"schemaVersion\":1,\"generation\":1,\"platform\":\"windows\","
    "\"metadataRootIdentity\":{\"kind\":\"windows\",\"volumeSerial\":\"0000000000000001\",\"fileId\":\"00000000000000000000000000000001\"},"
    "\"filesystemPolicy\":{\"filesystem\":\"NTFS\",\"identitySource\":\"opened-handle\",\"directoryMutationBoundary\":\"dedicated-service-identity\"},"
    "\"roles\":[{\"role\":\"main\",\"parentComponents\":[],\"parentIdentities\":[],\"databaseBasename\":\"memory.sqlite\","
    "\"databaseIdentity\":{\"kind\":\"windows\",\"volumeSerial\":\"0000000000000001\",\"fileId\":\"00000000000000000000000000000002\"},"
    "\"state\":\"active\",\"sidecars\":[]}]}";
  static const unsigned char duplicate_key[] =
    "{\"schemaVersion\":1,\"schemaVersion\":1}";
  static const unsigned char valid_intent[] =
    "{\"schemaVersion\":1,\"operationId\":\"0123456789abcdef0123456789abcdef\","
    "\"precondition\":\"absent\",\"operation\":\"create-sidecar\",\"role\":\"main\",\"kind\":\"wal\",\"basename\":\"memory.sqlite-wal\","
    "\"baseGeneration\":1,\"targetGeneration\":2,\"expectedIdentity\":null}";
  static const unsigned char bad_intent[] =
    "{\"schemaVersion\":1,\"operationId\":\"0123456789abcdef0123456789abcdef\","
    "\"precondition\":\"absent\",\"operation\":\"create-sidecar\",\"role\":\"main\",\"kind\":\"wal\",\"basename\":\"memory.sqlite-wal\","
    "\"baseGeneration\":1,\"targetGeneration\":3,\"expectedIdentity\":null}";
  static const unsigned char missing_precondition_intent[] =
    "{\"schemaVersion\":1,\"operationId\":\"0123456789abcdef0123456789abcdef\","
    "\"operation\":\"create-sidecar\",\"role\":\"main\",\"kind\":\"wal\",\"basename\":\"memory.sqlite-wal\","
    "\"baseGeneration\":1,\"targetGeneration\":2,\"expectedIdentity\":null}";
  static const unsigned char valid_delete_intent[] =
    "{\"schemaVersion\":1,\"operationId\":\"2123456789abcdef0123456789abcdef\","
    "\"precondition\":\"identity-match\",\"operation\":\"delete-sidecar\",\"role\":\"main\",\"kind\":\"wal\",\"basename\":\"memory.sqlite-wal\","
    "\"baseGeneration\":1,\"targetGeneration\":2,"
    "\"expectedIdentity\":{\"kind\":\"windows\",\"volumeSerial\":\"0000000000000001\",\"fileId\":\"00000000000000000000000000000003\"}}";
  static const unsigned char bad_delete_precondition[] =
    "{\"schemaVersion\":1,\"operationId\":\"3123456789abcdef0123456789abcdef\","
    "\"precondition\":\"absent\",\"operation\":\"delete-sidecar\",\"role\":\"main\",\"kind\":\"wal\",\"basename\":\"memory.sqlite-wal\","
    "\"baseGeneration\":1,\"targetGeneration\":2,"
    "\"expectedIdentity\":{\"kind\":\"windows\",\"volumeSerial\":\"0000000000000001\",\"fileId\":\"00000000000000000000000000000003\"}}";
  if (!le_win_validate_manifest(valid_manifest, (DWORD)(sizeof(valid_manifest)-1), NULL)) return 0;
  if (le_win_validate_manifest(duplicate_key, (DWORD)(sizeof(duplicate_key)-1), NULL)) return 0;
  if (!le_win_validate_intent(valid_intent, (DWORD)(sizeof(valid_intent)-1), NULL)) return 0;
  if (le_win_validate_intent(bad_intent, (DWORD)(sizeof(bad_intent)-1), NULL)) return 0;
  if (le_win_validate_intent(missing_precondition_intent, (DWORD)(sizeof(missing_precondition_intent)-1), NULL)) return 0;
  if (!le_win_validate_intent(valid_delete_intent, (DWORD)(sizeof(valid_delete_intent)-1), NULL)) return 0;
  if (le_win_validate_intent(bad_delete_precondition, (DWORD)(sizeof(bad_delete_precondition)-1), NULL)) return 0;
  return 1;
}

static int format_identity(
    const LogicEngineWinFileIdentity *identity,
    char *volume, size_t volume_capacity,
    char *file_id, size_t file_id_capacity) {
  unsigned index;
  if (FAILED(StringCchPrintfA(volume, volume_capacity, "%016llx",
      (unsigned long long)identity->volume_serial))) return 0;
  if (file_id_capacity < 33) return 0;
  for (index = 0; index < 16; ++index) {
    if (FAILED(StringCchPrintfA(file_id + index * 2, 3, "%02x",
        identity->file_id.Identifier[index]))) return 0;
  }
  return 1;
}

int main(void) {
  wchar_t temp[MAX_PATH] = { 0 }, directory[MAX_PATH] = { 0 };
  wchar_t namespace_directory[MAX_PATH] = { 0 }, database_path[MAX_PATH] = { 0 };
  LE_WIN_MANIFEST_STORE store;
  unsigned char *manifest = NULL, *intent = NULL;
  DWORD manifest_length = 0, intent_length = 0;
  unsigned char *recovery_intent = NULL;
  DWORD recovery_intent_length = 0;
  int reject_recovery = 1;
  HANDLE sidecar = INVALID_HANDLE_VALUE, reopened = INVALID_HANDLE_VALUE;
  HANDLE namespace_handle = INVALID_HANDLE_VALUE, database_handle = INVALID_HANDLE_VALUE;
  LogicEngineWinFileIdentity namespace_identity, database_identity;
  char namespace_volume[17], namespace_file_id[33], database_volume[17], database_file_id[33];
  char wrong_database_file_id[33];
  unsigned char namespace_manifest[4096];
  DWORD namespace_manifest_length = 0;
  LogicEngineWinFileIdentity sidecar_identity, reopened_identity, wrong_identity;
  static const unsigned char document[] = { 0x7b, 0x22, 0x6f, 0x6b, 0x22, 0x3a, 0x74, 0x72, 0x75, 0x65, 0x7d };
  static const unsigned char invalid_document[] = { 0x7b, 0x7d };
  int result = 1;
  const char *stage = "initialization";
  HANDLE token = NULL;
  TOKEN_USER *user = NULL;
  DWORD token_bytes = 0;
  LPWSTR user_sid = NULL;
  PSECURITY_DESCRIPTOR descriptor = NULL;
  SECURITY_ATTRIBUTES security_attributes;
  wchar_t sddl[512];
  /* The VFS deliberately rejects shared/user-writable ancestors such as
   * %TEMP%. Keep the smoke store beneath the per-user LocalAppData directory,
   * whose parent chain is not writable by unrelated principals. */
  stage = "native strict manifest and intent schema validator";
  if (!test_native_schema_validator()) goto done;
  stage = "read LOCALAPPDATA";
  if (GetEnvironmentVariableW(L"LOCALAPPDATA", temp, (DWORD)LE_COUNT_OF(temp)) == 0
      || wcslen(temp) + 1 >= LE_COUNT_OF(temp)) goto done;
  stage = "construct private test directory";
  if (FAILED(StringCchPrintfW(directory, LE_COUNT_OF(directory),
      L"%s\\LogicEngineBrokerStore-%lu-%llu", temp,
      GetCurrentProcessId(), GetTickCount64()))) goto done;
  stage = "OpenProcessToken";
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) goto done;
  GetTokenInformation(token, TokenUser, NULL, 0, &token_bytes);
  stage = "read token user";
  if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || token_bytes == 0) goto done;
  user = (TOKEN_USER *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, token_bytes);
  if (!user || !GetTokenInformation(token, TokenUser, user, token_bytes, &token_bytes)
      || !ConvertSidToStringSidW(user->User.Sid, &user_sid)) goto done;
  stage = "build protected ACL";
  if (FAILED(StringCchPrintfW(sddl, LE_COUNT_OF(sddl),
      L"D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;%s)", user_sid))
      || !ConvertStringSecurityDescriptorToSecurityDescriptorW(
          sddl, SDDL_REVISION_1, &descriptor, NULL)) goto done;
  ZeroMemory(&security_attributes, sizeof(security_attributes));
  security_attributes.nLength = sizeof(security_attributes);
  security_attributes.lpSecurityDescriptor = descriptor;
  stage = "CreateDirectoryW";
  if (!CreateDirectoryW(directory, &security_attributes)) goto done;
  LocalFree(descriptor); descriptor = NULL;
  LocalFree(user_sid); user_sid = NULL;
  HeapFree(GetProcessHeap(), 0, user); user = NULL;
  CloseHandle(token); token = NULL;
  stage = "open metadata store";
  if (!le_win_store_open(&store, directory, validate_test_json, validate_test_json, NULL)) goto done;
  stage = "lock metadata store";
  if (!le_win_store_lock(&store)) goto close_store;
  stage = "create identity-pinned namespace root";
  if (FAILED(StringCchPrintfW(namespace_directory, LE_COUNT_OF(namespace_directory),
      L"%s\\namespace", directory)) || !ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, SDDL_REVISION_1, &descriptor, NULL)) goto unlock_store;
  security_attributes.lpSecurityDescriptor = descriptor;
  if (!CreateDirectoryW(namespace_directory, &security_attributes)) goto unlock_store;
  LocalFree(descriptor); descriptor = NULL;
  stage = "open namespace root identity";
  namespace_handle = CreateFileW(namespace_directory,
      FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | READ_CONTROL,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL,
      OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  if (namespace_handle == INVALID_HANDLE_VALUE
      || !logic_engine_win_identity(namespace_handle, &namespace_identity, NULL)) goto unlock_store;
  CloseHandle(namespace_handle); namespace_handle = INVALID_HANDLE_VALUE;
  stage = "create namespace database file";
  if (FAILED(StringCchPrintfW(database_path, LE_COUNT_OF(database_path),
      L"%s\\memory.sqlite", namespace_directory))) goto unlock_store;
  database_handle = CreateFileW(database_path, GENERIC_READ | GENERIC_WRITE,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL,
      CREATE_NEW, FILE_ATTRIBUTE_NORMAL, NULL);
  if (database_handle == INVALID_HANDLE_VALUE
      || !logic_engine_win_identity(database_handle, &database_identity, NULL)) goto unlock_store;
  CloseHandle(database_handle); database_handle = INVALID_HANDLE_VALUE;
  stage = "serialize namespace identities";
  if (!format_identity(&namespace_identity, namespace_volume, sizeof(namespace_volume),
          namespace_file_id, sizeof(namespace_file_id))
      || !format_identity(&database_identity, database_volume, sizeof(database_volume),
          database_file_id, sizeof(database_file_id))) goto unlock_store;
  stage = "reconcile valid manifest against physical namespace";
  if (FAILED(StringCchPrintfA((char *)namespace_manifest, LE_COUNT_OF(namespace_manifest),
      "{\"schemaVersion\":1,\"generation\":1,\"platform\":\"windows\","
      "\"metadataRootIdentity\":{\"kind\":\"windows\",\"volumeSerial\":\"%s\",\"fileId\":\"%s\"},"
      "\"filesystemPolicy\":{\"filesystem\":\"NTFS\",\"identitySource\":\"opened-handle\",\"directoryMutationBoundary\":\"dedicated-service-identity\"},"
      "\"roles\":[{\"role\":\"main\",\"parentComponents\":[],\"parentIdentities\":[],\"databaseBasename\":\"memory.sqlite\","
      "\"databaseIdentity\":{\"kind\":\"windows\",\"volumeSerial\":\"%s\",\"fileId\":\"%s\"},\"state\":\"active\",\"sidecars\":[]}]}",
      namespace_volume, namespace_file_id, database_volume, database_file_id))) goto unlock_store;
  namespace_manifest_length = (DWORD)strlen((const char *)namespace_manifest);
  if (!le_win_reconcile_manifest_namespace(namespace_manifest, namespace_manifest_length,
      namespace_directory)) goto unlock_store;
  stage = "reject replaced database identity during reconciliation";
  memcpy(wrong_database_file_id, database_file_id, sizeof(wrong_database_file_id));
  wrong_database_file_id[31] = wrong_database_file_id[31] == '0' ? '1' : '0';
  if (FAILED(StringCchPrintfA((char *)namespace_manifest, LE_COUNT_OF(namespace_manifest),
      "{\"schemaVersion\":1,\"generation\":1,\"platform\":\"windows\","
      "\"metadataRootIdentity\":{\"kind\":\"windows\",\"volumeSerial\":\"%s\",\"fileId\":\"%s\"},"
      "\"filesystemPolicy\":{\"filesystem\":\"NTFS\",\"identitySource\":\"opened-handle\",\"directoryMutationBoundary\":\"dedicated-service-identity\"},"
      "\"roles\":[{\"role\":\"main\",\"parentComponents\":[],\"parentIdentities\":[],\"databaseBasename\":\"memory.sqlite\","
      "\"databaseIdentity\":{\"kind\":\"windows\",\"volumeSerial\":\"%s\",\"fileId\":\"%s\"},\"state\":\"active\",\"sidecars\":[]}]}",
      namespace_volume, namespace_file_id, database_volume, wrong_database_file_id))) goto unlock_store;
  namespace_manifest_length = (DWORD)strlen((const char *)namespace_manifest);
  if (le_win_reconcile_manifest_namespace(namespace_manifest, namespace_manifest_length,
      namespace_directory)) goto unlock_store;
  stage = "restore trusted manifest after negative identity fixture";
  if (FAILED(StringCchPrintfA((char *)namespace_manifest,LE_COUNT_OF(namespace_manifest),
      "{\"schemaVersion\":1,\"generation\":1,\"platform\":\"windows\","
      "\"metadataRootIdentity\":{\"kind\":\"windows\",\"volumeSerial\":\"%s\",\"fileId\":\"%s\"},"
      "\"filesystemPolicy\":{\"filesystem\":\"NTFS\",\"identitySource\":\"opened-handle\",\"directoryMutationBoundary\":\"dedicated-service-identity\"},"
      "\"roles\":[{\"role\":\"main\",\"parentComponents\":[],\"parentIdentities\":[],\"databaseBasename\":\"memory.sqlite\","
      "\"databaseIdentity\":{\"kind\":\"windows\",\"volumeSerial\":\"%s\",\"fileId\":\"%s\"},"
      "\"state\":\"active\",\"sidecars\":[]}]}",
      namespace_volume,namespace_file_id,database_volume,database_file_id))) goto unlock_store;
  namespace_manifest_length=(DWORD)strlen((const char *)namespace_manifest);
  stage = "open namespace root for create-intent recovery";
  namespace_handle = CreateFileW(namespace_directory,
      FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_ADD_FILE | FILE_DELETE_CHILD | FILE_READ_ATTRIBUTES | GENERIC_WRITE,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL,
      OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  if (namespace_handle == INVALID_HANDLE_VALUE) goto unlock_store;
  store.validate_manifest = le_win_validate_manifest;
  stage = "recover create intent when CREATE_NEW never produced a file";
  {
    static const unsigned char missing_create_intent[] =
      "{\"schemaVersion\":1,\"operationId\":\"1123456789abcdef0123456789abcdef\","
      "\"precondition\":\"absent\",\"operation\":\"create-sidecar\",\"role\":\"main\",\"kind\":\"shm\","
      "\"basename\":\"memory.sqlite-shm\",\"baseGeneration\":1,"
      "\"targetGeneration\":2,\"expectedIdentity\":null}";
    if (!le_win_recover_create_intent(&store,namespace_manifest,namespace_manifest_length,
        missing_create_intent,(DWORD)(sizeof(missing_create_intent)-1),namespace_directory)) goto unlock_store;
  }
  stage = "create sidecar for interrupted CREATE_NEW";
  if (!le_win_namespace_create_sidecar(namespace_handle, L"memory.sqlite-wal",
      &sidecar, &sidecar_identity)) goto unlock_store;
  if (!le_win_namespace_flush(sidecar) || !CloseHandle(sidecar)) goto unlock_store;
  sidecar = INVALID_HANDLE_VALUE;
  stage = "recover uncommitted create-sidecar intent and enroll identity";
  {
    static const unsigned char create_intent[] =
      "{\"schemaVersion\":1,\"operationId\":\"0123456789abcdef0123456789abcdef\","
      "\"precondition\":\"absent\",\"operation\":\"create-sidecar\",\"role\":\"main\",\"kind\":\"wal\","
      "\"basename\":\"memory.sqlite-wal\",\"baseGeneration\":1,"
      "\"targetGeneration\":2,\"expectedIdentity\":null}";
    if (!le_win_recover_create_intent(&store,namespace_manifest,namespace_manifest_length,
        create_intent,(DWORD)(sizeof(create_intent)-1),namespace_directory)) goto unlock_store;
    stage = "read recovered durable manifest";
    if (!le_win_store_read_manifest(&store,&manifest,&manifest_length)
        || !le_win_reconcile_manifest_namespace(manifest,manifest_length,namespace_directory)) goto unlock_store;
    stage = "reconcile committed create-sidecar intent";
    if (!le_win_recover_create_intent(&store,manifest,manifest_length,
        create_intent,(DWORD)(sizeof(create_intent)-1),namespace_directory)) goto unlock_store;
  }
  stage = "verify recovered sidecar remains openable";
  if (!le_win_namespace_open_sidecar(namespace_handle,L"memory.sqlite-wal",
      &sidecar_identity,&reopened,&reopened_identity)) goto unlock_store;
  if (!logic_engine_win_identity_equal(&sidecar_identity,&reopened_identity)) goto unlock_store;
  stage = "delete verified recovered sidecar";
  if (!le_win_namespace_delete_sidecar(namespace_handle,&reopened,&sidecar_identity)) goto unlock_store;
  reopened = INVALID_HANDLE_VALUE;
  HeapFree(GetProcessHeap(),0,manifest);manifest=NULL;manifest_length=0;
  store.validate_manifest = validate_test_json;
  CloseHandle(namespace_handle);namespace_handle=INVALID_HANDLE_VALUE;
  stage = "probe directory FlushFileBuffers";
  if (!FlushFileBuffers(store.directory)) goto unlock_store;
  stage = "write manifest";
  if (!le_win_store_write_manifest(&store, document, (DWORD)(sizeof(document)))) goto unlock_store;
  stage = "reject invalid manifest";
  if (le_win_store_write_manifest(&store, invalid_document, (DWORD)(sizeof(invalid_document) - 1))) goto unlock_store;
  stage = "write intent";
  if (!le_win_store_write_intent(&store, document, (DWORD)(sizeof(document)))) goto unlock_store;
  stage = "read manifest";
  if (!le_win_store_read_manifest(&store, &manifest, &manifest_length)) goto unlock_store;
  stage = "read intent";
  if (!le_win_store_read_intent(&store, &intent, &intent_length)) goto unlock_store;
  if (manifest_length != sizeof(document) || intent_length != sizeof(document)
      || memcmp(manifest, document, manifest_length) != 0
      || memcmp(intent, document, intent_length) != 0) goto unlock_store;
  stage = "release store lock before startup recovery";
  le_win_store_unlock(&store);
  stage = "retain intent when recovery callback rejects";
  if (le_win_store_startup_recover(&store, recover_test, &reject_recovery)
      || GetLastError() != ERROR_RECOVERY_FAILURE) goto close_store;
  stage = "verify rejected recovery retained intent";
  if (!le_win_store_lock(&store)
      || !le_win_store_read_intent(&store, &recovery_intent, &recovery_intent_length)
      || recovery_intent_length != sizeof(document)
      || memcmp(recovery_intent, document, recovery_intent_length) != 0) goto unlock_store;
  HeapFree(GetProcessHeap(), 0, recovery_intent);
  recovery_intent = NULL;
  le_win_store_unlock(&store);
  reject_recovery = 0;
  stage = "complete startup recovery and retire intent";
  if (!le_win_store_startup_recover(&store, recover_test, &reject_recovery)) goto close_store;
  stage = "verify successful recovery removed intent";
  if (!le_win_store_lock(&store)) goto close_store;
  if (le_win_store_read_intent(&store, &recovery_intent, &recovery_intent_length)
      || GetLastError() != ERROR_FILE_NOT_FOUND) goto unlock_store;
  le_win_store_unlock(&store);
  stage = "recover clean startup with no pending intent";
  if (!le_win_store_startup_recover(&store, recover_test, &reject_recovery)) goto close_store;
  stage = "create sidecar";
  if (!le_win_namespace_create_sidecar(store.directory, L"smoke-wal", &sidecar, &sidecar_identity)) goto unlock_store;
  stage = "reject duplicate sidecar";
  if (le_win_namespace_create_sidecar(store.directory, L"smoke-wal", &reopened, &reopened_identity)) goto unlock_store;
  stage = "reject invalid sidecar suffix";
  if (le_win_namespace_create_sidecar(store.directory, L"smoke.txt", &reopened, &reopened_identity)) goto unlock_store;
  stage = "flush sidecar and parent directory";
  if (!le_win_namespace_flush(sidecar) || !le_win_namespace_flush_parent(store.directory)) goto unlock_store;
  stage = "reopen sidecar";
  if (!le_win_namespace_open_sidecar(store.directory, L"smoke-wal", &sidecar_identity, &reopened, &reopened_identity)) goto unlock_store;
  stage = "compare reopened identity";
  if (!logic_engine_win_identity_equal(&sidecar_identity, &reopened_identity)) goto unlock_store;
  CloseHandle(reopened);
  reopened = INVALID_HANDLE_VALUE;
  wrong_identity = sidecar_identity;
  wrong_identity.file_id.Identifier[0] ^= 0x01;
  stage = "reject wrong identity";
  if (le_win_namespace_open_sidecar(store.directory, L"smoke-wal", &wrong_identity, &reopened, &reopened_identity)) {
    if (reopened != INVALID_HANDLE_VALUE) CloseHandle(reopened);
  if (namespace_handle != INVALID_HANDLE_VALUE) CloseHandle(namespace_handle);
  if (database_handle != INVALID_HANDLE_VALUE) CloseHandle(database_handle);
    reopened = INVALID_HANDLE_VALUE;
    goto unlock_store;
  }
  stage = "reject missing identity";
  if (le_win_namespace_open_sidecar(store.directory, L"smoke-wal", NULL, &reopened, &reopened_identity)) {
    if (reopened != INVALID_HANDLE_VALUE) CloseHandle(reopened);
    reopened = INVALID_HANDLE_VALUE;
    goto unlock_store;
  }
  stage = "reject wrong-identity deletion";
  if (le_win_namespace_delete_sidecar(store.directory, &sidecar, &wrong_identity)) goto unlock_store;
  stage = "delete verified sidecar";
  if (!le_win_namespace_delete_sidecar(store.directory, &sidecar, &sidecar_identity)) goto unlock_store;
  stage = "remove manifest to exercise missing-manifest fail-closed path";
  {
    wchar_t manifest_path[MAX_PATH];
    if (FAILED(StringCchPrintfW(manifest_path, LE_COUNT_OF(manifest_path),
        L"%s\\manifest.json", directory)) || !DeleteFileW(manifest_path)) goto unlock_store;
  }
  stage = "reject startup without a manifest";
  if (le_win_store_startup_recover(&store, recover_test, &reject_recovery)
      || GetLastError() != ERROR_FILE_NOT_FOUND) goto unlock_store;
  result = 0;
unlock_store:

  if (reopened != INVALID_HANDLE_VALUE) CloseHandle(reopened);
  if (sidecar != INVALID_HANDLE_VALUE) CloseHandle(sidecar);
  if (manifest) HeapFree(GetProcessHeap(), 0, manifest);
  if (intent) HeapFree(GetProcessHeap(), 0, intent);
  if (recovery_intent) HeapFree(GetProcessHeap(), 0, recovery_intent);
  le_win_store_unlock(&store);
close_store:
  le_win_store_close(&store);
done:
  if (result != 0) {
    fprintf(stderr, "Windows smoke failed at %s (GetLastError=%lu)\n",
        stage, (unsigned long)GetLastError());
    fflush(stderr);
  }
  if (database_path[0]) DeleteFileW(database_path);
  if (namespace_directory[0]) RemoveDirectoryW(namespace_directory);
  if (directory[0]) {
    wchar_t child[MAX_PATH];
    if (SUCCEEDED(StringCchPrintfW(child, LE_COUNT_OF(child), L"%s\\manifest.json", directory))) DeleteFileW(child);
    if (SUCCEEDED(StringCchPrintfW(child, LE_COUNT_OF(child), L"%s\\store.lock", directory))) DeleteFileW(child);
    if (SUCCEEDED(StringCchPrintfW(child, LE_COUNT_OF(child), L"%s\\intent.json", directory))) DeleteFileW(child);
    if (SUCCEEDED(StringCchPrintfW(child, LE_COUNT_OF(child), L"%s\\smoke-wal", directory))) DeleteFileW(child);
    RemoveDirectoryW(directory);
  }
  if (descriptor) LocalFree(descriptor);
  if (user_sid) LocalFree(user_sid);
  if (user) HeapFree(GetProcessHeap(), 0, user);
  if (token) CloseHandle(token);
  return result;
}
