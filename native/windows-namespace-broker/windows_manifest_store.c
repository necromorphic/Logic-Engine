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
#define LE_COUNT_OF(value) (sizeof(value) / sizeof((value)[0]))
#include <bcrypt.h>
#include <aclapi.h>
#include <sddl.h>
#include "windows_manifest_store.h"
#include "windows_relative_open.h"

#define LE_STORE_MANIFEST L"manifest.json"
#define LE_STORE_INTENT L"intent.json"
#define LE_STORE_LOCK L"store.lock"

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
static int le_store_acl_is_private(HANDLE directory) {
  HANDLE token = NULL;
  TOKEN_USER *user = NULL;
  DWORD token_bytes = 0;
  PSECURITY_DESCRIPTOR descriptor = NULL;
  PSID owner = NULL;
  PACL dacl = NULL;
  SECURITY_DESCRIPTOR_CONTROL control = 0;
  DWORD revision = 0;
  PSID system_sid = NULL;
  PSID admins_sid = NULL;
  PSID trusted[3];
  BOOL seen[3] = { FALSE, FALSE, FALSE };
  DWORD index;
  BOOL valid = FALSE;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) goto done;
  GetTokenInformation(token, TokenUser, NULL, 0, &token_bytes);
  if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || token_bytes == 0 || token_bytes > 65536) goto done;
  user = (TOKEN_USER *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, token_bytes);
  if (!user || !GetTokenInformation(token, TokenUser, user, token_bytes, &token_bytes)) goto done;
  if (GetSecurityInfo(directory, SE_FILE_OBJECT,
      OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
      &owner, NULL, &dacl, NULL, &descriptor) != ERROR_SUCCESS) goto done;
  if (!GetSecurityDescriptorControl(descriptor, &control, &revision)
      || (control & SE_DACL_PROTECTED) == 0 || !dacl || dacl->AceCount != 3) goto done;
  if (!ConvertStringSidToSidW(L"S-1-5-18", &system_sid)
      || !ConvertStringSidToSidW(L"S-1-5-32-544", &admins_sid)) goto done;
  trusted[0] = user->User.Sid;
  trusted[1] = system_sid;
  trusted[2] = admins_sid;
  if (!EqualSid(owner, trusted[0]) && !EqualSid(owner, trusted[1])
      && !EqualSid(owner, trusted[2])) goto done;
  for (index = 0; index < dacl->AceCount; ++index) {
    ACE_HEADER *header = NULL;
    ACCESS_ALLOWED_ACE *ace;
    PSID sid;
    DWORD slot;
    if (!GetAce(dacl, index, (LPVOID *)&header)
        || header->AceType != ACCESS_ALLOWED_ACE_TYPE
        || (header->AceFlags & INHERITED_ACE) != 0) goto done;
    ace = (ACCESS_ALLOWED_ACE *)header;
    if ((ace->Mask & FILE_ALL_ACCESS) != FILE_ALL_ACCESS) goto done;
    sid = (PSID)&ace->SidStart;
    for (slot = 0; slot < 3; ++slot) {
      if (EqualSid(sid, trusted[slot])) break;
    }
    if (slot == 3 || seen[slot]) goto done;
    seen[slot] = TRUE;
  }
  valid = seen[0] && seen[1] && seen[2];
done:
  if (descriptor) LocalFree(descriptor);
  if (system_sid) LocalFree(system_sid);
  if (admins_sid) LocalFree(admins_sid);
  if (user) HeapFree(GetProcessHeap(), 0, user);
  if (token) CloseHandle(token);
  if (!valid) SetLastError(ERROR_ACCESS_DENIED);
  return valid ? 1 : 0;
}

static int le_store_is_ntfs(HANDLE directory) {
  wchar_t final_path[32768];
  wchar_t volume_root[MAX_PATH];
  wchar_t filesystem[MAX_PATH];
  DWORD length;
  length = GetFinalPathNameByHandleW(directory, final_path, LE_COUNT_OF(final_path),
      FILE_NAME_NORMALIZED | VOLUME_NAME_GUID);
  if (length == 0 || length >= (DWORD)LE_COUNT_OF(final_path)
      || !GetVolumePathNameW(final_path, volume_root, LE_COUNT_OF(volume_root))
      || !GetVolumeInformationW(volume_root, NULL, 0, NULL, NULL, NULL,
          filesystem, LE_COUNT_OF(filesystem))
      || wcscmp(filesystem, L"NTFS") != 0) {
    SetLastError(ERROR_NOT_SUPPORTED);
    return 0;
  }
  return 1;
}

static int le_store_sid_trusted(PSID sid, PSID service_sid,
    PSID system_sid, PSID admins_sid, PSID trusted_installer_sid) {
  return EqualSid(sid, service_sid) || EqualSid(sid, system_sid)
      || EqualSid(sid, admins_sid) || EqualSid(sid, trusted_installer_sid);
}

/* Parent directories may be shared system locations, but no untrusted SID
 * may create/delete children, rewrite the DACL, or take ownership there. */
static int le_store_parent_acl_safe(HANDLE directory) {
  HANDLE token = NULL;
  TOKEN_USER *user = NULL;
  DWORD token_bytes = 0;
  PSECURITY_DESCRIPTOR descriptor = NULL;
  PSID owner = NULL, service_sid = NULL, system_sid = NULL;
  PSID admins_sid = NULL, trusted_installer_sid = NULL;
  PACL dacl = NULL;
  SECURITY_DESCRIPTOR_CONTROL control = 0;
  DWORD revision = 0, index;
  BOOL valid = FALSE;
  DWORD mutation_mask = FILE_DELETE_CHILD | DELETE | WRITE_DAC | WRITE_OWNER | GENERIC_ALL;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) goto done;
  GetTokenInformation(token, TokenUser, NULL, 0, &token_bytes);
  if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || !token_bytes || token_bytes > 65536) goto done;
  user = (TOKEN_USER *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, token_bytes);
  if (!user || !GetTokenInformation(token, TokenUser, user, token_bytes, &token_bytes)) goto done;
  service_sid = user->User.Sid;
  if (!ConvertStringSidToSidW(L"S-1-5-18", &system_sid)
      || !ConvertStringSidToSidW(L"S-1-5-32-544", &admins_sid)
      || !ConvertStringSidToSidW(L"S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464",
          &trusted_installer_sid)) goto done;
  if (GetSecurityInfo(directory, SE_FILE_OBJECT,
      OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
      &owner, NULL, &dacl, NULL, &descriptor) != ERROR_SUCCESS) goto done;
  if (!GetSecurityDescriptorControl(descriptor, &control, &revision)
      || (control & SE_DACL_PRESENT) == 0 || !owner || !dacl
      || !le_store_sid_trusted(owner, service_sid, system_sid, admins_sid, trusted_installer_sid)) goto done;
  for (index = 0; index < dacl->AceCount; ++index) {
    ACE_HEADER *header = NULL;
    if (!GetAce(dacl, index, (LPVOID *)&header)) goto done;
    if ((header->AceFlags & INHERIT_ONLY_ACE) != 0) continue;
    if (header->AceType == ACCESS_ALLOWED_ACE_TYPE) {
      ACCESS_ALLOWED_ACE *ace = (ACCESS_ALLOWED_ACE *)header;
      PSID sid = (PSID)&ace->SidStart;
      if (!le_store_sid_trusted(sid, service_sid, system_sid, admins_sid, trusted_installer_sid)
          && (ace->Mask & mutation_mask) != 0) goto done;
    } else if (header->AceType != ACCESS_DENIED_ACE_TYPE) {
      goto done;
    }
  }
  valid = TRUE;
done:
  if (descriptor) LocalFree(descriptor);
  if (system_sid) LocalFree(system_sid);
  if (admins_sid) LocalFree(admins_sid);
  if (trusted_installer_sid) LocalFree(trusted_installer_sid);
  if (user) HeapFree(GetProcessHeap(), 0, user);
  if (token) CloseHandle(token);
  if (!valid) SetLastError(ERROR_ACCESS_DENIED);
  return valid ? 1 : 0;
}

static int le_store_open_parent_chain(const wchar_t *path,
    HANDLE *parent_out, wchar_t **basename_out) {
  wchar_t root[8], *copy = NULL, *last_separator, *cursor;
  HANDLE current = INVALID_HANDLE_VALUE;
  size_t length, basename_length;
  FILE_ATTRIBUTE_TAG_INFO tag;
  if (!path || !parent_out || !basename_out
      || wcslen(path) < 4
      || !((path[0] >= L'A' && path[0] <= L'Z') || (path[0] >= L'a' && path[0] <= L'z'))
      || path[1] != L':' || path[2] != L'\\') {
    SetLastError(ERROR_INVALID_NAME);
    return 0;
  }
  *parent_out = INVALID_HANDLE_VALUE;
  *basename_out = NULL;
  length = wcslen(path);
  if (length > 32760) { SetLastError(ERROR_FILENAME_EXCED_RANGE); return 0; }
  copy = (wchar_t *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, (length + 1) * sizeof(wchar_t));
  if (!copy) return 0;
  wcscpy_s(copy, length + 1, path);
  last_separator = wcsrchr(copy, L'\\');
  if (!last_separator || !last_separator[1]) { SetLastError(ERROR_INVALID_NAME); goto fail; }
  basename_length = wcslen(last_separator + 1);
  if (basename_length > 255 || !logic_engine_win_valid_basename(last_separator + 1)) {
    SetLastError(ERROR_INVALID_NAME);
    goto fail;
  }
  *basename_out = (wchar_t *)HeapAlloc(GetProcessHeap(), 0, (basename_length + 1) * sizeof(wchar_t));
  if (!*basename_out) goto fail;
  wcscpy_s(*basename_out, basename_length + 1, last_separator + 1);
  *last_separator = L'\0';
  root[0] = L'\\'; root[1] = L'\\'; root[2] = L'?'; root[3] = L'\\';
  root[4] = copy[0]; root[5] = L':'; root[6] = L'\\'; root[7] = L'\0';
  current = CreateFileW(root,
      FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | READ_CONTROL,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL,
      OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  if (current == INVALID_HANDLE_VALUE
      || !GetFileInformationByHandleEx(current, FileAttributeTagInfo, &tag, sizeof(tag))
      || (tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0
      || (tag.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0
      || !le_store_parent_acl_safe(current)) goto fail;
  cursor = copy + 3;
  while (*cursor) {
    wchar_t *end;
    wchar_t saved;
    HANDLE next;
    while (*cursor == L'\\') ++cursor;
    if (!*cursor) break;
    end = wcschr(cursor, L'\\');
    saved = end ? *end : L'\0';
    if (end) *end = L'\0';
    if (!logic_engine_win_valid_basename(cursor)) {
      if (end) *end = saved;
      SetLastError(ERROR_ACCESS_DENIED);
      goto fail;
    }
    next = logic_engine_win_open_relative(current, cursor,
        FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | READ_CONTROL,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        FILE_OPEN, FILE_DIRECTORY_FILE, FILE_ATTRIBUTE_DIRECTORY, NULL, NULL);
    if (end) *end = saved;
    if (next == INVALID_HANDLE_VALUE
        || !GetFileInformationByHandleEx(next, FileAttributeTagInfo, &tag, sizeof(tag))
        || (tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0
        || (tag.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0
        || !le_store_parent_acl_safe(next)) {
      if (next != INVALID_HANDLE_VALUE) CloseHandle(next);
      goto fail;
    }
    CloseHandle(current);
    current = next;
    if (!end) break;
    cursor = end + 1;
  }
  HeapFree(GetProcessHeap(), 0, copy);
  *parent_out = current;
  return 1;
fail:
  if (current != INVALID_HANDLE_VALUE) CloseHandle(current);
  if (*basename_out) HeapFree(GetProcessHeap(), 0, *basename_out);
  *basename_out = NULL;
  if (copy) HeapFree(GetProcessHeap(), 0, copy);
  return 0;
}

int le_win_store_open(
    LE_WIN_MANIFEST_STORE *store,
    const wchar_t *configured_directory,
    LE_STORE_VALIDATE validate_manifest,
    LE_STORE_VALIDATE validate_intent,
    void *validator_context) {
  HANDLE directory = INVALID_HANDLE_VALUE;
  HANDLE parent = INVALID_HANDLE_VALUE;
  wchar_t *basename = NULL;
  FILE_ATTRIBUTE_TAG_INFO tag;
  if (!store || !configured_directory || !configured_directory[0]
      || !validate_manifest || !validate_intent) {
    SetLastError(ERROR_INVALID_PARAMETER);
    return 0;
  }
  ZeroMemory(store, sizeof(*store));
  store->directory = INVALID_HANDLE_VALUE;
  store->lock = INVALID_HANDLE_VALUE;
  if (!le_store_open_parent_chain(configured_directory, &parent, &basename)) return 0;
  directory = logic_engine_win_open_relative(parent, basename,
      FILE_LIST_DIRECTORY | FILE_ADD_FILE | FILE_DELETE_CHILD |
      FILE_READ_ATTRIBUTES | READ_CONTROL | FILE_WRITE_ATTRIBUTES | GENERIC_WRITE,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      FILE_OPEN, FILE_DIRECTORY_FILE, FILE_ATTRIBUTE_DIRECTORY, NULL, NULL);
  CloseHandle(parent);
  HeapFree(GetProcessHeap(), 0, basename);
  if (directory == INVALID_HANDLE_VALUE) return 0;
  if (!GetFileInformationByHandleEx(directory, FileAttributeTagInfo, &tag, sizeof(tag))
      || (tag.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0
      || (tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0
      || !logic_engine_win_identity(directory, &store->directory_identity, NULL)
      || !le_store_is_ntfs(directory)
      || !le_store_acl_is_private(directory)) {
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
      FILE_NON_DIRECTORY_FILE, FILE_ATTRIBUTE_NORMAL, NULL, NULL);
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

/*
 * Use the native FileRenameInformation class so the rename remains relative
 * to the retained directory HANDLE. There is deliberately no path fallback.
 */
typedef NTSTATUS (NTAPI *le_nt_set_information_file_fn)(
    HANDLE, PIO_STATUS_BLOCK, PVOID, ULONG, ULONG);

typedef struct LE_FILE_RENAME_INFORMATION {
  BOOLEAN ReplaceIfExists;
  HANDLE RootDirectory;
  ULONG FileNameLength;
  WCHAR FileName[1];
} LE_FILE_RENAME_INFORMATION;

static int le_win_rename_relative(
    HANDLE file, HANDLE directory, const wchar_t *target) {
  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  le_nt_set_information_file_fn set_information;
  IO_STATUS_BLOCK io_status;
  LE_FILE_RENAME_INFORMATION *rename_info;
  size_t name_length;
  size_t buffer_length;
  NTSTATUS status;
  if (!ntdll || !file || file == INVALID_HANDLE_VALUE
      || !directory || directory == INVALID_HANDLE_VALUE
      || !target || !target[0]) {
    SetLastError(ERROR_INVALID_PARAMETER);
    return 0;
  }
  name_length = wcslen(target) * sizeof(wchar_t);
  buffer_length = offsetof(LE_FILE_RENAME_INFORMATION, FileName) + name_length;
  if (name_length > 0xffffffffu || buffer_length > 0xffffffffu) {
    SetLastError(ERROR_INVALID_PARAMETER);
    return 0;
  }
  set_information = (le_nt_set_information_file_fn)(void *)
      GetProcAddress(ntdll, "NtSetInformationFile");
  if (!set_information) {
    SetLastError(ERROR_PROC_NOT_FOUND);
    return 0;
  }
  rename_info = (LE_FILE_RENAME_INFORMATION *)HeapAlloc(
      GetProcessHeap(), HEAP_ZERO_MEMORY, buffer_length);
  if (!rename_info) return 0;
  rename_info->ReplaceIfExists = TRUE;
  rename_info->RootDirectory = directory;
  rename_info->FileNameLength = (ULONG)name_length;
  memcpy(rename_info->FileName, target, name_length);
  ZeroMemory(&io_status, sizeof(io_status));
  /* Native FILE_INFORMATION_CLASS::FileRenameInformation is 10. */
  status = set_information(file, &io_status, rename_info, (ULONG)buffer_length, 10);
  HeapFree(GetProcessHeap(), 0, rename_info);
  if (status < 0) {
    SetLastError(logic_engine_win_status_to_error(status));
    return 0;
  }
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
  DWORD written_total = 0;
  size_t i;
  HANDLE file = INVALID_HANDLE_VALUE;
  BOOL renamed = FALSE;
#ifdef LE_STORE_DIAGNOSTICS
  const char *failure_stage = "open temp file";
#endif
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
  if (FAILED(StringCchPrintfW(temporary, LE_COUNT_OF(temporary), L"manifest-%s.tmp", hex))) {
    SetLastError(ERROR_INVALID_NAME);
    return 0;
  }
  file = logic_engine_win_open_relative(store->directory, temporary,
      GENERIC_WRITE | DELETE | FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ | FILE_SHARE_DELETE, FILE_CREATE, FILE_NON_DIRECTORY_FILE,
      FILE_ATTRIBUTE_NORMAL, NULL, NULL);
  if (file == INVALID_HANDLE_VALUE) return 0;
#ifdef LE_STORE_DIAGNOSTICS
  failure_stage = "write temp file";
#endif
  while (written_total < length) {
    DWORD chunk = 0;
    if (!WriteFile(file, bytes + written_total, length - written_total, &chunk, NULL)
        || chunk == 0) goto cleanup;
    written_total += chunk;
  }
#ifdef LE_STORE_DIAGNOSTICS
  failure_stage = "flush temp file";
#endif
  if (!FlushFileBuffers(file)) goto cleanup;
#ifdef LE_STORE_DIAGNOSTICS
  failure_stage = "handle-relative native rename";
#endif
  if (!le_win_rename_relative(file, store->directory, target)) goto cleanup;
  renamed = TRUE;
#ifdef LE_STORE_DIAGNOSTICS
  failure_stage = "flush parent directory";
#endif
  if (!FlushFileBuffers(store->directory)) goto cleanup;
  HeapFree(GetProcessHeap(), 0, rename_info);
  CloseHandle(file);
  return 1;
cleanup:
#ifdef LE_STORE_DIAGNOSTICS
  fprintf(stderr, "manifest store failed at %s (GetLastError=%lu)\\n", failure_stage, (unsigned long)GetLastError());
#endif
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
