package biz

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrInvalid      = errors.New("invalid_request")
	ErrUnauthorized = errors.New("unauthenticated")
	ErrForbidden    = errors.New("forbidden")
	ErrConflict     = errors.New("conflict")
	ErrNotFound     = errors.New("not_found")
	ErrUnavailable  = errors.New("unavailable")
)

type User struct{ ID, Email, PasswordHash string }
type Device struct {
	ID, Name string
	Revoked  bool
}
type Session struct {
	ID, UserID, DeviceID string
	ExpiresAt            time.Time
	Revoked              bool
}
type Identity struct{ UserID, DeviceID, SessionID string }
type Entity struct {
	Kind          string          `json:"kind"`
	Key           string          `json:"key"`
	Version       string          `json:"version"`
	OwnerDeviceID string          `json:"ownerDeviceId"`
	Value         json.RawMessage `json:"value"`
}
type Batch struct {
	SchemaVersion uint32   `json:"schemaVersion"`
	BatchID       string   `json:"batchId"`
	Changes       []Entity `json:"changes"`
}
type PushResult struct {
	Revision   string   `json:"revision"`
	Entities   []Entity `json:"entities"`
	ConflictID string   `json:"conflictId"`
}
type Commit struct {
	Revision string   `json:"revision"`
	BatchID  string   `json:"batchId"`
	Entities []Entity `json:"entities"`
}
type Conflict struct {
	ID, DeviceID, BatchID, Status, Hash string
	Local                               Batch
	Remote                              []Entity
	Result                              *PushResult
}
type Bootstrap struct {
	ID, Direction, Status string
	Revision              int64
	Chunks                map[string][]Entity
	Snapshot              []Entity
}

// Store instances passed to Within are bound to one PostgreSQL transaction.
type Store interface {
	Within(context.Context, func(Store) error) error
	CreateUser(context.Context, User) error
	FindUser(context.Context, string) (User, error)
	User(context.Context, string) (User, error)
	ClaimDevice(context.Context, string, string, string, string) (string, error)
	Devices(context.Context, string) ([]Device, error)
	RevokeDevice(context.Context, string, string) error
	CreateSession(context.Context, Session, []byte) error
	Session(context.Context, string) (Session, error)
	RefreshSession(context.Context, []byte) (Session, error)
	RotateSession(context.Context, string, []byte) error
	RevokeSession(context.Context, string) error
	LockHead(context.Context, string) (int64, error)
	Head(context.Context, string) (int64, error)
	AdvanceHead(context.Context, string) (int64, error)
	Receipt(context.Context, string, string) (string, *PushResult, error)
	SaveCommit(context.Context, Identity, Batch, string, int64, PushResult) error
	Entities(context.Context, string) ([]Entity, error)
	Entity(context.Context, string, string, string) (*Entity, error)
	PutEntity(context.Context, string, Entity, int64) error
	Pull(context.Context, string, int64, int32) ([]Commit, error)
	SaveConflict(context.Context, Identity, Batch, string, []Entity) (Conflict, error)
	Conflict(context.Context, string, string) (Conflict, error)
	Conflicts(context.Context, Identity) ([]Conflict, error)
	ResolveConflict(context.Context, string, string, string, PushResult) error
	CreateBootstrap(context.Context, Identity, Bootstrap) error
	Bootstrap(context.Context, Identity, string) (Bootstrap, error)
	StageBootstrap(context.Context, string, string, []Entity) error
	FinishBootstrap(context.Context, string) error
}
