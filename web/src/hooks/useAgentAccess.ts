import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userServiceClient } from "@/connect";
import useCurrentUser from "@/hooks/useCurrentUser";

export async function createAgentCredential(parent: string, description: string, expiresInDays: number) {
  const response = await userServiceClient.createPersonalAccessToken({
    parent,
    description: description.trim(),
    expiresInDays,
    readOnly: true,
  });
  if (!response.personalAccessToken?.readOnly || !response.token.startsWith("kairos_agent_")) {
    // A cached UI talking to an older server must not present a legacy full PAT as an Agent credential.
    if (response.personalAccessToken?.name) {
      try {
        await userServiceClient.deletePersonalAccessToken({ name: response.personalAccessToken.name });
      } catch {
        throw new Error("服务版本不支持只读授权，且自动撤销失败。请在访问令牌设置中撤销刚创建的凭据后更新服务。");
      }
    }
    throw new Error("服务版本不支持只读授权，未展示该凭据。请更新服务并检查访问令牌列表后重试。");
  }
  return response;
}

export function useAgentAccess() {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const queryKey = ["agent-access", user?.name];
  const tokens = useQuery({
    queryKey,
    enabled: !!user?.name,
    queryFn: async () =>
      (await userServiceClient.listPersonalAccessTokens({ parent: user!.name })).personalAccessTokens.filter((token) => token.readOnly),
    refetchInterval: 15_000,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const create = useMutation({
    mutationFn: ({ description, expiresInDays }: { description: string; expiresInDays: number }) =>
      createAgentCredential(user!.name, description, expiresInDays),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: (name: string) => userServiceClient.deletePersonalAccessToken({ name }),
    onSuccess: refresh,
  });
  return { tokens, create, revoke };
}
