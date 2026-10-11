package v1

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"time"

	"github.com/pkg/errors"
	"google.golang.org/protobuf/encoding/protojson"

	"github.com/EgoSay/kairos/core/journalrecord"
	v1pb "github.com/EgoSay/kairos/proto/gen/api/v1"
	"github.com/EgoSay/kairos/store"
)

// removeUnreferencedJournalOriginal only removes bytes after all surviving
// current attachments and unexpired revisions have released them.
func (s *APIV1Service) removeUnreferencedJournalOriginal(ctx context.Context, uid string) error {
	current, err := s.Store.GetAttachment(ctx, &store.FindAttachment{UID: &uid})
	if err != nil {
		return err
	}
	if current != nil {
		return nil
	}
	docs, err := s.Store.ListJournalDocuments(ctx, &store.FindJournalDocument{Kind: "revision"})
	if err != nil {
		return err
	}
	for _, doc := range docs {
		var revision journalrecord.Revision
		if err := json.Unmarshal(doc.Payload, &revision); err != nil {
			return err
		}
		if journalrecord.Expired(revision.CreatedTs, time.Now()) {
			continue
		}
		memo := &v1pb.Memo{}
		if err := protojson.Unmarshal(revision.Memo, memo); err != nil {
			return err
		}
		for _, attachment := range memo.Attachments {
			if strings.TrimPrefix(attachment.Name, "attachments/") == uid {
				return nil
			}
		}
	}
	path, err := attachmentOriginalPath(s.Profile.Data, uid)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return errors.Wrap(err, "remove unreferenced journal original")
	}
	return nil
}
