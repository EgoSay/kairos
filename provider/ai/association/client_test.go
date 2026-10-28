package association

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/EgoSay/kairos/provider/ai"
)

func modelServer(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return &Client{endpoint: server.URL, key: "test-token", http: &http.Client{Timeout: time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

func vector(value float32) []float32 {
	result := make([]float32, Dimensions)
	result[0] = value
	return result
}

func TestEmbeddingResponseMappingAndNormalization(t *testing.T) {
	c := modelServer(t, func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "Bearer test-token", r.Header.Get("Authorization"))
		var request struct {
			Model string
			Input []string
		}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
		require.Equal(t, EmbeddingModel, request.Model)
		require.Equal(t, []string{"甲", "乙"}, request.Input)
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"index": 1, "embedding": vector(3)}, map[string]any{"index": 0, "embedding": vector(-5)}}, "usage": map[string]int{"prompt_tokens": 2}}))
	})
	v, u, err := c.Embed(context.Background(), []string{"甲", "乙"})
	require.NoError(t, err)
	require.Equal(t, float32(-1), v[0][0])
	require.Equal(t, float32(1), v[1][0])
	require.Equal(t, int64(2), u.Input)
}

func TestInvalidEmbeddingNeverReachesIndex(t *testing.T) {
	for _, tc := range []struct {
		name string
		data any
	}{
		{"missing", []any{}},
		{"dimensions", []any{map[string]any{"index": 0, "embedding": []float32{1}}}},
		{"zero", []any{map[string]any{"index": 0, "embedding": vector(0)}}},
		{"wrong-index", []any{map[string]any{"index": 1, "embedding": vector(1)}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := modelServer(t, func(w http.ResponseWriter, _ *http.Request) {
				require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"data": tc.data}))
			})
			_, _, err := c.Embed(context.Background(), []string{"source"})
			require.Error(t, err)
		})
	}
}

func TestRelationshipRequiresAllowedTargetsAndExactOriginalQuotes(t *testing.T) {
	source := Source{Name: "a", Text: "我希望对方知道，但没有说出口。"}
	candidate := Source{Name: "b", Text: "没和家人说，怕他们担心。"}
	for _, tc := range []struct {
		name, target, quote string
		valid               bool
	}{
		{"valid", "b", "没有说出口", true}, {"foreign-source", "c", "没有说出口", false}, {"invented-quote", "b", "不懂表达自己", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := modelServer(t, func(w http.ResponseWriter, r *http.Request) {
				var req map[string]any
				require.NoError(t, json.NewDecoder(r.Body).Decode(&req))
				require.NotContains(t, req, "tools")
				content, _ := json.Marshal(map[string]any{"relations": []Relation{{Target: tc.target, Kind: "cross-context", Hint: "这两次都留下了没说出口的话。", Topic: "表达需要", SourceQuote: tc.quote, TargetQuote: "怕他们担心"}}})
				require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"content": string(content)}}}}))
			})
			relations, _, err := c.Relate(context.Background(), source, []Source{candidate})
			if tc.valid {
				require.NoError(t, err)
				require.Len(t, relations, 1)
			} else {
				require.Error(t, err)
				require.Empty(t, relations)
			}
		})
	}
}

func TestProviderLimitsErrorsAndCancellation(t *testing.T) {
	c := modelServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "20")
		w.WriteHeader(429)
		_, _ = w.Write([]byte("PRIVATE_TEXT_TOKEN"))
	})
	_, _, err := c.Embed(context.Background(), []string{"text"})
	var unavailable *ServiceError
	require.ErrorAs(t, err, &unavailable)
	require.Equal(t, 20*time.Second, unavailable.RetryAfter)
	require.NotContains(t, err.Error(), "PRIVATE_TEXT_TOKEN")
	_, _, err = c.Embed(context.Background(), []string{strings.Repeat("x", 3501)})
	require.ErrorContains(t, err, "budget")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, _, err = c.Embed(ctx, []string{"text"})
	require.ErrorIs(t, err, context.Canceled)
}

func TestProductionEndpointCannotRedirectCredentialsElsewhere(t *testing.T) {
	for _, endpoint := range []string{"http://api.cloudflare.com/client/v4/accounts/" + strings.Repeat("a", 32) + "/ai/v1", "https://evil.example/v1", "https://api.cloudflare.com.evil.example/v1", "https://api.cloudflare.com/client/v4/accounts/invalid/ai/v1"} {
		_, err := New(ai.ProviderConfig{Endpoint: endpoint, APIKey: "secret"})
		require.Error(t, err)
	}
	_, err := New(ai.ProviderConfig{Endpoint: "https://api.cloudflare.com/client/v4/accounts/" + strings.Repeat("a", 32) + "/ai/v1", APIKey: "secret"})
	require.NoError(t, err)
	redirect := modelServer(t, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://example.invalid", http.StatusTemporaryRedirect)
	})
	_, _, err = redirect.Embed(context.Background(), []string{"text"})
	var failure *ServiceError
	require.ErrorAs(t, err, &failure)
	require.Equal(t, 307, failure.Status)
}

func TestDailyQuotaCodeSupportsBothErrorEnvelopes(t *testing.T) {
	for _, body := range []string{`{"errors":[{"code":3036,"message":"private"}]}`, `{"error":{"code":"3036","message":"private"}}`} {
		c := modelServer(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(429); _, _ = w.Write([]byte(body)) })
		_, _, err := c.Embed(context.Background(), []string{"fixture"})
		var remote *ServiceError
		require.ErrorAs(t, err, &remote)
		require.Equal(t, 3036, remote.Code)
		require.NotContains(t, err.Error(), "private")
	}
}

func TestHTTPFailureRetainsExplicitUsageWithoutExposingBody(t *testing.T) {
	c := modelServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("CF-Ray", "synthetic-request-LAX")
		w.WriteHeader(500)
		_, _ = w.Write([]byte(`{"error":{"message":"PRIVATE_MODEL_OUTPUT"},"usage":{"prompt_tokens":100,"completion_tokens":0}}`))
	})
	_, usage, err := c.Facets(context.Background(), Source{Name: "fixture", Text: "fictional"})
	var remote *ServiceError
	require.ErrorAs(t, err, &remote)
	require.True(t, usage.InputKnown)
	require.True(t, usage.OutputKnown)
	require.EqualValues(t, 100, usage.Input)
	require.Zero(t, usage.Output)
	require.Equal(t, 500, usage.HTTPStatus)
	require.Equal(t, "synthetic-request-LAX", usage.RequestID)
	require.NotContains(t, err.Error(), "PRIVATE")
}

func TestUsagePresenceAndTruncatedResponsesPreserveAccounting(t *testing.T) {
	for _, tc := range []struct {
		name, usage             string
		inputKnown, outputKnown bool
	}{
		{"absent", ``, false, false}, {"zero", `,"usage":{"prompt_tokens":0,"completion_tokens":0}`, true, true}, {"partial", `,"usage":{"prompt_tokens":100}`, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := modelServer(t, func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("CF-Ray", "request-123-LAX")
				_, _ = w.Write([]byte(`{"choices":[{"finish_reason":"length","message":{"content":"PRIVATE_INVALID_MODEL_TEXT"}}]` + tc.usage + `}`))
			})
			_, usage, err := c.Facets(context.Background(), Source{Name: "fixture", Text: "fictional source"})
			var invalid *ResultError
			require.ErrorAs(t, err, &invalid)
			require.Equal(t, "generation-incomplete", invalid.Code)
			require.Equal(t, tc.inputKnown, usage.InputKnown)
			require.Equal(t, tc.outputKnown, usage.OutputKnown)
			require.Equal(t, "request-123-LAX", usage.RequestID)
			require.Equal(t, 200, usage.HTTPStatus)
			require.NotContains(t, err.Error(), "PRIVATE")
		})
	}
}

func TestEmptyArrayIsValidButMissingResultIsNot(t *testing.T) {
	for _, tc := range []struct {
		content string
		valid   bool
	}{{`{"facets":[]}`, true}, {`{}`, false}, {`{"facets":null}`, false}} {
		c := modelServer(t, func(w http.ResponseWriter, _ *http.Request) {
			_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"content": tc.content}}}, "usage": map[string]int{"prompt_tokens": 20, "completion_tokens": 2}})
		})
		_, u, err := c.Facets(context.Background(), Source{Name: "fixture", Text: "fictional"})
		require.Equal(t, tc.valid, err == nil)
		require.True(t, u.InputKnown)
		require.True(t, u.OutputKnown)
	}
}

func TestEvidenceFailureReasonDistinguishesShapeFromQuoteMismatch(t *testing.T) {
	for _, tc := range []struct {
		name, content, want string
		relations           bool
	}{
		{"long-question", `{"facets":[{"question":"` + strings.Repeat("x", 161) + `","quote":"fictional source"}]}`, "result-schema", false},
		{"invented-facet-quote", `{"facets":[{"question":"topic","quote":"invented"}]}`, "quote-mismatch", false},
		{"foreign-target", `{"relations":[{"target":"foreign","kind":"complement","hint":"hint","context":"","topic":"topic","sourceQuote":"fictional source","targetQuote":"fictional target"}]}`, "result-schema", true},
		{"long-hint", `{"relations":[{"target":"target","kind":"complement","hint":"` + strings.Repeat("x", 241) + `","context":"","topic":"topic","sourceQuote":"fictional source","targetQuote":"fictional target"}]}`, "result-schema", true},
		{"invented-relation-quote", `{"relations":[{"target":"target","kind":"complement","hint":"hint","context":"","topic":"topic","sourceQuote":"invented","targetQuote":"fictional target"}]}`, "quote-mismatch", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := modelServer(t, func(w http.ResponseWriter, _ *http.Request) {
				_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"content": tc.content}}}, "usage": map[string]int{"prompt_tokens": 20, "completion_tokens": 2}})
			})
			source := Source{Name: "source", Text: "fictional source"}
			var err error
			var usage Usage
			if tc.relations {
				_, usage, err = c.Relate(context.Background(), source, []Source{{Name: "target", Text: "fictional target"}})
			} else {
				_, usage, err = c.Facets(context.Background(), source)
			}
			var rejected *ResultError
			require.ErrorAs(t, err, &rejected)
			require.Equal(t, tc.want, rejected.Code)
			require.True(t, usage.InputKnown)
			require.True(t, usage.OutputKnown)
		})
	}
}
