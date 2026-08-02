import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { discoverLocalThreads, importLocalThread } from "@/local/threads/discover";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("discoverLocalThreads", () => {
  it("reads the Codex task index without returning private database paths", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const userHome = await mkdtemp(join(tmpdir(), "relay-thread-discovery-"));
    temporaryDirectories.push(userHome);
    const codexDirectory = join(userHome, ".codex");
    mkdirSync(codexDirectory, { recursive: true });
    const database = new DatabaseSync(join(codexDirectory, "state_5.sqlite"));
    database.exec(`
      CREATE TABLE threads (
        id TEXT,
        title TEXT,
        name TEXT,
        preview TEXT,
        first_user_message TEXT,
        cwd TEXT,
        updated_at_ms INTEGER,
        updated_at INTEGER,
        archived INTEGER,
        recency_at_ms INTEGER,
        rollout_path TEXT
      )
    `);
    database.prepare(`
      INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("thread-1", "Review launch", null, "Check the launch plan", "Check it", "/project", 1_700_000_000_000, 1_700_000_000, 0, 1_700_000_000_000, "");
    database.close();

    const result = discoverLocalThreads(userHome);

    expect(result.threads).toEqual([
      expect.objectContaining({
        id: "codex:thread-1",
        provider: "codex",
        title: "Review launch",
        preview: "Check the launch plan",
        workingDirectory: "/project"
      })
    ]);
    expect(JSON.stringify(result)).not.toContain("state_5.sqlite");
  });

  it("imports the user and assistant transcript while excluding Codex system messages", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const userHome = await mkdtemp(join(tmpdir(), "relay-thread-import-"));
    temporaryDirectories.push(userHome);
    const codexDirectory = join(userHome, ".codex");
    mkdirSync(codexDirectory, { recursive: true });
    const rolloutPath = join(codexDirectory, "rollout.jsonl");
    writeFileSync(rolloutPath, [
      { type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "Private system prompt" }] } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Fix the release plan" }] } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "I found two risks." }] } }
    ].map((value) => JSON.stringify(value)).join("\n"));
    const database = new DatabaseSync(join(codexDirectory, "state_5.sqlite"));
    database.exec(`
      CREATE TABLE threads (
        id TEXT, title TEXT, name TEXT, preview TEXT, first_user_message TEXT, cwd TEXT,
        updated_at_ms INTEGER, updated_at INTEGER, archived INTEGER, recency_at_ms INTEGER,
        rollout_path TEXT
      )
    `);
    database.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("thread-2", "Release plan", null, "Fix the release plan", "Fix it", "/project", 1_700_000_000_000, 1_700_000_000, 0, 1_700_000_000_000, rolloutPath);
    database.close();

    const result = importLocalThread("codex:thread-2", userHome);

    expect(result).toEqual(expect.objectContaining({
      messageCount: 2,
      content: "User:\nFix the release plan\n\nAssistant:\nI found two risks."
    }));
    expect(result?.content).not.toContain("Private system prompt");
  });

  it("reports unsupported desktop caches without inspecting them", () => {
    const result = discoverLocalThreads("/path/that/does/not/exist");

    expect(result.sources.find((source) => source.provider === "claude_desktop")?.status).toBe("not_installed");
    expect(result.sources.find((source) => source.provider === "kimi_desktop")?.threadCount).toBe(0);
  });

  it("discovers and imports Kimi Code sessions without trusting paths outside its session directory", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const userHome = await mkdtemp(join(tmpdir(), "relay-kimi-discovery-"));
    temporaryDirectories.push(userHome);
    const kimiRoot = join(userHome, ".kimi-code");
    const sessionDirectory = join(kimiRoot, "sessions", "demo-session");
    mkdirSync(join(sessionDirectory, "agents", "main"), { recursive: true });
    writeFileSync(join(kimiRoot, "session_index.jsonl"), [
      { sessionId: "kimi-1", sessionDir: "sessions/demo-session", workDir: "/project" },
      { sessionId: "unsafe", sessionDir: "../outside", workDir: "/private" }
    ].map((value) => JSON.stringify(value)).join("\n"));
    writeFileSync(join(sessionDirectory, "state.json"), JSON.stringify({
      title: "Review the launch brief",
      lastPrompt: "Find gaps in the launch brief",
      updatedAt: "2025-01-02T03:04:05.000Z"
    }));
    writeFileSync(join(sessionDirectory, "agents", "main", "wire.jsonl"), [
      { role: "system", content: "Private system prompt" },
      { role: "user", content: "Find gaps in the launch brief" },
      { message: { role: "assistant", content: [{ type: "text", text: "Two gaps need attention." }] } }
    ].map((value) => JSON.stringify(value)).join("\n"));

    const discovery = discoverLocalThreads(userHome);
    const imported = importLocalThread("kimi_cli:kimi-1", userHome);

    expect(discovery.threads.filter((thread) => thread.provider === "kimi_cli")).toEqual([
      expect.objectContaining({
        id: "kimi_cli:kimi-1",
        title: "Review the launch brief",
        workingDirectory: "/project"
      })
    ]);
    expect(imported).toEqual(expect.objectContaining({
      messageCount: 2,
      content: "User:\nFind gaps in the launch brief\n\nAssistant:\nTwo gaps need attention."
    }));
    expect(imported?.content).not.toContain("Private system prompt");
  });

  it("prioritizes the most recent Gemini sessions when a local history exceeds the import cap", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const userHome = await mkdtemp(join(tmpdir(), "relay-gemini-recency-"));
    temporaryDirectories.push(userHome);
    const sessionsPath = join(userHome, ".gemini", "tmp");
    mkdirSync(sessionsPath, { recursive: true });

    for (let index = 0; index <= 200; index += 1) {
      const sessionPath = join(sessionsPath, `session-${String(index).padStart(3, "0")}.json`);
      const updatedAt = new Date(1_700_000_000_000 + index * 1_000);
      writeFileSync(sessionPath, JSON.stringify({
        sessionId: `session-${index}`,
        lastUpdated: updatedAt.toISOString(),
        messages: [{ role: "user", content: `Task ${index}` }]
      }));
      utimesSync(sessionPath, updatedAt, updatedAt);
    }

    const threads = discoverLocalThreads(userHome).threads.filter((thread) => thread.provider === "gemini_cli");

    expect(threads).toHaveLength(200);
    expect(threads.some((thread) => thread.id === "gemini_cli:session-200")).toBe(true);
    expect(threads.some((thread) => thread.id === "gemini_cli:session-000")).toBe(false);
  });
});
