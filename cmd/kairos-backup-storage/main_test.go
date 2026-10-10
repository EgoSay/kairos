package main

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
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
