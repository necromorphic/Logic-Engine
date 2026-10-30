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
  status = nt_create(&result, access, &object_attributes, &io, NULL,
      attributes, share, disposition,
      options | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
      NULL, 0);
  if (status < 0 || result == INVALID_HANDLE_VALUE) {
    SetLastError(RtlNtStatusToDosError(status));
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
  current = CreateFileW(root, FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES,
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
        FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES,
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
#endif /* _WIN32 */
#endif /* LOGIC_ENGINE_WINDOWS_RELATIVE_OPEN_H */
