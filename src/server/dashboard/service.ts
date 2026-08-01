import type { DashboardPayload, Viewer } from "@/lib/contracts";
import { listAgents } from "@/server/agents/service";
import { listConversations } from "@/server/conversations/service";
import { listProviderConnections } from "@/server/providers/service";

export async function getDashboard(viewer: Viewer): Promise<DashboardPayload> {
  const [conversations, agents, connections] = await Promise.all([
    listConversations(viewer.workspaceId),
    listAgents(viewer.workspaceId),
    listProviderConnections(viewer.workspaceId)
  ]);

  return { viewer, conversations, agents, connections };
}
