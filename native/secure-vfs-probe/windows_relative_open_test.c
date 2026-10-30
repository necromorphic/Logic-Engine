#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <string.h>
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
  ULONG mapped_options = 0, mapped_attributes = 0, mapped_disposition = 0;
  int parent_moved = 0;

  /* The adapter must reject flags whose semantics it does not implement. */
  if (logic_engine_win_map_create_options(FILE_FLAG_BACKUP_SEMANTICS,
        &mapped_options, &mapped_attributes)
      || logic_engine_win_map_create_options(FILE_FLAG_OVERLAPPED,
        &mapped_options, &mapped_attributes)
      || logic_engine_win_map_create_options(0x40000000UL,
        &mapped_options, &mapped_attributes)
      || logic_engine_win_map_create_options(FILE_FLAG_DELETE_ON_CLOSE,
        &mapped_options, &mapped_attributes)) {
    fail(L"unsupported or destructive Win32 open flags were accepted");
    goto cleanup;
  }
  if (!logic_engine_win_map_create_options(FILE_FLAG_RANDOM_ACCESS
        | FILE_FLAG_SEQUENTIAL_SCAN | FILE_ATTRIBUTE_NORMAL,
        &mapped_options, &mapped_attributes)
      || (mapped_options & 0x00000800UL) == 0
      || (mapped_options & 0x00000004UL) == 0
      || mapped_attributes != FILE_ATTRIBUTE_NORMAL
      || !logic_engine_win_map_create_disposition(CREATE_NEW, &mapped_disposition)
      || mapped_disposition != FILE_CREATE
      || logic_engine_win_map_create_disposition(CREATE_ALWAYS, &mapped_disposition)
      || logic_engine_win_map_create_disposition(TRUNCATE_EXISTING, &mapped_disposition)) {
    fail(L"supported Win32 open flags were not mapped exactly");
    goto cleanup;
  }

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
  /*
   * Keep the identity-checked child handle open across the directory rename.
   * This mirrors the VFS role registry, which retains a trusted DB HANDLE.
   */
  if (MoveFileW(parent, moved)) {
    parent_moved = 1;
    if (!CreateDirectoryW(parent, NULL)
        || !make_text_file(decoy_db, "decoy-object")) {
      fail(L"create replacement parent pathname and decoy");
      goto cleanup;
    }
  } else {
    DWORD rename_error = GetLastError();
    /*
     * Some Windows runners/filesystems deny directory rename while the VFS
     * retains the checked parent HANDLE. This is fail-closed: the checked
     * pathname cannot be replaced during the protected DB lifetime.
     */
    if (rename_error != ERROR_ACCESS_DENIED
        && rename_error != ERROR_SHARING_VIOLATION) {
      fail(L"parent rename failed for an unexpected reason");
      goto cleanup;
    }
    if (!CreateDirectoryW(moved, NULL)) {
      fail(L"create auxiliary directory after OS denied parent rename");
      goto cleanup;
    }
  }
  if (!file_contains(handle, "trusted-object")) {
    fail(L"retained trusted child handle changed after parent rename");
    goto cleanup;
  }
  CloseHandle(handle);
  handle = INVALID_HANDLE_VALUE;

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

  SetLastError(ERROR_SUCCESS);
  handle = logic_engine_win_open_relative(anchor.parent, L"missing.sqlite",
      GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      FILE_OPEN, FILE_NON_DIRECTORY_FILE, FILE_ATTRIBUTE_NORMAL, NULL, NULL);
  if (handle != INVALID_HANDLE_VALUE) {
    CloseHandle(handle);
    handle = INVALID_HANDLE_VALUE;
    fail(L"missing child unexpectedly opened");
    goto cleanup;
  }
  if (GetLastError() != ERROR_FILE_NOT_FOUND && GetLastError() != ERROR_PATH_NOT_FOUND) {
    fail(L"missing child did not preserve the not-found status");
    goto cleanup;
  }

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


  /* Exercise anchored Win32 open, access and delete primitives after parent rename. */
  {
    HANDLE created;
    DWORD written = 0;
    LogicEngineWinFileIdentity sidecar_identity;
    created = logic_engine_win_create_file_relative(anchor.parent, L"probe-wal",
        GENERIC_READ | GENERIC_WRITE,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        CREATE_NEW, FILE_ATTRIBUTE_NORMAL, NULL, NULL, &sidecar_identity);
    if (created == INVALID_HANDLE_VALUE) {
      fail(L"create sidecar through Win32-relative adapter");
      goto cleanup;
    }
    if (!WriteFile(created, "wal-object", 10, &written, NULL) || written != 10) {
      CloseHandle(created);
      fail(L"write sidecar fixture");
      goto cleanup;
    }
    /* Destructive Win32 dispositions must be rejected before NtCreateFile:
     * otherwise an attacker-substituted child could be truncated before the
     * post-open identity comparison rejects it. */
    SetLastError(ERROR_SUCCESS);
    {
      HANDLE destructive = logic_engine_win_create_file_relative(anchor.parent,
          L"probe-wal", GENERIC_READ | GENERIC_WRITE,
          FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
          CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL, &sidecar_identity, NULL);
      if (destructive != INVALID_HANDLE_VALUE) {
        CloseHandle(destructive);
        CloseHandle(created);
        fail(L"CREATE_ALWAYS was not rejected");
        goto cleanup;
      }
    }
    if (!file_contains(created, "wal-object")) {
      CloseHandle(created);
      fail(L"rejected CREATE_ALWAYS changed existing sidecar");
      goto cleanup;
    }
    SetLastError(ERROR_SUCCESS);
    {
      HANDLE destructive = logic_engine_win_create_file_relative(anchor.parent,
          L"probe-wal", GENERIC_READ | GENERIC_WRITE,
          FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
          TRUNCATE_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL, &sidecar_identity, NULL);
      if (destructive != INVALID_HANDLE_VALUE) {
        CloseHandle(destructive);
        CloseHandle(created);
        fail(L"TRUNCATE_EXISTING was not rejected");
        goto cleanup;
      }
    }
    if (!file_contains(created, "wal-object")) {
      CloseHandle(created);
      fail(L"rejected TRUNCATE_EXISTING changed existing sidecar");
      goto cleanup;
    }
    CloseHandle(created);
    if (logic_engine_win_access_relative(anchor.parent, L"probe-wal", 0, &sidecar_identity) != 1
        || logic_engine_win_access_relative(anchor.parent, L"probe-wal", 2, &sidecar_identity) != 1
        || logic_engine_win_access_relative(anchor.parent, L"probe-wal", 1, &sidecar_identity) != 1
        || logic_engine_win_access_relative(anchor.parent, L"probe-wal", 0, &expected) != 0
        || logic_engine_win_access_relative(anchor.parent, L"store.sqlite", 0, &expected) != 1) {
      fail(L"anchored xAccess primitive");
      goto cleanup;
    }
    if (!logic_engine_win_delete_relative(anchor.parent, L"probe-wal", &sidecar_identity)) {
      fail(L"anchored xDelete primitive");
      goto cleanup;
    }
    if (logic_engine_win_access_relative(anchor.parent, L"probe-wal", 0, &sidecar_identity) != 0) {
      fail(L"deleted sidecar remains accessible");
      goto cleanup;
    }
  }

  wprintf(parent_moved
      ? L"PASS: pinned-parent rename, decoy isolation, 128-bit file identity, directory reparse rejection, and child reparse rejection\n"
      : L"PASS: OS denied parent rename while trusted HANDLE was open; pinned open, 128-bit file identity, directory reparse rejection, and child reparse rejection\n");
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
