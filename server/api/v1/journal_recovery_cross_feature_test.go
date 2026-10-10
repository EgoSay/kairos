package v1

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	"github.com/EgoSay/kairos/core/journal"
	"github.com/EgoSay/kairos/core/journalbackup"
	"github.com/EgoSay/kairos/core/journalrecord"
	"github.com/EgoSay/kairos/core/partition"
	"github.com/EgoSay/kairos/internal/webhook"
	v1pb "github.com/EgoSay/kairos/proto/gen/api/v1"
	"github.com/EgoSay/kairos/store"
)

func TestJournalRevisionRestoreDoesNotSendPreviouslyPrivateText(t *testing.T) {
	require.NoError(t, webhook.ConfigurePrivateDestinationAllowlist([]string{"127.0.0.1"}))
	t.Cleanup(func() { require.NoError(t, webhook.ConfigurePrivateDestinationAllowlist(nil)) })
	s, ctx := newUploadTestService(t)
	owner, err := s.fetchCurrentUser(ctx)
	require.NoError(t, err)
	s.JournalPartitions = partition.New(s.Store, s.readPartitionMemo)
	p, err := s.JournalPartitions.SavePartition(ctx, owner.ID, &partition.Partition{Name: "chosen for external updates"})
	require.NoError(t, err)
	received := make(chan partition.Payload, 10)
	receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload partition.Payload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		received <- payload
		w.WriteHeader(http.StatusNoContent)
	}))
	defer receiver.Close()
	_, err = s.JournalPartitions.SaveTarget(ctx, owner.ID, &partition.Target{PartitionID: p.ID, Name: "synthetic receiver", URL: receiver.URL, Enabled: true, AutoUpdate: true, Fields: partition.Fields{Content: true}})
	require.NoError(t, err)
	const privateText = "OLD PRIVATE SYNTHETIC TEXT NEVER AUTHORIZED FOR SENDING"
	memo, err := s.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: privateText}})
	require.NoError(t, err)
	require.NoError(t, s.JournalPartitions.ProcessDue(ctx))
	require.Empty(t, received)
	_, err = s.UpdateMemo(ctx, &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: memo.Name, Content: "approved current text"}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}}, JournalPartition: &v1pb.JournalPartitionSelection{PartitionId: p.ID}})
	require.NoError(t, err)
	require.NoError(t, s.JournalPartitions.ProcessDue(ctx))
	require.Len(t, received, 1)
	initial := <-received
	require.NotNil(t, initial.Content)
	require.Equal(t, "approved current text", *initial.Content)
	// Leave one successful save in the durable outbox, as after a request or
	// process interruption. Restoration must prevent its later reconciliation.
	_, err = s.UpdateMemo(ctx, &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: memo.Name, Content: "approved but not sent yet"}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}}, JournalPartition: &v1pb.JournalPartitionSelection{PartitionId: p.ID, ExpectedVersion: 1}})
	require.NoError(t, err)
	uid := strings.TrimPrefix(memo.Name, "memos/")
	var versions struct {
		Revisions []journalrecord.Revision `json:"revisions"`
	}
	response := journalRecordRequest(ctx, s, http.MethodGet, "/memos/"+uid+"/revisions")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &versions))
	require.Len(t, versions.Revisions, 2)
	privateRevision := ""
	for _, version := range versions.Revisions {
		if strings.Contains(string(version.Memo), privateText) {
			privateRevision = version.ID
		}
	}
	require.NotEmpty(t, privateRevision)
	response = journalRecordRequest(ctx, s, http.MethodPost, "/memos/"+uid+"/revisions/"+privateRevision+"/restore")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	restored, err := s.GetMemo(ctx, &v1pb.GetMemoRequest{Name: memo.Name})
	require.NoError(t, err)
	require.Equal(t, privateText, restored.Content, "restoration must preserve the owner's recoverable content")
	require.NoError(t, s.JournalPartitions.ProcessDue(ctx))
	require.NoError(t, s.JournalPartitions.ProcessDue(ctx))
	if len(received) != 0 {
		payload := <-received
		t.Fatalf("restoring a revision implicitly sent a new %s event: content=%q", payload.Event, *payload.Content)
	}
	mapping, err := s.JournalPartitions.GetMapping(ctx, owner.ID, uid)
	require.NoError(t, err)
	require.True(t, mapping.Suspended)
	require.Equal(t, p.ID, mapping.PartitionID, "restoration preserves organization but withdraws sending permission")
	_, err = s.UpdateMemo(ctx, &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: memo.Name, Content: "still local after restoration"}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}}})
	require.NoError(t, err)
	require.NoError(t, s.JournalPartitions.ProcessDue(ctx))
	require.Empty(t, received, "ordinary editing must not implicitly reauthorize the suspended mapping")
	_, err = s.UpdateMemo(ctx, &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: memo.Name}, JournalPartition: &v1pb.JournalPartitionSelection{PartitionId: p.ID, ExpectedVersion: mapping.Version}})
	require.NoError(t, err)
	require.NoError(t, s.JournalPartitions.ProcessDue(ctx))
	require.Len(t, received, 1)
	explicit := <-received
	require.NotNil(t, explicit.Content)
	require.Equal(t, "still local after restoration", *explicit.Content)
}

func TestJournalRevisionRestoreCASRejectsConcurrentReauthorization(t *testing.T) {
	s, ctx := newUploadTestService(t)
	owner, err := s.fetchCurrentUser(ctx)
	require.NoError(t, err)
	s.JournalPartitions = partition.New(s.Store, s.readPartitionMemo)
	p, err := s.JournalPartitions.SavePartition(ctx, owner.ID, &partition.Partition{Name: "explicit selection"})
	require.NoError(t, err)
	memo, err := s.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "current authorized version"}, JournalPartition: &v1pb.JournalPartitionSelection{PartitionId: p.ID}})
	require.NoError(t, err)
	uid := strings.TrimPrefix(memo.Name, "memos/")
	require.NoError(t, s.suspendPartitionMemoDeliveries(ctx, owner.ID, uid))
	stored, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &uid})
	require.NoError(t, err)
	documents, err := s.prepareMemoPartitionRestore(ctx, stored)
	require.NoError(t, err)
	mapping, err := s.JournalPartitions.GetMapping(ctx, owner.ID, uid)
	require.NoError(t, err)
	_, err = s.JournalPartitions.Assign(ctx, owner.ID, uid, p.ID, mapping.Version)
	require.NoError(t, err)
	private := "old private version cannot inherit concurrent authorization"
	err = s.Store.ApplyMemoMutation(ctx, &store.MemoMutation{MemoID: stored.ID, MemoCreatorID: owner.ID, ExpectedMemoContent: stored.Content,
		MemoUpdate: &store.UpdateMemo{ID: stored.ID, Content: &private}, JournalDocuments: documents})
	require.ErrorIs(t, err, store.ErrMemoMutationConflict)
	actual, err := s.GetMemo(ctx, &v1pb.GetMemoRequest{Name: memo.Name})
	require.NoError(t, err)
	require.Equal(t, "current authorized version", actual.Content)
	mapping, err = s.JournalPartitions.GetMapping(ctx, owner.ID, uid)
	require.NoError(t, err)
	require.False(t, mapping.Suspended, "failed restoration cannot undo the other device's explicit assignment")
}

func TestBackupLinkRemapHandlesCanonicalAttachmentURLs(t *testing.T) {
	text := "[first](/file/attachments/photo/name.txt) [second](/file/attachments/photo-extended/other.txt)"
	want := "[first](/file/attachments/new-id/name.txt) [second](/file/attachments/photo-extended/other.txt)"
	require.Equal(t, want, remapBackupLinks(text, nil, map[string]string{"photo": "new-id"}))
}

func TestJournalBackupCollisionRestoresCanonicalInlineAttachment(t *testing.T) {
	source, ctx := newUploadTestService(t)
	owner, err := source.fetchCurrentUser(ctx)
	require.NoError(t, err)
	attachment, err := source.CreateAttachment(ctx, &v1pb.CreateAttachmentRequest{AttachmentId: "colliding-photo", Attachment: &v1pb.Attachment{Filename: "名字 空格.txt", Type: "text/plain", Content: []byte("RESTORABLE SOURCE ORIGINAL")}})
	require.NoError(t, err)
	body := "[original](/file/attachments/colliding-photo/名字%20空格.txt?original=true#source)"
	memo, err := source.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: body, Attachments: []*v1pb.Attachment{attachment}}})
	require.NoError(t, err)
	var archive bytes.Buffer
	require.NoError(t, source.writeJournalBackup(ctx, owner, &archive, true))
	backup, err := journalbackup.Read(bytes.NewReader(archive.Bytes()), int64(archive.Len()))
	require.NoError(t, err)
	digest := sha256.Sum256(archive.Bytes())
	destination, destinationCtx := newUploadTestService(t)
	destinationOwner, err := destination.fetchCurrentUser(destinationCtx)
	require.NoError(t, err)
	existing, err := destination.CreateAttachment(destinationCtx, &v1pb.CreateAttachmentRequest{AttachmentId: "colliding-photo", Attachment: &v1pb.Attachment{Filename: "existing.txt", Type: "text/plain", Content: []byte("EXISTING ORIGINAL MUST SURVIVE")}})
	require.NoError(t, err)
	report, err := destination.restoreJournalBackup(destinationCtx, destinationOwner, backup, hex.EncodeToString(digest[:]))
	require.NoError(t, err)
	require.True(t, report.Complete)
	restored, err := destination.GetMemo(destinationCtx, &v1pb.GetMemoRequest{Name: memo.Name})
	require.NoError(t, err)
	require.Len(t, restored.Attachments, 1)
	copy := restored.Attachments[0]
	require.NotEqual(t, existing.Name, copy.Name)
	require.Equal(t, "[original](/file/"+copy.Name+"/名字%20空格.txt?original=true#source)", restored.Content)
	for _, fixture := range []struct {
		name string
		body string
	}{{copy.Name, "RESTORABLE SOURCE ORIGINAL"}, {existing.Name, "EXISTING ORIGINAL MUST SURVIVE"}} {
		uid := strings.TrimPrefix(fixture.name, "attachments/")
		response := journalRecordRequest(destinationCtx, destination, http.MethodGet, "/attachments/"+uid+"/original")
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		require.Equal(t, fixture.body, response.Body.String())
	}
}

func TestRecoveryLinkRemapPreservesFilenameQueryFragmentAndOrdinaryWords(t *testing.T) {
	for _, remap := range []struct {
		name string
		fn   func(string, map[string]string) string
	}{
		{"version", remapJournalAttachmentLinks},
		{"backup", func(body string, mapping map[string]string) string { return remapBackupLinks(body, nil, mapping) }},
	} {
		t.Run(remap.name, func(t *testing.T) {
			for _, pair := range [][2]string{
				{"/file/attachments/photo/a%20b%23中.txt?x=photo#photo", "/file/attachments/new-id/a%20b%23中.txt?x=photo#photo"},
				{"/file/photo/a.txt?next=attachments/photo#attachments/photo", "/file/new-id/a.txt?next=attachments/photo#attachments/photo"},
				{"/file/attachments/photo/attachments/photo", "/file/attachments/new-id/attachments/photo"},
				{"/file/attachments/other/attachments/photo", "/file/attachments/other/attachments/photo"},
				{"/file/attachments/photo-extended/photo.txt", "/file/attachments/photo-extended/photo.txt"},
				{"photo photo-extended photo.txt\n保留我的原文", "photo photo-extended photo.txt\n保留我的原文"},
				{"https://external.example/file/attachments/photo/a.txt", "https://external.example/file/attachments/photo/a.txt"},
				{"//external.example/file/attachments/photo/a.txt", "//external.example/file/attachments/photo/a.txt"},
			} {
				require.Equal(t, pair[1], remap.fn(pair[0], map[string]string{"photo": "new-id"}), pair[0])
			}
		})
	}
}

func TestJournalRevisionRestoreWithdrawsExistingShares(t *testing.T) {
	s, ctx := newUploadTestService(t)
	e := echo.New()
	s.registerJournalShareRoutes(e.Group("/api/v1/journal"), e)
	memo, err := s.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "private before sharing", Visibility: v1pb.Visibility_PRIVATE}})
	require.NoError(t, err)
	_, err = s.UpdateMemo(ctx, &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: memo.Name, Content: "currently chosen for sharing", Visibility: v1pb.Visibility_PUBLIC}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content", "visibility"}}})
	require.NoError(t, err)
	legacy, err := s.CreateMemoShare(ctx, &v1pb.CreateMemoShareRequest{Parent: memo.Name})
	require.NoError(t, err)
	shares := []map[string]any{}
	for _, mode := range []string{"fixed", "dynamic"} {
		request := sharePreview(ctx, t, e, journalShareRequest{Mode: mode, Filter: journal.ShareFilter{Timezone: "UTC", MemoNames: []string{memo.Name}}})
		response := journalHTTP(ctx, t, e, http.MethodPost, "/api/v1/journal/shares", request)
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		var summary map[string]any
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &summary))
		shares = append(shares, summary)
		require.Contains(t, readShare(t, e, summary, "").Body.String(), "currently chosen for sharing")
	}
	uid := strings.TrimPrefix(memo.Name, "memos/")
	var versions struct {
		Revisions []journalrecord.Revision `json:"revisions"`
	}
	response := journalRecordRequest(ctx, s, http.MethodGet, "/memos/"+uid+"/revisions")
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &versions))
	require.Len(t, versions.Revisions, 1)
	response = journalRecordRequest(ctx, s, http.MethodPost, "/memos/"+uid+"/revisions/"+versions.Revisions[0].ID+"/restore")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	actual, err := s.GetMemo(ctx, &v1pb.GetMemoRequest{Name: memo.Name})
	require.NoError(t, err)
	require.Equal(t, "private before sharing", actual.Content)
	require.Equal(t, v1pb.Visibility_PRIVATE, actual.Visibility)
	legacyUID := legacy.Name[strings.LastIndexByte(legacy.Name, '/')+1:]
	grant, err := s.Store.GetMemoShare(ctx, &store.FindMemoShare{UID: &legacyUID})
	require.NoError(t, err)
	require.Nil(t, grant)
	for _, share := range shares {
		response = readShare(t, e, share, "")
		require.Equal(t, http.StatusOK, response.Code)
		require.Contains(t, response.Body.String(), `"items":[]`)
		require.NotContains(t, response.Body.String(), "private before sharing")
		require.NotContains(t, response.Body.String(), "currently chosen for sharing")
	}
}

type recoveryShareBarrierDriver struct {
	store.Driver
	beforeCreate  func()
	beforeRestore func()
	beforePause   func()
}

func (*recoveryShareBarrierDriver) Close() error { return nil }

func (d *recoveryShareBarrierDriver) PutJournalDocument(ctx context.Context, doc *store.JournalDocument, expected int64) (*store.JournalDocument, error) {
	if doc.Kind == "share" && expected == 0 {
		d.beforeCreate()
	}
	return d.Driver.PutJournalDocument(ctx, doc, expected)
}

func (d *recoveryShareBarrierDriver) CreateMemoShare(ctx context.Context, share *store.MemoShare) (*store.MemoShare, error) {
	d.beforeCreate()
	return d.Driver.CreateMemoShare(ctx, share)
}

func (d *recoveryShareBarrierDriver) ApplyMemoMutation(ctx context.Context, mutation *store.MemoMutation) error {
	if d.beforePause != nil && mutation.MemoUpdate == nil && len(mutation.RecordChecks) == 0 {
		d.beforePause()
	}
	if d.beforeRestore != nil && mutation.MemoUpdate != nil && mutation.MemoUpdate.Content != nil {
		d.beforeRestore()
	}
	for _, doc := range mutation.JournalDocuments {
		if doc.Document.Kind == "share" {
			d.beforeCreate()
			break
		}
	}
	return d.Driver.ApplyMemoMutation(ctx, mutation)
}

func TestJournalRestoreConflictsWhenSharingCommitsAfterWithdrawalScan(t *testing.T) {
	s, ctx := newUploadTestService(t)
	e := echo.New()
	s.registerJournalShareRoutes(e.Group("/api/v1/journal"), e)
	memo, err := s.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "old private version"}})
	require.NoError(t, err)
	_, err = s.UpdateMemo(ctx, &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: memo.Name, Content: "current approved version"}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}}})
	require.NoError(t, err)
	uid := strings.TrimPrefix(memo.Name, "memos/")
	var versions struct {
		Revisions []journalrecord.Revision `json:"revisions"`
	}
	response := journalRecordRequest(ctx, s, http.MethodGet, "/memos/"+uid+"/revisions")
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &versions))
	require.Len(t, versions.Revisions, 1)
	approval := sharePreview(ctx, t, e, journalShareRequest{Mode: "dynamic", Filter: journal.ShareFilter{Timezone: "UTC", MemoNames: []string{memo.Name}}})
	ready, resume := make(chan struct{}), make(chan struct{})
	wrapped := store.New(&recoveryShareBarrierDriver{Driver: s.Store.GetDriver(), beforeCreate: func() {}, beforeRestore: func() { close(ready); <-resume }}, s.Profile)
	s.Store = wrapped
	t.Cleanup(func() { require.NoError(t, wrapped.Close()) })
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		done <- journalRecordRequest(ctx, s, http.MethodPost, "/memos/"+uid+"/revisions/"+versions.Revisions[0].ID+"/restore")
	}()
	select {
	case <-ready:
	case <-time.After(5 * time.Second):
		t.Fatal("restoration did not reach commit after withdrawing shares")
	}
	published := journalHTTP(ctx, t, e, http.MethodPost, "/api/v1/journal/shares", approval)
	close(resume)
	response = <-done
	require.Equal(t, http.StatusOK, published.Code, published.Body.String())
	require.Equal(t, http.StatusConflict, response.Code, response.Body.String())
	actual, err := s.GetMemo(ctx, &v1pb.GetMemoRequest{Name: memo.Name})
	require.NoError(t, err)
	require.Equal(t, "current approved version", actual.Content)
	var summary map[string]any
	require.NoError(t, json.Unmarshal(published.Body.Bytes(), &summary))
	visible := readShare(t, e, summary, "")
	require.Contains(t, visible.Body.String(), "current approved version")
	require.NotContains(t, visible.Body.String(), "old private version")
}

func TestJournalRevisionRestoreRejectsShareCreatedFromStaleApproval(t *testing.T) {
	for _, kind := range []string{"dynamic", "legacy", "dynamic-trash", "legacy-trash"} {
		t.Run(kind, func(t *testing.T) {
			s, ctx := newUploadTestService(t)
			e := echo.New()
			s.registerJournalShareRoutes(e.Group("/api/v1/journal"), e)
			memo, err := s.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "NEVER SHARE RECOVERED OLD PRIVATE TEXT"}})
			require.NoError(t, err)
			_, err = s.UpdateMemo(ctx, &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: memo.Name, Content: "approved visible content"}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}}})
			require.NoError(t, err)
			uid := strings.TrimPrefix(memo.Name, "memos/")
			var versions struct {
				Revisions []journalrecord.Revision `json:"revisions"`
			}
			response := journalRecordRequest(ctx, s, http.MethodGet, "/memos/"+uid+"/revisions")
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &versions))
			require.Len(t, versions.Revisions, 1)
			approval := sharePreview(ctx, t, e, journalShareRequest{Mode: "dynamic", Filter: journal.ShareFilter{Timezone: "UTC", MemoNames: []string{memo.Name}}})
			ready, resume := make(chan struct{}), make(chan struct{})
			wrapped := store.New(&recoveryShareBarrierDriver{Driver: s.Store.GetDriver(), beforeCreate: func() { close(ready); <-resume }}, s.Profile)
			s.Store = wrapped
			t.Cleanup(func() { require.NoError(t, wrapped.Close()) })
			done := make(chan struct{})
			var published *httptest.ResponseRecorder
			var legacy *v1pb.MemoShare
			var publishErr error
			go func() {
				defer close(done)
				if strings.HasPrefix(kind, "dynamic") {
					published = journalHTTP(ctx, t, e, http.MethodPost, "/api/v1/journal/shares", approval)
				} else {
					legacy, publishErr = s.CreateMemoShare(ctx, &v1pb.CreateMemoShareRequest{Parent: memo.Name})
				}
			}()
			select {
			case <-ready:
			case <-time.After(5 * time.Second):
				t.Fatal("share creation did not reach commit barrier")
			}
			withdrawn := "NEVER SHARE RECOVERED OLD PRIVATE TEXT"
			if strings.HasSuffix(kind, "-trash") {
				removed := journalRecordRequest(ctx, s, http.MethodPost, "/memos/"+uid+"/trash")
				require.Equal(t, http.StatusOK, removed.Code, removed.Body.String())
				response = journalRecordRequest(ctx, s, http.MethodPost, "/trash/"+uid+"/restore")
				withdrawn = "approved visible content"
			} else {
				response = journalRecordRequest(ctx, s, http.MethodPost, "/memos/"+uid+"/revisions/"+versions.Revisions[0].ID+"/restore")
			}
			close(resume)
			<-done
			require.Equal(t, http.StatusOK, response.Code, response.Body.String())
			if strings.HasPrefix(kind, "dynamic") {
				if published.Code == http.StatusConflict {
					return
				}
				require.Equal(t, http.StatusOK, published.Code, published.Body.String())
				var summary map[string]any
				require.NoError(t, json.Unmarshal(published.Body.Bytes(), &summary))
				visible := readShare(t, e, summary, "")
				require.NotContains(t, visible.Body.String(), withdrawn)
			} else {
				if publishErr != nil {
					require.Equal(t, codes.Aborted, status.Code(publishErr))
					return
				}
				token := legacy.Name[strings.LastIndexByte(legacy.Name, '/')+1:]
				visible, err := s.GetSharedMemo(context.Background(), &v1pb.GetSharedMemoRequest{ShareToken: token})
				if err == nil {
					require.NotContains(t, visible.Content, withdrawn)
				}
			}
		})
	}
}

func TestJournalRevisionRestoreStopsWorkerAcrossBodyRead(t *testing.T) {
	require.NoError(t, webhook.ConfigurePrivateDestinationAllowlist([]string{"127.0.0.1"}))
	t.Cleanup(func() { require.NoError(t, webhook.ConfigurePrivateDestinationAllowlist(nil)) })
	for _, stage := range []string{"before body", "after body"} {
		t.Run(stage, func(t *testing.T) {
			s, ctx := newUploadTestService(t)
			owner, err := s.fetchCurrentUser(ctx)
			require.NoError(t, err)
			s.JournalPartitions = partition.New(s.Store, s.readPartitionMemo)
			ps := s.JournalPartitions
			p, err := ps.SavePartition(ctx, owner.ID, &partition.Partition{Name: "worker race"})
			require.NoError(t, err)
			_, err = ps.SaveTarget(ctx, owner.ID, &partition.Target{PartitionID: p.ID, Name: "synthetic", URL: "http://127.0.0.1:1/synthetic", Enabled: true, AutoUpdate: true, Fields: partition.Fields{Content: true, Media: true}})
			require.NoError(t, err)
			memo, err := s.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "old private version"}})
			require.NoError(t, err)
			_, err = s.UpdateMemo(ctx, &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: memo.Name, Content: "approved pending version"}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}}, JournalPartition: &v1pb.JournalPartitionSelection{PartitionId: p.ID}})
			require.NoError(t, err)
			uid := strings.TrimPrefix(memo.Name, "memos/")
			var versions struct {
				Revisions []journalrecord.Revision `json:"revisions"`
			}
			response := journalRecordRequest(ctx, s, http.MethodGet, "/memos/"+uid+"/revisions")
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &versions))
			require.Len(t, versions.Revisions, 1)
			entered, resume := make(chan struct{}), make(chan struct{})
			read := ps.ReadMemo
			ps.ReadMemo = func(readCtx context.Context, actor int32, id string, media bool) (*partition.Memo, error) {
				if !media {
					return read(readCtx, actor, id, media)
				}
				if stage == "before body" {
					close(entered)
					<-resume
					return read(readCtx, actor, id, media)
				}
				value, readErr := read(readCtx, actor, id, media)
				close(entered)
				<-resume
				return value, readErr
			}
			var sent atomic.Int32
			ps.Send = func(context.Context, *webhook.Request) (*webhook.DeliveryReceipt, error) {
				sent.Add(1)
				return &webhook.DeliveryReceipt{StatusCode: http.StatusNoContent}, nil
			}
			done := make(chan error, 1)
			go func() { done <- ps.ProcessDue(ctx) }()
			select {
			case <-entered:
			case <-time.After(5 * time.Second):
				t.Fatal("worker did not reach body-read boundary")
			}
			response = journalRecordRequest(ctx, s, http.MethodPost, "/memos/"+uid+"/revisions/"+versions.Revisions[0].ID+"/restore")
			close(resume)
			workerErr := <-done
			if workerErr != nil {
				require.ErrorIs(t, workerErr, context.Canceled)
			}
			require.Equal(t, http.StatusOK, response.Code, response.Body.String())
			require.NoError(t, ps.ProcessDue(ctx))
			require.Zero(t, sent.Load(), "the suspended worker must not send either cached or newly restored bytes")
		})
	}
}

func TestJournalRevisionRestoreKeepsAttachmentUIDBoundaries(t *testing.T) {
	s, ctx := newUploadTestService(t)
	photos := make([]*v1pb.Attachment, 0, 2)
	for _, uid := range []string{"photo", "photo-extended"} {
		attachment, err := s.CreateAttachment(ctx, &v1pb.CreateAttachmentRequest{AttachmentId: uid, Attachment: &v1pb.Attachment{Filename: uid + ".txt", Type: "text/plain", Content: []byte("original bytes for " + uid)}})
		require.NoError(t, err)
		photos = append(photos, attachment)
	}
	body := "first [photo](/file/attachments/photo/photo.txt)\nsecond [extended](/file/attachments/photo-extended/photo-extended.txt)"
	memo, err := s.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: body, Attachments: photos}})
	require.NoError(t, err)
	_, err = s.UpdateMemo(ctx, &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: memo.Name, Content: "without attachments"}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content", "attachments"}}})
	require.NoError(t, err)
	uid := strings.TrimPrefix(memo.Name, "memos/")
	var versions struct {
		Revisions []journalrecord.Revision `json:"revisions"`
	}
	response := journalRecordRequest(ctx, s, http.MethodGet, "/memos/"+uid+"/revisions")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &versions))
	require.Len(t, versions.Revisions, 1)
	response = journalRecordRequest(ctx, s, http.MethodPost, "/memos/"+uid+"/revisions/"+versions.Revisions[0].ID+"/restore")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	actual, err := s.GetMemo(ctx, &v1pb.GetMemoRequest{Name: memo.Name})
	require.NoError(t, err)
	require.Len(t, actual.Attachments, 2)
	for _, attachment := range actual.Attachments {
		require.Contains(t, actual.Content, "/file/"+attachment.Name+"/"+attachment.Filename)
		id := strings.TrimPrefix(attachment.Name, "attachments/")
		stored, err := s.Store.GetAttachment(ctx, &store.FindAttachment{UID: &id})
		require.NoError(t, err)
		bytes, err := s.GetAttachmentBlob(ctx, stored)
		require.NoError(t, err)
		require.Equal(t, "original bytes for "+strings.TrimSuffix(attachment.Filename, ".txt"), string(bytes))
	}
}
