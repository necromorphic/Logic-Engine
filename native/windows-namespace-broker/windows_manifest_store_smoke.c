#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
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


#define BROKER_TEST_PIPE L"\\\\.\\pipe\\LogicEngine.SqliteBroker.v1"
#define BROKER_TEST_MAGIC 0x4c454256u
#define BROKER_TEST_VERSION 2u
#pragma pack(push, 1)
typedef struct {
  uint32_t magic;
  uint16_t version, operation;
  uint32_t flags;
  uint64_t request_id;
  uint32_t payload_length;
} BROKER_TEST_HEADER;
#pragma pack(pop)

static uint64_t broker_test_request_id = 1;
static uint16_t broker_test_net16(uint16_t value) {
  return (uint16_t)((value << 8) | (value >> 8));
}
static uint32_t broker_test_net32(uint32_t value) {
  return ((value & 0x000000ffu) << 24) | ((value & 0x0000ff00u) << 8)
    | ((value & 0x00ff0000u) >> 8) | ((value & 0xff000000u) >> 24);
}
static uint64_t broker_test_net64(uint64_t value) {
  return ((uint64_t)broker_test_net32((uint32_t)value) << 32)
    | broker_test_net32((uint32_t)(value >> 32));
}
static BOOL broker_test_write_all(HANDLE handle, const void *buffer, DWORD length) {
  const BYTE *bytes=(const BYTE *)buffer;DWORD done=0;
  while(done<length){DWORD written=0;if(!WriteFile(handle,bytes+done,length-done,&written,NULL)||!written)return FALSE;done+=written;}
  return TRUE;
}
static BOOL broker_test_read_all(HANDLE handle, void *buffer, DWORD length) {
  BYTE *bytes=(BYTE *)buffer;DWORD done=0;
  while(done<length){DWORD read=0;if(!ReadFile(handle,bytes+done,length-done,&read,NULL)||!read)return FALSE;done+=read;}
  return TRUE;
}
static int broker_test_request(
    uint16_t operation,const char *role,const char *kind,
    DWORD *status,HANDLE *opened) {
  BROKER_TEST_HEADER request,response;
  char payload[146];size_t role_length,kind_length;
  uint64_t request_id,wire_handle=0,handle_value=0;
  HANDLE pipe=INVALID_HANDLE_VALUE,candidate=INVALID_HANDLE_VALUE;
  int ok=0;
  if(opened)*opened=INVALID_HANDLE_VALUE;
  if(!role||!kind||!status)return 0;
  role_length=strlen(role);kind_length=strlen(kind);
  if(!role_length||role_length>128||!kind_length||kind_length>8
      ||role_length+1+kind_length>sizeof(payload))return 0;
  memcpy(payload,role,role_length);payload[role_length]=0;
  memcpy(payload+role_length+1,kind,kind_length);
  request_id=broker_test_request_id++;
  if(!WaitNamedPipeW(BROKER_TEST_PIPE,5000))return 0;
  pipe=CreateFileW(BROKER_TEST_PIPE,GENERIC_READ|GENERIC_WRITE,0,NULL,
      OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,NULL);
  if(pipe==INVALID_HANDLE_VALUE)return 0;
  ZeroMemory(&request,sizeof(request));
  request.magic=broker_test_net32(BROKER_TEST_MAGIC);
  request.version=broker_test_net16(BROKER_TEST_VERSION);
  request.operation=broker_test_net16(operation);
  request.request_id=broker_test_net64(request_id);
  request.payload_length=broker_test_net32((uint32_t)(role_length+1+kind_length));
  if(!broker_test_write_all(pipe,&request,sizeof(request))
      ||!broker_test_write_all(pipe,payload,(DWORD)(role_length+1+kind_length))
      ||!broker_test_read_all(pipe,&response,sizeof(response)))goto done;
  response.magic=broker_test_net32(response.magic);
  response.version=broker_test_net16(response.version);
  response.operation=broker_test_net16(response.operation);
  response.flags=broker_test_net32(response.flags);
  response.request_id=broker_test_net64(response.request_id);
  response.payload_length=broker_test_net32(response.payload_length);
  if(response.magic!=BROKER_TEST_MAGIC||response.version!=BROKER_TEST_VERSION
      ||response.operation!=operation||response.request_id!=request_id)goto done;
  if(response.flags==0&&opened){
    DWORD handle_flags=0;
    if(response.payload_length!=sizeof(wire_handle)
        ||!broker_test_read_all(pipe,&wire_handle,sizeof(wire_handle)))goto done;
    handle_value=broker_test_net64(wire_handle);
    if(!handle_value||handle_value>(uint64_t)UINTPTR_MAX)goto done;
    candidate=(HANDLE)(uintptr_t)handle_value;
    if(!candidate||candidate==INVALID_HANDLE_VALUE
        ||!GetHandleInformation(candidate,&handle_flags))goto done;
    *opened=candidate;candidate=INVALID_HANDLE_VALUE;
  }else if(response.payload_length!=0)goto done;
  *status=response.flags;ok=1;
done:
  if(candidate!=INVALID_HANDLE_VALUE&&candidate!=NULL)CloseHandle(candidate);
  if(!ok&&opened&&*opened!=INVALID_HANDLE_VALUE&&*opened!=NULL){
    CloseHandle(*opened);*opened=INVALID_HANDLE_VALUE;
  }
  if(pipe!=INVALID_HANDLE_VALUE)CloseHandle(pipe);
  return ok;
}
static int broker_test_start_console(
    const wchar_t *service_sid,const wchar_t *metadata_directory,
    const wchar_t *namespace_directory,PROCESS_INFORMATION *process) {
  wchar_t executable[32768],command[32768];
  STARTUPINFOW startup;DWORD length;int attempt;
  ZeroMemory(process,sizeof(*process));ZeroMemory(&startup,sizeof(startup));
  startup.cb=sizeof(startup);
  length=GetEnvironmentVariableW(L"LOGIC_ENGINE_BROKER_EXE",executable,(DWORD)LE_COUNT_OF(executable));
  if(!length||length>=LE_COUNT_OF(executable))return 0;
  if(FAILED(StringCchPrintfW(command,LE_COUNT_OF(command),
      L"\"%s\" --console-test --client-sid \"%s\" --metadata-dir \"%s\" --namespace-root \"%s\"",
      executable,service_sid,metadata_directory,namespace_directory)))return 0;
  if(!CreateProcessW(NULL,command,NULL,NULL,FALSE,CREATE_NO_WINDOW,NULL,NULL,&startup,process))return 0;
  for(attempt=0;attempt<100;attempt++){
    if(WaitNamedPipeW(BROKER_TEST_PIPE,100))return 1;
    if(WaitForSingleObject(process->hProcess,0)==WAIT_OBJECT_0)break;
    Sleep(10);
  }
  TerminateProcess(process->hProcess,ERROR_TIMEOUT);
  WaitForSingleObject(process->hProcess,5000);
  CloseHandle(process->hThread);CloseHandle(process->hProcess);
  ZeroMemory(process,sizeof(*process));
  return 0;
}
static int broker_test_handle_bytes(HANDLE handle,const BYTE *expected,DWORD length) {
  BYTE actual[128];DWORD read=0;
  if(length>sizeof(actual)||!ReadFile(handle,actual,length,&read,NULL)||read!=length)return 0;
  return memcmp(actual,expected,length)==0;
}
static int broker_test_write_bytes(HANDLE handle,const BYTE *bytes,DWORD length) {
  DWORD written=0;
  return WriteFile(handle,bytes,length,&written,NULL)&&written==length;
}
static int broker_test_service_ipc(
    const wchar_t *service_sid,const wchar_t *metadata_directory,
    const wchar_t *namespace_directory,const BYTE *main_bytes,DWORD main_length) {
  PROCESS_INFORMATION process;HANDLE opened=INVALID_HANDLE_VALUE;
  DWORD status=0;int ok=0;
  static const BYTE wal_bytes[]="broker-wal-handle";
  static const BYTE shm_bytes[]="broker-shm-handle";
  if(!broker_test_start_console(service_sid,metadata_directory,namespace_directory,&process))return 0;
  if(!broker_test_request(2,"main","main",&status,&opened)||status!=0
      ||opened==INVALID_HANDLE_VALUE||!broker_test_handle_bytes(opened,main_bytes,main_length))goto done;
  CloseHandle(opened);opened=INVALID_HANDLE_VALUE;
  if(!broker_test_request(7,"main","wal",&status,&opened)||status!=0
      ||opened==INVALID_HANDLE_VALUE||!broker_test_write_bytes(opened,wal_bytes,(DWORD)(sizeof(wal_bytes)-1)))goto done;
  CloseHandle(opened);opened=INVALID_HANDLE_VALUE;
  if(!broker_test_request(3,"main","wal",&status,&opened)||status!=0
      ||opened==INVALID_HANDLE_VALUE||!broker_test_handle_bytes(opened,wal_bytes,(DWORD)(sizeof(wal_bytes)-1)))goto done;
  CloseHandle(opened);opened=INVALID_HANDLE_VALUE;
  if(!broker_test_request(8,"main","wal",&status,NULL)||status!=0)goto done;
  if(!broker_test_request(4,"main","wal",&status,NULL)||status!=0)goto done;
  if(!broker_test_request(8,"main","wal",&status,NULL)||status!=5)goto done;
  if(!broker_test_request(3,"main","wal",&status,&opened)||status!=5
      ||opened!=INVALID_HANDLE_VALUE)goto done;
  if(!broker_test_request(5,"main","shm",&status,&opened)||status!=0
      ||opened==INVALID_HANDLE_VALUE||!broker_test_write_bytes(opened,shm_bytes,(DWORD)(sizeof(shm_bytes)-1)))goto done;
  CloseHandle(opened);opened=INVALID_HANDLE_VALUE;
  if(!broker_test_request(4,"main","shm",&status,NULL)||status!=0)goto done;
  if(!broker_test_request(8,"main","shm",&status,NULL)||status!=5)goto done;
  ok=1;
done:
  if(opened!=INVALID_HANDLE_VALUE&&opened!=NULL)CloseHandle(opened);
  if(process.hProcess){
    TerminateProcess(process.hProcess,0);
    WaitForSingleObject(process.hProcess,5000);
    CloseHandle(process.hThread);CloseHandle(process.hProcess);
  }
  return ok;
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
  BOOL access_exists = FALSE;
  HANDLE sidecar = INVALID_HANDLE_VALUE, reopened = INVALID_HANDLE_VALUE;
  HANDLE broker_opened = INVALID_HANDLE_VALUE;
  HANDLE namespace_handle = INVALID_HANDLE_VALUE, database_handle = INVALID_HANDLE_VALUE;
  LogicEngineWinFileIdentity namespace_identity, database_identity;
  char namespace_volume[17], namespace_file_id[33], database_volume[17], database_file_id[33];
  char sidecar_volume[17], sidecar_file_id[33], delete_intent[1024];
  DWORD delete_intent_length = 0;
  char wrong_database_file_id[33];
  unsigned char namespace_manifest[4096];
  DWORD namespace_manifest_length = 0;
  LogicEngineWinFileIdentity sidecar_identity, reopened_identity, wrong_identity;
  static const unsigned char document[] = { 0x7b, 0x22, 0x6f, 0x6b, 0x22, 0x3a, 0x74, 0x72, 0x75, 0x65, 0x7d };
  static const BYTE broker_main_bytes[] = "broker-main-handle";
  DWORD database_written = 0;
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
      || !logic_engine_win_identity(database_handle, &database_identity, NULL)
      || !WriteFile(database_handle,broker_main_bytes,(DWORD)(sizeof(broker_main_bytes)-1),
          &database_written,NULL)
      || database_written!=(DWORD)(sizeof(broker_main_bytes)-1)) goto unlock_store;
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
  store.validate_intent = le_win_validate_intent;
  stage = "recover create intent when CREATE_NEW never produced a file";
  {
    static const unsigned char missing_create_intent[] =
      "{\"schemaVersion\":1,\"operationId\":\"1123456789abcdef0123456789abcdef\","
      "\"precondition\":\"absent\",\"operation\":\"create-sidecar\",\"role\":\"main\",\"kind\":\"shm\","
      "\"basename\":\"memory.sqlite-shm\",\"baseGeneration\":1,"
      "\"targetGeneration\":2,\"expectedIdentity\":null}";
    if (!le_win_recover_lifecycle_intent(&store,namespace_manifest,namespace_manifest_length,
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
    if (!le_win_recover_lifecycle_intent(&store,namespace_manifest,namespace_manifest_length,
        create_intent,(DWORD)(sizeof(create_intent)-1),namespace_directory)) goto unlock_store;
    stage = "read recovered durable manifest";
    if (!le_win_store_read_manifest(&store,&manifest,&manifest_length)
        || !le_win_reconcile_manifest_namespace(manifest,manifest_length,namespace_directory)) goto unlock_store;
    stage = "manifest-backed access recognizes registered main file";
    if (!le_win_access_role_file(&store,namespace_directory,"main","main",&access_exists)
        || !access_exists) goto unlock_store;
    stage = "manifest-backed access recognizes active WAL sidecar";
    if (!le_win_access_role_file(&store,namespace_directory,"main","wal",&access_exists)
        || !access_exists) goto unlock_store;
    stage = "manifest-backed access reports absent SHM sidecar";
    if (!le_win_access_role_file(&store,namespace_directory,"main","shm",&access_exists)
        || access_exists) goto unlock_store;
    stage = "manifest-backed access rejects unknown role";
    if (le_win_access_role_file(&store,namespace_directory,"missing-role","main",&access_exists)
        || GetLastError()!=ERROR_INVALID_NAME) goto unlock_store;
    stage = "open registered main database by manifest identity";
    if (!le_win_open_role_file(&store,namespace_directory,"main","main",&broker_opened)
        || broker_opened==INVALID_HANDLE_VALUE) goto unlock_store;
    if (!CloseHandle(broker_opened)) goto unlock_store;
    broker_opened=INVALID_HANDLE_VALUE;
    stage = "open active WAL sidecar by manifest identity";
    if (!le_win_open_role_file(&store,namespace_directory,"main","wal",&broker_opened)
        || broker_opened==INVALID_HANDLE_VALUE) goto unlock_store;
    if (!CloseHandle(broker_opened)) goto unlock_store;
    broker_opened=INVALID_HANDLE_VALUE;
    stage = "reject open for unregistered role";
    if (le_win_open_role_file(&store,namespace_directory,"missing-role","main",&broker_opened)) goto unlock_store;
    stage = "reconcile committed create-sidecar intent";
    if (!le_win_recover_lifecycle_intent(&store,manifest,manifest_length,
        create_intent,(DWORD)(sizeof(create_intent)-1),namespace_directory)) goto unlock_store;
  }
  stage = "verify recovered sidecar remains openable";
  if (!le_win_namespace_open_sidecar(namespace_handle,L"memory.sqlite-wal",
      &sidecar_identity,&reopened,&reopened_identity)) goto unlock_store;
  if (!logic_engine_win_identity_equal(&sidecar_identity,&reopened_identity)) goto unlock_store;
  CloseHandle(reopened);reopened=INVALID_HANDLE_VALUE;
  stage = "serialize identity-bound delete intent";
  if (!format_identity(&sidecar_identity,sidecar_volume,sizeof(sidecar_volume),
      sidecar_file_id,sizeof(sidecar_file_id))
      || FAILED(StringCchPrintfA(delete_intent,LE_COUNT_OF(delete_intent),
      "{\"schemaVersion\":1,\"operationId\":\"4123456789abcdef0123456789abcdef\","
      "\"precondition\":\"identity-match\",\"operation\":\"delete-sidecar\",\"role\":\"main\",\"kind\":\"wal\","
      "\"basename\":\"memory.sqlite-wal\",\"baseGeneration\":2,\"targetGeneration\":3,"
      "\"expectedIdentity\":{\"kind\":\"windows\",\"volumeSerial\":\"%s\",\"fileId\":\"%s\"}}",
      sidecar_volume,sidecar_file_id))) goto unlock_store;
  delete_intent_length=(DWORD)strlen(delete_intent);
  stage = "recover identity-bound delete before manifest commit";
  if (!le_win_recover_lifecycle_intent(&store,manifest,manifest_length,
      (const unsigned char *)delete_intent,delete_intent_length,namespace_directory)) goto unlock_store;
  HeapFree(GetProcessHeap(),0,manifest);manifest=NULL;manifest_length=0;
  stage = "read durable retired-sidecar manifest";
  if (!le_win_store_read_manifest(&store,&manifest,&manifest_length)
      || !le_win_reconcile_manifest_namespace(manifest,manifest_length,namespace_directory)) goto unlock_store;
  stage = "manifest-backed access reports retired WAL sidecar absent";
  if (!le_win_access_role_file(&store,namespace_directory,"main","wal",&access_exists)
      || access_exists) goto unlock_store;
  stage = "reconcile committed delete intent after manifest commit";
  if (!le_win_recover_lifecycle_intent(&store,manifest,manifest_length,
      (const unsigned char *)delete_intent,delete_intent_length,namespace_directory)) goto unlock_store;
  stage = "verify retired sidecar path remains absent";
  reopened = logic_engine_win_open_relative(namespace_handle,L"memory.sqlite-wal",
      FILE_READ_ATTRIBUTES,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,
      FILE_OPEN,FILE_NON_DIRECTORY_FILE,FILE_ATTRIBUTE_NORMAL,NULL,NULL);
  if (reopened!=INVALID_HANDLE_VALUE||GetLastError()!=ERROR_FILE_NOT_FOUND) goto unlock_store;
  stage = "runtime create-sidecar transaction writes intent and commits manifest";
  if (!le_win_create_role_sidecar(&store,namespace_directory,"main","shm",
      &broker_opened,&sidecar_identity) || broker_opened==INVALID_HANDLE_VALUE) goto unlock_store;
  stage = "runtime-created SHM is active in manifest-backed access";
  if (!le_win_access_role_file(&store,namespace_directory,"main","shm",&access_exists)
      || !access_exists) goto unlock_store;
  stage = "runtime-created SHM reopens by committed File ID";
  if (!le_win_open_role_file(&store,namespace_directory,"main","shm",&reopened)
      || reopened==INVALID_HANDLE_VALUE) goto unlock_store;
  if (!CloseHandle(reopened) || !CloseHandle(broker_opened)) goto unlock_store;
  reopened=INVALID_HANDLE_VALUE;broker_opened=INVALID_HANDLE_VALUE;
  stage = "runtime delete rejects unknown role instead of treating it as absent sidecar";
  if (le_win_delete_role_sidecar(&store,namespace_directory,"missing-role","shm")
      || GetLastError()!=ERROR_INVALID_NAME) goto unlock_store;
  stage = "runtime delete-sidecar transaction writes intent and retires manifest entry";
  if (!le_win_delete_role_sidecar(&store,namespace_directory,"main","shm")) goto unlock_store;
  stage = "runtime-deleted SHM is absent from manifest-backed access";
  if (!le_win_access_role_file(&store,namespace_directory,"main","shm",&access_exists)
      || access_exists) goto unlock_store;
  stage = "runtime-deleted SHM cannot be reopened by role identity";
  if (le_win_open_role_file(&store,namespace_directory,"main","shm",&reopened)) goto unlock_store;
  stage = "runtime sidecar transactions retire their intents";
  if (le_win_store_read_intent(&store,&recovery_intent,&recovery_intent_length)
      || GetLastError()!=ERROR_FILE_NOT_FOUND) goto unlock_store;
  stage = "release store lock for live broker IPC";
  le_win_store_unlock(&store);
  stage = "cross-process broker OPEN_MAIN, sidecar create/open/access/delete IPC";
  if (!broker_test_service_ipc(user_sid,directory,namespace_directory,
      broker_main_bytes,(DWORD)(sizeof(broker_main_bytes)-1))) goto close_store;
  stage = "reacquire store lock after live broker IPC";
  if (!le_win_store_lock(&store)) goto close_store;
  HeapFree(GetProcessHeap(),0,manifest);manifest=NULL;manifest_length=0;
  store.validate_manifest = validate_test_json;
  store.validate_intent = validate_test_json;
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
  if (broker_opened != INVALID_HANDLE_VALUE) CloseHandle(broker_opened);
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
