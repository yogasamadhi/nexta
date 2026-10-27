package biz

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"personal-execution/server/contracts"
	"strconv"
	"strings"
	"time"
)

type field struct {
	Type     string `json:"type"`
	Nullable bool   `json:"nullable"`
}
type definition struct {
	Fields map[string]field `json:"fields"`
}

var definitions = func() map[string]definition {
	var v map[string]definition
	if err := json.Unmarshal(contracts.Entities, &v); err != nil {
		panic(err)
	}
	return v
}()
var portablePreferences = map[string]bool{"scheduling.timeZone.v1": true, "scheduling.workingHours.v1": true, "notification.leadMinutes.v1": true, "focus.mindfulTransition.enabled.v1": true, "personalization.enabled.v1": true, "wellbeing.checkIn.enabled.v1": true, "wellbeing.relaxSuggestions.enabled.v1": true}

func document(raw json.RawMessage) (map[string]any, error) {
	var v map[string]any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if dec.Decode(&v) != nil || v == nil {
		return nil, ErrInvalid
	}
	return v, nil
}
func text(v map[string]any, k string) string { s, _ := v[k].(string); return s }
func number(v map[string]any, k string) float64 {
	n, _ := v[k].(json.Number)
	f, _ := n.Float64()
	return f
}
func keyFor(kind string, v map[string]any) string {
	switch kind {
	case "preference":
		return text(v, "key")
	case "reflection":
		return text(v, "localDate") + "@" + text(v, "timeZone")
	}
	return text(v, "id")
}
func ValidateEntity(e Entity) error {
	def, ok := definitions[e.Kind]
	if !ok || e.Key == "" || len(e.Key) > 512 {
		return ErrInvalid
	}
	if n, err := strconv.ParseInt(e.Version, 10, 64); err != nil || n < 0 || strconv.FormatInt(n, 10) != e.Version {
		return ErrInvalid
	}
	v, err := document(e.Value)
	if err != nil || len(v) != len(def.Fields) {
		return ErrInvalid
	}
	for name, f := range def.Fields {
		x, exists := v[name]
		if !exists {
			return ErrInvalid
		}
		if x == nil {
			if !f.Nullable {
				return ErrInvalid
			}
			continue
		}
		switch f.Type {
		case "string", "instant", "date", "zone":
			s, ok := x.(string)
			if !ok || len(s) > 65536 {
				return ErrInvalid
			}
			if name != "description" && strings.TrimSpace(s) == "" {
				return ErrInvalid
			}
			switch f.Type {
			case "instant":
				t, err := time.Parse(time.RFC3339Nano, s)
				if err != nil || !strings.HasSuffix(s, "Z") || t.Year() < 1 {
					return ErrInvalid
				}
			case "date":
				if _, err := time.Parse("2006-01-02", s); err != nil {
					return ErrInvalid
				}
			case "zone":
				if _, err := time.LoadLocation(s); err != nil {
					return ErrInvalid
				}
			}
		case "number":
			n, ok := x.(json.Number)
			if !ok {
				return ErrInvalid
			}
			z, err := n.Float64()
			if err != nil || math.IsNaN(z) || math.IsInf(z, 0) || z < 0 || z > 9007199254740991 {
				return ErrInvalid
			}
		case "boolean":
			if _, ok := x.(bool); !ok {
				return ErrInvalid
			}
		case "json":
			if _, err := json.Marshal(x); err != nil {
				return ErrInvalid
			}
		}
	}
	if keyFor(e.Kind, v) != e.Key {
		return ErrInvalid
	}
	member := func(k string, values ...string) bool {
		s := text(v, k)
		for _, x := range values {
			if s == x {
				return true
			}
		}
		return false
	}
	ordered := func(start, end string) bool {
		if v[end] == nil {
			return true
		}
		a, _ := time.Parse(time.RFC3339Nano, text(v, start))
		b, _ := time.Parse(time.RFC3339Nano, text(v, end))
		return !b.Before(a)
	}
	switch e.Kind {
	case "plan_origin":
		ids, ok := v["affectedBlockIds"].([]any)
		if !ok || len(ids) > 20000 {
			return ErrInvalid
		}
		for _, id := range ids {
			if str, ok := id.(string); !ok || str == "" {
				return ErrInvalid
			}
		}
	case "task":
		if !member("status", "inbox", "planned", "in_progress", "completed", "canceled") || (text(v, "status") == "completed") != (v["completedAt"] != nil) || (text(v, "status") == "canceled") != (v["canceledAt"] != nil) {
			return ErrInvalid
		}
		if v["minBlockMinutes"] != nil && v["maxBlockMinutes"] != nil && number(v, "minBlockMinutes") > number(v, "maxBlockMinutes") {
			return ErrInvalid
		}
		for _, k := range []string{"estimatedDurationMinutes", "baselineEstimatedDurationMinutes", "remainingDurationMinutes", "minBlockMinutes", "maxBlockMinutes"} {
			if v[k] != nil && number(v, k) <= 0 {
				return ErrInvalid
			}
		}
		if v["deadlineAt"] != nil && v["deadlineLocalDate"] != nil {
			return ErrInvalid
		}
		if v["deadlineLocalDate"] != nil && v["deadlineTimeZone"] == nil {
			return ErrInvalid
		}
		if v["deadlineAt"] != nil && v["earliestStartAt"] != nil && text(v, "deadlineAt") <= text(v, "earliestStartAt") {
			return ErrInvalid
		}
	case "time_block":
		if !member("type", "task", "break", "relax", "buffer") || !member("status", "planned", "started", "completed", "skipped", "canceled") || text(v, "endAt") <= text(v, "startAt") || (text(v, "type") == "task" && v["taskId"] == nil) {
			return ErrInvalid
		}
	case "execution_session":
		if !member("status", "running", "paused", "completed", "abandoned") || !ordered("startedAt", "endedAt") {
			return ErrInvalid
		}
		s := text(v, "status")
		if s == "running" && (v["endedAt"] != nil || v["activeIntervalStartedAt"] == nil || v["pausedAt"] != nil || v["completionType"] != nil) {
			return ErrInvalid
		}
		if s == "paused" && (v["endedAt"] != nil || v["activeIntervalStartedAt"] != nil || v["pausedAt"] == nil || v["completionType"] != nil) {
			return ErrInvalid
		}
		if (s == "completed" || s == "abandoned") && (v["endedAt"] == nil || v["activeIntervalStartedAt"] != nil || v["pausedAt"] != nil) {
			return ErrInvalid
		}
		if s == "completed" && !member("completionType", "finish_session", "complete_task") {
			return ErrInvalid
		}
		if s == "abandoned" && v["completionType"] != nil {
			return ErrInvalid
		}
	case "execution_interval":
		if !member("kind", "work", "pause") || !member("timingQuality", "trusted", "needs_review") || !ordered("startAt", "endAt") {
			return ErrInvalid
		}
	case "completion_record":
		if !member("durationCoverage", "complete", "partial", "unknown") || !member("achievementDisposition", "record", "skip") || !member("source", "user", "agent_authorized") || (text(v, "durationCoverage") != "unknown" && v["actualDurationSeconds"] == nil) {
			return ErrInvalid
		}
	case "energy_check_in":
		if number(v, "level") < 1 || number(v, "level") > 5 || math.Trunc(number(v, "level")) != number(v, "level") {
			return ErrInvalid
		}
	case "relax_session":
		if !member("type", "breathing", "pause", "stretch", "ambient") || !member("source", "relax_tab", "today", "focus") || !member("status", "active", "completed", "abandoned") || !member("timingQuality", "trusted", "needs_review") || number(v, "plannedMinutes") < 1 || number(v, "plannedMinutes") > 60 || !ordered("startedAt", "endedAt") {
			return ErrInvalid
		}
		if (text(v, "status") == "active") != (v["endedAt"] == nil) || (text(v, "status") == "active") != (v["actualSeconds"] == nil) {
			return ErrInvalid
		}
	case "reflection":
		if !member("generatedBy", "local_facts", "model_validated") {
			return ErrInvalid
		}
		wins, ok := v["wins"].([]any)
		if !ok || len(wins) > 3 {
			return ErrInvalid
		}
		for _, w := range wins {
			m, ok := w.(map[string]any)
			if !ok || len(m) != 4 || text(m, "completionRecordId") == "" || text(m, "taskId") == "" || text(m, "title") == "" {
				return ErrInvalid
			}
			if _, err := time.Parse(time.RFC3339Nano, text(m, "completedAt")); err != nil {
				return ErrInvalid
			}
		}
	case "task_activity":
		for _, key := range []string{"beforeSummary", "afterSummary"} {
			if v[key] == nil {
				continue
			}
			m, ok := v[key].(map[string]any)
			if !ok {
				return ErrInvalid
			}
			for _, x := range m {
				switch x.(type) {
				case nil, string, json.Number, bool:
				default:
					return ErrInvalid
				}
			}
		}
	case "preference":
		if !portablePreferences[text(v, "key")] {
			return ErrInvalid
		}
		if err := validatePreference(v); err != nil {
			return err
		}
	}
	return nil
}
func validatePreference(v map[string]any) error {
	m, ok := v["valueJson"].(map[string]any)
	if !ok {
		return ErrInvalid
	}
	switch text(v, "key") {
	case "scheduling.timeZone.v1":
		if len(m) != 1 {
			return ErrInvalid
		}
		_, err := time.LoadLocation(text(m, "timeZone"))
		if err != nil {
			return ErrInvalid
		}
	case "scheduling.workingHours.v1":
		if len(m) != 2 {
			return ErrInvalid
		}
		if _, err := time.LoadLocation(text(m, "timeZone")); err != nil {
			return ErrInvalid
		}
		rules, ok := m["rules"].([]any)
		if !ok || len(rules) == 0 || len(rules) > 64 {
			return ErrInvalid
		}
		for _, r := range rules {
			rule, ok := r.(map[string]any)
			if !ok || text(rule, "id") == "" {
				return ErrInvalid
			}
			for _, k := range []string{"startLocalTime", "endLocalTime"} {
				if _, err := time.Parse("15:04", text(rule, k)); err != nil {
					return ErrInvalid
				}
			}
			days, ok := rule["weekdays"].([]any)
			if !ok || len(days) == 0 || len(days) > 7 {
				return ErrInvalid
			}
			seen := map[string]bool{}
			for _, d := range days {
				n, ok := d.(json.Number)
				i, err := strconv.Atoi(string(n))
				if !ok || err != nil || i < 1 || i > 7 || seen[string(n)] {
					return ErrInvalid
				}
				seen[string(n)] = true
			}
		}
	case "notification.leadMinutes.v1":
		n, ok := m["leadMinutes"].(json.Number)
		if !ok || len(m) != 1 {
			return ErrInvalid
		}
		x, err := strconv.Atoi(string(n))
		if err != nil || x < 0 || x > 1440 {
			return ErrInvalid
		}
	default:
		if _, ok := m["enabled"].(bool); !ok || len(m) != 1 {
			return ErrInvalid
		}
	}
	return nil
}
func same(a, b any) bool {
	// PostgreSQL jsonb normalizes object key order and whitespace. Compare JSON
	// values after decoding rather than the storage representation of RawMessage.
	canonical := func(value any) ([]byte, error) {
		raw, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.UseNumber()
		var decoded any
		if err = decoder.Decode(&decoded); err != nil {
			return nil, err
		}
		return json.Marshal(decoded)
	}
	x, xerr := canonical(a)
	y, yerr := canonical(b)
	return xerr == nil && yerr == nil && bytes.Equal(x, y)
}
func protect(old, next Entity, device string) error {
	a, _ := document(old.Value)
	b, _ := document(next.Value)
	immutable := []string{"id", "createdAt"}
	switch old.Kind {
	case "operation_provenance", "task_activity", "energy_check_in", "plan_origin":
		if !same(a, b) {
			return ErrConflict
		}
	case "completion_record":
		for k, v := range a {
			if k != "achievementDisposition" && !same(v, b[k]) {
				return ErrConflict
			}
		}
	case "execution_interval":
		immutable = append(immutable, "sessionId", "kind", "startAt")
		if a["endAt"] != nil && !same(a, b) {
			return ErrConflict
		}
		if old.OwnerDeviceID != device && !same(a, b) {
			return ErrForbidden
		}
	case "execution_session", "relax_session":
		if old.OwnerDeviceID != device && !same(a, b) {
			return ErrForbidden
		}
		if a["endedAt"] != nil && !same(a, b) {
			return ErrConflict
		}
		immutable = append(immutable, "startedAt", "taskId", "timeBlockId", "type", "plannedMinutes", "source")
	case "achievement":
		immutable = append(immutable, "sourceCompletionRecordId", "sourceTaskId", "sourceExecutionSessionId", "evidenceType", "occurredAt")
	case "task":
		if (text(a, "status") == "completed" || text(a, "status") == "canceled") && !same(a, b) {
			return ErrConflict
		}
	case "time_block":
		if text(a, "status") == "completed" && !same(a, b) {
			return ErrConflict
		}
	}
	for _, k := range immutable {
		if !same(a[k], b[k]) {
			return fmt.Errorf("%w", ErrConflict)
		}
	}
	return nil
}
