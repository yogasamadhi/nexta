package transport

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	kerrors "github.com/go-kratos/kratos/v3/errors"
	v1 "personal-execution/server/sync/v1"
)

func TestRecoveryLogsOnlySafeMetadata(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, nil)))
	defer slog.SetDefault(previous)
	handler := observe()(safeRecovery()(func(_ context.Context, request any) (any, error) {
		panic(request)
	}))
	_, err := handler(context.Background(), &v1.AuthRequest{Password: "private-password-must-not-be-logged", Email: "private-email@example.test"})
	if err == nil || kerrors.FromError(err).Reason != "UNAVAILABLE" {
		t.Fatal("panic did not become a safe error")
	}
	logged := output.String()
	if strings.Contains(logged, "private-") || strings.Contains(logged, "goroutine") {
		t.Fatal("request or stack leaked into recovery log")
	}
	for _, field := range []string{`"request_id"`, `"duration_ms"`, `"code":"UNAVAILABLE"`} {
		if !strings.Contains(logged, field) {
			t.Fatalf("missing safe metadata field: %s", field)
		}
	}
}
