import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  LocalThreadDiscoveryPayload,
  LocalThreadImport,
  LocalThreadProvider,
  LocalThreadSource,
  LocalThreadSummary
} from "@/local/threads/types";

const maximumThreadsPerSource = 200;
const maximumDirectoriesPerSourceScan = 4_000;
const maximumThreadFileBytes = 2_000_000;
const maximumImportFileBytes = 25_000_000;
const maximumImportedContentCharacters = 36_000;

export function discoverLocalThreads(userHome = homedir()): LocalThreadDiscoveryPayload {
  const discoveries = [
    discoverCodexThreads(userHome),
    discoverClaudeCodeThreads(userHome),
    discoverGeminiThreads(userHome),
    discoverKimiCodeThreads(userHome),
    detectUnsupportedDesktopSource(
      "claude_desktop",
      "Claude Desktop",
      join(userHome, "Library", "Application Support", "Claude")
    ),
    detectUnsupportedDesktopSource(
      "kimi_desktop",
      "Kimi Desktop",
      join(userHome, "Library", "Application Support", "kimi-desktop")
    )
  ];

  return {
    sources: discoveries.map((discovery) => discovery.source),
    threads: discoveries
      .flatMap((discovery) => discovery.threads)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  };
}

export function importLocalThread(threadId: string, userHome = homedir()): LocalThreadImport | null {
  const summary = discoverLocalThreads(userHome).threads.find((thread) => thread.id === threadId);

  if (!summary) {
    return null;
  }

  const messages = summary.provider === "codex"
    ? importCodexMessages(threadId.slice("codex:".length), userHome)
    : summary.provider === "claude_code"
      ? importClaudeCodeMessages(threadId, userHome)
      : summary.provider === "gemini_cli"
        ? importGeminiMessages(threadId, userHome)
        : summary.provider === "kimi_cli"
          ? importKimiCodeMessages(threadId, userHome)
        : [];
  const transcript = formatTranscript(messages);

  return {
    ...summary,
    content: transcript.content || summary.preview,
    messageCount: messages.length,
    truncated: transcript.truncated
  };
}

function discoverCodexThreads(userHome: string): SourceDiscovery {
  const databasePath = codexDatabasePath(userHome);

  if (!databasePath) {
    return missingSource("codex", "Codex", "No local Codex task database was found.");
  }

  try {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const rows = database.prepare(`
      SELECT id, title, name, preview, first_user_message, cwd, updated_at_ms, updated_at, archived
      FROM threads
      WHERE preview <> '' OR first_user_message <> '' OR title <> ''
      ORDER BY recency_at_ms DESC, updated_at_ms DESC
      LIMIT ?
    `).all(maximumThreadsPerSource) as unknown as CodexThreadRow[];
    database.close();
    const threads = rows.map((row) => ({
      id: `codex:${row.id}`,
      provider: "codex" as const,
      title: cleanText(row.name || row.title || row.first_user_message, 160) || "Untitled Codex task",
      preview: cleanText(row.preview || row.first_user_message, 1_000),
      workingDirectory: row.cwd || null,
      updatedAt: timestampToIso(row.updated_at_ms || row.updated_at * 1_000),
      archived: Boolean(row.archived)
    }));

    return availableSource("codex", "Codex", threads, "Imported from Codex's local task index in read-only mode.");
  } catch (error) {
    return failedSource("codex", "Codex", error);
  }
}

function importCodexMessages(threadId: string, userHome: string): TranscriptMessage[] {
  const databasePath = codexDatabasePath(userHome);

  if (!databasePath) {
    return [];
  }

  const database = new DatabaseSync(databasePath, { readOnly: true });
  const row = database.prepare("SELECT rollout_path FROM threads WHERE id = ? LIMIT 1").get(threadId) as
    | { rollout_path?: string }
    | undefined;
  database.close();

  if (!row?.rollout_path || !isImportableFile(row.rollout_path)) {
    return [];
  }

  return readJsonLines(row.rollout_path).flatMap((record) => {
    if (record.type !== "response_item" || !isRecord(record.payload) || record.payload.type !== "message") {
      return [];
    }

    const role = record.payload.role;

    if (role !== "user" && role !== "assistant") {
      return [];
    }

    const rawContent = extractMessageText(record.payload.content);
    const content = role === "user" ? normalizeImportedUserMessage(rawContent) : rawContent.trim();
    return content ? [{ role, content }] : [];
  });
}

function importClaudeCodeMessages(threadId: string, userHome: string): TranscriptMessage[] {
  const projectsPath = join(userHome, ".claude", "projects");
  const path = existsSync(projectsPath)
    ? listFiles(projectsPath, ".jsonl", maximumThreadsPerSource)
      .find((candidate) => parseClaudeCodeThread(candidate)?.id === threadId)
    : undefined;

  if (!path || !isImportableFile(path)) {
    return [];
  }

  return readJsonLines(path).flatMap((record) => {
    if (!isRecord(record.message)) {
      return [];
    }

    const role = record.message.role ?? record.type;

    if (role !== "user" && role !== "assistant") {
      return [];
    }

    const content = extractMessageText(record.message.content).trim();
    return content ? [{ role, content }] : [];
  });
}

function importGeminiMessages(threadId: string, userHome: string): TranscriptMessage[] {
  const root = join(userHome, ".gemini", "tmp");
  const path = existsSync(root)
    ? listFiles(root, ".json", maximumThreadsPerSource)
      .find((candidate) => basename(candidate).startsWith("session-") && parseGeminiThread(candidate)?.id === threadId)
    : undefined;

  if (!path || !isImportableFile(path)) {
    return [];
  }

  const value = parseJsonRecord(readFileSync(path, "utf8"));
  const messages = isRecord(value) && Array.isArray(value.messages) ? value.messages.filter(isRecord) : [];

  return messages.flatMap((message) => {
    const role = message.role ?? message.type;

    if (role !== "user" && role !== "assistant" && role !== "model") {
      return [];
    }

    const content = extractMessageText(message.content ?? message.message).trim();
    return content ? [{ role: role === "model" ? "assistant" : role, content }] : [];
  });
}

function discoverClaudeCodeThreads(userHome: string): SourceDiscovery {
  const projectsPath = join(userHome, ".claude", "projects");

  if (!existsSync(projectsPath)) {
    return missingSource("claude_code", "Claude Code", "Claude Code has no local projects directory.");
  }

  try {
    const threads = listFiles(projectsPath, ".jsonl", maximumThreadsPerSource)
      .map((path) => parseClaudeCodeThread(path))
      .filter((thread): thread is LocalThreadSummary => Boolean(thread));
    return availableSource("claude_code", "Claude Code", threads, "Imported from Claude Code project transcripts in read-only mode.");
  } catch (error) {
    return failedSource("claude_code", "Claude Code", error);
  }
}

function discoverGeminiThreads(userHome: string): SourceDiscovery {
  const geminiPath = join(userHome, ".gemini", "tmp");

  if (!existsSync(geminiPath)) {
    return missingSource("gemini_cli", "Gemini CLI", "Gemini CLI has no local task directory.");
  }

  try {
    const threads = listFiles(geminiPath, ".json", maximumThreadsPerSource)
      .filter((path) => basename(path).startsWith("session-"))
      .map((path) => parseGeminiThread(path))
      .filter((thread): thread is LocalThreadSummary => Boolean(thread));
    return availableSource("gemini_cli", "Gemini CLI", threads, "Imported from Gemini CLI session files in read-only mode.");
  } catch (error) {
    return failedSource("gemini_cli", "Gemini CLI", error);
  }
}

function discoverKimiCodeThreads(userHome: string): SourceDiscovery {
  const root = join(userHome, ".kimi-code");
  const indexPath = join(root, "session_index.jsonl");

  if (!existsSync(indexPath)) {
    return missingSource("kimi_cli", "Kimi Code", "Kimi Code has no local session index.");
  }

  try {
    const threads = readJsonLines(indexPath)
      .slice(0, maximumThreadsPerSource)
      .map((record) => parseKimiCodeThread(record, root))
      .filter((thread): thread is LocalThreadSummary => Boolean(thread));
    return availableSource("kimi_cli", "Kimi Code", threads, "Imported from Kimi Code session files in read-only mode.");
  } catch (error) {
    return failedSource("kimi_cli", "Kimi Code", error);
  }
}

function importKimiCodeMessages(threadId: string, userHome: string): TranscriptMessage[] {
  const root = join(userHome, ".kimi-code");
  const indexPath = join(root, "session_index.jsonl");

  if (!isImportableFile(indexPath)) {
    return [];
  }

  const sessionId = threadId.slice("kimi_cli:".length);
  const entry = readJsonLines(indexPath).find((record) => record.sessionId === sessionId);
  const sessionDirectory = entry ? safeSessionDirectory(root, entry.sessionDir) : null;
  const transcriptPath = sessionDirectory ? join(sessionDirectory, "agents", "main", "wire.jsonl") : null;

  if (!transcriptPath || !isImportableFile(transcriptPath)) {
    return [];
  }

  return readJsonLines(transcriptPath).flatMap((record) => {
    const message = isRecord(record.message) ? record.message : record;
    const role = message.role;

    if (role !== "user" && role !== "assistant") {
      return [];
    }

    const content = extractMessageText(message.content ?? message.text).trim();
    return content ? [{ role, content }] : [];
  });
}

function parseClaudeCodeThread(path: string): LocalThreadSummary | null {
  if (statSync(path).size > maximumThreadFileBytes) {
    return null;
  }

  const records = readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .slice(0, 250)
    .map(parseJsonRecord)
    .filter(isRecord);
  const firstUserRecord = records.find((record) => record.type === "user" && isRecord(record.message));
  const message = firstUserRecord && isRecord(firstUserRecord.message) ? firstUserRecord.message : null;
  const content = message ? extractMessageText(message.content) : "";
  const latestTimestamp = records
    .map((record) => typeof record.timestamp === "string" ? Date.parse(record.timestamp) : 0)
    .reduce((latest, candidate) => Math.max(latest, candidate), statSync(path).mtimeMs);
  const sessionId = records.find((record) => typeof record.sessionId === "string")?.sessionId;
  const workingDirectory = records.find((record) => typeof record.cwd === "string")?.cwd;

  if (!content && typeof sessionId !== "string") {
    return null;
  }

  return {
    id: `claude_code:${typeof sessionId === "string" ? sessionId : basename(path, ".jsonl")}`,
    provider: "claude_code",
    title: cleanText(content, 160) || "Untitled Claude Code task",
    preview: cleanText(content, 1_000),
    workingDirectory: typeof workingDirectory === "string" ? workingDirectory : null,
    updatedAt: timestampToIso(latestTimestamp),
    archived: false
  };
}

function parseGeminiThread(path: string): LocalThreadSummary | null {
  if (statSync(path).size > maximumThreadFileBytes) {
    return null;
  }

  const value = parseJsonRecord(readFileSync(path, "utf8"));

  if (!isRecord(value)) {
    return null;
  }

  const messages = Array.isArray(value.messages) ? value.messages.filter(isRecord) : [];
  const userMessage = messages.find((message) => message.type === "user" || message.role === "user");
  const content = userMessage ? extractMessageText(userMessage.content ?? userMessage.message) : "";
  const sessionId = typeof value.sessionId === "string" ? value.sessionId : basename(path, ".json");
  const updatedAt = typeof value.lastUpdated === "string"
    ? Date.parse(value.lastUpdated)
    : statSync(path).mtimeMs;

  return {
    id: `gemini_cli:${sessionId}`,
    provider: "gemini_cli",
    title: cleanText(content, 160) || "Untitled Gemini task",
    preview: cleanText(content, 1_000),
    workingDirectory: typeof value.cwd === "string" ? value.cwd : null,
    updatedAt: timestampToIso(updatedAt),
    archived: false
  };
}

function parseKimiCodeThread(record: Record<string, unknown>, root: string): LocalThreadSummary | null {
  if (typeof record.sessionId !== "string") {
    return null;
  }

  const sessionDirectory = safeSessionDirectory(root, record.sessionDir);

  if (!sessionDirectory) {
    return null;
  }

  const statePath = join(sessionDirectory, "state.json");

  if (!isImportableFile(statePath) || statSync(statePath).size > maximumThreadFileBytes) {
    return null;
  }

  const state = parseJsonRecord(readFileSync(statePath, "utf8"));

  if (!isRecord(state)) {
    return null;
  }

  const title = typeof state.title === "string" ? state.title : "";
  const lastPrompt = typeof state.lastPrompt === "string" ? state.lastPrompt : "";
  const updatedAt = parseTimestamp(state.updatedAt ?? state.updated_at, statSync(statePath).mtimeMs);

  return {
    id: `kimi_cli:${record.sessionId}`,
    provider: "kimi_cli",
    title: cleanText(title || lastPrompt, 160) || "Untitled Kimi Code task",
    preview: cleanText(lastPrompt || title, 1_000),
    workingDirectory: typeof record.workDir === "string" ? record.workDir : null,
    updatedAt: timestampToIso(updatedAt),
    archived: false
  };
}

function safeSessionDirectory(root: string, value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const sessionsRoot = resolve(root, "sessions");
  const candidate = resolve(root, value);
  const relativePath = relative(sessionsRoot, candidate);

  if (!relativePath || relativePath.startsWith("..") || relativePath.startsWith("/")) {
    return null;
  }

  if (!existsSync(candidate)) {
    return candidate;
  }

  const realSessionsRoot = existsSync(sessionsRoot) ? realpathSync(sessionsRoot) : sessionsRoot;
  const realCandidate = realpathSync(candidate);
  const realRelativePath = relative(realSessionsRoot, realCandidate);
  return realRelativePath && !realRelativePath.startsWith("..") && !realRelativePath.startsWith("/")
    ? realCandidate
    : null;
}

function parseTimestamp(value: unknown, fallback: number): number {
  if (typeof value === "number") {
    return value < 10_000_000_000 ? value * 1_000 : value;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? fallback : parsed;
  }

  return fallback;
}

function listFiles(root: string, extension: string, limit: number): string[] {
  const pending = [root];
  const files: Array<{ path: string; modifiedAt: number }> = [];
  let visitedDirectories = 0;

  while (pending.length && visitedDirectories < maximumDirectoriesPerSourceScan) {
    const directory = pending.pop();

    if (!directory) {
      break;
    }

    visitedDirectories += 1;

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile() && entry.name.endsWith(extension)) {
        files.push({ path, modifiedAt: statSync(path).mtimeMs });
      }
    }
  }

  return files
    .sort((left, right) => right.modifiedAt - left.modifiedAt || left.path.localeCompare(right.path))
    .slice(0, limit)
    .map((file) => file.path);
}

function codexDatabasePath(userHome: string): string | undefined {
  return [
    join(userHome, ".codex", "state_5.sqlite"),
    join(userHome, ".codex", "sqlite", "state_5.sqlite")
  ].find(existsSync);
}

function readJsonLines(path: string): Record<string, unknown>[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map(parseJsonRecord)
    .filter(isRecord);
}

function isImportableFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile() && statSync(path).size <= maximumImportFileBytes;
}

function normalizeImportedUserMessage(content: string): string {
  const explicitRequestMarker = "## My request for Codex:";
  const explicitRequestIndex = content.indexOf(explicitRequestMarker);

  if (explicitRequestIndex >= 0) {
    return content.slice(explicitRequestIndex + explicitRequestMarker.length).trim();
  }

  if (content.trimStart().startsWith("<recommended_plugins>")) {
    return "";
  }

  return content.trim();
}

function formatTranscript(messages: TranscriptMessage[]): { content: string; truncated: boolean } {
  const formattedMessages = messages.map((message) =>
    `${message.role === "user" ? "User" : "Assistant"}:\n${message.content}`
  );
  const fullContent = formattedMessages.join("\n\n");

  if (fullContent.length <= maximumImportedContentCharacters) {
    return { content: fullContent, truncated: false };
  }

  const firstMessage = formattedMessages[0] ?? "";
  const tailBudget = Math.max(0, maximumImportedContentCharacters - firstMessage.length - 120);
  const tail = fullContent.slice(-tailBudget);
  return {
    content: `${firstMessage}\n\n[Earlier transcript content omitted to fit Relay's session limit.]\n\n${tail}`,
    truncated: true
  };
}

function extractMessageText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .filter(isRecord)
    .map((item) => typeof item.text === "string" ? item.text : typeof item.content === "string" ? item.content : "")
    .filter(Boolean)
    .join("\n");
}

function detectUnsupportedDesktopSource(
  provider: LocalThreadProvider,
  name: string,
  applicationDataPath: string
): SourceDiscovery {
  const installed = existsSync(applicationDataPath);
  return {
    source: {
      provider,
      name,
      status: installed ? "unsupported" : "not_installed",
      threadCount: 0,
      detail: installed
        ? `${name} does not expose a stable local transcript format. Relay will not inspect private browser caches.`
        : `${name} was not detected on this Mac.`
    },
    threads: []
  };
}

function availableSource(
  provider: LocalThreadProvider,
  name: string,
  threads: LocalThreadSummary[],
  detail: string
): SourceDiscovery {
  return {
    source: { provider, name, status: "available", threadCount: threads.length, detail },
    threads
  };
}

function missingSource(provider: LocalThreadProvider, name: string, detail: string): SourceDiscovery {
  return { source: { provider, name, status: "not_installed", threadCount: 0, detail }, threads: [] };
}

function failedSource(provider: LocalThreadProvider, name: string, error: unknown): SourceDiscovery {
  return {
    source: {
      provider,
      name,
      status: "error",
      threadCount: 0,
      detail: error instanceof Error ? error.message : `${name} thread discovery failed.`
    },
    threads: []
  };
}

function cleanText(value: string, maximumLength: number): string {
  return value.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim().slice(0, maximumLength);
}

function timestampToIso(value: number): string {
  const date = new Date(Number.isFinite(value) && value > 0 ? value : Date.now());
  return date.toISOString();
}

function parseJsonRecord(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface SourceDiscovery {
  source: LocalThreadSource;
  threads: LocalThreadSummary[];
}

interface CodexThreadRow {
  id: string;
  title: string;
  name: string | null;
  preview: string;
  first_user_message: string;
  cwd: string;
  updated_at_ms: number;
  updated_at: number;
  archived: number;
}

interface TranscriptMessage {
  role: "user" | "assistant";
  content: string;
}
