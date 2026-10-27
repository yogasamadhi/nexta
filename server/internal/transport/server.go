package transport

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	kerrors "github.com/go-kratos/kratos/v3/errors"
	"github.com/go-kratos/kratos/v3/middleware"
	"github.com/google/uuid"

	kt "github.com/go-kratos/kratos/v3/transport"
	"github.com/go-kratos/kratos/v3/transport/grpc"
	"github.com/go-kratos/kratos/v3/transport/http"
	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/peer"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"io"
	"log/slog"
	"net"
	stdhttp "net/http"
	"personal-execution/server/internal/biz"
	"personal-execution/server/internal/service"
	v1 "personal-execution/server/sync/v1"
	"strings"
	"sync"
	"time"
)

type peerKey struct{}
type requestKey struct{}
type requestInfo struct{ id, code string }
type limiter struct {
	mu      sync.Mutex
	entries map[string]entry
}
type entry struct {
	start time.Time
	count int
}

func (l *limiter) allow(key string, max int) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	e := l.entries[key]
	if now.Sub(e.start) > time.Minute {
		e = entry{start: now}
	}
	if e.count >= max {
		return false
	}
	e.count++
	if len(l.entries) > 4096 {
		for k, v := range l.entries {
			if now.Sub(v.start) > time.Minute {
				delete(l.entries, k)
			}
		}
		if len(l.entries) > 4096 {
			return false
		}
	}
	l.entries[key] = e
	return true
}

// Kratos' default recovery logger includes the request; auth payloads must never be logged.
func safeRecovery() middleware.Middleware {
	return func(next middleware.Handler) middleware.Handler {
		return func(ctx context.Context, req any) (reply any, err error) {
			defer func() {
				if recover() != nil {
					slog.Error("request failed", "code", "panic_recovered")
					err = service.Public(biz.ErrUnavailable)
				}
			}()
			return next(ctx, req)
		}
	}
}

func observe() middleware.Middleware {
	return func(next middleware.Handler) middleware.Handler {
		return func(ctx context.Context, req any) (reply any, err error) {
			info, fromHTTP := ctx.Value(requestKey{}).(*requestInfo)
			if !fromHTTP {
				info = &requestInfo{id: uuid.NewString(), code: "OK"}
			}
			start := time.Now()
			reply, err = next(ctx, req)
			if err != nil {
				info.code = kerrors.FromError(err).Reason
			}
			if !fromHTTP {
				slog.Info("request", "request_id", info.id, "duration_ms", time.Since(start).Milliseconds(), "code", info.code)
			}
			return reply, err
		}
	}
}

func AuthMiddleware(auth *biz.Auth) middleware.Middleware {
	limit := &limiter{entries: map[string]entry{}}
	return func(next middleware.Handler) middleware.Handler {
		return func(ctx context.Context, req any) (any, error) {
			t, ok := kt.FromServerContext(ctx)
			if !ok {
				return nil, service.Public(biz.ErrUnauthorized)
			}
			op := t.Operation()
			public := op == v1.OperationCloudRegister || op == v1.OperationCloudLogin || op == v1.OperationCloudRefresh
			if public {
				addr, _ := ctx.Value(peerKey{}).(string)
				if p, ok := peer.FromContext(ctx); ok {
					addr = p.Addr.String()
				}
				host, _, err := net.SplitHostPort(addr)
				if err == nil {
					addr = host
				}
				key := addr
				if authRequest, ok := req.(*v1.AuthRequest); ok {
					hash := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(authRequest.Email))))
					key += ":" + hex.EncodeToString(hash[:])
				}
				if !limit.allow("ip:"+addr, 100) || !limit.allow(key, 10) {
					return nil, kerrors.TooManyRequests("RATE_LIMITED", "Try again later.")
				}
				return next(ctx, req)
			}
			header := t.RequestHeader().Get("Authorization")
			if !strings.HasPrefix(header, "Bearer ") {
				return nil, service.Public(biz.ErrUnauthorized)
			}
			id, e := auth.Authenticate(ctx, strings.TrimPrefix(header, "Bearer "))
			if e != nil {
				return nil, service.Public(e)
			}
			return next(service.WithIdentity(ctx, id), req)
		}
	}
}
func decode(r *stdhttp.Request, v any) error {
	m, ok := v.(proto.Message)
	if !ok {
		return service.Public(biz.ErrInvalid)
	}
	raw, e := io.ReadAll(r.Body)
	if e != nil {
		return service.Public(biz.ErrInvalid)
	}
	if len(raw) == 0 {
		return nil
	}
	if e = (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(raw, m); e != nil {
		return service.Public(biz.ErrInvalid)
	}
	return nil
}
func encode(w stdhttp.ResponseWriter, r *stdhttp.Request, v any) error {
	m, ok := v.(proto.Message)
	if !ok {
		return service.Public(biz.ErrUnavailable)
	}
	raw, e := (protojson.MarshalOptions{EmitUnpopulated: true}).Marshal(m)
	if e != nil {
		return e
	}
	w.Header().Set("Content-Type", "application/json")
	_, e = w.Write(raw)
	return e
}
func filter(next stdhttp.Handler) stdhttp.Handler {
	return stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		info := &requestInfo{id: uuid.NewString(), code: "OK"}
		w.Header().Set("X-Request-ID", info.id)
		r.Body = stdhttp.MaxBytesReader(w, r.Body, 16<<20)
		start := time.Now()
		ctx := context.WithValue(r.Context(), peerKey{}, r.RemoteAddr)
		ctx = context.WithValue(ctx, requestKey{}, info)
		next.ServeHTTP(w, r.WithContext(ctx))
		slog.Info("request", "request_id", info.id, "method", r.Method, "duration_ms", time.Since(start).Milliseconds(), "code", info.code)
	})
}
func encodeError(w stdhttp.ResponseWriter, r *stdhttp.Request, err error) {
	if info, ok := r.Context().Value(requestKey{}).(*requestInfo); ok {
		info.code = kerrors.FromError(err).Reason
	}
	http.DefaultErrorEncoder(w, r, err)
}
func NewHTTP(address string, c *service.Cloud, ready func(context.Context) error) *http.Server {
	s := http.NewServer(http.Address(address), http.Timeout(30*time.Second), http.RequestDecoder(decode), http.ResponseEncoder(encode), http.ErrorEncoder(encodeError), http.Filter(filter), http.Middleware(observe(), safeRecovery(), AuthMiddleware(c.Auth)))
	v1.RegisterCloudHTTPServer(s, c)
	s.HandleFunc("/healthz", func(w stdhttp.ResponseWriter, _ *stdhttp.Request) { w.WriteHeader(200) })
	s.HandleFunc("/readyz", func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), time.Second)
		defer cancel()
		if ready(ctx) != nil {
			if info, ok := r.Context().Value(requestKey{}).(*requestInfo); ok {
				info.code = "DATABASE_NOT_READY"
			}
			w.WriteHeader(503)
			return
		}
		w.WriteHeader(200)
	})
	return s
}
func NewGRPC(address string, c *service.Cloud) *grpc.Server {
	s := grpc.NewServer(grpc.Options(grpcgo.MaxRecvMsgSize(16<<20), grpcgo.MaxSendMsgSize(16<<20)), grpc.Address(address), grpc.Timeout(30*time.Second), grpc.Middleware(observe(), safeRecovery(), AuthMiddleware(c.Auth)))
	v1.RegisterCloudServer(s, c)
	return s
}
