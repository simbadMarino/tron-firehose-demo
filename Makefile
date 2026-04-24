SHELL := /usr/bin/env bash
GO_BIN ?= go

.PHONY: install-tools install-node-deps start-firehose stream demo

install-tools:
	GO_BIN=$(GO_BIN) ./scripts/install-tools.sh

install-node-deps:
	npm install

start-firehose:
	./scripts/start-firehose.sh

stream:
	npm run stream --

demo:
	./scripts/demo.sh
