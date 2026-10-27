package test

import (
	"context"
	"encoding/json"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/EgoSay/kairos/store"
)

func graphSource(t *testing.T, s *store.Store, owner, id int32) *store.GraphSource {
	t.Helper()
	rows, err := s.ListGraphSources(context.Background(), &store.FindGraphSource{OwnerID: owner, MemoIDs: []int32{id}, Limit: 1})
	require.NoError(t, err)
	require.Len(t, rows, 1)
	return rows[0]
}

func claimGraph(t *testing.T, s *store.Store, source *store.GraphSource) *store.GraphPublication {
	t.Helper()
	nowSec := time.Now().Unix()
	source.LeaseToken = "lease-" + time.Now().Format("150405.000000000")
	source.LeaseUntil = nowSec + 120
	ok, err := s.ClaimGraphSource(context.Background(), source, nowSec)
	require.NoError(t, err)
	require.True(t, ok)
	epoch, err := s.GraphEpoch(context.Background(), source.OwnerID)
	require.NoError(t, err)
	source.Profile = "test-v1"
	source.Representation = json.RawMessage(`{"embedding":[]}`)
	source.State = "ready"
	return &store.GraphPublication{Source: source, ExpectedEpoch: epoch, Now: nowSec}
}

func TestGraphAtomicMutationLeaseVersionsAndWithdrawal(t *testing.T) {
	ctx := context.Background()
	s := NewTestingStore(ctx, t)
	t.Cleanup(func() { require.NoError(t, s.Close()) })
	owner, err := createTestingHostUser(ctx, s)
	require.NoError(t, err)
	a, err := s.CreateMemo(ctx, &store.Memo{UID: "graph-a", CreatorID: owner.ID, Content: "first", Visibility: store.Private})
	require.NoError(t, err)
	b, err := s.CreateMemo(ctx, &store.Memo{UID: "graph-b", CreatorID: owner.ID, Content: "second", Visibility: store.Private})
	require.NoError(t, err)
	initial := graphSource(t, s, owner.ID, a.ID)
	require.True(t, initial.Dirty)
	changed := "changed"
	err = s.ApplyMemoMutation(ctx, &store.MemoMutation{MemoID: a.ID, MemoCreatorID: owner.ID, ExpectedMemoContent: a.Content, MemoUpdate: &store.UpdateMemo{ID: a.ID, Content: &changed}, JournalDocuments: []*store.JournalDocumentMutation{{Document: &store.JournalDocument{OwnerID: owner.ID, Kind: "preferences", Key: "main", Payload: json.RawMessage(`{}`)}, ExpectedVersion: 99}}})
	require.Error(t, err)
	require.Equal(t, initial.Revision, graphSource(t, s, owner.ID, a.ID).Revision, "source intent rolls back with original save")
	pubA := claimGraph(t, s, graphSource(t, s, owner.ID, a.ID))
	require.NoError(t, s.PublishGraphSource(ctx, pubA))
	pubB := claimGraph(t, s, graphSource(t, s, owner.ID, b.ID))
	pubB.Edges = []*store.GraphEdge{{OwnerID: owner.ID, A: a.ID, B: b.ID, RevisionA: initial.Revision, RevisionB: pubB.Source.Revision, Profile: "test-v1", Payload: json.RawMessage(`{"hint":"fixture"}`)}}
	require.NoError(t, s.PublishGraphSource(ctx, pubB))
	edges, err := s.ListGraphEdges(ctx, owner.ID, a.ID, "test-v1", 4)
	require.NoError(t, err)
	require.Len(t, edges, 1)
	connected, err := s.ListGraphSources(ctx, &store.FindGraphSource{OwnerID: owner.ID, ConnectedOnly: true, ReadableOnly: true, Limit: 4, ExcludeRepresentation: true})
	require.NoError(t, err)
	require.Len(t, connected, 2)
	foreign, err := s.ListGraphEdges(ctx, owner.ID+1, a.ID, "test-v1", 4)
	require.NoError(t, err)
	require.Empty(t, foreign)
	require.NoError(t, s.UpdateMemo(ctx, &store.UpdateMemo{ID: a.ID, Content: &changed}))
	edges, err = s.ListGraphEdges(ctx, owner.ID, b.ID, "test-v1", 4)
	require.NoError(t, err)
	require.Empty(t, edges, "old evidence is inaccessible immediately")
	late := claimGraph(t, s, graphSource(t, s, owner.ID, a.ID))
	ok, err := s.ClaimGraphSource(ctx, late.Source, time.Now().Unix())
	require.NoError(t, err)
	require.False(t, ok, "only one active lease")
	require.NoError(t, s.UpdateMemo(ctx, &store.UpdateMemo{ID: a.ID, Content: &a.Content}))
	require.ErrorIs(t, s.PublishGraphSource(ctx, late), store.ErrGraphConflict, "ABA restore must reject the old generation")
	late = claimGraph(t, s, graphSource(t, s, owner.ID, a.ID))
	_, err = s.PutJournalDocument(ctx, &store.JournalDocument{OwnerID: owner.ID, Kind: "preferences", Key: "main", Payload: json.RawMessage(`{"excludedMemoNames":["memos/graph-a"]}`)}, 0)
	require.NoError(t, err)
	require.ErrorIs(t, s.PublishGraphSource(ctx, late), store.ErrGraphConflict)
	late = claimGraph(t, s, graphSource(t, s, owner.ID, a.ID))
	require.NoError(t, s.DeleteMemo(ctx, &store.DeleteMemo{ID: a.ID}))
	require.ErrorIs(t, s.PublishGraphSource(ctx, late), store.ErrGraphConflict)
	remaining, err := s.ListGraphSources(ctx, &store.FindGraphSource{OwnerID: owner.ID, MemoIDs: []int32{a.ID}, Limit: 1})
	require.NoError(t, err)
	require.Empty(t, remaining)
}

// A bounded random seek must not sort or scan the entire owner's connected graph.
// This reproduces the 17-second regression hidden by small reading fixtures.
func TestGraphRandomSeekWithLargePreparedLibrary(t *testing.T) {
	if getDriverFromEnv() != "sqlite" {
		t.Skip("SQLite query-planner regression")
	}
	ctx := context.Background()
	s := NewTestingStore(ctx, t)
	t.Cleanup(func() { require.NoError(t, s.Close()) })
	owner, err := createTestingHostUser(ctx, s)
	require.NoError(t, err)
	tx, err := s.GetDriver().GetDB().BeginTx(ctx, nil)
	require.NoError(t, err)
	defer tx.Rollback()
	insert, err := tx.PrepareContext(ctx, `INSERT INTO memo(id,uid,creator_id,content,visibility,payload) VALUES(?,?,?,'fixture','PRIVATE','{}')`)
	require.NoError(t, err)
	defer insert.Close()
	for id := 1; id <= 10000; id++ {
		_, err = insert.ExecContext(ctx, id, "seek-"+strconv.Itoa(id), owner.ID)
		require.NoError(t, err)
	}
	_, err = tx.ExecContext(ctx, `UPDATE record_graph_source SET profile='seek',processed_revision=revision,dirty=0,state='ready'`)
	require.NoError(t, err)
	_, err = tx.ExecContext(ctx, `INSERT INTO record_graph_edge(owner_id,a,b,revision_a,revision_b,profile,payload) SELECT owner_id,memo_id,memo_id+1,1,1,'seek','{}' FROM record_graph_source WHERE memo_id<10000`)
	require.NoError(t, err)
	require.NoError(t, tx.Commit())
	bounded, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	rows, err := s.ListGraphSources(bounded, &store.FindGraphSource{OwnerID: owner.ID, AfterID: 5000, ConnectedOnly: true, ReadableOnly: true, ExcludeRepresentation: true, Limit: 4})
	require.NoError(t, err, "four neighbors must not require a full graph sort")
	require.Len(t, rows, 4)
	require.EqualValues(t, 5001, rows[0].MemoID)
}
