package biz

import (
	"encoding/json"
	"testing"
)

func goal(id string) Entity {
	return Entity{Kind: "goal", Key: id, Version: "0", Value: json.RawMessage(`{"id":"` + id + `","title":"Plan","description":"","status":"active","targetDate":null,"createdAt":"2026-10-25T00:00:00.000Z","updatedAt":"2026-10-25T00:00:00.000Z","archivedAt":null}`)}
}
func TestPortableValidation(t *testing.T) {
	e := goal("goal_1")
	if err := ValidateEntity(e); err != nil {
		t.Fatal(err)
	}
	var v map[string]any
	_ = json.Unmarshal(e.Value, &v)
	v["apiKey"] = "secret"
	e.Value, _ = json.Marshal(v)
	if ValidateEntity(e) == nil {
		t.Fatal("unknown field accepted")
	}
	e = goal("goal_1")
	e.Kind = "operation_records"
	if ValidateEntity(e) == nil {
		t.Fatal("local receipts exposed")
	}
	e = goal("goal_1")
	e.Key = "other"
	if ValidateEntity(e) == nil {
		t.Fatal("identity mismatch accepted")
	}
}
func TestPasswordHash(t *testing.T) {
	hash := passwordHash("a long test password")
	if !verifyPassword("a long test password", hash) || verifyPassword("wrong password", hash) {
		t.Fatal("password verification")
	}
}

func TestJSONStorageComparison(t *testing.T) {
	a := Entity{Kind: "goal", Value: json.RawMessage(`{"id":"a","title":"Plan","n":9007199254740993}`)}
	b := Entity{Kind: "goal", Value: json.RawMessage(`{ "n": 9007199254740993, "title": "Plan", "id": "a" }`)}
	if !same(a, b) {
		t.Fatal("jsonb object normalization changed the value")
	}
	b.Value = json.RawMessage(`{"id":"a","title":"Plan","n":9007199254740992}`)
	if same(a, b) {
		t.Fatal("distinct numbers lost precision")
	}
}
