package v1

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	"github.com/EgoSay/kairos/core/journal"
	"github.com/EgoSay/kairos/core/journalbackup"
	"github.com/EgoSay/kairos/core/journalrecord"
	v1pb "github.com/EgoSay/kairos/proto/gen/api/v1"
	"github.com/EgoSay/kairos/store"
)

func TestJournalBackupNameOnlyLocationsOwnerScopeAndHistory(t *testing.T) {
	ctx := context.Background()
	source := newIntegrationService(t)
	owner := createSpaceTestUser(ctx, t, source, "place-backup-source", store.RoleUser)
	other := createSpaceTestUser(ctx, t, source, "place-backup-foreign", store.RoleUser)
	ownerCtx := userCtx(ctx, owner.ID)
	memo, err := source.CreateMemo(ownerCtx, &v1pb.CreateMemoRequest{MemoId: "place-backup-record", Memo: &v1pb.Memo{Content: "named place before", Visibility: v1pb.Visibility_PRIVATE, Location: &v1pb.Location{Placeholder: "家", NameOnly: true}}})
	require.NoError(t, err)
	_, err = source.UpdateMemo(ownerCtx, &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: memo.Name, Content: "named place after"}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}}})
	require.NoError(t, err)
	_, err = journal.SaveNamedPlaces(ctx, source.Store, owner.ID, journal.NamedPlaces{Places: []journal.NamedPlace{{ID: "home", Name: "家", NameOnly: true}, {ID: "origin", Name: "real origin"}}})
	require.NoError(t, err)
	_, err = journal.SaveNamedPlaces(ctx, source.Store, other.ID, journal.NamedPlaces{Places: []journal.NamedPlace{{ID: "private", Name: "NEVER_FOREIGN_PLACE", NameOnly: true}}})
	require.NoError(t, err)
	// Future/private fields in the document cannot hitch a ride in the portable
	// archive; only the typed place contract is exported.
	doc, err := source.Store.GetJournalDocument(ctx, owner.ID, "named-locations", "main")
	require.NoError(t, err)
	_, err = source.Store.PutJournalDocument(ctx, &store.JournalDocument{OwnerID: owner.ID, Kind: "named-locations", Key: "main", Payload: json.RawMessage(`[{"id":"home","name":"家","nameOnly":true,"privateToken":"NEVER_UNKNOWN_FIELD"},{"id":"origin","name":"real origin","latitude":0,"longitude":0}]`)}, doc.Version)
	require.NoError(t, err)
	var data bytes.Buffer
	require.NoError(t, source.writeJournalBackup(ownerCtx, owner, &data, true))
	archive, err := journalbackup.Read(bytes.NewReader(data.Bytes()), int64(data.Len()))
	require.NoError(t, err)
	require.NoError(t, validateJournalBackup(archive))
	var namedDoc *journalbackup.Document
	for index := range archive.Manifest.Documents {
		document := &archive.Manifest.Documents[index]
		require.NotContains(t, string(document.Payload), "NEVER_FOREIGN_PLACE")
		require.NotContains(t, string(document.Payload), "NEVER_UNKNOWN_FIELD")
		if document.Kind == "named-locations" {
			namedDoc = document
		}
	}
	require.NotNil(t, namedDoc, "favorite places must be included in the portable backup")
	require.JSONEq(t, `{"places":[{"id":"home","name":"家","nameOnly":true},{"id":"origin","name":"real origin","latitude":0,"longitude":0}],"version":0}`, string(namedDoc.Payload))
	sum := sha256.Sum256(data.Bytes())
	digest := hex.EncodeToString(sum[:])

	destination := newIntegrationService(t)
	createSpaceTestUser(ctx, t, destination, "unrelated-place-owner", store.RoleUser)
	restoredOwner := createSpaceTestUser(ctx, t, destination, "restored-place-owner", store.RoleUser)
	report, err := destination.restoreJournalBackup(ctx, restoredOwner, archive, digest)
	require.NoError(t, err)
	require.True(t, report.Complete)
	require.Empty(t, report.Warnings)
	places, err := journal.GetNamedPlaces(ctx, destination.Store, restoredOwner.ID)
	require.NoError(t, err)
	require.Len(t, places.Places, 2)
	require.True(t, places.Places[0].NameOnly)
	require.False(t, places.Places[1].NameOnly)
	require.EqualValues(t, 1, places.Version, "source CAS version is not imported")
	restored, err := destination.GetMemo(userCtx(ctx, restoredOwner.ID), &v1pb.GetMemoRequest{Name: memo.Name})
	require.NoError(t, err)
	require.True(t, restored.Location.NameOnly)
	require.Equal(t, "家", restored.Location.Placeholder)
	require.Equal(t, v1pb.Visibility_PRIVATE, restored.Visibility)
	revisions, err := destination.Store.ListJournalDocuments(ctx, &store.FindJournalDocument{OwnerID: &restoredOwner.ID, Kind: "revision"})
	require.NoError(t, err)
	require.NotEmpty(t, revisions)
	var revision journalrecord.Revision
	require.NoError(t, json.Unmarshal(revisions[0].Payload, &revision))
	var historical v1pb.Memo
	require.NoError(t, protojson.Unmarshal(revision.Memo, &historical))
	require.True(t, historical.Location.NameOnly)
	require.Equal(t, "家", historical.Location.Placeholder)
	require.Equal(t, BuildUserName(restoredOwner.Username), historical.Creator)
	_, err = destination.UpdateMemo(userCtx(ctx, restoredOwner.ID), &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: memo.Name, Content: "a later edit", Location: &v1pb.Location{Placeholder: "公园", Latitude: 31, Longitude: 121}}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content", "location"}}})
	require.NoError(t, err)
	response := journalRecordRequest(userCtx(ctx, restoredOwner.ID), destination, http.MethodPost, "/"+memo.Name+"/revisions/"+revision.ID+"/restore")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	restored, err = destination.GetMemo(userCtx(ctx, restoredOwner.ID), &v1pb.GetMemoRequest{Name: memo.Name})
	require.NoError(t, err)
	require.True(t, restored.Location.NameOnly)
	require.Equal(t, "家", restored.Location.Placeholder)
	require.Equal(t, "named place before", restored.Content)
	require.Equal(t, v1pb.Visibility_PRIVATE, restored.Visibility)

	// Retrying and importing into an existing collection retain the target's
	// choices. An archive cannot overwrite a separately edited favorite list.
	places.Places[0].Name = "现在的家"
	_, err = journal.SaveNamedPlaces(ctx, destination.Store, restoredOwner.ID, places)
	require.NoError(t, err)
	report, err = destination.restoreJournalBackup(ctx, restoredOwner, archive, digest)
	require.NoError(t, err)
	require.True(t, report.Complete)
	require.Contains(t, report.Warnings, "保留现有常用地点，备份中的 1 个地点未恢复。")
	places, err = journal.GetNamedPlaces(ctx, destination.Store, restoredOwner.ID)
	require.NoError(t, err)
	require.Equal(t, "现在的家", places.Places[0].Name)
	require.EqualValues(t, 2, places.Version)
	foreign, err := journal.GetNamedPlaces(ctx, destination.Store, restoredOwner.ID-1)
	require.NoError(t, err)
	require.Empty(t, foreign.Places)
}

func namedPlacesBackupArchive(t *testing.T, places []journal.NamedPlace) ([]byte, *journalbackup.Archive) {
	t.Helper()
	payload, err := json.Marshal(journal.NamedPlaces{Places: places})
	require.NoError(t, err)
	var data bytes.Buffer
	writer := journalbackup.NewWriter(&data)
	require.NoError(t, writer.Close(&journalbackup.Manifest{Documents: []journalbackup.Document{{Kind: "named-locations", Key: "main", Payload: payload}}}))
	archive, err := journalbackup.Read(bytes.NewReader(data.Bytes()), int64(data.Len()))
	require.NoError(t, err)
	return data.Bytes(), archive
}

func TestJournalBackupNamedPlacesPreservesExistingCollectionAndReportsOmissions(t *testing.T) {
	home := journal.NamedPlace{ID: "home", Name: "家", NameOnly: true}
	cafe := journal.NamedPlace{ID: "cafe", Name: "咖啡店", Latitude: 31, Longitude: 121}
	full := make([]journal.NamedPlace, 50)
	for i := range full {
		full[i] = journal.NamedPlace{ID: "place-" + strconv.Itoa(i), Name: "已有地点", NameOnly: true}
	}
	for _, test := range []struct {
		name     string
		existing []journal.NamedPlace
		backup   []journal.NamedPlace
		omitted  int
	}{
		{name: "different IDs", existing: []journal.NamedPlace{cafe}, backup: []journal.NamedPlace{home}, omitted: 1},
		{name: "same ID changed label", existing: []journal.NamedPlace{{ID: "home", Name: "现在的家", NameOnly: true}}, backup: []journal.NamedPlace{home}, omitted: 1},
		{name: "same ID changed coordinates", existing: []journal.NamedPlace{{ID: "cafe", Name: "咖啡店", Latitude: 32, Longitude: 121}}, backup: []journal.NamedPlace{cafe}, omitted: 1},
		{name: "name only differs from origin", existing: []journal.NamedPlace{{ID: "home", Name: "家"}}, backup: []journal.NamedPlace{home}, omitted: 1},
		{name: "partial overlap counts only missing places", existing: []journal.NamedPlace{home}, backup: []journal.NamedPlace{home, cafe}, omitted: 1},
		{name: "identical reordered", existing: []journal.NamedPlace{cafe, home}, backup: []journal.NamedPlace{home, cafe}},
		{name: "target includes every backup place", existing: []journal.NamedPlace{cafe, home}, backup: []journal.NamedPlace{home}},
		{name: "existing empty collection", existing: []journal.NamedPlace{}, backup: []journal.NamedPlace{home}, omitted: 1},
		{name: "full target collection", existing: full, backup: []journal.NamedPlace{home, cafe}, omitted: 2},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.Background()
			svc := newIntegrationService(t)
			owner := createSpaceTestUser(ctx, t, svc, "preserve-place-owner", store.RoleUser)
			_, err := journal.SaveNamedPlaces(ctx, svc.Store, owner.ID, journal.NamedPlaces{Places: test.existing})
			require.NoError(t, err)
			before, err := svc.Store.GetJournalDocument(ctx, owner.ID, "named-locations", "main")
			require.NoError(t, err)
			_, archive := namedPlacesBackupArchive(t, test.backup)
			for range 2 {
				report, err := svc.restoreJournalBackup(ctx, owner, archive, "preserve-place-archive")
				require.NoError(t, err)
				require.True(t, report.Complete, "complete describes the completed restore policy; omissions remain explicit warnings")
				require.Zero(t, report.Documents)
				if test.omitted == 0 {
					require.Empty(t, report.Warnings)
				} else {
					require.Equal(t, []string{"保留现有常用地点，备份中的 " + strconv.Itoa(test.omitted) + " 个地点未恢复。"}, report.Warnings)
				}
				after, err := svc.Store.GetJournalDocument(ctx, owner.ID, "named-locations", "main")
				require.NoError(t, err)
				require.Equal(t, before, after, "existing collection, order, and version must not change, including on retry")
			}
		})
	}
}

func TestJournalBackupNamedPlacesPreviewExplainsPreservation(t *testing.T) {
	svc := newIntegrationService(t)
	ctx := context.Background()
	owner := createSpaceTestUser(ctx, t, svc, "preview-places-owner", store.RoleUser)
	existing, err := journal.SaveNamedPlaces(ctx, svc.Store, owner.ID, journal.NamedPlaces{Places: []journal.NamedPlace{{ID: "cafe", Name: "咖啡店", NameOnly: true}}})
	require.NoError(t, err)
	e := echo.New()
	svc.registerJournalBackupRoutes(e.Group("/api/v1/journal"))
	data, _ := namedPlacesBackupArchive(t, []journal.NamedPlace{{ID: "home", Name: "家", NameOnly: true}})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/journal/backups/preview", bytes.NewReader(data)).WithContext(userCtx(ctx, owner.ID))
	response := httptest.NewRecorder()
	e.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var preview backupPreview
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &preview))
	require.Contains(t, preview.Warnings, "若已有常用地点，将保留现有集合，不合并或覆盖；未恢复的备份地点数量会列在恢复报告中。")
	for range 2 {
		response = journalHTTP(userCtx(ctx, owner.ID), t, e, http.MethodPost, "/api/v1/journal/backups/"+preview.Token+"/restore", map[string]string{"digest": preview.Digest})
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		var report backupReport
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &report))
		require.True(t, report.Complete)
		require.Zero(t, report.Documents)
		require.Equal(t, []string{"保留现有常用地点，备份中的 1 个地点未恢复。"}, report.Warnings)
	}
	actual, err := journal.GetNamedPlaces(ctx, svc.Store, owner.ID)
	require.NoError(t, err)
	require.Equal(t, existing, actual)
}

type backupNamedPlacesConcurrentDriver struct {
	store.Driver
	beforeCreate func()
}

func (*backupNamedPlacesConcurrentDriver) Close() error { return nil }

func (d *backupNamedPlacesConcurrentDriver) PutJournalDocument(ctx context.Context, document *store.JournalDocument, expected int64) (*store.JournalDocument, error) {
	if document.Kind == "named-locations" && expected == 0 && d.beforeCreate != nil {
		d.beforeCreate()
		d.beforeCreate = nil
	}
	return d.Driver.PutJournalDocument(ctx, document, expected)
}

func TestJournalBackupNamedPlacesCreationConflictPreservesConcurrentChoice(t *testing.T) {
	ctx := context.Background()
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(ctx, t, svc, "concurrent-places-owner", store.RoleUser)
	originalStore := svc.Store
	driver := &backupNamedPlacesConcurrentDriver{Driver: originalStore.GetDriver(), beforeCreate: func() {
		_, err := journal.SaveNamedPlaces(ctx, originalStore, owner.ID, journal.NamedPlaces{Places: []journal.NamedPlace{{ID: "cafe", Name: "刚添加的咖啡店", NameOnly: true}}})
		require.NoError(t, err)
	}}
	wrapped := store.New(driver, svc.Profile)
	t.Cleanup(func() { require.NoError(t, wrapped.Close()) })
	svc.Store = wrapped
	_, archive := namedPlacesBackupArchive(t, []journal.NamedPlace{{ID: "home", Name: "家", NameOnly: true}})
	report, err := svc.restoreJournalBackup(ctx, owner, archive, "concurrent-place-archive")
	require.NoError(t, err)
	require.True(t, report.Complete)
	require.Zero(t, report.Documents)
	require.Equal(t, []string{"保留现有常用地点，备份中的 1 个地点未恢复。"}, report.Warnings)
	places, err := journal.GetNamedPlaces(ctx, originalStore, owner.ID)
	require.NoError(t, err)
	require.EqualValues(t, 1, places.Version)
	require.Equal(t, []journal.NamedPlace{{ID: "cafe", Name: "刚添加的咖啡店", NameOnly: true}}, places.Places)
}

func TestJournalBackupRejectsInvalidNameOnlyBeforeMutation(t *testing.T) {
	ctx := context.Background()
	source := newIntegrationService(t)
	owner := createSpaceTestUser(ctx, t, source, "invalid-place-source", store.RoleUser)
	_, err := source.CreateMemo(userCtx(ctx, owner.ID), &v1pb.CreateMemoRequest{MemoId: "incoming-name", Memo: &v1pb.Memo{Content: "incoming", Location: &v1pb.Location{Placeholder: "家", NameOnly: true}}})
	require.NoError(t, err)
	var data bytes.Buffer
	require.NoError(t, source.writeJournalBackup(ctx, owner, &data, false))
	for _, payload := range []string{
		`{"places":[{"id":"home","name":"家","nameOnly":true,"latitude":1}]}`,
		`{"places":[{"id":"home","name":"家","nameOnly":true},{"id":"home","name":"咖啡店","nameOnly":true}]}`,
		`{"places":[{"id":"home","name":"  ","nameOnly":true}]}`,
	} {
		archive, err := journalbackup.Read(bytes.NewReader(data.Bytes()), int64(data.Len()))
		require.NoError(t, err)
		archive.Manifest.Documents = append(archive.Manifest.Documents, journalbackup.Document{Kind: "named-locations", Key: "main", Payload: json.RawMessage(payload)})
		destination := newIntegrationService(t)
		destOwner := createSpaceTestUser(ctx, t, destination, "invalid-place-target", store.RoleUser)
		putBackupTestDocument(t, destination, destOwner.ID, "share", "active-share", journal.Share{ID: "active-share", Paused: false})
		report, err := destination.restoreJournalBackup(ctx, destOwner, archive, "invalid-place-archive")
		require.Error(t, err)
		require.Zero(t, report.Memos)
		memos, err := destination.Store.ListMemos(ctx, &store.FindMemo{CreatorID: &destOwner.ID})
		require.NoError(t, err)
		require.Empty(t, memos)
		doc, err := destination.Store.GetJournalDocument(ctx, destOwner.ID, "share", "active-share")
		require.NoError(t, err)
		require.NotContains(t, string(doc.Payload), `"paused":true`)
	}
	archive, err := journalbackup.Read(bytes.NewReader(data.Bytes()), int64(data.Len()))
	require.NoError(t, err)
	archive.Manifest.Memos[0].Payload = json.RawMessage(`{"location":{"placeholder":"家","nameOnly":true,"latitude":31}}`)
	require.Error(t, validateJournalBackup(archive))
	archive.Manifest.Memos[0].Payload = json.RawMessage(`{"location":{"placeholder":"` + strings.Repeat("名", 201) + `","nameOnly":true}}`)
	require.Error(t, validateJournalBackup(archive))
}
