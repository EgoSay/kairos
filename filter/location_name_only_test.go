package filter

import (
	"context"
	"database/sql"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLocationNameOnlyRendersWithLegacyFalseForEveryDialect(t *testing.T) {
	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)
	predicates := map[DialectName]string{
		DialectSQLite:   "JSON_EXTRACT(`memo`.`payload`, '$.location.nameOnly') IS TRUE",
		DialectMySQL:    "COALESCE(JSON_EXTRACT(`memo`.`payload`, '$.location.nameOnly'), CAST('false' AS JSON)) = CAST('true' AS JSON)",
		DialectPostgres: "(memo.payload->'location'->>'nameOnly')::boolean IS TRUE",
	}
	for dialect, predicate := range predicates {
		stmt, err := engine.CompileToStatement(context.Background(), `!location_name_only`, RenderOptions{Dialect: dialect})
		require.NoError(t, err)
		require.Equal(t, "NOT ("+predicate+")", stmt.SQL)
	}
}

func TestMapScopeExcludesNameOnlyAndKeepsLegacyOrigin(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	require.NoError(t, err)
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err = db.Exec(`CREATE TABLE memo (id INTEGER PRIMARY KEY, payload TEXT)`)
	require.NoError(t, err)
	for index, payload := range []any{
		`{}`, `{"location":{"placeholder":"家","nameOnly":true}}`, `{"location":{}}`,
		`{"location":{"placeholder":"park","latitude":31,"longitude":121}}`, `{"location":null}`, nil,
	} {
		_, err = db.Exec(`INSERT INTO memo (id, payload) VALUES (?, ?)`, index+1, payload)
		require.NoError(t, err)
	}
	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)
	stmt, err := engine.CompileToStatement(context.Background(), `has_location && !location_name_only`, RenderOptions{Dialect: DialectSQLite})
	require.NoError(t, err)
	require.Equal(t, []int{3, 4}, selectMemoIDs(t, db, stmt))
	stmt, err = engine.CompileToStatement(context.Background(), `has_location`, RenderOptions{Dialect: DialectSQLite})
	require.NoError(t, err)
	require.Equal(t, []int{2, 3, 4}, selectMemoIDs(t, db, stmt))
}
