package v1

import (
	"context"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"
	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"

	v1pb "github.com/EgoSay/kairos/proto/gen/api/v1"
	"github.com/EgoSay/kairos/proto/gen/api/v1/apiv1connect"
	"github.com/EgoSay/kairos/store"
)

func TestAgentCredentialRealConnectGRPCAndGRPCWeb(t *testing.T) {
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(context.Background(), t, svc, "protocol-owner", store.RoleAdmin)
	ctx := userCtx(context.Background(), owner.ID)
	router := echo.New()
	workerCtx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	require.NoError(t, svc.RegisterGateway(workerCtx, router))
	server := httptest.NewUnstartedServer(router)
	server.EnableHTTP2 = true
	server.StartTLS()
	t.Cleanup(server.Close)
	for _, protocol := range []struct {
		name string
		opts []connect.ClientOption
	}{{name: "Connect"}, {name: "gRPC", opts: []connect.ClientOption{connect.WithGRPC()}}, {name: "gRPCWeb", opts: []connect.ClientOption{connect.WithGRPCWeb()}}} {
		t.Run(protocol.name, func(t *testing.T) {
			token, err := svc.CreatePersonalAccessToken(ctx, &v1pb.CreatePersonalAccessTokenRequest{Parent: BuildUserName(owner.Username), Description: protocol.name, ExpiresInDays: 1, ReadOnly: true})
			require.NoError(t, err)
			authClient := apiv1connect.NewAuthServiceClient(server.Client(), server.URL, protocol.opts...)
			memoClient := apiv1connect.NewMemoServiceClient(server.Client(), server.URL, protocol.opts...)
			identity := connect.NewRequest(&v1pb.GetCurrentUserRequest{})
			identity.Header().Set("Authorization", "Bearer "+token.Token)
			me, err := authClient.GetCurrentUser(context.Background(), identity)
			require.NoError(t, err, "the protocol must work before asserting denied writes")
			require.Equal(t, BuildUserName(owner.Username), me.Msg.User.Name)
			create := connect.NewRequest(&v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "must never persist", Visibility: v1pb.Visibility_PRIVATE}})
			create.Header().Set("Authorization", "Bearer "+token.Token)
			_, err = memoClient.CreateMemo(context.Background(), create)
			require.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
			require.ErrorContains(t, err, "Agent credential permits owner-only journal reads")
			_, err = svc.DeletePersonalAccessToken(ctx, &v1pb.DeletePersonalAccessTokenRequest{Name: token.PersonalAccessToken.Name})
			require.NoError(t, err)
			_, err = authClient.GetCurrentUser(context.Background(), identity)
			require.Equal(t, connect.CodeUnauthenticated, connect.CodeOf(err), "revocation must be effective on the next request")
		})
	}
	memos, err := svc.Store.ListMemos(context.Background(), &store.FindMemo{CreatorID: &owner.ID})
	require.NoError(t, err)
	require.Empty(t, memos)
}
