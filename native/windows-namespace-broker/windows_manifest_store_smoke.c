#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <string.h>
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
  if (!GetTempPathW(_countof(temp), temp)) return 2;
  if (FAILED(StringCchPrintfW(directory, _countof(directory),
      L"%sLogicEngineBrokerStore-%lu-%llu", temp,
      GetCurrentProcessId(), GetTickCount64()))) return 3;
  if (!CreateDirectoryW(directory, NULL)) return 4;
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
  RemoveDirectoryW(directory);
  return result;
}
