CC ?= cc
CFLAGS ?= -O2 -g -std=c11 -Wall -Wextra -Werror -Wconversion -Wshadow -Wformat=2 -fstack-protector-strong
LDFLAGS ?=

.PHONY: all test clean
all: broker_server broker_ping

broker_server: broker_server.c broker_protocol.h
	$(CC) $(CFLAGS) $(LDFLAGS) broker_server.c -o $@

broker_ping: broker_ping.c broker_protocol.h
	$(CC) $(CFLAGS) $(LDFLAGS) broker_ping.c -o $@

quarantine_delete_test: test_quarantine_delete.c quarantine_delete.c quarantine_delete.h
	$(CC) $(CFLAGS) -DLEB_TESTING $(LDFLAGS) test_quarantine_delete.c quarantine_delete.c -o $@

test: all quarantine_delete_test
	./quarantine_delete_test
	python3 test_protocol.py
	python3 test_manifest_store.py
	python3 test_broker_daemon.py

clean:
	rm -f broker_server broker_ping quarantine_delete_test
