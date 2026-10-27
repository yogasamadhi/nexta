SHELL := /bin/sh
TOOLS := $(abspath ../.artifacts/server-tools)
export PATH := $(TOOLS):$(PATH)

.PHONY: tools generate check test integration migrate run db-up db-down

tools:
	mkdir -p $(TOOLS)
	GOBIN=$(TOOLS) go install github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1
	GOBIN=$(TOOLS) go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.11
	GOBIN=$(TOOLS) go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.6.2
	GOBIN=$(TOOLS) go install github.com/go-kratos/kratos/cmd/protoc-gen-go-http/v3@v3.0.0-20261021071621-3f6b3b6c412f
	GOBIN=$(TOOLS) go install github.com/google/gnostic/cmd/protoc-gen-openapi@v0.7.1
	GOBIN=$(TOOLS) go install github.com/bufbuild/buf/cmd/buf@v1.72.0

generate:
	python3 tools/generate.py
	@PATH="$(TOOLS):$(PATH)" sqlc generate
	@PATH="$(TOOLS):$(PATH)" buf generate
	gofmt -w internal/data/facts_generated.go
	cd .. && pnpm exec prettier --write packages/application/src/sync-entity-fields.ts server/openapi.yaml

check:
	test -z "$$(gofmt -l cmd internal contracts sync)"
	go vet ./...
	go test ./...
	go build ./...

test:
	go test -race ./...

integration:
	@test -n "$(TEST_DATABASE_URL)" || (echo 'TEST_DATABASE_URL is required'; exit 1)
	go test -race -tags integration ./internal/data -count=1

migrate:
	go run ./cmd/migrate

run:
	go run ./cmd/server

db-up:
	docker compose up -d --wait

db-down:
	docker compose stop
