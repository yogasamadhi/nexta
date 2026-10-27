package main

import (
	"context"
	"database/sql"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"log/slog"
	"os"
)

func main() {
	if e := run(); e != nil {
		slog.Error("migration failed", "code", "migration_failed")
		os.Exit(1)
	}
}
func run() error {
	db, e := sql.Open("pgx", os.Getenv("DATABASE_URL"))
	if e != nil {
		return e
	}
	defer db.Close()
	if e = goose.SetDialect("postgres"); e != nil {
		return e
	}
	command := "up"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	return goose.RunContext(context.Background(), command, db, "db/migrations")
}
