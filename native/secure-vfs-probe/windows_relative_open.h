/*
 * Windows handle-relative SQLite file primitives.
 *
 * This module deliberately has no pathname fallback. It is a building block
 * for the secure VFS wrapper; callers must retain the returned parent HANDLE
 * for the complete database-role lifetime and must not pass an absolute path
 * to the relative-open routine.
 */
#ifndef LOGIC_ENGINE_WINDOWS_RELATIVE_OPEN_H
#define LOGIC_ENGINE_WINDOWS_RELATIVE_OPEN_H

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <string.h>
#include <winternl.h>
#include <wchar.h>
#include <stdint.h>

#ifndef FILE_OPEN_REPARSE_POINT
#define FILE_OPEN_REPARSE_POINT 0x00200000
#endif
#ifndef FILE_DIRECTORY_FILE
#define FILE_DIRECTORY_FILE 0x00000001
#endif
#ifndef FILE_NON_DIRECTORY_FILE
#define FILE_NON_DIRECTORY_FILE 0x00000040
#endif
#ifndef FILE_SYNCHRONOUS_IO_NONALERT
#define FILE_SYNCHRONOUS_IO_NONALERT 0x00000020
#endif
#ifndef FILE_OPEN
#define FILE_OPEN 0x00000001
#endif
#ifndef FILE_CREATE
#define FILE_CREATE 0x00000002
#endif
#ifndef FILE_OPEN_IF
#define FILE_OPEN_IF 0x00000003
#endif
#ifndef FILE_OVERWRITE
#define FILE_OVERWRITE 0x00000004
#endif
#ifndef FILE_OVERWRITE_IF
#define FILE_OVERWRITE_IF 0x00000005
#endif

typedef NTSTATUS (NTAPI *logic_engine_nt_create_file_fn)(
  PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, PIO_STATUS_BLOCK,
  PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG
);

typedef struct LogicEngineWinFileIdentity {
  ULONGLONG volume_serial;
  FILE_ID_128 file_id;
} LogicEngineWinFileIdentity;

typedef struct LogicEngineWinDirectoryAnchor {
  HANDLE parent;
  wchar_t *basename;
} LogicEngineWinDirectoryAnchor;

static inline logic_engine_nt_create_file_fn logic_engine_win_nt_create_file(void) {
  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  if (!ntdll) return NULL;
  return (logic_engine_nt_create_file_fn)(void *)GetProcAddress(ntdll, "NtCreateFile");
}

typedef ULONG (NTAPI *logic_engine_rtl_ntstatus_to_dos_error_fn)(NTSTATUS);

static inline DWORD logic_engine_win_status_to_error(NTSTATUS status) {
  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  logic_engine_rtl_ntstatus_to_dos_error_fn convert_status;
  DWORD error;
  if (!ntdll) return ERROR_ACCESS_DENIED;
  convert_status = (logic_engine_rtl_ntstatus_to_dos_error_fn)(void *)
    GetProcAddress(ntdll, "RtlNtStatusToDosError");
  if (!convert_status) return ERROR_ACCESS_DENIED;
  error = convert_status(status);
  return error == ERROR_MR_MID_NOT_FOUND ? ERROR_ACCESS_DENIED : error;
}

static inline int logic_engine_win_identity(HANDLE handle,
                                             LogicEngineWinFileIdentity *identity,
                                             DWORD *attributes_out) {
  FILE_ID_INFO id;
  FILE_ATTRIBUTE_TAG_INFO tag;
  if (!handle || handle == INVALID_HANDLE_VALUE || !identity) return 0;
  if (!GetFileInformationByHandleEx(handle, FileIdInfo, &id, sizeof(id))) return 0;
  if (!GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &tag, sizeof(tag))) return 0;
  if (id.VolumeSerialNumber == 0) return 0;
  {
    unsigned int i;
    int nonzero = 0;
    for (i = 0; i < sizeof(id.FileId.Identifier); ++i)
      if (id.FileId.Identifier[i] != 0) nonzero = 1;
    if (!nonzero) return 0;
  }
  if ((tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) return 0;
  identity->volume_serial = id.VolumeSerialNumber;
  identity->file_id = id.FileId;
  if (attributes_out) *attributes_out = tag.FileAttributes;
  return 1;
}

static inline int logic_engine_win_identity_equal(
  const LogicEngineWinFileIdentity *a, const LogicEngineWinFileIdentity *b) {
  return a && b && a->volume_serial == b->volume_serial
    && memcmp(&a->file_id, &b->file_id, sizeof(a->file_id)) == 0;
}

/* Open one child relative to a pinned directory handle. No absolute fallback. */
static inline HANDLE logic_engine_win_open_relative(
  HANDLE parent, const wchar_t *basename, ACCESS_MASK access,
  ULONG share, ULONG disposition, ULONG options, ULONG attributes,
  const LogicEngineWinFileIdentity *expected,
  LogicEngineWinFileIdentity *actual) {
  logic_engine_nt_create_file_fn nt_create = logic_engine_win_nt_create_file();
  UNICODE_STRING name;
  OBJECT_ATTRIBUTES object_attributes;
  IO_STATUS_BLOCK io;
  HANDLE result = INVALID_HANDLE_VALUE;
  NTSTATUS status;
  size_t chars;
  if (!nt_create || !parent || parent == INVALID_HANDLE_VALUE
      || !basename || !basename[0]) {
    SetLastError(ERROR_INVALID_PARAMETER);
    return INVALID_HANDLE_VALUE;
  }
  chars = wcslen(basename);
  if (chars > 32760 || wcschr(basename, L'\\') || wcschr(basename, L'/')
      || wcschr(basename, L':') || wcscmp(basename, L".") == 0
      || wcscmp(basename, L"..") == 0) {
    SetLastError(ERROR_ACCESS_DENIED);
    return INVALID_HANDLE_VALUE;
  }
  name.Buffer = (PWSTR)basename;
  name.Length = (USHORT)(chars * sizeof(wchar_t));
  name.MaximumLength = name.Length;
  InitializeObjectAttributes(&object_attributes, &name, OBJ_CASE_INSENSITIVE, parent, NULL);
  /* FILE_SYNCHRONOUS_IO_NONALERT requires SYNCHRONIZE in DesiredAccess. */
  access |= SYNCHRONIZE;
  status = nt_create(&result, access, &object_attributes, &io, NULL,
      attributes, share, disposition,
      options | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
      NULL, 0);
  if (status < 0 || result == INVALID_HANDLE_VALUE) {
    DWORD error = status < 0
      ? logic_engine_win_status_to_error(status) : ERROR_ACCESS_DENIED;
    if (result && result != INVALID_HANDLE_VALUE) CloseHandle(result);
    SetLastError(error);
    return INVALID_HANDLE_VALUE;
  }
  {
    LogicEngineWinFileIdentity observed;
    DWORD file_attributes = 0;
    if (!logic_engine_win_identity(result, &observed, &file_attributes)
        || (expected && !logic_engine_win_identity_equal(expected, &observed))) {
      CloseHandle(result);
      SetLastError(ERROR_ACCESS_DENIED);
      return INVALID_HANDLE_VALUE;
    }
    if (actual) *actual = observed;
  }
  return result;
}

/*
 * Acquire an anchor for an absolute drive-letter path. The volume root is the
 * trust root; all descendants are opened relative to the preceding HANDLE.
 * UNC/device paths are intentionally unsupported until their root policy is
 * separately defined. The returned parent handle is owned by the caller.
 */
static inline int logic_engine_win_anchor_path(
  const wchar_t *absolute_path, LogicEngineWinDirectoryAnchor *anchor) {
  wchar_t root[8];
  wchar_t *copy = NULL, *cursor, *last_separator;
  HANDLE current = INVALID_HANDLE_VALUE;
  size_t length;
  if (!absolute_path || !anchor || wcslen(absolute_path) < 4
      || !((absolute_path[0] >= L'A' && absolute_path[0] <= L'Z')
        || (absolute_path[0] >= L'a' && absolute_path[0] <= L'z'))
      || absolute_path[1] != L':' || absolute_path[2] != L'\\') {
    SetLastError(ERROR_INVALID_NAME);
    return 0;
  }
  anchor->parent = INVALID_HANDLE_VALUE;
  anchor->basename = NULL;
  length = wcslen(absolute_path);
  copy = (wchar_t *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY,
                               (length + 1) * sizeof(wchar_t));
  if (!copy) return 0;
  wcscpy_s(copy, length + 1, absolute_path);
  last_separator = wcsrchr(copy, L'\\');
  if (!last_separator || !last_separator[1]) {
    HeapFree(GetProcessHeap(), 0, copy);
    SetLastError(ERROR_INVALID_NAME);
    return 0;
  }
  anchor->basename = (wchar_t *)HeapAlloc(GetProcessHeap(), 0,
      (wcslen(last_separator + 1) + 1) * sizeof(wchar_t));
  if (!anchor->basename) {
    HeapFree(GetProcessHeap(), 0, copy);
    return 0;
  }
  wcscpy_s(anchor->basename, wcslen(last_separator + 1) + 1, last_separator + 1);
  *last_separator = L'\0';
  root[0] = L'\\'; root[1] = L'\\'; root[2] = L'?'; root[3] = L'\\';
  root[4] = copy[0]; root[5] = L':'; root[6] = L'\\'; root[7] = L'\0';
  current = CreateFileW(root, FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL,
      OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  if (current == INVALID_HANDLE_VALUE) goto fail;
  cursor = copy + 3;
  while (*cursor) {
    wchar_t *end;
    wchar_t saved;
    HANDLE next;
    FILE_ATTRIBUTE_TAG_INFO tag;
    while (*cursor == L'\\') ++cursor;
    if (!*cursor) break;
    end = wcschr(cursor, L'\\');
    saved = end ? *end : L'\0';
    if (end) *end = L'\0';
    if (!cursor[0] || wcscmp(cursor, L".") == 0 || wcscmp(cursor, L"..") == 0) {
      SetLastError(ERROR_ACCESS_DENIED);
      goto fail;
    }
    next = logic_engine_win_open_relative(current, cursor,
        FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        FILE_OPEN, FILE_DIRECTORY_FILE, FILE_ATTRIBUTE_DIRECTORY, NULL, NULL);
    if (end) *end = saved;
    if (next == INVALID_HANDLE_VALUE) goto fail;
    if (!GetFileInformationByHandleEx(next, FileAttributeTagInfo, &tag, sizeof(tag))
        || (tag.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0
        || (tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) {
      CloseHandle(next);
      SetLastError(ERROR_ACCESS_DENIED);
      goto fail;
    }
    CloseHandle(current);
    current = next;
    if (!end) break;
    cursor = end + 1;
  }
  anchor->parent = current;
  HeapFree(GetProcessHeap(), 0, copy);
  return 1;
fail:
  if (current != INVALID_HANDLE_VALUE) CloseHandle(current);
  if (anchor->basename) HeapFree(GetProcessHeap(), 0, anchor->basename);
  anchor->basename = NULL;
  HeapFree(GetProcessHeap(), 0, copy);
  return 0;
}

static inline void logic_engine_win_anchor_close(LogicEngineWinDirectoryAnchor *anchor) {
  if (!anchor) return;
  if (anchor->parent && anchor->parent != INVALID_HANDLE_VALUE) CloseHandle(anchor->parent);
  if (anchor->basename) HeapFree(GetProcessHeap(), 0, anchor->basename);
  anchor->parent = INVALID_HANDLE_VALUE;
  anchor->basename = NULL;
}

/* SQLite CREATE/OPEN flags must be mapped explicitly by the VFS caller.
 * This helper intentionally accepts native NT disposition/options only.
 * Unknown Win32 flag combinations must be rejected by that caller.
 */


/* Narrow Win32 CreateFileW adapter for protected regular files; no path fallback. */
static inline int logic_engine_win_map_create_disposition(DWORD disposition, ULONG *nt_disposition) {
  if (!nt_disposition) return 0;
  switch (disposition) {
    case CREATE_NEW: *nt_disposition = FILE_CREATE; return 1;
    /* A destructive disposition mutates the opened object before its identity
     * can be checked. Protected callers must use OPEN_ALWAYS/CREATE_NEW and
     * perform any later mutation only through the validated handle. */
    case CREATE_ALWAYS: return 0;
    case OPEN_EXISTING: *nt_disposition = FILE_OPEN; return 1;
    case OPEN_ALWAYS: *nt_disposition = FILE_OPEN_IF; return 1;
    case TRUNCATE_EXISTING: return 0;
    default: return 0;
  }
}

static inline int logic_engine_win_map_create_options(
  DWORD flags, ULONG *nt_options, ULONG *nt_attributes) {
  ULONG options = FILE_NON_DIRECTORY_FILE;
  ULONG file_attributes = flags & 0x0000ffffUL;
  const DWORD flag_bits = flags & 0xffff0000UL;
  const DWORD allowed_flags = FILE_FLAG_WRITE_THROUGH | FILE_FLAG_NO_BUFFERING
    | FILE_FLAG_RANDOM_ACCESS | FILE_FLAG_SEQUENTIAL_SCAN
    | FILE_FLAG_OPEN_REPARSE_POINT;
  if (!nt_options || !nt_attributes) return 0;
  /*
   * Protected DB handles are synchronous regular files. Reject every flag
   * whose semantics are not explicitly represented below; silently ignoring
   * a Win32 flag could make the caller believe a security-relevant mode stuck.
   * DELETE_ON_CLOSE is deliberately rejected: NT would apply it before the
   * opened object's identity could be checked.
   */
  if ((flag_bits & ~allowed_flags) != 0
      || (file_attributes & FILE_ATTRIBUTE_DIRECTORY) != 0
      || (file_attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0
      || ((file_attributes & FILE_ATTRIBUTE_NORMAL) != 0
          && file_attributes != FILE_ATTRIBUTE_NORMAL)) return 0;
  if ((flags & FILE_FLAG_WRITE_THROUGH) != 0) options |= 0x00000002UL;
  if ((flags & FILE_FLAG_SEQUENTIAL_SCAN) != 0) options |= 0x00000004UL;
  if ((flags & FILE_FLAG_NO_BUFFERING) != 0) options |= 0x00000008UL;
  if ((flags & FILE_FLAG_RANDOM_ACCESS) != 0) options |= 0x00000800UL;
  if ((flags & FILE_FLAG_OPEN_REPARSE_POINT) != 0) options |= FILE_OPEN_REPARSE_POINT;
  if (file_attributes == 0) file_attributes = FILE_ATTRIBUTE_NORMAL;
  *nt_options = options;
  *nt_attributes = file_attributes;
  return 1;
}

static inline HANDLE logic_engine_win_create_file_relative(
  HANDLE parent, const wchar_t *basename, DWORD desired_access, DWORD share_mode,
  DWORD creation_disposition, DWORD flags_and_attributes, HANDLE template_file,
  const LogicEngineWinFileIdentity *expected, LogicEngineWinFileIdentity *actual) {
  ULONG disposition, options, attributes;
  if (template_file != NULL
      || !logic_engine_win_map_create_disposition(creation_disposition, &disposition)
      || !logic_engine_win_map_create_options(flags_and_attributes, &options, &attributes)) {
    SetLastError(ERROR_NOT_SUPPORTED);
    return INVALID_HANDLE_VALUE;
  }
  return logic_engine_win_open_relative(parent, basename, (ACCESS_MASK)desired_access,
      (ULONG)share_mode, disposition, options, attributes, expected, actual);
}

/* 1 = accessible, 0 = absent/inaccessible, -1 = unexpected OS failure. */
static inline int logic_engine_win_access_relative(HANDLE parent, const wchar_t *basename,
    DWORD access_kind, const LogicEngineWinFileIdentity *expected) {
  DWORD desired = FILE_READ_ATTRIBUTES;
  HANDLE handle;
  /* Match SQLite's SQLITE_ACCESS_* values: EXISTS=0, READWRITE=1, READ=2. */
  if (access_kind == 1) desired = GENERIC_READ | GENERIC_WRITE;
  else if (access_kind == 2) desired = GENERIC_READ;
  else if (access_kind != 0) {
    SetLastError(ERROR_INVALID_PARAMETER);
    return -1;
  }
  handle = logic_engine_win_open_relative(parent, basename, desired,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, FILE_OPEN,
      FILE_NON_DIRECTORY_FILE, FILE_ATTRIBUTE_NORMAL, expected, NULL);
  if (handle != INVALID_HANDLE_VALUE) {
    CloseHandle(handle);
    return 1;
  }
  if (GetLastError() == ERROR_FILE_NOT_FOUND || GetLastError() == ERROR_PATH_NOT_FOUND
      || GetLastError() == ERROR_ACCESS_DENIED || GetLastError() == ERROR_SHARING_VIOLATION) return 0;
  return -1;
}

/* Deletes the exact opened child object, never an absolute pathname. */
static inline int logic_engine_win_delete_relative(HANDLE parent, const wchar_t *basename,
    const LogicEngineWinFileIdentity *expected) {
  HANDLE handle = logic_engine_win_open_relative(parent, basename,
      DELETE | FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      FILE_OPEN, FILE_NON_DIRECTORY_FILE, FILE_ATTRIBUTE_NORMAL, expected, NULL);
  FILE_DISPOSITION_INFO disposition;
  if (handle == INVALID_HANDLE_VALUE) {
    if (GetLastError() == ERROR_FILE_NOT_FOUND || GetLastError() == ERROR_PATH_NOT_FOUND) return 1;
    return 0;
  }
  disposition.DeleteFile = TRUE;
  if (!SetFileInformationByHandle(handle, FileDispositionInfo, &disposition, sizeof(disposition))) {
    CloseHandle(handle);
    return 0;
  }
  CloseHandle(handle);
  return 1;
}

#endif /* _WIN32 */
#endif /* LOGIC_ENGINE_WINDOWS_RELATIVE_OPEN_H */
