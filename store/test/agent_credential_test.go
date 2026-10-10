package test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"

	storepb "github.com/EgoSay/kairos/proto/gen/store"
)

func TestAgentCredentialScopeSurvivesStorageAndUsageUpdates(t *testing.T) {
	ctx := context.Background()
	s := NewTestingStore(ctx, t)
	defer s.Close()
	user, err := createTestingHostUser(ctx, s)
	require.NoError(t, err)
	expires := timestamppb.New(time.Now().Add(time.Hour))
	require.NoError(t, s.AddUserPersonalAccessToken(ctx, user.ID, &storepb.PersonalAccessTokensUserSetting_PersonalAccessToken{TokenId: "agent", TokenHash: "synthetic-agent-hash", ReadOnly: true, ExpiresAt: expires}))
	require.NoError(t, s.AddUserPersonalAccessToken(ctx, user.ID, &storepb.PersonalAccessTokensUserSetting_PersonalAccessToken{TokenId: "legacy", TokenHash: "synthetic-legacy-hash"}))
	agent, err := s.GetUserByPATHash(ctx, "synthetic-agent-hash")
	require.NoError(t, err)
	require.True(t, agent.PAT.ReadOnly)
	require.Equal(t, expires.AsTime(), agent.PAT.ExpiresAt.AsTime())
	require.NoError(t, s.UpdatePATLastUsed(ctx, user.ID, "agent", timestamppb.Now()))
	agent, err = s.GetUserByPATHash(ctx, "synthetic-agent-hash")
	require.NoError(t, err)
	require.True(t, agent.PAT.ReadOnly)
	require.NotNil(t, agent.PAT.LastUsedAt)
	legacy, err := s.GetUserByPATHash(ctx, "synthetic-legacy-hash")
	require.NoError(t, err)
	require.False(t, legacy.PAT.ReadOnly)
	require.NoError(t, s.RemoveUserPersonalAccessToken(ctx, user.ID, "agent"))
	_, err = s.GetUserByPATHash(ctx, "synthetic-agent-hash")
	require.Error(t, err)
	_, err = s.GetUserByPATHash(ctx, "synthetic-legacy-hash")
	require.NoError(t, err)
}
