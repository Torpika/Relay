import { describe, expect, it } from "vitest";

import { buildReviewAssignments } from "@/orchestration/topology";
import type { ExecutionAgent, StoredArtifact } from "@/orchestration/types";

describe("buildReviewAssignments", () => {
  it("builds every all-to-all peer review without diagonal assignments", () => {
    const agents = [agent("a", 0), agent("b", 1), agent("c", 2)];
    const assignments = buildReviewAssignments(
      agents,
      agents.map((candidate) => draft(candidate.id)),
      "all_to_all",
      1
    );

    expect(assignments).toHaveLength(6);
    expect(assignments.every(({ reviewer, draft: peerDraft }) => reviewer.id !== peerDraft.agentId)).toBe(
      true
    );
    expect(
      assignments.map(({ reviewer, draft: peerDraft }) => `${reviewer.id}->${peerDraft.agentId}`)
    ).toEqual(["b->a", "c->a", "a->b", "c->b", "a->c", "b->c"]);
  });

  it("keeps round-robin review linear and rotates reviewers between rounds", () => {
    const agents = [agent("a", 0), agent("b", 1), agent("c", 2)];
    const drafts = agents.map((candidate) => draft(candidate.id));
    const firstRound = buildReviewAssignments(agents, drafts, "round_robin", 1);
    const secondRound = buildReviewAssignments(agents, drafts, "round_robin", 2);

    expect(firstRound).toHaveLength(3);
    expect(secondRound).toHaveLength(3);
    expect(firstRound.every(({ reviewer, draft: peerDraft }) => reviewer.id !== peerDraft.agentId)).toBe(
      true
    );
    expect(firstRound.map(({ reviewer }) => reviewer.id)).not.toEqual(
      secondRound.map(({ reviewer }) => reviewer.id)
    );
  });

  it("creates no self review when an agent is the only eligible reviewer", () => {
    const onlyAgent = agent("a", 0);
    expect(buildReviewAssignments([onlyAgent], [draft("a")], "all_to_all", 1)).toEqual([]);
    expect(buildReviewAssignments([onlyAgent], [draft("a")], "round_robin", 1)).toEqual([]);
  });
});

function agent(id: string, position: number): ExecutionAgent {
  return {
    id,
    name: id.toUpperCase(),
    model: "model",
    roles: ["draft", "review", "synthesize"],
    instructions: "",
    position,
    parameters: {},
    connection: {
      id: `connection-${id}`,
      kind: "custom",
      protocol: "chat_completions",
      baseUrl: "https://provider.example/v1",
      credential: "secret"
    }
  };
}

function draft(agentId: string): StoredArtifact {
  return {
    id: `draft-${agentId}`,
    kind: "draft",
    agentId,
    targetAgentId: null,
    content: `Draft by ${agentId}`,
    status: "complete",
    latencyMs: 1,
    inputTokens: 1,
    outputTokens: 1,
    error: null
  };
}
