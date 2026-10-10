package v1

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Agent cursors bind the shared query engine's offset to the exact owner,
// filter, timezone and page size. Changing criteria must restart pagination.
type agentCursor struct {
	Query  string `json:"q"`
	Page   string `json:"p"`
	Issued int64  `json:"i"`
}

func agentQueryDigest(owner int32, filter, zone string, pageSize int) string {
	value, _ := json.Marshal([]string{strconv.Itoa(int(owner)), filter, zone, strconv.Itoa(pageSize)})
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}

func (s *APIV1Service) encodeAgentCursor(query, page string) string {
	if page == "" {
		return ""
	}
	payload, _ := json.Marshal(agentCursor{Query: query, Page: page, Issued: time.Now().Unix()})
	mac := hmac.New(sha256.New, []byte(s.Secret))
	mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *APIV1Service) decodeAgentCursor(value, query string) (string, error) {
	if value == "" {
		return "", nil
	}
	invalid := status.Error(codes.InvalidArgument, "invalid or expired page token; restart with unchanged query parameters")
	if len(value) > 4096 {
		return "", invalid
	}
	payload64, signature64, ok := strings.Cut(value, ".")
	if !ok {
		return "", invalid
	}
	payload, err := base64.RawURLEncoding.DecodeString(payload64)
	if err != nil {
		return "", invalid
	}
	signature, err := base64.RawURLEncoding.DecodeString(signature64)
	if err != nil {
		return "", invalid
	}
	mac := hmac.New(sha256.New, []byte(s.Secret))
	mac.Write(payload)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return "", invalid
	}
	var cursor agentCursor
	if json.Unmarshal(payload, &cursor) != nil || cursor.Query != query || cursor.Page == "" || cursor.Issued > time.Now().Unix() || time.Now().Unix()-cursor.Issued > 86400 {
		return "", invalid
	}
	return cursor.Page, nil
}
