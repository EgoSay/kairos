package v1

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	"github.com/EgoSay/kairos/core/journalrecord"
	v1pb "github.com/EgoSay/kairos/proto/gen/api/v1"
	"github.com/EgoSay/kairos/store"
)

func TestAttachmentLibraryTrashLifecycleAndPagination(t *testing.T) {
	service, ctx := newUploadTestService(t)
	var memos []*v1pb.Memo
	for _, label := range []string{"active", "archived", "historical-trash"} {
		attachment, err := service.CreateAttachment(ctx, &v1pb.CreateAttachmentRequest{Attachment: &v1pb.Attachment{Filename: label + " 中文 #?.txt", Type: "text/plain", Content: []byte(label)}})
		require.NoError(t, err)
		memo, err := service.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: label, Attachments: []*v1pb.Attachment{{Name: attachment.Name}}}})
		require.NoError(t, err)
		memos = append(memos, memo)
	}
	_, err := service.UpdateMemo(ctx, &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: memos[1].Name, State: v1pb.State_ARCHIVED}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"state"}}})
	require.NoError(t, err)
	uid := strings.TrimPrefix(memos[2].Name, "memos/")
	deleted := journalRecordRequest(ctx, service, http.MethodPost, "/memos/"+uid+"/trash")
	require.Equal(t, http.StatusOK, deleted.Code, deleted.Body.String())
	// No rewrite/migration is required: lifecycle derives from the existing tombstone.
	var names []string
	token := ""
	for {
		result, err := service.ListAttachments(ctx, &v1pb.ListAttachmentsRequest{PageSize: 1, PageToken: token})
		require.NoError(t, err)
		require.Len(t, result.Attachments, 1)
		names = append(names, *result.Attachments[0].Memo)
		token = result.NextPageToken
		if token == "" {
			break
		}
		require.Less(t, len(names), 3)
	}
	require.ElementsMatch(t, []string{memos[0].Name, memos[1].Name}, names)
	trash, err := service.ListAttachments(ctx, &v1pb.ListAttachmentsRequest{OnlyTrash: true, PageSize: 1})
	require.NoError(t, err)
	require.Len(t, trash.Attachments, 1)
	require.Equal(t, memos[2].Name, *trash.Attachments[0].Memo)
	require.NotNil(t, trash.Attachments[0].DeleteTime)
	require.Empty(t, trash.NextPageToken)
	stranger := createSpaceTestUser(ctx, t, service, "trash-outsider", store.RoleUser)
	denied, err := service.ListAttachments(userCtx(ctx, stranger.ID), &v1pb.ListAttachmentsRequest{OnlyTrash: true})
	require.NoError(t, err)
	require.Empty(t, denied.Attachments)
	restored := journalRecordRequest(ctx, service, http.MethodPost, "/trash/"+uid+"/restore")
	require.Equal(t, http.StatusOK, restored.Code, restored.Body.String())
	normal, err := service.ListAttachments(ctx, &v1pb.ListAttachmentsRequest{PageSize: 100})
	require.NoError(t, err)
	require.Len(t, normal.Attachments, 3)
	trash, err = service.ListAttachments(ctx, &v1pb.ListAttachmentsRequest{OnlyTrash: true})
	require.NoError(t, err)
	require.Empty(t, trash.Attachments)
}

func TestPurgeRevisionRetainsOriginalReferencedElsewhere(t *testing.T) {
	service, ctx := newUploadTestService(t)
	attachment, err := service.CreateAttachment(ctx, &v1pb.CreateAttachmentRequest{Attachment: &v1pb.Attachment{Filename: "retained.txt", Type: "text/plain", Content: []byte("irreplaceable original")}})
	require.NoError(t, err)
	uid := strings.TrimPrefix(attachment.Name, "attachments/")
	row, err := service.Store.GetAttachment(ctx, &store.FindAttachment{UID: &uid})
	require.NoError(t, err)
	owner := row.CreatorID
	raw, err := protojson.Marshal(&v1pb.Memo{Attachments: []*v1pb.Attachment{attachment}})
	require.NoError(t, err)
	for _, key := range []string{"purged_rev", "surviving_rev"} {
		payload, err := json.Marshal(journalrecord.Revision{ID: "rev", CreatedTs: time.Now().Unix(), Memo: raw})
		require.NoError(t, err)
		_, err = service.Store.PutJournalDocument(ctx, &store.JournalDocument{OwnerID: owner, Kind: "revision", Key: key, Payload: payload}, 0)
		require.NoError(t, err)
	}
	require.NoError(t, service.Store.DeleteAttachment(ctx, &store.DeleteAttachment{ID: row.ID}))
	require.NoError(t, service.purgeJournalRevisions(ctx, owner, "purged"))
	path, err := attachmentOriginalPath(service.Profile.Data, uid)
	require.NoError(t, err)
	bytes, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, "irreplaceable original", string(bytes))
	require.NoError(t, service.purgeJournalRevisions(ctx, owner, "surviving"))
	_, err = os.Stat(path)
	require.True(t, os.IsNotExist(err))
}
