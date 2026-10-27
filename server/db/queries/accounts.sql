-- name: CreateUser :exec
INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3);
-- name: FindUser :one
SELECT id,email,password_hash FROM users WHERE email=$1;
-- name: GetUser :one
SELECT id,email FROM users WHERE id=$1;
-- name: ClaimDevice :one
INSERT INTO devices(id,user_id,installation_id,name) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,installation_id) DO UPDATE SET name=EXCLUDED.name,revoked_at=NULL RETURNING id;
-- name: ListDevices :many
SELECT id,name,revoked_at FROM devices WHERE user_id=$1 ORDER BY id;
-- name: RevokeDevice :exec
UPDATE devices SET revoked_at=now() WHERE user_id=$1 AND id=$2;
-- name: CreateSession :exec
INSERT INTO sessions(id,user_id,device_id,refresh_hash,expires_at) VALUES($1,$2,$3,$4,$5);
-- name: GetSession :one
SELECT s.id,s.user_id,s.device_id,s.expires_at,s.revoked_at,d.revoked_at AS device_revoked FROM sessions s JOIN devices d ON s.device_id=d.id AND s.user_id=d.user_id WHERE s.id=$1;
-- name: FindRefresh :one
SELECT id,user_id,device_id,expires_at,revoked_at FROM sessions WHERE refresh_hash=$1 FOR UPDATE;
-- name: RotateSession :exec
UPDATE sessions SET refresh_hash=$2 WHERE id=$1;
-- name: RevokeSession :exec
UPDATE sessions SET revoked_at=now() WHERE id=$1;
-- name: EnsureHead :exec
INSERT INTO sync_heads(user_id) VALUES($1) ON CONFLICT DO NOTHING;
-- name: LockHead :one
SELECT revision FROM sync_heads WHERE user_id=$1 FOR UPDATE;
-- name: AdvanceHead :one
UPDATE sync_heads SET revision=revision+1 WHERE user_id=$1 RETURNING revision;
-- name: ReadHead :one
SELECT revision FROM sync_heads WHERE user_id=$1;
-- name: FindBatch :one
SELECT request_hash,result FROM sync_batches WHERE user_id=$1 AND batch_id=$2;
-- name: SaveBatch :exec
INSERT INTO sync_batches(user_id,batch_id,device_id,request_hash,revision,result) VALUES($1,$2,$3,$4,$5,$6);
-- name: SaveChange :exec
INSERT INTO sync_changes(user_id,revision,batch_id,document) VALUES($1,$2,$3,$4);
-- name: PullChanges :many
SELECT revision,document FROM sync_changes WHERE user_id=$1 AND revision>$2 ORDER BY revision LIMIT $3;
-- name: SaveConflict :one
INSERT INTO sync_conflicts(id,user_id,device_id,batch_id,request_hash,local_batch,remote_entities) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,batch_id) DO UPDATE SET batch_id=EXCLUDED.batch_id RETURNING id,request_hash,status;
-- name: GetConflict :one
SELECT * FROM sync_conflicts WHERE user_id=$1 AND id=$2 FOR UPDATE;
-- name: ListConflicts :many
SELECT id,batch_id,status,local_batch,remote_entities FROM sync_conflicts WHERE user_id=$1 AND device_id=$2 ORDER BY created_at,id LIMIT 100;
-- name: ResolveConflict :exec
UPDATE sync_conflicts SET status=$3,resolution=$4 WHERE user_id=$1 AND id=$2;
-- name: CreateBootstrap :exec
INSERT INTO sync_bootstraps(id,user_id,device_id,direction,revision,snapshot) VALUES($1,$2,$3,$4,$5,$6);
-- name: GetBootstrap :one
SELECT * FROM sync_bootstraps WHERE user_id=$1 AND device_id=$2 AND id=$3 FOR UPDATE;
-- name: StageBootstrap :exec
UPDATE sync_bootstraps SET chunks=chunks || sqlc.arg(chunk)::jsonb WHERE id=sqlc.arg(id);
-- name: CompleteBootstrap :exec
UPDATE sync_bootstraps SET status='complete' WHERE id=$1;
