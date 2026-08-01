import type { ProviderKind, ProviderProtocol } from "@/lib/contracts";

export interface ProviderPreset {
  kind: ProviderKind;
  name: string;
  description: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  modelPlaceholder: string;
}

export const providerPresets: ProviderPreset[] = [
  {
    kind: "local_codex",
    name: "Local Codex",
    description: "Uses Codex Desktop's existing ChatGPT login through a local MCP server. No API key.",
    baseUrl: "local://codex",
    protocol: "codex_mcp",
    modelPlaceholder: "default"
  },
  {
    kind: "local_claude",
    name: "Local Claude Code",
    description: "Uses an installed Claude Code CLI and its existing local login. No API key.",
    baseUrl: "local://claude",
    protocol: "local_cli",
    modelPlaceholder: "default"
  },
  {
    kind: "local_gemini",
    name: "Local Gemini CLI",
    description: "Uses an installed Gemini CLI and its existing local login. No API key.",
    baseUrl: "local://gemini",
    protocol: "local_cli",
    modelPlaceholder: "auto"
  },
  {
    kind: "local_kimi",
    name: "Local Kimi Code",
    description: "Uses an installed Kimi Code CLI and its existing local login. No API key.",
    baseUrl: "local://kimi",
    protocol: "local_cli",
    modelPlaceholder: "default"
  },
  {
    kind: "openai",
    name: "OpenAI / Codex",
    description: "OpenAI Responses API models, including Codex-capable models available to your project.",
    baseUrl: "https://api.openai.com/v1",
    protocol: "responses",
    modelPlaceholder: "gpt-5"
  },
  {
    kind: "xai",
    name: "xAI / Grok",
    description: "Grok models through xAI's OpenAI-compatible API.",
    baseUrl: "https://api.x.ai/v1",
    protocol: "responses",
    modelPlaceholder: "grok-4.5"
  },
  {
    kind: "moonshot",
    name: "Moonshot / Kimi",
    description: "Kimi models through Moonshot's global OpenAI-compatible API.",
    baseUrl: "https://api.moonshot.ai/v1",
    protocol: "chat_completions",
    modelPlaceholder: "kimi-k2.6"
  },
  {
    kind: "custom",
    name: "Custom endpoint",
    description: "An operator-approved OpenAI-compatible HTTPS endpoint.",
    baseUrl: "",
    protocol: "chat_completions",
    modelPlaceholder: "your-model-id"
  }
];

export function getProviderPreset(kind: ProviderKind): ProviderPreset {
  const preset = providerPresets.find((candidate) => candidate.kind === kind);

  if (!preset) {
    throw new Error(`Unknown provider kind: ${kind}`);
  }

  return preset;
}
