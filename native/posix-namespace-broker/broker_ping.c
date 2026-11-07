#define _GNU_SOURCE
#include "broker_protocol.h"

#include <arpa/inet.h>
#include <errno.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

static uint64_t host_to_be64(uint64_t value) {
#if __BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__
    return ((uint64_t)htonl((uint32_t)(value & 0xffffffffu)) << 32) |
           htonl((uint32_t)(value >> 32));
#else
    return value;
#endif
}

static uint64_t be64_to_host(uint64_t value) {
    return host_to_be64(value);
}

int main(int argc, char **argv) {
    int fd;
    struct sockaddr_un address;
    struct leb_request request;
    struct leb_response response;
    ssize_t count;

    if (argc != 2 || strlen(argv[1]) >= sizeof(address.sun_path)) {
        fprintf(stderr, "usage: %s SOCKET_PATH\n", argv[0]);
        return 2;
    }
    fd = socket(AF_UNIX, SOCK_SEQPACKET | SOCK_CLOEXEC, 0);
    if (fd < 0) { perror("socket"); return 1; }

    memset(&address, 0, sizeof(address));
    address.sun_family = AF_UNIX;
    strcpy(address.sun_path, argv[1]);
    if (connect(fd, (struct sockaddr *)&address, sizeof(address)) != 0) {
        perror("connect"); close(fd); return 1;
    }

    memset(&request, 0, sizeof(request));
    request.magic = htonl(LEB_PROTOCOL_MAGIC);
    request.version = htons(LEB_PROTOCOL_VERSION);
    request.operation = htons(LEB_OP_PING);
    request.request_id = host_to_be64(1);

    if (send(fd, &request, sizeof(request), MSG_NOSIGNAL) != (ssize_t)sizeof(request)) {
        perror("send"); close(fd); return 1;
    }
    count = recv(fd, &response, sizeof(response), 0);
    close(fd);
    if (count != (ssize_t)sizeof(response) ||
        ntohl(response.magic) != LEB_PROTOCOL_MAGIC ||
        ntohs(response.version) != LEB_PROTOCOL_VERSION ||
        ntohs(response.operation) != LEB_OP_PING ||
        ntohl(response.status) != LEB_STATUS_OK ||
        be64_to_host(response.request_id) != 1 ||
        ntohl(response.payload_length) != 0) {
        fprintf(stderr, "broker returned an invalid or unsuccessful PING response\n");
        return 1;
    }
    puts("broker PING: OK");
    return 0;
}
