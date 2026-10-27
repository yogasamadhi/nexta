package data

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"personal-execution/server/internal/biz"
	"personal-execution/server/internal/data/sqlcdb"
	"strconv"
)

var ErrInvalid = biz.ErrInvalid

type Store struct {
	pool *pgxpool.Pool
	q    *sqlcdb.Queries
	tx   pgx.Tx
}

func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool, q: sqlcdb.New(pool)} }
func mapped(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return biz.ErrNotFound
	}
	var p *pgconn.PgError
	if errors.As(err, &p) {
		switch p.Code {
		case "23505", "23503", "23514", "40001", "40P01":
			return biz.ErrConflict
		}
	}
	return biz.ErrUnavailable
}
func (s *Store) Within(ctx context.Context, work func(biz.Store) error) error {
	if s.tx != nil {
		return work(s)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return mapped(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err = work(&Store{pool: s.pool, q: s.q.WithTx(tx), tx: tx}); err != nil {
		return err
	}
	return mapped(tx.Commit(ctx))
}
func (s *Store) CreateUser(ctx context.Context, u biz.User) error {
	return mapped(s.q.CreateUser(ctx, sqlcdb.CreateUserParams{ID: u.ID, Email: u.Email, PasswordHash: u.PasswordHash}))
}
func (s *Store) FindUser(ctx context.Context, email string) (biz.User, error) {
	u, e := s.q.FindUser(ctx, email)
	return biz.User{ID: u.ID, Email: u.Email, PasswordHash: u.PasswordHash}, mapped(e)
}
func (s *Store) User(ctx context.Context, id string) (biz.User, error) {
	u, e := s.q.GetUser(ctx, id)
	return biz.User{ID: u.ID, Email: u.Email}, mapped(e)
}
func (s *Store) ClaimDevice(ctx context.Context, id, user, install, name string) (string, error) {
	v, e := s.q.ClaimDevice(ctx, sqlcdb.ClaimDeviceParams{ID: id, UserID: user, InstallationID: install, Name: name})
	return v, mapped(e)
}
func (s *Store) Devices(ctx context.Context, user string) ([]biz.Device, error) {
	rows, e := s.q.ListDevices(ctx, user)
	out := []biz.Device{}
	for _, r := range rows {
		out = append(out, biz.Device{ID: r.ID, Name: r.Name, Revoked: r.RevokedAt.Valid})
	}
	return out, mapped(e)
}
func (s *Store) RevokeDevice(ctx context.Context, user, id string) error {
	return mapped(s.q.RevokeDevice(ctx, sqlcdb.RevokeDeviceParams{UserID: user, ID: id}))
}
func (s *Store) CreateSession(ctx context.Context, x biz.Session, hash []byte) error {
	return mapped(s.q.CreateSession(ctx, sqlcdb.CreateSessionParams{ID: x.ID, UserID: x.UserID, DeviceID: x.DeviceID, RefreshHash: hash, ExpiresAt: pgtype.Timestamptz{Time: x.ExpiresAt, Valid: true}}))
}
func (s *Store) Session(ctx context.Context, id string) (biz.Session, error) {
	r, e := s.q.GetSession(ctx, id)
	return biz.Session{ID: r.ID, UserID: r.UserID, DeviceID: r.DeviceID, ExpiresAt: r.ExpiresAt.Time, Revoked: r.RevokedAt.Valid || r.DeviceRevoked.Valid}, mapped(e)
}
func (s *Store) RefreshSession(ctx context.Context, hash []byte) (biz.Session, error) {
	r, e := s.q.FindRefresh(ctx, hash)
	return biz.Session{ID: r.ID, UserID: r.UserID, DeviceID: r.DeviceID, ExpiresAt: r.ExpiresAt.Time, Revoked: r.RevokedAt.Valid}, mapped(e)
}
func (s *Store) RotateSession(ctx context.Context, id string, hash []byte) error {
	return mapped(s.q.RotateSession(ctx, sqlcdb.RotateSessionParams{ID: id, RefreshHash: hash}))
}
func (s *Store) RevokeSession(ctx context.Context, id string) error {
	return mapped(s.q.RevokeSession(ctx, id))
}
func (s *Store) LockHead(ctx context.Context, user string) (int64, error) {
	if e := s.q.EnsureHead(ctx, user); e != nil {
		return 0, mapped(e)
	}
	n, e := s.q.LockHead(ctx, user)
	return n, mapped(e)
}
func (s *Store) Head(ctx context.Context, user string) (int64, error) {
	if e := s.q.EnsureHead(ctx, user); e != nil {
		return 0, mapped(e)
	}
	n, e := s.q.ReadHead(ctx, user)
	return n, mapped(e)
}
func (s *Store) AdvanceHead(ctx context.Context, user string) (int64, error) {
	n, e := s.q.AdvanceHead(ctx, user)
	return n, mapped(e)
}
func (s *Store) Receipt(ctx context.Context, user, id string) (string, *biz.PushResult, error) {
	r, e := s.q.FindBatch(ctx, sqlcdb.FindBatchParams{UserID: user, BatchID: id})
	if e != nil {
		return "", nil, mapped(e)
	}
	var out biz.PushResult
	e = json.Unmarshal(r.Result, &out)
	if e != nil {
		return "", nil, biz.ErrUnavailable
	}
	return r.RequestHash, &out, nil
}
func (s *Store) SaveCommit(ctx context.Context, id biz.Identity, b biz.Batch, hash string, rev int64, result biz.PushResult) error {
	raw, _ := json.Marshal(result)
	if e := s.q.SaveBatch(ctx, sqlcdb.SaveBatchParams{UserID: id.UserID, BatchID: b.BatchID, DeviceID: id.DeviceID, RequestHash: hash, Revision: rev, Result: raw}); e != nil {
		return mapped(e)
	}
	doc, _ := json.Marshal(biz.Commit{Revision: strconv.FormatInt(rev, 10), BatchID: b.BatchID, Entities: result.Entities})
	return mapped(s.q.SaveChange(ctx, sqlcdb.SaveChangeParams{UserID: id.UserID, Revision: rev, BatchID: b.BatchID, Document: doc}))
}
func (s *Store) Entities(ctx context.Context, user string) ([]biz.Entity, error) {
	rows, e := s.q.ListEntities(ctx, user)
	out := []biz.Entity{}
	for _, r := range rows {
		out = append(out, biz.Entity{Kind: r.Kind, Key: r.EntityKey, Version: strconv.FormatInt(r.Version, 10), OwnerDeviceID: r.OwnerDeviceID, Value: r.Document})
	}
	return out, mapped(e)
}
func (s *Store) Entity(ctx context.Context, user, kind, key string) (*biz.Entity, error) {
	r, e := s.q.GetEntity(ctx, sqlcdb.GetEntityParams{UserID: user, Kind: kind, EntityKey: key})
	if errors.Is(e, pgx.ErrNoRows) {
		return nil, nil
	}
	if e != nil {
		return nil, mapped(e)
	}
	return &biz.Entity{Kind: r.Kind, Key: r.EntityKey, Version: strconv.FormatInt(r.Version, 10), OwnerDeviceID: r.OwnerDeviceID, Value: r.Document}, nil
}
func (s *Store) PutEntity(ctx context.Context, user string, e biz.Entity, version int64) error {
	return mapped(putFact(ctx, s.q, user, e.Kind, e.Key, e.OwnerDeviceID, version, e.Value))
}
func (s *Store) Pull(ctx context.Context, user string, cursor int64, limit int32) ([]biz.Commit, error) {
	rows, e := s.q.PullChanges(ctx, sqlcdb.PullChangesParams{UserID: user, Revision: cursor, Limit: limit})
	out := []biz.Commit{}
	for _, r := range rows {
		var c biz.Commit
		if json.Unmarshal(r.Document, &c) != nil {
			return nil, biz.ErrUnavailable
		}
		out = append(out, c)
	}
	return out, mapped(e)
}
func (s *Store) SaveConflict(ctx context.Context, id biz.Identity, b biz.Batch, hash string, remote []biz.Entity) (biz.Conflict, error) {
	local, _ := json.Marshal(b)
	rraw, _ := json.Marshal(remote)
	cid := newID()
	r, e := s.q.SaveConflict(ctx, sqlcdb.SaveConflictParams{ID: cid, UserID: id.UserID, DeviceID: id.DeviceID, BatchID: b.BatchID, RequestHash: hash, LocalBatch: local, RemoteEntities: rraw})
	return biz.Conflict{ID: r.ID, Hash: r.RequestHash, Status: r.Status, Local: b, Remote: remote}, mapped(e)
}
func (s *Store) Conflict(ctx context.Context, user, id string) (biz.Conflict, error) {
	r, e := s.q.GetConflict(ctx, sqlcdb.GetConflictParams{UserID: user, ID: id})
	out := biz.Conflict{ID: r.ID, DeviceID: r.DeviceID, BatchID: r.BatchID, Status: r.Status, Hash: r.RequestHash}
	if e != nil {
		return out, mapped(e)
	}
	if json.Unmarshal(r.LocalBatch, &out.Local) != nil || json.Unmarshal(r.RemoteEntities, &out.Remote) != nil {
		return out, biz.ErrUnavailable
	}
	if len(r.Resolution) > 0 && string(r.Resolution) != "null" {
		out.Result = &biz.PushResult{}
		if json.Unmarshal(r.Resolution, out.Result) != nil {
			return out, biz.ErrUnavailable
		}
	}
	return out, nil
}
func (s *Store) Conflicts(ctx context.Context, id biz.Identity) ([]biz.Conflict, error) {
	rows, e := s.q.ListConflicts(ctx, sqlcdb.ListConflictsParams{UserID: id.UserID, DeviceID: id.DeviceID})
	out := []biz.Conflict{}
	for _, r := range rows {
		c := biz.Conflict{ID: r.ID, BatchID: r.BatchID, Status: r.Status}
		if json.Unmarshal(r.LocalBatch, &c.Local) != nil || json.Unmarshal(r.RemoteEntities, &c.Remote) != nil {
			return nil, biz.ErrUnavailable
		}
		out = append(out, c)
	}
	return out, mapped(e)
}
func (s *Store) ResolveConflict(ctx context.Context, user, id, choice string, result biz.PushResult) error {
	raw, _ := json.Marshal(result)
	return mapped(s.q.ResolveConflict(ctx, sqlcdb.ResolveConflictParams{UserID: user, ID: id, Status: choice, Resolution: raw}))
}
func (s *Store) CreateBootstrap(ctx context.Context, id biz.Identity, b biz.Bootstrap) error {
	raw, _ := json.Marshal(b.Snapshot)
	return mapped(s.q.CreateBootstrap(ctx, sqlcdb.CreateBootstrapParams{ID: b.ID, UserID: id.UserID, DeviceID: id.DeviceID, Direction: b.Direction, Revision: b.Revision, Snapshot: raw}))
}
func (s *Store) Bootstrap(ctx context.Context, id biz.Identity, key string) (biz.Bootstrap, error) {
	r, e := s.q.GetBootstrap(ctx, sqlcdb.GetBootstrapParams{UserID: id.UserID, DeviceID: id.DeviceID, ID: key})
	out := biz.Bootstrap{ID: r.ID, Direction: r.Direction, Status: r.Status, Revision: r.Revision}
	if e != nil {
		return out, mapped(e)
	}
	if json.Unmarshal(r.Chunks, &out.Chunks) != nil || json.Unmarshal(r.Snapshot, &out.Snapshot) != nil {
		return out, biz.ErrUnavailable
	}
	return out, nil
}
func (s *Store) StageBootstrap(ctx context.Context, id, page string, entities []biz.Entity) error {
	raw, _ := json.Marshal(map[string][]biz.Entity{page: entities})
	return mapped(s.q.StageBootstrap(ctx, sqlcdb.StageBootstrapParams{ID: id, Chunk: raw}))
}
func (s *Store) FinishBootstrap(ctx context.Context, id string) error {
	return mapped(s.q.CompleteBootstrap(ctx, id))
}
