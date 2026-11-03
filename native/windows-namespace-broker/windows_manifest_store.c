/*
 * Durable Windows broker metadata store.
 *
 * This module owns only the broker's private metadata directory. It exposes
 * logical fixed names (manifest/intent), never caller-provided paths. The
 * directory is pinned once; all child opens and renames are relative to that
 * retained handle. JSON/schema validation is mandatory at the call boundary
 * and is supplied by the broker's trusted manifest validator.
 *
 * IMPORTANT: this is a storage primitive, not the complete broker. It must not
 * be enabled until the caller wires validation, startup reconciliation and
 * the namespace lifecycle coordinator, and Windows crash/ACL tests pass.
 */
#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <stdint.h>
#include <stddef.h>
#include <wchar.h>
#include <strsafe.h>
#include <bcrypt.h>
#include "../secure-vfs-probe/windows_relative_open.h"

#define LE_STORE_MAX_BYTES (1024u * 1024u)
#define LE_STORE_MANIFEST L"manifest.json"
#define LE_STORE_INTENT L"intent.json"
#define LE_STORE_LOCK L"store.lock"

typedef int (*LE_STORE_VALIDATE)(const unsigned char *bytes, DWORD length, void *context);

typedef struct LE_WIN_MANIFEST_STORE {
  HANDLE directory;
  HANDLE lock;
  LogicEngineWinFileIdentity directory_identity;
  LE_STORE_VALIDATE validate_manifest;
  LE_STORE_VALIDATE validate_intent;
  void *validator_context;
  BOOL locked;
} LE_WIN_MANIFEST_STORE;

static int le_store_valid_regular(HANDLE file, DWORD *length) {
  FILE_ATTRIBUTE_TAG_INFO tag;
  LARGE_INTEGER size;
  LogicEngineWinFileIdentity identity;
  if (!logic_engine_win_identity(file, &identity, NULL)
      || !GetFileInformationByHandleEx(file, FileAttributeTagInfo, &tag, sizeof(tag))
      || (tag.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0
      || (tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0
      || !GetFileSizeEx(file, &size) || size.QuadPart < 0
      || (ULONGLONG)size.QuadPart > LE_STORE_MAX_BYTES) {
    SetLastError(ERROR_ACCESS_DENIED);
    return 0;
  }
  if (length) *length = (DWORD)size.QuadPart;
  return 1;
}

/*
 * The configured directory must be provisioned by the installer with an ACL
 * granting write access only to the dedicated broker service identity (plus
 * SYSTEM/Administrators). The installer must reject reparse-point ancestors.
 * This function additionally pins and checks the final directory handle.
 */
int le_win_store_open(
    LE_WIN_MANIFEST_STORE *store,
    const wchar_t *configured_directory,
    LE_STORE_VALIDATE validate_manifest,
    LE_STORE_VALIDATE validate_intent,
    void *validator_context) {
  HANDLE directory = INVALID_HANDLE_VALUE;
  FILE_ATTRIBUTE_TAG_INFO tag;
  if (!store || !configured_directory || !configured_directory[0]
      || !validate_manifest || !validate_intent) {
    SetLastError(ERROR_INVALID_PARAMETER);
    return 0;
  }
  ZeroMemory(store, sizeof(*store));
  store->directory = INVALID_HANDLE_VALUE;
  store->lock = INVALID_HANDLE_VALUE;
  directory = CreateFileW(configured_directory,
      FILE_LIST_DIRECTORY | FILE_ADD_FILE | FILE_DELETE_CHILD |
      FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES | SYNCHRONIZE,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL,
      OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
      NULL);
  if (directory == INVALID_HANDLE_VALUE) return 0;
  if (!GetFileInformationByHandleEx(directory, FileAttributeTagInfo, &tag, sizeof(tag))
      || (tag.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0
      || (tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0
      || !logic_engine_win_identity(directory, &store->directory_identity, NULL)) {
    CloseHandle(directory);
    SetLastError(ERROR_ACCESS_DENIED);
    return 0;
  }
  store->directory = directory;
  store->validate_manifest = validate_manifest;
  store->validate_intent = validate_intent;
  store->validator_context = validator_context;
  return 1;
}

int le_win_store_lock(LE_WIN_MANIFEST_STORE *store) {
  OVERLAPPED overlap;
  HANDLE lock;
  if (!store || store->directory == INVALID_HANDLE_VALUE || store->locked) {
    SetLastError(ERROR_INVALID_PARAMETER);
    return 0;
  }
  lock = logic_engine_win_open_relative(store->directory, LE_STORE_LOCK,
      GENERIC_READ | GENERIC_WRITE | FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ | FILE_SHARE_WRITE, FILE_OPEN_IF,
      FILE_NON_DIRECTORY_FILE, FILE_ATTRIBUTE_NORMAL, NULL, &identity);
  if (lock == INVALID_HANDLE_VALUE) return 0;
  ZeroMemory(&overlap, sizeof(overlap));
  if (!LockFileEx(lock, LOCKFILE_EXCLUSIVE_LOCK, 0, MAXDWORD, MAXDWORD, &overlap)) {
    CloseHandle(lock);
    return 0;
  }
  store->lock = lock;
  store->locked = TRUE;
  return 1;
}

void le_win_store_unlock(LE_WIN_MANIFEST_STORE *store) {
  OVERLAPPED overlap;
  if (!store || !store->locked) return;
  ZeroMemory(&overlap, sizeof(overlap));
  (void)UnlockFileEx(store->lock, 0, MAXDWORD, MAXDWORD, &overlap);
  CloseHandle(store->lock);
  store->lock = INVALID_HANDLE_VALUE;
  store->locked = FALSE;
}

static int le_win_store_read(
    LE_WIN_MANIFEST_STORE *store, const wchar_t *name,
    LE_STORE_VALIDATE validate, unsigned char **bytes_out, DWORD *length_out) {
  HANDLE file;
  DWORD length = 0, read_total = 0;
  unsigned char *bytes;
  if (!store || !store->locked || !name || !validate || !bytes_out || !length_out) {
    SetLastError(ERROR_INVALID_PARAMETER);
    return 0;
  }
  *bytes_out = NULL;
  *length_out = 0;
  file = logic_engine_win_open_relative(store->directory, name,
      GENERIC_READ | FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, FILE_OPEN,
      FILE_NON_DIRECTORY_FILE, FILE_ATTRIBUTE_NORMAL, NULL, NULL);
  if (file == INVALID_HANDLE_VALUE) return 0;
  if (!le_store_valid_regular(file, &length) || length == 0) {
    CloseHandle(file);
    SetLastError(ERROR_INVALID_DATA);
    return 0;
  }
  bytes = (unsigned char *)HeapAlloc(GetProcessHeap(), 0, length);
  if (!bytes) {
    CloseHandle(file);
    return 0;
  }
  while (read_total < length) {
    DWORD chunk = 0;
    if (!ReadFile(file, bytes + read_total, length - read_total, &chunk, NULL) || chunk == 0) {
      HeapFree(GetProcessHeap(), 0, bytes);
      CloseHandle(file);
      SetLastError(ERROR_READ_FAULT);
      return 0;
    }
    read_total += chunk;
  }
  CloseHandle(file);
  if (!validate(bytes, length, store->validator_context)) {
    HeapFree(GetProcessHeap(), 0, bytes);
    SetLastError(ERROR_INVALID_DATA);
    return 0;
  }
  *bytes_out = bytes;
  *length_out = length;
  return 1;
}

static int le_win_store_replace(
    LE_WIN_MANIFEST_STORE *store, const wchar_t *target,
    const unsigned char *bytes, DWORD length, LE_STORE_VALIDATE validate) {
  wchar_t temporary[96];
  BYTE nonce[16];
  wchar_t hex[33];
  HANDLE file = INVALID_HANDLE_VALUE;
  DWORD written_total = 0;
  size_t i;
  size_t rename_bytes;
  FILE_RENAME_INFO *rename_info = NULL;
  BOOL renamed = FALSE;
  if (!store || !store->locked || !target || !bytes || length == 0
      || length > LE_STORE_MAX_BYTES || !validate
      || !validate(bytes, length, store->validator_context)) {
    SetLastError(ERROR_INVALID_DATA);
    return 0;
  }
  if (!BCRYPT_SUCCESS(BCryptGenRandom(NULL, nonce, (ULONG)sizeof(nonce), BCRYPT_USE_SYSTEM_PREFERRED_RNG))) {
    SetLastError(ERROR_GEN_FAILURE);
    return 0;
  }
  for (i = 0; i < sizeof(nonce); ++i) {
    static const wchar_t digits[] = L"0123456789abcdef";
    hex[i * 2] = digits[nonce[i] >> 4];
    hex[i * 2 + 1] = digits[nonce[i] & 15];
  }
  hex[32] = L'\0';
  if (FAILED(StringCchPrintfW(temporary, _countof(temporary), L"manifest-%s.tmp", hex))) {
    SetLastError(ERROR_INVALID_NAME);
    return 0;
  }
  file = logic_engine_win_open_relative(store->directory, temporary,
      GENERIC_WRITE | DELETE | FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ, FILE_CREATE, FILE_NON_DIRECTORY_FILE,
      FILE_ATTRIBUTE_NORMAL, NULL, NULL);
  if (file == INVALID_HANDLE_VALUE) return 0;
  while (written_total < length) {
    DWORD chunk = 0;
    if (!WriteFile(file, bytes + written_total, length - written_total, &chunk, NULL)
        || chunk == 0) goto cleanup;
    written_total += chunk;
  }
  if (!FlushFileBuffers(file)) goto cleanup;
  rename_bytes = offsetof(FILE_RENAME_INFO, FileName) + wcslen(target) * sizeof(wchar_t);
  rename_info = (FILE_RENAME_INFO *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, rename_bytes);
  if (!rename_info) goto cleanup;
  rename_info->ReplaceIfExists = TRUE;
  rename_info->RootDirectory = store->directory;
  rename_info->FileNameLength = (DWORD)(wcslen(target) * sizeof(wchar_t));
  memcpy(rename_info->FileName, target, rename_info->FileNameLength);
  if (!SetFileInformationByHandle(file, FileRenameInfo, rename_info, (DWORD)rename_bytes)) goto cleanup;
  renamed = TRUE;
  /* Directory flush is a hard gate: never report a durable commit if NTFS
   * refuses to flush the containing directory handle. */
  if (!FlushFileBuffers(store->directory)) goto cleanup;
  HeapFree(GetProcessHeap(), 0, rename_info);
  CloseHandle(file);
  return 1;
cleanup:
  if (rename_info) HeapFree(GetProcessHeap(), 0, rename_info);
  if (file != INVALID_HANDLE_VALUE) {
    if (!renamed) {
      FILE_DISPOSITION_INFO disposition;
      disposition.DeleteFile = TRUE;
      (void)SetFileInformationByHandle(file, FileDispositionInfo, &disposition, sizeof(disposition));
    }
    CloseHandle(file);
  }
  return 0;
}

int le_win_store_read_manifest(
    LE_WIN_MANIFEST_STORE *store, unsigned char **bytes, DWORD *length) {
  return le_win_store_read(store, LE_STORE_MANIFEST, store->validate_manifest, bytes, length);
}
int le_win_store_read_intent(
    LE_WIN_MANIFEST_STORE *store, unsigned char **bytes, DWORD *length) {
  return le_win_store_read(store, LE_STORE_INTENT, store->validate_intent, bytes, length);
}
int le_win_store_write_manifest(
    LE_WIN_MANIFEST_STORE *store, const unsigned char *bytes, DWORD length) {
  return le_win_store_replace(store, LE_STORE_MANIFEST, bytes, length, store->validate_manifest);
}
int le_win_store_write_intent(
    LE_WIN_MANIFEST_STORE *store, const unsigned char *bytes, DWORD length) {
  return le_win_store_replace(store, LE_STORE_INTENT, bytes, length, store->validate_intent);
}

int le_win_store_remove_intent(LE_WIN_MANIFEST_STORE *store) {
  HANDLE file;
  FILE_DISPOSITION_INFO disposition;
  if (!store || !store->locked) {
    SetLastError(ERROR_INVALID_PARAMETER);
    return 0;
  }
  file = logic_engine_win_open_relative(store->directory, LE_STORE_INTENT,
      DELETE | FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, FILE_OPEN,
      FILE_NON_DIRECTORY_FILE, FILE_ATTRIBUTE_NORMAL, NULL, NULL);
  if (file == INVALID_HANDLE_VALUE) {
    if (GetLastError() == ERROR_FILE_NOT_FOUND) return 1;
    return 0;
  }
  disposition.DeleteFile = TRUE;
  if (!SetFileInformationByHandle(file, FileDispositionInfo, &disposition, sizeof(disposition))) {
    CloseHandle(file);
    return 0;
  }
  CloseHandle(file);
  return FlushFileBuffers(store->directory) != 0;
}

void le_win_store_close(LE_WIN_MANIFEST_STORE *store) {
  if (!store) return;
  le_win_store_unlock(store);
  if (store->directory != INVALID_HANDLE_VALUE && store->directory) CloseHandle(store->directory);
  ZeroMemory(store, sizeof(*store));
  store->directory = INVALID_HANDLE_VALUE;
  store->lock = INVALID_HANDLE_VALUE;
}
#endif /* _WIN32 */
