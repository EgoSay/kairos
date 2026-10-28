package graphsql

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/pkg/errors"

	"github.com/EgoSay/kairos/store"
)

// Checkpoint persists validated intermediate data without making it readable as a result.
func (r Repository) Checkpoint(ctx context.Context, s *store.GraphSource) error {
	res, err := r.DB.ExecContext(ctx, r.bind(`UPDATE record_graph_source SET representation=?,profile=?,stage=?,failure_stage=?,attempts=?,last_attempt_ts=?,updated_ts=?,status_version=status_version+1,lease_until=? WHERE owner_id=? AND memo_id=? AND revision=? AND lease_token=? AND lease_until>?`), string(s.Representation), s.Profile, s.Stage, s.FailureStage, s.Attempts, s.LastAttemptTs, s.UpdatedTs, s.LeaseUntil, s.OwnerID, s.MemoID, s.Revision, s.LeaseToken, s.UpdatedTs)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err == nil && n != 1 {
		return store.ErrGraphConflict
	}
	return err
}

func workGroup() string {
	return `CASE WHEN dirty=0 AND state='ready' AND processed_revision=revision AND profile=? THEN 'ready'
 WHEN dirty=1 AND state='quota-paused' AND next_attempt_ts>? THEN 'quota'
 WHEN dirty=1 AND state='failed' AND next_attempt_ts>? THEN 'attention'
 ELSE 'preparing' END`
}

// Progress applies the jobs list's eligibility predicate and a mutually exclusive partition.
func (r Repository) Progress(ctx context.Context, f *store.FindGraphSource) (store.GraphProgress, error) {
	var result store.GraphProgress
	where, args := sourceWhere(f)
	q := "SELECT work_state,COUNT(*) FROM (SELECT CASE WHEN " + where + " THEN (" + workGroup() + ") ELSE 'excluded' END AS work_state FROM record_graph_source WHERE owner_id=?) work GROUP BY work_state"
	args = append(args, f.CurrentProfile, f.Now, f.Now, f.OwnerID)
	rows, err := r.DB.QueryContext(ctx, r.bind(q), args...)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var state string
		var count int
		if err = rows.Scan(&state, &count); err != nil {
			return result, err
		}
		switch state {
		case "ready":
			result.Ready = count
		case "quota":
			result.Quota = count
		case "attention":
			result.Attention = count
		case "excluded":
			result.Excluded = count
		default:
			result.Preparing = count
		}
	}
	result.Total = result.Ready + result.Preparing + result.Quota + result.Attention
	return result, rows.Err()
}

// RetryReceipt reads the original result without running the retry again.
func (r Repository) RetryReceipt(ctx context.Context, owner int32, id string) (*store.GraphRetry, error) {
	var payload string
	err := r.DB.QueryRowContext(ctx, r.bind("SELECT payload FROM record_graph_retry WHERE owner_id=? AND request_id=?"), owner, id).Scan(&payload)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return parseRetryPayload([]byte(payload))
}

// Retry compares eligibility and captured revisions under the publication epoch lock.
func (r Repository) Retry(ctx context.Context, v *store.GraphRetry) (*store.GraphRetry, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, r.bind("UPDATE record_graph_owner SET epoch=epoch WHERE owner_id=?"), v.OwnerID); err != nil {
		return nil, err
	}
	var payload string
	err = tx.QueryRowContext(ctx, r.bind("SELECT payload FROM record_graph_retry WHERE owner_id=? AND request_id=?"), v.OwnerID, v.ID).Scan(&payload)
	if err == nil {
		receipt, e := parseRetryPayload([]byte(payload))
		if e != nil {
			return nil, e
		}
		if receipt.InputHash != v.InputHash {
			return nil, store.ErrGraphConflict
		}
		return receipt, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	var epoch int64
	err = tx.QueryRowContext(ctx, r.bind("SELECT epoch FROM record_graph_owner WHERE owner_id=?"), v.OwnerID).Scan(&epoch)
	if errors.Is(err, sql.ErrNoRows) && len(v.Targets) == 0 {
		epoch = v.Epoch
	} else if err != nil {
		return nil, err
	}
	if epoch != v.Epoch {
		return nil, store.ErrGraphConflict
	}
	for _, target := range v.Targets {
		res, e := tx.ExecContext(ctx, r.bind(`UPDATE record_graph_source SET state='pending',error_code='',attempts=0,failure_stage='',next_attempt_ts=0,status_version=status_version+1,updated_ts=? WHERE owner_id=? AND memo_id=? AND revision=? AND status_version=? AND dirty=1 AND lease_until<=? AND state IN ('failed','retrying') AND error_code<>'configuration'`), v.Now, v.OwnerID, target.MemoID, target.Revision, target.StatusVersion, v.Now)
		if e != nil {
			return nil, e
		}
		n, e := res.RowsAffected()
		if e != nil {
			return nil, e
		}
		if n == 1 {
			v.Accepted++
		} else {
			v.Skipped++
		}
	}
	if _, err = tx.ExecContext(ctx, r.bind("INSERT INTO record_graph_retry(owner_id,request_id,payload,created_ts) VALUES(?,?,?,?)"), v.OwnerID, v.ID, string(retryPayload(v)), v.Now); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return v, nil
}

// retryPayload includes the fingerprint used to reject reuse with a different request.
func retryPayload(r *store.GraphRetry) []byte {
	b, _ := json.Marshal(struct {
		Receipt   *store.GraphRetry `json:"receipt"`
		InputHash string            `json:"inputHash"`
	}{r, r.InputHash})
	return b
}

// parseRetryPayload restores a stored receipt without record content.
func parseRetryPayload(b []byte) (*store.GraphRetry, error) {
	var value struct {
		Receipt   *store.GraphRetry `json:"receipt"`
		InputHash string            `json:"inputHash"`
	}
	if err := json.Unmarshal(b, &value); err != nil {
		return nil, err
	}
	if value.Receipt == nil {
		return nil, errors.New("invalid retry receipt")
	}
	value.Receipt.InputHash = value.InputHash
	return value.Receipt, nil
}
