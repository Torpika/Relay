import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionRail } from "@/components/session-rail";
import type { ConversationSummary, Viewer } from "@/lib/contracts";

const viewer: Viewer = {
  id: "viewer",
  name: "Relay Operator",
  email: "operator@example.test",
  workspaceId: "workspace",
  workspaceName: "Local workspace",
  role: "owner"
};

const conversations: ConversationSummary[] = [
  {
    id: "launch",
    title: "Launch review",
    objective: "Check release risk",
    status: "running",
    phase: "reviewing",
    iteration: 2,
    agentCount: 3,
    updatedAt: "2026-08-02T00:00:00.000Z",
    totalTokens: 1200
  },
  {
    id: "architecture",
    title: "Architecture review",
    objective: "Assess the system design",
    status: "idle",
    phase: "idle",
    iteration: 0,
    agentCount: 2,
    updatedAt: "2026-08-02T00:00:00.000Z",
    totalTokens: 0
  }
];

afterEach(cleanup);

function renderRail() {
  return render(<SessionRail
    viewer={viewer}
    canOperate
    conversations={conversations}
    activeConversationId={null}
    mobileOpen={false}
    onCloseMobile={vi.fn()}
    onSelectConversation={vi.fn()}
    onCreateSession={vi.fn()}
    onImportThread={vi.fn()}
    onAddAgent={vi.fn()}
    onLogout={vi.fn()}
  />);
}

describe("SessionRail", () => {
  it("focuses session search with the advertised command shortcut", () => {
    renderRail();

    const search = screen.getByPlaceholderText("Search sessions");
    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(search).toHaveFocus();
  });

  it("filters sessions after focusing search", () => {
    renderRail();

    fireEvent.change(screen.getByPlaceholderText("Search sessions"), { target: { value: "architecture" } });

    expect(screen.getByRole("button", { name: /Architecture review/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Launch review/i })).not.toBeInTheDocument();
  });
});
