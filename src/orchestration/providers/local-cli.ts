import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import {
  parseCustomLocalCliConfiguration,
  type CustomLocalCliConfiguration
} from "@/local/custom-cli";
import type { LocalProviderKind } from "@/local/runtime-registry";
import { localRuntimeDefinition, resolveLocalRuntimeBinary } from "@/local/runtime-registry";
import { ProviderError } from "@/orchestration/providers/errors";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ProviderClientOptions,
  ProviderConnection
} from "@/orchestration/providers/types";

const maximumOutputBytes = 4_000_000;

export interface LocalCliRunner {
  run(input: LocalCliProcessInput): Promise<{ stdout: string; stderr: string }>;
}

export class LocalCliProvider implements ModelProvider {
  readonly #kind: LocalCliProviderKind;
  readonly #credential: string | undefined;
  readonly #timeoutMs: number;
  readonly #runner: LocalCliRunner;

  constructor(
    connection: ProviderConnection,
    options: ProviderClientOptions = {},
    runner: LocalCliRunner = new SpawnLocalCliRunner()
  ) {
    if (connection.protocol !== "local_cli" || !isSupportedLocalCliKind(connection.kind)) {
      throw new Error("LocalCliProvider requires a supported local_cli connection");
    }

    this.#kind = connection.kind;
    this.#credential = connection.credential;
    this.#timeoutMs = options.timeoutMs ?? 180_000;
    this.#runner = runner;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const customConfiguration = this.#kind === "local_custom"
      ? parseCustomLocalCliConfiguration(this.#credential)
      : null;
    const builtInKind = this.#kind === "local_custom" ? null : this.#kind;
    const binary = customConfiguration?.command ?? (builtInKind ? resolveLocalRuntimeBinary(builtInKind) : null);
    const runtimeName = builtInKind ? localRuntimeDefinition(builtInKind).name : "Custom local CLI";

    if (!binary) {
      throw new ProviderError(`${runtimeName} is not installed or is not executable`, {
        code: "not_found",
        retryable: false
      });
    }

    const prompt = `${request.instructions}\n\n${request.input}`.trim();
    const invocation = buildInvocation(this.#kind, request, prompt, customConfiguration);
    const startedAt = performance.now();

    try {
      const result = await this.#runner.run({
        command: binary,
        args: invocation.args,
        cwd: process.env.RELAY_LOCAL_AI_CWD ?? process.env.RELAY_CODEX_CWD ?? process.cwd(),
        env: { ...process.env, ...invocation.environment },
        stdin: invocation.stdin,
        signal: request.signal,
        timeoutMs: this.#timeoutMs
      });
      const parsed = parseOutput(this.#kind, result.stdout);
      const inputTokens = parsed.inputTokens ?? estimatedTokens(prompt);
      const outputTokens = parsed.outputTokens ?? estimatedTokens(parsed.content);

      return {
        content: parsed.content,
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        providerResponseId: parsed.responseId,
        providerRequestId: null
      };
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : `${runtimeName} request failed`;
      throw new ProviderError(message, {
        code: request.signal?.aborted ? "cancelled" : message.toLowerCase().includes("timeout") ? "timeout" : "server_error",
        retryable: !request.signal?.aborted,
        cause: error
      });
    }
  }
}

class SpawnLocalCliRunner implements LocalCliRunner {
  run(input: LocalCliProcessInput): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(input.command, input.args, {
        cwd: input.cwd,
        env: input.env,
        stdio: ["pipe", "pipe", "pipe"]
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;
      const finish = (work: () => void) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          input.signal?.removeEventListener("abort", abort);
          work();
        }
      };
      const terminate = (error: Error) => {
        child.kill("SIGTERM");
        finish(() => reject(error));
      };
      const collect = (target: Buffer[], chunk: Buffer) => {
        outputBytes += chunk.length;

        if (outputBytes > maximumOutputBytes) {
          terminate(new Error("Local AI output exceeded the Relay size limit"));
          return;
        }

        target.push(chunk);
      };
      const abort = () => terminate(new Error("Local AI request was cancelled"));
      const timeout = setTimeout(() => terminate(new Error("Local AI request timed out")), input.timeoutMs);

      input.signal?.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
      child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
      child.once("error", (error) => finish(() => reject(error)));
      child.once("exit", (code) => finish(() => {
        const stdoutText = Buffer.concat(stdout).toString("utf8").trim();
        const stderrText = Buffer.concat(stderr).toString("utf8").trim();

        if (code !== 0) {
          reject(new Error(stderrText.slice(-1_000) || `Local AI exited with status ${code ?? "unknown"}`));
          return;
        }

        resolve({ stdout: stdoutText, stderr: stderrText });
      }));
      child.stdin.once("error", (error) => finish(() => reject(error)));
      child.stdin.end(input.stdin);
    });
  }
}

function buildInvocation(
  kind: LocalCliProviderKind,
  request: ModelRequest,
  prompt: string,
  customConfiguration: CustomLocalCliConfiguration | null
): { args: string[]; environment: Record<string, string>; stdin?: string } {
  if (kind === "local_custom") {
    if (!customConfiguration) {
      throw new Error("Custom local CLI configuration is missing");
    }

    const hasPromptArgument = customConfiguration.args.some((argument) => argument.includes("{prompt}"));
    return {
      args: customConfiguration.args.map((argument) => argument.replaceAll("{prompt}", prompt)),
      environment: {},
      ...(hasPromptArgument ? {} : { stdin: prompt })
    };
  }

  const modelArguments = request.model && !["default", "auto"].includes(request.model)
    ? ["--model", request.model]
    : [];

  if (kind === "local_claude") {
    return {
      args: ["-p", "--output-format", "json", "--permission-mode", "plan", ...modelArguments],
      environment: request.reasoningEffort
        ? { CLAUDE_CODE_EFFORT_LEVEL: normalizeEffort(request.reasoningEffort) }
        : {},
      stdin: prompt
    };
  }

  if (kind === "local_gemini") {
    return {
      args: ["--prompt", prompt, "--output-format", "json", "--approval-mode=plan", ...modelArguments],
      environment: {}
    };
  }

  return {
    args: ["--prompt", prompt, "--output-format", "text", ...modelArguments],
    environment: {
      KIMI_DISABLE_TELEMETRY: "1",
      ...(request.reasoningEffort
        ? { KIMI_MODEL_THINKING_EFFORT: normalizeEffort(request.reasoningEffort) }
        : {})
    }
  };
}

function parseOutput(kind: LocalCliProviderKind, stdout: string): ParsedLocalOutput {
  if (!stdout) {
    throw new ProviderError("Local AI returned an empty response", {
      code: "malformed_response",
      retryable: false
    });
  }

  if (kind === "local_kimi" || kind === "local_custom") {
    return { content: stdout, responseId: null };
  }

  try {
    const value = JSON.parse(stdout) as unknown;

    if (!isRecord(value)) {
      throw new Error("Expected an object");
    }

    const content = kind === "local_claude" ? value.result : value.response;

    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Response text is missing");
    }

    const usage = isRecord(value.usage) ? value.usage : null;
    return {
      content: content.trim(),
      responseId: typeof value.session_id === "string" ? value.session_id : null,
      inputTokens: usage && typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
      outputTokens: usage && typeof usage.output_tokens === "number" ? usage.output_tokens : undefined
    };
  } catch (error) {
    throw new ProviderError(`Local AI returned malformed JSON: ${error instanceof Error ? error.message : "parse failed"}`, {
      code: "malformed_response",
      retryable: false,
      cause: error
    });
  }
}

function normalizeEffort(effort: NonNullable<ModelRequest["reasoningEffort"]>): string {
  return effort === "minimal" ? "low" : effort;
}

function estimatedTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function isSupportedLocalCliKind(kind: ProviderConnection["kind"]): kind is LocalCliProviderKind {
  return kind === "local_claude" || kind === "local_gemini" || kind === "local_kimi" || kind === "local_custom";
}

type LocalCliProviderKind = Exclude<LocalProviderKind, "local_codex"> | "local_custom";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export interface LocalCliProcessInput {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

interface ParsedLocalOutput {
  content: string;
  responseId: string | null;
  inputTokens?: number;
  outputTokens?: number;
}
