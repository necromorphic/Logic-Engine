#define _GNU_SOURCE
#include "broker_protocol.h"

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <signal.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/time.h>
#include <sys/un.h>
#include <unistd.h>

static volatile sig_atomic_t stop_requested;
static int listener_fd = -1;
static char socket_path[sizeof(((struct sockaddr_un *)0)->sun_path)];
static dev_t socket_dev;
static ino_t socket_ino;
static uid_t allowed_uid;

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

static void on_signal(int signo) {
    (void)signo;
    stop_requested = 1;
}

static int validate_socket_directory(const char *path, uid_t app_uid) {
    char copy[PATH_MAX];
    char *slash;
    char *component;
    char *saveptr = NULL;
    struct stat st;
    int dir_fd = -1;
    int next_fd = -1;

    if (!path || strlen(path) >= sizeof(copy) || path[0] != '/') return -1;
    strcpy(copy, path);
    slash = strrchr(copy, '/');
    if (!slash || slash == copy) return -1;
    *slash = '\0';

    /*
     * Walk every component without following symlinks. The final bind() still
     * uses a pathname, so every ancestor must be outside the application's
     * mutation authority before that pathname can be trusted.
     */
    dir_fd = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dir_fd < 0) return -1;

    component = strtok_r(copy + 1, "/", &saveptr);
    if (!component) {
        close(dir_fd);
        return -1;
    }
    while (component) {
        char *next_component = strtok_r(NULL, "/", &saveptr);
        if (strcmp(component, ".") == 0 || strcmp(component, "..") == 0) {
            close(dir_fd);
            return -1;
        }
        next_fd = openat(dir_fd, component,
                         O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
        if (next_fd < 0 || fstat(next_fd, &st) != 0 ||
            !S_ISDIR(st.st_mode) || (st.st_mode & 0022) != 0 ||
            (app_uid != geteuid() && st.st_uid == app_uid &&
             (st.st_mode & S_IWUSR) != 0)) {
            if (next_fd >= 0) close(next_fd);
            close(dir_fd);
            return -1;
        }
        close(dir_fd);
        dir_fd = next_fd;
        next_fd = -1;
        if (!next_component &&
            (st.st_uid != geteuid() || (st.st_mode & 0022) != 0)) {
            close(dir_fd);
            return -1;
        }
        component = next_component;
    }
    close(dir_fd);
    return 0;
}

static int send_status(int fd, uint16_t operation, uint64_t request_id,
                       uint32_t status) {
    struct leb_response response;
    ssize_t sent;

    memset(&response, 0, sizeof(response));
    response.magic = htonl(LEB_PROTOCOL_MAGIC);
    response.version = htons(LEB_PROTOCOL_VERSION);
    response.operation = htons(operation);
    response.status = htonl(status);
    response.request_id = host_to_be64(request_id);
    response.payload_length = htonl(0);

    do {
        sent = send(fd, &response, sizeof(response), MSG_NOSIGNAL);
    } while (sent < 0 && errno == EINTR);

    return sent == (ssize_t)sizeof(response) ? 0 : -1;
}

static int reject_ancillary_and_close_fds(struct msghdr *message) {
    struct cmsghdr *header;
    int found = 0;

    for (header = CMSG_FIRSTHDR(message); header != NULL;
         header = CMSG_NXTHDR(message, header)) {
        found = 1;
        if (header->cmsg_level == SOL_SOCKET &&
            header->cmsg_type == SCM_RIGHTS &&
            header->cmsg_len >= CMSG_LEN(0)) {
            size_t bytes = header->cmsg_len - CMSG_LEN(0);
            size_t count = bytes / sizeof(int);
            int *fds = (int *)CMSG_DATA(header);
            size_t i;
            for (i = 0; i < count; i++) close(fds[i]);
        }
    }
    return found;
}

static void serve_client(int fd) {
    struct ucred peer;
    socklen_t peer_len = sizeof(peer);
    unsigned char packet[LEB_MAX_PACKET_SIZE];
    char control[CMSG_SPACE(sizeof(int) * 16)];
    struct iovec iov = { .iov_base = packet, .iov_len = sizeof(packet) };
    struct msghdr message;
    struct leb_request request;
    ssize_t received;
    uint32_t magic, flags, payload_length;
    uint16_t version, operation;
    uint64_t request_id;
    uint32_t status;

    if (getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &peer, &peer_len) != 0 ||
        peer_len != sizeof(peer)) return;

    memset(&message, 0, sizeof(message));
    memset(control, 0, sizeof(control));
    message.msg_iov = &iov;
    message.msg_iovlen = 1;
    message.msg_control = control;
    message.msg_controllen = sizeof(control);

    {
        const struct timeval receive_timeout = { .tv_sec = 1, .tv_usec = 0 };
        if (setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &receive_timeout,
                       sizeof(receive_timeout)) != 0) return;
    }

    do {
        received = recvmsg(fd, &message, MSG_CMSG_CLOEXEC);
    } while (received < 0 && errno == EINTR);

    if (received < 0) return;
    if (reject_ancillary_and_close_fds(&message)) return;
    if (peer.uid != allowed_uid) {
        (void)send_status(fd, 0, 0, LEB_STATUS_UNAUTHORIZED);
        return;
    }
    if ((message.msg_flags & (MSG_TRUNC | MSG_CTRUNC)) != 0 ||
        received != (ssize_t)sizeof(request)) return;

    memcpy(&request, packet, sizeof(request));
    magic = ntohl(request.magic);
    version = ntohs(request.version);
    operation = ntohs(request.operation);
    flags = ntohl(request.flags);
    request_id = be64_to_host(request.request_id);
    payload_length = ntohl(request.payload_length);

    if (magic != LEB_PROTOCOL_MAGIC || version != LEB_PROTOCOL_VERSION ||
        flags != 0 || payload_length != 0) {
        status = LEB_STATUS_BAD_REQUEST;
    } else if (operation == LEB_OP_PING) {
        status = LEB_STATUS_OK;
    } else {
        status = LEB_STATUS_UNSUPPORTED;
    }

    (void)send_status(fd, operation, request_id, status);
}

static void cleanup(void) {
    struct stat st;
    if (listener_fd >= 0) close(listener_fd);
    if (socket_path[0] != '\0' && lstat(socket_path, &st) == 0 &&
        S_ISSOCK(st.st_mode) && st.st_dev == socket_dev &&
        st.st_ino == socket_ino) {
        (void)unlink(socket_path);
    }
}

int main(int argc, char **argv) {
    struct sockaddr_un address;
    struct stat st;
    struct sigaction action;
    char *end = NULL;
    unsigned long parsed_uid;
    int client;

    if (argc != 5 || strcmp(argv[1], "--socket") != 0 ||
        strcmp(argv[3], "--app-uid") != 0) {
        fprintf(stderr, "usage: %s --socket PATH --app-uid UID\n", argv[0]);
        return 2;
    }
    errno = 0;
    parsed_uid = strtoul(argv[4], &end, 10);
    if (errno != 0 || end == argv[4] || *end != '\0' ||
        parsed_uid > (unsigned long)((uid_t)-1)) {
        fprintf(stderr, "invalid --app-uid\n");
        return 2;
    }
    allowed_uid = (uid_t)parsed_uid;

    if (argv[2][0] != '/' || strlen(argv[2]) >= sizeof(socket_path) ||
        validate_socket_directory(argv[2], allowed_uid) != 0) {
        fprintf(stderr, "socket parent path must contain no symlinks or application-writable ancestors and end in a broker-owned directory\n");
        return 2;
    }
    strcpy(socket_path, argv[2]);
    if (lstat(socket_path, &st) == 0 || errno != ENOENT) {
        fprintf(stderr, "socket path already exists or cannot be inspected; refusing to replace it\n");
        return 2;
    }

    umask(0077);
    listener_fd = socket(AF_UNIX, SOCK_SEQPACKET | SOCK_CLOEXEC, 0);
    if (listener_fd < 0) {
        perror("socket");
        return 1;
    }
    memset(&address, 0, sizeof(address));
    address.sun_family = AF_UNIX;
    strcpy(address.sun_path, socket_path);
    if (bind(listener_fd, (struct sockaddr *)&address, sizeof(address)) != 0) {
        perror("bind");
        cleanup();
        return 1;
    }
    if (lstat(socket_path, &st) != 0) {
        perror("inspect bound socket");
        cleanup();
        return 1;
    }
    socket_dev = st.st_dev;
    socket_ino = st.st_ino;
    if (chmod(socket_path, 0600) != 0) {
        perror("secure socket permissions");
        cleanup();
        return 1;
    }
    if (listen(listener_fd, 16) != 0) {
        perror("listen");
        cleanup();
        return 1;
    }

    memset(&action, 0, sizeof(action));
    action.sa_handler = on_signal;
    sigemptyset(&action.sa_mask);
    sigaction(SIGINT, &action, NULL);
    sigaction(SIGTERM, &action, NULL);

    fprintf(stderr, "broker ready; allowed application UID=%lu\n", parsed_uid);
    while (!stop_requested) {
        client = accept4(listener_fd, NULL, NULL, SOCK_CLOEXEC);
        if (client < 0) {
            if (errno == EINTR) continue;
            if (stop_requested) break;
            perror("accept4");
            cleanup();
            return 1;
        }
        serve_client(client);
        close(client);
    }
    cleanup();
    return 0;
}
