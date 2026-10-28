package graphsql

import (
	"context"
	"database/sql"

	"github.com/pkg/errors"

	"github.com/EgoSay/kairos/store"
)

// BeginCall commits the reservation and request identity together, before network I/O.
func (r Repository) BeginCall(ctx context.Context, c *store.GraphCall, limit int64) (bool, error) {
	if _, err := r.Reserve(ctx, c.Account, c.Day, 0, limit); err != nil {
		return false, err
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, r.bind("UPDATE record_graph_budget SET reserved=reserved WHERE account_key=? AND budget_day=?"), c.Account, c.Day); err != nil {
		return false, err
	}
	var existing string
	err = tx.QueryRowContext(ctx, r.bind("SELECT id FROM record_graph_call WHERE id=?"), c.ID).Scan(&existing)
	if err == nil {
		return false, store.ErrGraphConflict
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return false, err
	}
	res, err := tx.ExecContext(ctx, r.bind("UPDATE record_graph_budget SET reserved=reserved+? WHERE account_key=? AND budget_day=? AND reserved+?<=?"), c.Reserved, c.Account, c.Day, c.Reserved, limit)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if err != nil || n != 1 {
		return false, err
	}
	_, err = tx.ExecContext(ctx, r.bind(`INSERT INTO record_graph_call(id,owner_id,memo_id,revision,stage,account_key,budget_day,reserved_units,charged_units,started_ts) VALUES(?,?,?,?,?,?,?,?,?,?)`), c.ID, c.OwnerID, c.MemoID, c.Revision, c.Stage, c.Account, c.Day, c.Reserved, c.Reserved, c.StartedTs)
	if err != nil {
		return false, err
	}
	return true, tx.Commit()
}

// SettleCall applies the final delta to the reservation's original UTC day exactly once.
func (r Repository) SettleCall(ctx context.Context, c *store.GraphCall) error {
	var account, day string
	var reserved int64
	err := r.DB.QueryRowContext(ctx, r.bind("SELECT account_key,budget_day,reserved_units FROM record_graph_call WHERE id=? AND owner_id=?"), c.ID, c.OwnerID).Scan(&account, &day, &reserved)
	if err != nil {
		return err
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Keep lock ordering identical to BeginCall, including when several owners share an account.
	if _, err = tx.ExecContext(ctx, r.bind("UPDATE record_graph_budget SET reserved=reserved WHERE account_key=? AND budget_day=?"), account, day); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, r.bind(`UPDATE record_graph_call SET charged_units=?,usage_kind=?,input_tokens=?,output_tokens=?,outcome=?,error_code=?,http_status=?,provider_code=?,request_id=?,finished_ts=? WHERE id=? AND owner_id=? AND outcome='pending'`), c.Charged, c.UsageKind, c.InputTokens, c.OutputTokens, c.Outcome, c.ErrorCode, c.HTTPStatus, c.ProviderCode, c.RequestID, c.FinishedTs, c.ID, c.OwnerID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return nil
	}
	// An unexpectedly larger actual charge must remain visible and stop future calls.
	if _, err = tx.ExecContext(ctx, r.bind("UPDATE record_graph_budget SET reserved=reserved+? WHERE account_key=? AND budget_day=?"), c.Charged-reserved, account, day); err != nil {
		return err
	}
	return tx.Commit()
}

// Usage separates active reservations from lost responses without fabricating token usage.
func (r Repository) Usage(ctx context.Context, account, day string, now int64) (store.GraphUsage, error) {
	var u store.GraphUsage
	err := r.DB.QueryRowContext(ctx, r.bind(`SELECT b.reserved,
 COALESCE(SUM(CASE WHEN c.usage_kind='known' THEN c.charged_units ELSE 0 END),0),
 COALESCE(SUM(CASE WHEN c.usage_kind='estimated' THEN c.charged_units ELSE 0 END),0),
 COALESCE(SUM(CASE WHEN c.outcome='pending' AND c.started_ts>? THEN c.charged_units ELSE 0 END),0)
 FROM record_graph_budget b LEFT JOIN record_graph_call c ON c.account_key=b.account_key AND c.budget_day=b.budget_day
 WHERE b.account_key=? AND b.budget_day=? GROUP BY b.reserved`), (now-15*60)*1000, account, day).Scan(&u.Total, &u.Known, &u.Estimated, &u.InFlight)
	if errors.Is(err, sql.ErrNoRows) {
		return u, nil
	}
	u.Unknown = max(0, u.Total-u.Known-u.Estimated-u.InFlight)
	return u, err
}

// Calls returns safe attempt metadata, with millisecond cursors and no original content.
func (r Repository) Calls(ctx context.Context, owner, memo int32, before store.GraphCallCursor, limit int) ([]*store.GraphCall, error) {
	q := `SELECT id,revision,stage,budget_day,reserved_units,charged_units,usage_kind,input_tokens,output_tokens,outcome,error_code,http_status,provider_code,request_id,started_ts,finished_ts FROM record_graph_call WHERE owner_id=? AND memo_id=?`
	args := []any{owner, memo}
	if before.Time > 0 {
		q += " AND (started_ts<? OR (started_ts=? AND id<?))"
		args = append(args, before.Time, before.Time, before.ID)
	}
	q += " ORDER BY started_ts DESC,id DESC LIMIT ?"
	args = append(args, limit)
	rows, err := r.DB.QueryContext(ctx, r.bind(q), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []*store.GraphCall{}
	for rows.Next() {
		c := &store.GraphCall{OwnerID: owner, MemoID: memo}
		if err = rows.Scan(&c.ID, &c.Revision, &c.Stage, &c.Day, &c.Reserved, &c.Charged, &c.UsageKind, &c.InputTokens, &c.OutputTokens, &c.Outcome, &c.ErrorCode, &c.HTTPStatus, &c.ProviderCode, &c.RequestID, &c.StartedTs, &c.FinishedTs); err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

// Runtime reads the persisted circuit for a credential fingerprint.
func (r Repository) Runtime(ctx context.Context, key string) (store.GraphRuntime, error) {
	v := store.GraphRuntime{Key: key}
	err := r.DB.QueryRowContext(ctx, r.bind("SELECT failures,trips,blocked_until,error_code FROM record_graph_runtime WHERE connection_key=?"), key).Scan(&v.Failures, &v.Trips, &v.Until, &v.Code)
	if errors.Is(err, sql.ErrNoRows) {
		return v, nil
	}
	return v, err
}

// SaveRuntime replaces only safe circuit metadata, never the endpoint or token.
func (r Repository) SaveRuntime(ctx context.Context, v store.GraphRuntime) error {
	q := "INSERT INTO record_graph_runtime(connection_key,failures,trips,blocked_until,error_code) VALUES(?,?,?,?,?) ON CONFLICT(connection_key) DO UPDATE SET failures=excluded.failures,trips=excluded.trips,blocked_until=excluded.blocked_until,error_code=excluded.error_code"
	if r.MySQL {
		q = "INSERT INTO record_graph_runtime(connection_key,failures,trips,blocked_until,error_code) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE failures=VALUES(failures),trips=VALUES(trips),blocked_until=VALUES(blocked_until),error_code=VALUES(error_code)"
	}
	_, err := r.DB.ExecContext(ctx, r.bind(q), v.Key, v.Failures, v.Trips, v.Until, v.Code)
	return err
}

// Probe takes a short lease after a connection circuit expires; completion resets or reopens it.
func (r Repository) Probe(ctx context.Context, key string, now int64) (bool, error) {
	res, err := r.DB.ExecContext(ctx, r.bind("UPDATE record_graph_runtime SET blocked_until=? WHERE connection_key=? AND failures>=3 AND blocked_until<=?"), now+120, key, now)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n == 1, err
}
