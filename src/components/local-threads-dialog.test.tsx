import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalThreadsDialog } from "@/components/local-threads-dialog";
import { relayApi } from "@/components/api-client";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LocalThreadsDialog", () => {
  it("does not render or search local working-directory paths", async () => {
    vi.spyOn(relayApi, "getLocalThreads").mockResolvedValue({
      sources: [{
        provider: "claude_code",
        name: "Claude Code",
        status: "available",
        threadCount: 1,
        detail: "Read-only local task discovery"
      }],
      threads: [{
        id: "claude_code:task-1",
        provider: "claude_code",
        title: "Review deployment plan",
        preview: "Review the deployment plan",
        workingDirectory: "/Users/example/Private Client/release-work",
        updatedAt: "2026-08-02T10:00:00.000Z",
        archived: false
      }]
    });

    render(<LocalThreadsDialog open onClose={vi.fn()} onSelect={vi.fn()} />);

    await screen.findByRole("button", { name: /review deployment plan/i });
    expect(screen.queryByText("/Users/example/Private Client/release-work")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Search local AI tasks" }), {
      target: { value: "Private Client" }
    });

    expect(screen.getByText("No matching local tasks")).toBeInTheDocument();
  });
});
