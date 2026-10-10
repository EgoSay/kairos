package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/EgoSay/kairos/internal/version"
)

func TestRejectInvalidOrUnboundedStorageRequestsBeforeNetworkAccess(t *testing.T) {
	for _, input := range []string{
		`{"action":"delete","config":{}}`,
		`{"action":"probe","command":"shell","config":{}}`,
		`{"action":"probe","config":{"endpoint":"http://example.com","bucket":"private"}}`,
		`{"action":"probe","config":{"endpoint":"https://user:password@example.com","bucket":"private"}}`,
		`{"action":"probe","config":{"endpoint":"https://example.com/?token=private","bucket":"private"}}`,
		`{"action":"probe","config":{"endpoint":"https://example.com","bucket":"private","insecureSkipTlsVerify":true}}`,
		`{"action":"probe","config":{"endpoint":"https://example.com","bucket":"../private"}}`,
		`{} {}`,
	} {
		t.Run(input, func(t *testing.T) {
			var output bytes.Buffer
			require.Error(t, execute(context.Background(), strings.NewReader(input), &output))
			require.Empty(t, output.String())
		})
	}
}

func TestDeriveTagsUsesSourceParserWithoutStorageAccess(t *testing.T) {
	previous := version.Commit
	version.Commit = strings.Repeat("c", 40)
	t.Cleanup(func() { version.Commit = previous })
	content := "#人生/修行 #人生 #人生/修行 #Case #case `#ignore`\n\n```\n#ignored\n```"
	req := request{Action: "derive-tags", SnapshotID: strings.Repeat("a", 64), SourceDatabaseSHA256: strings.Repeat("b", 64),
		Records: []sourceRecord{{ID: 1, Content: content}, {ID: 2, Content: "plain"}}}
	raw, err := json.Marshal(req)
	require.NoError(t, err)
	var output bytes.Buffer
	require.NoError(t, execute(context.Background(), bytes.NewReader(raw), &output))
	var got struct {
		ParserCommit         string           `json:"parserCommit"`
		SnapshotID           string           `json:"snapshotId"`
		SourceDatabaseSHA256 string           `json:"sourceDatabaseSha256"`
		Records              []tagIndexRecord `json:"records"`
	}
	require.NoError(t, json.Unmarshal(output.Bytes(), &got))
	require.Equal(t, req.SnapshotID, got.SnapshotID)
	require.Equal(t, req.SourceDatabaseSHA256, got.SourceDatabaseSHA256)
	require.Equal(t, version.Commit, got.ParserCommit)
	require.Equal(t, []string{"人生/修行", "人生", "Case", "case"}, got.Records[0].ExpectedExactTags)
	require.Equal(t, []string{}, got.Records[1].ExpectedExactTags)
	digest := sha256.Sum256([]byte(content))
	require.Equal(t, hex.EncodeToString(digest[:]), got.Records[0].ContentSHA256)
	require.NotContains(t, output.String(), "#ignored")
	for _, invalid := range []request{
		{Action: "derive-tags", SnapshotID: "bad"},
		{Action: "derive-tags", SnapshotID: req.SnapshotID, SourceDatabaseSHA256: req.SourceDatabaseSHA256, Config: json.RawMessage(`{}`)},
		{Action: "derive-tags", SnapshotID: req.SnapshotID, SourceDatabaseSHA256: req.SourceDatabaseSHA256, Records: []sourceRecord{{ID: 1}, {ID: 1}}},
	} {
		raw, err := json.Marshal(invalid)
		require.NoError(t, err)
		output.Reset()
		require.Error(t, execute(context.Background(), bytes.NewReader(raw), &output))
		require.Empty(t, output.String())
	}
}
