import type { DomainEvent } from "@/lib/contracts";
import type { Queryable } from "@/server/db/client";
import { toJsonValue } from "@/server/db/json";

interface EventRow {
  id: string | number;
  type: string;
  run_id: string | null;
  iteration_id: string | null;
  payload: Record<string, unknown>;
  created_at: Date | string;
}

export interface NewEvent {
  workspaceId: string;
  conversationId?: string | null;
  runId?: string | null;
  iterationId?: string | null;
  type: string;
  payload?: Record<string, unknown>;
}

export async function emitEvent(transaction: Queryable, event: NewEvent): Promise<void> {
  await transaction`
    INSERT INTO events (
      workspace_id,
      conversation_id,
      run_id,
      iteration_id,
      type,
      payload
    ) VALUES (
      ${event.workspaceId},
      ${event.conversationId ?? null},
      ${event.runId ?? null},
      ${event.iterationId ?? null},
      ${event.type},
      ${transaction.json(toJsonValue(event.payload ?? {}))}
    )
  `;
}

export function mapEvent(row: EventRow): DomainEvent {
  return {
    id: Number(row.id),
    type: row.type,
    runId: row.run_id,
    iterationId: row.iteration_id,
    payload: row.payload,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString()
  };
}

export type { EventRow };
