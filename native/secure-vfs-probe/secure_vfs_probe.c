/*
 * Logic-Engine SQLite VFS registration probe.
 *
 * This is deliberately NOT a production secure VFS. It delegates SQLite file
 * operations to the default VFS, while test-only syscall wrappers inspect the
 * OS object opened for one configured database path and inject a deterministic
 * hardlink replacement immediately before that open. It proves a narrow
 * identity-checking technique on the pinned Node/SQLite build; it does not
 * provide a complete role registry, sidecar identity policy, or production
 * startup contract. Never use this probe for production databases.
 */
#include <string.h>
#include <stdint.h>
#include <errno.h>
#ifdef _WIN32
#include <windows.h>
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
static const char *g_open_syscall_name = 0;
static sqlite3_syscall_ptr g_original_open_syscall = 0;
static char *g_race_path = 0;
static char *g_race_target_path = 0;
static int g_race_identity_set = 0;
static int g_race_inject_once = 0;
static int g_race_injection_count = 0;
static int g_identity_reject_count = 0;
#ifdef _WIN32
static DWORD g_race_volume_serial = 0;
static DWORD g_race_file_index_high = 0;
static DWORD g_race_file_index_low = 0;
__declspec(thread) static int g_current_race_open = 0;
__declspec(thread) static int g_current_race_captured = 0;
#else
static dev_t g_race_device = 0;
static ino_t g_race_inode = 0;
static _Thread_local int g_current_race_open = 0;
static _Thread_local int g_current_race_captured = 0;
#endif

#ifdef _WIN32
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
typedef HANDLE (WINAPI *probe_create_file_w_fn)(
  LPCWSTR, DWORD, DWORD, LPSECURITY_ATTRIBUTES, DWORD, DWORD, HANDLE
);
static HANDLE WINAPI probe_create_file_w(
  LPCWSTR name, DWORD access, DWORD share, LPSECURITY_ATTRIBUTES security,
  DWORD creation, DWORD attributes, HANDLE template_file
) {
  HANDLE handle;
  BY_HANDLE_FILE_INFORMATION info;
  g_native_open_count += 1;
  if (g_current_race_open && !g_current_race_captured) {
    attributes |= FILE_FLAG_OPEN_REPARSE_POINT;
  }
  handle = ((probe_create_file_w_fn)g_original_open_syscall)(
    name, access, share, security, creation, attributes, template_file
  );
  if (handle == INVALID_HANDLE_VALUE) return handle;
  if (g_current_race_open && !g_current_race_captured) {
    if (!GetFileInformationByHandle(handle, &info)
        || (info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0
        || (info.nFileIndexHigh == 0 && info.nFileIndexLow == 0)) {
      CloseHandle(handle);
      g_identity_reject_count += 1;
      SetLastError(ERROR_ACCESS_DENIED);
      return INVALID_HANDLE_VALUE;
    }
    if (g_race_identity_set) {
      if (info.dwVolumeSerialNumber != g_race_volume_serial
          || info.nFileIndexHigh != g_race_file_index_high
          || info.nFileIndexLow != g_race_file_index_low) {
        CloseHandle(handle);
        g_identity_reject_count += 1;
        SetLastError(ERROR_ACCESS_DENIED);
        return INVALID_HANDLE_VALUE;
      }
    } else {
      g_race_volume_serial = info.dwVolumeSerialNumber;
      g_race_file_index_high = info.nFileIndexHigh;
      g_race_file_index_low = info.nFileIndexLow;
      g_race_identity_set = 1;
    }
    g_current_race_captured = 1;
  }
  return handle;
}
#else
static int probe_replace_with_hardlink(const char *path, const char *target) {
  if (unlink(path) != 0) return 0;
  return link(target, path) == 0;
}
typedef int (*probe_open_fn)(const char *, int, int);
static int probe_open(const char *name, int flags, int mode) {
  int fd;
  struct stat info;
  g_native_open_count += 1;
  if (g_current_race_open && !g_current_race_captured) {
#ifdef O_NOFOLLOW
    flags |= O_NOFOLLOW;
#else
    errno = EACCES;
    g_identity_reject_count += 1;
    return -1;
#endif
  }
  fd = ((probe_open_fn)g_original_open_syscall)(name, flags, mode);
  if (fd < 0) return fd;
  if (g_current_race_open && !g_current_race_captured) {
    if (fstat(fd, &info) != 0 || info.st_dev == 0 || info.st_ino == 0) {
      close(fd);
      g_identity_reject_count += 1;
      errno = EACCES;
      return -1;
    }
    if (g_race_identity_set) {
      if (info.st_dev != g_race_device || info.st_ino != g_race_inode) {
        close(fd);
        g_identity_reject_count += 1;
        errno = EACCES;
        return -1;
      }
    } else {
      g_race_device = info.st_dev;
      g_race_inode = info.st_ino;
      g_race_identity_set = 1;
    }
    g_current_race_captured = 1;
  }
  return fd;
}
#endif

static int probe_xOpen(sqlite3_vfs *vfs, const char *name, sqlite3_file *file,
                       int flags, int *out_flags) {
  sqlite3_vfs *parent = (sqlite3_vfs *)vfs->pAppData;
  int is_race_target = name && g_race_path && (flags & SQLITE_OPEN_MAIN_DB)
    && strcmp(name, g_race_path) == 0;
  int rc;
  if (is_race_target) {
    g_current_race_open = 1;
    g_current_race_captured = 0;
    if (g_race_inject_once) {
      g_race_inject_once = 0;
      if (!probe_replace_with_hardlink(name, g_race_target_path)) {
        g_current_race_open = 0;
        return SQLITE_CANTOPEN;
      }
      g_race_injection_count += 1;
    }
  }
  rc = parent->xOpen(parent, name, file, flags, out_flags);
  if (is_race_target) {
    if (rc == SQLITE_OK && !g_current_race_captured) {
      if (file->pMethods && file->pMethods->xClose) file->pMethods->xClose(file);
      rc = SQLITE_CANTOPEN;
    }
    g_current_race_open = 0;
    g_current_race_captured = 0;
  }
  if (rc == SQLITE_OK) {
    if ((flags & SQLITE_OPEN_MAIN_DB) != 0) g_main_db_open_count += 1;
    if ((flags & SQLITE_OPEN_WAL) != 0) g_wal_open_count += 1;
    if ((flags & SQLITE_OPEN_MAIN_JOURNAL) != 0) g_journal_open_count += 1;
  }
  return rc;
}

static int probe_xDelete(sqlite3_vfs *vfs, const char *name, int sync_dir) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xDelete(p, name, sync_dir);
}
static int probe_xAccess(sqlite3_vfs *vfs, const char *name, int flags, int *result) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
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

static void probe_open_count(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context, g_main_db_open_count);
}

static void probe_wal_open_count(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context, g_wal_open_count);
}

static void probe_journal_open_count(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context, g_journal_open_count);
}

static void probe_native_open_count(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context, g_native_open_count);
}
static void probe_identity_reject_count(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context, g_identity_reject_count);
}
static void probe_race_injection_count(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context, g_race_injection_count);
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
  rc = sqlite3_create_function(db, "logic_engine_vfs_probe_configure_race", 3,
    SQLITE_UTF8, 0, probe_configure_race, 0, 0);
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
#endif
  g_original_open_syscall = g_parent_vfs->xGetSystemCall(
    g_parent_vfs, g_open_syscall_name
  );
  if (!g_original_open_syscall) return SQLITE_ERROR;
#ifdef _WIN32
  rc = g_parent_vfs->xSetSystemCall(
    g_parent_vfs, g_open_syscall_name, (sqlite3_syscall_ptr)probe_create_file_w
  );
#else
  rc = g_parent_vfs->xSetSystemCall(
    g_parent_vfs, g_open_syscall_name, (sqlite3_syscall_ptr)probe_open
  );
#endif
  if (rc != SQLITE_OK) return rc;

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
    return rc;
  }
  rc = sqlite3_auto_extension((void (*)(void))probe_auto_extension);
  if (rc != SQLITE_OK) {
    sqlite3_vfs_unregister(&g_probe_vfs);
    g_parent_vfs->xSetSystemCall(g_parent_vfs, g_open_syscall_name, g_original_open_syscall);
    return rc;
  }

  g_registered = 1;
  return SQLITE_OK_LOAD_PERMANENTLY;
}
