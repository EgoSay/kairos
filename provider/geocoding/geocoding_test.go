package geocoding

import (
	"context"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestGeocodingIdentityCachingRateAndWGS84(t *testing.T) {
	var mu sync.Mutex
	times := []time.Time{}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		times = append(times, time.Now())
		mu.Unlock()
		if !strings.Contains(r.UserAgent(), "github.com/EgoSay/kairos") || r.URL.Query().Get("accept-language") != "zh-CN,zh,en" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/reverse" {
			if r.URL.Query().Get("lat") != "0.000000" || r.URL.Query().Get("lon") != "0.000000" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			_, _ = io.WriteString(w, `{"name":"附近对象","display_name":"附近对象名称","lat":"0.001","lon":"0.001"}`)
		} else {
			_, _ = io.WriteString(w, `[{"name":"人民公园","display_name":"人民公园, 上海","lat":"31.23","lon":"121.47"}]`)
		}
	}))
	t.Cleanup(server.Close)
	client := NewClient(server.URL)
	client.http = server.Client()
	require.Equal(t, 1100*time.Millisecond, client.interval)
	client.interval = 30 * time.Millisecond
	first, err := client.Search(context.Background(), "上海 人民公园")
	require.NoError(t, err)
	require.Equal(t, 31.23, first[0].Latitude)
	first[0].Name = "changed by caller"
	cached, err := client.Search(context.Background(), "上海 人民公园")
	require.NoError(t, err)
	require.Equal(t, "人民公园", cached[0].Name)
	_, err = client.Reverse(context.Background(), 0, 0)
	require.NoError(t, err)
	mu.Lock()
	defer mu.Unlock()
	require.Len(t, times, 2)
	require.GreaterOrEqual(t, times[1].Sub(times[0]), 25*time.Millisecond)
}

func TestGeocodingFailureIsNotAnEmptySuccessOrCached(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = io.WriteString(w, `[]`)
	}))
	t.Cleanup(server.Close)
	client := NewClient(server.URL)
	client.http = server.Client()
	client.interval = 0
	_, err := client.Search(context.Background(), "上海公园")
	require.Error(t, err)
	result, err := client.Search(context.Background(), "上海公园")
	require.NoError(t, err)
	require.Empty(t, result)
	require.EqualValues(t, 2, calls.Load())
	_, err = client.Reverse(context.Background(), math.NaN(), 0)
	require.Error(t, err)
	require.EqualValues(t, 2, calls.Load())
	client.gate <- struct{}{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = client.Search(ctx, "另一个地点")
	require.ErrorIs(t, err, context.Canceled)
	<-client.gate
}
