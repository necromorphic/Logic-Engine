#ifndef LOGIC_ENGINE_QUARANTINE_DELETE_H
#define LOGIC_ENGINE_QUARANTINE_DELETE_H

#include <stdint.h>

struct leb_file_identity {
    uint64_t device;
    uint64_t inode;
    uint64_t mount_id;
};

enum leb_quarantine_result {
    LEB_QUARANTINE_OK = 0,
    LEB_QUARANTINE_ERROR = -1,
    LEB_QUARANTINE_IDENTITY_MISMATCH = -2,
    LEB_QUARANTINE_RETAINED = -3,
    LEB_QUARANTINE_DURABILITY_UNCERTAIN = -4
};

/*
 * Atomically moves the named entry into a broker-private quarantine directory,
 * verifies the moved object against the expected opened-object identity, and
 * only then unlinks it. The quarantine directory must be owned by the broker
 * effective UID, have exactly mode 0700, be distinct from parent_fd, and be
 * on the same mount.
 *
 * IDENTITY_MISMATCH means the moved object did not match the opened object;
 * it remains in quarantine. RETAINED means the object was moved but not
 * unlinked (for example, because a directory sync failed). DURABILITY_UNCERTAIN
 * means unlink succeeded but syncing the quarantine directory failed; callers
 * must not assume the deletion is durable.
 */
int leb_quarantine_delete_at(int parent_fd, int quarantine_fd,
                             const char *name,
                             const struct leb_file_identity *expected);

typedef int (*leb_renameat2_fn)(int, const char *, int, const char *, unsigned int);
typedef int (*leb_fsync_fn)(int);

#ifdef LEB_TESTING
int leb_quarantine_delete_at_test(int parent_fd, int quarantine_fd,
                                  const char *name,
                                  const struct leb_file_identity *expected,
                                  leb_renameat2_fn rename_fn,
                                  leb_fsync_fn fsync_fn);
#endif

#endif
