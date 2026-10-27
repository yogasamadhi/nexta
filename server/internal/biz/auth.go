package biz

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"github.com/google/uuid"
	"golang.org/x/crypto/argon2"
	"net/mail"
	"strconv"
	"strings"
	"time"
)

type Auth struct {
	Store             Store
	Secret            []byte
	AllowRegistration bool
	Now               func() time.Time
}
type Credentials struct{ Email, Password, InstallationID, DeviceName string }
type Tokens struct {
	UserID, DeviceID, Email, AccessToken, RefreshToken string
	ExpiresIn                                          int32
}

func randomToken() string {
	var b [32]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic(e)
	}
	return base64.RawURLEncoding.EncodeToString(b[:])
}
func digest(s string) []byte { x := sha256.Sum256([]byte(s)); return x[:] }
func passwordHash(password string) string {
	salt := make([]byte, 16)
	if _, e := rand.Read(salt); e != nil {
		panic(e)
	}
	key := argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, 32)
	return base64.RawStdEncoding.EncodeToString(salt) + "." + base64.RawStdEncoding.EncodeToString(key)
}
func verifyPassword(password, hash string) bool {
	parts := strings.Split(hash, ".")
	if len(parts) != 2 {
		return false
	}
	salt, e := base64.RawStdEncoding.DecodeString(parts[0])
	if e != nil || len(salt) != 16 {
		return false
	}
	expected, e := base64.RawStdEncoding.DecodeString(parts[1])
	if e != nil || len(expected) != 32 {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, 32)
	return subtle.ConstantTimeCompare(actual, expected) == 1
}
func (a *Auth) now() time.Time {
	if a.Now != nil {
		return a.Now()
	}
	return time.Now()
}
func (a *Auth) access(s Session) string {
	body := s.ID + "." + strconv.FormatInt(a.now().Add(15*time.Minute).Unix(), 10)
	h := hmac.New(sha256.New, a.Secret)
	_, _ = h.Write([]byte(body))
	return body + "." + base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}
func (a *Auth) Authenticate(ctx context.Context, token string) (Identity, error) {
	p := strings.Split(token, ".")
	if len(p) != 3 {
		return Identity{}, ErrUnauthorized
	}
	n, e := strconv.ParseInt(p[1], 10, 64)
	if e != nil || a.now().Unix() >= n {
		return Identity{}, ErrUnauthorized
	}
	h := hmac.New(sha256.New, a.Secret)
	_, _ = h.Write([]byte(p[0] + "." + p[1]))
	sig, e := base64.RawURLEncoding.DecodeString(p[2])
	if e != nil || !hmac.Equal(sig, h.Sum(nil)) {
		return Identity{}, ErrUnauthorized
	}
	s, e := a.Store.Session(ctx, p[0])
	if e != nil || s.Revoked || !a.now().Before(s.ExpiresAt) {
		return Identity{}, ErrUnauthorized
	}
	return Identity{UserID: s.UserID, DeviceID: s.DeviceID, SessionID: s.ID}, nil
}
func (a *Auth) Login(ctx context.Context, c Credentials, register bool) (Tokens, error) {
	c.Email = strings.ToLower(strings.TrimSpace(c.Email))
	m, e := mail.ParseAddress(c.Email)
	if e != nil || m.Address != c.Email || len(c.Email) > 254 || len(c.Password) < 12 || len(c.Password) > 128 || len(c.InstallationID) < 8 || len(c.InstallationID) > 128 || len(c.DeviceName) == 0 || len(c.DeviceName) > 128 {
		return Tokens{}, ErrInvalid
	}
	if register && !a.AllowRegistration {
		return Tokens{}, ErrForbidden
	}
	var out Tokens
	// Hash outside the database transaction; the same expensive check applies to missing accounts.
	hash := ""
	if register {
		hash = passwordHash(c.Password)
	}
	err := a.Store.Within(ctx, func(s Store) error {
		var u User
		if register {
			u = User{ID: uuid.NewString(), Email: c.Email, PasswordHash: hash}
			if e := s.CreateUser(ctx, u); e != nil {
				return e
			}
		} else {
			var e error
			u, e = s.FindUser(ctx, c.Email)
			if e != nil {
				_ = verifyPassword(c.Password, "MDEyMzQ1Njc4OWFiY2RlZg.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
				return ErrUnauthorized
			}
			if !verifyPassword(c.Password, u.PasswordHash) {
				return ErrUnauthorized
			}
		}
		device, e := s.ClaimDevice(ctx, uuid.NewString(), u.ID, c.InstallationID, c.DeviceName)
		if e != nil {
			return e
		}
		session := Session{ID: uuid.NewString(), UserID: u.ID, DeviceID: device, ExpiresAt: a.now().Add(30 * 24 * time.Hour)}
		refresh := randomToken()
		if e = s.CreateSession(ctx, session, digest(refresh)); e != nil {
			return e
		}
		out = Tokens{UserID: u.ID, DeviceID: device, Email: u.Email, AccessToken: a.access(session), RefreshToken: refresh, ExpiresIn: 900}
		return nil
	})
	return out, err
}
func (a *Auth) Refresh(ctx context.Context, token string) (Tokens, error) {
	if len(token) > 256 || len(token) < 32 {
		return Tokens{}, ErrUnauthorized
	}
	var out Tokens
	err := a.Store.Within(ctx, func(s Store) error {
		session, e := s.RefreshSession(ctx, digest(token))
		if e != nil || session.Revoked || !a.now().Before(session.ExpiresAt) {
			return ErrUnauthorized
		}
		verified, e := s.Session(ctx, session.ID)
		if e != nil || verified.Revoked {
			return ErrUnauthorized
		}
		next := randomToken()
		if e = s.RotateSession(ctx, session.ID, digest(next)); e != nil {
			return e
		}
		u, e := s.User(ctx, session.UserID)
		if e != nil {
			return e
		}
		out = Tokens{UserID: u.ID, DeviceID: session.DeviceID, Email: u.Email, AccessToken: a.access(session), RefreshToken: next, ExpiresIn: 900}
		return nil
	})
	return out, err
}
func (a *Auth) Validate() error {
	if len(a.Secret) < 32 {
		return fmt.Errorf("access signing secret must have at least 32 bytes")
	}
	return nil
}
