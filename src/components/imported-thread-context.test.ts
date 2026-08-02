import { describe, expect, it } from "vitest";
import { buildImportedThreadSessionValues } from "@/components/imported-thread-context";
import type { LocalThreadImport } from "@/local/threads/types";

const thread: LocalThreadImport = {
  id: "claude_code:task-1",
  provider: "claude_code",
  title: "Review deployment plan",
  preview: "Review the deployment plan",
  workingDirectory: "/Users/example/Private Client/release-work",
  updatedAt: "2026-08-02T10:00:00.000Z",
  archived: false,
  content: "User:\nReview the deployment plan",
  messageCount: 1,
  truncated: false
};

describe("buildImportedThreadSessionValues", () => {
  it("preserves the selected transcript without automatically copying its local workspace path", () => {
    const values = buildImportedThreadSessionValues(thread);

    expect(values.title).toBe("Review · Review deployment plan");
    expect(values.objective).toContain("Source: claude_code");
    expect(values.objective).toContain(thread.content);
    expect(values.objective).not.toContain(thread.workingDirectory as string);
  });
});
