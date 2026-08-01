import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadLocalEnvironment } from "@/local/environment";

loadLocalEnvironment();

const databaseModule = await import("@/server/db/client");
const conversationService = await import("@/server/conversations/service");
const agentService = await import("@/server/agents/service");
const providerService = await import("@/server/providers/service");

const server = new McpServer({ name: "relay", version: "0.1.0" });

server.registerTool(
  "relay_bootstrap_codex_team",
  {
    description: "Create Relay's local Codex MCP connection and a balanced three-agent team without API keys.",
    inputSchema: {}
  },
  async () => toolResult(async () => {
    const workspaceId = await resolveWorkspaceId();
    const existingConnections = await providerService.listProviderConnections(workspaceId);
    const connection = existingConnections.find((candidate) => candidate.kind === "local_codex")
      ?? await providerService.createProviderConnection(workspaceId, {
        name: "Local Codex",
        kind: "local_codex",
        protocol: "codex_mcp",
        baseUrl: "local://codex",
        credential: ""
      });
    const existingAgents = await agentService.listAgents(workspaceId);
    const definitions = [
      {
        name: "Codex Explorer",
        roles: ["draft", "review"] as const,
        instructions: "Develop an independent solution, surface assumptions, and explore viable alternatives.",
        color: "#58d6ff"
      },
      {
        name: "Codex Critic",
        roles: ["draft", "review"] as const,
        instructions: "Challenge claims, find failure modes, and demand concrete evidence before accepting a result.",
        color: "#ef7cac"
      },
      {
        name: "Codex Synthesizer",
        roles: ["draft", "review", "synthesize"] as const,
        instructions: "Reconcile the strongest ideas and critiques into one precise, actionable result.",
        color: "#c7ff5b"
      }
    ];

    for (const definition of definitions) {
      if (existingAgents.some((agent) => agent.name === definition.name)) {
        continue;
      }

      await agentService.createAgent(workspaceId, {
        name: definition.name,
        model: "default",
        connectionId: connection.id,
        roles: [...definition.roles],
        instructions: definition.instructions,
        enabled: true,
        color: definition.color,
        parameters: {}
      });
    }

    return {
      connection,
      agents: await agentService.listAgents(workspaceId)
    };
  })
);

server.registerTool(
  "relay_status",
  {
    description: "List Relay's local agents and sessions, including current run state.",
    inputSchema: {}
  },
  async () => toolResult(async () => {
    const workspaceId = await resolveWorkspaceId();
    const [agents, sessions] = await Promise.all([
      agentService.listAgents(workspaceId),
      conversationService.listConversations(workspaceId)
    ]);
    return { workspaceId, agents, sessions };
  })
);

server.registerTool(
  "relay_get_session",
  {
    description: "Read one Relay session with its agents, rounds, drafts, reviews, and synthesis.",
    inputSchema: {
      conversationId: z.string().uuid().describe("Relay conversation ID")
    }
  },
  async ({ conversationId }) => toolResult(async () => {
    return conversationService.getConversation(await resolveWorkspaceId(), conversationId);
  })
);

server.registerTool(
  "relay_create_session",
  {
    description: "Create and optionally start a continuous peer-review session using local Codex agents.",
    inputSchema: {
      title: z.string().trim().min(1).max(160),
      objective: z.string().trim().min(1).max(40_000),
      agentIds: z.array(z.string().uuid()).min(2).max(32).optional(),
      synthesizerAgentId: z.string().uuid().optional(),
      reviewTopology: z.enum(["all_to_all", "round_robin"]).default("all_to_all"),
      maxIterations: z.number().int().positive().max(1_000_000).nullable().default(null),
      startImmediately: z.boolean().default(true)
    }
  },
  async (input) => toolResult(async () => {
    const workspaceId = await resolveWorkspaceId();
    const availableAgents = await agentService.listAgents(workspaceId);
    const agentIds = input.agentIds ?? availableAgents.filter((agent) => agent.enabled).map((agent) => agent.id);

    if (agentIds.length < 2) {
      throw new Error("Relay needs at least two enabled agents before a session can start");
    }

    const conversation = await conversationService.createConversation(workspaceId, {
      title: input.title,
      objective: input.objective,
      agentIds
    });

    if (!input.startImmediately) {
      return conversation;
    }

    const run = await conversationService.startConversationRun(workspaceId, conversation.id, {
      synthesizerAgentId: input.synthesizerAgentId,
      reviewTopology: input.reviewTopology,
      maxIterations: input.maxIterations,
      maxTotalTokens: null
    });
    return { conversation, run };
  })
);

server.registerTool(
  "relay_pause_run",
  {
    description: "Pause a Relay run at its next safe checkpoint.",
    inputSchema: { runId: z.string().uuid() }
  },
  async ({ runId }) => toolResult(async () => {
    return conversationService.changeRunState(await resolveWorkspaceId(), runId, "pause");
  })
);

server.registerTool(
  "relay_resume_run",
  {
    description: "Resume a paused Relay run.",
    inputSchema: { runId: z.string().uuid() }
  },
  async ({ runId }) => toolResult(async () => {
    return conversationService.changeRunState(await resolveWorkspaceId(), runId, "resume");
  })
);

server.registerTool(
  "relay_stop_run",
  {
    description: "Stop a Relay run gracefully or immediately.",
    inputSchema: {
      runId: z.string().uuid(),
      mode: z.enum(["graceful", "immediate"]).default("graceful")
    }
  },
  async ({ runId, mode }) => toolResult(async () => {
    return conversationService.changeRunState(await resolveWorkspaceId(), runId, "stop", { mode });
  })
);

server.registerTool(
  "relay_add_instruction",
  {
    description: "Queue an operator instruction for the next round of a Relay run.",
    inputSchema: {
      runId: z.string().uuid(),
      instruction: z.string().trim().min(1).max(20_000)
    }
  },
  async ({ runId, instruction }) => toolResult(async () => {
    const pendingInstruction = await conversationService.addRunInstruction(
      await resolveWorkspaceId(),
      runId,
      instruction
    );
    return { pendingInstruction };
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

async function resolveWorkspaceId(): Promise<string> {
  if (process.env.RELAY_WORKSPACE_ID) {
    return z.string().uuid().parse(process.env.RELAY_WORKSPACE_ID);
  }

  const workspaces = await databaseModule.getDatabase()<Array<{ id: string }>>`
    SELECT id FROM workspaces ORDER BY created_at, id LIMIT 2
  `;

  if (workspaces.length === 0) {
    throw new Error("Relay has no workspace. Sign in to the local UI once, then retry.");
  }

  if (workspaces.length > 1) {
    throw new Error("Multiple Relay workspaces exist. Configure RELAY_WORKSPACE_ID for this MCP server.");
  }

  return workspaces[0].id;
}

async function toolResult(work: () => Promise<unknown>) {
  try {
    const value = await work();
    return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Relay tool failed";
    return { isError: true, content: [{ type: "text" as const, text: message }] };
  }
}

async function shutdown(): Promise<void> {
  await databaseModule.closeDatabase();
  await server.close();
}
