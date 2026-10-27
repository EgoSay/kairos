package mysql

import (
	"context"

	"github.com/EgoSay/kairos/store"
	"github.com/EgoSay/kairos/store/db/graphsql"
)

func (d *DB) graphRepository() graphsql.Repository {
	return graphsql.Repository{DB: d.db, Postgres: false}
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
