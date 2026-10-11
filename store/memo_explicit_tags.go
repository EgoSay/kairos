package store

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/pkg/errors"
	"google.golang.org/protobuf/proto"

	"github.com/EgoSay/kairos/markdown"
	storepb "github.com/EgoSay/kairos/proto/gen/store"
)

// MemoExplicitTagsVersion identifies the derived Markdown tag index.
const MemoExplicitTagsVersion = 1

// WithMemoExplicitTags indexes only source tags while preserving legacy hierarchy metadata.
func WithMemoExplicitTags(content string, payload *storepb.MemoPayload) (*storepb.MemoPayload, error) {
	data, err := markdown.NewService(markdown.WithTagExtension()).ExtractAll([]byte(content))
	if err != nil {
		return nil, errors.Wrap(err, "parse explicit memo tags")
	}
	if payload == nil {
		payload = &storepb.MemoPayload{}
	} else {
		payload = proto.CloneOf(payload)
	}
	payload.ExplicitTags = data.ExplicitTags
	if payload.ExplicitTags == nil {
		payload.ExplicitTags = []string{}
	}
	payload.ExplicitTagsVersion = MemoExplicitTagsVersion
	return payload, nil
}

// MemoExplicitTagPatch returns the two derived fields for an atomic JSON merge.
// Content-only trusted writes must update this index without replacing other metadata.
func MemoExplicitTagPatch(content string) (string, error) {
	payload, err := WithMemoExplicitTags(content, nil)
	if err != nil {
		return "", err
	}
	raw, err := json.Marshal(map[string]any{"explicitTags": payload.ExplicitTags, "explicitTagsVersion": MemoExplicitTagsVersion})
	return string(raw), err
}

// backfillMemoExplicitTags finishes before the application accepts requests.
// Keep every source field and timestamp, using CAS to never overwrite a concurrent
// content or metadata edit. An interrupted backfill resumes on the next startup.
func (s *Store) backfillMemoExplicitTags(ctx context.Context) error {
	placeholder := func(n int) string {
		if s.profile.Driver == "postgres" {
			return "$" + strconv.Itoa(n)
		}
		return "?"
	}
	lastID := int32(0)
	type row struct {
		id      int32
		content string
		payload string
	}
	for {
		batch, err := func() ([]row, error) {
			rows, err := s.driver.GetDB().QueryContext(ctx, "SELECT id, content, payload FROM memo WHERE id > "+placeholder(1)+" ORDER BY id LIMIT 100", lastID)
			if err != nil {
				return nil, errors.Wrap(err, "list legacy explicit tag indexes")
			}
			defer rows.Close()
			batch := []row{}
			for rows.Next() {
				var value row
				if err := rows.Scan(&value.id, &value.content, &value.payload); err != nil {
					return nil, err
				}
				batch = append(batch, value)
			}
			return batch, rows.Err()
		}()
		if err != nil {
			return err
		}
		if len(batch) == 0 {
			return nil
		}
		for _, value := range batch {
			var payload map[string]json.RawMessage
			if err := json.Unmarshal([]byte(value.payload), &payload); err != nil {
				return errors.Wrap(err, "decode legacy memo payload")
			}
			if string(payload["explicitTagsVersion"]) == strconv.Itoa(MemoExplicitTagsVersion) {
				continue
			}
			patch, err := MemoExplicitTagPatch(value.content)
			if err != nil {
				return err
			}
			if payload == nil {
				payload = map[string]json.RawMessage{}
			}
			var index map[string]json.RawMessage
			if err := json.Unmarshal([]byte(patch), &index); err != nil {
				return err
			}
			for key, item := range index {
				payload[key] = item
			}
			next, err := json.Marshal(payload)
			if err != nil {
				return err
			}
			contentPredicate := "content = " + placeholder(3)
			payloadPredicate := "payload = " + placeholder(4)
			if s.profile.Driver == "mysql" {
				contentPredicate = "BINARY content = BINARY ?"
				payloadPredicate = "payload = CAST(? AS JSON)"
			}
			result, err := s.driver.GetDB().ExecContext(ctx, "UPDATE memo SET payload = "+placeholder(1)+" WHERE id = "+placeholder(2)+" AND "+contentPredicate+" AND "+payloadPredicate,
				string(next), value.id, value.content, value.payload)
			if err != nil {
				return errors.Wrap(err, "backfill explicit memo tags")
			}
			changed, err := result.RowsAffected()
			if err != nil {
				return err
			}
			if changed != 1 {
				return errors.New("memo changed during tag index migration; retry startup")
			}
		}
		lastID = batch[len(batch)-1].id
	}
}
