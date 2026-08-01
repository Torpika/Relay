import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { ProviderError } from "@/orchestration/providers/errors";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ProviderClientOptions,
  ProviderConnection
} from "@/orchestration/providers/types";

interface CodexToolOutput {
  threadId: string;
  content: string;
}

const reasoningWorkerInstructions = [
  "You are a bounded reasoning worker inside Relay.",
  "Use only the prompt and developer instructions supplied for this turn.",
  "Do not call tools, execute commands, inspect files, browse, spawn agents, or modify external state.",
  "Return only the requested result as plain text."
].join(" ");

const disabledCodexFeatures = {
  "agents.enabled": false,
  "features.apps": false,
  "features.browser_use": false,
  "features.computer_use": false,
  "features.image_generation": false,
  "features.in_app_browser": false,
  "features.multi_agent": false,
  "features.shell_tool": false,
  "features.unified_exec": false
};

export interface CodexRuntime {
  generate(request: ModelRequest, timeoutMs: number): Promise<ModelResponse>;
  close(): Promise<void>;
}

class CodexMcpRuntime implements CodexRuntime {
  readonly #threadIds = new Map<string, string>();
  #client: Client | null = null;
  #transport: StdioClientTransport | null = null;
  #connecting: Promise<Client> | null = null;

  async generate(request: ModelRequest, timeoutMs: number): Promise<ModelResponse> {
    const startedAt = performance.now();
    const client = await this.connect();
    const sessionKey = request.sessionKey ?? crypto.randomUUID();
    const threadId = this.#threadIds.get(sessionKey);
    const toolName = threadId ? "codex-reply" : "codex";
    const argumentsValue = threadId
      ? { threadId, prompt: request.input }
      : {
          prompt: request.input,
          cwd: process.env.RELAY_CODEX_CWD ?? process.cwd(),
          sandbox: process.env.RELAY_CODEX_SANDBOX ?? "read-only",
          "approval-policy": "never",
          "base-instructions": reasoningWorkerInstructions,
          "developer-instructions": request.instructions,
          config: {
            ...disabledCodexFeatures,
            ...(request.reasoningEffort ? { model_reasoning_effort: request.reasoningEffort } : {})
          },
          ...(request.model && request.model !== "default" ? { model: request.model } : {})
        };

    try {
      const result = await client.callTool(
        { name: toolName, arguments: argumentsValue },
        undefined,
        {
          signal: request.signal,
          timeout: timeoutMs,
          maxTotalTimeout: timeoutMs,
          resetTimeoutOnProgress: true
        }
      );

      if (result.isError) {
        throw new ProviderError(toolErrorMessage(result), {
          code: "server_error",
          retryable: true
        });
      }

      const output = parseCodexToolOutput(result);
      this.#threadIds.set(sessionKey, output.threadId);
      const inputTokens = estimatedTokens(`${request.instructions}\n${request.input}`);
      const outputTokens = estimatedTokens(output.content);

      return {
        content: output.content,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens
        },
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        providerResponseId: output.threadId,
        providerRequestId: null
      };
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }

      if (request.signal?.aborted) {
        throw new ProviderError("Local Codex request was cancelled", {
          code: "cancelled",
          retryable: false,
          cause: error
        });
      }

      const message = error instanceof Error ? error.message : "Local Codex MCP request failed";
      throw new ProviderError(message, {
        code: message.toLowerCase().includes("timeout") ? "timeout" : "network",
        retryable: true,
        cause: error
      });
    }
  }

  async close(): Promise<void> {
    const client = this.#client;
    this.#client = null;
    this.#transport = null;
    this.#connecting = null;
    this.#threadIds.clear();
    await client?.close();
  }

  private async connect(): Promise<Client> {
    if (this.#client) {
      return this.#client;
    }

    if (this.#connecting) {
      return this.#connecting;
    }

    this.#connecting = this.createClient();

    try {
      this.#client = await this.#connecting;
      return this.#client;
    } finally {
      this.#connecting = null;
    }
  }

  private async createClient(): Promise<Client> {
    const transport = new StdioClientTransport({
      command: process.env.CODEX_BINARY ?? "codex",
      args: ["mcp-server"],
      cwd: process.env.RELAY_CODEX_CWD ?? process.cwd(),
      env: getDefaultEnvironment(),
      stderr: "pipe"
    });
    transport.stderr?.on("data", () => undefined);
    const client = new Client({ name: "relay-local-worker", version: "0.1.0" });
    await client.connect(transport);
    this.#transport = transport;
    return client;
  }
}

let sharedRuntime: CodexRuntime | null = null;

export function getCodexRuntime(): CodexRuntime {
  sharedRuntime ??= new CodexMcpRuntime();
  return sharedRuntime;
}

export async function closeCodexRuntime(): Promise<void> {
  const runtime = sharedRuntime;
  sharedRuntime = null;
  await runtime?.close();
}

export class CodexMcpProvider implements ModelProvider {
  readonly #timeoutMs: number;
  readonly #runtime: CodexRuntime;

  constructor(
    connection: ProviderConnection,
    options: ProviderClientOptions = {},
    runtime: CodexRuntime = getCodexRuntime()
  ) {
    if (connection.protocol !== "codex_mcp") {
      throw new Error("CodexMcpProvider requires a codex_mcp connection");
    }

    this.#timeoutMs = options.timeoutMs ?? 120_000;
    this.#runtime = runtime;
  }

  generate(request: ModelRequest): Promise<ModelResponse> {
    return this.#runtime.generate(request, this.#timeoutMs);
  }
}

function parseCodexToolOutput(result: unknown): CodexToolOutput {
  if (!isRecord(result)) {
    throw malformedCodexResponse();
  }

  if (isCodexToolOutput(result.structuredContent)) {
    return result.structuredContent;
  }

  if (isCodexToolOutput(result.toolResult)) {
    return result.toolResult;
  }

  const content = Array.isArray(result.content) ? result.content : [];

  for (const item of content) {
    if (!isRecord(item) || item.type !== "text" || typeof item.text !== "string") {
      continue;
    }

    try {
      const parsed = JSON.parse(item.text) as unknown;

      if (isCodexToolOutput(parsed)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  throw malformedCodexResponse();
}

function isCodexToolOutput(value: unknown): value is CodexToolOutput {
  return isRecord(value) && typeof value.threadId === "string" && typeof value.content === "string";
}

function toolErrorMessage(result: unknown): string {
  const content = isRecord(result) && Array.isArray(result.content) ? result.content : [];
  const text = content.find((item) => isRecord(item) && item.type === "text" && typeof item.text === "string");
  return text && isRecord(text) && typeof text.text === "string"
    ? text.text.slice(0, 1_000)
    : "Local Codex MCP returned an error";
}

function malformedCodexResponse(): ProviderError {
  return new ProviderError("Codex MCP returned a malformed response", {
    code: "malformed_response",
    retryable: false
  });
}

function estimatedTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
