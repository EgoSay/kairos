package v1

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/encoding/protojson"

	"github.com/EgoSay/kairos/core/journal"
	"github.com/EgoSay/kairos/core/journalbackup"
	"github.com/EgoSay/kairos/core/journalrecord"
	"github.com/EgoSay/kairos/core/partition"
	v1pb "github.com/EgoSay/kairos/proto/gen/api/v1"
	storepb "github.com/EgoSay/kairos/proto/gen/store"
	"github.com/EgoSay/kairos/store"
)

func putBackupTestDocument(t *testing.T, svc *APIV1Service, owner int32, kind, key string, value any) {
	t.Helper()
	payload, err := json.Marshal(value)
	require.NoError(t, err)
	_, err = svc.Store.PutJournalDocument(context.Background(), &store.JournalDocument{OwnerID: owner, Kind: kind, Key: key, Payload: payload}, 0)
	require.NoError(t, err)
}

func TestJournalBackupNewInstanceRoundtripAndNoReplay(t *testing.T) {
	ctx := context.Background()
	source := newIntegrationService(t)
	owner := createSpaceTestUser(ctx, t, source, "archive-owner", store.RoleUser)
	other := createSpaceTestUser(ctx, t, source, "archive-other", store.RoleUser)
	body := "生活原文\r\n#生活/周末\n[关联](memos/second-record)"
	first, err := source.Store.CreateMemo(ctx, &store.Memo{UID: "first-record", CreatorID: owner.ID, Content: body, Visibility: store.Public, Payload: &storepb.MemoPayload{}})
	require.NoError(t, err)
	second, err := source.Store.CreateMemo(ctx, &store.Memo{UID: "second-record", CreatorID: owner.ID, Content: "另一段记忆", Visibility: store.Private, Payload: &storepb.MemoPayload{}})
	require.NoError(t, err)
	_, err = source.Store.CreateMemo(ctx, &store.Memo{UID: "someone-else", CreatorID: other.ID, Content: "NEVER_EXPORT_FOREIGN", Visibility: store.Public, Payload: &storepb.MemoPayload{}})
	require.NoError(t, err)
	created, updated := int64(1600000000), int64(1600000300)
	require.NoError(t, source.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: first.ID, CreatedTs: &created, UpdatedTs: &updated}))
	archived := store.Archived
	require.NoError(t, source.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: second.ID, RowStatus: &archived}))
	_, err = source.Store.UpsertMemoRelation(ctx, &store.MemoRelation{MemoID: first.ID, RelatedMemoID: second.ID, Type: store.MemoRelationReference})
	require.NoError(t, err)
	media := []byte("derived media bytes")
	original := []byte("ORIGINAL UPLOAD WITH METADATA\x00\xff")
	mediaPath := filepath.Join(source.Profile.Data, "original-test-media")
	require.NoError(t, os.WriteFile(mediaPath, media, 0600))
	_, err = source.Store.CreateAttachment(ctx, &store.Attachment{UID: "media-original", CreatorID: owner.ID, MemoID: &first.ID, Filename: "周末:照片.jpg", Type: "image/jpeg", Blob: media, Size: int64(len(media)), StorageType: storepb.AttachmentStorageType_LOCAL, Reference: mediaPath, CreatedTs: created, UpdatedTs: updated, Payload: &storepb.AttachmentPayload{Payload: &storepb.AttachmentPayload_S3Object_{S3Object: &storepb.AttachmentPayload_S3Object{S3Config: &storepb.StorageS3Config{AccessKeySecret: "SENSITIVE_S3_SECRET"}}}}})
	require.NoError(t, err)
	path, err := attachmentOriginalPath(source.Profile.Data, "media-original")
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0700))
	require.NoError(t, os.WriteFile(path, original, 0600))
	put := func(kind, key string, value any) { putBackupTestDocument(t, source, owner.ID, kind, key, value) }
	put("provenance", first.UID, map[string]any{"modifiedTs": updated + 30, "enteredTs": created + 30})
	put("preferences", "main", journal.Preferences{Timezone: "Asia/Shanghai", CalendarVisible: true, CalendarColor: true, ExcludedMemoNames: []string{"memos/second-record"}})
	put(partition.PartitionKind, "private-zone", partition.Partition{ID: "private-zone", Name: "愿意公开的片段"})
	put(partition.MappingKind, first.UID, partition.Mapping{MemoUID: first.UID, PartitionID: "private-zone"})
	put(partition.TargetKind, "destination", partition.Target{ID: "destination", PartitionID: "private-zone", Name: "My receiver", URL: "https://secret.invalid/SENSITIVE_URL", SigningSecret: "SENSITIVE_SIGNING_SECRET", HasSigningSecret: true, Enabled: true, AutoUpdate: true, Epoch: 1, Fields: partition.Fields{Content: true}})
	put("share", "shared-selection", journal.Share{ID: "shared-selection", Token: "SENSITIVE_SHARE_TOKEN", PasscodeHash: "SENSITIVE_PASSCODE", Filter: journal.ShareFilter{Timezone: "UTC", MemoNames: []string{"memos/first-record"}}, Mode: "fixed", Items: []journal.ShareItem{{MemoName: "memos/first-record", Content: body}}})
	put(partition.ExternalKind, partition.RecordTargetKey("destination", first.UID), partition.External{TargetID: "destination", MemoUID: first.UID, ExternalID: "platform-post-7", PublishedURL: "https://social.example/posts/7"})
	put(partition.DeliveryKind, "stable-event", partition.Delivery{ID: "stable-event", TargetID: "destination", PartitionID: "private-zone", MemoUID: first.UID, Status: "pending", Sequence: 7, LastError: "SENSITIVE_DELIVERY_ERROR", LeaseUntilTs: time.Now().Add(time.Hour).Unix(), NextAttemptTs: time.Now().Add(time.Hour).Unix()})
	put(partition.SequenceKind, partition.RecordTargetKey("destination", first.UID), backupSequence{Sequence: 7, TargetID: "destination", MemoUID: first.UID})
	put("insight", "saved-reflection", journalInsightResult{ID: "saved-reflection", Text: "原有感受，仅供参考", Sources: []journalInsightSource{{Name: "memos/first-record"}}, Citations: []string{"memos/first-record"}})
	revisionRaw, err := protojson.Marshal(&v1pb.Memo{Name: "memos/first-record", Creator: "users/archive-owner", Content: "修改前原文", Visibility: v1pb.Visibility_PUBLIC, Attachments: []*v1pb.Attachment{{Name: "attachments/media-original"}}})
	require.NoError(t, err)
	put("revision", "first-record_revision", journalrecord.Revision{ID: "revision", CreatedTs: time.Now().Unix(), Memo: revisionRaw})
	var zip bytes.Buffer
	require.NoError(t, source.writeJournalBackup(ctx, owner, &zip, true))
	for _, secret := range []string{"NEVER_EXPORT_FOREIGN", "SENSITIVE_URL", "SENSITIVE_SIGNING_SECRET", "SENSITIVE_SHARE_TOKEN", "SENSITIVE_PASSCODE", "SENSITIVE_S3_SECRET", "SENSITIVE_DELIVERY_ERROR"} {
		require.NotContains(t, zip.String(), secret)
	}
	a, err := journalbackup.Read(bytes.NewReader(zip.Bytes()), int64(zip.Len()))
	require.NoError(t, err)
	require.NoError(t, validateJournalBackup(a))
	require.Len(t, a.Manifest.Memos, 2)
	require.Len(t, a.Manifest.Attachments, 1)
	expectedKinds := []string{"preferences", "partition", "partition-mapping", "partition-target", "share", "partition-external", "partition-delivery", "partition-sequence", "insight", "revision"}
	exportedKinds := []string{}
	for _, doc := range a.Manifest.Documents {
		exportedKinds = append(exportedKinds, doc.Kind)
		switch doc.Kind {
		case partition.TargetKind:
			var target partition.Target
			require.NoError(t, json.Unmarshal(doc.Payload, &target))
			require.False(t, target.Enabled)
			require.False(t, target.HasSigningSecret)
			require.Empty(t, target.URL)
			require.Empty(t, target.SigningSecret)
			require.Equal(t, "My receiver", target.Name)
			require.Equal(t, "private-zone", target.PartitionID)
			require.True(t, target.AutoUpdate, "configuration is retained without granting execution")
			require.True(t, target.Fields.Content)
		case "share":
			var share journal.Share
			require.NoError(t, json.Unmarshal(doc.Payload, &share))
			require.True(t, share.Paused)
			require.Empty(t, share.Token)
			require.Empty(t, share.PasscodeHash)
			require.Equal(t, []string{"memos/first-record"}, share.Filter.MemoNames)
			require.Len(t, share.Items, 1)
			require.Equal(t, body, share.Items[0].Content)
		case partition.DeliveryKind:
			var delivery partition.Delivery
			require.NoError(t, json.Unmarshal(doc.Payload, &delivery))
			require.Equal(t, "cancelled", delivery.Status)
			require.Empty(t, delivery.LastError)
			require.Zero(t, delivery.LeaseUntilTs)
			require.Zero(t, delivery.NextAttemptTs)
			require.Equal(t, int64(7), delivery.Sequence)
		default:
		}
	}
	require.ElementsMatch(t, expectedKinds, exportedKinds, "every organization/history document must actually enter the archive")
	digestBytes := sha256.Sum256(zip.Bytes())
	digest := hex.EncodeToString(digestBytes[:])

	// A separate SQLite store and data directory prove this is independently
	// restorable; the authenticated owner differs from the original numeric ID.
	dest := newIntegrationService(t)
	createSpaceTestUser(ctx, t, dest, "unrelated-destination-user", store.RoleUser)
	newOwner := createSpaceTestUser(ctx, t, dest, "restored-owner", store.RoleUser)
	report, err := dest.restoreJournalBackup(ctx, newOwner, a, digest)
	require.NoError(t, err)
	require.True(t, report.Complete)
	require.Equal(t, 2, report.Memos)
	require.Equal(t, 1, report.Attachments)
	require.Equal(t, 1, report.Originals)
	require.Equal(t, len(expectedKinds), report.Documents)
	restored, err := dest.Store.GetMemo(ctx, &store.FindMemo{UID: &first.UID})
	require.NoError(t, err)
	require.Equal(t, body, restored.Content)
	require.Equal(t, created, restored.CreatedTs)
	require.Equal(t, updated, restored.UpdatedTs)
	require.Equal(t, newOwner.ID, restored.CreatorID)
	require.Equal(t, store.Private, restored.Visibility)
	require.Nil(t, restored.SpaceID)
	archivedMemo, err := dest.Store.GetMemo(ctx, &store.FindMemo{UID: &second.UID})
	require.NoError(t, err)
	require.Equal(t, store.Archived, archivedMemo.RowStatus)
	relations, err := dest.Store.ListMemoRelations(ctx, &store.FindMemoRelation{MemoID: &restored.ID})
	require.NoError(t, err)
	require.Len(t, relations, 1)
	require.Equal(t, archivedMemo.ID, relations[0].RelatedMemoID)
	uid := "media-original"
	attachment, err := dest.Store.GetAttachment(ctx, &store.FindAttachment{UID: &uid})
	require.NoError(t, err)
	require.Equal(t, created, attachment.CreatedTs)
	require.Equal(t, updated, attachment.UpdatedTs)
	require.Equal(t, newOwner.ID, attachment.CreatorID)
	actual, err := os.ReadFile(attachment.Reference)
	require.NoError(t, err)
	require.Equal(t, media, actual)
	path, err = attachmentOriginalPath(dest.Profile.Data, uid)
	require.NoError(t, err)
	actual, err = os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, original, actual)
	docs := []*store.JournalDocument{}
	for _, kind := range expectedKinds {
		found, err := dest.Store.ListJournalDocuments(ctx, &store.FindJournalDocument{OwnerID: &newOwner.ID, Kind: kind})
		require.NoError(t, err)
		require.Len(t, found, 1, "restored %s must exist before its safety checks", kind)
		docs = append(docs, found...)
	}
	for _, doc := range docs {
		switch doc.Kind {
		case "share":
			var share journal.Share
			require.NoError(t, json.Unmarshal(doc.Payload, &share))
			require.True(t, share.Paused)
			require.NotEmpty(t, share.Token)
			require.NotEqual(t, "SENSITIVE_SHARE_TOKEN", share.Token)
			require.Empty(t, share.PasscodeHash)
		case partition.TargetKind:
			var target partition.Target
			require.NoError(t, json.Unmarshal(doc.Payload, &target))
			require.False(t, target.Enabled)
			require.False(t, target.HasSigningSecret)
			require.Empty(t, target.URL)
			require.Empty(t, target.SigningSecret)
			require.True(t, target.AutoUpdate)
			require.True(t, target.Fields.Content)
		case partition.MappingKind:
			var mapping partition.Mapping
			require.NoError(t, json.Unmarshal(doc.Payload, &mapping))
			require.True(t, mapping.Suspended)
			require.Equal(t, first.UID, mapping.MemoUID)
			p, err := dest.Store.GetJournalDocument(ctx, newOwner.ID, partition.PartitionKind, mapping.PartitionID)
			require.NoError(t, err)
			require.NotNil(t, p, "restored mapping must refer to the restored partition")
		case partition.DeliveryKind:
			var delivery partition.Delivery
			require.NoError(t, json.Unmarshal(doc.Payload, &delivery))
			require.Equal(t, "cancelled", delivery.Status)
			require.Equal(t, "stable-event", delivery.SourceEventID)
			require.Empty(t, delivery.LastError)
			require.Zero(t, delivery.LeaseUntilTs)
			require.Zero(t, delivery.NextAttemptTs)
		case partition.ExternalKind:
			var external partition.External
			require.NoError(t, json.Unmarshal(doc.Payload, &external))
			require.Equal(t, "platform-post-7", external.ExternalID)
		case partition.SequenceKind:
			var sequence backupSequence
			require.NoError(t, json.Unmarshal(doc.Payload, &sequence))
			require.Equal(t, int64(7), sequence.Sequence)
		case "insight":
			var result journalInsightResult
			require.NoError(t, json.Unmarshal(doc.Payload, &result))
			require.True(t, result.Stale)
			require.Equal(t, "原有感受，仅供参考", result.Text)
		case "revision":
			var revision journalrecord.Revision
			require.NoError(t, json.Unmarshal(doc.Payload, &revision))
			var memo v1pb.Memo
			require.NoError(t, protojson.Unmarshal(revision.Memo, &memo))
			require.Equal(t, v1pb.Visibility_PRIVATE, memo.Visibility)
			require.Equal(t, "users/restored-owner", memo.Creator)
			require.Equal(t, "修改前原文", memo.Content)
		case "preferences":
			var prefs journal.Preferences
			require.NoError(t, json.Unmarshal(doc.Payload, &prefs))
			require.Equal(t, "Asia/Shanghai", prefs.Timezone)
		case partition.PartitionKind:
			var p partition.Partition
			require.NoError(t, json.Unmarshal(doc.Payload, &p))
			require.Equal(t, "愿意公开的片段", p.Name)
		default:
		}
	}
	prov, err := dest.Store.GetJournalDocument(ctx, newOwner.ID, "provenance", first.UID)
	require.NoError(t, err)
	require.NotNil(t, prov)
	var provenance struct {
		ModifiedTs int64 `json:"modifiedTs"`
		EnteredTs  int64 `json:"enteredTs"`
	}
	require.NoError(t, json.Unmarshal(prov.Payload, &provenance))
	require.Equal(t, updated+30, provenance.ModifiedTs)
	require.Equal(t, created+30, provenance.EnteredTs)
	service := partition.New(dest.Store, dest.readPartitionMemo)
	service.Send = nil // ProcessDue must find no runnable work at all.
	require.NoError(t, service.ProcessDue(ctx))
	_, err = dest.restoreJournalBackup(ctx, newOwner, a, digest)
	require.NoError(t, err)
	all, err := dest.Store.ListMemos(ctx, &store.FindMemo{CreatorID: &newOwner.ID})
	require.NoError(t, err)
	require.Len(t, all, 2, "retrying identical archive cannot duplicate records")
}

func TestJournalBackupDocumentSelectionAndOptionalHistory(t *testing.T) {
	ctx := context.Background()
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(ctx, t, svc, "backup-doc-owner", store.RoleUser)
	other := createSpaceTestUser(ctx, t, svc, "backup-doc-other", store.RoleUser)
	memo, err := svc.Store.CreateMemo(ctx, &store.Memo{UID: "selected-original", CreatorID: owner.ID, Content: "保留此刻的原文", Visibility: store.Private})
	require.NoError(t, err)
	space, err := svc.Store.CreateSpace(ctx, &store.Space{UID: "departed-space", Title: "Other owner's Space"}, other.ID)
	require.NoError(t, err)
	_, err = svc.Store.CreateSpaceInvitation(ctx, &store.SpaceInvitation{SpaceID: space.ID, UserID: owner.ID, Role: store.SpaceMemberRoleUser}, other.ID)
	require.NoError(t, err)
	_, err = svc.Store.AcceptSpaceInvitation(ctx, &store.AcceptSpaceInvitation{SpaceID: space.ID, UserID: owner.ID}, owner.ID)
	require.NoError(t, err)
	denied, err := svc.Store.CreateMemo(ctx, &store.Memo{UID: "inaccessible-original", CreatorID: owner.ID, SpaceID: &space.ID, Content: "NEVER_EXPORT_DENIED_BODY", Visibility: store.SpaceAudience})
	require.NoError(t, err)
	require.NoError(t, svc.Store.DeleteSpaceMember(ctx, &store.DeleteSpaceMember{SpaceID: space.ID, UserID: owner.ID}, other.ID))
	_, err = svc.Store.CreateMemo(ctx, &store.Memo{UID: "foreign-original", CreatorID: other.ID, Content: "NEVER_EXPORT_FOREIGN_BODY", Visibility: store.Public})
	require.NoError(t, err)
	put := func(kind, key string, value any) { putBackupTestDocument(t, svc, owner.ID, kind, key, value) }
	put("preferences", "main", journal.Preferences{Timezone: "Asia/Shanghai"})
	put(partition.PartitionKind, "selected-partition", partition.Partition{ID: "selected-partition", Name: "我的生活"})
	put(partition.MappingKind, memo.UID, partition.Mapping{MemoUID: memo.UID, PartitionID: "selected-partition"})
	put(partition.MappingKind, denied.UID, partition.Mapping{MemoUID: denied.UID, PartitionID: "selected-partition"})
	put("insight", "selected-insight", journalInsightResult{ID: "selected-insight", Text: "基于可读原文的思考", Sources: []journalInsightSource{{Name: "memos/" + memo.UID}}, Citations: []string{"memos/" + memo.UID}})
	put("insight", "denied-insight", journalInsightResult{ID: "denied-insight", Text: "NEVER_EXPORT_DENIED_INSIGHT", Sources: []journalInsightSource{{Name: "memos/" + memo.UID}, {Name: "memos/" + denied.UID}}})
	putBackupTestDocument(t, svc, other.ID, partition.PartitionKind, "foreign-partition", partition.Partition{ID: "foreign-partition", Name: "NEVER_EXPORT_FOREIGN_DOCUMENT"})
	put("share", "selected-share", journal.Share{ID: "selected-share", Mode: "fixed", Token: "NEVER_EXPORT_SHARE_TOKEN", Filter: journal.ShareFilter{Timezone: "UTC", MemoNames: []string{"memos/" + memo.UID}}, Items: []journal.ShareItem{
		{MemoName: "memos/" + memo.UID, Content: memo.Content},
		{MemoName: "memos/" + denied.UID, Content: "NEVER_EXPORT_DENIED_SNAPSHOT"},
	}})
	for _, kind := range []string{"partition-pending", "share-guard", "backup-preview", "backup-restored-map", "agent-credentials", "unknown-future-kind"} {
		put(kind, "must-not-export", map[string]string{"secret": "NEVER_EXPORT_INTERNAL_DOCUMENT"})
	}

	// This attachment survives only in a revision. The history toggle controls
	// both its snapshot and original bytes, not just the manifest flag.
	media := []byte("HISTORY_ONLY_MEDIA")
	mediaPath := filepath.Join(svc.Profile.Data, "history-media")
	require.NoError(t, os.WriteFile(mediaPath, media, 0600))
	_, err = svc.Store.CreateAttachment(ctx, &store.Attachment{UID: "history-media", CreatorID: owner.ID, Filename: "旧 照片.txt", Type: "text/plain", Size: int64(len(media)), StorageType: storepb.AttachmentStorageType_LOCAL, Reference: mediaPath})
	require.NoError(t, err)
	originalPath, err := attachmentOriginalPath(svc.Profile.Data, "history-media")
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(filepath.Dir(originalPath), 0700))
	require.NoError(t, os.WriteFile(originalPath, []byte("HISTORY_ONLY_ORIGINAL"), 0600))
	putRevision := func(key, memoUID, body string, created int64, attachments []*v1pb.Attachment) {
		t.Helper()
		raw, err := protojson.Marshal(&v1pb.Memo{Name: "memos/" + memoUID, Content: body, Attachments: attachments})
		require.NoError(t, err)
		put("revision", key, journalrecord.Revision{ID: key, CreatedTs: created, Memo: raw})
	}
	putRevision("selected-revision", memo.UID, "HISTORY_ONLY_TEXT", time.Now().Unix(), []*v1pb.Attachment{{Name: "attachments/history-media"}})
	putRevision("expired-revision", memo.UID, "NEVER_EXPORT_EXPIRED_REVISION", time.Now().Add(-journalrecord.Retention-time.Hour).Unix(), nil)
	putRevision("denied-revision", denied.UID, "NEVER_EXPORT_DENIED_REVISION", time.Now().Unix(), nil)

	for _, history := range []bool{false, true} {
		name := "without-history"
		if history {
			name = "with-history"
		}
		t.Run(name, func(t *testing.T) {
			var output bytes.Buffer
			require.NoError(t, svc.writeJournalBackup(ctx, owner, &output, history))
			archive, err := journalbackup.Read(bytes.NewReader(output.Bytes()), int64(output.Len()))
			require.NoError(t, err)
			require.NoError(t, validateJournalBackup(archive))
			require.Equal(t, history, archive.Manifest.IncludeHistory)
			require.Len(t, archive.Manifest.Memos, 1)
			require.Equal(t, memo.UID, archive.Manifest.Memos[0].UID)
			body, err := archive.Text(archive.Manifest.Memos[0].ContentPath)
			require.NoError(t, err)
			require.Equal(t, memo.Content, string(body))
			documentKeys := []string{}
			for _, doc := range archive.Manifest.Documents {
				documentKeys = append(documentKeys, doc.Kind+":"+doc.Key)
			}
			expected := []string{"preferences:main", "partition:selected-partition", "partition-mapping:selected-original", "insight:selected-insight", "share:selected-share"}
			if history {
				expected = append(expected, "revision:selected-revision")
			}
			require.ElementsMatch(t, expected, documentKeys)
			for _, secret := range []string{"NEVER_EXPORT_DENIED_BODY", "NEVER_EXPORT_FOREIGN_BODY", "NEVER_EXPORT_DENIED_INSIGHT", "NEVER_EXPORT_FOREIGN_DOCUMENT", "NEVER_EXPORT_SHARE_TOKEN", "NEVER_EXPORT_DENIED_SNAPSHOT", "NEVER_EXPORT_INTERNAL_DOCUMENT", "NEVER_EXPORT_EXPIRED_REVISION", "NEVER_EXPORT_DENIED_REVISION"} {
				require.NotContains(t, output.String(), secret)
			}
			if history {
				require.Len(t, archive.Manifest.Attachments, 1)
				file := archive.Manifest.Attachments[0]
				require.Equal(t, "history-media", file.UID)
				actual, err := archive.Text(file.Path)
				require.NoError(t, err)
				require.Equal(t, media, actual)
				actual, err = archive.Text(file.OriginalPath)
				require.NoError(t, err)
				require.Equal(t, "HISTORY_ONLY_ORIGINAL", string(actual))
				require.Contains(t, output.String(), "HISTORY_ONLY_TEXT")
			} else {
				require.Empty(t, archive.Manifest.Attachments)
				for _, historical := range []string{"HISTORY_ONLY_TEXT", "HISTORY_ONLY_MEDIA", "HISTORY_ONLY_ORIGINAL"} {
					require.NotContains(t, output.String(), historical)
				}
			}
		})
	}
}

func TestJournalBackupPreviewIsolationAndValidationBeforeMutation(t *testing.T) {
	svc := newIntegrationService(t)
	ctx := context.Background()
	owner := createSpaceTestUser(ctx, t, svc, "preview-owner", store.RoleUser)
	other := createSpaceTestUser(ctx, t, svc, "preview-other", store.RoleUser)
	current := owner.ID
	e := echo.New()
	group := e.Group("/api/v1/journal")
	group.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			c.SetRequest(c.Request().WithContext(userCtx(c.Request().Context(), current)))
			return next(c)
		}
	})
	svc.registerJournalBackupRoutes(group)
	request := func(path string, body []byte) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/api/v1/journal"+path, bytes.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		e.ServeHTTP(w, r)
		return w
	}
	archive := func(docs []journalbackup.Document) []byte {
		var output bytes.Buffer
		w := journalbackup.NewWriter(&output)
		require.NoError(t, w.Add("memos/sample.md", strings.NewReader("my original")))
		require.NoError(t, w.Close(&journalbackup.Manifest{Memos: []journalbackup.Memo{{UID: "sample", ContentPath: "memos/sample.md", State: "NORMAL"}}, Documents: docs}))
		return output.Bytes()
	}
	bad := archive([]journalbackup.Document{{Kind: "preferences", Key: "main", Payload: json.RawMessage(`{"timezone":"Not/A/Timezone"}`)}})
	w := request("/backups/preview", bad)
	require.NotEqual(t, 200, w.Code)
	all, err := svc.Store.ListMemos(ctx, &store.FindMemo{CreatorID: &owner.ID})
	require.NoError(t, err)
	require.Empty(t, all)
	w = request("/backups/preview", archive(nil))
	require.Equal(t, 200, w.Code, w.Body.String())
	var preview backupPreview
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &preview))
	all, err = svc.Store.ListMemos(ctx, &store.FindMemo{CreatorID: &owner.ID})
	require.NoError(t, err)
	require.Empty(t, all, "preview cannot import")
	body, _ := json.Marshal(map[string]string{"digest": preview.Digest})
	current = other.ID
	w = request("/backups/"+preview.Token+"/restore", body)
	require.NotEqual(t, 200, w.Code)
	current = owner.ID
	w = request("/backups/"+preview.Token+"/restore", []byte(`{"digest":"changed"}`))
	require.NotEqual(t, 200, w.Code)
	w = request("/backups/"+preview.Token+"/restore", body)
	require.Equal(t, 200, w.Code, w.Body.String())
	w = request("/backups/"+preview.Token+"/restore", body)
	require.Equal(t, 200, w.Code, w.Body.String())
	all, err = svc.Store.ListMemos(ctx, &store.FindMemo{CreatorID: &owner.ID})
	require.NoError(t, err)
	require.Len(t, all, 1)
	staged, err := svc.backupStagePath(owner.ID, preview.Token)
	require.NoError(t, err)
	_, err = os.Stat(staged)
	require.True(t, os.IsNotExist(err))
}

func TestBackupLinkRemapDoesNotRewriteIDPrefixes(t *testing.T) {
	text := "memos/abc memos/abcdef file/image/a.jpg attachments/image2"
	require.Equal(t, "memos/new memos/abcdef file/restored/a.jpg attachments/image2", remapBackupLinks(text, map[string]string{"abc": "new"}, map[string]string{"image": "restored"}))
}

func TestJournalBackupExistingInstancePauseAndCollision(t *testing.T) {
	ctx := context.Background()
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(ctx, t, svc, "existing-owner", store.RoleUser)
	other := createSpaceTestUser(ctx, t, svc, "still-active-owner", store.RoleUser)
	original, err := svc.Store.CreateMemo(ctx, &store.Memo{UID: "same-id", CreatorID: owner.ID, Content: "existing must survive", Visibility: store.Private, Payload: &storepb.MemoPayload{}})
	require.NoError(t, err)
	for _, user := range []*store.User{owner, other} {
		putBackupTestDocument(t, svc, user.ID, partition.TargetKind, "live-target", partition.Target{ID: "live-target", PartitionID: "zone", Enabled: true, Epoch: 2})
		putBackupTestDocument(t, svc, user.ID, "share", "live-share", journal.Share{ID: "live-share", Token: "original-live-token"})
	}
	var encoded bytes.Buffer
	w := journalbackup.NewWriter(&encoded)
	require.NoError(t, w.Add("memos/same.md", strings.NewReader("restored original [self](memos/same-id)")))
	require.NoError(t, w.Close(&journalbackup.Manifest{Memos: []journalbackup.Memo{{UID: "same-id", ContentPath: "memos/same.md", State: "NORMAL"}}}))
	a, err := journalbackup.Read(bytes.NewReader(encoded.Bytes()), int64(encoded.Len()))
	require.NoError(t, err)
	hash := sha256.Sum256(encoded.Bytes())
	report, err := svc.restoreJournalBackup(ctx, owner, a, hex.EncodeToString(hash[:]))
	require.NoError(t, err)
	require.True(t, report.Complete)
	kept, err := svc.Store.GetMemo(ctx, &store.FindMemo{ID: &original.ID})
	require.NoError(t, err)
	require.Equal(t, "existing must survive", kept.Content)
	memos, err := svc.Store.ListMemos(ctx, &store.FindMemo{CreatorID: &owner.ID})
	require.NoError(t, err)
	require.Len(t, memos, 2)
	for _, memo := range memos {
		if memo.ID != original.ID {
			require.Equal(t, "restored original [self](memos/"+memo.UID+")", memo.Content)
			require.Equal(t, store.Private, memo.Visibility)
		}
	}
	for _, user := range []*store.User{owner, other} {
		doc, err := svc.Store.GetJournalDocument(ctx, user.ID, partition.TargetKind, "live-target")
		require.NoError(t, err)
		var target partition.Target
		require.NoError(t, json.Unmarshal(doc.Payload, &target))
		require.Equal(t, user.ID != owner.ID, target.Enabled)
		doc, err = svc.Store.GetJournalDocument(ctx, user.ID, "share", "live-share")
		require.NoError(t, err)
		var share journal.Share
		require.NoError(t, json.Unmarshal(doc.Payload, &share))
		require.Equal(t, user.ID == owner.ID, share.Paused)
	}
}
