#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <string.h>
#include <sddl.h>
#include <strsafe.h>
#define LE_COUNT_OF(value) (sizeof(value) / sizeof((value)[0]))
#include "windows_manifest_store.c"

static int validate_test_json(const unsigned char *bytes, DWORD length, void *context) {
  static const unsigned char expected[] = "{\"ok\":true}";
  (void)context;
  return length == sizeof(expected) - 1 && memcmp(bytes, expected, sizeof(expected) - 1) == 0;
}

int main(void) {
  wchar_t temp[MAX_PATH], directory[MAX_PATH];
  LE_WIN_MANIFEST_STORE store;
  unsigned char *manifest = NULL, *intent = NULL;
  DWORD manifest_length = 0, intent_length = 0;
  static const unsigned char document[] = "{\"ok\":true}";
  int result = 1;
  HANDLE token = NULL;
  TOKEN_USER *user = NULL;
  DWORD token_bytes = 0;
  LPWSTR user_sid = NULL;
  PSECURITY_DESCRIPTOR descriptor = NULL;
  SECURITY_ATTRIBUTES security_attributes;
  wchar_t sddl[512];
  if (!GetTempPathW(LE_COUNT_OF(temp), temp)) return 2;
  if (FAILED(StringCchPrintfW(directory, LE_COUNT_OF(directory),
      L"%sLogicEngineBrokerStore-%lu-%llu", temp,
      GetCurrentProcessId(), GetTickCount64()))) return 3;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return 4;
  GetTokenInformation(token, TokenUser, NULL, 0, &token_bytes);
  if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || token_bytes == 0) goto done;
  user = (TOKEN_USER *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, token_bytes);
  if (!user || !GetTokenInformation(token, TokenUser, user, token_bytes, &token_bytes)
      || !ConvertSidToStringSidW(user->User.Sid, &user_sid)) goto done;
  if (FAILED(StringCchPrintfW(sddl, LE_COUNT_OF(sddl),
      L"D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;%s)", user_sid))
      || !ConvertStringSecurityDescriptorToSecurityDescriptorW(
          sddl, SDDL_REVISION_1, &descriptor, NULL)) goto done;
  ZeroMemory(&security_attributes, sizeof(security_attributes));
  security_attributes.nLength = sizeof(security_attributes);
  security_attributes.lpSecurityDescriptor = descriptor;
  if (!CreateDirectoryW(directory, &security_attributes)) goto done;
  LocalFree(descriptor); descriptor = NULL;
  LocalFree(user_sid); user_sid = NULL;
  HeapFree(GetProcessHeap(), 0, user); user = NULL;
  CloseHandle(token); token = NULL;
  if (!le_win_store_open(&store, directory, validate_test_json, validate_test_json, NULL)) goto done;
  if (!le_win_store_lock(&store)) goto close_store;
  if (!le_win_store_write_manifest(&store, document, (DWORD)(sizeof(document) - 1))) goto unlock_store;
  if (!le_win_store_write_intent(&store, document, (DWORD)(sizeof(document) - 1))) goto unlock_store;
  if (!le_win_store_read_manifest(&store, &manifest, &manifest_length)) goto unlock_store;
  if (!le_win_store_read_intent(&store, &intent, &intent_length)) goto unlock_store;
  if (manifest_length != sizeof(document) - 1 || intent_length != sizeof(document) - 1
      || memcmp(manifest, document, manifest_length) != 0
      || memcmp(intent, document, intent_length) != 0) goto unlock_store;
  if (!le_win_store_remove_intent(&store)) goto unlock_store;
  result = 0;
unlock_store:
  if (manifest) HeapFree(GetProcessHeap(), 0, manifest);
  if (intent) HeapFree(GetProcessHeap(), 0, intent);
  le_win_store_unlock(&store);
close_store:
  le_win_store_close(&store);
done:
  {
    wchar_t child[MAX_PATH];
    if (SUCCEEDED(StringCchPrintfW(child, LE_COUNT_OF(child), L\"%s\\manifest.json\", directory))) DeleteFileW(child);
    if (SUCCEEDED(StringCchPrintfW(child, LE_COUNT_OF(child), L\"%s\\store.lock\", directory))) DeleteFileW(child);
    if (SUCCEEDED(StringCchPrintfW(child, LE_COUNT_OF(child), L\"%s\\intent.json\", directory))) DeleteFileW(child);
  }
  RemoveDirectoryW(directory);
  if (descriptor) LocalFree(descriptor);
  if (user_sid) LocalFree(user_sid);
  if (user) HeapFree(GetProcessHeap(), 0, user);
  if (token) CloseHandle(token);
  return result;
}
