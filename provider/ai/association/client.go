// Package association adapts Cloudflare Workers AI to evidence-bound record discovery.
package association

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/pkg/errors"

	"github.com/EgoSay/kairos/provider/ai"
)

const (
	// EmbeddingModel is the initial, versioned multilingual representation.
	EmbeddingModel = "@cf/qwen/qwen3-embedding-0.6b"
	// ChatModel is the evidence extraction and relationship model.
	ChatModel = "@cf/qwen/qwen3-30b-a3b-fp8"
	// Dimensions prevents mixing incompatible vector spaces.
	Dimensions       = 1024
	maxResponseBytes = 2 << 20
)

// Usage reports billed token counts when the provider supplies them.
type Usage struct {
	Input       int64  `json:"prompt_tokens"`
	Output      int64  `json:"completion_tokens"`
	InputKnown  bool   `json:"-"`
	OutputKnown bool   `json:"-"`
	RequestID   string `json:"-"`
	HTTPStatus  int    `json:"-"`
}

// UnmarshalJSON distinguishes a reported zero from an absent usage field.
func (u *Usage) UnmarshalJSON(data []byte) error {
	var raw struct {
		Input  *int64 `json:"prompt_tokens"`
		Output *int64 `json:"completion_tokens"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	u.InputKnown = raw.Input != nil && *raw.Input >= 0
	u.OutputKnown = raw.Output != nil && *raw.Output >= 0
	if u.InputKnown {
		u.Input = *raw.Input
	}
	if u.OutputKnown {
		u.Output = *raw.Output
	}
	return nil
}

// ResultError identifies a rejected response without including model output.
type ResultError struct{ Code string }

func (e *ResultError) Error() string { return "invalid model result: " + e.Code }

// InvalidResult marks schema, truncation, vector and evidence failures for bounded retry.
func InvalidResult(code string) error { return &ResultError{Code: code} }

// ServiceError exposes safe retry information without provider bodies or private text.
type ServiceError struct {
	Status     int
	Code       int
	RetryAfter time.Duration
	Kind       string
	RequestID  string
}

func (e *ServiceError) Error() string {
	return "Cloudflare inference unavailable (HTTP " + strconv.Itoa(e.Status) + ")"
}

// Client makes bounded, non-streaming calls; it never retries or stores journal text.
type Client struct {
	endpoint string
	key      string
	http     *http.Client
}

// New validates the exact Cloudflare account endpoint before allowing any data transfer.
func New(provider ai.ProviderConfig) (*Client, error) {
	endpoint := strings.TrimRight(provider.Endpoint, "/")
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "https" || u.Host != "api.cloudflare.com" || u.User != nil || u.RawQuery != "" || u.Fragment != "" ||
		!regexp.MustCompile(`^/client/v4/accounts/[a-fA-F0-9]{32}/ai/v1$`).MatchString(u.Path) || provider.APIKey == "" {
		return nil, errors.New("configure a Cloudflare Workers AI account endpoint and API token")
	}
	return &Client{endpoint: endpoint, key: provider.APIKey, http: &http.Client{
		Timeout:       90 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}, nil
}

func (c *Client) request(ctx context.Context, path string, input, output any, usage *Usage) error {
	body, err := json.Marshal(input)
	if err != nil {
		return errors.Wrap(err, "encode model request")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint+path, bytes.NewReader(body))
	if err != nil {
		return errors.New("cannot create model request")
	}
	req.Header.Set("Authorization", "Bearer "+c.key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return &ServiceError{Kind: "connection"}
	}
	defer resp.Body.Close()
	requestID := resp.Header.Get("CF-Ray")
	validRequestID, _ := regexp.MatchString(`^[A-Za-z0-9_-]{1,128}$`, requestID)
	if !validRequestID {
		requestID = ""
	}
	defer func() { usage.RequestID = requestID; usage.HTTPStatus = resp.StatusCode }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		retry := time.Duration(0)
		if seconds, err := strconv.Atoi(resp.Header.Get("Retry-After")); err == nil && seconds > 0 {
			retry = time.Duration(seconds) * time.Second
		} else if at, err := http.ParseTime(resp.Header.Get("Retry-After")); err == nil {
			retry = time.Until(at)
		}
		type errorCode struct {
			Code json.RawMessage `json:"code"`
		}
		var failure struct {
			Errors []errorCode `json:"errors"`
			Error  errorCode   `json:"error"`
		}
		_ = json.NewDecoder(io.LimitReader(resp.Body, 16384)).Decode(&failure)
		raw := failure.Error.Code
		if len(failure.Errors) > 0 {
			raw = failure.Errors[0].Code
		}
		code, _ := strconv.Atoi(strings.Trim(string(raw), "\""))

		return &ServiceError{Status: resp.StatusCode, Code: code, RetryAfter: retry, RequestID: requestID}
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return &ServiceError{Kind: "connection", Status: resp.StatusCode, RequestID: requestID}
	}
	if len(data) > maxResponseBytes {
		return InvalidResult("response-too-large")
	}
	// Preserve accounting even when the rest of a valid response cannot be decoded.
	var envelope struct {
		Usage json.RawMessage `json:"usage"`
	}
	if json.Unmarshal(data, &envelope) == nil && len(envelope.Usage) > 0 {
		_ = json.Unmarshal(envelope.Usage, usage)
	}
	if err := json.Unmarshal(data, output); err != nil {
		return InvalidResult("response-json")
	}
	return nil
}

// Embed returns ordered, unit-normalized vectors. Query instructions are versioned by the caller.
func (c *Client) Embed(ctx context.Context, texts []string) ([][]float32, Usage, error) {
	var usage Usage
	if len(texts) == 0 || len(texts) > 8 {
		return nil, usage, errors.New("embedding batch must contain 1 to 8 texts")
	}
	for _, text := range texts {
		// A conservative UTF-8 byte cap also leaves room for query instructions.
		if strings.TrimSpace(text) == "" || len(text) > 3500 {
			return nil, usage, errors.New("embedding text exceeds input budget")
		}
	}
	var response struct {
		Data []struct {
			Index     int       `json:"index"`
			Embedding []float32 `json:"embedding"`
		} `json:"data"`
		Usage Usage `json:"usage"`
	}
	if err := c.request(ctx, "/embeddings", map[string]any{"model": EmbeddingModel, "input": texts}, &response, &response.Usage); err != nil {
		return nil, response.Usage, err
	}
	if len(response.Data) != len(texts) {
		return nil, response.Usage, InvalidResult("embedding-count")
	}
	vectors := make([][]float32, len(texts))
	for _, item := range response.Data {
		if item.Index < 0 || item.Index >= len(texts) || vectors[item.Index] != nil || len(item.Embedding) != Dimensions {
			return nil, response.Usage, InvalidResult("embedding-dimensions")
		}
		norm := 0.0
		for _, value := range item.Embedding {
			if math.IsInf(float64(value), 0) || math.IsNaN(float64(value)) {
				return nil, response.Usage, InvalidResult("embedding-nonfinite")
			}
			norm += float64(value) * float64(value)
		}
		if norm == 0 {
			return nil, response.Usage, InvalidResult("embedding-zero")
		}
		scale := float32(1 / math.Sqrt(norm))
		for i := range item.Embedding {
			item.Embedding[i] *= scale
		}
		vectors[item.Index] = item.Embedding
	}
	return vectors, response.Usage, nil
}

func (c *Client) chat(ctx context.Context, instruction string, input, output any) (Usage, error) {
	var response struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
			Finish string `json:"finish_reason"`
		} `json:"choices"`
		Usage Usage `json:"usage"`
	}
	encoded, err := json.Marshal(input)
	if err != nil || len(encoded) > 60000 {
		return response.Usage, errors.New("association input exceeds budget")
	}
	err = c.request(ctx, "/chat/completions", map[string]any{
		"model": ChatModel, "stream": false, "temperature": 0.2, "max_tokens": 2400,
		"messages":        []map[string]string{{"role": "system", "content": instruction}, {"role": "user", "content": string(encoded) + "\n/no_think"}},
		"response_format": map[string]string{"type": "json_object"},
	}, &response, &response.Usage)
	if err != nil {
		return response.Usage, err
	}
	if len(response.Choices) != 1 || response.Choices[0].Finish != "stop" {
		return response.Usage, InvalidResult("generation-incomplete")
	}
	d := json.NewDecoder(strings.NewReader(response.Choices[0].Message.Content))
	d.DisallowUnknownFields()
	if d.Decode(output) != nil || d.Decode(&struct{}{}) != io.EOF {
		return response.Usage, InvalidResult("result-schema")
	}
	return response.Usage, nil
}
