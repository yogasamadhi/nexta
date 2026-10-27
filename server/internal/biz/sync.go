package biz

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"sort"
	"strconv"
)

type Sync struct{ Store Store }

func revision(n int64) string { return strconv.FormatInt(n, 10) }
func batchHash(b Batch) string {
	raw, _ := json.Marshal(b)
	var value any
	_ = json.Unmarshal(raw, &value)
	raw, _ = json.Marshal(value)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
func validateBatch(b Batch) error {
	if b.SchemaVersion != 1 || len(b.BatchID) < 8 || len(b.BatchID) > 160 || len(b.Changes) == 0 || len(b.Changes) > 20000 {
		return ErrInvalid
	}
	seen := map[string]bool{}
	for _, e := range b.Changes {
		n, err := strconv.ParseInt(e.Version, 10, 64)
		if err != nil || n < 0 || ValidateEntity(e) != nil || seen[e.Kind+":"+e.Key] {
			return ErrInvalid
		}
		seen[e.Kind+":"+e.Key] = true
	}
	return nil
}
func (s *Sync) Push(ctx context.Context, id Identity, b Batch) (PushResult, error) {
	if err := validateBatch(b); err != nil {
		return PushResult{}, err
	}
	var out PushResult
	err := s.Store.Within(ctx, func(store Store) error { var e error; out, e = s.push(ctx, store, id, b); return e })
	return out, err
}
func (s *Sync) push(ctx context.Context, store Store, id Identity, b Batch) (PushResult, error) {
	head, err := store.LockHead(ctx, id.UserID)
	if err != nil {
		return PushResult{}, err
	}
	hash := batchHash(b)
	oldHash, receipt, err := store.Receipt(ctx, id.UserID, b.BatchID)
	if err == nil {
		if oldHash != hash {
			return PushResult{}, ErrConflict
		}
		return *receipt, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return PushResult{}, err
	}
	all, err := store.Entities(ctx, id.UserID)
	if err != nil {
		return PushResult{}, err
	}
	byKey := map[string]Entity{}
	for _, e := range all {
		byKey[e.Kind+":"+e.Key] = e
	}
	next := make([]Entity, len(b.Changes))
	conflict := false
	for i, e := range b.Changes {
		if err := ValidateEntity(e); err != nil {
			return PushResult{}, err
		}
		key := e.Kind + ":" + e.Key
		old, exists := byKey[key]
		version, _ := strconv.ParseInt(e.Version, 10, 64)
		if exists {
			if old.Version != e.Version {
				conflict = true
			}
			if err := protect(old, e, id.DeviceID); err != nil {
				if errors.Is(err, ErrForbidden) {
					return PushResult{}, err
				}
				conflict = true
			}
			e.OwnerDeviceID = old.OwnerDeviceID
		} else {
			if version != 0 {
				conflict = true
			}
			if e.OwnerDeviceID != "" && e.OwnerDeviceID != id.DeviceID {
				return PushResult{}, ErrForbidden
			}
			e.OwnerDeviceID = id.DeviceID
		}
		e.Version = revision(version + 1)
		next[i] = e
		byKey[key] = e
	}
	if !conflict {
		if err := validateGraph(byKey, id.DeviceID, next); err != nil {
			if errors.Is(err, ErrInvalid) {
				return PushResult{}, err
			}
			conflict = true
		}
	}
	if conflict {
		c, e := store.SaveConflict(ctx, id, b, hash, all)
		if e != nil {
			return PushResult{}, e
		}
		if c.Hash != hash {
			return PushResult{}, ErrConflict
		}
		return PushResult{Revision: revision(head), Entities: []Entity{}, ConflictID: c.ID}, nil
	}
	// Deferred tenant-scoped FKs permit complete cyclic reference graphs in one batch.
	sort.SliceStable(next, func(i, j int) bool { return next[i].Kind < next[j].Kind })
	for _, e := range next {
		n, _ := strconv.ParseInt(e.Version, 10, 64)
		if err := store.PutEntity(ctx, id.UserID, e, n); err != nil {
			return PushResult{}, err
		}
	}
	rev, err := store.AdvanceHead(ctx, id.UserID)
	if err != nil {
		return PushResult{}, err
	}
	result := PushResult{Revision: revision(rev), Entities: next}
	if err := store.SaveCommit(ctx, id, b, hash, rev, result); err != nil {
		return PushResult{}, err
	}
	return result, nil
}
func validateGraph(all map[string]Entity, device string, changed []Entity) error {
	refs := map[string]map[string]string{"project": {"goalId": "goal"}, "task": {"goalId": "goal", "projectId": "project", "parentTaskId": "task"}, "time_block": {"taskId": "task"}, "execution_session": {"taskId": "task", "timeBlockId": "time_block"}, "execution_interval": {"sessionId": "execution_session"}, "completion_record": {"taskId": "task", "sourceSessionId": "execution_session", "operationId": "operation_provenance"}, "achievement": {"sourceCompletionRecordId": "completion_record", "sourceTaskId": "task", "sourceExecutionSessionId": "execution_session"}, "task_activity": {"taskId": "task", "timeBlockId": "time_block", "operationId": "operation_provenance"}}
	byID := map[string]map[string]any{}
	entitiesByID := map[string]Entity{}
	for _, e := range all {
		v, _ := document(e.Value)
		key := e.Kind + ":" + text(v, "id")
		byID[key] = v
		entitiesByID[key] = e
	}
	completed := map[string]bool{}
	achieved := map[string]bool{}
	active, relax := 0, 0
	for _, e := range all {
		v, _ := document(e.Value)
		for field, kind := range refs[e.Kind] {
			if v[field] != nil && byID[kind+":"+text(v, field)] == nil {
				return ErrInvalid
			}
		}
		switch e.Kind {
		case "completion_record":
			task := text(v, "taskId")
			if completed[task] {
				return ErrConflict
			}
			completed[task] = true
			t := byID["task:"+task]
			if text(t, "status") != "completed" || text(t, "completedAt") != text(v, "completedAt") {
				return ErrInvalid
			}
			if v["sourceSessionId"] != nil {
				session := byID["execution_session:"+text(v, "sourceSessionId")]
				if text(session, "taskId") != task || text(session, "status") != "completed" || text(session, "completionType") != "complete_task" {
					return ErrInvalid
				}
			}
		case "achievement":
			cid := text(v, "sourceCompletionRecordId")
			c := byID["completion_record:"+cid]
			if achieved[cid] {
				return ErrConflict
			}
			achieved[cid] = true
			if text(c, "taskId") != text(v, "sourceTaskId") || text(c, "achievementDisposition") != "record" || !same(c["sourceSessionId"], v["sourceExecutionSessionId"]) {
				return ErrInvalid
			}
		case "execution_session":
			if text(v, "status") == "running" || text(v, "status") == "paused" {
				active++
			}
			if v["timeBlockId"] != nil {
				block := byID["time_block:"+text(v, "timeBlockId")]
				if text(block, "taskId") != text(v, "taskId") {
					return ErrInvalid
				}
			}
		case "relax_session":
			if text(v, "status") == "active" {
				relax++
			}
		case "reflection":
			wins, _ := v["wins"].([]any)
			for _, w := range wins {
				win := w.(map[string]any)
				c := byID["completion_record:"+text(win, "completionRecordId")]
				if c == nil || text(c, "taskId") != text(win, "taskId") || text(c, "completedAt") != text(win, "completedAt") {
					return ErrInvalid
				}
			}
		case "task":
			seen := map[string]bool{text(v, "id"): true}
			p := text(v, "parentTaskId")
			for p != "" {
				if seen[p] {
					return ErrInvalid
				}
				seen[p] = true
				p = text(byID["task:"+p], "parentTaskId")
			}
		}
	}

	for key, session := range byID {
		if len(key) < 18 || key[:18] != "execution_session:" {
			continue
		}
		sessionID := text(session, "id")
		status := text(session, "status")
		open := 0
		for intervalKey, interval := range byID {
			if len(intervalKey) < 19 || intervalKey[:19] != "execution_interval:" || text(interval, "sessionId") != sessionID {
				continue
			}
			if interval["endAt"] == nil {
				open++
				expected := "work"
				if status == "paused" {
					expected = "pause"
				}
				if text(interval, "kind") != expected {
					return ErrInvalid
				}
			}
		}
		if (status == "running" || status == "paused") && (open != 1 || text(byID["task:"+text(session, "taskId")], "status") != "in_progress") {
			return ErrInvalid
		}
		if (status == "completed" || status == "abandoned") && open != 0 {
			return ErrInvalid
		}
	}
	if active > 1 || relax > 1 {
		return ErrConflict
	}
	for _, e := range all {
		v, _ := document(e.Value)
		if e.Kind == "task" && text(v, "status") == "completed" && !completed[text(v, "id")] {
			return ErrInvalid
		}
	}
	// A second device must not end/cancel a task that still belongs to an active origin session.
	for _, e := range changed {
		if e.Kind != "task" {
			continue
		}
		v, _ := document(e.Value)
		if text(v, "status") != "completed" && text(v, "status") != "canceled" {
			continue
		}
		for key, session := range byID {
			if len(key) >= 18 && key[:18] == "execution_session:" && text(session, "taskId") == text(v, "id") && entitiesByID[key].OwnerDeviceID != device && (text(session, "status") == "running" || text(session, "status") == "paused") {
				return ErrConflict
			}
		}
	}
	return nil
}
func (s *Sync) Pull(ctx context.Context, id Identity, cursor string, limit int32) ([]Commit, string, bool, error) {
	if cursor == "" {
		cursor = "0"
	}
	n, e := strconv.ParseInt(cursor, 10, 64)
	if e != nil || n < 0 {
		return nil, "", false, ErrInvalid
	}
	if limit == 0 {
		limit = 50
	}
	if limit < 1 || limit > 100 {
		return nil, "", false, ErrInvalid
	}
	rows, e := s.Store.Pull(ctx, id.UserID, n, limit+1)
	if e != nil {
		return nil, "", false, e
	}
	more := len(rows) > int(limit)
	if more {
		rows = rows[:limit]
	}
	if len(rows) > 0 {
		cursor = rows[len(rows)-1].Revision
	}
	return rows, cursor, more, nil
}
func (s *Sync) Resolve(ctx context.Context, id Identity, cid, choice string, replacement *Batch) (PushResult, error) {
	if choice != "cloud" && choice != "local" {
		return PushResult{}, ErrInvalid
	}
	var out PushResult
	err := s.Store.Within(ctx, func(store Store) error {
		head, e := store.LockHead(ctx, id.UserID)
		if e != nil {
			return e
		}
		c, e := store.Conflict(ctx, id.UserID, cid)
		if e != nil {
			return e
		}
		if c.DeviceID != id.DeviceID {
			return ErrForbidden
		}
		if c.Status != "open" {
			if c.Status != choice || c.Result == nil {
				return ErrConflict
			}
			out = *c.Result
			return nil
		}
		if choice == "cloud" {
			entities, e := store.Entities(ctx, id.UserID)
			if e != nil {
				return e
			}
			out = PushResult{Revision: revision(head), Entities: entities}
		} else {
			if replacement == nil || validateBatch(*replacement) != nil || replacement.BatchID == c.Local.BatchID {
				return ErrInvalid
			}
			oldKeys := map[string]bool{}
			for _, e := range c.Local.Changes {
				oldKeys[e.Kind+":"+e.Key] = true
			}
			if len(oldKeys) != len(replacement.Changes) {
				return ErrInvalid
			}
			for _, e := range replacement.Changes {
				if !oldKeys[e.Kind+":"+e.Key] {
					return ErrInvalid
				}
			}
			out, e = s.push(ctx, store, id, *replacement)
			if e != nil {
				return e
			}
			if out.ConflictID != "" {
				return nil
			}
		}
		return store.ResolveConflict(ctx, id.UserID, cid, choice, out)
	})
	return out, err
}
func (s *Sync) Bootstrap(ctx context.Context, id Identity, key, action string, page, count int32, entities []Entity, batchIDs ...string) (Bootstrap, []Entity, bool, string, error) {
	var clientBatch string
	if len(batchIDs) > 0 {
		clientBatch = batchIDs[0]
		if len(clientBatch) > 160 {
			return Bootstrap{}, nil, false, "", ErrInvalid
		}
	}
	var state Bootstrap
	out := []Entity{}
	more := false
	cid := ""
	if page < 0 || page > 10000 || count < 0 || count > 10000 {
		return state, nil, false, "", ErrInvalid
	}
	err := s.Store.Within(ctx, func(store Store) error {
		if _, e := store.LockHead(ctx, id.UserID); e != nil {
			return e
		}
		if key == "" {
			if action != "download" && action != "upload" {
				return ErrInvalid
			}
			head, e := store.Head(ctx, id.UserID)
			if e != nil {
				return e
			}
			state = Bootstrap{ID: uuid.NewString(), Direction: action, Revision: head, Snapshot: []Entity{}}
			if action == "upload" && clientBatch != "" {
				state.ID = uuid.NewSHA1(uuid.NameSpaceOID, []byte(id.UserID+":"+id.DeviceID+":"+clientBatch)).String()
				existing, err := store.Bootstrap(ctx, id, state.ID)
				if err == nil {
					state = existing
				} else if !errors.Is(err, ErrNotFound) {
					return err
				}
			}
			if action == "download" {
				state.Snapshot, e = store.Entities(ctx, id.UserID)
				if e != nil {
					return e
				}
			}
			if state.Status == "" {
				if e = store.CreateBootstrap(ctx, id, state); e != nil {
					return e
				}
			}
		} else {
			var e error
			state, e = store.Bootstrap(ctx, id, key)
			if e != nil {
				return e
			}
		}
		if state.Direction == "upload" && clientBatch != "" && state.ID != uuid.NewSHA1(uuid.NameSpaceOID, []byte(id.UserID+":"+id.DeviceID+":"+clientBatch)).String() {
			return ErrInvalid
		}
		if state.Direction == "download" {
			if action != "download" {
				return ErrInvalid
			}
			start := int(page) * 250
			if start > len(state.Snapshot) {
				return ErrInvalid
			}
			end := start + 250
			if end > len(state.Snapshot) {
				end = len(state.Snapshot)
			}
			out = state.Snapshot[start:end]
			more = end < len(state.Snapshot)
			return nil
		}
		switch action {
		case "upload":
			if len(entities) == 0 || len(entities) > 250 {
				return ErrInvalid
			}
			for _, e := range entities {
				if ValidateEntity(e) != nil {
					return ErrInvalid
				}
			}
			if state.Status == "complete" {
				previous, ok := state.Chunks[strconv.Itoa(int(page))]
				if !ok || !same(previous, entities) {
					return ErrConflict
				}
				return nil
			}
			if previous, ok := state.Chunks[strconv.Itoa(int(page))]; ok && !same(previous, entities) {
				return ErrConflict
			}
			return store.StageBootstrap(ctx, state.ID, strconv.Itoa(int(page)), entities)
		case "commit":
			if count < 1 {
				return ErrInvalid
			}
			var e error
			state, e = store.Bootstrap(ctx, id, state.ID)
			if e != nil {
				return e
			}
			all := []Entity{}
			for i := 0; i < int(count); i++ {
				part, ok := state.Chunks[strconv.Itoa(i)]
				if !ok {
					return ErrInvalid
				}
				all = append(all, part...)
			}
			batchID := "bootstrap_" + state.ID
			if clientBatch != "" {
				batchID = clientBatch
			}
			batch := Batch{SchemaVersion: 1, BatchID: batchID, Changes: all}
			if validateBatch(batch) != nil {
				return ErrInvalid
			}
			result, e := s.push(ctx, store, id, batch)
			if e != nil {
				return e
			}
			cid = result.ConflictID
			out = result.Entities
			if cid == "" {
				state.Revision, _ = strconv.ParseInt(result.Revision, 10, 64)
				return store.FinishBootstrap(ctx, state.ID)
			}
			return nil
		default:
			return fmt.Errorf("%w", ErrInvalid)
		}
	})
	return state, out, more, cid, err
}
