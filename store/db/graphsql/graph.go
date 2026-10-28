// Package graphsql implements portable persistence for versioned record associations.
package graphsql

import (
	"context"
	"database/sql"
	"strconv"
	"strings"

	"github.com/pkg/errors"

	"github.com/EgoSay/kairos/store"
)

// Repository uses a driver's database and placeholder syntax.
type Repository struct {
	DB       *sql.DB
	Postgres bool
	MySQL    bool
}

func (r Repository) bind(q string) string {
	if !r.Postgres {
		return q
	}
	parts := strings.Split(q, "?")
	var result strings.Builder
	for i, part := range parts {
		if i > 0 {
			result.WriteString("$" + strconv.Itoa(i))
		}
		result.WriteString(part)
	}
	return result.String()
}

// List returns bounded source rows; representations are optional on reading paths.
func (r Repository) List(ctx context.Context, f *store.FindGraphSource) ([]*store.GraphSource, error) {
	representation := "representation"
	if f.ExcludeRepresentation {
		representation = "'{}'"
	}
	q := "SELECT memo_id,owner_id,revision,processed_revision,profile," + representation + ",dirty,lease_until,lease_token,attempts,next_attempt_ts,state,error_code,updated_ts,stage,failure_stage,last_attempt_ts,status_version FROM record_graph_source WHERE "
	where, args := sourceWhere(f)
	q += where
	if f.WorkState != "" {
		q += " AND (" + workGroup() + ")=?"
		args = append(args, f.CurrentProfile, f.Now, f.Now, f.WorkState)
	}
	if f.ConnectedOnly {
		q += ` AND (EXISTS(SELECT 1 FROM record_graph_edge e WHERE e.owner_id=record_graph_source.owner_id AND e.profile=record_graph_source.profile AND e.a=record_graph_source.memo_id) OR EXISTS(SELECT 1 FROM record_graph_edge e WHERE e.owner_id=record_graph_source.owner_id AND e.profile=record_graph_source.profile AND e.b=record_graph_source.memo_id) OR EXISTS(SELECT 1 FROM memo_relation mr WHERE mr.type='REFERENCE' AND (mr.memo_id=record_graph_source.memo_id OR mr.related_memo_id=record_graph_source.memo_id)))`
	}
	if len(f.MemoIDs) > 0 {
		q += " AND memo_id IN (" + strings.TrimSuffix(strings.Repeat("?,", len(f.MemoIDs)), ",") + ")"
		for _, id := range f.MemoIDs {
			args = append(args, id)
		}
	}
	if f.AfterID > 0 {
		q += " AND memo_id>?"
		args = append(args, f.AfterID)
	}
	if f.Profile != "" {
		q += " AND profile=?"
		args = append(args, f.Profile)
	}
	if f.DueTs > 0 {
		q += " AND dirty=1 AND next_attempt_ts<=? AND lease_until<=?"
		args = append(args, f.DueTs, f.DueTs)
	}
	q += " ORDER BY memo_id LIMIT ? OFFSET ?"
	args = append(args, f.Limit, f.Offset)
	rows, err := r.DB.QueryContext(ctx, r.bind(q), args...)
	if err != nil {
		return nil, errors.Wrap(err, "list graph sources")
	}
	defer rows.Close()
	result := []*store.GraphSource{}
	for rows.Next() {
		s := &store.GraphSource{}
		var data string
		var dirty int
		if err := rows.Scan(&s.MemoID, &s.OwnerID, &s.Revision, &s.ProcessedRevision, &s.Profile, &data, &dirty, &s.LeaseUntil, &s.LeaseToken, &s.Attempts, &s.NextAttemptTs, &s.State, &s.ErrorCode, &s.UpdatedTs, &s.Stage, &s.FailureStage, &s.LastAttemptTs, &s.StatusVersion); err != nil {
			return nil, err
		}
		s.Dirty = dirty != 0
		s.Representation = []byte(data)
		result = append(result, s)
	}
	return result, rows.Err()
}

// Claim acquires one current revision with a unique token and finite lease.
func (r Repository) Claim(ctx context.Context, s *store.GraphSource, now int64) (bool, error) {
	res, err := r.DB.ExecContext(ctx, r.bind("UPDATE record_graph_source SET lease_until=?,lease_token=?,state='processing',status_version=status_version+1,updated_ts=? WHERE memo_id=? AND owner_id=? AND revision=? AND dirty=1 AND lease_until<=? AND next_attempt_ts<=?"), s.LeaseUntil, s.LeaseToken, now, s.MemoID, s.OwnerID, s.Revision, now, now)
	if err != nil {
		return false, errors.Wrap(err, "claim graph work")
	}
	n, err := res.RowsAffected()
	if n == 1 {
		s.StatusVersion++
		s.State = "processing"
		s.UpdatedTs = now
	}
	return n == 1, err
}

// Publish locks the eligibility epoch before checking every source and committing edges.
func (r Repository) Publish(ctx context.Context, p *store.GraphPublication) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	s := p.Source
	// A write first also obtains SQLite's write lock without a deferred read upgrade.
	if _, err = tx.ExecContext(ctx, r.bind("UPDATE record_graph_owner SET epoch=epoch WHERE owner_id=?"), s.OwnerID); err != nil {
		return err
	}
	var epoch int64
	if err = tx.QueryRowContext(ctx, r.bind("SELECT epoch FROM record_graph_owner WHERE owner_id=?"), s.OwnerID).Scan(&epoch); err != nil {
		return err
	}
	if epoch != p.ExpectedEpoch {
		return store.ErrGraphConflict
	}
	res, err := tx.ExecContext(ctx, r.bind("UPDATE record_graph_source SET processed_revision=revision,profile=?,representation=?,dirty=0,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0,state=?,error_code='',stage='complete',failure_stage='',status_version=status_version+1,updated_ts=? WHERE memo_id=? AND owner_id=? AND revision=? AND lease_token=? AND lease_until>?"), s.Profile, string(s.Representation), s.State, p.Now, s.MemoID, s.OwnerID, s.Revision, s.LeaseToken, p.Now)
	if err != nil {
		return errors.Wrap(err, "publish graph source")
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return store.ErrGraphConflict
	}
	if _, err = tx.ExecContext(ctx, r.bind("DELETE FROM record_graph_edge WHERE owner_id=? AND (a=? OR b=?)"), s.OwnerID, s.MemoID, s.MemoID); err != nil {
		return err
	}
	for _, edge := range p.Edges {
		var count int
		if err = tx.QueryRowContext(ctx, r.bind("SELECT COUNT(*) FROM record_graph_source WHERE owner_id=? AND ((memo_id=? AND revision=?) OR (memo_id=? AND revision=?))"), edge.OwnerID, edge.A, edge.RevisionA, edge.B, edge.RevisionB).Scan(&count); err != nil {
			return err
		}
		if count != 2 {
			return store.ErrGraphConflict
		}
		if _, err = tx.ExecContext(ctx, r.bind("INSERT INTO record_graph_edge(owner_id,a,b,revision_a,revision_b,profile,payload) VALUES(?,?,?,?,?,?,?)"), edge.OwnerID, edge.A, edge.B, edge.RevisionA, edge.RevisionB, edge.Profile, string(edge.Payload)); err != nil {
			return errors.Wrap(err, "publish graph connection")
		}
	}
	return tx.Commit()
}

// Defer releases only the caller's current lease, retaining dirty work across restarts.
func (r Repository) Defer(ctx context.Context, s *store.GraphSource) error {
	res, err := r.DB.ExecContext(ctx, r.bind("UPDATE record_graph_source SET lease_until=0,lease_token='',next_attempt_ts=?,state=?,error_code=?,profile=?,representation=?,attempts=?,stage=?,failure_stage=?,last_attempt_ts=?,updated_ts=?,status_version=status_version+1 WHERE owner_id=? AND memo_id=? AND revision=? AND lease_token=?"), s.NextAttemptTs, s.State, s.ErrorCode, s.Profile, string(s.Representation), s.Attempts, s.Stage, s.FailureStage, s.LastAttemptTs, s.UpdatedTs, s.OwnerID, s.MemoID, s.Revision, s.LeaseToken)
	if err != nil {
		return errors.Wrap(err, "defer graph work")
	}
	n, err := res.RowsAffected()
	if err == nil && n != 1 {
		return store.ErrGraphConflict
	}
	return err
}

// Edges uses adjacency indexes and requires both current source versions to be ready.
func (r Repository) Edges(ctx context.Context, owner, memoID int32, profile string, limit int) ([]*store.GraphEdge, error) {
	q := `SELECT e.owner_id,e.a,e.b,e.revision_a,e.revision_b,e.profile,e.payload FROM record_graph_edge e
	JOIN record_graph_source a ON a.memo_id=e.a AND a.owner_id=e.owner_id AND a.revision=e.revision_a AND a.processed_revision=a.revision AND a.profile=e.profile
	JOIN record_graph_source b ON b.memo_id=e.b AND b.owner_id=e.owner_id AND b.revision=e.revision_b AND b.processed_revision=b.revision AND b.profile=e.profile
	WHERE e.owner_id=? AND e.profile=? AND `
	q = q + "e.a=? UNION ALL " + q + "e.b=? ORDER BY a,b LIMIT ?"
	rows, err := r.DB.QueryContext(ctx, r.bind(q), owner, profile, memoID, owner, profile, memoID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []*store.GraphEdge{}
	for rows.Next() {
		e := &store.GraphEdge{}
		var payload string
		if err := rows.Scan(&e.OwnerID, &e.A, &e.B, &e.RevisionA, &e.RevisionB, &e.Profile, &payload); err != nil {
			return nil, err
		}
		e.Payload = []byte(payload)
		result = append(result, e)
	}
	return result, rows.Err()
}

// Epoch returns zero only when an owner has no recorded changes yet.
func (r Repository) Epoch(ctx context.Context, owner int32) (int64, error) {
	var epoch int64
	err := r.DB.QueryRowContext(ctx, r.bind("SELECT epoch FROM record_graph_owner WHERE owner_id=?"), owner).Scan(&epoch)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return epoch, err
}

// Counts aggregates indexed work state without retrieving source text or vectors.
func (r Repository) Counts(ctx context.Context, owner int32, profile string) (store.GraphCounts, error) {
	var c store.GraphCounts
	err := r.DB.QueryRowContext(ctx, r.bind(`SELECT COUNT(*),COALESCE(SUM(CASE WHEN profile=? AND processed_revision=revision AND state='ready' AND dirty=0 THEN 1 ELSE 0 END),0),COALESCE(SUM(CASE WHEN dirty=1 THEN 1 ELSE 0 END),0),COALESCE(SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END),0),COALESCE(MAX(memo_id),0) FROM record_graph_source WHERE owner_id=?`), profile, owner).Scan(&c.Total, &c.Ready, &c.Pending, &c.Failed, &c.MaxID)
	return c, err
}

// Reserve increments a single account/day row conditionally, including concurrent owners.
func (r Repository) Reserve(ctx context.Context, account, day string, amount, limit int64) (bool, error) {
	var exists int
	err := r.DB.QueryRowContext(ctx, r.bind("SELECT 1 FROM record_graph_budget WHERE account_key=? AND budget_day=?"), account, day).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		_, err = r.DB.ExecContext(ctx, r.bind("INSERT INTO record_graph_budget(account_key,budget_day,reserved) VALUES(?,?,0)"), account, day)
		if err != nil {
			if readErr := r.DB.QueryRowContext(ctx, r.bind("SELECT 1 FROM record_graph_budget WHERE account_key=? AND budget_day=?"), account, day).Scan(&exists); readErr != nil {
				return false, err
			}
		}
	} else if err != nil {
		return false, err
	}
	res, err := r.DB.ExecContext(ctx, r.bind("UPDATE record_graph_budget SET reserved=reserved+? WHERE account_key=? AND budget_day=? AND reserved+?<=?"), amount, account, day, amount, limit)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n == 1, err
}

// Refund retains reservations on lost responses, so crash recovery cannot silently overspend.
func (r Repository) Refund(ctx context.Context, account, day string, amount int64) error {
	_, err := r.DB.ExecContext(ctx, r.bind("UPDATE record_graph_budget SET reserved=reserved-? WHERE account_key=? AND budget_day=? AND reserved>=?"), amount, account, day, amount)
	return err
}

// Budget reads one account/day counter without revealing credentials.
func (r Repository) Budget(ctx context.Context, account, day string) (int64, error) {
	var spent int64
	err := r.DB.QueryRowContext(ctx, r.bind("SELECT reserved FROM record_graph_budget WHERE account_key=? AND budget_day=?"), account, day).Scan(&spent)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return spent, err
}

func sourceWhere(f *store.FindGraphSource) (string, []any) {
	q := "owner_id=?"
	args := []any{f.OwnerID}
	if f.ReadableOnly {
		q += ` AND EXISTS (SELECT 1 FROM memo m WHERE m.id=record_graph_source.memo_id AND m.creator_id=record_graph_source.owner_id AND m.row_status='NORMAL'
		AND NOT EXISTS (SELECT 1 FROM memo_relation mr WHERE mr.memo_id=m.id AND mr.type='COMMENT')
		AND NOT EXISTS (SELECT 1 FROM journal_document j WHERE j.owner_id=m.creator_id AND j.kind='trash' AND j.document_key=m.uid)
		AND (m.visibility<>'SPACE' OR EXISTS (SELECT 1 FROM space_member sm WHERE sm.space_id=m.space_id AND sm.user_id=m.creator_id AND sm.status='ACTIVE'))`
		if len(f.ExcludedUIDs) > 0 {
			q += " AND m.uid NOT IN (" + strings.TrimSuffix(strings.Repeat("?,", len(f.ExcludedUIDs)), ",") + ")"
			for _, uid := range f.ExcludedUIDs {
				args = append(args, uid)
			}
		}
		q += ")"
	}
	return q, args
}
