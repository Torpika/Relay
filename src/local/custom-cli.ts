import { accessSync, constants } from "node:fs";
import { isAbsolute } from "node:path";

export const customLocalProviderBaseUrl = "local://custom";

export interface CustomLocalCliConfiguration {
  command: string;
  args: string[];
}

export function createCustomLocalCliConfiguration(command: string, args: readonly string[]): CustomLocalCliConfiguration {
  const normalizedCommand = command.trim();
  const normalizedArgs = args.map((argument) => argument.trim());

  if (!isAbsolute(normalizedCommand)) {
    throw new Error("Custom local CLI command must be an absolute executable path");
  }

  if (normalizedArgs.some((argument) => !argument || argument.length > 1_000) || normalizedArgs.length > 32) {
    throw new Error("Custom local CLI arguments must contain at most 32 non-empty values");
  }

  return { command: normalizedCommand, args: normalizedArgs };
}

export function serializeCustomLocalCliConfiguration(configuration: CustomLocalCliConfiguration): string {
  return JSON.stringify(configuration);
}

export function parseCustomLocalCliConfiguration(value: string | undefined): CustomLocalCliConfiguration {
  if (!value) {
    throw new Error("Custom local CLI configuration is missing");
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!isRecord(parsed) || typeof parsed.command !== "string" || !Array.isArray(parsed.args) || !parsed.args.every((argument) => typeof argument === "string")) {
      throw new Error("Custom local CLI configuration is invalid");
    }

    return createCustomLocalCliConfiguration(parsed.command, parsed.args);
  } catch (error) {
    throw new Error(error instanceof Error && error.message.startsWith("Custom local CLI")
      ? error.message
      : "Custom local CLI configuration is invalid");
  }
}

export function isExecutableLocalCommand(command: string): boolean {
  try {
    accessSync(command, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
