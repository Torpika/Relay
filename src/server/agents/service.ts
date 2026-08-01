import type { AgentRole, AgentSummary, ProviderKind } from "@/lib/contracts";
import { withWorkspace, type Queryable } from "@/server/db/client";
import { isDatabaseError } from "@/server/db/errors";
import { toJsonValue } from "@/server/db/json";
import { ApiError } from "@/server/http/errors";
import type { CreateAgentInput, UpdateAgentInput } from "@/server/agents/schemas";

interface AgentRow {
  id: string;
  workspace_id: string;
  connection_id: string;
  name: string;
  model: string;
  provider_kind: ProviderKind;
  roles: AgentRole[];
  instructions: string;
  enabled: boolean;
  color: string;
  parameters: Record<string, unknown>;
}

function summary(row: AgentRow): AgentSummary {
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

async function agentRow(transaction: Queryable, workspaceId: string, agentId: string): Promise<AgentRow> {
  const [row] = await transaction<AgentRow[]>`
    SELECT a.*, p.kind AS provider_kind
    FROM agents a
    JOIN provider_connections p
      ON p.workspace_id = a.workspace_id
      AND p.id = a.connection_id
    WHERE a.workspace_id = ${workspaceId} AND a.id = ${agentId}
  `;

  if (!row) {
    throw new ApiError(404, "agent_not_found", "Agent was not found");
  }

  return row;
}

export async function listAgents(workspaceId: string): Promise<AgentSummary[]> {
  return withWorkspace(workspaceId, async (transaction) => {
    const rows = await transaction<AgentRow[]>`
      SELECT a.*, p.kind AS provider_kind
      FROM agents a
      JOIN provider_connections p
        ON p.workspace_id = a.workspace_id
        AND p.id = a.connection_id
      WHERE a.workspace_id = ${workspaceId}
      ORDER BY a.created_at, a.id
    `;
    return rows.map(summary);
  });
}

export async function createAgent(workspaceId: string, input: CreateAgentInput): Promise<AgentSummary> {
  try {
    return await withWorkspace(workspaceId, async (transaction) => {
      const [row] = await transaction<AgentRow[]>`
        INSERT INTO agents (
          workspace_id,
          connection_id,
          name,
          model,
          roles,
          instructions,
          enabled,
          color,
          parameters
        )
        SELECT
          ${workspaceId},
          p.id,
          ${input.name},
          ${input.model},
          ${transaction.array(input.roles)},
          ${input.instructions},
          ${input.enabled},
          ${input.color},
          ${transaction.json(toJsonValue(input.parameters))}
        FROM provider_connections p
        WHERE p.workspace_id = ${workspaceId}
          AND p.id = ${input.connectionId}
          AND p.status <> 'disabled'
        RETURNING *, (
          SELECT kind FROM provider_connections WHERE workspace_id = ${workspaceId} AND id = connection_id
        ) AS provider_kind
      `;

      if (!row) {
        throw new ApiError(400, "invalid_provider", "The selected provider does not exist or is disabled");
      }

      return summary(row);
    });
  } catch (error) {
    if (isDatabaseError(error, "23505")) {
      throw new ApiError(409, "agent_name_conflict", "An agent with this name already exists");
    }
    throw error;
  }
}

export async function updateAgent(
  workspaceId: string,
  agentId: string,
  input: UpdateAgentInput
): Promise<AgentSummary> {
  try {
    return await withWorkspace(workspaceId, async (transaction) => {
      const existing = await agentRow(transaction, workspaceId, agentId);
      const connectionId = input.connectionId ?? existing.connection_id;
      const [provider] = await transaction<{ id: string }[]>`
        SELECT id FROM provider_connections
        WHERE workspace_id = ${workspaceId} AND id = ${connectionId} AND status <> 'disabled'
      `;

      if (!provider) {
        throw new ApiError(400, "invalid_provider", "The selected provider does not exist or is disabled");
      }

      const [row] = await transaction<AgentRow[]>`
        UPDATE agents SET
          connection_id = ${connectionId},
          name = ${input.name ?? existing.name},
          model = ${input.model ?? existing.model},
          roles = ${transaction.array(input.roles ?? existing.roles)},
          instructions = ${input.instructions ?? existing.instructions},
          enabled = ${input.enabled ?? existing.enabled},
          color = ${input.color ?? existing.color},
          parameters = ${transaction.json(toJsonValue(input.parameters ?? existing.parameters))}
        WHERE workspace_id = ${workspaceId} AND id = ${agentId}
        RETURNING *, (
          SELECT kind FROM provider_connections WHERE workspace_id = ${workspaceId} AND id = connection_id
        ) AS provider_kind
      `;

      if (!row) {
        throw new Error("Failed to update agent");
      }

      return summary(row);
    });
  } catch (error) {
    if (isDatabaseError(error, "23505")) {
      throw new ApiError(409, "agent_name_conflict", "An agent with this name already exists");
    }
    throw error;
  }
}

export async function deleteAgent(workspaceId: string, agentId: string): Promise<void> {
  try {
    await withWorkspace(workspaceId, async (transaction) => {
      const result = await transaction`
        DELETE FROM agents WHERE workspace_id = ${workspaceId} AND id = ${agentId}
      `;

      if (result.count === 0) {
        throw new ApiError(404, "agent_not_found", "Agent was not found");
      }
    });
  } catch (error) {
    if (isDatabaseError(error, "23503")) {
      throw new ApiError(409, "agent_in_use", "Disable this agent because it is referenced by conversation history");
    }
    throw error;
  }
}
