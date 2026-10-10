package v1

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"

	v1pb "github.com/EgoSay/kairos/proto/gen/api/v1"
	storepb "github.com/EgoSay/kairos/proto/gen/store"
	"github.com/EgoSay/kairos/store"
)

func TestJournalInsightFailureCancellationAndLimitsKeepOriginals(t *testing.T) {
	for _, scenario := range []string{"provider-error", "incomplete-response", "unselected-citation", "cancelled", "text-limit", "selection-limit"} {
		t.Run(scenario, func(t *testing.T) {
			svc, ownerCtx := newUploadTestService(t)
			memo, err := svc.CreateMemo(ownerCtx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "原话与 **格式**\n\n都应保持", Visibility: v1pb.Visibility_PRIVATE}})
			require.NoError(t, err)
			uid := strings.TrimPrefix(memo.Name, "memos/")
			original, err := svc.Store.GetMemo(ownerCtx, &store.FindMemo{UID: &uid})
			require.NoError(t, err)
			if scenario == "text-limit" {
				long := strings.Repeat("原", 20001)
				require.NoError(t, svc.Store.UpdateMemo(ownerCtx, &store.UpdateMemo{ID: original.ID, Content: &long}))
				original, err = svc.Store.GetMemo(ownerCtx, &store.FindMemo{UID: &uid})
				require.NoError(t, err)
			}
			baseline, err := svc.journalRecordHash(ownerCtx, original)
			require.NoError(t, err)
			var calls atomic.Int32
			started, observedCancellation := make(chan struct{}, 1), make(chan struct{}, 1)
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				calls.Add(1)
				// Consume the request like a real provider before awaiting cancel;
				// unread HTTP/1 bodies otherwise prevent disconnect observation.
				_, err := io.Copy(io.Discard, req.Body)
				require.NoError(t, err)
				if scenario == "cancelled" {
					started <- struct{}{}
					select {
					case <-req.Context().Done():
						observedCancellation <- struct{}{}
					case <-time.After(5 * time.Second):
					}
					return
				}
				if scenario == "provider-error" {
					http.Error(w, "synthetic provider unavailable", http.StatusServiceUnavailable)
					return
				}
				finish := "stop"
				if scenario == "incomplete-response" {
					finish = "length"
				}
				result, err := json.Marshal(map[string]any{"text": "synthetic observation", "citations": []string{"memos/not-selected"}})
				require.NoError(t, err)
				require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": finish, "message": map[string]any{"content": string(result)}}}}))
			}))
			defer provider.Close()
			_, err = svc.Store.UpsertInstanceSetting(ownerCtx, &storepb.InstanceSetting{Key: storepb.InstanceSettingKey_AI, Value: &storepb.InstanceSetting_AiSetting{AiSetting: &storepb.InstanceAISetting{Providers: []*storepb.AIProviderConfig{{Id: "isolated", Type: storepb.AIProviderType_OPENAI, Endpoint: provider.URL, ApiKey: "synthetic-secret"}}}}})
			require.NoError(t, err)
			router := echo.New()
			svc.registerJournalInsightRoutes(router.Group("/api/v1/journal"))
			configured := journalHTTP(ownerCtx, t, router, http.MethodPut, "/api/v1/journal/ai/config", journalAIConfig{ProviderID: "isolated", Model: "fixture-model"})
			require.Equal(t, http.StatusOK, configured.Code, configured.Body.String())
			require.Zero(t, calls.Load())
			names := []string{memo.Name}
			if scenario == "selection-limit" {
				for len(names) < 31 {
					names = append(names, memo.Name)
				}
			}
			requestCtx, cancel := context.WithCancel(ownerCtx)
			defer cancel()
			responses := make(chan *httptest.ResponseRecorder, 1)
			go func() {
				responses <- journalHTTP(requestCtx, t, router, http.MethodPost, "/api/v1/journal/insights/generate", map[string]any{"memoNames": names})
			}()
			if scenario == "cancelled" {
				select {
				case <-started:
					cancel()
				case <-time.After(5 * time.Second):
					t.Fatal("provider request did not start")
				}
			}
			select {
			case response := <-responses:
				require.GreaterOrEqual(t, response.Code, 400, response.Body.String())
				require.NotContains(t, response.Body.String(), "synthetic-secret")
			case <-time.After(5 * time.Second):
				t.Fatal("failed or cancelled request did not finish")
			}
			if scenario == "cancelled" {
				select {
				case <-observedCancellation:
				case <-time.After(5 * time.Second):
					t.Fatal("provider request did not receive cancellation")
				}
			}
			if scenario == "text-limit" || scenario == "selection-limit" {
				require.Zero(t, calls.Load(), "oversized inputs must fail before sending any text")
			} else {
				require.Equal(t, int32(1), calls.Load(), "failure must not silently retry the external request")
			}
			after, err := svc.Store.GetMemo(ownerCtx, &store.FindMemo{UID: &uid})
			require.NoError(t, err)
			version, err := svc.journalRecordHash(ownerCtx, after)
			require.NoError(t, err)
			require.Equal(t, baseline, version)
			require.Equal(t, original.Content, after.Content)
			require.Equal(t, original.UpdatedTs, after.UpdatedTs)
			insights := journalHTTP(ownerCtx, t, router, http.MethodGet, "/api/v1/journal/insights", nil)
			require.Equal(t, http.StatusOK, insights.Code)
			require.JSONEq(t, `[]`, insights.Body.String(), "failed results must never be saved implicitly")
		})
	}
}
