#define _GNU_SOURCE
#include "quarantine_delete.h"

#include <errno.h>
#include <fcntl.h>
#include <linux/fs.h>
#include <linux/stat.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <unistd.h>

#ifndef STATX_MNT_ID
#define STATX_MNT_ID 0x00001000U
#endif

static _Atomic unsigned long quarantine_counter = 0;

static int identity_from_fd(int fd, struct leb_file_identity *identity,
                            struct stat *file_stat) {
    struct statx sx;

    if (fstat(fd, file_stat) != 0) return -1;
    memset(&sx, 0, sizeof(sx));
    if (statx(fd, "", AT_EMPTY_PATH | AT_SYMLINK_NOFOLLOW,
              STATX_TYPE | STATX_INO | STATX_MNT_ID, &sx) != 0) return -1;
    if ((sx.stx_mask & (STATX_INO | STATX_MNT_ID)) !=
        (STATX_INO | STATX_MNT_ID) ||
        file_stat->st_dev == 0 || sx.stx_ino == 0 || sx.stx_mnt_id == 0) {
        errno = ENOTSUP;
        return -1;
    }
    identity->device = (uint64_t)file_stat->st_dev;
    identity->inode = (uint64_t)sx.stx_ino;
    identity->mount_id = (uint64_t)sx.stx_mnt_id;
    return 0;
}

static int renameat2_call(int olddirfd, const char *oldpath,
                          int newdirfd, const char *newpath,
                          unsigned int flags) {
    return (int)syscall(SYS_renameat2, olddirfd, oldpath,
                        newdirfd, newpath, flags);
}

static int quarantine_delete_impl(int parent_fd, int quarantine_fd,
                                  const char *name,
                                  const struct leb_file_identity *expected,
                                  leb_renameat2_fn rename_fn,
                                  leb_fsync_fn fsync_fn) {
    struct stat parent_stat, quarantine_stat, opened_stat, moved_stat;
    struct leb_file_identity parent_id, quarantine_id, opened_id, moved_id;
    char quarantine_name[96];
    int opened_fd = -1, moved_fd = -1, result = LEB_QUARANTINE_ERROR;
    bool moved_to_quarantine = false;
    unsigned int attempt;

    if (parent_fd < 0 || quarantine_fd < 0 || !name || name[0] == '\0' ||
        strchr(name, '/') != NULL || strcmp(name, ".") == 0 ||
        strcmp(name, "..") == 0 || !expected || !rename_fn || !fsync_fn) {
        errno = EINVAL;
        return LEB_QUARANTINE_ERROR;
    }

    if (identity_from_fd(parent_fd, &parent_id, &parent_stat) != 0 ||
        identity_from_fd(quarantine_fd, &quarantine_id, &quarantine_stat) != 0)
        return LEB_QUARANTINE_ERROR;
    if (!S_ISDIR(parent_stat.st_mode) || !S_ISDIR(quarantine_stat.st_mode) ||
        quarantine_stat.st_uid != geteuid() ||
        (quarantine_stat.st_mode & 07777) != 0700 ||
        parent_id.device != quarantine_id.device ||
        parent_id.mount_id != quarantine_id.mount_id ||
        (parent_id.device == quarantine_id.device &&
         parent_id.inode == quarantine_id.inode &&
         parent_id.mount_id == quarantine_id.mount_id)) {
        errno = EPERM;
        return LEB_QUARANTINE_ERROR;
    }

    opened_fd = openat(parent_fd, name, O_PATH | O_NOFOLLOW | O_CLOEXEC);
    if (opened_fd < 0) goto done;
    if (identity_from_fd(opened_fd, &opened_id, &opened_stat) != 0) goto done;
    if (!S_ISREG(opened_stat.st_mode) || opened_stat.st_nlink != 1 ||
        opened_id.device != expected->device ||
        opened_id.inode != expected->inode ||
        opened_id.mount_id != expected->mount_id) {
        errno = ESTALE;
        result = LEB_QUARANTINE_IDENTITY_MISMATCH;
        goto done;
    }

    for (attempt = 0; attempt < 32; attempt++) {
        unsigned long serial = atomic_fetch_add(&quarantine_counter, 1);
        int length = snprintf(quarantine_name, sizeof(quarantine_name),
                              "entry-%ld-%lu", (long)getpid(), serial);
        if (length < 0 || (size_t)length >= sizeof(quarantine_name)) {
            errno = EOVERFLOW;
            goto done;
        }
        if (rename_fn(parent_fd, name, quarantine_fd, quarantine_name,
                      RENAME_NOREPLACE) == 0) break;
        if (errno != EEXIST) goto done;
    }
    if (attempt == 32) {
        errno = EEXIST;
        goto done;
    }

    moved_to_quarantine = true;

    /*
     * Make the cross-directory rename durable before inspecting or deleting
     * the moved entry. If either sync fails, leave the entry quarantined.
     */
    if (fsync_fn(quarantine_fd) != 0 || fsync_fn(parent_fd) != 0) {
        result = LEB_QUARANTINE_RETAINED;
        goto done;
    }

    moved_fd = openat(quarantine_fd, quarantine_name,
                      O_PATH | O_NOFOLLOW | O_CLOEXEC);
    if (moved_fd < 0) {
        result = LEB_QUARANTINE_RETAINED;
        goto done;
    }
    if (identity_from_fd(moved_fd, &moved_id, &moved_stat) != 0) {
        result = LEB_QUARANTINE_RETAINED;
        goto done;
    }
    if (!S_ISREG(moved_stat.st_mode) || moved_stat.st_nlink != 1 ||
        moved_id.device != opened_id.device ||
        moved_id.inode != opened_id.inode ||
        moved_id.mount_id != opened_id.mount_id ||
        moved_id.device != expected->device ||
        moved_id.inode != expected->inode ||
        moved_id.mount_id != expected->mount_id) {
        errno = ESTALE;
        result = LEB_QUARANTINE_IDENTITY_MISMATCH;
        goto done;
    }

    if (unlinkat(quarantine_fd, quarantine_name, 0) != 0) {
        result = LEB_QUARANTINE_RETAINED;
        goto done;
    }
    if (fsync_fn(quarantine_fd) != 0) {
        result = LEB_QUARANTINE_DURABILITY_UNCERTAIN;
        goto done;
    }
    result = LEB_QUARANTINE_OK;

done:
    if (moved_to_quarantine && result == LEB_QUARANTINE_ERROR)
        result = LEB_QUARANTINE_RETAINED;
    if (moved_fd >= 0) close(moved_fd);
    if (opened_fd >= 0) close(opened_fd);
    return result;
}

int leb_quarantine_delete_at(int parent_fd, int quarantine_fd,
                             const char *name,
                             const struct leb_file_identity *expected) {
    return quarantine_delete_impl(parent_fd, quarantine_fd, name, expected,
                                  renameat2_call, fsync);
}

#ifdef LEB_TESTING
int leb_quarantine_delete_at_test(int parent_fd, int quarantine_fd,
                                  const char *name,
                                  const struct leb_file_identity *expected,
                                  leb_renameat2_fn rename_fn,
                                  leb_fsync_fn fsync_fn) {
    return quarantine_delete_impl(parent_fd, quarantine_fd, name, expected,
                                  rename_fn, fsync_fn);
}
#endif
