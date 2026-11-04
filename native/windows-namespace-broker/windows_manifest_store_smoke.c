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

static int validate_test_json(const unsigned char *bytes, DWORD length, void *context) {
  static const unsigned char expected[] = { 0x7b, 0x22, 0x6f, 0x6b, 0x22, 0x3a, 0x74, 0x72, 0x75, 0x65, 0x7d };
  (void)context;
  return length == sizeof(expected) - 1 && memcmp(bytes, expected, sizeof(expected) - 1) == 0;
}

int main(void) {
  wchar_t temp[MAX_PATH] = { 0 }, directory[MAX_PATH] = { 0 };
  LE_WIN_MANIFEST_STORE store;
  unsigned char *manifest = NULL, *intent = NULL;
  DWORD manifest_length = 0, intent_length = 0;
  HANDLE sidecar = INVALID_HANDLE_VALUE, reopened = INVALID_HANDLE_VALUE;
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
  stage = "probe directory FlushFileBuffers";
  if (!FlushFileBuffers(store.directory)) goto unlock_store;
  stage = "write manifest";
  if (!le_win_store_write_manifest(&store, document, (DWORD)(sizeof(document) - 1))) goto unlock_store;
  stage = "reject invalid manifest";
  if (le_win_store_write_manifest(&store, invalid_document, (DWORD)(sizeof(invalid_document) - 1))) goto unlock_store;
  stage = "write intent";
  if (!le_win_store_write_intent(&store, document, (DWORD)(sizeof(document) - 1))) goto unlock_store;
  stage = "read manifest";
  if (!le_win_store_read_manifest(&store, &manifest, &manifest_length)) goto unlock_store;
  stage = "read intent";
  if (!le_win_store_read_intent(&store, &intent, &intent_length)) goto unlock_store;
  if (manifest_length != sizeof(document) - 1 || intent_length != sizeof(document) - 1
      || memcmp(manifest, document, manifest_length) != 0
      || memcmp(intent, document, intent_length) != 0) goto unlock_store;
  stage = "remove intent";
  if (!le_win_store_remove_intent(&store)) goto unlock_store;
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
  result = 0;
unlock_store:

  if (reopened != INVALID_HANDLE_VALUE) CloseHandle(reopened);
  if (sidecar != INVALID_HANDLE_VALUE) CloseHandle(sidecar);
  if (manifest) HeapFree(GetProcessHeap(), 0, manifest);
  if (intent) HeapFree(GetProcessHeap(), 0, intent);
  le_win_store_unlock(&store);
close_store:
  le_win_store_close(&store);
done:
  if (result != 0) {
    fprintf(stderr, "Windows smoke failed at %s (GetLastError=%lu)\\n",
        stage, (unsigned long)GetLastError());
    fflush(stderr);
  }
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
