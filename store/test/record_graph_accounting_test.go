package test

import (
	"context"
	"os"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
	"uuid"

	"github.com/stretchr/testify/require"

	"github.com/EgoSay/kairos/store"
)

func TestGraphConnectionCircuitAllowsOneProbe(t *testing.T) {
	ctx := context.Background()
	s := NewTestingStore(ctx, t)
	t.Cleanup(func() { require.NoError(t, s.Close()) })
	nowSec := time.Now().Unix()
	key := strings.Repeat("b", 64)
	require.NoError(t, s.PutGraphRuntime(ctx, store.GraphRuntime{Key: key, Failures: 3, Trips: 1, Until: nowSec, Code: "connection"}))
	var accepted atomic.Int32
	var wg sync.WaitGroup
	for range 10 {
		wg.Go(func() {
			ok, err := s.ClaimGraphProbe(ctx, key, nowSec)
			require.NoError(t, err)
			if ok {
				accepted.Add(1)
			}
		})
	}
	wg.Wait()
	require.EqualValues(t, 1, accepted.Load())
}

func TestGraphCallReservationsSettleExactlyOnceAcrossDays(t *testing.T) {
	ctx := context.Background()
	s := NewTestingStore(ctx, t)
	t.Cleanup(func() { require.NoError(t, s.Close()) })
	owner, err := createTestingHostUser(ctx, s)
	require.NoError(t, err)
	memo, err := s.CreateMemo(ctx, &store.Memo{UID: "billing", CreatorID: owner.ID, Content: "synthetic", Visibility: store.Private})
	require.NoError(t, err)
	account := strings.Repeat("a", 64)
	day := "2026-10-27"
	var mu sync.Mutex
	entries := []*store.GraphCall{}
	var wg sync.WaitGroup
	for range 12 {
		wg.Go(func() {
			c := &store.GraphCall{ID: uuid.New().String(), OwnerID: owner.ID, MemoID: memo.ID, Revision: 1, Stage: "embedding", Account: account, Day: day, Reserved: 300_000, StartedTs: time.Now().UnixMilli()}
			ok, e := s.BeginGraphCall(ctx, c, 900_000)
			require.NoError(t, e)
			if ok {
				mu.Lock()
				entries = append(entries, c)
				mu.Unlock()
			}
		})
	}
	wg.Wait()
	require.Len(t, entries, 3)
	used, err := s.ReadGraphBudget(ctx, account, day)
	require.NoError(t, err)
	require.EqualValues(t, 900_000, used)
	entry := *entries[0]
	entry.Charged = 107_500
	entry.UsageKind = "known"
	entry.InputTokens = 100
	entry.Outcome = "failed"
	entry.ErrorCode = "embedding-count"
	entry.FinishedTs = time.Now().UnixMilli()
	for range 8 {
		wg.Go(func() { require.NoError(t, s.SettleGraphCall(ctx, &entry)) })
	}
	wg.Wait()
	used, err = s.ReadGraphBudget(ctx, account, day)
	require.NoError(t, err)
	require.EqualValues(t, 707_500, used)
	today, err := s.ReadGraphBudget(ctx, account, "2026-10-28")
	require.NoError(t, err)
	require.Zero(t, today, "settlement stays on the reservation day")
	u, err := s.ReadGraphUsage(ctx, account, day, time.Now().Unix())
	require.NoError(t, err)
	require.EqualValues(t, 107_500, u.Known)
	require.EqualValues(t, 600_000, u.InFlight)
	u, err = s.ReadGraphUsage(ctx, account, day, time.Now().Add(16*time.Minute).Unix())
	require.NoError(t, err)
	require.Zero(t, u.InFlight)
	require.EqualValues(t, 600_000, u.Unknown, "lost responses remain reserved")
	entry = *entries[1]
	entry.Charged = 1_000_000
	entry.UsageKind = "known"
	entry.Outcome = "succeeded"
	require.NoError(t, s.SettleGraphCall(ctx, &entry))
	used, err = s.ReadGraphBudget(ctx, account, day)
	require.NoError(t, err)
	require.EqualValues(t, 1_407_500, used, "actual overage is visible, never clipped to the reservation")
	entry.ID = uuid.New().String()
	ok, err := s.BeginGraphCall(ctx, &entry, 900_000)
	require.NoError(t, err)
	require.False(t, ok)
	require.NoError(t, s.DeleteMemo(ctx, &store.DeleteMemo{ID: memo.ID}))
	history, err := s.ListGraphCalls(ctx, owner.ID, memo.ID, store.GraphCallCursor{}, 20)
	require.NoError(t, err)
	require.Empty(t, history)
}

func TestGraphRecoveryMigrationPreservesBudgetAndOnlyRecoversLegacyFailuresOnce(t *testing.T) {
	ctx := context.Background()
	s := NewTestingStore(ctx, t)
	t.Cleanup(func() { require.NoError(t, s.Close()) })
	owner, err := createTestingHostUser(ctx, s)
	require.NoError(t, err)
	memo, err := s.CreateMemo(ctx, &store.Memo{UID: "legacy-recovery", CreatorID: owner.ID, Content: "original must survive", Visibility: store.Private})
	require.NoError(t, err)
	db := s.GetDriver().GetDB()
	driver := getDriverFromEnv()
	ddl, err := os.ReadFile("../migration/" + driver + "/26.10/02__record_graph_recovery.sql")
	require.NoError(t, err)
	for _, m := range regexp.MustCompile(`CREATE TRIGGER (\w+) AFTER (?:INSERT|UPDATE|DELETE) ON ([^ ]+)`).FindAllStringSubmatch(string(ddl), -1) {
		q := "DROP TRIGGER " + m[1]
		if driver == "postgres" {
			q += " ON " + m[2]
		}
		_, err = db.ExecContext(ctx, q)
		require.NoError(t, err)
	}
	if driver == "postgres" {
		for _, m := range regexp.MustCompile(`CREATE FUNCTION (\w+)\(\)`).FindAllStringSubmatch(string(ddl), -1) {
			_, err = db.ExecContext(ctx, "DROP FUNCTION "+m[1]+"()")
			require.NoError(t, err)
		}
	}
	for _, table := range []string{"record_graph_call", "record_graph_runtime", "record_graph_retry"} {
		_, err = db.ExecContext(ctx, "DROP TABLE "+table)
		require.NoError(t, err)
	}
	for _, column := range []string{"stage", "failure_stage", "last_attempt_ts", "status_version"} {
		_, err = db.ExecContext(ctx, "ALTER TABLE record_graph_source DROP COLUMN "+column)
		require.NoError(t, err)
	}
	_, err = db.ExecContext(ctx, "UPDATE record_graph_source SET state='failed',error_code='invalid-result',attempts=9,next_attempt_ts=253402300799,representation='{\"chunks\":[]}'")
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, "INSERT INTO record_graph_budget(account_key,budget_day,reserved) VALUES('"+strings.Repeat("a", 64)+"','2026-10-28',7992)")
	require.NoError(t, err)
	setSchemaVersion(ctx, t, s, "26.10.2")
	require.NoError(t, s.Migrate(ctx))
	row := graphSource(t, s, owner.ID, memo.ID)
	require.Equal(t, "retrying", row.State)
	require.Equal(t, "legacy-unknown", row.ErrorCode)
	require.Zero(t, row.LastAttemptTs)
	require.Zero(t, row.Attempts)
	require.JSONEq(t, `{"chunks":[]}`, string(row.Representation))
	budget, err := s.ReadGraphBudget(ctx, strings.Repeat("a", 64), "2026-10-28")
	require.NoError(t, err)
	require.EqualValues(t, 7_992_000_000, budget, "migration converts units; it never clears the ledger")
	_, err = db.ExecContext(ctx, "UPDATE record_graph_source SET state='failed',error_code='result-schema',attempts=3,next_attempt_ts=253402300799")
	require.NoError(t, err)
	require.NoError(t, s.Migrate(ctx))
	require.Equal(t, "failed", graphSource(t, s, owner.ID, memo.ID).State)
	current, err := s.GetMemo(ctx, &store.FindMemo{ID: &memo.ID})
	require.NoError(t, err)
	require.Equal(t, memo.Content, current.Content)
}
