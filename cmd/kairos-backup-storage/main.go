// Kairos backup storage performs bounded S3 operations for the host backup agent.
// Credentials arrive on stdin, never command arguments or output. It exposes no
// server, shell, repository deletion, or arbitrary local file operations.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/pkg/errors"
	"google.golang.org/protobuf/encoding/protojson"

	storepb "github.com/EgoSay/kairos/proto/gen/store"
	storage "github.com/EgoSay/kairos/provider/storage/s3"
)

type request struct {
	Action string          `json:"action"`
	Config json.RawMessage `json:"config"`
	Key    string          `json:"key"`
	Prefix string          `json:"prefix"`
}

func execute(ctx context.Context, input io.Reader, output io.Writer) error {
	var req request
	decoder := json.NewDecoder(io.LimitReader(input, 65537))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		return errors.Wrap(err, "invalid request")
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return errors.New("one request required")
	}
	if req.Action != "probe" && req.Action != "fetch" {
		return errors.New("unsupported operation")
	}
	var config storepb.StorageS3Config
	if err := protojson.Unmarshal(req.Config, &config); err != nil {
		return errors.Wrap(err, "invalid storage configuration")
	}
	endpoint, err := url.Parse(config.Endpoint)
	if err != nil || endpoint.Scheme != "https" || endpoint.Hostname() == "" || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" || config.InsecureSkipTlsVerify {
		return errors.New("a verified HTTPS S3 endpoint is required")
	}
	if config.Bucket == "" || strings.ContainsAny(config.Bucket, "/\\") {
		return errors.New("invalid bucket")
	}
	driver, err := storage.NewDriver(ctx, &config)
	if err != nil {
		return err
	}
	if req.Action == "fetch" {
		if req.Key == "" {
			return errors.New("object key required")
		}
		stream, err := driver.GetObjectStream(ctx, req.Key, "")
		if err != nil {
			return err
		}
		defer stream.Body.Close()
		const limit = 2 << 30
		n, err := io.Copy(output, io.LimitReader(stream.Body, limit+1))
		if err != nil {
			return errors.Wrap(err, "object read failed")
		}
		if n > limit {
			return errors.New("object exceeds backup size limit")
		}
		return nil
	}
	var token [32]byte
	if _, err := rand.Read(token[:]); err != nil {
		return errors.Wrap(err, "random probe unavailable")
	}
	key := strings.Trim(req.Prefix, "/") + "/.kairos-probe-" + hex.EncodeToString(token[:16])
	if _, err := driver.UploadObject(ctx, key, "application/octet-stream", bytes.NewReader(token[:])); err != nil {
		return err
	}
	// Cleanup has an independent deadline, including after a failed read.
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = driver.DeleteObject(cleanup, key)
	}()
	got, err := driver.GetObject(ctx, key)
	if err != nil {
		return err
	}
	if !bytes.Equal(got, token[:]) {
		return errors.New("probe checksum mismatch")
	}
	if err := driver.DeleteObject(ctx, key); err != nil {
		return err
	}
	_, err = io.WriteString(output, "{\"status\":\"connected\",\"readWriteVerified\":true,\"temporaryObjectRemoved\":true}\n")
	return errors.Wrap(err, "probe result failed")
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	err := execute(ctx, os.Stdin, os.Stdout)
	cancel()
	if err != nil {
		// SDK errors can contain private endpoint/query material. Keep the UI error
		// actionable without printing raw errors or credentials.
		_, _ = os.Stderr.WriteString("S3 operation failed: check endpoint, region, credentials, read/write/delete permissions and network connectivity\n")
		os.Exit(1)
	}
}
