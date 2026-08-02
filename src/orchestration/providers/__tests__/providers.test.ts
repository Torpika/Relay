import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatCompletionsProvider } from "@/orchestration/providers/chat-completions";
import {
  CodexMcpProvider,
  type CodexRuntime
} from "@/orchestration/providers/codex-mcp";
import { ProviderError } from "@/orchestration/providers/errors";
import { ProviderHttpClient, resolveProviderUrl } from "@/orchestration/providers/http";
import { LocalCliProvider, type LocalCliRunner } from "@/orchestration/providers/local-cli";
import { serializeCustomLocalCliConfiguration } from "@/local/custom-cli";
import { ResponsesProvider } from "@/orchestration/providers/responses";
import type { ProviderConnection } from "@/orchestration/providers/types";

const responsesConnection: ProviderConnection = {
  id: "openai",
  kind: "openai",
  protocol: "responses",
  baseUrl: "https://api.openai.com/v1",
  credential: "secret"
};

const codexConnection: ProviderConnection = {
  id: "local-codex",
  kind: "local_codex",
  protocol: "codex_mcp",
  baseUrl: "local://codex"
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LocalCliProvider", () => {
  it("runs Claude Code in plan mode using the configured local login and reasoning level", async () => {
    vi.stubEnv("CLAUDE_BINARY", "/bin/echo");
    const runner: LocalCliRunner = {
      run: vi.fn(async () => ({
        stdout: JSON.stringify({
          result: "Claude review",
          session_id: "claude-session",
          usage: { input_tokens: 11, output_tokens: 4 }
        }),
        stderr: ""
      }))
    };
    const provider = new LocalCliProvider({
      id: "local-claude",
      kind: "local_claude",
      protocol: "local_cli",
      baseUrl: "local://claude"
    }, { timeoutMs: 5_000 }, runner);

    await expect(provider.generate({
      model: "sonnet",
      instructions: "Review carefully",
      input: "Check this draft",
      reasoningEffort: "high"
    })).resolves.toMatchObject({
      content: "Claude review",
      providerResponseId: "claude-session",
      usage: { inputTokens: 11, outputTokens: 4, totalTokens: 15 }
    });
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({
      command: "/bin/echo",
      args: ["-p", "--output-format", "json", "--permission-mode", "plan", "--model", "sonnet"],
      stdin: "Review carefully\n\nCheck this draft",
      env: expect.objectContaining({ CLAUDE_CODE_EFFORT_LEVEL: "high" })
    }));
  });

  it("runs Kimi Code in the isolated runtime and forwards its thinking effort", async () => {
    vi.stubEnv("KIMI_BINARY", "/bin/echo");
    const runner: LocalCliRunner = {
      run: vi.fn(async () => ({ stdout: "Kimi review", stderr: "" }))
    };
    const provider = new LocalCliProvider({
      id: "local-kimi",
      kind: "local_kimi",
      protocol: "local_cli",
      baseUrl: "local://kimi"
    }, {}, runner);

    await expect(provider.generate({
      model: "default",
      instructions: "Review",
      input: "Draft",
      reasoningEffort: "xhigh"
    })).resolves.toMatchObject({ content: "Kimi review" });
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({
      args: ["--prompt", "Review\n\nDraft", "--output-format", "text"],
      env: expect.objectContaining({
        KIMI_DISABLE_TELEMETRY: "1",
        KIMI_MODEL_THINKING_EFFORT: "xhigh"
      })
    }));
  });

  it("runs an explicitly configured custom local CLI without shell interpolation", async () => {
    const runner: LocalCliRunner = {
      run: vi.fn(async () => ({ stdout: "Custom review", stderr: "" }))
    };
    const provider = new LocalCliProvider({
      id: "local-custom",
      kind: "local_custom",
      protocol: "local_cli",
      baseUrl: "local://custom",
      credential: serializeCustomLocalCliConfiguration({
        command: "/bin/echo",
        args: ["--prompt", "{prompt}"]
      })
    }, {}, runner);

    await expect(provider.generate({
      model: "default",
      instructions: "Review",
      input: "Draft"
    })).resolves.toMatchObject({ content: "Custom review" });
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({
      command: "/bin/echo",
      args: ["--prompt", "Review\n\nDraft"],
      stdin: undefined
    }));
  });
});

describe("ResponsesProvider", () => {
  it("sends a Responses API request and aggregates all message text", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          id: "resp_1",
          output: [
            { type: "reasoning", summary: [] },
            {
              type: "message",
              content: [
                { type: "output_text", text: "First" },
                { type: "output_text", text: "Second" }
              ]
            }
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 5,
            total_tokens: 17,
            input_tokens_details: { cached_tokens: 3 }
          }
        },
        { "x-request-id": "request_1" }
      )
    );
    const provider = new ResponsesProvider(responsesConnection, {
      fetch: fetchMock,
      destinationValidator: async () => undefined
    });

    const result = await provider.generate({
      model: "gpt-test",
      instructions: "System rules",
      input: "Task data",
      maxOutputTokens: 400
    });

    expect(result).toMatchObject({
      content: "First\nSecond",
      providerResponseId: "resp_1",
      providerRequestId: "request_1",
      usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17, cachedInputTokens: 3 }
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("https://api.openai.com/v1/responses");
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({ Authorization: "Bearer secret" });
    expect(JSON.parse(String(init.body))).toEqual({
      model: "gpt-test",
      instructions: "System rules",
      input: "Task data",
      store: false,
      max_output_tokens: 400
    });
  });

  it("rejects a successful response with no assistant text", async () => {
    const provider = new ResponsesProvider(responsesConnection, {
      fetch: vi.fn(async () => jsonResponse({ id: "resp_1", output: [{ type: "reasoning" }] })),
      destinationValidator: async () => undefined
    });

    await expect(
      provider.generate({ model: "gpt-test", instructions: "Rules", input: "Input" })
    ).rejects.toMatchObject({ code: "malformed_response", retryable: false });
  });
});

describe("CodexMcpProvider", () => {
  it("uses the local runtime without a provider credential", async () => {
    const runtime: CodexRuntime = {
      generate: vi.fn(async () => ({
        content: "Local result",
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
        latencyMs: 8,
        providerResponseId: "thread-1",
        providerRequestId: null
      })),
      close: vi.fn(async () => undefined)
    };
    const provider = new CodexMcpProvider(codexConnection, { timeoutMs: 4_000 }, runtime);
    const request = {
      model: "default",
      instructions: "Be concise",
      input: "Evaluate this",
      sessionKey: "run:agent:draft"
    };

    await expect(provider.generate(request)).resolves.toMatchObject({
      content: "Local result",
      providerResponseId: "thread-1"
    });
    expect(runtime.generate).toHaveBeenCalledWith(request, 4_000);
  });

  it("rejects non-Codex protocols", () => {
    expect(() => new CodexMcpProvider(responsesConnection)).toThrow(
      "CodexMcpProvider requires a codex_mcp connection"
    );
  });
});

describe("ChatCompletionsProvider", () => {
  it("normalizes OpenAI-compatible chat output and usage", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: "chat_1",
        choices: [
          {
            message: {
              content: [
                { type: "text", text: "Part A" },
                { type: "text", text: "Part B" }
              ]
            }
          }
        ],
        usage: { prompt_tokens: 4, completion_tokens: 7, total_tokens: 11 }
      })
    );
    const provider = new ChatCompletionsProvider(
      {
        id: "kimi",
        kind: "moonshot",
        protocol: "chat_completions",
        baseUrl: "https://api.moonshot.ai/v1/",
        credential: "moonshot-key"
      },
      { fetch: fetchMock, destinationValidator: async () => undefined }
    );

    const result = await provider.generate({
      model: "kimi-test",
      instructions: "Rules",
      input: "Input",
      maxOutputTokens: 200
    });

    expect(result.content).toBe("Part A\nPart B");
    expect(result.usage).toEqual({ inputTokens: 4, outputTokens: 7, totalTokens: 11 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("https://api.moonshot.ai/v1/chat/completions");
    expect(JSON.parse(String(init.body))).toEqual({
      model: "kimi-test",
      messages: [
        { role: "system", content: "Rules" },
        { role: "user", content: "Input" }
      ],
      stream: false,
      max_tokens: 200
    });
  });
});

describe("ProviderHttpClient", () => {
  it.each([
    [401, "authentication", false],
    [403, "authorization", false],
    [404, "not_found", false],
    [429, "rate_limit", true],
    [503, "server_error", true]
  ])("normalizes HTTP %i errors", async (status, code, retryable) => {
    const client = new ProviderHttpClient(responsesConnection, {
      fetch: vi.fn(async () =>
        jsonResponse({ error: { message: "provider said no" } }, { "x-request-id": "req_error" }, status)
      ),
      destinationValidator: async () => undefined
    });

    await expect(client.post("responses", {})).rejects.toMatchObject({
      code,
      retryable,
      status,
      providerRequestId: "req_error",
      message: "provider said no"
    });
  });

  it("times out and cancels a hanging request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: URL | RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
    );
    const client = new ProviderHttpClient(responsesConnection, {
      fetch: fetchMock as typeof fetch,
      timeoutMs: 50,
      destinationValidator: async () => undefined
    });
    const pending = client.post("responses", {});
    const rejection = expect(pending).rejects.toMatchObject({ code: "timeout", retryable: true });

    await vi.advanceTimersByTimeAsync(50);
    await rejection;
  });

  it("distinguishes caller cancellation from a timeout", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_url: URL | RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
    );
    const client = new ProviderHttpClient(responsesConnection, {
      fetch: fetchMock as typeof fetch,
      timeoutMs: 1_000,
      destinationValidator: async () => undefined
    });
    const pending = client.post("responses", {}, controller.signal);

    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "cancelled", retryable: false });
  });

  it("does not expose credentials embedded in a base URL", () => {
    expect(() => resolveProviderUrl("https://user:pass@example.com/v1", "responses")).toThrow(
      ProviderError
    );
  });

  it("rejects insecure remote endpoints while permitting local development", () => {
    expect(() => resolveProviderUrl("http://provider.example/v1", "responses")).toThrow(
      "must use HTTPS"
    );
    expect(resolveProviderUrl("http://localhost:8080/v1", "responses").toString()).toBe(
      "http://localhost:8080/v1/responses"
    );
  });
});

function jsonResponse(body: unknown, headers: Record<string, string> = {}, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}
