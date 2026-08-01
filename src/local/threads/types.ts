export type LocalThreadProvider = "codex" | "claude_code" | "gemini_cli" | "kimi_cli" | "claude_desktop" | "kimi_desktop";

export interface LocalThreadSummary {
  id: string;
  provider: LocalThreadProvider;
  title: string;
  preview: string;
  workingDirectory: string | null;
  updatedAt: string;
  archived: boolean;
}

export interface LocalThreadImport extends LocalThreadSummary {
  content: string;
  messageCount: number;
  truncated: boolean;
}

export interface LocalThreadSource {
  provider: LocalThreadProvider;
  name: string;
  status: "available" | "not_installed" | "unsupported" | "error";
  threadCount: number;
  detail: string;
}

export interface LocalThreadDiscoveryPayload {
  sources: LocalThreadSource[];
  threads: LocalThreadSummary[];
}
