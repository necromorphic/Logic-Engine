#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <wchar.h>
#include "windows_relative_open.h"

#ifndef SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE
#define SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE 0x2
#endif

static int fail(const wchar_t *step) {
  fwprintf(stderr, L"FAIL: %ls (GetLastError=%lu)\n", step, (unsigned long)GetLastError());
  return 1;
}

static int join_path(wchar_t *out, size_t capacity, const wchar_t *left, const wchar_t *right) {
  return wcscpy_s(out, capacity, left) == 0
      && (out[wcslen(out) - 1] == L'\\' || wcscat_s(out, capacity, L"\\") == 0)
      && wcscat_s(out, capacity, right) == 0;
}

static int make_text_file(const wchar_t *path, const char *value) {
  HANDLE file = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS,
                            FILE_ATTRIBUTE_NORMAL, NULL);
  DWORD written = 0;
  size_t length = strlen(value);
  int ok;
  if (file == INVALID_HANDLE_VALUE) return 0;
  ok = WriteFile(file, value, (DWORD)length, &written, NULL)
      && written == (DWORD)length;
  CloseHandle(file);
  return ok;
}

static int file_contains(HANDLE file, const char *expected) {
  char buffer[128];
  DWORD read_count = 0;
  size_t expected_length = strlen(expected);
  if (expected_length >= sizeof(buffer)) return 0;
  if (SetFilePointer(file, 0, NULL, FILE_BEGIN) == INVALID_SET_FILE_POINTER
      && GetLastError() != NO_ERROR) return 0;
  if (!ReadFile(file, buffer, sizeof(buffer) - 1, &read_count, NULL)) return 0;
  buffer[read_count] = '\0';
  return strcmp(buffer, expected) == 0;
}

int wmain(void) {
  wchar_t temp[MAX_PATH], root[MAX_PATH], parent[MAX_PATH], moved[MAX_PATH];
  wchar_t db_path[MAX_PATH], moved_db[MAX_PATH], decoy_db[MAX_PATH];
  wchar_t reparse_target[MAX_PATH], reparse_parent[MAX_PATH], reparse_db[MAX_PATH];
  wchar_t outside_file[MAX_PATH], child_link[MAX_PATH];
  wchar_t temp_file[MAX_PATH];
  LogicEngineWinDirectoryAnchor anchor;
  LogicEngineWinDirectoryAnchor rejected_anchor;
  LogicEngineWinFileIdentity expected;
  HANDLE handle = INVALID_HANDLE_VALUE;
  int result = 1;

  anchor.parent = INVALID_HANDLE_VALUE;
  anchor.basename = NULL;
  rejected_anchor.parent = INVALID_HANDLE_VALUE;
  rejected_anchor.basename = NULL;
  if (!GetTempPathW(MAX_PATH, temp)) return fail(L"GetTempPathW");
  if (!GetTempFileNameW(temp, L"lev", 0, temp_file)) return fail(L"GetTempFileNameW");
  if (!DeleteFileW(temp_file)) return fail(L"DeleteFileW(temp file)");
  if (!CreateDirectoryW(temp_file, NULL)) return fail(L"CreateDirectoryW(test root)");
  wcscpy_s(root, MAX_PATH, temp_file);

  if (!join_path(parent, MAX_PATH, root, L"parent")
      || !join_path(moved, MAX_PATH, root, L"moved")
      || !join_path(db_path, MAX_PATH, parent, L"store.sqlite")
      || !join_path(moved_db, MAX_PATH, moved, L"store.sqlite")
      || !join_path(decoy_db, MAX_PATH, parent, L"store.sqlite")
      || !join_path(reparse_target, MAX_PATH, root, L"reparse-target")
      || !join_path(reparse_parent, MAX_PATH, root, L"reparse-parent")
      || !join_path(reparse_db, MAX_PATH, reparse_parent, L"blocked.sqlite")
      || !join_path(outside_file, MAX_PATH, root, L"outside.sqlite")
      || !join_path(child_link, MAX_PATH, moved, L"child-link.sqlite")) {
    fail(L"construct test paths");
    goto cleanup;
  }
  if (!CreateDirectoryW(parent, NULL) || !make_text_file(db_path, "trusted-object")) {
    fail(L"create trusted database");
    goto cleanup;
  }
  if (!logic_engine_win_anchor_path(db_path, &anchor)) {
    fail(L"acquire pinned parent directory");
    goto cleanup;
  }

  handle = logic_engine_win_open_relative(anchor.parent, anchor.basename,
      GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      FILE_OPEN, FILE_NON_DIRECTORY_FILE, FILE_ATTRIBUTE_NORMAL, NULL, &expected);
  if (handle == INVALID_HANDLE_VALUE) {
    fail(L"open trusted child relative to anchor");
    goto cleanup;
  }
  if (!file_contains(handle, "trusted-object")) {
    CloseHandle(handle);
    handle = INVALID_HANDLE_VALUE;
    fail(L"verify initial trusted contents");
    goto cleanup;
  }
  CloseHandle(handle);
  handle = INVALID_HANDLE_VALUE;

  if (!MoveFileW(parent, moved) || !CreateDirectoryW(parent, NULL)
      || !make_text_file(decoy_db, "decoy-object")) {
    fail(L"replace original parent pathname with decoy");
    goto cleanup;
  }

  handle = logic_engine_win_open_relative(anchor.parent, anchor.basename,
      GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      FILE_OPEN, FILE_NON_DIRECTORY_FILE, FILE_ATTRIBUTE_NORMAL, &expected, NULL);
  if (handle == INVALID_HANDLE_VALUE) {
    fail(L"open after parent rename");
    goto cleanup;
  }
  if (!file_contains(handle, "trusted-object")) {
    fail(L"parent rename redirected open to decoy");
    goto cleanup;
  }
  CloseHandle(handle);
  handle = INVALID_HANDLE_VALUE;

  if (!CreateDirectoryW(reparse_target, NULL)
      || !CreateSymbolicLinkW(reparse_parent, reparse_target,
          SYMBOLIC_LINK_FLAG_DIRECTORY | SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE)) {
    fail(L"create directory reparse-point fixture");
    goto cleanup;
  }
  if (logic_engine_win_anchor_path(reparse_db, &rejected_anchor)) {
    logic_engine_win_anchor_close(&rejected_anchor);
    fail(L"directory reparse point was accepted");
    goto cleanup;
  }

  if (!make_text_file(outside_file, "outside-object")
      || !CreateSymbolicLinkW(child_link, outside_file,
          SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE)) {
    fail(L"create file reparse-point fixture");
    goto cleanup;
  }
  handle = logic_engine_win_open_relative(anchor.parent, L"child-link.sqlite",
      GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      FILE_OPEN, FILE_NON_DIRECTORY_FILE, FILE_ATTRIBUTE_NORMAL, NULL, NULL);
  if (handle != INVALID_HANDLE_VALUE) {
    CloseHandle(handle);
    handle = INVALID_HANDLE_VALUE;
    fail(L"child reparse point was accepted");
    goto cleanup;
  }

  wprintf(L"PASS: pinned-parent rename, decoy isolation, 128-bit file identity, "
          L"directory reparse rejection, and child reparse rejection\n");
  result = 0;

cleanup:
  if (handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
  logic_engine_win_anchor_close(&anchor);
  DeleteFileW(child_link);
  DeleteFileW(outside_file);
  DeleteFileW(moved_db);
  RemoveDirectoryW(moved);
  DeleteFileW(decoy_db);
  RemoveDirectoryW(parent);
  RemoveDirectoryW(reparse_parent);
  RemoveDirectoryW(reparse_target);
  RemoveDirectoryW(root);
  return result;
}
