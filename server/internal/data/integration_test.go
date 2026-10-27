//go:build integration

package data_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"personal-execution/server/internal/biz"
	"personal-execution/server/internal/data"
	"personal-execution/server/internal/service"
	"personal-execution/server/internal/transport"
	"strconv"
	"sync"
	"testing"
)

func setup(t *testing.T) (*biz.Auth, *biz.Sync, *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	base, e := pgxpool.New(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	schema := "test_" + uuid.NewString()
	schema = string(bytes.ReplaceAll([]byte(schema), []byte("-"), []byte("")))
	if _, e = base.Exec(ctx, `CREATE SCHEMA "`+schema+`"`); e != nil {
		t.Fatal(e)
	}
	u, e := url.Parse(dsn)
	if e != nil {
		t.Fatal(e)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, e := sql.Open("pgx", u.String())
	if e != nil {
		t.Fatal(e)
	}
	if e = goose.SetDialect("postgres"); e != nil {
		t.Fatal(e)
	}
	if e = goose.Up(db, "../../db/migrations"); e != nil {
		t.Fatal(e)
	}
	_ = db.Close()
	pool, e := pgxpool.New(ctx, u.String())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { pool.Close(); _, _ = base.Exec(ctx, `DROP SCHEMA "`+schema+`" CASCADE`); base.Close() })
	store := data.New(pool)
	return &biz.Auth{Store: store, Secret: bytes.Repeat([]byte("s"), 32), AllowRegistration: true}, &biz.Sync{Store: store}, pool
}
func login(t *testing.T, a *biz.Auth, email, install string, register bool) biz.Tokens {
	t.Helper()
	v, e := a.Login(context.Background(), biz.Credentials{Email: email, Password: "correct horse battery staple", InstallationID: install, DeviceName: "test device"}, register)
	if e != nil {
		t.Fatal(e)
	}
	return v
}
func ident(t biz.Tokens) biz.Identity { return biz.Identity{UserID: t.UserID, DeviceID: t.DeviceID} }
func goal(id string) biz.Entity {
	return biz.Entity{Kind: "goal", Key: id, Version: "0", Value: json.RawMessage(`{"id":"` + id + `","title":"Plan","description":"","status":"active","targetDate":null,"createdAt":"2026-10-25T00:00:00.000Z","updatedAt":"2026-10-25T00:00:00.000Z","archivedAt":null}`)}
}
func batch(id string, e ...biz.Entity) biz.Batch {
	return biz.Batch{SchemaVersion: 1, BatchID: id, Changes: e}
}
func TestAuthAndIsolation(t *testing.T) {
	a, s, _ := setup(t)
	ctx := context.Background()
	first := login(t, a, "a@example.test", "install_aaaaaaaa", true)
	second := login(t, a, "a@example.test", "install_bbbbbbbb", false)
	other := login(t, a, "b@example.test", "install_cccccccc", true)
	if first.DeviceID == second.DeviceID {
		t.Fatal("distinct devices")
	}
	id, e := a.Authenticate(ctx, first.AccessToken)
	if e != nil {
		t.Fatal(e)
	}
	_, e = a.Login(ctx, biz.Credentials{Email: "a@example.test", Password: "invalid password long", InstallationID: "install_a", DeviceName: "test"}, false)
	if !errors.Is(e, biz.ErrUnauthorized) {
		t.Fatal("bad password accepted")
	}
	_, e = s.Push(ctx, id, batch("batch_first", goal("g1")))
	if e != nil {
		t.Fatal(e)
	}
	rows, _, _, e := s.Pull(ctx, ident(other), "0", 50)
	if e != nil || len(rows) != 0 {
		t.Fatal("tenant data leaked")
	}
	fresh, e := a.Refresh(ctx, first.RefreshToken)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = a.Refresh(ctx, first.RefreshToken); !errors.Is(e, biz.ErrUnauthorized) {
		t.Fatal("old refresh accepted")
	}
	if e = a.Store.RevokeDevice(ctx, id.UserID, id.DeviceID); e != nil {
		t.Fatal(e)
	}
	if _, e = a.Authenticate(ctx, fresh.AccessToken); !errors.Is(e, biz.ErrUnauthorized) {
		t.Fatal("revoked access accepted")
	}
}
func TestAtomicReplayConflictAndOrdering(t *testing.T) {
	a, s, pool := setup(t)
	ctx := context.Background()
	u := login(t, a, "s@example.test", "install_aaaaaaaa", true)
	id := ident(u)
	b := batch("batch_initial", goal("g1"))
	first, e := s.Push(ctx, id, b)
	if e != nil || first.Revision != "1" {
		t.Fatalf("push: %+v %v", first, e)
	}
	again, e := s.Push(ctx, id, b)
	if e != nil || again.Revision != "1" {
		t.Fatal("replay")
	}
	changed := b
	changed.Changes = []biz.Entity{goal("g2")}
	if _, e = s.Push(ctx, id, changed); !errors.Is(e, biz.ErrConflict) {
		t.Fatal("batch identity changed")
	}
	c, e := s.Push(ctx, id, batch("batch_conflict", goal("g1")))
	if e != nil || c.ConflictID == "" {
		t.Fatalf("version conflict %+v %v", c, e)
	}
	if n, _ := a.Store.Head(ctx, id.UserID); n != 1 {
		t.Fatal("conflict advanced head")
	}
	r, e := s.Resolve(ctx, id, c.ConflictID, "cloud", nil)
	if e != nil || len(r.Entities) != 1 {
		t.Fatal("cloud resolution", e)
	}
	r2, e := s.Resolve(ctx, id, c.ConflictID, "cloud", nil)
	if e != nil || r2.Revision != r.Revision {
		t.Fatal("resolution replay")
	}
	var wg sync.WaitGroup
	errs := make(chan error, 6)
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, e := s.Push(ctx, id, batch(fmt.Sprintf("parallel_%d", i), goal(fmt.Sprintf("parallel_g%d", i))))
			errs <- e
		}(i)
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	rows, cursor, more, e := s.Pull(ctx, id, "0", 3)
	if e != nil || len(rows) != 3 || !more || cursor != "3" {
		t.Fatal("ordered page", e)
	}
	rows, cursor, more, e = s.Pull(ctx, id, cursor, 10)
	if e != nil || len(rows) != 4 || more || cursor != "7" {
		t.Fatal("continuation", e)
	}
	var count int
	if e = pool.QueryRow(ctx, "SELECT count(*) FROM facts_goal WHERE user_id=$1", id.UserID).Scan(&count); e != nil || count != 7 {
		t.Fatal("fact count", count, e)
	}
}
func TestBootstrapStagingAndFixedSnapshot(t *testing.T) {
	a, s, _ := setup(t)
	ctx := context.Background()
	u := login(t, a, "boot@example.test", "install_aaaaaaaa", true)
	id := ident(u)
	state, _, _, _, e := s.Bootstrap(ctx, id, "", "upload", 0, 0, []biz.Entity{goal("g1")})
	if e != nil {
		t.Fatal(e)
	}
	if n, _ := a.Store.Head(ctx, id.UserID); n != 0 {
		t.Fatal("staging published")
	}
	if _, _, _, _, e = s.Bootstrap(ctx, id, state.ID, "commit", 0, 2, nil); !errors.Is(e, biz.ErrInvalid) {
		t.Fatal("missing chunk accepted")
	}
	_, entities, _, cid, e := s.Bootstrap(ctx, id, state.ID, "commit", 0, 1, nil)
	if e != nil || cid != "" || len(entities) != 1 {
		t.Fatal("bootstrap commit", e)
	}
	snap, rows, _, _, e := s.Bootstrap(ctx, id, "", "download", 0, 0, nil)
	if e != nil || len(rows) != 1 {
		t.Fatal(e)
	}
	_, e = s.Push(ctx, id, batch("batch_later", goal("g2")))
	if e != nil {
		t.Fatal(e)
	}
	_, rows, _, _, e = s.Bootstrap(ctx, id, snap.ID, "download", 0, 0, nil)
	if e != nil || len(rows) != 1 {
		t.Fatal("snapshot changed", e)
	}
}
func TestHTTPBoundary(t *testing.T) {
	a, s, pool := setup(t)
	cloud := &service.Cloud{Auth: a, Sync: s}
	server := transport.NewHTTP("", cloud, pool.Ping)
	ts := httptest.NewServer(server)
	defer ts.Close()
	post := func(path, body, token string) (int, map[string]any) {
		t.Helper()
		req, _ := http.NewRequest("POST", ts.URL+path, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		r, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer r.Body.Close()
		raw, _ := io.ReadAll(r.Body)
		var v map[string]any
		_ = json.Unmarshal(raw, &v)
		return r.StatusCode, v
	}
	code, _ := post("/v1/auth/register", `{"email":"http@example.test","password":"correct horse battery staple","installationId":"install_http","deviceName":"test","authority":"admin"}`, "")
	if code != 400 {
		t.Fatal("unknown auth field", code)
	}
	code, v := post("/v1/auth/register", `{"email":"http@example.test","password":"correct horse battery staple","installationId":"install_http","deviceName":"test"}`, "")
	if code != 200 {
		t.Fatal("register", code, v)
	}
	access := v["accessToken"].(string)
	raw, _ := json.Marshal(batch("batch_http", goal("http_goal")))
	code, v = post("/v1/sync/push", string(raw), access)
	if code != 200 || v["revision"] != "1" {
		t.Fatal("HTTP push", code, v)
	}
	code, _ = post("/v1/sync/push", string(raw), "")
	if code != 401 {
		t.Fatal("anonymous sync", code)
	}
	for i := 0; i < 11; i++ {
		code, _ = post("/v1/auth/login", `{"email":"none@example.test","password":"incorrect password long","installationId":"install_http","deviceName":"test"}`, "")
	}
	if code != 429 {
		t.Fatal("login limiter", strconv.Itoa(code))
	}
}

func TestPortableGraphAndImmutableEvidence(t *testing.T) {
	a, s, pool := setup(t)
	ctx := context.Background()
	tokens := login(t, a, "facts@example.test", "installation_facts", true)
	id := ident(tokens)
	raw, e := os.ReadFile("../../contracts/fixtures.json")
	if e != nil {
		t.Fatal(e)
	}
	var b biz.Batch
	if e = json.Unmarshal(raw, &b); e != nil {
		t.Fatal(e)
	}
	result, e := s.Push(ctx, id, b)
	if e != nil || result.ConflictID != "" || len(result.Entities) != len(b.Changes) {
		t.Fatalf("graph push: %+v %v", result, e)
	}
	var count int
	if e = pool.QueryRow(ctx, "SELECT count(*) FROM facts_completion_record WHERE user_id=$1", id.UserID).Scan(&count); e != nil || count != 1 {
		t.Fatal("completion count", count, e)
	}
	for _, entity := range result.Entities {
		if entity.Kind != "execution_interval" {
			continue
		}
		var value map[string]any
		_ = json.Unmarshal(entity.Value, &value)
		value["endAt"] = "2026-10-25T10:25:00.000Z"
		entity.Value, _ = json.Marshal(value)
		conflict, e := s.Push(ctx, id, batch("immutable_interval", entity))
		if e != nil || conflict.ConflictID == "" {
			t.Fatal("immutable evidence overwritten", e)
		}
	}
	second := login(t, a, "facts@example.test", "installation_second", false)
	for _, entity := range result.Entities {
		if entity.Kind != "relax_session" {
			continue
		}
		var value map[string]any
		_ = json.Unmarshal(entity.Value, &value)
		value["actualSeconds"] = 100
		entity.Value, _ = json.Marshal(value)
		if _, e = s.Push(ctx, ident(second), batch("remote_relax_end", entity)); !errors.Is(e, biz.ErrForbidden) {
			t.Fatal("remote session mutation allowed", e)
		}
	}
}
