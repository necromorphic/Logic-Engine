CC ?= cc
CFLAGS ?= -O2 -g -std=c11 -Wall -Wextra -Werror -Wconversion -Wshadow -Wformat=2 -fstack-protector-strong
LDFLAGS ?=

.PHONY: all test clean
all: broker_server broker_ping

broker_server: broker_server.c broker_protocol.h
	$(CC) $(CFLAGS) $(LDFLAGS) broker_server.c -o $@

broker_ping: broker_ping.c broker_protocol.h
	$(CC) $(CFLAGS) $(LDFLAGS) broker_ping.c -o $@

test: all
	python3 test_protocol.py
	python3 test_manifest_store.py

clean:
	rm -f broker_server broker_ping
