package recordgraph

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	storepb "github.com/EgoSay/kairos/proto/gen/store"
	"github.com/EgoSay/kairos/provider/ai"
	"github.com/EgoSay/kairos/provider/ai/association"
	"github.com/EgoSay/kairos/store"
	storetest "github.com/EgoSay/kairos/store/test"
)

type testModel struct {
	calls          int
	embedError     error
	facetError     error
	beforeRelation func()
	seen           []string
}

func (m *testModel) Embed(_ context.Context, texts []string) ([][]float32, association.Usage, error) {
	m.calls++
	m.seen = append(m.seen, texts...)
	if m.embedError != nil {
		return nil, association.Usage{}, m.embedError
	}
	out := [][]float32{}
	for range texts {
		v := make([]float32, association.Dimensions)
		v[0] = 1
		out = append(out, v)
	}
	return out, association.Usage{Input: 100}, nil
}
func (m *testModel) Facets(_ context.Context, source association.Source) ([]association.Facet, association.Usage, error) {
	m.calls++
	m.seen = append(m.seen, source.Text)
	if m.facetError != nil {
		return nil, association.Usage{}, m.facetError
	}
	return []association.Facet{}, association.Usage{Input: 100, Output: 20}, nil
}
func (m *testModel) Relate(_ context.Context, source association.Source, targets []association.Source) ([]association.Relation, association.Usage, error) {
	m.calls++
	if m.beforeRelation != nil {
		m.beforeRelation()
	}
	out := []association.Relation{}
	for _, target := range targets[:min(4, len(targets))] {
		out = append(out, association.Relation{Target: target.Name, Kind: "cross-context", Hint: "两段记录都谈到了陪伴", Topic: "怎样陪伴", Context: "发生在不同关系里", SourceQuote: firstQuote(source.Text), TargetQuote: firstQuote(target.Text)})
	}
	return out, association.Usage{Input: 200, Output: 100}, nil
}
func firstQuote(text string) string { r := []rune(text); return string(r[:min(40, len(r))]) }
func fixture(t *testing.T) (*Service, *testModel, int32) {
	t.Helper()
	ctx := context.Background()
	db := storetest.NewTestingStore(ctx, t)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	u, err := db.CreateUser(ctx, &store.User{Username: "graph-owner", Role: store.RoleAdmin})
	require.NoError(t, err)
	_, err = db.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{Key: storepb.InstanceSettingKey_AI, Value: &storepb.InstanceSetting_AiSetting{AiSetting: &storepb.InstanceAISetting{Providers: []*storepb.AIProviderConfig{{Id: "cf", Title: "Cloudflare", Type: storepb.AIProviderType_OPENAI, Endpoint: "https://api.cloudflare.com/client/v4/accounts/00000000000000000000000000000000/ai/v1", ApiKey: "synthetic-test-only"}}}}})
	require.NoError(t, err)
	model := &testModel{}
	service := New(db)
	service.NewModel = func(ai.ProviderConfig) (Model, error) { return model, nil }
	_, err = service.Configure(ctx, u.ID, Config{ProviderID: "cf", Enabled: true, FreePlanConfirmed: true, DailyNeurons: 8000})
	require.NoError(t, err)
	return service, model, u.ID
}
func add(t *testing.T, s *Service, owner int32, uid, body string) *store.Memo {
	t.Helper()
	m, err := s.Store.CreateMemo(context.Background(), &store.Memo{UID: uid, CreatorID: owner, Content: body, Visibility: store.Private})
	require.NoError(t, err)
	return m
}
func run(t *testing.T, s *Service) {
	t.Helper()
	changed, err := s.RunOnce(context.Background())
	require.NoError(t, err)
	require.True(t, changed)
}

func TestPreparedReadingNeverCallsModelAndWithdrawalIsImmediate(t *testing.T) {
	ctx := context.Background()
	s, m, owner := fixture(t)
	a := add(t, s, owner, "love-note", "恋人需要的陪伴，有时只是安静地坐在旁边。")
	b := add(t, s, owner, "family-note", "陪伴父母的时候，我总想给建议，其实他们只想让我听一听。")
	other, err := s.Store.CreateUser(ctx, &store.User{Username: "another", Role: store.RoleUser})
	require.NoError(t, err)
	add(t, s, other.ID, "foreign-note", "private forbidden original")
	run(t, s)
	run(t, s)
	n, err := s.Neighborhood(ctx, owner, a.ID)
	require.NoError(t, err)
	require.Len(t, n.Directions, 1)
	require.Equal(t, "memos/"+b.UID, n.Directions[0].Original.Name)
	require.Contains(t, a.Content, n.Directions[0].SourceQuote)
	calls := m.calls
	for range 20 {
		_, err = s.Neighborhood(ctx, owner, a.ID)
		require.NoError(t, err)
		_, err = s.Bootstrap(ctx, owner, nil)
		require.NoError(t, err)
	}
	require.Equal(t, calls, m.calls, "reading, bootstrapping and prefetching must be entirely local")
	foreign, err := s.ByName(ctx, other.ID, "memos/"+a.UID)
	require.NoError(t, err)
	require.Nil(t, foreign.Root)
	require.NotContains(t, strings.Join(m.seen, " "), "private forbidden original")
	require.NoError(t, s.Feedback(ctx, owner, "memos/"+a.UID, "memos/"+b.UID, true))
	n, err = s.Neighborhood(ctx, owner, a.ID)
	require.NoError(t, err)
	require.Empty(t, n.Directions)
	require.NoError(t, s.Feedback(ctx, owner, "memos/"+a.UID, "memos/"+b.UID, false))
	n, err = s.Neighborhood(ctx, owner, a.ID)
	require.NoError(t, err)
	require.Len(t, n.Directions, 1)
	changed := "新的记录内容，旧的引文已不存在。"
	require.NoError(t, s.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: b.ID, Content: &changed}))
	n, err = s.Neighborhood(ctx, owner, a.ID)
	require.NoError(t, err)
	require.Empty(t, n.Directions)
	_, err = s.Store.PutJournalDocument(ctx, &store.JournalDocument{OwnerID: owner, Kind: "preferences", Key: "main", Payload: json.RawMessage(`{"excludedMemoNames":["memos/love-note"]}`)}, 0)
	require.NoError(t, err)
	n, err = s.Neighborhood(ctx, owner, a.ID)
	require.NoError(t, err)
	require.Nil(t, n.Root)
}

func TestLateModelResultCannotPublishAfterConcurrentEdit(t *testing.T) {
	ctx := context.Background()
	s, m, owner := fixture(t)
	a := add(t, s, owner, "source-one", "第一篇谈陪伴")
	b := add(t, s, owner, "source-two", "第二篇谈陪伴")
	run(t, s)
	m.beforeRelation = func() {
		body := "改变后的第一篇"
		require.NoError(t, s.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: a.ID, Content: &body}))
	}
	changed, err := s.RunOnce(ctx)
	require.NoError(t, err)
	require.False(t, changed)
	n, err := s.Neighborhood(ctx, owner, b.ID)
	require.NoError(t, err)
	require.Empty(t, n.Directions)
}

func TestQuotaAndConfigurationPauseDoNotRetryOrSendOtherSources(t *testing.T) {
	ctx := context.Background()
	s, m, owner := fixture(t)
	add(t, s, owner, "first", "第一篇")
	add(t, s, owner, "second", "第二篇")
	m.embedError = &association.ServiceError{Status: 429, Code: 3036}
	_, err := s.RunOnce(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, m.calls)
	_, err = s.RunOnce(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, m.calls, "daily quota applies to all queued sources")
	state, err := s.Status(ctx, owner)
	require.NoError(t, err)
	require.Equal(t, "quota-paused", state.State)
	cfg, err := s.GetConfig(ctx, owner)
	require.NoError(t, err)
	cfg.Enabled = false
	_, err = s.Configure(ctx, owner, cfg)
	require.NoError(t, err)
	_, err = s.RunOnce(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, m.calls)
}

func TestBudgetReservationsAreAtomicAndDurable(t *testing.T) {
	ctx := context.Background()
	s, _, _ := fixture(t)
	account := digest("test-account")
	day := time.Now().UTC().Format("2006-01-02")
	var wins atomic.Int32
	var wg sync.WaitGroup
	for range 12 {
		wg.Go(func() {
			ok, err := s.Store.ReserveGraphBudget(ctx, account, day, 300, 900)
			require.NoError(t, err)
			if ok {
				wins.Add(1)
			}
		})
	}
	wg.Wait()
	require.Equal(t, int32(3), wins.Load())
	used, err := s.Store.ReadGraphBudget(ctx, account, day)
	require.NoError(t, err)
	require.Equal(t, int64(900), used)
	fresh := New(s.Store)
	used, err = fresh.Store.ReadGraphBudget(ctx, account, day)
	require.NoError(t, err)
	require.Equal(t, int64(900), used)
	require.NoError(t, s.Store.RefundGraphBudget(ctx, account, day, 50))
	used, err = s.Store.ReadGraphBudget(ctx, account, day)
	require.NoError(t, err)
	require.Equal(t, int64(850), used)
}

func TestLongOriginalChunksCoverEnd(t *testing.T) {
	s, _, owner := fixture(t)
	body := strings.Repeat("这是一段完整原文，后面的想法也应被理解。", 200)
	chunks, err := split(body)
	require.NoError(t, err)
	require.Greater(t, len(chunks), 2)
	require.Equal(t, 0, chunks[0].Start)
	require.Equal(t, len(body), chunks[len(chunks)-1].End)
	for i, c := range chunks {
		_, ok := c.text(body)
		require.True(t, ok)
		if i > 0 {
			require.LessOrEqual(t, c.Start, chunks[i-1].End)
		}
	}
	add(t, s, owner, "long-original", body)
	ctx := context.Background()
	changed, err := s.RunOnce(ctx)
	require.NoError(t, err)
	require.True(t, changed)
	n, err := s.Bootstrap(ctx, owner, nil)
	require.NoError(t, err)
	require.NotNil(t, n.Root)
	require.LessOrEqual(t, len(n.Root.Content), 12000)
	_, err = split(strings.Repeat("字", 70000))
	require.Error(t, err)
}

func TestDeferredWorkReusesValidatedEmbeddingAfterRestart(t *testing.T) {
	ctx := context.Background()
	s, m, owner := fixture(t)
	memo := add(t, s, owner, "retry-original", "重试也不应反复计算已经完成的向量。")
	m.facetError = &association.ServiceError{Status: 503}
	changed, err := s.RunOnce(ctx)
	require.NoError(t, err)
	require.False(t, changed)
	require.Equal(t, 2, m.calls)
	rows, err := s.Store.ListGraphSources(ctx, &store.FindGraphSource{OwnerID: owner, MemoIDs: []int32{memo.ID}, Limit: 1})
	require.NoError(t, err)
	r, err := decodeRepresentation(rows[0].Representation)
	require.NoError(t, err)
	require.Len(t, r.Chunks, 1)
	require.Len(t, r.Chunks[0].Vector, 1024)
	require.Zero(t, rows[0].ProcessedRevision)
	_, err = s.Store.GetDriver().GetDB().ExecContext(ctx, "UPDATE record_graph_source SET next_attempt_ts=0")
	require.NoError(t, err)
	fresh := New(s.Store)
	fresh.NewModel = s.NewModel
	m.facetError = nil
	run(t, fresh)
	require.Equal(t, 3, m.calls, "only the failed extraction is repeated; the embedding is restored from durable work")
}

func TestManualLinksNeedNoModelAndRespectExclusion(t *testing.T) {
	ctx := context.Background()
	s, m, owner := fixture(t)
	a := add(t, s, owner, "manual-a", "明确留下的链接")
	b := add(t, s, owner, "manual-b", "另一篇原文")
	_, err := s.Store.UpsertMemoRelation(ctx, &store.MemoRelation{MemoID: a.ID, RelatedMemoID: b.ID, Type: store.MemoRelationReference})
	require.NoError(t, err)
	n, err := s.Neighborhood(ctx, owner, a.ID)
	require.NoError(t, err)
	require.Len(t, n.Directions, 1)
	require.True(t, n.Directions[0].Manual)
	require.Zero(t, m.calls)
	_, err = s.Store.PutJournalDocument(ctx, &store.JournalDocument{OwnerID: owner, Kind: "preferences", Key: "main", Payload: json.RawMessage(`{"excludedMemoNames":["memos/manual-b"]}`)}, 0)
	require.NoError(t, err)
	n, err = s.Neighborhood(ctx, owner, a.ID)
	require.NoError(t, err)
	require.Empty(t, n.Directions)
}
