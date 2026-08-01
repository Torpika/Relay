import { ChatCompletionsProvider } from "@/orchestration/providers/chat-completions";
import { CodexMcpProvider } from "@/orchestration/providers/codex-mcp";
import { LocalCliProvider } from "@/orchestration/providers/local-cli";
import { ResponsesProvider } from "@/orchestration/providers/responses";
import type {
  ModelProvider,
  ProviderClientOptions,
  ProviderConnection
} from "@/orchestration/providers/types";

export * from "@/orchestration/providers/errors";
export * from "@/orchestration/providers/codex-mcp";
export * from "@/orchestration/providers/local-cli";
export * from "@/orchestration/providers/types";

export function createModelProvider(
  connection: ProviderConnection,
  options: ProviderClientOptions = {}
): ModelProvider {
  if (connection.protocol === "codex_mcp") {
    return new CodexMcpProvider(connection, options);
  }

  if (connection.protocol === "local_cli") {
    return new LocalCliProvider(connection, options);
  }

  if (connection.protocol === "responses") {
    return new ResponsesProvider(connection, options);
  }

  return new ChatCompletionsProvider(connection, options);
}
