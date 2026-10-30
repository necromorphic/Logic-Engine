/*
 * Logic-Engine SQLite VFS identity probe.
 *
 * This is deliberately NOT a production secure VFS. It delegates SQLite file
 * operations to the default VFS, but requires explicit registration of every
 * file-backed main database. Registration captures and pins the OS identity;
 * test-only syscall wrappers compare later main/sidecar opens to registered
 * identities and inject deterministic hardlink replacements.
 *
 * This branch has partial directory-handle-relative DB/sidecar operations:
 * POSIX pins the final parent directory but its xDelete is not identity-safe
 * against same-directory entry replacement; Windows uses a retained parent
 * HANDLE for recognized opens, xAccess and handle-relative xDelete.
 * Persistent trust, complete sidecar lifecycle, full VFS operation coverage,
 * startup/recovery integration and independent review remain open. Never use
 * this probe for production databases.
 */
#include <string.h>
#include <stdint.h>
#include <errno.h>
#ifdef _WIN32
#include <windows.h>
#include <wchar.h>
#include "windows_relative_open.h"
#else
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#endif
#include "sqlite3ext.h"
SQLITE_EXTENSION_INIT1

static sqlite3_vfs g_probe_vfs;
static sqlite3_vfs *g_parent_vfs = 0;
static int g_main_db_open_count = 0;
static int g_wal_open_count = 0;
static int g_journal_open_count = 0;
static int g_native_open_count = 0;
static int g_registered = 0;
static sqlite3_mutex *g_registry_mutex = 0;
static const char *g_open_syscall_name = 0;
static sqlite3_syscall_ptr g_original_open_syscall = 0;
#ifndef _WIN32
static sqlite3_syscall_ptr g_original_stat_syscall = 0;
#endif
static char *g_race_path = 0;
static char *g_race_target_path = 0;
static int g_race_identity_set = 0;
static int g_race_inject_once = 0;
static int g_race_injection_count = 0;
static int g_identity_reject_count = 0;
static int g_sidecar_identity_check_count = 0;
static int g_sidecar_identity_reject_count = 0;
static int g_reused_descriptor_accept_count = 0;
#define PROBE_MAX_DATABASE_ROLES 32
typedef struct ProbeDatabaseRole {
  char *path;
  char *role;
  int identity_set;
#ifdef _WIN32
  LogicEngineWinFileIdentity identity;
  LogicEngineWinDirectoryAnchor anchor;
  HANDLE trusted_handle;
#else
  dev_t device;
  ino_t inode;
  int trusted_fd;
  int trusted_parent_fd;
  char *basename;
#endif
} ProbeDatabaseRole;
static ProbeDatabaseRole g_database_roles[PROBE_MAX_DATABASE_ROLES];
static int g_database_role_count = 0;
#ifdef _WIN32
#define PROBE_MAX_SIDECAR_IDENTITIES (PROBE_MAX_DATABASE_ROLES * 3)
typedef struct ProbeSidecarIdentity {
  int role_index;
  int kind; /* 1 = WAL, 2 = SHM, 3 = rollback journal */
  LogicEngineWinFileIdentity identity;
} ProbeSidecarIdentity;
static ProbeSidecarIdentity g_sidecar_identities[PROBE_MAX_SIDECAR_IDENTITIES];
static int g_sidecar_identity_count = 0;
#else
#define PROBE_MAX_SIDECAR_IDENTITIES (PROBE_MAX_DATABASE_ROLES * 3)
typedef struct ProbeSidecarIdentity {
  int role_index;
  int kind; /* 1 = WAL, 2 = SHM, 3 = rollback journal */
  dev_t device;
  ino_t inode;
} ProbeSidecarIdentity;
static ProbeSidecarIdentity g_sidecar_identities[PROBE_MAX_SIDECAR_IDENTITIES];
static int g_sidecar_identity_count = 0;
#endif
#ifdef _WIN32
static LogicEngineWinFileIdentity g_race_identity;
__declspec(thread) static int g_current_race_open = 0;
__declspec(thread) static int g_current_race_captured = 0;
__declspec(thread) static int g_current_role_index = -1;
__declspec(thread) static int g_current_role_captured = 0;
__declspec(thread) static int g_current_sidecar_open = 0;
__declspec(thread) static int g_current_sidecar_captured = 0;
#else
static dev_t g_race_device = 0;
static ino_t g_race_inode = 0;
static _Thread_local int g_current_race_open = 0;
static _Thread_local int g_current_race_captured = 0;
static _Thread_local int g_current_role_index = -1;
static _Thread_local int g_current_role_captured = 0;
static _Thread_local int g_current_sidecar_open = 0;
static _Thread_local int g_current_sidecar_captured = 0;
static _Thread_local int g_current_role_stat_valid = 0;
static _Thread_local dev_t g_current_role_stat_device = 0;
static _Thread_local ino_t g_current_role_stat_inode = 0;
#endif

static void probe_registry_lock(void) {
  if (g_registry_mutex) sqlite3_mutex_enter(g_registry_mutex);
}
static void probe_registry_unlock(void) {
  if (g_registry_mutex) sqlite3_mutex_leave(g_registry_mutex);
}
static void probe_counter_increment(int *counter) {
  probe_registry_lock();
  *counter += 1;
  probe_registry_unlock();
}
static int probe_counter_read(int *counter) {
  int value;
  probe_registry_lock();
  value = *counter;
  probe_registry_unlock();
  return value;
}

#ifdef _WIN32
static int probe_wide_path_is_shm(LPCWSTR value) {
  size_t length = wcslen(value);
  return length >= 4 && value[length - 4] == L'-'
    && value[length - 3] == L's' && value[length - 2] == L'h'
    && value[length - 1] == L'm';
}
static wchar_t *probe_utf8_to_wide(const char *value) {
  int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value, -1, 0, 0);
  wchar_t *wide;
  if (length <= 0) return 0;
  wide = (wchar_t *)sqlite3_malloc64((sqlite3_uint64)length * sizeof(wchar_t));
  if (!wide) return 0;
  if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value, -1, wide, length) <= 0) {
    sqlite3_free(wide);
    return 0;
  }
  return wide;
}
static int probe_replace_with_hardlink(const char *path, const char *target) {
  wchar_t *wide_path = probe_utf8_to_wide(path);
  wchar_t *wide_target = probe_utf8_to_wide(target);
  int ok = 0;
  if (wide_path && wide_target) {
    if (DeleteFileW(wide_path) || GetLastError() == ERROR_FILE_NOT_FOUND) {
      ok = CreateHardLinkW(wide_path, wide_target, 0) != 0;
    }
  }
  sqlite3_free(wide_path);
  sqlite3_free(wide_target);
  return ok;
}
static LPCWSTR probe_strip_extended_prefix(LPCWSTR path) {
  return path && wcsncmp(path, L"\\\\?\\", 4) == 0 ? path + 4 : path;
}

static int probe_win_path_equal(LPCWSTR left, LPCWSTR right) {
  left = probe_strip_extended_prefix(left);
  right = probe_strip_extended_prefix(right);
  return left && right
    && CompareStringOrdinal(left, -1, right, -1, TRUE) == CSTR_EQUAL;
}

static int probe_match_role_entry_w(LPCWSTR path, int *role_index,
                                    const wchar_t **suffix) {
  LPCWSTR candidate = probe_strip_extended_prefix(path);
  size_t candidate_length;
  int found = -1;
  const wchar_t *found_suffix = NULL;
  if (!candidate || !role_index || !suffix) return 0;
  candidate_length = wcslen(candidate);
  probe_registry_lock();
  for (int i = 0; i < g_database_role_count; i++) {
    wchar_t *base = probe_utf8_to_wide(g_database_roles[i].path);
    LPCWSTR normalized_base;
    size_t base_length;
    if (!base) continue;
    normalized_base = probe_strip_extended_prefix(base);
    base_length = wcslen(normalized_base);
    if (candidate_length == base_length
        && CompareStringOrdinal(candidate, (int)base_length,
             normalized_base, (int)base_length, TRUE) == CSTR_EQUAL) {
      found = i;
      found_suffix = L"";
    } else if (candidate_length > base_length
        && CompareStringOrdinal(candidate, (int)base_length,
             normalized_base, (int)base_length, TRUE) == CSTR_EQUAL) {
      LPCWSTR tail = candidate + base_length;
      if (probe_win_path_equal(tail, L"-wal")) {
        found = i;
        found_suffix = L"-wal";
      } else if (probe_win_path_equal(tail, L"-shm")) {
        found = i;
        found_suffix = L"-shm";
      } else if (probe_win_path_equal(tail, L"-journal")) {
        found = i;
        found_suffix = L"-journal";
      }
    }
    sqlite3_free(base);
    if (found >= 0) break;
  }
  probe_registry_unlock();
  if (found < 0) return 0;
  *role_index = found;
  *suffix = found_suffix;
  return 1;
}

static wchar_t *probe_win_relative_name(const ProbeDatabaseRole *role,
                                        const wchar_t *suffix) {
  size_t base_length = wcslen(role->anchor.basename);
  size_t suffix_length = wcslen(suffix);
  wchar_t *name;
  if (base_length + suffix_length > 32760) return NULL;
  name = (wchar_t *)sqlite3_malloc64(
    (sqlite3_uint64)(base_length + suffix_length + 1) * sizeof(wchar_t));
  if (!name) return NULL;
  memcpy(name, role->anchor.basename, base_length * sizeof(wchar_t));
  memcpy(name + base_length, suffix, (suffix_length + 1) * sizeof(wchar_t));
  return name;
}

static int probe_win_sidecar_kind(const wchar_t *suffix) {
  if (suffix && wcscmp(suffix, L"-wal") == 0) return 1;
  if (suffix && wcscmp(suffix, L"-shm") == 0) return 2;
  if (suffix && wcscmp(suffix, L"-journal") == 0) return 3;
  return 0;
}

static int probe_win_sidecar_identity_lookup(int role_index, const wchar_t *suffix,
                                              LogicEngineWinFileIdentity *identity) {
  int kind = probe_win_sidecar_kind(suffix);
  int found = 0;
  if (!kind || !identity) return 0;
  probe_registry_lock();
  for (int i = 0; i < g_sidecar_identity_count; ++i) {
    if (g_sidecar_identities[i].role_index == role_index
        && g_sidecar_identities[i].kind == kind) {
      *identity = g_sidecar_identities[i].identity;
      found = 1;
      break;
    }
  }
  probe_registry_unlock();
  return found;
}

/* Caller must hold g_registry_mutex. */
static int probe_win_sidecar_identity_record_locked(int role_index, const wchar_t *suffix,
                                                     const LogicEngineWinFileIdentity *identity) {
  int kind = probe_win_sidecar_kind(suffix);
  int existing = -1;
  int reject = !kind || !identity;
  for (int i = 0; !reject && i < g_database_role_count; ++i) {
    if (logic_engine_win_identity_equal(identity, &g_database_roles[i].identity)) reject = 1;
  }
  for (int i = 0; !reject && i < g_sidecar_identity_count; ++i) {
    ProbeSidecarIdentity *entry = &g_sidecar_identities[i];
    if (entry->role_index == role_index && entry->kind == kind) {
      existing = i;
      if (!logic_engine_win_identity_equal(identity, &entry->identity)) reject = 1;
    } else if (logic_engine_win_identity_equal(identity, &entry->identity)) {
      reject = 1;
    }
  }
  if (!reject && existing < 0) {
    if (g_sidecar_identity_count >= PROBE_MAX_SIDECAR_IDENTITIES) {
      reject = 1;
    } else {
      ProbeSidecarIdentity *entry = &g_sidecar_identities[g_sidecar_identity_count++];
      entry->role_index = role_index;
      entry->kind = kind;
      entry->identity = *identity;
    }
  }
  return !reject;
}

static int probe_win_sidecar_identity_remove(int role_index, const wchar_t *suffix,
                                              const LogicEngineWinFileIdentity *identity) {
  int kind = probe_win_sidecar_kind(suffix);
  int removed = 0;
  if (!kind || !identity) return 0;
  probe_registry_lock();
  for (int i = 0; i < g_sidecar_identity_count; ++i) {
    ProbeSidecarIdentity *entry = &g_sidecar_identities[i];
    if (entry->role_index == role_index && entry->kind == kind
        && logic_engine_win_identity_equal(identity, &entry->identity)) {
      g_sidecar_identity_count -= 1;
      if (i < g_sidecar_identity_count) {
        memmove(&g_sidecar_identities[i], &g_sidecar_identities[i + 1],
          (size_t)(g_sidecar_identity_count - i) * sizeof(g_sidecar_identities[0]));
      }
      removed = 1;
      break;
    }
  }
  probe_registry_unlock();
  return removed;
}

static int probe_win_map_create_file(
  DWORD creation, DWORD attributes, ULONG *disposition,
  ULONG *options, ULONG *file_attributes) {
  DWORD flags = attributes & 0xffff0000u;
  DWORD allowed_flags = FILE_FLAG_WRITE_THROUGH | FILE_FLAG_NO_BUFFERING
    | FILE_FLAG_RANDOM_ACCESS | FILE_FLAG_SEQUENTIAL_SCAN
    | FILE_FLAG_DELETE_ON_CLOSE | FILE_FLAG_OPEN_REPARSE_POINT;
  switch (creation) {
    case CREATE_NEW: *disposition = FILE_CREATE; break;
    /* Never let NT truncate a child before its opened identity is validated. */
    case CREATE_ALWAYS: return 0;
    case OPEN_EXISTING: *disposition = FILE_OPEN; break;
    case OPEN_ALWAYS: *disposition = FILE_OPEN_IF; break;
    case TRUNCATE_EXISTING: return 0;
    default: return 0;
  }
  if ((flags & ~allowed_flags) != 0) return 0;
  *options = 0;
  if ((flags & FILE_FLAG_WRITE_THROUGH) != 0) *options |= FILE_WRITE_THROUGH;
  if ((flags & FILE_FLAG_NO_BUFFERING) != 0) *options |= FILE_NO_INTERMEDIATE_BUFFERING;
  if ((flags & FILE_FLAG_DELETE_ON_CLOSE) != 0) *options |= FILE_DELETE_ON_CLOSE;
  *file_attributes = attributes & 0x0000ffffu;
  if (*file_attributes == 0) *file_attributes = FILE_ATTRIBUTE_NORMAL;
  if ((*file_attributes & FILE_ATTRIBUTE_NORMAL) != 0
      && *file_attributes != FILE_ATTRIBUTE_NORMAL) {
    *file_attributes &= ~FILE_ATTRIBUTE_NORMAL;
  }
  return 1;
}

typedef HANDLE (WINAPI *probe_create_file_w_fn)(
  LPCWSTR, DWORD, DWORD, LPSECURITY_ATTRIBUTES, DWORD, DWORD, HANDLE
);

static HANDLE WINAPI probe_create_file_w(
  LPCWSTR name, DWORD access, DWORD share, LPSECURITY_ATTRIBUTES security,
  DWORD creation, DWORD attributes, HANDLE template_file
) {
  HANDLE handle = INVALID_HANDLE_VALUE;
  LogicEngineWinFileIdentity info_identity;
  DWORD file_attributes = 0;
  DWORD relative_open_error = ERROR_SUCCESS;
  int role_index = -1;
  const wchar_t *suffix = NULL;
  int has_anchor = name && probe_match_role_entry_w(name, &role_index, &suffix);
  int main_role_open = has_anchor && suffix[0] == L'\0';
  int is_sidecar = (has_anchor && suffix[0] != L'\0')
    || (g_current_sidecar_open && !g_current_sidecar_captured)
    || (name && probe_wide_path_is_shm(name));
  int needs_identity = has_anchor || is_sidecar
    || (g_current_race_open && !g_current_race_captured)
    || (g_current_role_index >= 0 && !g_current_role_captured);
  int injected_here = 0;
  probe_counter_increment(&g_native_open_count);

  if ((g_current_role_index >= 0
        && (!main_role_open || role_index != g_current_role_index))
      || ((g_current_sidecar_open || (name && probe_wide_path_is_shm(name)))
        && !has_anchor)
      || (g_current_race_open && !has_anchor)) {
    SetLastError(ERROR_ACCESS_DENIED);
    probe_counter_increment(&g_identity_reject_count);
    if (is_sidecar) probe_counter_increment(&g_sidecar_identity_reject_count);
    return INVALID_HANDLE_VALUE;
  }

  if (g_race_inject_once && g_race_path && g_race_target_path) {
    wchar_t *race_path = probe_utf8_to_wide(g_race_path);
    if (race_path && probe_win_path_equal(name, race_path)) {
      g_race_inject_once = 0;
      if (!probe_replace_with_hardlink(g_race_path, g_race_target_path)) {
        sqlite3_free(race_path);
        SetLastError(ERROR_ACCESS_DENIED);
        return INVALID_HANDLE_VALUE;
      }
      probe_counter_increment(&g_race_injection_count);
      g_current_race_open = 1;
      g_current_race_captured = 0;
      injected_here = 1;
    }
    sqlite3_free(race_path);
  }

  if (has_anchor) {
    ProbeDatabaseRole *role = &g_database_roles[role_index];
    wchar_t *relative_name;
    ULONG disposition, options, native_attributes;
    ACCESS_MASK desired_access = (ACCESS_MASK)access;
    const LogicEngineWinFileIdentity *expected =
      main_role_open ? &role->identity : NULL;
    if (security || template_file
        || !probe_win_map_create_file(creation, attributes,
             &disposition, &options, &native_attributes)) {
      SetLastError(ERROR_NOT_SUPPORTED);
      return INVALID_HANDLE_VALUE;
    }
    if ((options & FILE_DELETE_ON_CLOSE) != 0) desired_access |= DELETE;
    relative_name = probe_win_relative_name(role, suffix);
    if (!relative_name) {
      SetLastError(ERROR_NOT_ENOUGH_MEMORY);
      return INVALID_HANDLE_VALUE;
    }
    /*
     * Keep protected handles rename-compatible. SQLite's Windows VFS may omit
     * FILE_SHARE_DELETE; without it, a still-open/pending DB handle can prevent
     * the parent directory from being renamed even though all opens are
     * anchored. The retained directory HANDLE remains the authority, and each
     * later child open is still identity-checked.
     */
    handle = logic_engine_win_open_relative(role->anchor.parent,
      relative_name, desired_access, share | FILE_SHARE_DELETE, disposition, options,
      native_attributes, expected, &info_identity);
    relative_open_error = GetLastError();
    sqlite3_free(relative_name);
  } else if (needs_identity) {
    /* Registered DB and sidecar paths must never fall back to absolute opens. */
    SetLastError(ERROR_ACCESS_DENIED);
    return INVALID_HANDLE_VALUE;
  } else {
    handle = ((probe_create_file_w_fn)g_original_open_syscall)(
      name, access, share, security, creation, attributes, template_file);
  }

  if (handle == INVALID_HANDLE_VALUE || !needs_identity) {
    if (handle == INVALID_HANDLE_VALUE && needs_identity
        && relative_open_error == ERROR_ACCESS_DENIED) {
      /*
       * The relative-open helper rejects a mismatched expected identity before
       * returning a HANDLE. Count that rejection here as well as post-open
       * identity failures so the adversarial tests observe both boundaries.
       */
      probe_counter_increment(&g_identity_reject_count);
      if (is_sidecar) probe_counter_increment(&g_sidecar_identity_reject_count);
    }
    if (injected_here) {
      g_current_race_open = 0;
      g_current_race_captured = 0;
    }
    return handle;
  }

  if (!logic_engine_win_identity(handle, &info_identity, &file_attributes)
      || (file_attributes & FILE_ATTRIBUTE_DIRECTORY) != 0) {
    CloseHandle(handle);
    if (injected_here) {
      g_current_race_open = 0;
      g_current_race_captured = 0;
    }
    SetLastError(ERROR_ACCESS_DENIED);
    probe_counter_increment(&g_identity_reject_count);
    if (is_sidecar) probe_counter_increment(&g_sidecar_identity_reject_count);
    return INVALID_HANDLE_VALUE;
  }

  probe_registry_lock();
  {
    int reject = 0;
    if (main_role_open) {
      ProbeDatabaseRole *role = &g_database_roles[role_index];
      reject = !logic_engine_win_identity_equal(&info_identity, &role->identity);
    }
    if (!reject && is_sidecar) {
      for (int i = 0; i < g_database_role_count; i++) {
        ProbeDatabaseRole *role = &g_database_roles[i];
        if (role->identity_set
            && logic_engine_win_identity_equal(&info_identity, &role->identity)) {
          reject = 1;
          break;
        }
      }
      if (!reject && has_anchor && !main_role_open
          && !probe_win_sidecar_identity_record_locked(role_index, suffix, &info_identity)) {
        reject = 1;
      }
    }
    if (!reject && g_current_race_open && !g_current_race_captured
        && g_race_identity_set) {
      reject = !logic_engine_win_identity_equal(&info_identity, &g_race_identity);
    }
    if (reject) {
      g_identity_reject_count += 1;
      if (is_sidecar) g_sidecar_identity_reject_count += 1;
      probe_registry_unlock();
      CloseHandle(handle);
      if (injected_here) {
        g_current_race_open = 0;
        g_current_race_captured = 0;
      }
      SetLastError(ERROR_ACCESS_DENIED);
      return INVALID_HANDLE_VALUE;
    }
    if (g_current_race_open && !g_current_race_captured && !g_race_identity_set) {
      g_race_identity = info_identity;
      g_race_identity_set = 1;
    }
    if (is_sidecar) {
      g_sidecar_identity_check_count += 1;
      if (g_current_sidecar_open) g_current_sidecar_captured = 1;
    }
    if (main_role_open && g_current_role_index >= 0) g_current_role_captured = 1;
    if (g_current_race_open) g_current_race_captured = 1;
  }
  probe_registry_unlock();

  if (injected_here) {
    g_current_race_open = 0;
    g_current_race_captured = 0;
  }
  SetLastError(ERROR_SUCCESS);
  return handle;
}
#else
static int probe_path_is_shm(const char *path) {
  size_t length = strlen(path);
  return length >= 4 && strcmp(path + length - 4, "-shm") == 0;
}
static int probe_replace_with_hardlink(const char *path, const char *target) {
  if (unlink(path) != 0 && errno != ENOENT) return 0;
  return link(target, path) == 0;
}
typedef int (*probe_open_fn)(const char *, int, int);
#ifndef _WIN32
static int probe_match_role_entry(const char *path, int *role_index, const char **suffix) {
  int found = -1;
  const char *found_suffix = 0;
  probe_registry_lock();
  for (int i = 0; i < g_database_role_count; i++) {
    const char *base = g_database_roles[i].path;
    size_t length = strlen(base);
    if (strcmp(path, base) == 0) {
      found = i;
      found_suffix = "";
      break;
    }
    if (strncmp(path, base, length) == 0) {
      const char *tail = path + length;
      if (strcmp(tail, "-wal") == 0 || strcmp(tail, "-shm") == 0
          || strcmp(tail, "-journal") == 0) {
        found = i;
        found_suffix = tail;
        break;
      }
    }
  }
  probe_registry_unlock();
  if (found < 0) return 0;
  *role_index = found;
  *suffix = found_suffix;
  return 1;
}
static int probe_open_anchored(int role_index, const char *suffix, int flags, int mode) {
  ProbeDatabaseRole *role = &g_database_roles[role_index];
  char relative_name[4096];
  size_t base_length = strlen(role->basename);
  size_t suffix_length = strlen(suffix);
  if (base_length + suffix_length + 1 > sizeof(relative_name)) {
    errno = ENAMETOOLONG;
    return -1;
  }
  memcpy(relative_name, role->basename, base_length);
  memcpy(relative_name + base_length, suffix, suffix_length + 1);
  return openat(role->trusted_parent_fd, relative_name, flags, mode);
}
#endif
static int probe_open(const char *name, int flags, int mode) {
  int fd;
  struct stat info;
  int is_sidecar = (g_current_sidecar_open && !g_current_sidecar_captured)
    || probe_path_is_shm(name);
  int anchored_role_index = -1;
  const char *anchored_suffix = 0;
  int has_anchor = probe_match_role_entry(name, &anchored_role_index, &anchored_suffix);
  int needs_identity = is_sidecar
    || (g_current_race_open && !g_current_race_captured)
    || (g_current_role_index >= 0 && !g_current_role_captured)
    || has_anchor;
  int injected_here = 0;
  probe_counter_increment(&g_native_open_count);
  if (g_race_inject_once && g_race_path && g_race_target_path
      && strcmp(name, g_race_path) == 0) {
    g_race_inject_once = 0;
    if (!probe_replace_with_hardlink(g_race_path, g_race_target_path)) {
      errno = EACCES;
      return -1;
    }
    probe_counter_increment(&g_race_injection_count);
    g_current_race_open = 1;
    g_current_race_captured = 0;
    injected_here = 1;
  }
  if (needs_identity) {
#ifdef O_NOFOLLOW
    flags |= O_NOFOLLOW;
#else
    errno = EACCES;
    probe_registry_lock();
    g_identity_reject_count += 1;
    if (is_sidecar) g_sidecar_identity_reject_count += 1;
    probe_registry_unlock();
    return -1;
#endif
  }
  if (has_anchor) {
    fd = probe_open_anchored(anchored_role_index, anchored_suffix, flags, mode);
  } else {
    fd = ((probe_open_fn)g_original_open_syscall)(name, flags, mode);
  }
  if (fd < 0 || !needs_identity) {
    if (injected_here) {
      g_current_race_open = 0;
      g_current_race_captured = 0;
    }
    return fd;
  }
  probe_registry_lock();
  {
    int reject = fstat(fd, &info) != 0 || info.st_dev == 0 || info.st_ino == 0;
    if (!reject && g_current_role_index >= 0 && !g_current_role_captured) {
      ProbeDatabaseRole *role = &g_database_roles[g_current_role_index];
      if (g_current_role_stat_valid
          && (info.st_dev != g_current_role_stat_device
            || info.st_ino != g_current_role_stat_inode)) reject = 1;
      if (!reject && role->identity_set) {
        reject = info.st_dev != role->device || info.st_ino != role->inode;
      } else if (!reject) {
        for (int i = 0; i < g_database_role_count; i++) {
          ProbeDatabaseRole *other = &g_database_roles[i];
          if (i != g_current_role_index && other->identity_set
              && info.st_dev == other->device && info.st_ino == other->inode) reject = 1;
        }
      }
    }
    if (!reject && is_sidecar) {
      for (int i = 0; i < g_database_role_count; i++) {
        ProbeDatabaseRole *role = &g_database_roles[i];
        if (role->identity_set && info.st_dev == role->device
            && info.st_ino == role->inode) reject = 1;
      }
    }
    if (!reject && is_sidecar && has_anchor && anchored_suffix[0] != '\\0') {
      int kind = strcmp(anchored_suffix, "-wal") == 0 ? 1
        : strcmp(anchored_suffix, "-shm") == 0 ? 2
        : strcmp(anchored_suffix, "-journal") == 0 ? 3 : 0;
      int existing = -1;
      if (kind == 0) reject = 1;
      for (int i = 0; !reject && i < g_sidecar_identity_count; ++i) {
        ProbeSidecarIdentity *entry = &g_sidecar_identities[i];
        if (entry->role_index == anchored_role_index && entry->kind == kind) {
          existing = i;
          if (entry->device != info.st_dev || entry->inode != info.st_ino) reject = 1;
        } else if (entry->device == info.st_dev && entry->inode == info.st_ino) {
          reject = 1;
        }
      }
      if (!reject && existing < 0) {
        if (g_sidecar_identity_count >= PROBE_MAX_SIDECAR_IDENTITIES) reject = 1;
        else {
          ProbeSidecarIdentity *entry = &g_sidecar_identities[g_sidecar_identity_count++];
          entry->role_index = anchored_role_index;
          entry->kind = kind;
          entry->device = info.st_dev;
          entry->inode = info.st_ino;
        }
      }
    }
    if (!reject && g_current_race_open && !g_current_race_captured
        && g_race_identity_set) {
      reject = info.st_dev != g_race_device || info.st_ino != g_race_inode;
    }
    if (reject) {
      g_identity_reject_count += 1;
      if (is_sidecar) g_sidecar_identity_reject_count += 1;
      probe_registry_unlock();
      close(fd);
      if (injected_here) {
        g_current_race_open = 0;
        g_current_race_captured = 0;
      }
      errno = EACCES;
      return -1;
    }
    if (g_current_role_index >= 0 && !g_current_role_captured
        && !g_database_roles[g_current_role_index].identity_set) {
      ProbeDatabaseRole *role = &g_database_roles[g_current_role_index];
      role->device = info.st_dev;
      role->inode = info.st_ino;
      role->identity_set = 1;
    }
    if (g_current_race_open && !g_current_race_captured && !g_race_identity_set) {
      g_race_device = info.st_dev;
      g_race_inode = info.st_ino;
      g_race_identity_set = 1;
    }
    if (is_sidecar) {
      g_sidecar_identity_check_count += 1;
      if (g_current_sidecar_open) g_current_sidecar_captured = 1;
    }
    if (g_current_role_index >= 0) g_current_role_captured = 1;
    if (g_current_race_open) g_current_race_captured = 1;
  }
  probe_registry_unlock();
  if (injected_here) {
    g_current_race_open = 0;
    g_current_race_captured = 0;
  }
  return fd;
}
typedef int (*probe_stat_fn)(const char *, struct stat *);
static int probe_stat(const char *name, struct stat *info) {
  int rc;
  int anchored_role_index = -1;
  const char *anchored_suffix = 0;
  if (probe_match_role_entry(name, &anchored_role_index, &anchored_suffix)) {
    ProbeDatabaseRole *role = &g_database_roles[anchored_role_index];
    char relative_name[4096];
    size_t base_length = strlen(role->basename);
    size_t suffix_length = strlen(anchored_suffix);
    if (base_length + suffix_length + 1 > sizeof(relative_name)) {
      errno = ENAMETOOLONG;
      return -1;
    }
    memcpy(relative_name, role->basename, base_length);
    memcpy(relative_name + base_length, anchored_suffix, suffix_length + 1);
    rc = fstatat(role->trusted_parent_fd, relative_name, info, AT_SYMLINK_NOFOLLOW);
  } else {
    rc = ((probe_stat_fn)g_original_stat_syscall)(name, info);
  }
  if (rc != 0) return rc;
  if (g_current_role_index >= 0 && !g_current_role_stat_valid) {
    int reject = 0;
    probe_registry_lock();
    {
      ProbeDatabaseRole *role = &g_database_roles[g_current_role_index];
      if (strcmp(name, role->path) == 0) {
        if (info->st_dev == 0 || info->st_ino == 0
            || (role->identity_set
              && (info->st_dev != role->device || info->st_ino != role->inode))) {
          reject = 1;
        }
        if (!reject && !role->identity_set) {
          for (int i = 0; i < g_database_role_count; i++) {
            ProbeDatabaseRole *other = &g_database_roles[i];
            if (i != g_current_role_index && other->identity_set
                && info->st_dev == other->device && info->st_ino == other->inode) reject = 1;
          }
        }
        if (!reject) {
          g_current_role_stat_device = info->st_dev;
          g_current_role_stat_inode = info->st_ino;
          g_current_role_stat_valid = 1;
        }
      }
    }
    probe_registry_unlock();
    if (reject) {
      errno = EACCES;
      return -1;
    }
  }
  // Deterministically replace the path after stat has returned its identity,
  // but before SQLite can reuse/open the file. The later fstat must detect it.
  if (g_current_race_open && g_race_inject_once && g_race_path
      && strcmp(name, g_race_path) == 0) {
    g_race_inject_once = 0;
    if (!probe_replace_with_hardlink(name, g_race_target_path)) {
      errno = EACCES;
      return -1;
    }
    probe_counter_increment(&g_race_injection_count);
  }
  return rc;
}
#endif

static int probe_xOpen(sqlite3_vfs *vfs, const char *name, sqlite3_file *file,
                       int flags, int *out_flags) {
  sqlite3_vfs *parent = (sqlite3_vfs *)vfs->pAppData;
  int is_sidecar = (flags & (SQLITE_OPEN_WAL | SQLITE_OPEN_MAIN_JOURNAL)) != 0;
  int is_race_target = name && g_race_path
    && (flags & (SQLITE_OPEN_MAIN_DB | SQLITE_OPEN_WAL | SQLITE_OPEN_MAIN_JOURNAL))
    && strcmp(name, g_race_path) == 0;
  int rc;
  int role_index = -1;
  if (name && (flags & SQLITE_OPEN_MAIN_DB)) {
    char *full_path = (char *)sqlite3_malloc64((sqlite3_uint64)parent->mxPathname + 1);
    if (!full_path) return SQLITE_NOMEM;
    if (parent->xFullPathname(parent, name, parent->mxPathname + 1, full_path) == SQLITE_OK) {
      probe_registry_lock();
      for (int i = 0; i < g_database_role_count; i++) {
        if (strcmp(full_path, g_database_roles[i].path) == 0) {
          role_index = i;
          break;
        }
      }
      probe_registry_unlock();
    }
    sqlite3_free(full_path);
  }
  // Every file-backed main database must have an explicit trusted role
  // registration. In-memory databases are intentionally exempt.
  if (name && (flags & SQLITE_OPEN_MAIN_DB)
      && !(flags & SQLITE_OPEN_MEMORY) && role_index < 0) {
    return SQLITE_CANTOPEN;
  }
  if (role_index >= 0) {
    g_current_role_index = role_index;
    g_current_role_captured = 0;
#ifndef _WIN32
    g_current_role_stat_valid = 0;
#endif
  }
  if (is_sidecar) {
    g_current_sidecar_open = 1;
    g_current_sidecar_captured = 0;
  }
  if (is_race_target) {
    g_current_race_open = 1;
    g_current_race_captured = 0;
    // Unix main-database race is injected by probe_stat after stat() returns.
    // WAL/journal opens have no findReusableFd stat window, so inject here.
    if (g_race_inject_once && (is_sidecar
#ifdef _WIN32
        || !is_sidecar
#endif
      )) {
      g_race_inject_once = 0;
      if (!probe_replace_with_hardlink(name, g_race_target_path)) {
        g_current_race_open = 0;
        g_current_sidecar_open = 0;
        return SQLITE_CANTOPEN;
      }
      probe_counter_increment(&g_race_injection_count);
    }
  }
  rc = parent->xOpen(parent, name, file, flags, out_flags);
  if (role_index >= 0) {
#ifndef _WIN32
    if (rc == SQLITE_OK && !g_current_role_captured && g_current_role_stat_valid) {
      probe_registry_lock();
      ProbeDatabaseRole *role = &g_database_roles[role_index];
      if (!role->identity_set) {
        role->device = g_current_role_stat_device;
        role->inode = g_current_role_stat_inode;
        role->identity_set = 1;
      }
      g_reused_descriptor_accept_count += 1;
      g_current_role_captured = 1;
      probe_registry_unlock();
    }
#endif
    if (rc == SQLITE_OK && !g_current_role_captured) {
      if (file->pMethods && file->pMethods->xClose) file->pMethods->xClose(file);
      rc = SQLITE_CANTOPEN;
    }
    g_current_role_index = -1;
    g_current_role_captured = 0;
#ifndef _WIN32
    g_current_role_stat_valid = 0;
#endif
  }
  if (is_sidecar) {
    if (rc == SQLITE_OK && !g_current_sidecar_captured) {
      if (file->pMethods && file->pMethods->xClose) file->pMethods->xClose(file);
      rc = SQLITE_CANTOPEN;
    }
    g_current_sidecar_open = 0;
    g_current_sidecar_captured = 0;
  }
  if (is_race_target) {
    if (rc == SQLITE_OK && !g_current_race_captured) {
      if (file->pMethods && file->pMethods->xClose) file->pMethods->xClose(file);
      rc = SQLITE_CANTOPEN;
    }
    g_current_race_open = 0;
    g_current_race_captured = 0;
  }
  if (rc == SQLITE_OK) {
    if ((flags & SQLITE_OPEN_MAIN_DB) != 0) probe_counter_increment(&g_main_db_open_count);
    if ((flags & SQLITE_OPEN_WAL) != 0) probe_counter_increment(&g_wal_open_count);
    if ((flags & SQLITE_OPEN_MAIN_JOURNAL) != 0) probe_counter_increment(&g_journal_open_count);
  }
  return rc;
}

#ifdef _WIN32
static int probe_win_path_role(const char *path, int *role_index, wchar_t **relative_name,
                               int *is_main) {
  wchar_t *wide = probe_utf8_to_wide(path);
  const wchar_t *suffix = NULL;
  int matched;
  if (!wide) return -1;
  matched = probe_match_role_entry_w(wide, role_index, &suffix);
  sqlite3_free(wide);
  if (!matched) return 0;
  *is_main = suffix[0] == L'\\0';
  *relative_name = probe_win_relative_name(&g_database_roles[*role_index], suffix);
  return *relative_name ? 1 : -1;
}

static int probe_win_identity_is_registered_database(
    const LogicEngineWinFileIdentity *identity) {
  int found = 0;
  probe_registry_lock();
  for (int i = 0; i < g_database_role_count; i++) {
    ProbeDatabaseRole *role = &g_database_roles[i];
    if (role->identity_set
        && logic_engine_win_identity_equal(identity, &role->identity)) {
      found = 1;
      break;
    }
  }
  probe_registry_unlock();
  return found;
}

static const wchar_t *probe_win_sidecar_suffix(const ProbeDatabaseRole *role,
                                                    const wchar_t *relative_name) {
  size_t base_length;
  if (!role || !relative_name) return NULL;
  base_length = wcslen(role->anchor.basename);
  if (wcsncmp(relative_name, role->anchor.basename, base_length) != 0) return NULL;
  return relative_name + base_length;
}

static int probe_win_access_role(int role_index, const wchar_t *relative_name,
                                 int is_main, int flags, int *result) {
  ProbeDatabaseRole *role = &g_database_roles[role_index];
  DWORD desired = FILE_READ_ATTRIBUTES;
  HANDLE handle;
  LogicEngineWinFileIdentity actual;
  DWORD error;
  const wchar_t *suffix = probe_win_sidecar_suffix(role, relative_name);
  if (flags == SQLITE_ACCESS_READWRITE) desired = GENERIC_READ | GENERIC_WRITE;
  else if (flags == SQLITE_ACCESS_READ) desired = GENERIC_READ;
  else if (flags != SQLITE_ACCESS_EXISTS) return SQLITE_IOERR_ACCESS;
  if (!is_main && (!suffix || !probe_win_sidecar_kind(suffix))) return SQLITE_IOERR_ACCESS;
  handle = logic_engine_win_open_relative(role->anchor.parent, relative_name,
      desired, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      FILE_OPEN, FILE_NON_DIRECTORY_FILE, FILE_ATTRIBUTE_NORMAL,
      is_main ? &role->identity : NULL, &actual);
  if (handle == INVALID_HANDLE_VALUE) {
    error = GetLastError();
    if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND
        || error == ERROR_ACCESS_DENIED || error == ERROR_SHARING_VIOLATION) {
      *result = 0;
      return SQLITE_OK;
    }
    return SQLITE_IOERR_ACCESS;
  }
  if (!is_main) {
    int recorded;
    if (probe_win_identity_is_registered_database(&actual)) {
      CloseHandle(handle);
      *result = 0;
      return SQLITE_OK;
    }
    probe_registry_lock();
    recorded = probe_win_sidecar_identity_record_locked(role_index, suffix, &actual);
    probe_registry_unlock();
    if (!recorded) {
      CloseHandle(handle);
      *result = 0;
      return SQLITE_OK;
    }
  }
  CloseHandle(handle);
  *result = 1;
  return SQLITE_OK;
}

static int probe_win_delete_role(int role_index, const wchar_t *relative_name,
                                int is_main) {
  ProbeDatabaseRole *role = &g_database_roles[role_index];
  LogicEngineWinFileIdentity actual, expected_sidecar;
  const wchar_t *suffix = probe_win_sidecar_suffix(role, relative_name);
  const LogicEngineWinFileIdentity *expected = &role->identity;
  HANDLE handle;
  FILE_DISPOSITION_INFO disposition;
  DWORD error;
  if (!is_main) {
    if (!suffix || !probe_win_sidecar_kind(suffix)) return SQLITE_IOERR_DELETE;
    if (!probe_win_sidecar_identity_lookup(role_index, suffix, &expected_sidecar)) {
      /*
       * SQLite may ask to delete a sidecar that is already absent. Preserve
       * that VFS contract, but never delete an existing object without a
       * previously recorded per-role identity.
       */
      HANDLE unowned = logic_engine_win_open_relative(role->anchor.parent,
          relative_name, DELETE | FILE_READ_ATTRIBUTES,
          FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
          FILE_OPEN, FILE_NON_DIRECTORY_FILE, FILE_ATTRIBUTE_NORMAL, NULL, NULL);
      if (unowned == INVALID_HANDLE_VALUE) {
        DWORD missing_error = GetLastError();
        if (missing_error == ERROR_FILE_NOT_FOUND || missing_error == ERROR_PATH_NOT_FOUND) {
          return SQLITE_OK;
        }
      } else {
        CloseHandle(unowned);
      }
      return SQLITE_IOERR_DELETE;
    }
    expected = &expected_sidecar;
  }
  handle = logic_engine_win_open_relative(role->anchor.parent, relative_name,
      DELETE | FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      FILE_OPEN, FILE_NON_DIRECTORY_FILE, FILE_ATTRIBUTE_NORMAL,
      expected, &actual);
  if (handle == INVALID_HANDLE_VALUE) {
    error = GetLastError();
    if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND) {
      if (!is_main && suffix) {
        (void)probe_win_sidecar_identity_remove(role_index, suffix, expected);
      }
      return SQLITE_OK;
    }
    return SQLITE_IOERR_DELETE;
  }
  if (!is_main && probe_win_identity_is_registered_database(&actual)) {
    CloseHandle(handle);
    return SQLITE_IOERR_DELETE;
  }
  disposition.DeleteFile = TRUE;
  if (!SetFileInformationByHandle(handle, FileDispositionInfo,
                                  &disposition, sizeof(disposition))) {
    CloseHandle(handle);
    return SQLITE_IOERR_DELETE;
  }
  CloseHandle(handle);
  if (!is_main) (void)probe_win_sidecar_identity_remove(role_index, suffix, expected);
  return SQLITE_OK;
}
#endif

static int probe_xDelete(sqlite3_vfs *vfs, const char *name, int sync_dir) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
#ifdef _WIN32
  int role_index = -1, is_main = 0, matched;
  wchar_t *relative_name = NULL;
  (void)sync_dir;
  if (name) {
    matched = probe_win_path_role(name, &role_index, &relative_name, &is_main);
    if (matched < 0) return SQLITE_IOERR_DELETE;
    if (matched > 0) {
      int rc = probe_win_delete_role(role_index, relative_name, is_main);
      sqlite3_free(relative_name);
      return rc;
    }
  }
#else
  int role_index = -1;
  const char *suffix = 0;
  if (name && probe_match_role_entry(name, &role_index, &suffix)) {
    ProbeDatabaseRole *role = &g_database_roles[role_index];
    char relative_name[4096];
    size_t base_length = strlen(role->basename);
    size_t suffix_length = strlen(suffix);
    if (base_length + suffix_length + 1 > sizeof(relative_name)) return SQLITE_IOERR_DELETE;
    if (!probe_posix_parent_is_protected(role->trusted_parent_fd)) {
      return SQLITE_IOERR_DELETE;
    }
    memcpy(relative_name, role->basename, base_length);
    memcpy(relative_name + base_length, suffix, suffix_length + 1);
    if (unlinkat(role->trusted_parent_fd, relative_name, 0) != 0) {
      if (errno == ENOENT) {
        if (suffix[0] != '\\0') {
          int kind = strcmp(suffix, "-wal") == 0 ? 1
            : strcmp(suffix, "-shm") == 0 ? 2
            : strcmp(suffix, "-journal") == 0 ? 3 : 0;
          probe_registry_lock();
          for (int i = 0; i < g_sidecar_identity_count; ++i) {
            if (g_sidecar_identities[i].role_index == role_index
                && g_sidecar_identities[i].kind == kind) {
              g_sidecar_identity_count--;
              if (i < g_sidecar_identity_count) memmove(&g_sidecar_identities[i],
                &g_sidecar_identities[i + 1],
                (size_t)(g_sidecar_identity_count - i) * sizeof(g_sidecar_identities[0]));
              break;
            }
          }
          probe_registry_unlock();
        }
        return SQLITE_OK;
      }
      return SQLITE_IOERR_DELETE;
    }
    if (suffix[0] != '\\0') {
      int kind = strcmp(suffix, "-wal") == 0 ? 1
        : strcmp(suffix, "-shm") == 0 ? 2
        : strcmp(suffix, "-journal") == 0 ? 3 : 0;
      probe_registry_lock();
      for (int i = 0; i < g_sidecar_identity_count; ++i) {
        if (g_sidecar_identities[i].role_index == role_index
            && g_sidecar_identities[i].kind == kind) {
          g_sidecar_identity_count--;
          if (i < g_sidecar_identity_count) memmove(&g_sidecar_identities[i],
            &g_sidecar_identities[i + 1],
            (size_t)(g_sidecar_identity_count - i) * sizeof(g_sidecar_identities[0]));
          break;
        }
      }
      probe_registry_unlock();
    }
    if (sync_dir && fsync(role->trusted_parent_fd) != 0) return SQLITE_IOERR_DIR_FSYNC;
    return SQLITE_OK;
  }
#endif
  return p->xDelete(p, name, sync_dir);
}
static int probe_xAccess(sqlite3_vfs *vfs, const char *name, int flags, int *result) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
#ifdef _WIN32
  int role_index = -1, is_main = 0, matched;
  wchar_t *relative_name = NULL;
  if (name) {
    matched = probe_win_path_role(name, &role_index, &relative_name, &is_main);
    if (matched < 0) return SQLITE_IOERR_ACCESS;
    if (matched > 0) {
      int rc = probe_win_access_role(role_index, relative_name, is_main, flags, result);
      sqlite3_free(relative_name);
      return rc;
    }
  }
#else
  int role_index = -1;
  const char *suffix = 0;
  if (name && probe_match_role_entry(name, &role_index, &suffix)) {
    ProbeDatabaseRole *role = &g_database_roles[role_index];
    char relative_name[4096];
    struct stat info;
    size_t base_length = strlen(role->basename);
    size_t suffix_length = strlen(suffix);
    int mode = F_OK;
    if (base_length + suffix_length + 1 > sizeof(relative_name)) return SQLITE_IOERR_ACCESS;
    memcpy(relative_name, role->basename, base_length);
    memcpy(relative_name + base_length, suffix, suffix_length + 1);
    if (fstatat(role->trusted_parent_fd, relative_name, &info, AT_SYMLINK_NOFOLLOW) != 0) {
      if (errno == ENOENT || errno == ENOTDIR || errno == EACCES) {
        *result = 0;
        return SQLITE_OK;
      }
      return SQLITE_IOERR_ACCESS;
    }
    if (S_ISLNK(info.st_mode)) {
      *result = 0;
      return SQLITE_OK;
    }
    if (flags == SQLITE_ACCESS_READWRITE) mode = R_OK | W_OK;
    else if (flags == SQLITE_ACCESS_READ) mode = R_OK;
    if (faccessat(role->trusted_parent_fd, relative_name, mode, AT_EACCESS) == 0) {
      *result = 1;
      return SQLITE_OK;
    }
    if (errno == ENOENT || errno == ENOTDIR || errno == EACCES) {
      *result = 0;
      return SQLITE_OK;
    }
    return SQLITE_IOERR_ACCESS;
  }
#endif
  return p->xAccess(p, name, flags, result);
}
static int probe_xFullPathname(sqlite3_vfs *vfs, const char *name, int n, char *out) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xFullPathname(p, name, n, out);
}
static void *probe_xDlOpen(sqlite3_vfs *vfs, const char *name) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xDlOpen ? p->xDlOpen(p, name) : 0;
}
static void probe_xDlError(sqlite3_vfs *vfs, int n, char *out) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  if (p->xDlError) p->xDlError(p, n, out);
  else if (n > 0) out[0] = '\0';
}
static void (*probe_xDlSym(sqlite3_vfs *vfs, void *handle, const char *symbol))(void) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xDlSym ? p->xDlSym(p, handle, symbol) : 0;
}
static void probe_xDlClose(sqlite3_vfs *vfs, void *handle) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  if (p->xDlClose) p->xDlClose(p, handle);
}
static int probe_xRandomness(sqlite3_vfs *vfs, int n, char *out) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xRandomness(p, n, out);
}
static int probe_xSleep(sqlite3_vfs *vfs, int microseconds) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xSleep(p, microseconds);
}
static int probe_xCurrentTime(sqlite3_vfs *vfs, double *time_value) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xCurrentTime(p, time_value);
}
static int probe_xGetLastError(sqlite3_vfs *vfs, int n, char *out) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xGetLastError ? p->xGetLastError(p, n, out) : 0;
}
static int probe_xCurrentTimeInt64(sqlite3_vfs *vfs, sqlite3_int64 *time_value) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xCurrentTimeInt64
    ? p->xCurrentTimeInt64(p, time_value)
    : SQLITE_NOTFOUND;
}
static int probe_xSetSystemCall(sqlite3_vfs *vfs, const char *name, sqlite3_syscall_ptr call) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  if (name && g_open_syscall_name && strcmp(name, g_open_syscall_name) == 0) {
    return SQLITE_PERM;
  }
#ifndef _WIN32
  if (name && strcmp(name, "stat") == 0) return SQLITE_PERM;
#endif
  return p->xSetSystemCall ? p->xSetSystemCall(p, name, call) : SQLITE_NOTFOUND;
}
static sqlite3_syscall_ptr probe_xGetSystemCall(sqlite3_vfs *vfs, const char *name) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xGetSystemCall ? p->xGetSystemCall(p, name) : 0;
}
static const char *probe_xNextSystemCall(sqlite3_vfs *vfs, const char *name) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xNextSystemCall ? p->xNextSystemCall(p, name) : 0;
}

static void probe_hook_protection(sqlite3_context *context, int argc, sqlite3_value **argv) {
  int open_rc;
  int protected_ok;
  (void)argc;
  (void)argv;
  open_rc = g_probe_vfs.xSetSystemCall(
    &g_probe_vfs, g_open_syscall_name, g_original_open_syscall
  );
#ifdef _WIN32
  protected_ok = open_rc == SQLITE_PERM
    && g_parent_vfs->xGetSystemCall(g_parent_vfs, g_open_syscall_name)
      == (sqlite3_syscall_ptr)probe_create_file_w;
#else
  {
    int stat_rc = g_probe_vfs.xSetSystemCall(
      &g_probe_vfs, "stat", g_original_stat_syscall
    );
    protected_ok = open_rc == SQLITE_PERM && stat_rc == SQLITE_PERM
      && g_parent_vfs->xGetSystemCall(g_parent_vfs, g_open_syscall_name)
        == (sqlite3_syscall_ptr)probe_open
      && g_parent_vfs->xGetSystemCall(g_parent_vfs, "stat")
        == (sqlite3_syscall_ptr)probe_stat;
  }
#endif
  sqlite3_result_int(context, protected_ok);
}

static void probe_open_count(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context, probe_counter_read(&g_main_db_open_count));
}

static void probe_wal_open_count(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context, probe_counter_read(&g_wal_open_count));
}

static void probe_journal_open_count(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context, probe_counter_read(&g_journal_open_count));
}

static void probe_native_open_count(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context, probe_counter_read(&g_native_open_count));
}
static void probe_identity_reject_count(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context, probe_counter_read(&g_identity_reject_count));
}
static void probe_race_injection_count(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context, probe_counter_read(&g_race_injection_count));
}
static void probe_sidecar_identity_check_count(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context, probe_counter_read(&g_sidecar_identity_check_count));
}
static void probe_sidecar_identity_reject_count(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context, probe_counter_read(&g_sidecar_identity_reject_count));
}
static void probe_reused_descriptor_accept_count(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context, probe_counter_read(&g_reused_descriptor_accept_count));
}

#ifndef _WIN32
static int probe_posix_parent_is_protected(int parent_fd) {
  struct stat info;
  /*
   * POSIX has no portable unlink-by-file-descriptor primitive. The probe
   * therefore permits protected-role deletion only when the pinned parent
   * directory cannot be modified by a different UID: it must be owned by
   * this process and have no group/other write bits. Same-UID and privileged
   * attackers remain outside this probe policy and require a protected
   * quarantine design before production use.
   */
  return fstat(parent_fd, &info) == 0
    && S_ISDIR(info.st_mode)
    && info.st_uid == geteuid()
    && (info.st_mode & (S_IWGRP | S_IWOTH)) == 0;
}

static int probe_open_directory_chain(const char *path) {
  typedef int (*probe_register_open_fn)(const char *, int, int);
  probe_register_open_fn native_open = (probe_register_open_fn)g_original_open_syscall;
  char *copy;
  char *cursor;
  int current_fd;
  int directory_flags = O_RDONLY | O_DIRECTORY | O_NOFOLLOW
#ifdef O_CLOEXEC
    | O_CLOEXEC
#endif
    ;
  if (!path || path[0] != '/' || !native_open) {
    errno = EINVAL;
    return -1;
  }
  copy = sqlite3_mprintf("%s", path);
  if (!copy) {
    errno = ENOMEM;
    return -1;
  }
  current_fd = native_open("/", directory_flags, 0);
  if (current_fd < 0) {
    sqlite3_free(copy);
    return -1;
  }
  cursor = copy;
  while (*cursor) {
    char *end;
    char saved;
    int next_fd;
    struct stat info;
    while (*cursor == '/') cursor++;
    if (!*cursor) break;
    end = strchr(cursor, '/');
    saved = end ? *end : '\0';
    if (end) *end = '\0';
    if (strcmp(cursor, ".") == 0 || strcmp(cursor, "..") == 0 || !cursor[0]) {
      close(current_fd);
      sqlite3_free(copy);
      errno = EACCES;
      return -1;
    }
    next_fd = openat(current_fd, cursor, directory_flags, 0);
    if (end) *end = saved;
    if (next_fd < 0 || fstat(next_fd, &info) != 0 || !S_ISDIR(info.st_mode)) {
      if (next_fd >= 0) close(next_fd);
      close(current_fd);
      sqlite3_free(copy);
      errno = EACCES;
      return -1;
    }
    close(current_fd);
    current_fd = next_fd;
    if (!end) break;
    cursor = end + 1;
  }
  sqlite3_free(copy);
  return current_fd;
}
#endif

static int probe_capture_role_identity(const char *path, ProbeDatabaseRole *captured) {
#ifdef _WIN32
  wchar_t *wide_path = probe_utf8_to_wide(path);
  HANDLE handle;
  DWORD file_attributes = 0;
  if (!wide_path) return 0;
  if (!logic_engine_win_anchor_path(wide_path, &captured->anchor)) {
    sqlite3_free(wide_path);
    return 0;
  }
  sqlite3_free(wide_path);
  handle = logic_engine_win_open_relative(captured->anchor.parent,
    captured->anchor.basename,
    GENERIC_READ | GENERIC_WRITE,
    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
    FILE_OPEN_IF, FILE_NON_DIRECTORY_FILE, FILE_ATTRIBUTE_NORMAL,
    NULL, &captured->identity);
  if (handle == INVALID_HANDLE_VALUE) {
    logic_engine_win_anchor_close(&captured->anchor);
    return 0;
  }
  if (!logic_engine_win_identity(handle, &captured->identity, &file_attributes)
      || (file_attributes & FILE_ATTRIBUTE_DIRECTORY) != 0) {
    CloseHandle(handle);
    logic_engine_win_anchor_close(&captured->anchor);
    return 0;
  }
  captured->trusted_handle = handle;
  captured->identity_set = 1;
  return 1;
#else
  typedef int (*probe_register_open_fn)(const char *, int, int);
  int flags = O_RDWR | O_CREAT;
  int fd;
  int parent_fd;
  struct stat info;
  char *parent_path = 0;
  char *basename = 0;
  char *separator;
#ifndef O_NOFOLLOW
  (void)path;
  (void)captured;
  return 0;
#else
  flags |= O_NOFOLLOW;
#endif
#ifdef O_CLOEXEC
  flags |= O_CLOEXEC;
#endif
  parent_path = sqlite3_mprintf("%s", path);
  if (!parent_path) return 0;
  separator = strrchr(parent_path, '/');
  if (!separator) {
    basename = sqlite3_mprintf("%s", parent_path);
    sqlite3_free(parent_path);
    parent_path = sqlite3_mprintf(".");
  } else {
    basename = sqlite3_mprintf("%s", separator + 1);
    if (separator == parent_path) separator[1] = '\0';
    else *separator = '\0';
  }
  if (!parent_path || !basename || !basename[0] || !parent_path[0]) {
    sqlite3_free(parent_path);
    sqlite3_free(basename);
    return 0;
  }
  parent_fd = probe_open_directory_chain(parent_path);
  sqlite3_free(parent_path);
  if (parent_fd < 0) {
    sqlite3_free(basename);
    return 0;
  }
  /*
   * Refuse enrollment in a directory where another UID can replace entries.
   * This is an explicit probe policy, not a substitute for a persistent
   * trusted-directory manifest or same-UID attacker isolation.
   */
  if (!probe_posix_parent_is_protected(parent_fd)) {
    close(parent_fd);
    sqlite3_free(basename);
    errno = EACCES;
    return 0;
  }
  fd = openat(parent_fd, basename, flags, 0600);
  if (fd < 0) {
    close(parent_fd);
    sqlite3_free(basename);
    return 0;
  }
  {
    int ok = fstat(fd, &info) == 0
      && S_ISREG(info.st_mode)
      && info.st_dev != 0
      && info.st_ino != 0;
    if (ok) {
      captured->device = info.st_dev;
      captured->inode = info.st_ino;
      captured->trusted_fd = fd;
      captured->trusted_parent_fd = parent_fd;
      captured->basename = basename;
      captured->identity_set = 1;
      return 1;
    }
    close(fd);
    close(parent_fd);
    sqlite3_free(basename);
    return 0;
  }
#endif
}

static void probe_close_captured_role_identity(ProbeDatabaseRole *captured) {
#ifdef _WIN32
  if (captured->trusted_handle && captured->trusted_handle != INVALID_HANDLE_VALUE) {
    CloseHandle(captured->trusted_handle);
    captured->trusted_handle = INVALID_HANDLE_VALUE;
  }
  logic_engine_win_anchor_close(&captured->anchor);
#else
  if (captured->trusted_fd >= 0) {
    close(captured->trusted_fd);
    captured->trusted_fd = -1;
  }
  if (captured->trusted_parent_fd >= 0) {
    close(captured->trusted_parent_fd);
    captured->trusted_parent_fd = -1;
  }
  sqlite3_free(captured->basename);
  captured->basename = 0;
#endif
}

static void probe_register_database_role(sqlite3_context *context, int argc, sqlite3_value **argv) {
  const unsigned char *path = sqlite3_value_text(argv[0]);
  const unsigned char *role_name = sqlite3_value_text(argv[1]);
  char *full_path;
  char *stored_path;
  char *stored_role;
  int path_length;
  int duplicate = 0;
  int duplicate_identity = 0;
  int full = 0;
  ProbeDatabaseRole captured_role;
  memset(&captured_role, 0, sizeof(captured_role));
#ifdef _WIN32
  captured_role.trusted_handle = INVALID_HANDLE_VALUE;
  captured_role.anchor.parent = INVALID_HANDLE_VALUE;
  captured_role.anchor.basename = NULL;
#else
  captured_role.trusted_fd = -1;
  captured_role.trusted_parent_fd = -1;
#endif
  (void)argc;
  if (!path || !role_name || !path[0] || !role_name[0]) {
    sqlite3_result_error(context, "database path and role are required", -1);
    return;
  }
  path_length = g_parent_vfs->mxPathname + 1;
  full_path = (char *)sqlite3_malloc64((sqlite3_uint64)path_length);
  if (!full_path) {
    sqlite3_result_error_nomem(context);
    return;
  }
  if (g_parent_vfs->xFullPathname(g_parent_vfs, (const char *)path,
        path_length, full_path) != SQLITE_OK) {
    sqlite3_free(full_path);
    sqlite3_result_error(context, "database path could not be canonicalized", -1);
    return;
  }
  stored_path = sqlite3_mprintf("%s", full_path);
  stored_role = sqlite3_mprintf("%s", (const char *)role_name);
  sqlite3_free(full_path);
  if (!stored_path || !stored_role) {
    sqlite3_free(stored_path);
    sqlite3_free(stored_role);
    sqlite3_result_error_nomem(context);
    return;
  }

  if (!probe_capture_role_identity(stored_path, &captured_role)) {
    sqlite3_free(stored_path);
    sqlite3_free(stored_role);
    sqlite3_result_error(context, "database role identity capture failed", -1);
    return;
  }

  probe_registry_lock();
  if (g_database_role_count >= PROBE_MAX_DATABASE_ROLES) full = 1;
  for (int i = 0; !full && i < g_database_role_count; i++) {
    ProbeDatabaseRole *other = &g_database_roles[i];
    if (strcmp(stored_path, other->path) == 0
        || strcmp(stored_role, other->role) == 0) {
      duplicate = 1;
      break;
    }
#ifdef _WIN32
    if (logic_engine_win_identity_equal(&captured_role.identity, &other->identity)) duplicate_identity = 1;
#else
    if (captured_role.device == other->device
        && captured_role.inode == other->inode) duplicate_identity = 1;
#endif
  }
  if (!full && !duplicate && !duplicate_identity) {
    ProbeDatabaseRole *entry = &g_database_roles[g_database_role_count];
    entry->path = stored_path;
    entry->role = stored_role;
#ifdef _WIN32
    entry->identity = captured_role.identity;
    entry->anchor = captured_role.anchor;
    entry->trusted_handle = captured_role.trusted_handle;
    captured_role.anchor.parent = INVALID_HANDLE_VALUE;
    captured_role.anchor.basename = NULL;
    captured_role.trusted_handle = INVALID_HANDLE_VALUE;
#else
    entry->device = captured_role.device;
    entry->inode = captured_role.inode;
    entry->trusted_fd = captured_role.trusted_fd;
    entry->trusted_parent_fd = captured_role.trusted_parent_fd;
    entry->basename = captured_role.basename;
#endif
    entry->identity_set = 1;
    g_database_role_count += 1;
  }
  probe_registry_unlock();

  if (full || duplicate || duplicate_identity) {
    probe_close_captured_role_identity(&captured_role);
    sqlite3_free(stored_path);
    sqlite3_free(stored_role);
    sqlite3_result_error(context, full
      ? "database role registry is full"
      : (duplicate_identity
        ? "database role identity is already registered"
        : "database role or path already registered"), -1);
    return;
  }
  sqlite3_result_int(context, 1);
}

static void probe_configure_race(sqlite3_context *context, int argc, sqlite3_value **argv) {
  const unsigned char *path = sqlite3_value_text(argv[0]);
  const unsigned char *target = sqlite3_value_text(argv[1]);
  if (!path || !target || !path[0] || !target[0]) {
    sqlite3_result_error(context, "race paths are required", -1);
    return;
  }
  {
    int path_length = g_parent_vfs->mxPathname + 1;
    char *full_path = (char *)sqlite3_malloc64((sqlite3_uint64)path_length);
    char *full_target = (char *)sqlite3_malloc64((sqlite3_uint64)path_length);
    if (!full_path || !full_target) {
      sqlite3_free(full_path);
      sqlite3_free(full_target);
      sqlite3_result_error_nomem(context);
      return;
    }
    if (g_parent_vfs->xFullPathname(g_parent_vfs, (const char *)path,
          path_length, full_path) != SQLITE_OK
        || g_parent_vfs->xFullPathname(g_parent_vfs, (const char *)target,
          path_length, full_target) != SQLITE_OK) {
      sqlite3_free(full_path);
      sqlite3_free(full_target);
      sqlite3_result_error(context, "race paths could not be canonicalized", -1);
      return;
    }
    if (!g_race_path || strcmp(g_race_path, full_path) != 0) {
      g_race_identity_set = 0;
#ifdef _WIN32
      memset(&g_race_identity, 0, sizeof(g_race_identity));
#else
      g_race_device = 0;
      g_race_inode = 0;
#endif
    }
    sqlite3_free(g_race_path);
    sqlite3_free(g_race_target_path);
    g_race_path = sqlite3_mprintf("%s", full_path);
    g_race_target_path = sqlite3_mprintf("%s", full_target);
    sqlite3_free(full_path);
    sqlite3_free(full_target);
    if (!g_race_path || !g_race_target_path) {
      sqlite3_result_error_nomem(context);
      return;
    }
  }
  g_race_inject_once = sqlite3_value_int(argv[2]) != 0;
  sqlite3_result_int(context, 1);
}

static void probe_has_syscall(sqlite3_context *context, int argc, sqlite3_value **argv) {
  const unsigned char *name;
  (void)argc;
  name = sqlite3_value_text(argv[0]);
  sqlite3_result_int(
    context,
    name && g_parent_vfs && g_parent_vfs->xGetSystemCall
      && g_parent_vfs->xGetSystemCall(g_parent_vfs, (const char *)name) != 0
  );
}

static int probe_auto_extension(sqlite3 *db, char **error, const sqlite3_api_routines *api) {
  (void)error;
  SQLITE_EXTENSION_INIT2(api);
  int rc = sqlite3_create_function(
    db,
    "logic_engine_vfs_probe_open_count",
    0,
    SQLITE_UTF8 | SQLITE_DETERMINISTIC,
    0,
    probe_open_count,
    0,
    0
  );
  if (rc != SQLITE_OK) return rc;
  rc = sqlite3_create_function(db, "logic_engine_vfs_probe_wal_open_count", 0,
    SQLITE_UTF8 | SQLITE_DETERMINISTIC, 0, probe_wal_open_count, 0, 0);
  if (rc != SQLITE_OK) return rc;
  rc = sqlite3_create_function(db, "logic_engine_vfs_probe_journal_open_count", 0,
    SQLITE_UTF8 | SQLITE_DETERMINISTIC, 0, probe_journal_open_count, 0, 0);
  if (rc != SQLITE_OK) return rc;
  rc = sqlite3_create_function(
    db,
    "logic_engine_vfs_probe_native_open_count",
    0,
    SQLITE_UTF8 | SQLITE_DETERMINISTIC,
    0,
    probe_native_open_count,
    0,
    0
  );
  if (rc != SQLITE_OK) return rc;
  rc = sqlite3_create_function(db, "logic_engine_vfs_probe_identity_reject_count", 0,
    SQLITE_UTF8 | SQLITE_DETERMINISTIC, 0, probe_identity_reject_count, 0, 0);
  if (rc != SQLITE_OK) return rc;
  rc = sqlite3_create_function(db, "logic_engine_vfs_probe_race_injection_count", 0,
    SQLITE_UTF8 | SQLITE_DETERMINISTIC, 0, probe_race_injection_count, 0, 0);
  if (rc != SQLITE_OK) return rc;
  rc = sqlite3_create_function(db, "logic_engine_vfs_probe_sidecar_identity_check_count", 0,
    SQLITE_UTF8 | SQLITE_DETERMINISTIC, 0, probe_sidecar_identity_check_count, 0, 0);
  if (rc != SQLITE_OK) return rc;
  rc = sqlite3_create_function(db, "logic_engine_vfs_probe_sidecar_identity_reject_count", 0,
    SQLITE_UTF8 | SQLITE_DETERMINISTIC, 0, probe_sidecar_identity_reject_count, 0, 0);
  if (rc != SQLITE_OK) return rc;
  rc = sqlite3_create_function(db, "logic_engine_vfs_probe_reused_descriptor_accept_count", 0,
    SQLITE_UTF8 | SQLITE_DETERMINISTIC, 0, probe_reused_descriptor_accept_count, 0, 0);
  if (rc != SQLITE_OK) return rc;
  rc = sqlite3_create_function(db, "logic_engine_vfs_probe_configure_race", 3,
    SQLITE_UTF8, 0, probe_configure_race, 0, 0);
  if (rc != SQLITE_OK) return rc;
  rc = sqlite3_create_function(db, "logic_engine_vfs_probe_register_database_role", 2,
    SQLITE_UTF8, 0, probe_register_database_role, 0, 0);
  if (rc != SQLITE_OK) return rc;
  rc = sqlite3_create_function(db, "logic_engine_vfs_probe_hook_protection", 0,
    SQLITE_UTF8 | SQLITE_DETERMINISTIC, 0, probe_hook_protection, 0, 0);
  if (rc != SQLITE_OK) return rc;
  return sqlite3_create_function(
    db,
    "logic_engine_vfs_probe_has_syscall",
    1,
    SQLITE_UTF8 | SQLITE_DETERMINISTIC,
    0,
    probe_has_syscall,
    0,
    0
  );
}

#ifdef _WIN32
__declspec(dllexport)
#endif
int sqlite3_secure_vfs_probe_init(
  sqlite3 *db,
  char **error,
  const sqlite3_api_routines *api
) {
  int rc;
  (void)db;
  (void)error;
  SQLITE_EXTENSION_INIT2(api);

  if (!g_registry_mutex) {
    g_registry_mutex = sqlite3_mutex_alloc(SQLITE_MUTEX_STATIC_APP1);
    if (!g_registry_mutex) return SQLITE_ERROR;
  }
  if (g_registered) return SQLITE_OK_LOAD_PERMANENTLY;
  g_parent_vfs = sqlite3_vfs_find(0);
  if (!g_parent_vfs || g_parent_vfs->iVersion < 3
      || !g_parent_vfs->xGetSystemCall || !g_parent_vfs->xSetSystemCall) {
    return SQLITE_ERROR;
  }

#ifdef _WIN32
  g_open_syscall_name = "CreateFileW";
#else
  g_open_syscall_name = "open";
  g_original_stat_syscall = g_parent_vfs->xGetSystemCall(g_parent_vfs, "stat");
  if (!g_original_stat_syscall) return SQLITE_ERROR;
  rc = g_parent_vfs->xSetSystemCall(
    g_parent_vfs, "stat", (sqlite3_syscall_ptr)probe_stat
  );
  if (rc != SQLITE_OK) return rc;
#endif
  g_original_open_syscall = g_parent_vfs->xGetSystemCall(
    g_parent_vfs, g_open_syscall_name
  );
  if (!g_original_open_syscall) {
#ifndef _WIN32
    g_parent_vfs->xSetSystemCall(g_parent_vfs, "stat", g_original_stat_syscall);
#endif
    return SQLITE_ERROR;
  }
#ifdef _WIN32
  rc = g_parent_vfs->xSetSystemCall(
    g_parent_vfs, g_open_syscall_name, (sqlite3_syscall_ptr)probe_create_file_w
  );
#else
  rc = g_parent_vfs->xSetSystemCall(
    g_parent_vfs, g_open_syscall_name, (sqlite3_syscall_ptr)probe_open
  );
#endif
  if (rc != SQLITE_OK) {
#ifndef _WIN32
    g_parent_vfs->xSetSystemCall(g_parent_vfs, "stat", g_original_stat_syscall);
#endif
    return rc;
  }

  memset(&g_probe_vfs, 0, sizeof(g_probe_vfs));
  g_probe_vfs.iVersion = g_parent_vfs->iVersion;
  g_probe_vfs.szOsFile = g_parent_vfs->szOsFile;
  g_probe_vfs.mxPathname = g_parent_vfs->mxPathname;
  g_probe_vfs.zName = "logic-engine-vfs-registration-probe";
  g_probe_vfs.pAppData = g_parent_vfs;
  g_probe_vfs.xOpen = probe_xOpen;
  g_probe_vfs.xDelete = probe_xDelete;
  g_probe_vfs.xAccess = probe_xAccess;
  g_probe_vfs.xFullPathname = probe_xFullPathname;
  g_probe_vfs.xDlOpen = probe_xDlOpen;
  g_probe_vfs.xDlError = probe_xDlError;
  g_probe_vfs.xDlSym = probe_xDlSym;
  g_probe_vfs.xDlClose = probe_xDlClose;
  g_probe_vfs.xRandomness = probe_xRandomness;
  g_probe_vfs.xSleep = probe_xSleep;
  g_probe_vfs.xCurrentTime = probe_xCurrentTime;
  g_probe_vfs.xGetLastError = probe_xGetLastError;
  if (g_parent_vfs->iVersion >= 2) {
    g_probe_vfs.xCurrentTimeInt64 = probe_xCurrentTimeInt64;
  }
  if (g_parent_vfs->iVersion >= 3) {
    g_probe_vfs.xSetSystemCall = probe_xSetSystemCall;
    g_probe_vfs.xGetSystemCall = probe_xGetSystemCall;
    g_probe_vfs.xNextSystemCall = probe_xNextSystemCall;
  }

  rc = sqlite3_vfs_register(&g_probe_vfs, 1);
  if (rc != SQLITE_OK) {
    g_parent_vfs->xSetSystemCall(g_parent_vfs, g_open_syscall_name, g_original_open_syscall);
#ifndef _WIN32
    g_parent_vfs->xSetSystemCall(g_parent_vfs, "stat", g_original_stat_syscall);
#endif
    return rc;
  }
  rc = sqlite3_auto_extension((void (*)(void))probe_auto_extension);
  if (rc != SQLITE_OK) {
    sqlite3_vfs_unregister(&g_probe_vfs);
    g_parent_vfs->xSetSystemCall(g_parent_vfs, g_open_syscall_name, g_original_open_syscall);
#ifndef _WIN32
    g_parent_vfs->xSetSystemCall(g_parent_vfs, "stat", g_original_stat_syscall);
#endif
    return rc;
  }

  g_registered = 1;
  return SQLITE_OK_LOAD_PERMANENTLY;
}
