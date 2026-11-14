#ifndef LOGIC_ENGINE_BROKER_PROTOCOL_H
#define LOGIC_ENGINE_BROKER_PROTOCOL_H

#include <stdint.h>

#define LEB_PROTOCOL_MAGIC 0x4c454256u /* LEBV */
#define LEB_PROTOCOL_VERSION 2u
#define LEB_MAX_PACKET_SIZE 4096u

enum leb_operation {
    LEB_OP_PING = 1,
    LEB_OP_OPEN_MAIN = 2,
    LEB_OP_OPEN_SIDECAR = 3,
    LEB_OP_DELETE_SIDECAR = 4,
    LEB_OP_CREATE_SIDECAR = 5,
    LEB_OP_OPEN_ROLE_PARENT = 6,
    LEB_OP_OPEN_OR_CREATE_SIDECAR = 7,
    LEB_OP_ACCESS_ROLE_FILE = 8
};

enum leb_status {
    LEB_STATUS_OK = 0,
    LEB_STATUS_BAD_REQUEST = 1,
    LEB_STATUS_UNAUTHORIZED = 2,
    LEB_STATUS_UNSUPPORTED = 3,
    LEB_STATUS_INTERNAL = 4,
    LEB_STATUS_NOT_FOUND = 5
};

/* All integer fields are encoded in network byte order. */
struct leb_request {
    uint32_t magic;
    uint16_t version;
    uint16_t operation;
    uint32_t flags;
    uint64_t request_id;
    uint32_t payload_length;
} __attribute__((packed));

struct leb_response {
    uint32_t magic;
    uint16_t version;
    uint16_t operation;
    uint32_t status;
    uint64_t request_id;
    uint32_t payload_length;
} __attribute__((packed));

#endif
