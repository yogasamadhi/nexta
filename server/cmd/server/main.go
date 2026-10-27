package main

import (
	"context"
	"github.com/go-kratos/kratos/v3"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"os"
	"personal-execution/server/internal/biz"
	"personal-execution/server/internal/data"
	"personal-execution/server/internal/service"
	"personal-execution/server/internal/transport"
	"time"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func main() {
	if err := run(); err != nil {
		slog.Error("server stopped", "code", "startup_or_runtime_failed")
		os.Exit(1)
	}
}
func run() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, e := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if e != nil {
		return e
	}
	defer pool.Close()
	if e = pool.Ping(ctx); e != nil {
		return e
	}
	store := data.New(pool)
	auth := &biz.Auth{Store: store, Secret: []byte(os.Getenv("ACCESS_TOKEN_SECRET")), AllowRegistration: os.Getenv("ALLOW_UNVERIFIED_REGISTRATION") == "true"}
	if e = auth.Validate(); e != nil {
		return e
	}
	cloud := &service.Cloud{Auth: auth, Sync: &biz.Sync{Store: store}}
	app := kratos.New(kratos.Name("personal-execution-cloud"), kratos.Version("0.1.0"), kratos.Server(transport.NewHTTP(env("HTTP_ADDR", "127.0.0.1:8000"), cloud, pool.Ping), transport.NewGRPC(env("GRPC_ADDR", "127.0.0.1:9000"), cloud)))
	return app.Run()
}
