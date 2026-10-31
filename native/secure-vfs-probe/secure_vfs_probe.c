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
 * Sidecar ownership records are process-local; retired records are retained
 * when another hardlink survives deletion of the original sidecar pathname.
 * Persistent trust, complete sidecar lifecycle, full VFS operation coverage,
 * startup/recovery integration and independent review remain open. Never use
 * this probe for production databases.
 */
#include <string.h>
#include <stdint.h>
#include <errno.h>
#include <limits.h>
#ifdef _WIN32
#include <windows.h>
#include <wchar.h>
#include "windows_relative_open.h"
#else
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#if defined(__linux__)
#include <sys/socket.h>
#include <sys/un.h>
#include <arpa/inet.h>
#include <stddef.h>
#include "../posix-namespace-broker/broker_protocol.h"
#endif
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
#if defined(__linux__)
static uint64_t g_broker_request_id = 1;
static int g_broker_backend_io_count = 0;
static _Thread_local int g_current_broker_fd = -1;
static _Thread_local int g_current_broker_expected_role = -1;
static _Thread_local int g_current_broker_expected_kind = -1;
static int g_broker_backend_open_fail_count = 0;
static int g_broker_shm_map_count = 0;
static int g_broker_shm_map_fail_count = 0;
static int g_broker_shm_lock_count = 0;
static int g_broker_shm_lock_fail_count = 0;
static int g_shm_open_hook_count = 0;
static int g_broker_syscall_open_fail_count = 0;
static int g_broker_delete_fail_count = 0;
static int g_broker_access_fail_count = 0;
static int g_sidecar_capture_fail_count = 0;
static int g_parent_xopen_fail_count = 0;
static int g_last_parent_xopen_rc = SQLITE_OK;
#endif
#define PROBE_MAX_PINNED_PATHS 256
typedef struct ProbePinnedPath {
  sqlite3_file *file;
  const sqlite3_io_methods *parent_methods;
  sqlite3_io_methods methods;
  char *path;
} ProbePinnedPath;
static ProbePinnedPath g_pinned_paths[PROBE_MAX_PINNED_PATHS];
static const char *g_open_syscall_name = 0;
static sqlite3_syscall_ptr g_original_open_syscall = 0;
static const char *g_delete_syscall_name = 0;
static sqlite3_syscall_ptr g_original_delete_syscall = 0;
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
#if defined(__linux__)
  char *broker_socket_path;
#endif
#endif
} ProbeDatabaseRole;
static ProbeDatabaseRole g_database_roles[PROBE_MAX_DATABASE_ROLES];
static int g_database_role_count = 0;
#ifdef _WIN32
#define PROBE_MAX_SIDECAR_IDENTITIES (PROBE_MAX_DATABASE_ROLES * 12)
typedef struct ProbeSidecarIdentity {
  int role_index;
  int kind; /* 1 = WAL, 2 = SHM, 3 = rollback journal */
  int retired; /* pathname deleted, but another hardlink may keep the object alive */
  LogicEngineWinFileIdentity identity;
} ProbeSidecarIdentity;
static ProbeSidecarIdentity g_sidecar_identities[PROBE_MAX_SIDECAR_IDENTITIES];
static int g_sidecar_identity_count = 0;
static int g_delete_file_hook_count = 0;
#else
#define PROBE_MAX_SIDECAR_IDENTITIES (PROBE_MAX_DATABASE_ROLES * 12)
typedef struct ProbeSidecarIdentity {
  int role_index;
  int kind; /* 1 = WAL, 2 = SHM, 3 = rollback journal */
  int retired; /* pathname deleted, but another hardlink may keep the object alive */
  dev_t device;
  ino_t inode;
} ProbeSidecarIdentity;
static ProbeSidecarIdentity g_sidecar_identities[PROBE_MAX_SIDECAR_IDENTITIES];
static int g_sidecar_identity_count = 0;
static int g_unlink_hook_count = 0;
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

static int probe_pinned_path_close(sqlite3_file *file) {
  const sqlite3_io_methods *parent_methods = NULL;
  char *path = NULL;
  probe_registry_lock();
  for (int i = 0; i < PROBE_MAX_PINNED_PATHS; ++i) {
    ProbePinnedPath *entry = &g_pinned_paths[i];
    if (entry->file == file) {
      parent_methods = entry->parent_methods;
      path = entry->path;
      file->pMethods = parent_methods;
      memset(entry, 0, sizeof(*entry));
      break;
    }
  }
  probe_registry_unlock();
  if (!parent_methods || !parent_methods->xClose) {
    sqlite3_free(path);
    return SQLITE_IOERR_CLOSE;
  }
  {
    int rc = parent_methods->xClose(file);
    sqlite3_free(path);
    return rc;
  }
}

static int probe_pinned_path_add(sqlite3_file *file, char *path) {
  int added = 0;
  if (!file || !file->pMethods || !path) return 0;
  probe_registry_lock();
  for (int i = 0; i < PROBE_MAX_PINNED_PATHS; ++i) {
    ProbePinnedPath *entry = &g_pinned_paths[i];
    if (!entry->file) {
      entry->file = file;
      entry->parent_methods = file->pMethods;
      entry->methods = *file->pMethods;
      entry->methods.xClose = probe_pinned_path_close;
      entry->path = path;
      file->pMethods = &entry->methods;
      added = 1;
      break;
    }
  }
  probe_registry_unlock();
  return added;
}
#if defined(__linux__)
static int probe_broker_group_member(gid_t group_id) {
  int count;
  gid_t *groups;
  int found = 0;
  if (getegid() == group_id) return 1;
  count = getgroups(0, NULL);
  if (count < 0 || count > 65536) return 0;
  if (count == 0) return 0;
  groups = (gid_t *)sqlite3_malloc64((sqlite3_uint64)count * sizeof(gid_t));
  if (!groups) return 0;
  if (getgroups(count, groups) == count) {
    for (int i = 0; i < count; ++i) {
      if (groups[i] == group_id) {
        found = 1;
        break;
      }
    }
  }
  sqlite3_free(groups);
  return found;
}

static uint64_t probe_broker_hton64(uint64_t value) {
#if defined(__BYTE_ORDER__) && __BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__
  return ((uint64_t)htonl((uint32_t)value) << 32)
    | (uint64_t)htonl((uint32_t)(value >> 32));
#else
  return value;
#endif
}

/* A broker response is accepted only with the exact protocol envelope and FD count. */
static int probe_broker_exchange(
    ProbeDatabaseRole *role, const char *socket_path, uint16_t operation,
    const char *kind, int expect_fd, int *out_fd, uint32_t *out_status) {
  struct sockaddr_un address;
  struct stat socket_info, descriptor_info, parent_info;
  struct leb_request request;
  struct leb_response response;
  struct iovec vectors[2];
  struct msghdr message;
  struct cmsghdr *control;
  char payload[260];
  char response_control[CMSG_SPACE(sizeof(int) * 2)];
  char response_packet[sizeof(response)];
  size_t role_length, payload_length;
  ssize_t sent, received;
  int socket_fd = -1, received_fds[4] = {-1, -1, -1, -1}, fd_count = 0, valid = 0;
  int peer_credentials[3];
  socklen_t credentials_length = (socklen_t)sizeof(peer_credentials);
  if (out_fd) *out_fd = -1;
  if (out_status) *out_status = LEB_STATUS_INTERNAL;
  if (!role || !socket_path || !socket_path[0] || !out_status) return 0;
  role_length = strlen(role->role);
  if (role_length == 0 || role_length > 128) return 0;
  if (kind && (strcmp(kind, "wal") != 0 && strcmp(kind, "shm") != 0
               && strcmp(kind, "journal") != 0 && strcmp(kind, "main") != 0)) return 0;
  payload_length = role_length;
  memcpy(payload, role->role, role_length);
  if (kind) {
    payload[payload_length++] = '\0';
    memcpy(payload + payload_length, kind, strlen(kind));
    payload_length += strlen(kind);
  }
  if (payload_length > sizeof(payload)) return 0;
  if (strlen(socket_path) >= sizeof(address.sun_path)) return 0;
  if (lstat(socket_path, &socket_info) != 0 || !S_ISSOCK(socket_info.st_mode)
      || (socket_info.st_mode & 007) != 0) return 0;
  if (socket_info.st_uid == geteuid()) {
    if ((socket_info.st_mode & 077) != 0) return 0;
  } else if ((socket_info.st_mode & 077) != 020
             || !probe_broker_group_member(socket_info.st_gid)) {
    return 0;
  }

  socket_fd = socket(AF_UNIX, SOCK_SEQPACKET, 0);
  if (socket_fd < 0) return 0;
  if (fcntl(socket_fd, F_SETFD, FD_CLOEXEC) != 0) goto done;
  memset(&address, 0, sizeof(address));
  address.sun_family = AF_UNIX;
  memcpy(address.sun_path, socket_path, strlen(socket_path) + 1);
  if (connect(socket_fd, (struct sockaddr *)&address, sizeof(address)) != 0) goto done;
  if (getsockopt(socket_fd, SOL_SOCKET, SO_PEERCRED,
                 peer_credentials, &credentials_length) != 0
      || credentials_length != sizeof(peer_credentials)
      || peer_credentials[0] <= 0 || (uid_t)peer_credentials[1] != socket_info.st_uid) {
    goto done;
  }

  memset(&request, 0, sizeof(request));
  request.magic = htonl(LEB_PROTOCOL_MAGIC);
  request.version = htons(LEB_PROTOCOL_VERSION);
  request.operation = htons(operation);
  request.flags = htonl(0);
  probe_registry_lock();
  request.request_id = probe_broker_hton64(g_broker_request_id++);
  if (g_broker_request_id == 0) g_broker_request_id = 1;
  probe_registry_unlock();
  request.payload_length = htonl((uint32_t)payload_length);

  memset(&message, 0, sizeof(message));
  vectors[0].iov_base = &request;
  vectors[0].iov_len = sizeof(request);
  vectors[1].iov_base = payload;
  vectors[1].iov_len = payload_length;
  message.msg_iov = vectors;
  message.msg_iovlen = kind ? 2u : 2u;
  sent = sendmsg(socket_fd, &message, 0);
  if (sent != (ssize_t)(sizeof(request) + payload_length)) goto done;

  memset(&message, 0, sizeof(message));
  memset(response_control, 0, sizeof(response_control));
  message.msg_iov = vectors;
  message.msg_iovlen = 1;
  vectors[0].iov_base = response_packet;
  vectors[0].iov_len = sizeof(response_packet);
  message.msg_control = response_control;
  message.msg_controllen = sizeof(response_control);
  received = recvmsg(socket_fd, &message, MSG_CMSG_CLOEXEC);
  if (received != (ssize_t)sizeof(response)) goto done;
  for (control = CMSG_FIRSTHDR(&message); control;
       control = CMSG_NXTHDR(&message, control)) {
    size_t data_length;
    size_t count;
    if (control->cmsg_level != SOL_SOCKET || control->cmsg_type != SCM_RIGHTS
        || control->cmsg_len < CMSG_LEN(0)) goto done;
    data_length = control->cmsg_len - CMSG_LEN(0);
    if (data_length == 0 || data_length % sizeof(int) != 0) goto done;
    count = data_length / sizeof(int);
    for (size_t i = 0; i < count; ++i) {
      int incoming_fd = -1;
      memcpy(&incoming_fd, (const char *)CMSG_DATA(control) + i * sizeof(int),
             sizeof(incoming_fd));
      if (fd_count >= 4) {
        close(incoming_fd);
        goto done;
      }
      received_fds[fd_count++] = incoming_fd;
    }
  }
  if ((message.msg_flags & (MSG_TRUNC | MSG_CTRUNC)) != 0) goto done;
  memcpy(&response, response_packet, sizeof(response));
  if (ntohl(response.magic) != LEB_PROTOCOL_MAGIC
      || ntohs(response.version) != LEB_PROTOCOL_VERSION
      || ntohs(response.operation) != operation
      || response.request_id != request.request_id
      || ntohl(response.payload_length) != 0) goto done;
  *out_status = ntohl(response.status);
  if (*out_status == LEB_STATUS_OK) {
    if (expect_fd != (fd_count == 1)) goto done;
    if (expect_fd) {
      int received_fd = received_fds[0];
      if (received_fd < 0 || fcntl(received_fd, F_SETFD, FD_CLOEXEC) != 0
          || fstat(received_fd, &descriptor_info) != 0
          || !S_ISREG(descriptor_info.st_mode) || descriptor_info.st_nlink != 1) goto done;
      if (role->identity_set && descriptor_info.st_dev != role->device) goto done;
      if (operation == LEB_OP_OPEN_MAIN && role->identity_set
          && (descriptor_info.st_dev != role->device
              || descriptor_info.st_ino != role->inode)) goto done;
      if (out_fd) {
        *out_fd = received_fd;
        received_fds[0] = -1;
      }
    }
  } else if (fd_count != 0) {
    goto done;
  }
  valid = 1;
done:
  for (int i = 0; i < fd_count && i < 4; ++i) {
    if (received_fds[i] >= 0) close(received_fds[i]);
  }
  if (socket_fd >= 0) close(socket_fd);
  return valid;
}
#endif

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
        && g_sidecar_identities[i].kind == kind
        && !g_sidecar_identities[i].retired) {
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
  int matching_identity = 0;
  int reject = !kind || !identity;
  for (int i = 0; !reject && i < g_database_role_count; ++i) {
    if (logic_engine_win_identity_equal(identity, &g_database_roles[i].identity)) reject = 1;
  }
  for (int i = 0; !reject && i < g_sidecar_identity_count; ++i) {
    ProbeSidecarIdentity *entry = &g_sidecar_identities[i];
    int same_identity = logic_engine_win_identity_equal(identity, &entry->identity);
    int same_owner = entry->role_index == role_index && entry->kind == kind;
    if (same_identity) {
      if (same_owner) {
        entry->retired = 0;
        matching_identity = 1;
      } else {
        reject = 1;
      }
    } else if (same_owner && !entry->retired) {
      reject = 1;
    }
  }
  if (!reject && !matching_identity) {
    if (g_sidecar_identity_count >= PROBE_MAX_SIDECAR_IDENTITIES) {
      reject = 1;
    } else {
      ProbeSidecarIdentity *entry = &g_sidecar_identities[g_sidecar_identity_count++];
      entry->role_index = role_index;
      entry->kind = kind;
      entry->retired = 0;
      entry->identity = *identity;
    }
  }
  return !reject;
}

static int probe_win_sidecar_identity_retire(int role_index, const wchar_t *suffix,
                                              const LogicEngineWinFileIdentity *identity,
                                              int keep_record) {
  int kind = probe_win_sidecar_kind(suffix);
  int updated = 0;
  if (!kind || !identity) return 0;
  probe_registry_lock();
  for (int i = 0; i < g_sidecar_identity_count; ++i) {
    ProbeSidecarIdentity *entry = &g_sidecar_identities[i];
    if (entry->role_index == role_index && entry->kind == kind
        && logic_engine_win_identity_equal(identity, &entry->identity)) {
      if (keep_record) {
        entry->retired = 1;
      } else {
        g_sidecar_identity_count -= 1;
        if (i < g_sidecar_identity_count) {
          memmove(&g_sidecar_identities[i], &g_sidecar_identities[i + 1],
            (size_t)(g_sidecar_identity_count - i) * sizeof(g_sidecar_identities[0]));
        }
      }
      updated = 1;
      break;
    }
  }
  probe_registry_unlock();
  return updated;
}

static int probe_win_map_create_file(
  DWORD creation, DWORD attributes, ULONG *disposition,
  ULONG *options, ULONG *file_attributes) {
  /*
   * Keep one reviewed mapping table for the standalone adapter and the actual
   * VFS interception. In particular, destructive dispositions are rejected
   * before an identity-checked handle exists.
   */
  return logic_engine_win_map_create_disposition(creation, disposition)
    && logic_engine_win_map_create_options(attributes, options, file_attributes);
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
    if (handle == INVALID_HANDLE_VALUE && needs_identity) {
    }
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
#if defined(__linux__)
  if (probe_path_is_shm(name)) probe_counter_increment(&g_shm_open_hook_count);
#endif
  int anchored_role_index = -1;
  const char *anchored_suffix = 0;
  int has_anchor = probe_match_role_entry(name, &anchored_role_index, &anchored_suffix);
  int needs_identity = is_sidecar
    || (g_current_race_open && !g_current_race_captured)
    || (g_current_role_index >= 0 && !g_current_role_captured)
    || has_anchor;
  int injected_here = 0;
  int truncate_after_validation = needs_identity && (flags & O_TRUNC) != 0;
  if (truncate_after_validation) flags &= ~O_TRUNC;
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
#if defined(__linux__)
    ProbeDatabaseRole *role = &g_database_roles[anchored_role_index];
    if (role->broker_socket_path) {
      uint16_t operation = LEB_OP_OPEN_MAIN;
      const char *kind = NULL;
      uint32_t status = LEB_STATUS_INTERNAL;
      if (anchored_suffix[0] != '\0') {
        if (strcmp(anchored_suffix, "-wal") == 0) kind = "wal";
        else if (strcmp(anchored_suffix, "-shm") == 0) kind = "shm";
        else if (strcmp(anchored_suffix, "-journal") == 0) kind = "journal";
        else {
          errno = EACCES;
          return -1;
        }
        operation = LEB_OP_OPEN_OR_CREATE_SIDECAR;
      }
      if (!probe_broker_exchange(role, role->broker_socket_path, operation,
                                 kind, 1, &fd, &status)
          || status != LEB_STATUS_OK || fd < 0) {
        probe_counter_increment(&g_broker_syscall_open_fail_count);
        if (fd >= 0) close(fd);
        errno = EACCES;
        return -1;
      }
    } else
#endif
    {
      fd = probe_open_anchored(anchored_role_index, anchored_suffix, flags, mode);
    }
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
    if (!reject && is_sidecar && has_anchor && anchored_suffix[0] != '\0'
        && !g_database_roles[anchored_role_index].broker_socket_path) {
      int kind = strcmp(anchored_suffix, "-wal") == 0 ? 1
        : strcmp(anchored_suffix, "-shm") == 0 ? 2
        : strcmp(anchored_suffix, "-journal") == 0 ? 3 : 0;
      int existing = -1;
      if (kind == 0) reject = 1;
      for (int i = 0; !reject && i < g_sidecar_identity_count; ++i) {
        ProbeSidecarIdentity *entry = &g_sidecar_identities[i];
        int same_identity = entry->device == info.st_dev && entry->inode == info.st_ino;
        int same_owner = entry->role_index == anchored_role_index && entry->kind == kind;
        if (same_identity) {
          if (same_owner) {
            entry->retired = 0;
            existing = i;
          } else {
            reject = 1;
          }
        } else if (same_owner && !entry->retired) {
          reject = 1;
        }
      }
      if (!reject && existing < 0) {
        if (g_sidecar_identity_count >= PROBE_MAX_SIDECAR_IDENTITIES) reject = 1;
        else {
          ProbeSidecarIdentity *entry = &g_sidecar_identities[g_sidecar_identity_count++];
          entry->role_index = anchored_role_index;
          entry->kind = kind;
          entry->retired = 0;
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
  if (truncate_after_validation && ftruncate(fd, 0) != 0) {
    int saved_error = errno;
    close(fd);
    errno = saved_error;
    return -1;
  }
  if (injected_here) {
    g_current_race_open = 0;
    g_current_race_captured = 0;
  }
#if defined(__linux__)
  if (has_anchor && g_database_roles[anchored_role_index].broker_socket_path
      && anchored_role_index == g_current_broker_expected_role) {
    int actual_kind = anchored_suffix[0] == '\0' ? 0
      : strcmp(anchored_suffix, "-wal") == 0 ? 1
      : strcmp(anchored_suffix, "-shm") == 0 ? 2
      : strcmp(anchored_suffix, "-journal") == 0 ? 3 : -1;
    if (actual_kind == g_current_broker_expected_kind) g_current_broker_fd = fd;
  }
#endif
  return fd;
}
typedef int (*probe_stat_fn)(const char *, struct stat *);
static int probe_stat(const char *name, struct stat *info) {
  int rc;
  int anchored_role_index = -1;
  const char *anchored_suffix = 0;
  if (probe_match_role_entry(name, &anchored_role_index, &anchored_suffix)) {
    ProbeDatabaseRole *role = &g_database_roles[anchored_role_index];
#if defined(__linux__)
    if (role->broker_socket_path) {
      const char *kind = anchored_suffix[0] == '\0' ? "main"
        : strcmp(anchored_suffix, "-wal") == 0 ? "wal"
        : strcmp(anchored_suffix, "-shm") == 0 ? "shm"
        : strcmp(anchored_suffix, "-journal") == 0 ? "journal" : NULL;
      uint32_t status = LEB_STATUS_INTERNAL;
      int descriptor = -1;
      uint16_t operation = anchored_suffix[0] == '\0'
        ? LEB_OP_OPEN_MAIN : LEB_OP_OPEN_SIDECAR;
      if (!kind || !probe_broker_exchange(role, role->broker_socket_path,
            LEB_OP_ACCESS_ROLE_FILE, kind, 0, NULL, &status)) {
        errno = EACCES;
        return -1;
      }
      if (status == LEB_STATUS_NOT_FOUND) {
        errno = ENOENT;
        return -1;
      }
      if (status != LEB_STATUS_OK
          || !probe_broker_exchange(role, role->broker_socket_path, operation,
               anchored_suffix[0] == '\0' ? NULL : kind, 1, &descriptor, &status)
          || status != LEB_STATUS_OK || descriptor < 0) {
        if (descriptor >= 0) close(descriptor);
        errno = EACCES;
        return -1;
      }
      if (fstat(descriptor, info) != 0) {
        close(descriptor);
        errno = EACCES;
        return -1;
      }
      close(descriptor);
      rc = 0;
    } else
#endif
    {
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
    }
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

static int probe_xOpen_parent(sqlite3_vfs *vfs, const char *name, sqlite3_file *file,
                              int flags, int *out_flags) {
  sqlite3_vfs *parent = (sqlite3_vfs *)vfs->pAppData;
  int is_sidecar = (flags & (SQLITE_OPEN_WAL | SQLITE_OPEN_MAIN_JOURNAL)) != 0;
  int is_race_target = 0;
  /*
   * This feasibility VFS has no separately pinned temporary-file namespace.
   * Do not silently let SQLite create temp DBs, temp journals, subjournals,
   * super-journals or transient DB files through the parent VFS. Pure
   * SQLITE_OPEN_MEMORY databases remain supported.
   */
  const int unhandled_file_classes = SQLITE_OPEN_TEMP_DB
    | SQLITE_OPEN_TEMP_JOURNAL | SQLITE_OPEN_SUBJOURNAL
    | SQLITE_OPEN_SUPER_JOURNAL | SQLITE_OPEN_TRANSIENT_DB;
  if ((flags & unhandled_file_classes) != 0
      && (flags & SQLITE_OPEN_MEMORY) == 0) {
    return SQLITE_CANTOPEN;
  }
  if ((flags & (SQLITE_OPEN_MAIN_DB | SQLITE_OPEN_WAL | SQLITE_OPEN_MAIN_JOURNAL
        | SQLITE_OPEN_MEMORY)) == 0) {
    return SQLITE_CANTOPEN;
  }
  if (!name && (flags & SQLITE_OPEN_MEMORY) == 0) {
    return SQLITE_CANTOPEN;
  }
  int rc;
  int role_index = -1;
  char *canonical_name = NULL;
  const char *open_name = name;

  /*
   * Resolve every file-backed main DB through the parent VFS full-path
   * callback and pass that exact name to the parent VFS. WAL/journal xOpen
   * names must map back to the same enrolled pathname; aliases that do not
   * map to a registered role fail closed instead of falling back to path opens.
   */
  if (name && (flags & SQLITE_OPEN_MAIN_DB) && !(flags & SQLITE_OPEN_MEMORY)) {
#ifndef _WIN32
    const char *suffix = NULL;
    int broker_path_match = 0;
#if defined(__linux__)
    if (probe_match_role_entry(name, &role_index, &suffix)
        && suffix[0] == '\0' && g_database_roles[role_index].broker_socket_path) {
      canonical_name = sqlite3_mprintf("%s", name);
      if (!canonical_name) return SQLITE_NOMEM;
      broker_path_match = 1;
    }
#endif
    if (!broker_path_match) {
      canonical_name = (char *)sqlite3_malloc64((sqlite3_uint64)parent->mxPathname + 1);
      if (!canonical_name) return SQLITE_NOMEM;
      if (parent->xFullPathname(parent, name, parent->mxPathname + 1,
                                canonical_name) != SQLITE_OK) {
        sqlite3_free(canonical_name);
        return SQLITE_CANTOPEN;
      }
      if (!probe_match_role_entry(canonical_name, &role_index, &suffix)
          || suffix[0] != '\0') {
        sqlite3_free(canonical_name);
        return SQLITE_CANTOPEN;
      }
    }
#else
    canonical_name = (char *)sqlite3_malloc64((sqlite3_uint64)parent->mxPathname + 1);
    if (!canonical_name) return SQLITE_NOMEM;
    if (parent->xFullPathname(parent, name, parent->mxPathname + 1,
                              canonical_name) != SQLITE_OK) {
      sqlite3_free(canonical_name);
      return SQLITE_CANTOPEN;
    }
    {
      wchar_t *wide_path = probe_utf8_to_wide(canonical_name);
      const wchar_t *wide_suffix = NULL;
      int matched = wide_path
        && probe_match_role_entry_w(wide_path, &role_index, &wide_suffix);
      if (!matched || wide_suffix[0] != L'\0') {
        sqlite3_free(wide_path);
        sqlite3_free(canonical_name);
        return SQLITE_CANTOPEN;
      }
      sqlite3_free(wide_path);
    }
#endif
    open_name = canonical_name;
  }

  /*
   * SQLite owns the xOpen input string and only guarantees it for the call.
   * Parent VFS implementations may retain zName in their file object too, so
   * give every named file its own pinned copy, including WAL/journal files.
   */
  if (name && !canonical_name && !(flags & SQLITE_OPEN_MEMORY)) {
    canonical_name = sqlite3_mprintf("%s", name);
    if (!canonical_name) return SQLITE_NOMEM;
    open_name = canonical_name;
  }

  /* Every file-backed main DB must have an explicit trusted role. */
  if (name && (flags & SQLITE_OPEN_MAIN_DB)
      && !(flags & SQLITE_OPEN_MEMORY) && role_index < 0) {
    sqlite3_free(canonical_name);
    return SQLITE_CANTOPEN;
  }

  /*
   * Sidecar names must map to the exact enrolled DB pathname plus a known
   * SQLite suffix. Never allow an unrecognized WAL/journal name to reach the
   * parent VFS.
   */
  if (is_sidecar) {
    int matched = 0;
    int sidecar_role_index = -1;
#ifdef _WIN32
    wchar_t *wide_path = open_name ? probe_utf8_to_wide(open_name) : NULL;
    const wchar_t *suffix = NULL;
    if (wide_path) {
      matched = probe_match_role_entry_w(wide_path, &sidecar_role_index, &suffix)
        && suffix[0] != L'\0';
      sqlite3_free(wide_path);
    }
#else
    const char *suffix = NULL;
    matched = open_name && probe_match_role_entry(open_name, &sidecar_role_index, &suffix)
      && suffix[0] != '\0';
#endif
    if (!matched) {
      sqlite3_free(canonical_name);
      return SQLITE_CANTOPEN;
    }
  }

  is_race_target = open_name && g_race_path
    && (flags & (SQLITE_OPEN_MAIN_DB | SQLITE_OPEN_WAL | SQLITE_OPEN_MAIN_JOURNAL))
    && strcmp(open_name, g_race_path) == 0;

  if (role_index >= 0 && (flags & SQLITE_OPEN_MAIN_DB)) {
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
    /* Unix main-database race is injected by probe_stat after stat returns. */
    if (g_race_inject_once && (is_sidecar
#ifdef _WIN32
        || !is_sidecar
#endif
      )) {
      g_race_inject_once = 0;
      if (!probe_replace_with_hardlink(open_name, g_race_target_path)) {
        g_current_race_open = 0;
        g_current_sidecar_open = 0;
        sqlite3_free(canonical_name);
        return SQLITE_CANTOPEN;
      }
      probe_counter_increment(&g_race_injection_count);
    }
  }

  rc = parent->xOpen(parent, open_name, file, flags, out_flags);
  if (rc == SQLITE_OK && canonical_name) {
    /*
     * The parent VFS may retain zName inside its sqlite3_file (notably the
     * Windows and Unix WAL/SHM implementations). Keep xFullPathname storage
     * alive until this file handle closes; copy only xClose so every other
     * parent io method remains unchanged.
     */
    if (probe_pinned_path_add(file, canonical_name)) {
      canonical_name = NULL; /* ownership transferred to the per-file entry */
    } else {
      if (file->pMethods && file->pMethods->xClose) file->pMethods->xClose(file);
      rc = SQLITE_CANTOPEN;
    }
  }
  sqlite3_free(canonical_name);

  if (role_index >= 0 && (flags & SQLITE_OPEN_MAIN_DB)) {
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
#if defined(__linux__)
      probe_counter_increment(&g_sidecar_capture_fail_count);
#endif
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
#if defined(__linux__)
  g_last_parent_xopen_rc = rc;
  if (rc != SQLITE_OK) probe_counter_increment(&g_parent_xopen_fail_count);
#endif
  return rc;
}


#if defined(__linux__)
/*
 * Incremental descriptor-backed sqlite3_file backend.
 *
 * The parent VFS remains responsible for SQLite's platform locking and
 * shared-memory protocol. Main/WAL/journal byte I/O and durability operations
 * use the exact broker descriptor already owned by the parent VFS file.
 * Locking and SHM operations remain delegated to parent methods.
 */
typedef struct ProbeBackendFile {
  sqlite3_file base;
  sqlite3_io_methods methods;
  int broker_fd;
} ProbeBackendFile;

#define PROBE_PARENT_FILE_OFFSET \
  ((sizeof(ProbeBackendFile) + _Alignof(max_align_t) - 1) & ~((size_t)_Alignof(max_align_t) - 1))

static sqlite3_file *probe_backend_parent_file(sqlite3_file *file) {
  return (sqlite3_file *)((unsigned char *)file + PROBE_PARENT_FILE_OFFSET);
}

static int probe_backend_close(sqlite3_file *file) {
  ProbeBackendFile *backend = (ProbeBackendFile *)file;
  sqlite3_file *parent_file = probe_backend_parent_file(file);
  int rc = SQLITE_OK;
  if (parent_file->pMethods && parent_file->pMethods->xClose) {
    rc = parent_file->pMethods->xClose(parent_file);
  }
  /* The descriptor is borrowed from the embedded parent VFS file. */
  backend->broker_fd = -1;
  file->pMethods = NULL;
  return rc;
}

static int probe_backend_read(sqlite3_file *file, void *buffer, int amount,
                              sqlite3_int64 offset) {
  ProbeBackendFile *backend = (ProbeBackendFile *)file;
  if (backend->broker_fd >= 0) probe_counter_increment(&g_broker_backend_io_count);
  sqlite3_file *parent_file = probe_backend_parent_file(file);
  if (backend->broker_fd < 0) {
    return parent_file->pMethods->xRead(parent_file, buffer, amount, offset);
  }
  if (amount < 0 || offset < 0 || (sqlite3_int64)(off_t)offset != offset) {
    return SQLITE_IOERR_READ;
  }
  {
    unsigned char *out = (unsigned char *)buffer;
    int remaining = amount;
    off_t position = (off_t)offset;
    while (remaining > 0) {
      ssize_t count = pread(backend->broker_fd, out, (size_t)remaining, position);
      if (count < 0 && errno == EINTR) continue;
      if (count < 0) return SQLITE_IOERR_READ;
      if (count == 0) {
        memset(out, 0, (size_t)remaining);
        return SQLITE_IOERR_SHORT_READ;
      }
      out += count;
      remaining -= (int)count;
      position += (off_t)count;
    }
  }
  return SQLITE_OK;
}

static int probe_backend_write(sqlite3_file *file, const void *buffer, int amount,
                               sqlite3_int64 offset) {
  ProbeBackendFile *backend = (ProbeBackendFile *)file;
  if (backend->broker_fd >= 0) probe_counter_increment(&g_broker_backend_io_count);
  sqlite3_file *parent_file = probe_backend_parent_file(file);
  if (backend->broker_fd < 0) {
    return parent_file->pMethods->xWrite(parent_file, buffer, amount, offset);
  }
  if (amount < 0 || offset < 0 || (sqlite3_int64)(off_t)offset != offset) {
    return SQLITE_IOERR_WRITE;
  }
  {
    const unsigned char *in = (const unsigned char *)buffer;
    int remaining = amount;
    off_t position = (off_t)offset;
    while (remaining > 0) {
      ssize_t count = pwrite(backend->broker_fd, in, (size_t)remaining, position);
      if (count < 0 && errno == EINTR) continue;
      if (count <= 0) return SQLITE_IOERR_WRITE;
      in += count;
      remaining -= (int)count;
      position += (off_t)count;
    }
  }
  return SQLITE_OK;
}

static int probe_backend_truncate(sqlite3_file *file, sqlite3_int64 size) {
  ProbeBackendFile *backend = (ProbeBackendFile *)file;
  if (backend->broker_fd >= 0) probe_counter_increment(&g_broker_backend_io_count);
  sqlite3_file *parent_file = probe_backend_parent_file(file);
  if (backend->broker_fd < 0) {
    return parent_file->pMethods->xTruncate(parent_file, size);
  }
  if (size < 0 || (sqlite3_int64)(off_t)size != size
      || ftruncate(backend->broker_fd, (off_t)size) != 0) {
    return SQLITE_IOERR_TRUNCATE;
  }
  return SQLITE_OK;
}

static int probe_backend_sync(sqlite3_file *file, int flags) {
  ProbeBackendFile *backend = (ProbeBackendFile *)file;
  if (backend->broker_fd >= 0) probe_counter_increment(&g_broker_backend_io_count);
  sqlite3_file *parent_file = probe_backend_parent_file(file);
  if (backend->broker_fd < 0) {
    return parent_file->pMethods->xSync(parent_file, flags);
  }
  if ((flags & SQLITE_SYNC_FULL) != 0) {
    if (fsync(backend->broker_fd) != 0) return SQLITE_IOERR_FSYNC;
  } else {
    if (fdatasync(backend->broker_fd) != 0) return SQLITE_IOERR_FSYNC;
  }
  return SQLITE_OK;
}

static int probe_backend_file_size(sqlite3_file *file, sqlite3_int64 *size) {
  ProbeBackendFile *backend = (ProbeBackendFile *)file;
  if (backend->broker_fd >= 0) probe_counter_increment(&g_broker_backend_io_count);
  sqlite3_file *parent_file = probe_backend_parent_file(file);
  if (backend->broker_fd < 0) {
    return parent_file->pMethods->xFileSize(parent_file, size);
  }
  {
    struct stat info;
    if (fstat(backend->broker_fd, &info) != 0 || info.st_size < 0) {
      return SQLITE_IOERR_FSTAT;
    }
    *size = (sqlite3_int64)info.st_size;
  }
  return SQLITE_OK;
}

#define PROBE_BACKEND_DELEGATE_INT(name, signature, args) \
  static int probe_backend_##name signature { \
    sqlite3_file *parent_file = probe_backend_parent_file(file); \
    return parent_file->pMethods->x##name args; \
  }

PROBE_BACKEND_DELEGATE_INT(Lock, (sqlite3_file *file, int level), (parent_file, level))
PROBE_BACKEND_DELEGATE_INT(Unlock, (sqlite3_file *file, int level), (parent_file, level))
PROBE_BACKEND_DELEGATE_INT(CheckReservedLock, (sqlite3_file *file, int *result), (parent_file, result))
PROBE_BACKEND_DELEGATE_INT(FileControl, (sqlite3_file *file, int op, void *arg), (parent_file, op, arg))
PROBE_BACKEND_DELEGATE_INT(SectorSize, (sqlite3_file *file), (parent_file))
PROBE_BACKEND_DELEGATE_INT(DeviceCharacteristics, (sqlite3_file *file), (parent_file))
static int probe_backend_ShmMap(sqlite3_file *file, int page, int page_size,
                                  int extend, void volatile **out) {
  sqlite3_file *parent_file = probe_backend_parent_file(file);
  int rc;
  probe_counter_increment(&g_broker_shm_map_count);
  rc = parent_file->pMethods->xShmMap(parent_file, page, page_size, extend, out);
  if (rc != SQLITE_OK) probe_counter_increment(&g_broker_shm_map_fail_count);
  return rc;
}
static int probe_backend_ShmLock(sqlite3_file *file, int offset, int count, int flags) {
  sqlite3_file *parent_file = probe_backend_parent_file(file);
  int rc;
  probe_counter_increment(&g_broker_shm_lock_count);
  rc = parent_file->pMethods->xShmLock(parent_file, offset, count, flags);
  if (rc != SQLITE_OK) probe_counter_increment(&g_broker_shm_lock_fail_count);
  return rc;
}

static void probe_backend_shm_barrier(sqlite3_file *file) {
  sqlite3_file *parent_file = probe_backend_parent_file(file);
  if (parent_file->pMethods->xShmBarrier) parent_file->pMethods->xShmBarrier(parent_file);
}

static int probe_backend_shm_unmap(sqlite3_file *file, int delete_flag) {
  sqlite3_file *parent_file = probe_backend_parent_file(file);
  return parent_file->pMethods->xShmUnmap
    ? parent_file->pMethods->xShmUnmap(parent_file, delete_flag) : SQLITE_OK;
}

static int probe_backend_fetch(sqlite3_file *file, sqlite3_int64 offset,
                               int amount, void **out) {
  sqlite3_file *parent_file = probe_backend_parent_file(file);
  return parent_file->pMethods->iVersion >= 3 && parent_file->pMethods->xFetch
    ? parent_file->pMethods->xFetch(parent_file, offset, amount, out)
    : (*out = NULL, SQLITE_OK);
}

static int probe_backend_unfetch(sqlite3_file *file, sqlite3_int64 offset, void *page) {
  sqlite3_file *parent_file = probe_backend_parent_file(file);
  return parent_file->pMethods->iVersion >= 3 && parent_file->pMethods->xUnfetch
    ? parent_file->pMethods->xUnfetch(parent_file, offset, page) : SQLITE_OK;
}

static int probe_xOpen(sqlite3_vfs *vfs, const char *name, sqlite3_file *file,
                       int flags, int *out_flags) {
  ProbeBackendFile *backend = (ProbeBackendFile *)file;
  sqlite3_file *parent_file = probe_backend_parent_file(file);
  int rc;
  int role_index = -1;
  const char *suffix = NULL;
  int requires_broker_fd = name
    && probe_match_role_entry(name, &role_index, &suffix)
    && role_index >= 0 && g_database_roles[role_index].broker_socket_path
    && (flags & (SQLITE_OPEN_MAIN_DB | SQLITE_OPEN_MAIN_JOURNAL | SQLITE_OPEN_WAL)) != 0;
  memset(backend, 0, PROBE_PARENT_FILE_OFFSET);
  backend->broker_fd = -1;
  g_current_broker_fd = -1;
  g_current_broker_expected_role = requires_broker_fd ? role_index : -1;
  g_current_broker_expected_kind = !requires_broker_fd ? -1
    : suffix[0] == '\0' ? 0
    : strcmp(suffix, "-wal") == 0 ? 1
    : strcmp(suffix, "-shm") == 0 ? 2
    : strcmp(suffix, "-journal") == 0 ? 3 : -1;
  rc = probe_xOpen_parent(vfs, name, parent_file, flags, out_flags);
  g_current_broker_expected_role = -1;
  g_current_broker_expected_kind = -1;
  if (rc != SQLITE_OK) {
    g_current_broker_fd = -1;
    return rc;
  }
  if (requires_broker_fd) {
    if (g_current_broker_fd < 0) {
      probe_counter_increment(&g_broker_backend_open_fail_count);
      g_current_broker_fd = -1;
      if (parent_file->pMethods && parent_file->pMethods->xClose) {
        parent_file->pMethods->xClose(parent_file);
      }
      return SQLITE_CANTOPEN;
    }
    /* Reuse the exact descriptor SQLite's parent VFS opened through broker IPC.
       A second open/dup would interfere with POSIX process-associated locks. */
    backend->broker_fd = g_current_broker_fd;
    g_current_broker_fd = -1;
  }

  backend->methods = *parent_file->pMethods;
  backend->methods.xClose = probe_backend_close;
  backend->methods.xRead = probe_backend_read;
  backend->methods.xWrite = probe_backend_write;
  backend->methods.xTruncate = probe_backend_truncate;
  backend->methods.xSync = probe_backend_sync;
  backend->methods.xFileSize = probe_backend_file_size;
  backend->methods.xLock = probe_backend_Lock;
  backend->methods.xUnlock = probe_backend_Unlock;
  backend->methods.xCheckReservedLock = probe_backend_CheckReservedLock;
  backend->methods.xFileControl = probe_backend_FileControl;
  backend->methods.xSectorSize = probe_backend_SectorSize;
  backend->methods.xDeviceCharacteristics = probe_backend_DeviceCharacteristics;
  if (backend->methods.iVersion >= 2) {
    backend->methods.xShmMap = probe_backend_ShmMap;
    backend->methods.xShmLock = probe_backend_ShmLock;
    backend->methods.xShmBarrier = probe_backend_shm_barrier;
    backend->methods.xShmUnmap = probe_backend_shm_unmap;
  }
  if (backend->methods.iVersion >= 3) {
    backend->methods.xFetch = probe_backend_fetch;
    backend->methods.xUnfetch = probe_backend_unfetch;
  }
  file->pMethods = &backend->methods;
  return SQLITE_OK;
}
#else
#define probe_xOpen probe_xOpen_parent
#endif

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
  *is_main = suffix[0] == L'\0';
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
    if (error == ERROR_ACCESS_DENIED) {
      /*
       * xAccess can be the first identity boundary SQLite exercises for an
       * aliased main DB. Count its fail-closed denial even when xOpen is never
       * reached after the parent VFS observes "not accessible".
       */
      probe_counter_increment(&g_identity_reject_count);
    }
    if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND
        || error == ERROR_ACCESS_DENIED || error == ERROR_SHARING_VIOLATION) {
      *result = 0;
      return SQLITE_OK;
    }
    return SQLITE_IOERR_ACCESS;
  }
  /*
   * xAccess is observational only. It must not enroll a pre-existing sidecar
   * into the ownership registry: ownership is claimed after SQLite's actual
   * xOpen handle has been identity-checked. This keeps an existence probe
   * from becoming a trust/provisioning operation.
   */
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
  FILE_STANDARD_INFO standard_info;
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
        (void)probe_win_sidecar_identity_retire(role_index, suffix, expected, 1);
      }
      return SQLITE_OK;
    }
    return SQLITE_IOERR_DELETE;
  }
  if (!is_main && probe_win_identity_is_registered_database(&actual)) {
    CloseHandle(handle);
    return SQLITE_IOERR_DELETE;
  }
  if (!is_main && !GetFileInformationByHandleEx(
        handle, FileStandardInfo, &standard_info, sizeof(standard_info))) {
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
  if (!is_main) (void)probe_win_sidecar_identity_retire(
    role_index, suffix, expected, standard_info.NumberOfLinks > 1);
  return SQLITE_OK;
}

static BOOL WINAPI probe_delete_file_w(LPCWSTR path) {
  int role_index = -1;
  const wchar_t *suffix = NULL;
  wchar_t *relative_name;
  int matched;
  int rc;
  if (!path) {
    SetLastError(ERROR_INVALID_PARAMETER);
    return FALSE;
  }
  matched = probe_match_role_entry_w(path, &role_index, &suffix);
  if (matched <= 0) {
    /* The default VFS is protected: unknown path deletes are never delegated. */
    SetLastError(ERROR_ACCESS_DENIED);
    return FALSE;
  }
  relative_name = probe_win_relative_name(&g_database_roles[role_index], suffix);
  if (!relative_name) {
    SetLastError(ERROR_ACCESS_DENIED);
    return FALSE;
  }
  probe_counter_increment(&g_delete_file_hook_count);
  rc = probe_win_delete_role(role_index, relative_name, suffix[0] == L'\\0');
  sqlite3_free(relative_name);
  if (rc == SQLITE_OK) {
    SetLastError(ERROR_SUCCESS);
    return TRUE;
  }
  SetLastError(ERROR_ACCESS_DENIED);
  return FALSE;
}
#endif

#ifndef _WIN32
static int probe_posix_parent_is_protected(int parent_fd);
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
#if defined(__linux__)
    if (suffix[0] != '\0' && role->broker_socket_path) {
      const char *kind = strcmp(suffix, "-wal") == 0 ? "wal"
        : strcmp(suffix, "-shm") == 0 ? "shm"
        : strcmp(suffix, "-journal") == 0 ? "journal" : NULL;
      uint32_t status = LEB_STATUS_INTERNAL;
      if (!kind || !probe_broker_exchange(role, role->broker_socket_path,
            LEB_OP_DELETE_SIDECAR, kind, 0, NULL, &status)
          || status != LEB_STATUS_OK) {
        probe_counter_increment(&g_broker_delete_fail_count);
        return SQLITE_IOERR_DELETE;
      }
      {
        int sidecar_kind = strcmp(kind, "wal") == 0 ? 1
          : strcmp(kind, "shm") == 0 ? 2 : 3;
        probe_registry_lock();
        for (int i = 0; i < g_sidecar_identity_count; ++i) {
          ProbeSidecarIdentity *entry = &g_sidecar_identities[i];
          if (entry->role_index == role_index && entry->kind == sidecar_kind) {
            entry->retired = 1;
          }
        }
        probe_registry_unlock();
      }
      return SQLITE_OK;
    }
    if (suffix[0] == '\0' && role->broker_socket_path) {
      /* Main-file deletion needs its own durable manifest transition. */
      return SQLITE_IOERR_DELETE;
    }
#endif
    char relative_name[4096];
    size_t base_length = strlen(role->basename);
    size_t suffix_length = strlen(suffix);
    if (base_length + suffix_length + 1 > sizeof(relative_name)) return SQLITE_IOERR_DELETE;
    if (!probe_posix_parent_is_protected(role->trusted_parent_fd)) {
      return SQLITE_IOERR_DELETE;
    }
    memcpy(relative_name, role->basename, base_length);
    memcpy(relative_name + base_length, suffix, suffix_length + 1);
    {
      int kind = suffix[0] == '\0' ? 0
        : strcmp(suffix, "-wal") == 0 ? 1
        : strcmp(suffix, "-shm") == 0 ? 2
        : strcmp(suffix, "-journal") == 0 ? 3 : -1;
      struct stat sidecar_info;
      int sidecar_identity_found = 0;
      if (kind < 0) return SQLITE_IOERR_DELETE;
      if (fstatat(role->trusted_parent_fd, relative_name, &sidecar_info,
            AT_SYMLINK_NOFOLLOW) != 0) {
        if (errno != ENOENT) return SQLITE_IOERR_DELETE;
        if (kind > 0) {
          /* Missing path is not proof that a hardlinked object is gone. */
          probe_registry_lock();
          for (int i = 0; i < g_sidecar_identity_count; ++i) {
            ProbeSidecarIdentity *entry = &g_sidecar_identities[i];
            if (entry->role_index == role_index && entry->kind == kind) {
              entry->retired = 1;
            }
          }
          probe_registry_unlock();
        }
        return SQLITE_OK;
      }
      if (!S_ISREG(sidecar_info.st_mode) || sidecar_info.st_dev == 0
          || sidecar_info.st_ino == 0) return SQLITE_IOERR_DELETE;
      if (kind == 0) {
        /* Main DB deletion must target the enrolled object, not a replacement. */
        if (sidecar_info.st_dev != role->device || sidecar_info.st_ino != role->inode) {
          return SQLITE_IOERR_DELETE;
        }
      } else {
        probe_registry_lock();
        for (int i = 0; i < g_sidecar_identity_count; ++i) {
          ProbeSidecarIdentity *entry = &g_sidecar_identities[i];
          if (entry->role_index == role_index && entry->kind == kind
              && entry->device == sidecar_info.st_dev
              && entry->inode == sidecar_info.st_ino) {
            sidecar_identity_found = 1;
            break;
          }
        }
        probe_registry_unlock();
        if (!sidecar_identity_found) return SQLITE_IOERR_DELETE;
      }
      if (unlinkat(role->trusted_parent_fd, relative_name, 0) != 0) {
        if (errno == ENOENT) {
          if (kind > 0) {
            probe_registry_lock();
            for (int i = 0; i < g_sidecar_identity_count; ++i) {
              ProbeSidecarIdentity *entry = &g_sidecar_identities[i];
              if (entry->role_index == role_index && entry->kind == kind
                  && entry->device == sidecar_info.st_dev
                  && entry->inode == sidecar_info.st_ino) {
                entry->retired = 1;
              }
            }
            probe_registry_unlock();
          }
          return SQLITE_OK;
        }
        return SQLITE_IOERR_DELETE;
      }
      if (kind > 0) {
        probe_registry_lock();
        for (int i = 0; i < g_sidecar_identity_count; ++i) {
          ProbeSidecarIdentity *entry = &g_sidecar_identities[i];
          if (entry->role_index == role_index && entry->kind == kind
              && entry->device == sidecar_info.st_dev
              && entry->inode == sidecar_info.st_ino) {
            if (sidecar_info.st_nlink > 1) {
              /* Keep ownership while any hardlink can still name this object. */
              entry->retired = 1;
            } else {
              g_sidecar_identity_count--;
              if (i < g_sidecar_identity_count) memmove(&g_sidecar_identities[i],
                &g_sidecar_identities[i + 1],
                (size_t)(g_sidecar_identity_count - i) * sizeof(g_sidecar_identities[0]));
            }
            break;
          }
        }
        probe_registry_unlock();
      }
      if (sync_dir && fsync(role->trusted_parent_fd) != 0) return SQLITE_IOERR_DIR_FSYNC;
      return SQLITE_OK;
    }
    return SQLITE_OK;
  }
#endif
  /* Protected default VFS: never delegate an unregistered delete by pathname. */
  return SQLITE_IOERR_DELETE;
}
#ifndef _WIN32
static int probe_unlink(const char *path) {
  int rc;
  if (!path) {
    errno = EINVAL;
    return -1;
  }
  probe_counter_increment(&g_unlink_hook_count);
  /*
   * SQLite's Unix VFS calls osUnlink() directly from unixShmUnmap() when
   * deleteFlag is set. Route that internal path through the same role and
   * sidecar identity checks as xDelete instead of allowing a pathname unlink.
   */
  rc = probe_xDelete(&g_probe_vfs, path, 0);
  if (rc == SQLITE_OK) return 0;
  errno = rc == SQLITE_IOERR_DELETE_NOENT ? ENOENT : EACCES;
  return -1;
}
#endif

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
#if defined(__linux__)
    if (role->broker_socket_path) {
      const char *kind = suffix[0] == '\0' ? "main"
        : strcmp(suffix, "-wal") == 0 ? "wal"
        : strcmp(suffix, "-shm") == 0 ? "shm"
        : strcmp(suffix, "-journal") == 0 ? "journal" : NULL;
      uint32_t status = LEB_STATUS_INTERNAL;
      if (!kind || !probe_broker_exchange(role, role->broker_socket_path,
            LEB_OP_ACCESS_ROLE_FILE, kind, 0, NULL, &status)) {
        probe_counter_increment(&g_broker_access_fail_count);
        return SQLITE_IOERR_ACCESS;
      }
      if (status == LEB_STATUS_OK) {
        *result = 1;
        return SQLITE_OK;
      }
      if (status == LEB_STATUS_NOT_FOUND) {
        *result = 0;
        return SQLITE_OK;
      }
      probe_counter_increment(&g_broker_access_fail_count);
      return SQLITE_IOERR_ACCESS;
    }
#endif
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
  /* Unknown paths are not part of the trusted role inventory. */
  return SQLITE_IOERR_ACCESS;
}
static int probe_xFullPathname(sqlite3_vfs *vfs, const char *name, int n, char *out) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
#if defined(__linux__)
  int role_index = -1;
  const char *suffix = NULL;
  if (name && probe_match_role_entry(name, &role_index, &suffix)
      && g_database_roles[role_index].broker_socket_path) {
    size_t length = strlen(name);
    if (length + 1 > (size_t)n) return SQLITE_CANTOPEN;
    memcpy(out, name, length + 1);
    return SQLITE_OK;
  }
#endif
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
  if (name && g_delete_syscall_name && strcmp(name, g_delete_syscall_name) == 0) {
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
  {
    int delete_rc = g_probe_vfs.xSetSystemCall(
      &g_probe_vfs, g_delete_syscall_name, g_original_delete_syscall
    );
    protected_ok = open_rc == SQLITE_PERM && delete_rc == SQLITE_PERM
      && g_parent_vfs->xGetSystemCall(g_parent_vfs, g_open_syscall_name)
        == (sqlite3_syscall_ptr)probe_create_file_w
      && g_parent_vfs->xGetSystemCall(g_parent_vfs, g_delete_syscall_name)
        == (sqlite3_syscall_ptr)probe_delete_file_w;
  }
#else
  {
    int stat_rc = g_probe_vfs.xSetSystemCall(
      &g_probe_vfs, "stat", g_original_stat_syscall
    );
    int unlink_rc = g_probe_vfs.xSetSystemCall(
      &g_probe_vfs, g_delete_syscall_name, g_original_delete_syscall
    );
    protected_ok = open_rc == SQLITE_PERM && stat_rc == SQLITE_PERM
      && unlink_rc == SQLITE_PERM
      && g_parent_vfs->xGetSystemCall(g_parent_vfs, g_open_syscall_name)
        == (sqlite3_syscall_ptr)probe_open
      && g_parent_vfs->xGetSystemCall(g_parent_vfs, "stat")
        == (sqlite3_syscall_ptr)probe_stat
      && g_parent_vfs->xGetSystemCall(g_parent_vfs, g_delete_syscall_name)
        == (sqlite3_syscall_ptr)probe_unlink;
  }
#endif
  sqlite3_result_int(context, protected_ok);
}

#ifndef _WIN32
static void probe_unlink_hook_count(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context, probe_counter_read(&g_unlink_hook_count));
}
#endif

#ifdef _WIN32
static void probe_delete_file_hook_count(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context, probe_counter_read(&g_delete_file_hook_count));
}
#endif

static void probe_temp_file_class_rejected(sqlite3_context *context, int argc, sqlite3_value **argv) {
  sqlite3_file *file;
  int out_flags = 0;
  int rc;
  (void)argc;
  (void)argv;
  file = (sqlite3_file *)sqlite3_malloc64((sqlite3_uint64)g_probe_vfs.szOsFile);
  if (!file) {
    sqlite3_result_error_nomem(context);
    return;
  }
  memset(file, 0, (size_t)g_probe_vfs.szOsFile);
  rc = probe_xOpen(&g_probe_vfs, "probe-temp-file",
    file, SQLITE_OPEN_TEMP_DB | SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
    &out_flags);
  if (rc == SQLITE_OK && file->pMethods && file->pMethods->xClose) {
    file->pMethods->xClose(file);
  }
  sqlite3_free(file);
  sqlite3_result_int(context, rc == SQLITE_CANTOPEN);
}

#if defined(__linux__)
static void probe_parent_xopen_diagnostics(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context, probe_counter_read(&g_parent_xopen_fail_count) * 1000
    + g_last_parent_xopen_rc);
}
static void probe_broker_vfs_failure_diagnostics(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int64(context,
    (sqlite3_int64)probe_counter_read(&g_broker_syscall_open_fail_count) * 1000000000
    + (sqlite3_int64)probe_counter_read(&g_broker_delete_fail_count) * 1000000
    + (sqlite3_int64)probe_counter_read(&g_broker_access_fail_count) * 1000
    + probe_counter_read(&g_sidecar_capture_fail_count));
}
static void probe_broker_shm_diagnostics(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context, probe_counter_read(&g_broker_shm_map_count) * 1000000
    + probe_counter_read(&g_broker_shm_map_fail_count) * 1000
    + probe_counter_read(&g_shm_open_hook_count));
}
static void probe_broker_shm_lock_diagnostics(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context,
    probe_counter_read(&g_broker_shm_lock_count) * 1000
    + probe_counter_read(&g_broker_shm_lock_fail_count));
}
static void probe_broker_backend_open_fail_count(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context, probe_counter_read(&g_broker_backend_open_fail_count));
}
static void probe_broker_backend_io_count(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context, probe_counter_read(&g_broker_backend_io_count));
}
#endif

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

#if defined(__linux__)
static void probe_bind_broker(sqlite3_context *context, int argc, sqlite3_value **argv) {
  const unsigned char *role_name = sqlite3_value_text(argv[0]);
  const unsigned char *socket_value = sqlite3_value_text(argv[1]);
  ProbeDatabaseRole *role = NULL;
  char *stored_socket = NULL;
  int descriptor = -1;
  uint32_t status = LEB_STATUS_INTERNAL;
  struct stat actual;
  int busy = 0;
  (void)argc;
  if (!role_name || !role_name[0] || !socket_value || !socket_value[0]
      || socket_value[0] != '/') {
    sqlite3_result_error(context, "role and absolute broker socket path are required", -1);
    return;
  }
  stored_socket = sqlite3_mprintf("%s", (const char *)socket_value);
  if (!stored_socket) {
    sqlite3_result_error_nomem(context);
    return;
  }
  probe_registry_lock();
  for (int i = 0; i < g_database_role_count; ++i) {
    if (strcmp(g_database_roles[i].role, (const char *)role_name) == 0) {
      role = &g_database_roles[i];
      break;
    }
  }
  if (!role || role->broker_socket_path) busy = 1;
  if (g_main_db_open_count || g_wal_open_count || g_journal_open_count) busy = 1;
  for (int i = 0; i < PROBE_MAX_PINNED_PATHS; ++i) {
    if (g_pinned_paths[i].file) busy = 1;
  }
  probe_registry_unlock();
  if (!role || busy) {
    sqlite3_free(stored_socket);
    sqlite3_result_error(context, "role missing, already broker-bound, or VFS already opened files", -1);
    return;
  }
  if (!probe_broker_exchange(role, stored_socket, LEB_OP_OPEN_MAIN,
                             NULL, 1, &descriptor, &status)
      || status != LEB_STATUS_OK || descriptor < 0
      || fstat(descriptor, &actual) != 0
      || actual.st_dev != role->device || actual.st_ino != role->inode) {
    if (descriptor >= 0) close(descriptor);
    sqlite3_free(stored_socket);
    sqlite3_result_error(context, "broker main-file identity handshake failed", -1);
    return;
  }
  close(descriptor);
  probe_registry_lock();
  if (role->broker_socket_path || g_main_db_open_count || g_wal_open_count
      || g_journal_open_count) {
    busy = 1;
  } else {
    role->broker_socket_path = stored_socket;
    stored_socket = NULL;
  }
  probe_registry_unlock();
  sqlite3_free(stored_socket);
  if (busy) {
    sqlite3_result_error(context, "VFS became active during broker binding", -1);
    return;
  }
  sqlite3_result_int(context, 1);
}
#endif

#if defined(__linux__)
static int probe_valid_role_name(const char *value) {
  size_t length;
  if (!value) return 0;
  length = strlen(value);
  if (length == 0 || length > 128) return 0;
  for (size_t i = 0; i < length; ++i) {
    unsigned char ch = (unsigned char)value[i];
    if (!((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')
          || (ch >= '0' && ch <= '9') || ch == '.' || ch == '_' || ch == '-')) return 0;
  }
  return value[0] != '.' && value[0] != '-';
}

static int probe_valid_absolute_role_path(const char *value) {
  const char *component;
  if (!value || value[0] != '/' || !value[1]) return 0;
  component = value + 1;
  if (strstr(value, "//") || value[strlen(value) - 1] == '/') return 0;
  while (*component) {
    const char *end = strchr(component, '/');
    size_t length = end ? (size_t)(end - component) : strlen(component);
    if (length == 0 || (length == 1 && component[0] == '.')
        || (length == 2 && component[0] == '.' && component[1] == '.')) return 0;
    if (!end) break;
    component = end + 1;
  }
  return 1;
}

static void probe_register_broker_role(sqlite3_context *context, int argc, sqlite3_value **argv) {
  const unsigned char *path_value = sqlite3_value_text(argv[0]);
  const unsigned char *role_value = sqlite3_value_text(argv[1]);
  const unsigned char *socket_value = sqlite3_value_text(argv[2]);
  ProbeDatabaseRole candidate;
  char *stored_path = NULL, *stored_role = NULL, *stored_socket = NULL, *basename = NULL;
  int descriptor = -1, full = 0, duplicate = 0, duplicate_identity = 0;
  uint32_t status = LEB_STATUS_INTERNAL;
  struct stat info;
  const char *separator;
  (void)argc;
  memset(&candidate, 0, sizeof(candidate));
  if (!path_value || !role_value || !socket_value
      || !probe_valid_absolute_role_path((const char *)path_value)
      || !probe_valid_role_name((const char *)role_value)
      || socket_value[0] != '/') {
    sqlite3_result_error(context, "canonical absolute database path, role and broker socket are required", -1);
    return;
  }
  if (strlen((const char *)path_value) > (size_t)g_parent_vfs->mxPathname
      || strlen((const char *)socket_value) >= sizeof(((struct sockaddr_un *)0)->sun_path)) {
    sqlite3_result_error(context, "database or broker socket path is too long", -1);
    return;
  }
  separator = strrchr((const char *)path_value, '/');
  if (!separator || !separator[1]) {
    sqlite3_result_error(context, "database path must include a basename", -1);
    return;
  }
  stored_path = sqlite3_mprintf("%s", (const char *)path_value);
  stored_role = sqlite3_mprintf("%s", (const char *)role_value);
  stored_socket = sqlite3_mprintf("%s", (const char *)socket_value);
  basename = sqlite3_mprintf("%s", separator + 1);
  if (!stored_path || !stored_role || !stored_socket || !basename) {
    sqlite3_free(stored_path);
    sqlite3_free(stored_role);
    sqlite3_free(stored_socket);
    sqlite3_free(basename);
    sqlite3_result_error_nomem(context);
    return;
  }
  candidate.role = stored_role;
  if (!probe_broker_exchange(&candidate, stored_socket, LEB_OP_OPEN_MAIN,
                             NULL, 1, &descriptor, &status)
      || status != LEB_STATUS_OK || descriptor < 0
      || fstat(descriptor, &info) != 0 || !S_ISREG(info.st_mode)
      || info.st_nlink != 1) {
    if (descriptor >= 0) close(descriptor);
    sqlite3_free(stored_path);
    sqlite3_free(stored_role);
    sqlite3_free(stored_socket);
    sqlite3_free(basename);
    sqlite3_result_error(context, "broker role enrollment handshake failed", -1);
    return;
  }
  close(descriptor);
  candidate.device = info.st_dev;
  candidate.inode = info.st_ino;
  candidate.identity_set = 1;

  probe_registry_lock();
  if (g_database_role_count >= PROBE_MAX_DATABASE_ROLES) full = 1;
  for (int i = 0; !full && i < g_database_role_count; ++i) {
    ProbeDatabaseRole *other = &g_database_roles[i];
    if (strcmp(stored_path, other->path) == 0
        || strcmp(stored_role, other->role) == 0) {
      duplicate = 1;
      break;
    }
    if (other->identity_set && candidate.device == other->device
        && candidate.inode == other->inode) duplicate_identity = 1;
  }
  if (!full && !duplicate && !duplicate_identity) {
    ProbeDatabaseRole *entry = &g_database_roles[g_database_role_count++];
    entry->path = stored_path;
    entry->role = stored_role;
    entry->device = candidate.device;
    entry->inode = candidate.inode;
    entry->identity_set = 1;
    entry->trusted_fd = -1;
    entry->trusted_parent_fd = -1;
    entry->basename = basename;
    entry->broker_socket_path = stored_socket;
    stored_path = stored_role = stored_socket = basename = NULL;
  }
  probe_registry_unlock();

  sqlite3_free(stored_path);
  sqlite3_free(stored_role);
  sqlite3_free(stored_socket);
  sqlite3_free(basename);
  if (full || duplicate || duplicate_identity) {
    sqlite3_result_error(context, full ? "database role registry is full"
      : (duplicate_identity ? "database identity is already registered"
                            : "database role or path already registered"), -1);
    return;
  }
  sqlite3_result_int(context, 1);
}
#endif

static void probe_delete_registered_role(sqlite3_context *context, int argc, sqlite3_value **argv) {
  const unsigned char *path = sqlite3_value_text(argv[0]);
  int rc;
  (void)argc;
  if (!path || !path[0]) {
    sqlite3_result_error(context, "database path is required", -1);
    return;
  }
  rc = probe_xDelete(&g_probe_vfs, (const char *)path, 1);
  if (rc != SQLITE_OK) {
    sqlite3_result_error_code(context, rc);
    return;
  }
  sqlite3_result_int(context, 1);
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
    db, "logic_engine_vfs_probe_temp_file_class_rejected",
    0, SQLITE_UTF8 | SQLITE_DETERMINISTIC, 0, probe_temp_file_class_rejected, 0, 0);
  if (rc != SQLITE_OK) return rc;
#ifdef _WIN32
  rc = sqlite3_create_function(db, "logic_engine_vfs_probe_delete_file_hook_count",
    0, SQLITE_UTF8 | SQLITE_DETERMINISTIC, 0, probe_delete_file_hook_count, 0, 0);
  if (rc != SQLITE_OK) return rc;
#else
  rc = sqlite3_create_function(db, "logic_engine_vfs_probe_unlink_hook_count",
    0, SQLITE_UTF8 | SQLITE_DETERMINISTIC, 0, probe_unlink_hook_count, 0, 0);
  if (rc != SQLITE_OK) return rc;
#endif
  rc = sqlite3_create_function(
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
  rc = sqlite3_create_function(db, "logic_engine_vfs_probe_delete_registered_role", 1,
    SQLITE_UTF8, 0, probe_delete_registered_role, 0, 0);
  if (rc != SQLITE_OK) return rc;
#if defined(__linux__)
  rc = sqlite3_create_function(db, "logic_engine_vfs_probe_bind_broker", 2,
    SQLITE_UTF8, 0, probe_bind_broker, 0, 0);
  if (rc != SQLITE_OK) return rc;
#endif
#if defined(__linux__)
  rc = sqlite3_create_function(db, "logic_engine_vfs_probe_register_broker_role", 3,
    SQLITE_UTF8, 0, probe_register_broker_role, 0, 0);
  if (rc != SQLITE_OK) return rc;
#endif
#if defined(__linux__)
  rc = sqlite3_create_function(db, "logic_engine_vfs_probe_parent_xopen_diagnostics", 0,
    SQLITE_UTF8 | SQLITE_DETERMINISTIC, 0, probe_parent_xopen_diagnostics, 0, 0);
  if (rc != SQLITE_OK) return rc;
  rc = sqlite3_create_function(db, "logic_engine_vfs_probe_failure_diagnostics", 0,
    SQLITE_UTF8 | SQLITE_DETERMINISTIC, 0, probe_broker_vfs_failure_diagnostics, 0, 0);
  if (rc != SQLITE_OK) return rc;
  rc = sqlite3_create_function(db, "logic_engine_vfs_probe_broker_shm_diagnostics", 0,
    SQLITE_UTF8 | SQLITE_DETERMINISTIC, 0, probe_broker_shm_diagnostics, 0, 0);
  if (rc != SQLITE_OK) return rc;
  rc = sqlite3_create_function(db, "logic_engine_vfs_probe_broker_shm_lock_diagnostics", 0,
    SQLITE_UTF8 | SQLITE_DETERMINISTIC, 0, probe_broker_shm_lock_diagnostics, 0, 0);
  if (rc != SQLITE_OK) return rc;
  rc = sqlite3_create_function(db, "logic_engine_vfs_probe_broker_backend_open_fail_count", 0,
    SQLITE_UTF8 | SQLITE_DETERMINISTIC, 0, probe_broker_backend_open_fail_count, 0, 0);
  if (rc != SQLITE_OK) return rc;
  rc = sqlite3_create_function(db, "logic_engine_vfs_probe_broker_backend_io_count", 0,
    SQLITE_UTF8 | SQLITE_DETERMINISTIC, 0, probe_broker_backend_io_count, 0, 0);
  if (rc != SQLITE_OK) return rc;
#endif
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
  g_delete_syscall_name = "DeleteFileW";
  g_original_delete_syscall = g_parent_vfs->xGetSystemCall(
    g_parent_vfs, g_delete_syscall_name
  );
  if (!g_original_delete_syscall) return SQLITE_ERROR;
#else
  g_open_syscall_name = "open";
  g_delete_syscall_name = "unlink";
  g_original_delete_syscall = g_parent_vfs->xGetSystemCall(
    g_parent_vfs, g_delete_syscall_name
  );
  if (!g_original_delete_syscall) return SQLITE_ERROR;
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
  if (rc == SQLITE_OK) {
    rc = g_parent_vfs->xSetSystemCall(
      g_parent_vfs, g_delete_syscall_name, (sqlite3_syscall_ptr)probe_delete_file_w
    );
    if (rc != SQLITE_OK) {
      g_parent_vfs->xSetSystemCall(
        g_parent_vfs, g_open_syscall_name, g_original_open_syscall
      );
    }
  }
#else
  rc = g_parent_vfs->xSetSystemCall(
    g_parent_vfs, g_open_syscall_name, (sqlite3_syscall_ptr)probe_open
  );
  if (rc == SQLITE_OK) {
    rc = g_parent_vfs->xSetSystemCall(
      g_parent_vfs, g_delete_syscall_name, (sqlite3_syscall_ptr)probe_unlink
    );
    if (rc != SQLITE_OK) {
      g_parent_vfs->xSetSystemCall(
        g_parent_vfs, g_open_syscall_name, g_original_open_syscall
      );
    }
  }
#endif
  if (rc != SQLITE_OK) {
#ifdef _WIN32
    g_parent_vfs->xSetSystemCall(
      g_parent_vfs, g_delete_syscall_name, g_original_delete_syscall
    );
#else
    g_parent_vfs->xSetSystemCall(
      g_parent_vfs, g_delete_syscall_name, g_original_delete_syscall
    );
    g_parent_vfs->xSetSystemCall(g_parent_vfs, "stat", g_original_stat_syscall);
#endif
    return rc;
  }

  memset(&g_probe_vfs, 0, sizeof(g_probe_vfs));
  g_probe_vfs.iVersion = g_parent_vfs->iVersion;
#if defined(__linux__)
  if ((size_t)g_parent_vfs->szOsFile > (size_t)INT_MAX - PROBE_PARENT_FILE_OFFSET) {
    return SQLITE_TOOBIG;
  }
  g_probe_vfs.szOsFile = (int)(PROBE_PARENT_FILE_OFFSET + (size_t)g_parent_vfs->szOsFile);
#else
  g_probe_vfs.szOsFile = g_parent_vfs->szOsFile;
#endif
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
#ifdef _WIN32
    g_parent_vfs->xSetSystemCall(g_parent_vfs, g_delete_syscall_name, g_original_delete_syscall);
#else
    g_parent_vfs->xSetSystemCall(
      g_parent_vfs, g_delete_syscall_name, g_original_delete_syscall
    );
    g_parent_vfs->xSetSystemCall(g_parent_vfs, "stat", g_original_stat_syscall);
#endif
    return rc;
  }
  rc = sqlite3_auto_extension((void (*)(void))probe_auto_extension);
  if (rc != SQLITE_OK) {
    sqlite3_vfs_unregister(&g_probe_vfs);
    g_parent_vfs->xSetSystemCall(g_parent_vfs, g_open_syscall_name, g_original_open_syscall);
#ifdef _WIN32
    g_parent_vfs->xSetSystemCall(g_parent_vfs, g_delete_syscall_name, g_original_delete_syscall);
#else
    g_parent_vfs->xSetSystemCall(
      g_parent_vfs, g_delete_syscall_name, g_original_delete_syscall
    );
    g_parent_vfs->xSetSystemCall(g_parent_vfs, "stat", g_original_stat_syscall);
#endif
    return rc;
  }

  g_registered = 1;
  return SQLITE_OK_LOAD_PERMANENTLY;
}