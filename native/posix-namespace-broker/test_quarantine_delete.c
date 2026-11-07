#define _GNU_SOURCE
#include "quarantine_delete.h"

#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <dirent.h>
#include <linux/fs.h>
#include <linux/stat.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

static int race_parent_fd = -1;
static int race_triggered;
static const char *race_original_backup = "original-held";

static int injected_fsync_call;
static int injected_fsync_failure_at;

static int injected_fsync(int fd) {
    injected_fsync_call++;
    if (injected_fsync_call == injected_fsync_failure_at) {
        errno = EIO;
        return -1;
    }
    return fsync(fd);
}

static int real_renameat2(int olddirfd, const char *oldpath,
                          int newdirfd, const char *newpath,
                          unsigned int flags) {
    return (int)syscall(SYS_renameat2, olddirfd, oldpath, newdirfd, newpath, flags);
}

static int replacing_renameat2(int olddirfd, const char *oldpath,
                               int newdirfd, const char *newpath,
                               unsigned int flags) {
    int fd;
    if (!race_triggered) {
        race_triggered = 1;
        assert(real_renameat2(race_parent_fd, oldpath, race_parent_fd,
                              race_original_backup, RENAME_NOREPLACE) == 0);
        fd = openat(race_parent_fd, oldpath,
                    O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
        assert(fd >= 0);
        assert(write(fd, "decoy", 5) == 5);
        close(fd);
    }
    return real_renameat2(olddirfd, oldpath, newdirfd, newpath, flags);
}

static struct leb_file_identity identity_at(int dirfd, const char *name) {
    struct stat st;
    struct statx sx;
    struct leb_file_identity identity;
    int fd = openat(dirfd, name, O_PATH | O_NOFOLLOW | O_CLOEXEC);
    assert(fd >= 0);
    assert(fstat(fd, &st) == 0);
    memset(&sx, 0, sizeof(sx));
    assert(statx(fd, "", AT_EMPTY_PATH | AT_SYMLINK_NOFOLLOW,
                 STATX_INO | STATX_MNT_ID, &sx) == 0);
    assert((sx.stx_mask & (STATX_INO | STATX_MNT_ID)) ==
           (STATX_INO | STATX_MNT_ID));
    identity.device = (uint64_t)st.st_dev;
    identity.inode = (uint64_t)sx.stx_ino;
    identity.mount_id = (uint64_t)sx.stx_mnt_id;
    close(fd);
    return identity;
}

static void write_file_at(int dirfd, const char *name, const char *value) {
    int fd = openat(dirfd, name, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
    assert(fd >= 0);
    assert(write(fd, value, strlen(value)) == (ssize_t)strlen(value));
    close(fd);
}

int main(void) {
    char template[] = "/tmp/leb-quarantine-test-XXXXXX";
    char *root = mkdtemp(template);
    char parent_path[512], quarantine_path[512];
    int root_fd, parent_fd, quarantine_fd;
    struct leb_file_identity expected;
    struct stat st;
    int result;

    assert(root != NULL);
    assert(snprintf(parent_path, sizeof(parent_path), "%s/parent", root) > 0);
    assert(snprintf(quarantine_path, sizeof(quarantine_path), "%s/quarantine", root) > 0);
    assert(mkdir(parent_path, 0700) == 0);
    assert(mkdir(quarantine_path, 0700) == 0);
    root_fd = open(root, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    assert(root_fd >= 0);
    parent_fd = openat(root_fd, "parent", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    quarantine_fd = openat(root_fd, "quarantine", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    assert(parent_fd >= 0 && quarantine_fd >= 0);
    assert(fchmod(quarantine_fd, 0700) == 0);

    write_file_at(parent_fd, "expected.db", "expected");
    expected = identity_at(parent_fd, "expected.db");
    result = leb_quarantine_delete_at(parent_fd, quarantine_fd, "expected.db", &expected);
    assert(result == LEB_QUARANTINE_OK);
    assert(fstatat(parent_fd, "expected.db", &st, AT_SYMLINK_NOFOLLOW) != 0 && errno == ENOENT);


    /* A pre-unlink directory-sync failure must retain the moved file. */
    write_file_at(parent_fd, "retained.db", "retained");
    expected = identity_at(parent_fd, "retained.db");
    injected_fsync_call = 0;
    injected_fsync_failure_at = 1;
    result = leb_quarantine_delete_at_test(parent_fd, quarantine_fd, "retained.db",
                                           &expected, real_renameat2, injected_fsync);
    assert(result == LEB_QUARANTINE_RETAINED);
    assert(fstatat(parent_fd, "retained.db", &st, AT_SYMLINK_NOFOLLOW) != 0 && errno == ENOENT);

    /* Failure of the second sync is also fail-closed and keeps the file. */
    write_file_at(parent_fd, "retained-parent-sync.db", "retained-parent-sync");
    expected = identity_at(parent_fd, "retained-parent-sync.db");
    injected_fsync_call = 0;
    injected_fsync_failure_at = 2;
    result = leb_quarantine_delete_at_test(parent_fd, quarantine_fd,
                                           "retained-parent-sync.db", &expected,
                                           real_renameat2, injected_fsync);
    assert(result == LEB_QUARANTINE_RETAINED);
    assert(fstatat(parent_fd, "retained-parent-sync.db", &st, AT_SYMLINK_NOFOLLOW) != 0 &&
           errno == ENOENT);

    /* A post-unlink sync failure is explicitly an uncertain durability result. */
    write_file_at(parent_fd, "uncertain.db", "uncertain");
    expected = identity_at(parent_fd, "uncertain.db");
    injected_fsync_call = 0;
    injected_fsync_failure_at = 3;
    result = leb_quarantine_delete_at_test(parent_fd, quarantine_fd, "uncertain.db",
                                           &expected, real_renameat2, injected_fsync);
    assert(result == LEB_QUARANTINE_DURABILITY_UNCERTAIN);
    assert(fstatat(parent_fd, "uncertain.db", &st, AT_SYMLINK_NOFOLLOW) != 0 && errno == ENOENT);

    /* The quarantine directory must be private with exactly mode 0700. */
    write_file_at(parent_fd, "mode-check.db", "mode");
    expected = identity_at(parent_fd, "mode-check.db");
    assert(fchmod(quarantine_fd, 0500) == 0);
    result = leb_quarantine_delete_at(parent_fd, quarantine_fd, "mode-check.db", &expected);
    assert(result == LEB_QUARANTINE_ERROR);
    assert(fchmod(quarantine_fd, 0700) == 0);
    assert(fchmod(quarantine_fd, 01700) == 0);
    result = leb_quarantine_delete_at(parent_fd, quarantine_fd, "mode-check.db", &expected);
    assert(result == LEB_QUARANTINE_ERROR);
    assert(fchmod(quarantine_fd, 0700) == 0);
    assert(fstatat(parent_fd, "mode-check.db", &st, AT_SYMLINK_NOFOLLOW) == 0);

    /* Parent and quarantine must be distinct directory identities. */
    result = leb_quarantine_delete_at(parent_fd, parent_fd, "mode-check.db", &expected);
    assert(result == LEB_QUARANTINE_ERROR);
    assert(unlinkat(parent_fd, "mode-check.db", 0) == 0);

    write_file_at(parent_fd, "race.db", "original");
    expected = identity_at(parent_fd, "race.db");
    race_parent_fd = parent_fd;
    race_triggered = 0;
    result = leb_quarantine_delete_at_test(parent_fd, quarantine_fd, "race.db",
                                           &expected, replacing_renameat2, fsync);
    assert(result == LEB_QUARANTINE_IDENTITY_MISMATCH);
    assert(race_triggered);
    assert(fstatat(parent_fd, race_original_backup, &st, AT_SYMLINK_NOFOLLOW) == 0);
    assert(fstatat(parent_fd, "race.db", &st, AT_SYMLINK_NOFOLLOW) != 0 && errno == ENOENT);

    {
        int qdup = dup(quarantine_fd);
        DIR *dir;
        struct dirent *entry;
        int found_decoy = 0;
        assert(qdup >= 0);
        dir = fdopendir(qdup);
        assert(dir != NULL);
        while ((entry = readdir(dir)) != NULL) {
            char buffer[32] = {0};
            ssize_t bytes_read;
            int fd;
            if (strncmp(entry->d_name, "entry-", 6) != 0) continue;
            fd = openat(quarantine_fd, entry->d_name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
            assert(fd >= 0);
            bytes_read = read(fd, buffer, sizeof(buffer));
            assert(bytes_read >= 0);
            close(fd);
            if (bytes_read == 5 && memcmp(buffer, "decoy", 5) == 0)
                found_decoy = 1;
        }
        closedir(dir);
        assert(found_decoy);
    }

    /* A zero expected identity must never authorize deletion of a regular file. */
    write_file_at(parent_fd, "zero-identity.db", "zero");
    expected = (struct leb_file_identity){0};
    result = leb_quarantine_delete_at(parent_fd, quarantine_fd, "zero-identity.db", &expected);
    assert(result == LEB_QUARANTINE_IDENTITY_MISMATCH);
    assert(fstatat(parent_fd, "zero-identity.db", &st, AT_SYMLINK_NOFOLLOW) == 0);
    assert(unlinkat(parent_fd, "zero-identity.db", 0) == 0);

    write_file_at(parent_fd, "hardlink.db", "linked");
    assert(linkat(parent_fd, "hardlink.db", parent_fd, "hardlink-alias.db", 0) == 0);
    expected = identity_at(parent_fd, "hardlink.db");
    result = leb_quarantine_delete_at(parent_fd, quarantine_fd, "hardlink.db", &expected);
    assert(result == LEB_QUARANTINE_IDENTITY_MISMATCH);

    assert(symlinkat("expected.db", parent_fd, "symlink.db") == 0);
    expected = (struct leb_file_identity){0};
    result = leb_quarantine_delete_at(parent_fd, quarantine_fd, "symlink.db", &expected);
    assert(result == LEB_QUARANTINE_IDENTITY_MISMATCH);

    unlinkat(parent_fd, "original-held", 0);
    unlinkat(parent_fd, "hardlink.db", 0);
    unlinkat(parent_fd, "hardlink-alias.db", 0);
    unlinkat(parent_fd, "symlink.db", 0);
    {
        int qdup = dup(quarantine_fd);
        DIR *dir;
        struct dirent *entry;
        assert(qdup >= 0);
        dir = fdopendir(qdup);
        assert(dir != NULL);
        /* dup() shares the directory offset; the earlier scan reached EOF. */
        rewinddir(dir);
        while ((entry = readdir(dir)) != NULL) {
            if (entry->d_name[0] == '.') continue;
            assert(unlinkat(quarantine_fd, entry->d_name, 0) == 0);
        }
        closedir(dir);
    }
    assert(unlinkat(root_fd, "parent", AT_REMOVEDIR) == 0);
    assert(unlinkat(root_fd, "quarantine", AT_REMOVEDIR) == 0);
    close(parent_fd);
    close(quarantine_fd);
    close(root_fd);
    assert(rmdir(root) == 0);
    puts("POSIX quarantine delete tests: PASS (identity, name-swap race, fsync failures, directory policy, hard-link, symlink)");
    return 0;
}
