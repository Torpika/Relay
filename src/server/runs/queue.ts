import type { Queryable } from "@/server/db/client";
import { toJsonValue } from "@/server/db/json";

export async function enqueueRunReconciliation(
  transaction: Queryable,
  input: {
    workspaceId: string;
    runId: string;
    controlVersion: number;
    reason: "created" | "control_changed" | "instruction_added";
  }
): Promise<void> {
  await transaction`
    INSERT INTO jobs (
      workspace_id,
      run_id,
      type,
      payload,
      idempotency_key
    ) VALUES (
      ${input.workspaceId},
      ${input.runId},
      'reconcile_run',
      ${transaction.json(toJsonValue({ reason: input.reason, controlVersion: input.controlVersion }))},
      ${`${input.runId}:reconcile:${input.controlVersion}`}
    )
    ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
  `;
}
