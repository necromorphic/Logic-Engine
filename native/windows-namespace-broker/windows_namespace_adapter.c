#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wchar.h>
#include "windows_namespace_adapter.h"

static int le_win_namespace_valid_sidecar(const wchar_t *basename) {
  size_t length;
  if (!logic_engine_win_valid_basename(basename)) return 0;
  length = wcslen(basename);
  if (length <= 4) return 0;
  return (length > 4 && wcscmp(basename + length - 4, L"-wal") == 0)
      || (length > 4 && wcscmp(basename + length - 4, L"-shm") == 0)
      || (length > 8 && wcscmp(basename + length - 8, L"-journal") == 0);
}

static int le_win_namespace_regular_file(HANDLE handle,
    LogicEngineWinFileIdentity *identity) {
  FILE_ATTRIBUTE_TAG_INFO tag;
  if (!logic_engine_win_identity(handle, identity, NULL)
      || !GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &tag, sizeof(tag))
      || (tag.FileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0) {
    SetLastError(ERROR_ACCESS_DENIED);
    return 0;
  }
  return 1;
}

int le_win_namespace_create_sidecar(
    HANDLE parent, const wchar_t *basename, HANDLE *opened,
    LogicEngineWinFileIdentity *identity) {
  HANDLE file;
  LogicEngineWinFileIdentity observed;
  if (!parent || parent == INVALID_HANDLE_VALUE || !opened || !identity
      || !le_win_namespace_valid_sidecar(basename)) {
    SetLastError(ERROR_INVALID_PARAMETER);
    return 0;
  }
  *opened = INVALID_HANDLE_VALUE;
  file = logic_engine_win_open_relative(parent, basename,
      GENERIC_READ | GENERIC_WRITE | DELETE | FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      FILE_CREATE, FILE_NON_DIRECTORY_FILE, FILE_ATTRIBUTE_NORMAL, NULL, &observed);
  if (file == INVALID_HANDLE_VALUE) return 0;
  if (!le_win_namespace_regular_file(file, &observed)) {
    FILE_DISPOSITION_INFO disposition;
    disposition.DeleteFile = TRUE;
    (void)SetFileInformationByHandle(file, FileDispositionInfo, &disposition, sizeof(disposition));
    CloseHandle(file);
    return 0;
  }
  *identity = observed;
  *opened = file;
  return 1;
}

int le_win_namespace_open_sidecar(
    HANDLE parent, const wchar_t *basename,
    const LogicEngineWinFileIdentity *expected,
    HANDLE *opened, LogicEngineWinFileIdentity *identity) {
  HANDLE file;
  LogicEngineWinFileIdentity observed;
  if (!parent || parent == INVALID_HANDLE_VALUE || !opened || !identity
      || !le_win_namespace_valid_sidecar(basename)) {
    SetLastError(ERROR_INVALID_PARAMETER);
    return 0;
  }
  *opened = INVALID_HANDLE_VALUE;
  file = logic_engine_win_open_relative(parent, basename,
      GENERIC_READ | GENERIC_WRITE | DELETE | FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      FILE_OPEN, FILE_NON_DIRECTORY_FILE, FILE_ATTRIBUTE_NORMAL, expected, &observed);
  if (file == INVALID_HANDLE_VALUE) return 0;
  if (!le_win_namespace_regular_file(file, &observed)) {
    CloseHandle(file);
    return 0;
  }
  *identity = observed;
  *opened = file;
  return 1;
}

int le_win_namespace_flush(HANDLE opened) {
  if (!opened || opened == INVALID_HANDLE_VALUE) {
    SetLastError(ERROR_INVALID_HANDLE);
    return 0;
  }
  return FlushFileBuffers(opened) != 0;
}

int le_win_namespace_delete_sidecar(
    HANDLE parent, HANDLE opened,
    const LogicEngineWinFileIdentity *expected) {
  LogicEngineWinFileIdentity observed;
  FILE_DISPOSITION_INFO disposition;
  if (!parent || parent == INVALID_HANDLE_VALUE || !opened
      || opened == INVALID_HANDLE_VALUE || !expected
      || !le_win_namespace_regular_file(opened, &observed)
      || !logic_engine_win_identity_equal(expected, &observed)) {
    SetLastError(ERROR_ACCESS_DENIED);
    return 0;
  }
  disposition.DeleteFile = TRUE;
  if (!SetFileInformationByHandle(opened, FileDispositionInfo,
      &disposition, sizeof(disposition))) return 0;
  return FlushFileBuffers(parent) != 0;
}
