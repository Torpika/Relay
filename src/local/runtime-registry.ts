import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import type { ProviderKind } from "@/lib/contracts";

export const localProviderKinds = [
  "local_codex",
  "local_claude",
  "local_gemini",
  "local_kimi"
] as const satisfies readonly ProviderKind[];

export type LocalProviderKind = (typeof localProviderKinds)[number];

const runtimes: Record<LocalProviderKind, LocalRuntimeDefinition> = {
  local_codex: {
    name: "Codex",
    binaryName: "codex",
    environmentVariable: "CODEX_BINARY",
    baseUrl: "local://codex",
    credentialHint: "ChatGPT login"
  },
  local_claude: {
    name: "Claude Code",
    binaryName: "claude",
    environmentVariable: "CLAUDE_BINARY",
    baseUrl: "local://claude",
    credentialHint: "Claude login"
  },
  local_gemini: {
    name: "Gemini CLI",
    binaryName: "gemini",
    environmentVariable: "GEMINI_BINARY",
    baseUrl: "local://gemini",
    credentialHint: "Google login"
  },
  local_kimi: {
    name: "Kimi Code",
    binaryName: "kimi",
    environmentVariable: "KIMI_BINARY",
    baseUrl: "local://kimi",
    credentialHint: "Kimi login"
  }
};

export function isLocalProviderKind(kind: ProviderKind): kind is LocalProviderKind {
  return localProviderKinds.includes(kind as LocalProviderKind);
}

export function localRuntimeDefinition(kind: LocalProviderKind): LocalRuntimeDefinition {
  return runtimes[kind];
}

export function resolveLocalRuntimeBinary(kind: ProviderKind): string | null {
  if (!isLocalProviderKind(kind)) {
    return null;
  }

  const runtime = localRuntimeDefinition(kind);
  const configuredBinary = process.env[runtime.environmentVariable];
  const candidates = [
    configuredBinary,
    ...(process.env.PATH ?? "").split(delimiter).map((directory) =>
      join(/* turbopackIgnore: true */ directory, runtime.binaryName)
    ),
    join(/* turbopackIgnore: true */ process.env.HOME ?? "", ".local", "bin", runtime.binaryName),
    join(/* turbopackIgnore: true */ process.env.HOME ?? "", ".npm-global", "bin", runtime.binaryName),
    join("/opt/homebrew/bin", runtime.binaryName),
    join("/usr/local/bin", runtime.binaryName)
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find(isExecutable) ?? null;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(/* turbopackIgnore: true */ path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

interface LocalRuntimeDefinition {
  name: string;
  binaryName: string;
  environmentVariable: string;
  baseUrl: string;
  credentialHint: string;
}
