package service

import (
	"context"
	"encoding/json"
	"errors"
	kerrors "github.com/go-kratos/kratos/v3/errors"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
	"personal-execution/server/internal/biz"
	v1 "personal-execution/server/sync/v1"
	"strconv"
)

type identityKey struct{}

func WithIdentity(ctx context.Context, id biz.Identity) context.Context {
	return context.WithValue(ctx, identityKey{}, id)
}
func Identity(ctx context.Context) biz.Identity {
	id, _ := ctx.Value(identityKey{}).(biz.Identity)
	return id
}
func Public(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, biz.ErrInvalid):
		return kerrors.BadRequest("INVALID_REQUEST", "Request is invalid.")
	case errors.Is(err, biz.ErrUnauthorized):
		return kerrors.Unauthorized("UNAUTHENTICATED", "Authentication required.")
	case errors.Is(err, biz.ErrForbidden):
		return kerrors.Forbidden("FORBIDDEN", "Operation is not allowed.")
	case errors.Is(err, biz.ErrNotFound):
		return kerrors.NotFound("NOT_FOUND", "Resource not found.")
	case errors.Is(err, biz.ErrConflict):
		return kerrors.Conflict("CONFLICT", "The operation conflicts with existing facts.")
	default:
		return kerrors.ServiceUnavailable("UNAVAILABLE", "Service temporarily unavailable.")
	}
}

type Cloud struct {
	v1.UnimplementedCloudServer
	Auth *biz.Auth
	Sync *biz.Sync
}

func tokens(t biz.Tokens) *v1.Tokens {
	return &v1.Tokens{UserId: t.UserID, DeviceId: t.DeviceID, Email: t.Email, AccessToken: t.AccessToken, RefreshToken: t.RefreshToken, ExpiresIn: t.ExpiresIn}
}
func credentials(r *v1.AuthRequest) biz.Credentials {
	return biz.Credentials{Email: r.Email, Password: r.Password, InstallationID: r.InstallationId, DeviceName: r.DeviceName}
}
func (c *Cloud) Register(ctx context.Context, r *v1.AuthRequest) (*v1.Tokens, error) {
	v, e := c.Auth.Login(ctx, credentials(r), true)
	return tokens(v), Public(e)
}
func (c *Cloud) Login(ctx context.Context, r *v1.AuthRequest) (*v1.Tokens, error) {
	v, e := c.Auth.Login(ctx, credentials(r), false)
	return tokens(v), Public(e)
}
func (c *Cloud) Refresh(ctx context.Context, r *v1.RefreshRequest) (*v1.Tokens, error) {
	v, e := c.Auth.Refresh(ctx, r.RefreshToken)
	return tokens(v), Public(e)
}
func (c *Cloud) Logout(ctx context.Context, _ *v1.Empty) (*v1.Empty, error) {
	return &v1.Empty{}, Public(c.Auth.Store.RevokeSession(ctx, Identity(ctx).SessionID))
}
func (c *Cloud) Me(ctx context.Context, _ *v1.Empty) (*v1.User, error) {
	v, e := c.Auth.Store.User(ctx, Identity(ctx).UserID)
	return &v1.User{Id: v.ID, Email: v.Email}, Public(e)
}
func (c *Cloud) ListDevices(ctx context.Context, _ *v1.Empty) (*v1.Devices, error) {
	rows, e := c.Auth.Store.Devices(ctx, Identity(ctx).UserID)
	out := &v1.Devices{Devices: []*v1.Device{}}
	for _, v := range rows {
		out.Devices = append(out.Devices, &v1.Device{Id: v.ID, Name: v.Name, Revoked: v.Revoked})
	}
	return out, Public(e)
}
func (c *Cloud) RevokeDevice(ctx context.Context, r *v1.DeviceRequest) (*v1.Empty, error) {
	return &v1.Empty{}, Public(c.Auth.Store.RevokeDevice(ctx, Identity(ctx).UserID, r.Id))
}
func entity(e *v1.Entity) biz.Entity {
	raw, _ := e.Value.MarshalJSON()
	return biz.Entity{Kind: e.Kind, Key: e.Key, Version: e.Version, OwnerDeviceID: e.OwnerDeviceId, Value: raw}
}
func entities(rows []*v1.Entity) []biz.Entity {
	out := make([]biz.Entity, 0, len(rows))
	for _, v := range rows {
		out = append(out, entity(v))
	}
	return out
}
func wireEntities(rows []biz.Entity) []*v1.Entity {
	out := []*v1.Entity{}
	for _, e := range rows {
		v := &structpb.Struct{}
		_ = v.UnmarshalJSON(e.Value)
		out = append(out, &v1.Entity{Kind: e.Kind, Key: e.Key, Version: e.Version, OwnerDeviceId: e.OwnerDeviceID, Value: v})
	}
	return out
}
func batch(r *v1.Batch) biz.Batch {
	if r == nil {
		return biz.Batch{}
	}
	return biz.Batch{SchemaVersion: r.SchemaVersion, BatchID: r.BatchId, Changes: entities(r.Changes)}
}
func wireBatch(b biz.Batch) *v1.Batch {
	return &v1.Batch{SchemaVersion: b.SchemaVersion, BatchId: b.BatchID, Changes: wireEntities(b.Changes)}
}
func result(r biz.PushResult) *v1.PushResponse {
	return &v1.PushResponse{Revision: r.Revision, Entities: wireEntities(r.Entities), ConflictId: r.ConflictID}
}
func (c *Cloud) Push(ctx context.Context, r *v1.Batch) (*v1.PushResponse, error) {
	v, e := c.Sync.Push(ctx, Identity(ctx), batch(r))
	return result(v), Public(e)
}
func (c *Cloud) Pull(ctx context.Context, r *v1.PullRequest) (*v1.PullResponse, error) {
	rows, cursor, more, e := c.Sync.Pull(ctx, Identity(ctx), r.Cursor, r.Limit)
	out := &v1.PullResponse{Cursor: cursor, HasMore: more, Commits: []*v1.Commit{}}
	for _, v := range rows {
		out.Commits = append(out.Commits, &v1.Commit{Revision: v.Revision, BatchId: v.BatchID, Entities: wireEntities(v.Entities)})
	}
	return out, Public(e)
}
func (c *Cloud) SyncStatus(ctx context.Context, _ *v1.Empty) (*v1.Status, error) {
	n, e := c.Auth.Store.Head(ctx, Identity(ctx).UserID)
	return &v1.Status{SchemaVersion: 1, Revision: strconv.FormatInt(n, 10)}, Public(e)
}
func (c *Cloud) ListConflicts(ctx context.Context, _ *v1.Empty) (*v1.Conflicts, error) {
	rows, e := c.Auth.Store.Conflicts(ctx, Identity(ctx))
	out := &v1.Conflicts{Conflicts: []*v1.Conflict{}}
	for _, v := range rows {
		out.Conflicts = append(out.Conflicts, &v1.Conflict{Id: v.ID, BatchId: v.BatchID, Status: v.Status, Local: wireBatch(v.Local), Remote: wireEntities(v.Remote)})
	}
	return out, Public(e)
}
func (c *Cloud) Resolve(ctx context.Context, r *v1.ResolveRequest) (*v1.PushResponse, error) {
	b := batch(r.Replacement)
	v, e := c.Sync.Resolve(ctx, Identity(ctx), r.Id, r.Choice, &b)
	return result(v), Public(e)
}
func (c *Cloud) Bootstrap(ctx context.Context, r *v1.BootstrapRequest) (*v1.BootstrapResponse, error) {
	state, rows, more, cid, e := c.Sync.Bootstrap(ctx, Identity(ctx), r.Id, r.Action, r.Page, r.ChunkCount, entities(r.Entities), r.BatchId)
	return &v1.BootstrapResponse{Id: state.ID, Revision: strconv.FormatInt(state.Revision, 10), Entities: wireEntities(rows), HasMore: more, ConflictId: cid}, Public(e)
}

// Fixture helpers use the same protobuf JSON conventions as the HTTP boundary.
func DecodeBatch(raw []byte) (biz.Batch, error) {
	var b v1.Batch
	if e := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(raw, &b); e != nil {
		return biz.Batch{}, biz.ErrInvalid
	}
	return batch(&b), nil
}
func EncodeResult(r biz.PushResult) json.RawMessage { raw, _ := json.Marshal(r); return raw }
