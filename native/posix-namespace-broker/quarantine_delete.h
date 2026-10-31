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
    LEB_QUARANTINE_IDENTITY_MISMATCH = -2
};

/*
 * Atomically moves the named entry into a broker-private quarantine directory,
 * verifies the moved object against the expected opened-object identity, and
 * only then unlinks it. The quarantine directory must be broker-owned, mode
 * 0700, and on the same mount as parent_fd.
 *
 * Returns IDENTITY_MISMATCH without unlinking when the name was replaced
 * between the initial open and atomic rename. The unexpected object remains
 * in quarantine for investigation.
 */
int leb_quarantine_delete_at(int parent_fd, int quarantine_fd,
                             const char *name,
                             const struct leb_file_identity *expected);

typedef int (*leb_renameat2_fn)(int, const char *, int, const char *, unsigned int);

#ifdef LEB_TESTING
int leb_quarantine_delete_at_test(int parent_fd, int quarantine_fd,
                                  const char *name,
                                  const struct leb_file_identity *expected,
                                  leb_renameat2_fn rename_fn);
#endif

#endif
