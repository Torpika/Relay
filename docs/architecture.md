# Relay architecture

## Product boundaries

Relay separates four concepts:

- A **connection** owns one provider origin and one write-only credential.
- An **agent** owns a model, role eligibility, and system instructions.
- A **session** owns the human goal, selected agents, and history.
- A **run** is one immutable execution lineage inside a session.

Provider-side thread IDs are optional optimizations. PostgreSQL remains the canonical history and control plane.

## Local AI runtime boundary

The host worker connects to Codex through `codex mcp-server` and to Claude Code, Gemini CLI, and Kimi Code through bounded local child processes. It keeps one Codex thread per run, agent, artifact kind, and review target while the worker process is alive. Every request still contains the canonical Relay context, so losing in-memory provider continuity changes conversational caching but not recoverability.

All local reasoning workers run from a dedicated empty directory with time and output limits. Codex, Claude Code, and Gemini use non-mutating/plan modes. Kimi prompt mode cannot be combined with its plan flag, so Relay isolates its working directory, disables telemetry, and explicitly instructs it not to mutate files. The separate `relay-mcp` process exposes lifecycle controls to Codex Desktop without granting model outputs direct control of them.

Supported local task discovery is read-only. Relay reads bounded Codex indexes, Claude Code transcripts, Gemini CLI sessions, and Kimi Code session files; it never edits their histories or scrapes private desktop browser caches.

## Durable orchestration

Every queued job identifies one run, round, and execution epoch. A worker claims the job with a lease, snapshots the eligible agents, and advances the round through finite phases. Unique logical keys prevent duplicate drafts, reviews, synthesis artifacts, or successor jobs.

Workers check the run’s desired state and epoch:

1. before claiming work;
2. before every provider request;
3. while waiting on cancellable requests;
4. before accepting each result;
5. before creating the successor round.

Provider calls are not assumed to be exactly once. If a worker crashes after dispatch and before persisting the response, a retry may incur a duplicate upstream call. Relay records the attempt and prevents duplicate accepted artifacts.

## Review topology

For `all_to_all`, every successful draft is reviewed by each other eligible reviewer. The diagonal is never assigned. This uses `n × (n - 1)` review calls and is intended for small teams.

For `round_robin`, each draft is assigned to the next eligible reviewer in the persisted roster. This keeps review calls linear for larger teams.

The synthesizer receives the prior checkpoint, current drafts, and peer reviews inside explicit data delimiters. Peer artifacts are untrusted content and cannot alter run policy, provider settings, credentials, or control state.

## Idempotency and fencing

Run commands accept idempotency keys and update desired state with an optimistic version. Immediate stop increments the execution epoch. Every artifact acceptance and successor-job insert compares the captured epoch with the current run epoch; a stale worker can finish a request but cannot make its result canonical.

Jobs have bounded leases and attempts. Expired claims return to the queue. A round can reuse already completed work items after a crash and dispatch only missing work.

## Live updates

State mutations append a monotonically increasing domain event in the same database transaction. SSE clients reconnect with a cursor, replay missed events, then continue following new rows. Final artifacts and phase changes are durable; transient provider token deltas are not required for recovery.

## Scaling

- Scale web replicas independently; they share no in-memory run state.
- Scale workers up to the provider and database concurrency ceilings.
- Keep worker concurrency bounded per process and provider connection.
- Use a connection pooler in transaction mode only when tenant context is set with `SET LOCAL` inside every transaction.
- Archive or partition old domain events and usage rows after the configured retention period.
- Place custom provider traffic behind controlled egress in hosted environments.
- Keep local AI workers on trusted hosts with authenticated CLI installations; do not place personal AI sessions inside a shared container or multi-tenant worker.

## Guardrails

Continuous runs have no round limit by default, but production workspaces should configure token, cost, wall-time, concurrency, and consecutive-failure ceilings. A guardrail pauses a run with an explicit reason; it never silently reports success or destroys its checkpoint.
