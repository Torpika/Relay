import type { AgentRole, ProviderKind, ProviderProtocol, RunPhase } from "@/lib/contracts";
import type { ModelResponse } from "@/orchestration/providers";
import type {
  ArtifactFailure,
  ArtifactIdentity,
  ArtifactReservation,
  CheckpointInput,
  CheckpointResult,
  ClaimedRunJob,
  ExecutionAgent,
  OrchestrationRepository,
  PreparedIteration,
  RunControl,
  RunSnapshot,
  StoredArtifact
} from "@/orchestration/types";
import { withServiceWorkspace, withWorkspace, type Queryable } from "@/server/db/client";
import { toJsonValue } from "@/server/db/json";
import { sanitizeDiagnostic } from "@/server/security/diagnostics";
import {
  decryptCredential,
  type CredentialEnvelope
} from "@/server/security/credentials";

interface JobRow {
  id: string;
  workspace_id: string;
  run_id: string;
  iteration_id: string | null;
  type: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
  lease_owner: string;
  lease_token: string;
}

interface RunRow {
  workspace_id: string;
  run_id: string;
  conversation_id: string;
  control_version: string | number;
  desired_state: RunSnapshot["desiredState"];
  stop_mode: RunSnapshot["stopMode"];
  current_iteration: number;
  objective: string;
  pending_instruction: string | null;
  previous_synthesis: string | null;
  synthesizer_agent_id: string;
  review_topology: RunSnapshot["reviewTopology"];
  max_iterations: number | null;
  max_total_tokens: string | number | null;
  total_input_tokens: string | number;
  total_output_tokens: string | number;
}

interface AgentRow {
  position: number;
  config_snapshot: unknown;
  connection_id: string;
  credential_envelope: CredentialEnvelope;
  connection_status: string;
}

interface IterationRow {
  id: string;
  number: number;
}

interface ArtifactRow {
  id: string;
  kind: StoredArtifact["kind"];
  agent_id: string | null;
  target_agent_id: string | null;
  content: string;
  status: StoredArtifact["status"];
  latency_ms: number | null;
  input_tokens: number;
  output_tokens: number;
  error: string | null;
}

interface RunAgentSnapshot {
  id: string;
  name: string;
  model: string;
  roles: AgentRole[];
  instructions: string;
  parameters?: Record<string, unknown>;
  connectionId: string;
  provider: {
    id: string;
    kind: ProviderKind;
    protocol: ProviderProtocol;
    baseUrl: string;
  };
}

export class PostgresOrchestrationRepository implements OrchestrationRepository {
  async claimNextJob(workerId: string, leaseMs: number): Promise<ClaimedRunJob | null> {
    return withServiceWorkspace(async (sql) => {
      await sql`
        UPDATE jobs
        SET status = 'queued', lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
        WHERE status = 'leased' AND lease_expires_at < now()
      `;

      const rows = await sql<JobRow[]>`
        WITH candidate AS (
          SELECT candidate_job.id
          FROM jobs candidate_job
          WHERE candidate_job.status = 'queued'
            AND candidate_job.available_at <= now()
            AND candidate_job.type = 'reconcile_run'
            AND NOT EXISTS (
              SELECT 1
              FROM jobs active_job
              WHERE active_job.run_id = candidate_job.run_id
                AND active_job.status = 'leased'
                AND active_job.lease_expires_at >= now()
            )
          ORDER BY candidate_job.priority DESC, candidate_job.available_at, candidate_job.id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE jobs claimed_job
        SET status = 'leased',
            attempts = claimed_job.attempts + 1,
            lease_owner = ${workerId},
            lease_token = gen_random_uuid(),
            lease_expires_at = now() + (${leaseMs} * interval '1 millisecond'),
            last_error = NULL
        FROM candidate
        WHERE claimed_job.id = candidate.id
        RETURNING claimed_job.id, claimed_job.workspace_id, claimed_job.run_id,
                  claimed_job.iteration_id, claimed_job.type, claimed_job.payload,
                  claimed_job.attempts, claimed_job.max_attempts, claimed_job.lease_owner,
                  claimed_job.lease_token
      `;

      return rows[0] ? mapClaimedJob(rows[0]) : null;
    });
  }

  async renewJobLease(job: ClaimedRunJob, leaseMs: number): Promise<boolean> {
    return withWorkspace(job.workspaceId, async (sql) => {
      const rows = await sql<{ id: string }[]>`
        UPDATE jobs
        SET lease_expires_at = now() + (${leaseMs} * interval '1 millisecond')
        WHERE id = ${job.id}
          AND status = 'leased'
          AND lease_owner = ${job.leaseOwner}
          AND lease_token = ${job.leaseToken}::uuid
        RETURNING id
      `;
      return rows.length === 1;
    });
  }

  async loadRunSnapshot(job: ClaimedRunJob): Promise<RunSnapshot | null> {
    return withWorkspace(job.workspaceId, async (sql) => {
      const runRows = await sql<RunRow[]>`
        SELECT run.workspace_id, run.id AS run_id, run.conversation_id,
               run.control_version, run.desired_state, run.stop_mode,
               run.current_iteration, conversation.objective,
               conversation.pending_instruction,
               previous_iteration.synthesis AS previous_synthesis,
               run.synthesizer_agent_id, run.review_topology,
               run.max_iterations, run.max_total_tokens,
               run.total_input_tokens, run.total_output_tokens
        FROM runs run
        JOIN conversations conversation ON conversation.id = run.conversation_id
        LEFT JOIN LATERAL (
          SELECT synthesis
          FROM iterations
          WHERE run_id = run.id AND status = 'complete'
          ORDER BY number DESC
          LIMIT 1
        ) previous_iteration ON true
        WHERE run.id = ${job.runId}
          AND EXISTS (${this.activeJobLease(sql, job)})
      `;
      const run = runRows[0];

      if (!run) {
        return null;
      }

      const agentRows = await sql<AgentRow[]>`
        SELECT run_agent.position, run_agent.config_snapshot,
               connection.id AS connection_id,
               connection.credential_envelope,
               connection.status AS connection_status
        FROM run_agents run_agent
        JOIN provider_connections connection
          ON connection.id = (run_agent.config_snapshot ->> 'connectionId')::uuid
         AND connection.workspace_id = run_agent.workspace_id
        WHERE run_agent.run_id = ${job.runId}
        ORDER BY run_agent.position
      `;
      const agents = agentRows.map((row) => this.mapExecutionAgent(row, job.workspaceId));

      return {
        workspaceId: run.workspace_id,
        runId: run.run_id,
        conversationId: run.conversation_id,
        controlVersion: toSafeNumber(run.control_version, "control_version"),
        desiredState: run.desired_state,
        stopMode: run.stop_mode,
        currentIteration: run.current_iteration,
        objective: run.objective,
        pendingInstruction: run.pending_instruction,
        previousSynthesis: run.previous_synthesis,
        synthesizerAgentId: run.synthesizer_agent_id,
        reviewTopology: run.review_topology,
        maxIterations: run.max_iterations,
        maxTotalTokens:
          run.max_total_tokens === null ? null : toSafeNumber(run.max_total_tokens, "max_total_tokens"),
        totalInputTokens: toSafeNumber(run.total_input_tokens, "total_input_tokens"),
        totalOutputTokens: toSafeNumber(run.total_output_tokens, "total_output_tokens"),
        agents
      };
    });
  }

  async getRunControl(workspaceId: string, runId: string): Promise<RunControl | null> {
    return withWorkspace(workspaceId, async (sql) => {
      const rows = await sql<
        Array<{
          control_version: string | number;
          desired_state: RunControl["desiredState"];
          stop_mode: RunControl["stopMode"];
        }>
      >`
        SELECT control_version, desired_state, stop_mode
        FROM runs
        WHERE id = ${runId}
      `;
      const row = rows[0];

      return row
        ? {
            controlVersion: toSafeNumber(row.control_version, "control_version"),
            desiredState: row.desired_state,
            stopMode: row.stop_mode
          }
        : null;
    });
  }

  async prepareIteration(
    job: ClaimedRunJob,
    controlVersion: number,
    iterationNumber: number
  ): Promise<PreparedIteration | null> {
    return withWorkspace(job.workspaceId, async (sql) => {
      const runRows = await sql<{ id: string }[]>`
        SELECT id
        FROM runs
        WHERE id = ${job.runId}
          AND control_version = ${controlVersion}
          AND ${this.acceptsRoundWork(sql)}
          AND EXISTS (${this.activeJobLease(sql, job)})
        FOR UPDATE
      `;

      if (runRows.length === 0) {
        return null;
      }

      let iterationRows: IterationRow[] = [];

      if (job.iterationId) {
        iterationRows = await sql<IterationRow[]>`
          UPDATE iterations
          SET status = 'running', phase = 'preparing', started_at = COALESCE(started_at, now()),
              completed_at = NULL
          WHERE id = ${job.iterationId} AND run_id = ${job.runId} AND status <> 'complete'
          RETURNING id, number
        `;
      }

      if (iterationRows.length === 0) {
        const existingRows = await sql<Array<IterationRow & { status: string }>>`
          SELECT id, number, status
          FROM iterations
          WHERE run_id = ${job.runId} AND number = ${iterationNumber}
          FOR UPDATE
        `;
        const existing = existingRows[0];

        if (existing && (existing.status === "running" || existing.status === "queued")) {
          iterationRows = [existing];
        } else {
          const nextRows = await sql<{ number: number }[]>`
            SELECT GREATEST(${iterationNumber}, COALESCE(MAX(number), 0) + 1)::integer AS number
            FROM iterations
            WHERE run_id = ${job.runId}
          `;
          iterationRows = await sql<IterationRow[]>`
            INSERT INTO iterations (workspace_id, run_id, number, phase, status, started_at)
            VALUES (${job.workspaceId}, ${job.runId}, ${nextRows[0].number}, 'preparing', 'running', now())
            RETURNING id, number
          `;
        }
      }

      const iteration = iterationRows[0];
      await sql`
        UPDATE jobs
        SET iteration_id = ${iteration.id}
        WHERE id = ${job.id} AND lease_owner = ${job.leaseOwner} AND lease_token = ${job.leaseToken}::uuid
      `;
      await sql`
        UPDATE runs
        SET status = 'running', phase = 'preparing', started_at = COALESCE(started_at, now())
        WHERE id = ${job.runId} AND control_version = ${controlVersion}
      `;
      await this.appendEvent(sql, job, iteration.id, "iteration.started", {
        number: iteration.number,
        controlVersion
      });
      return iteration;
    });
  }

  async setPhase(
    job: ClaimedRunJob,
    controlVersion: number,
    iteration: PreparedIteration,
    phase: RunPhase
  ): Promise<boolean> {
    return withWorkspace(job.workspaceId, async (sql) => {
      const rows = await sql<{ id: string }[]>`
        UPDATE runs
        SET phase = ${phase}
        WHERE id = ${job.runId}
          AND control_version = ${controlVersion}
          AND ${this.acceptsRoundWork(sql)}
          AND EXISTS (${this.activeJobLease(sql, job)})
        RETURNING id
      `;

      if (rows.length === 0) {
        return false;
      }

      await sql`
        UPDATE iterations SET phase = ${phase}
        WHERE id = ${iteration.id} AND run_id = ${job.runId} AND status = 'running'
      `;
      await this.appendEvent(sql, job, iteration.id, "run.phase_changed", { phase });
      return true;
    });
  }

  async reserveArtifact(
    job: ClaimedRunJob,
    controlVersion: number,
    iteration: PreparedIteration,
    identity: ArtifactIdentity
  ): Promise<ArtifactReservation | null> {
    return withWorkspace(job.workspaceId, async (sql) => {
      const fenceRows = await sql<{ id: string }[]>`
        SELECT id
        FROM runs
        WHERE id = ${job.runId}
          AND control_version = ${controlVersion}
          AND ${this.acceptsRoundWork(sql)}
          AND EXISTS (${this.activeJobLease(sql, job)})
      `;

      if (fenceRows.length === 0) {
        return null;
      }

      const rows = await sql<ArtifactRow[]>`
        INSERT INTO artifacts (
          workspace_id, run_id, iteration_id, kind, agent_id, target_agent_id, status
        ) VALUES (
          ${job.workspaceId}, ${job.runId}, ${iteration.id}, ${identity.kind},
          ${identity.agentId}, ${identity.targetAgentId}, 'running'
        )
        ON CONFLICT (iteration_id, kind, agent_id, target_agent_id)
        DO UPDATE SET
          status = CASE WHEN artifacts.status = 'complete' THEN 'complete' ELSE 'running' END,
          error = CASE WHEN artifacts.status = 'complete' THEN artifacts.error ELSE NULL END
        RETURNING id, kind, agent_id, target_agent_id, content, status,
                  latency_ms, input_tokens, output_tokens, error
      `;
      const artifact = mapArtifact(rows[0]);

      if (artifact.status !== "complete") {
        await this.appendEvent(sql, job, iteration.id, "artifact.started", {
          artifactId: artifact.id,
          kind: artifact.kind,
          agentId: artifact.agentId,
          targetAgentId: artifact.targetAgentId
        });
      }

      return {
        state: artifact.status === "complete" ? "complete" : "acquired",
        artifact
      };
    });
  }

  async completeArtifact(
    job: ClaimedRunJob,
    controlVersion: number,
    iteration: PreparedIteration,
    artifactId: string,
    response: ModelResponse,
    draftArtifactId?: string
  ): Promise<StoredArtifact | null> {
    return withWorkspace(job.workspaceId, async (sql) => {
      const rows = await sql<ArtifactRow[]>`
        UPDATE artifacts artifact
        SET content = ${response.content}, status = 'complete', latency_ms = ${response.latencyMs},
            input_tokens = ${response.usage.inputTokens}, output_tokens = ${response.usage.outputTokens},
            error = NULL
        WHERE artifact.id = ${artifactId}
          AND artifact.iteration_id = ${iteration.id}
          AND artifact.run_id = ${job.runId}
          AND EXISTS (
            SELECT 1 FROM runs run
            WHERE run.id = artifact.run_id
              AND run.control_version = ${controlVersion}
              AND ${this.acceptsRoundWork(sql, "run")}
          )
          AND EXISTS (${this.activeJobLease(sql, job)})
        RETURNING artifact.id, artifact.kind, artifact.agent_id, artifact.target_agent_id,
                  artifact.content, artifact.status, artifact.latency_ms,
                  artifact.input_tokens, artifact.output_tokens, artifact.error
      `;

      if (rows.length === 0) {
        return null;
      }

      const artifact = mapArtifact(rows[0]);

      if (draftArtifactId && artifact.kind === "review" && artifact.agentId) {
        await sql`
          INSERT INTO reviews (
            workspace_id, run_id, iteration_id, draft_artifact_id,
            reviewer_agent_id, review_artifact_id
          ) VALUES (
            ${job.workspaceId}, ${job.runId}, ${iteration.id}, ${draftArtifactId},
            ${artifact.agentId}, ${artifact.id}
          )
          ON CONFLICT (draft_artifact_id, reviewer_agent_id)
          DO UPDATE SET review_artifact_id = EXCLUDED.review_artifact_id
        `;
      }

      await this.appendEvent(sql, job, iteration.id, "artifact.completed", {
        artifactId: artifact.id,
        kind: artifact.kind,
        agentId: artifact.agentId,
        targetAgentId: artifact.targetAgentId,
        inputTokens: artifact.inputTokens,
        outputTokens: artifact.outputTokens
      });
      return artifact;
    });
  }

  async failArtifact(
    job: ClaimedRunJob,
    controlVersion: number,
    iteration: PreparedIteration,
    artifactId: string,
    failure: ArtifactFailure,
    cancelled: boolean
  ): Promise<boolean> {
    return withWorkspace(job.workspaceId, async (sql) => {
      const diagnostic = sanitizeDiagnostic(failure.message);
      const rows = await sql<{ id: string }[]>`
        UPDATE artifacts artifact
        SET status = ${cancelled ? "cancelled" : "failed"}, error = ${diagnostic}
        WHERE artifact.id = ${artifactId}
          AND artifact.iteration_id = ${iteration.id}
          AND EXISTS (
            SELECT 1 FROM runs run
            WHERE run.id = artifact.run_id AND run.control_version = ${controlVersion}
          )
          AND EXISTS (${this.activeJobLease(sql, job)})
        RETURNING id
      `;

      if (rows.length > 0) {
        await this.appendEvent(sql, job, iteration.id, "artifact.failed", {
          artifactId,
          code: failure.code,
          retryable: failure.retryable,
          cancelled,
          message: diagnostic
        });
      }

      return rows.length === 1;
    });
  }

  async checkpointRound(input: CheckpointInput): Promise<CheckpointResult> {
    return withWorkspace(input.job.workspaceId, async (sql) => {
      const runRows = await sql<{ id: string; conversation_id: string }[]>`
        UPDATE runs run
        SET current_iteration = ${input.iteration.number},
            total_input_tokens = run.total_input_tokens + ${input.inputTokens},
            total_output_tokens = run.total_output_tokens + ${input.outputTokens},
            consecutive_failures = 0,
            phase = 'idle',
            status = CASE
              WHEN ${input.continueRunning} THEN 'running'
              WHEN ${input.stopReason} IN ('graceful_stop', 'consensus') THEN 'stopped'
              ELSE 'paused'
            END,
            desired_state = CASE
              WHEN ${input.continueRunning} THEN 'running'
              WHEN ${input.stopReason} IN ('graceful_stop', 'consensus') THEN 'stopped'
              ELSE 'paused'
            END,
            stop_mode = CASE WHEN ${input.stopReason} = 'graceful_stop' THEN 'graceful' ELSE NULL END,
            stopped_at = CASE WHEN ${input.stopReason} IN ('graceful_stop', 'consensus') THEN now() ELSE run.stopped_at END
        FROM conversations conversation
        WHERE run.id = ${input.job.runId}
          AND conversation.id = run.conversation_id
          AND run.control_version = ${input.controlVersion}
          AND ${this.acceptsRoundWork(sql, "run")}
          AND EXISTS (${this.activeJobLease(sql, input.job)})
        RETURNING run.id, run.conversation_id
      `;

      if (runRows.length === 0) {
        return { accepted: false, scheduledNext: false };
      }

      await sql`
        UPDATE iterations
        SET phase = 'idle', status = 'complete', synthesis = ${input.synthesis.content}, completed_at = now()
        WHERE id = ${input.iteration.id} AND run_id = ${input.job.runId}
      `;
      await sql`
        UPDATE conversations SET pending_instruction = NULL
        WHERE id = ${runRows[0].conversation_id}
      `;

      let scheduledNext = false;

      if (input.continueRunning) {
        const nextIteration = input.iteration.number + 1;
        const idempotencyKey = `${input.job.runId}:round:${nextIteration}:epoch:${input.controlVersion}`;
        const nextRows = await sql<{ id: string }[]>`
          INSERT INTO jobs (
            workspace_id, run_id, type, payload, status, idempotency_key
          )
          SELECT ${input.job.workspaceId}, ${input.job.runId}, 'reconcile_run',
                 ${sql.json({ reason: "continuous", controlVersion: input.controlVersion })},
                 'queued', ${idempotencyKey}
          FROM runs
          WHERE id = ${input.job.runId}
            AND control_version = ${input.controlVersion}
            AND desired_state = 'running'
          ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
          RETURNING id
        `;
        scheduledNext = nextRows.length === 1;
      }

      await sql`
        UPDATE jobs
        SET status = 'complete', lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
        WHERE id = ${input.job.id}
          AND lease_owner = ${input.job.leaseOwner}
          AND lease_token = ${input.job.leaseToken}::uuid
      `;
      await this.appendEvent(sql, input.job, input.iteration.id, "iteration.completed", {
        number: input.iteration.number,
        scheduledNext,
        stopReason: input.stopReason,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens
      });
      return { accepted: true, scheduledNext };
    });
  }

  async cancelIteration(
    job: ClaimedRunJob,
    _controlVersion: number,
    iteration: PreparedIteration | null,
    reason: string
  ): Promise<void> {
    await withWorkspace(job.workspaceId, async (sql) => {
      const leaseRows = await sql<{ id: string }[]>`
        SELECT id FROM jobs
        WHERE id = ${job.id} AND status = 'leased'
          AND lease_owner = ${job.leaseOwner} AND lease_token = ${job.leaseToken}::uuid
        FOR UPDATE
      `;

      if (leaseRows.length === 0) {
        return;
      }

      if (iteration) {
        await sql`
          UPDATE iterations SET status = 'cancelled', phase = 'idle', completed_at = now()
          WHERE id = ${iteration.id} AND status <> 'complete'
        `;
        await sql`
          UPDATE artifacts SET status = 'cancelled', error = ${reason}
          WHERE iteration_id = ${iteration.id} AND status IN ('pending', 'running')
        `;
      }

      await sql`
        UPDATE runs
        SET status = 'stopped', phase = 'idle', stopped_at = now()
        WHERE id = ${job.runId} AND desired_state = 'stopped' AND stop_mode = 'immediate'
      `;
      await sql`
        UPDATE jobs
        SET status = 'cancelled', last_error = ${reason},
            lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
        WHERE id = ${job.id}
      `;
      await this.appendEvent(sql, job, iteration?.id ?? null, "iteration.cancelled", { reason });
    });
  }

  async completeObsoleteJob(job: ClaimedRunJob, reason: string): Promise<void> {
    await withWorkspace(job.workspaceId, async (sql) => {
      const rows = await sql<{ id: string }[]>`
        UPDATE jobs
        SET status = 'complete', last_error = ${reason},
            lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
        WHERE id = ${job.id} AND status = 'leased'
          AND lease_owner = ${job.leaseOwner} AND lease_token = ${job.leaseToken}::uuid
        RETURNING id
      `;

      if (rows.length === 0) {
        return;
      }

      if (reason === "iteration_limit_reached" || reason === "token_limit_reached") {
        await sql`
          UPDATE runs
          SET status = 'paused', desired_state = 'paused', phase = 'idle', stop_mode = NULL
          WHERE id = ${job.runId} AND control_version = ${job.controlVersion}
        `;
      } else {
        await sql`
          UPDATE runs
          SET status = CASE WHEN desired_state = 'stopped' THEN 'stopped' ELSE 'paused' END,
              phase = 'idle',
              stopped_at = CASE WHEN desired_state = 'stopped' THEN now() ELSE stopped_at END
          WHERE id = ${job.runId}
            AND control_version = ${job.controlVersion}
            AND desired_state <> 'running'
        `;
      }
      await this.appendEvent(sql, job, job.iterationId, "job.completed", { reason });
    });
  }

  async retryJob(job: ClaimedRunJob, error: string, delayMs: number): Promise<void> {
    await withWorkspace(job.workspaceId, async (sql) => {
      const diagnostic = sanitizeDiagnostic(error);
      const rows = await sql<{ id: string }[]>`
        UPDATE jobs
        SET status = 'queued', available_at = now() + (${delayMs} * interval '1 millisecond'),
            last_error = ${diagnostic}, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
        WHERE id = ${job.id} AND status = 'leased'
          AND attempts < max_attempts
          AND lease_owner = ${job.leaseOwner} AND lease_token = ${job.leaseToken}::uuid
        RETURNING id
      `;

      if (rows.length === 0) {
        return;
      }

      await this.appendEvent(sql, job, job.iterationId, "job.retry_scheduled", {
        error: diagnostic,
        delayMs,
        attempt: job.attempts
      });
    });
  }

  async failJob(job: ClaimedRunJob, error: string): Promise<void> {
    await withWorkspace(job.workspaceId, async (sql) => {
      const diagnostic = sanitizeDiagnostic(error);
      const rows = await sql<{ id: string }[]>`
        UPDATE jobs
        SET status = 'failed', last_error = ${diagnostic},
            lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
        WHERE id = ${job.id} AND status = 'leased'
          AND lease_owner = ${job.leaseOwner} AND lease_token = ${job.leaseToken}::uuid
        RETURNING id
      `;

      if (rows.length === 0) {
        return;
      }

      if (job.iterationId) {
        await sql`
          UPDATE iterations SET status = 'failed', phase = 'idle', completed_at = now()
          WHERE id = ${job.iterationId} AND status <> 'complete'
        `;
      }
      await sql`
        UPDATE runs
        SET status = 'needs_attention', phase = 'idle', consecutive_failures = consecutive_failures + 1
        WHERE id = ${job.runId} AND desired_state = 'running'
      `;
      await this.appendEvent(sql, job, job.iterationId, "job.failed", { error: diagnostic });
    });
  }

  private activeJobLease(sql: Queryable, job: ClaimedRunJob) {
    return sql`
      SELECT 1 FROM jobs active_job
      WHERE active_job.id = ${job.id}
        AND active_job.status = 'leased'
        AND active_job.lease_owner = ${job.leaseOwner}
        AND active_job.lease_token = ${job.leaseToken}::uuid
        AND active_job.lease_expires_at >= now()
    `;
  }

  private acceptsRoundWork(sql: Queryable, alias = "runs") {
    const table = sql(alias);
    return sql`
      (${table}.desired_state = 'running'
       OR ${table}.desired_state = 'paused'
       OR (${table}.desired_state = 'stopped' AND ${table}.stop_mode = 'graceful'))
    `;
  }

  private async appendEvent(
    sql: Queryable,
    job: ClaimedRunJob,
    iterationId: string | null,
    type: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await sql`
      INSERT INTO events (
        workspace_id, conversation_id, run_id, iteration_id, type, payload
      )
      SELECT ${job.workspaceId}, run.conversation_id, ${job.runId}, ${iterationId},
             ${type}, ${sql.json(toJsonValue(payload))}
      FROM runs run
      WHERE run.id = ${job.runId}
    `;
  }

  private mapExecutionAgent(row: AgentRow, workspaceId: string): ExecutionAgent {
    const snapshot = parseRunAgentSnapshot(row.config_snapshot);

    if (row.connection_status === "disabled") {
      throw new Error(`Provider connection for agent ${snapshot.name} is disabled`);
    }

    if (snapshot.connectionId !== row.connection_id || snapshot.provider.id !== row.connection_id) {
      throw new Error(`Provider snapshot mismatch for agent ${snapshot.name}`);
    }

    return {
      id: snapshot.id,
      name: snapshot.name,
      model: snapshot.model,
      roles: snapshot.roles,
      instructions: snapshot.instructions,
      position: row.position,
      parameters: parseAgentParameters(snapshot.parameters),
      connection: {
        id: snapshot.connectionId,
        kind: snapshot.provider.kind,
        protocol: snapshot.provider.protocol,
        baseUrl: snapshot.provider.baseUrl,
        credential: snapshot.provider.protocol === "codex_mcp" ||
          (snapshot.provider.protocol === "local_cli" && snapshot.provider.kind !== "local_custom")
          ? undefined
          : decryptCredential(row.credential_envelope, {
              workspaceId,
              connectionId: row.connection_id
            })
      }
    };
  }
}

function mapClaimedJob(row: JobRow): ClaimedRunJob {
  if (row.type !== "reconcile_run") {
    throw new Error(`Unsupported job type: ${row.type}`);
  }

  const payload = isRecord(row.payload) ? row.payload : {};
  return {
    id: String(row.id),
    workspaceId: row.workspace_id,
    runId: row.run_id,
    iterationId: row.iteration_id,
    type: "reconcile_run",
    controlVersion: toSafeNumber(payload.controlVersion, "jobs.payload.controlVersion"),
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token
  };
}

function mapArtifact(row: ArtifactRow): StoredArtifact {
  return {
    id: row.id,
    kind: row.kind,
    agentId: row.agent_id,
    targetAgentId: row.target_agent_id,
    content: row.content,
    status: row.status,
    latencyMs: row.latency_ms,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    error: row.error
  };
}

function parseRunAgentSnapshot(value: unknown): RunAgentSnapshot {
  if (!isRecord(value) || !isRecord(value.provider)) {
    throw new Error("Run agent configuration snapshot is invalid");
  }

  const roles = Array.isArray(value.roles)
    ? value.roles.filter((role): role is AgentRole =>
        role === "draft" || role === "review" || role === "synthesize"
      )
    : [];
  const provider = value.provider;

  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.model !== "string" ||
    typeof value.instructions !== "string" ||
    typeof value.connectionId !== "string" ||
    roles.length === 0 ||
    typeof provider.id !== "string" ||
    typeof provider.kind !== "string" ||
    typeof provider.protocol !== "string" ||
    typeof provider.baseUrl !== "string"
  ) {
    throw new Error("Run agent configuration snapshot is incomplete");
  }

  return {
    id: value.id,
    name: value.name,
    model: value.model,
    roles,
    instructions: value.instructions,
    parameters: isRecord(value.parameters) ? value.parameters : {},
    connectionId: value.connectionId,
    provider: {
      id: provider.id,
      kind: provider.kind as ProviderKind,
      protocol: provider.protocol as ProviderProtocol,
      baseUrl: provider.baseUrl
    }
  };
}

function parseAgentParameters(value: Record<string, unknown> | undefined) {
  return {
    ...(isReasoningEffort(value?.reasoningEffort)
      ? { reasoningEffort: value.reasoningEffort }
      : {}),
    ...(isPositiveInteger(value?.maxOutputTokens)
      ? { maxOutputTokens: value.maxOutputTokens }
      : {}),
    ...(typeof value?.temperature === "number" && Number.isFinite(value.temperature)
      ? { temperature: value.temperature }
      : {}),
    ...(isPositiveInteger(value?.timeoutMs) ? { timeoutMs: value.timeoutMs } : {})
  };
}

function isReasoningEffort(value: unknown): value is import("@/lib/contracts").ReasoningEffort {
  return ["minimal", "low", "medium", "high", "xhigh"].includes(String(value));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function toSafeNumber(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${label} is outside the supported integer range`);
  }

  return number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
