package mysql

import (
	"context"

	"github.com/EgoSay/kairos/store"
	"github.com/EgoSay/kairos/store/db/graphsql"
)

func (d *DB) graphRepository() graphsql.Repository {
	return graphsql.Repository{DB: d.db, Postgres: false, MySQL: true}
}
func (d *DB) ListGraphSources(ctx context.Context, f *store.FindGraphSource) ([]*store.GraphSource, error) {
	return d.graphRepository().List(ctx, f)
}
func (d *DB) ClaimGraphSource(ctx context.Context, s *store.GraphSource, now int64) (bool, error) {
	return d.graphRepository().Claim(ctx, s, now)
}
func (d *DB) PublishGraphSource(ctx context.Context, p *store.GraphPublication) error {
	return d.graphRepository().Publish(ctx, p)
}
func (d *DB) DeferGraphSource(ctx context.Context, s *store.GraphSource) error {
	return d.graphRepository().Defer(ctx, s)
}
func (d *DB) ListGraphEdges(ctx context.Context, owner, id int32, profile string, limit int) ([]*store.GraphEdge, error) {
	return d.graphRepository().Edges(ctx, owner, id, profile, limit)
}
func (d *DB) GraphEpoch(ctx context.Context, owner int32) (int64, error) {
	return d.graphRepository().Epoch(ctx, owner)
}
func (d *DB) CountGraphSources(ctx context.Context, owner int32, profile string) (store.GraphCounts, error) {
	return d.graphRepository().Counts(ctx, owner, profile)
}

func (d *DB) ReserveGraphBudget(ctx context.Context, a, day string, n, limit int64) (bool, error) {
	return d.graphRepository().Reserve(ctx, a, day, n, limit)
}
func (d *DB) RefundGraphBudget(ctx context.Context, a, day string, n int64) error {
	return d.graphRepository().Refund(ctx, a, day, n)
}
func (d *DB) ReadGraphBudget(ctx context.Context, a, day string) (int64, error) {
	return d.graphRepository().Budget(ctx, a, day)
}

func (d *DB) SaveGraphProgress(ctx context.Context, s *store.GraphSource) error {
	return d.graphRepository().Checkpoint(ctx, s)
}
func (d *DB) BeginGraphCall(ctx context.Context, c *store.GraphCall, limit int64) (bool, error) {
	return d.graphRepository().BeginCall(ctx, c, limit)
}
func (d *DB) SettleGraphCall(ctx context.Context, c *store.GraphCall) error {
	return d.graphRepository().SettleCall(ctx, c)
}
func (d *DB) ReadGraphUsage(ctx context.Context, a, day string, now int64) (store.GraphUsage, error) {
	return d.graphRepository().Usage(ctx, a, day, now)
}
func (d *DB) ListGraphCalls(ctx context.Context, owner, memo int32, before store.GraphCallCursor, limit int) ([]*store.GraphCall, error) {
	return d.graphRepository().Calls(ctx, owner, memo, before, limit)
}
func (d *DB) CountGraphProgress(ctx context.Context, f *store.FindGraphSource) (store.GraphProgress, error) {
	return d.graphRepository().Progress(ctx, f)
}
func (d *DB) GetGraphRuntime(ctx context.Context, key string) (store.GraphRuntime, error) {
	return d.graphRepository().Runtime(ctx, key)
}
func (d *DB) PutGraphRuntime(ctx context.Context, v store.GraphRuntime) error {
	return d.graphRepository().SaveRuntime(ctx, v)
}
func (d *DB) GetGraphRetry(ctx context.Context, owner int32, id string) (*store.GraphRetry, error) {
	return d.graphRepository().RetryReceipt(ctx, owner, id)
}
func (d *DB) RetryGraphSources(ctx context.Context, v *store.GraphRetry) (*store.GraphRetry, error) {
	return d.graphRepository().Retry(ctx, v)
}

func (d *DB) ClaimGraphProbe(ctx context.Context, key string, now int64) (bool, error) {
	return d.graphRepository().Probe(ctx, key, now)
}
