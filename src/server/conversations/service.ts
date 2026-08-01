import { randomUUID } from "node:crypto";
import type {
  AgentRole,
  AgentSummary,
  ArtifactSummary,
  ConversationDetail,
  ConversationSummary,
  IterationDetail,
  ProviderKind,
  RunDetail,
  RunPhase,
  RunStatus
} from "@/lib/contracts";
import { withWorkspace, type Queryable } from "@/server/db/client";
import { isDatabaseError } from "@/server/db/errors";
import { toJsonValue } from "@/server/db/json";
import { emitEvent } from "@/server/events/repository";
import { ApiError } from "@/server/http/errors";
import { enqueueRunReconciliation } from "@/server/runs/queue";
import type { StartRunInput, StopRunInput } from "@/server/runs/schemas";
import type { CreateConversationInput, UpdateConversationInput } from "@/server/conversations/schemas";

interface ConversationSummaryRow {
  id: string;
  title: string;
  objective: string;
  status: RunStatus | null;
  phase: RunPhase | null;
  current_iteration: number | null;
  agent_count: string | number;
  updated_at: Date | string;
  total_tokens: string | number | null;
}

interface ConversationRow extends ConversationSummaryRow {
  pending_instruction: string | null;
}

interface RunRow {
  id: string;
  conversation_id: string;
  status: RunStatus;
  desired_state: RunDetail["desiredState"];
  phase: RunPhase;
  current_iteration: number;
  synthesizer_agent_id: string;
  review_topology: RunDetail["reviewTopology"];
  max_iterations: number | null;
  max_total_tokens: string | number | null;
  total_input_tokens: string | number;
  total_output_tokens: string | number;
  consecutive_failures: number;
  stop_mode: RunDetail["stopMode"];
  control_version: string | number;
  started_at: Date | string | null;
  stopped_at: Date | string | null;
}

interface ConversationAgentRow {
  id: string;
  connection_id: string;
  name: string;
  model: string;
  provider_kind: ProviderKind;
  roles: AgentRole[];
  instructions: string;
  enabled: boolean;
  color: string;
  parameters: Record<string, unknown>;
  position: number;
  provider_id: string;
  provider_name: string;
  provider_protocol: "codex_mcp" | "local_cli" | "responses" | "chat_completions";
  provider_base_url: string;
  provider_status: "untested" | "healthy" | "unhealthy" | "disabled";
}

interface IterationRow {
  id: string;
  number: number;
  phase: RunPhase;
  status: IterationDetail["status"];
  synthesis: string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
}

interface ArtifactRow {
  id: string;
  iteration_id: string;
  kind: ArtifactSummary["kind"];
  agent_id: string | null;
  agent_name: string | null;
  target_agent_id: string | null;
  target_agent_name: string | null;
  content: string;
  status: ArtifactSummary["status"];
  latency_ms: number | null;
  input_tokens: number;
  output_tokens: number;
  created_at: Date | string;
}

const activeRunStatuses: RunStatus[] = [
  "created",
  "starting",
  "running",
  "pausing",
  "paused",
  "resuming",
  "stopping",
  "needs_attention"
];

function iso(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapSummary(row: ConversationSummaryRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    objective: row.objective,
    status: row.status ?? "idle",
    phase: row.phase ?? "idle",
    iteration: row.current_iteration ?? 0,
    agentCount: Number(row.agent_count),
    updatedAt: iso(row.updated_at) as string,
    totalTokens: Number(row.total_tokens ?? 0)
  };
}

function mapRun(row: RunRow): RunDetail {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    status: row.status,
    desiredState: row.desired_state,
    phase: row.phase,
    currentIteration: row.current_iteration,
    synthesizerAgentId: row.synthesizer_agent_id,
    reviewTopology: row.review_topology,
    maxIterations: row.max_iterations,
    maxTotalTokens: row.max_total_tokens === null ? null : Number(row.max_total_tokens),
    totalInputTokens: Number(row.total_input_tokens),
    totalOutputTokens: Number(row.total_output_tokens),
    consecutiveFailures: row.consecutive_failures,
    stopMode: row.stop_mode,
    startedAt: iso(row.started_at),
    stoppedAt: iso(row.stopped_at)
  };
}

function mapAgent(row: ConversationAgentRow): AgentSummary {
  return {
    id: row.id,
    name: row.name,
    model: row.model,
    providerKind: row.provider_kind,
    connectionId: row.connection_id,
    roles: row.roles,
    instructions: row.instructions,
    enabled: row.enabled,
    color: row.color,
    parameters: row.parameters
  };
}

function mapArtifact(row: ArtifactRow): ArtifactSummary {
  return {
    id: row.id,
    kind: row.kind,
    agentId: row.agent_id,
    agentName: row.agent_name ?? "System",
    targetAgentId: row.target_agent_id,
    targetAgentName: row.target_agent_name,
    content: row.content,
    status: row.status,
    latencyMs: row.latency_ms,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    createdAt: iso(row.created_at) as string
  };
}

async function summaryRows(transaction: Queryable, workspaceId: string, conversationId?: string): Promise<ConversationSummaryRow[]> {
  return transaction<ConversationSummaryRow[]>`
    SELECT
      c.id,
      c.title,
      c.objective,
      latest_run.status,
      latest_run.phase,
      latest_run.current_iteration,
      (SELECT count(*) FROM conversation_agents ca WHERE ca.conversation_id = c.id) AS agent_count,
      c.updated_at,
      COALESCE(latest_run.total_input_tokens + latest_run.total_output_tokens, 0) AS total_tokens
    FROM conversations c
    LEFT JOIN LATERAL (
      SELECT r.*
      FROM runs r
      WHERE r.workspace_id = c.workspace_id AND r.conversation_id = c.id
      ORDER BY r.created_at DESC
      LIMIT 1
    ) latest_run ON true
    WHERE c.workspace_id = ${workspaceId}
      AND (${conversationId ?? null}::uuid IS NULL OR c.id = ${conversationId ?? null})
    ORDER BY c.updated_at DESC, c.id
  `;
}

async function conversationAgents(
  transaction: Queryable,
  workspaceId: string,
  conversationId: string,
  lock = false
): Promise<ConversationAgentRow[]> {
  const rows = await transaction<ConversationAgentRow[]>`
    SELECT
      a.id,
      a.connection_id,
      a.name,
      a.model,
      p.kind AS provider_kind,
      a.roles,
      a.instructions,
      a.enabled,
      a.color,
      a.parameters,
      ca.position,
      p.id AS provider_id,
      p.name AS provider_name,
      p.protocol AS provider_protocol,
      p.base_url AS provider_base_url,
      p.status AS provider_status
    FROM conversation_agents ca
    JOIN agents a ON a.workspace_id = ca.workspace_id AND a.id = ca.agent_id
    JOIN provider_connections p ON p.workspace_id = a.workspace_id AND p.id = a.connection_id
    WHERE ca.workspace_id = ${workspaceId} AND ca.conversation_id = ${conversationId}
    ORDER BY ca.position
  `;

  if (lock) {
    await transaction`
      SELECT id FROM conversations
      WHERE workspace_id = ${workspaceId} AND id = ${conversationId}
      FOR UPDATE
    `;
  }

  return rows;
}

async function assertAgentSelection(
  transaction: Queryable,
  workspaceId: string,
  agentIds: string[]
): Promise<void> {
  const [{ count }] = await transaction<{ count: string }[]>`
    SELECT count(*)
    FROM agents a
    JOIN provider_connections p ON p.workspace_id = a.workspace_id AND p.id = a.connection_id
    WHERE a.workspace_id = ${workspaceId}
      AND a.id = ANY(${transaction.array(agentIds)}::uuid[])
      AND a.enabled
      AND p.status <> 'disabled'
  `;

  if (Number(count) !== agentIds.length) {
    throw new ApiError(400, "invalid_agents", "Every selected agent must exist, be enabled, and use an enabled provider");
  }
}

async function replaceConversationAgents(
  transaction: Queryable,
  workspaceId: string,
  conversationId: string,
  agentIds: string[]
): Promise<void> {
  await assertAgentSelection(transaction, workspaceId, agentIds);
  await transaction`
    DELETE FROM conversation_agents
    WHERE workspace_id = ${workspaceId} AND conversation_id = ${conversationId}
  `;

  for (const [position, agentId] of agentIds.entries()) {
    await transaction`
      INSERT INTO conversation_agents (workspace_id, conversation_id, agent_id, position)
      VALUES (${workspaceId}, ${conversationId}, ${agentId}, ${position})
    `;
  }
}

export async function listConversations(workspaceId: string): Promise<ConversationSummary[]> {
  return withWorkspace(workspaceId, async (transaction) => {
    return (await summaryRows(transaction, workspaceId)).map(mapSummary);
  });
}

export async function getConversation(workspaceId: string, conversationId: string): Promise<ConversationDetail> {
  return withWorkspace(workspaceId, async (transaction) => {
    const [conversation] = await transaction<ConversationRow[]>`
      SELECT
        c.*,
        latest_run.status,
        latest_run.phase,
        latest_run.current_iteration,
        (SELECT count(*) FROM conversation_agents ca WHERE ca.conversation_id = c.id) AS agent_count,
        COALESCE(latest_run.total_input_tokens + latest_run.total_output_tokens, 0) AS total_tokens
      FROM conversations c
      LEFT JOIN LATERAL (
        SELECT r.* FROM runs r
        WHERE r.workspace_id = c.workspace_id AND r.conversation_id = c.id
        ORDER BY r.created_at DESC LIMIT 1
      ) latest_run ON true
      WHERE c.workspace_id = ${workspaceId} AND c.id = ${conversationId}
    `;

    if (!conversation) {
      throw new ApiError(404, "conversation_not_found", "Conversation was not found");
    }

    const agents = await conversationAgents(transaction, workspaceId, conversationId);
    const [run] = await transaction<RunRow[]>`
      SELECT * FROM runs
      WHERE workspace_id = ${workspaceId} AND conversation_id = ${conversationId}
      ORDER BY created_at DESC LIMIT 1
    `;
    const iterationRows = run
      ? await transaction<IterationRow[]>`
          SELECT * FROM iterations
          WHERE workspace_id = ${workspaceId} AND run_id = ${run.id}
          ORDER BY number DESC
          LIMIT ${Number(process.env.CONVERSATION_ITERATION_LIMIT ?? 100)}
        `
      : [];
    const artifactRows = run && iterationRows.length > 0
      ? await transaction<ArtifactRow[]>`
          SELECT
            artifact.*,
            agent.name AS agent_name,
            target.name AS target_agent_name
          FROM artifacts artifact
          LEFT JOIN agents agent ON agent.workspace_id = artifact.workspace_id AND agent.id = artifact.agent_id
          LEFT JOIN agents target ON target.workspace_id = artifact.workspace_id AND target.id = artifact.target_agent_id
          WHERE artifact.workspace_id = ${workspaceId}
            AND artifact.iteration_id = ANY(${transaction.array(iterationRows.map((iteration) => iteration.id))}::uuid[])
          ORDER BY artifact.created_at, artifact.id
        `
      : [];
    const artifactsByIteration = new Map<string, ArtifactSummary[]>();

    for (const artifact of artifactRows) {
      const current = artifactsByIteration.get(artifact.iteration_id) ?? [];
      current.push(mapArtifact(artifact));
      artifactsByIteration.set(artifact.iteration_id, current);
    }

    return {
      ...mapSummary(conversation),
      run: run ? mapRun(run) : null,
      agents: agents.map(mapAgent),
      iterations: iterationRows.map((iteration) => ({
        id: iteration.id,
        number: iteration.number,
        phase: iteration.phase,
        status: iteration.status,
        synthesis: iteration.synthesis,
        artifacts: artifactsByIteration.get(iteration.id) ?? [],
        startedAt: iso(iteration.started_at),
        completedAt: iso(iteration.completed_at)
      })),
      pendingInstruction: conversation.pending_instruction
    };
  });
}

export async function createConversation(
  workspaceId: string,
  input: CreateConversationInput
): Promise<ConversationDetail> {
  const conversationId = await withWorkspace(workspaceId, async (transaction) => {
    await assertAgentSelection(transaction, workspaceId, input.agentIds);
    const [conversation] = await transaction<{ id: string }[]>`
      INSERT INTO conversations (workspace_id, title, objective)
      VALUES (${workspaceId}, ${input.title}, ${input.objective})
      RETURNING id
    `;

    if (!conversation) {
      throw new Error("Failed to create conversation");
    }

    await replaceConversationAgents(transaction, workspaceId, conversation.id, input.agentIds);
    await emitEvent(transaction, {
      workspaceId,
      conversationId: conversation.id,
      type: "conversation.created",
      payload: { title: input.title }
    });
    return conversation.id;
  });

  return getConversation(workspaceId, conversationId);
}

export async function updateConversation(
  workspaceId: string,
  conversationId: string,
  input: UpdateConversationInput
): Promise<ConversationDetail> {
  await withWorkspace(workspaceId, async (transaction) => {
    const [existing] = await transaction<{ title: string; objective: string }[]>`
      SELECT title, objective FROM conversations
      WHERE workspace_id = ${workspaceId} AND id = ${conversationId}
      FOR UPDATE
    `;

    if (!existing) {
      throw new ApiError(404, "conversation_not_found", "Conversation was not found");
    }

    if (input.agentIds) {
      const [activeRun] = await transaction<{ id: string }[]>`
        SELECT id FROM runs
        WHERE workspace_id = ${workspaceId}
          AND conversation_id = ${conversationId}
          AND status = ANY(${transaction.array(activeRunStatuses)}::text[])
        LIMIT 1
      `;

      if (activeRun) {
        throw new ApiError(409, "conversation_running", "Stop the active run before changing its agents");
      }
      await replaceConversationAgents(transaction, workspaceId, conversationId, input.agentIds);
    }

    await transaction`
      UPDATE conversations SET
        title = ${input.title ?? existing.title},
        objective = ${input.objective ?? existing.objective}
      WHERE workspace_id = ${workspaceId} AND id = ${conversationId}
    `;
    await emitEvent(transaction, {
      workspaceId,
      conversationId,
      type: "conversation.updated",
      payload: {}
    });
  });

  return getConversation(workspaceId, conversationId);
}

export async function deleteConversation(workspaceId: string, conversationId: string): Promise<void> {
  await withWorkspace(workspaceId, async (transaction) => {
    const [activeRun] = await transaction<{ id: string }[]>`
      SELECT id FROM runs
      WHERE workspace_id = ${workspaceId}
        AND conversation_id = ${conversationId}
        AND status = ANY(${transaction.array(activeRunStatuses)}::text[])
      LIMIT 1
    `;

    if (activeRun) {
      throw new ApiError(409, "conversation_running", "Stop the active run before deleting the conversation");
    }

    const result = await transaction`
      DELETE FROM conversations WHERE workspace_id = ${workspaceId} AND id = ${conversationId}
    `;

    if (result.count === 0) {
      throw new ApiError(404, "conversation_not_found", "Conversation was not found");
    }
  });
}

function selectSynthesizer(agents: ConversationAgentRow[], synthesizerAgentId?: string): string {
  if (agents.length < 2 || agents.some((agent) => !agent.enabled || agent.provider_status === "disabled")) {
    throw new ApiError(400, "invalid_agents", "A run needs at least two enabled agents with enabled providers");
  }

  const synthesizer = synthesizerAgentId
    ? agents.find((agent) => agent.id === synthesizerAgentId)
    : agents.find((agent) => agent.roles.includes("synthesize"));

  if (!synthesizer || !synthesizer.roles.includes("synthesize")) {
    throw new ApiError(400, "invalid_synthesizer", "The synthesizer must be a selected agent with the synthesize role");
  }

  const draftingAgents = agents.filter((agent) => agent.roles.includes("draft"));
  const reviewingAgents = agents.filter((agent) => agent.roles.includes("review"));
  const hasCrossReview = draftingAgents.some((draftingAgent) =>
    reviewingAgents.some((reviewingAgent) => reviewingAgent.id !== draftingAgent.id)
  );

  if (draftingAgents.length === 0 || !hasCrossReview) {
    throw new ApiError(400, "invalid_review_team", "The team needs a draft agent and a different review agent");
  }

  return synthesizer.id;
}

export async function startConversationRun(
  workspaceId: string,
  conversationId: string,
  input: StartRunInput
): Promise<RunDetail> {
  try {
    return await withWorkspace(workspaceId, async (transaction) => {
      const agents = await conversationAgents(transaction, workspaceId, conversationId, true);

      if (agents.length === 0) {
        throw new ApiError(404, "conversation_not_found", "Conversation was not found");
      }

      const synthesizerAgentId = selectSynthesizer(agents, input.synthesizerAgentId);
      const runId = randomUUID();
      const [run] = await transaction<RunRow[]>`
        INSERT INTO runs (
          id,
          workspace_id,
          conversation_id,
          synthesizer_agent_id,
          review_topology,
          max_iterations,
          max_total_tokens
        ) VALUES (
          ${runId},
          ${workspaceId},
          ${conversationId},
          ${synthesizerAgentId},
          ${input.reviewTopology},
          ${input.maxIterations ?? null},
          ${input.maxTotalTokens ?? null}
        )
        RETURNING *
      `;

      if (!run) {
        throw new Error("Failed to create run");
      }

      for (const agent of agents) {
        const snapshot = {
          id: agent.id,
          name: agent.name,
          model: agent.model,
          roles: agent.roles,
          instructions: agent.instructions,
          color: agent.color,
          parameters: agent.parameters,
          connectionId: agent.connection_id,
          provider: {
            id: agent.provider_id,
            name: agent.provider_name,
            kind: agent.provider_kind,
            protocol: agent.provider_protocol,
            baseUrl: agent.provider_base_url
          }
        };
        await transaction`
          INSERT INTO run_agents (run_id, workspace_id, agent_id, position, config_snapshot)
          VALUES (${runId}, ${workspaceId}, ${agent.id}, ${agent.position}, ${transaction.json(toJsonValue(snapshot))})
        `;
      }

      await enqueueRunReconciliation(transaction, {
        workspaceId,
        runId,
        controlVersion: 0,
        reason: "created"
      });
      await emitEvent(transaction, {
        workspaceId,
        conversationId,
        runId,
        type: "run.created",
        payload: { controlVersion: 0 }
      });
      await transaction`
        UPDATE conversations SET pending_instruction = NULL, updated_at = now()
        WHERE workspace_id = ${workspaceId} AND id = ${conversationId}
      `;
      return mapRun(run);
    });
  } catch (error) {
    if (isDatabaseError(error, "23505")) {
      throw new ApiError(409, "run_already_active", "This conversation already has an active run");
    }
    throw error;
  }
}

interface LockedRun extends RunRow {
  workspace_id: string;
}

async function lockedRun(transaction: Queryable, workspaceId: string, runId: string): Promise<LockedRun> {
  const [run] = await transaction<LockedRun[]>`
    SELECT * FROM runs
    WHERE workspace_id = ${workspaceId} AND id = ${runId}
    FOR UPDATE
  `;

  if (!run) {
    throw new ApiError(404, "run_not_found", "Run was not found");
  }
  return run;
}

export async function changeRunState(
  workspaceId: string,
  runId: string,
  command: "pause" | "resume" | "stop",
  stop?: StopRunInput
): Promise<RunDetail> {
  return withWorkspace(workspaceId, async (transaction) => {
    const run = await lockedRun(transaction, workspaceId, runId);
    const terminal = run.status === "stopped" || run.status === "failed";

    if (terminal) {
      if (command === "stop") {
        return mapRun(run);
      }
      throw new ApiError(409, "run_terminal", "A stopped or failed run cannot change state");
    }

    if (command === "pause" && run.desired_state === "paused") {
      return mapRun(run);
    }
    if (command === "resume" && run.desired_state === "running" && run.status !== "needs_attention") {
      return mapRun(run);
    }
    if (command === "stop" && run.desired_state === "stopped") {
      return mapRun(run);
    }

    const desiredState = command === "pause" ? "paused" : command === "resume" ? "running" : "stopped";
    const status: RunStatus = command === "pause" ? "pausing" : command === "resume" ? "resuming" : "stopping";
    const controlVersion = Number(run.control_version) + 1;
    const [updated] = await transaction<RunRow[]>`
      UPDATE runs SET
        desired_state = ${desiredState},
        status = ${status},
        stop_mode = ${command === "stop" ? stop?.mode ?? "graceful" : run.stop_mode},
        control_version = ${controlVersion}
      WHERE workspace_id = ${workspaceId} AND id = ${runId}
      RETURNING *
    `;

    if (!updated) {
      throw new Error("Failed to update run state");
    }

    await enqueueRunReconciliation(transaction, {
      workspaceId,
      runId,
      controlVersion,
      reason: "control_changed"
    });
    await emitEvent(transaction, {
      workspaceId,
      conversationId: run.conversation_id,
      runId,
      type: "run.control_requested",
      payload: { command, desiredState, controlVersion, stopMode: command === "stop" ? stop?.mode ?? "graceful" : null }
    });
    return mapRun(updated);
  });
}

export async function addRunInstruction(
  workspaceId: string,
  runId: string,
  instruction: string
): Promise<string> {
  return withWorkspace(workspaceId, async (transaction) => {
    const run = await lockedRun(transaction, workspaceId, runId);

    if (run.desired_state === "stopped" || run.status === "stopped" || run.status === "failed") {
      throw new ApiError(409, "run_terminal", "Instructions cannot be added to a stopped or failed run");
    }

    await transaction`
      UPDATE conversations SET pending_instruction = ${instruction}
      WHERE workspace_id = ${workspaceId} AND id = ${run.conversation_id}
    `;
    await emitEvent(transaction, {
      workspaceId,
      conversationId: run.conversation_id,
      runId,
      type: "run.instruction_added",
      payload: {}
    });
    return instruction;
  });
}
