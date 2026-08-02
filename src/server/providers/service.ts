import { randomUUID } from "node:crypto";
import type { ProviderConnectionSummary, ProviderKind, ProviderProtocol } from "@/lib/contracts";
import { isDatabaseError } from "@/server/db/errors";
import { toJsonValue } from "@/server/db/json";
import { withWorkspace, type Queryable } from "@/server/db/client";
import { ApiError } from "@/server/http/errors";
import {
  decryptCredential,
  encryptCredential,
  maskCredential,
  type CredentialEnvelope
} from "@/server/security/credentials";
import {
  assertSafeProviderDestination,
  normalizeProviderBaseUrl
} from "@/server/security/provider-url";
import type { CreateProviderInput, UpdateProviderInput } from "@/server/providers/schemas";
import {
  isLocalProviderKind,
  localRuntimeDefinition,
  resolveLocalRuntimeBinary
} from "@/local/runtime-registry";
import {
  createCustomLocalCliConfiguration,
  customLocalProviderBaseUrl,
  isExecutableLocalCommand,
  parseCustomLocalCliConfiguration,
  serializeCustomLocalCliConfiguration
} from "@/local/custom-cli";

interface ProviderRow {
  id: string;
  workspace_id: string;
  name: string;
  kind: ProviderKind;
  protocol: ProviderProtocol;
  base_url: string;
  credential_envelope: CredentialEnvelope;
  credential_hint: string;
  status: ProviderConnectionSummary["status"];
  last_checked_at: Date | string | null;
  last_error: string | null;
}

function timestamp(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function summary(row: ProviderRow): ProviderConnectionSummary {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    protocol: row.protocol,
    baseUrl: row.base_url,
    maskedCredential: row.credential_hint,
    status: row.status,
    lastCheckedAt: timestamp(row.last_checked_at)
  };
}

async function providerRow(transaction: Queryable, workspaceId: string, connectionId: string): Promise<ProviderRow> {
  const [row] = await transaction<ProviderRow[]>`
    SELECT
      id,
      workspace_id,
      name,
      kind,
      protocol,
      base_url,
      credential_envelope,
      credential_hint,
      status,
      last_checked_at,
      last_error
    FROM provider_connections
    WHERE workspace_id = ${workspaceId} AND id = ${connectionId}
  `;

  if (!row) {
    throw new ApiError(404, "provider_not_found", "Provider connection was not found");
  }

  return row;
}

export async function listProviderConnections(workspaceId: string): Promise<ProviderConnectionSummary[]> {
  return withWorkspace(workspaceId, async (transaction) => {
    const rows = await transaction<ProviderRow[]>`
      SELECT
        id,
        workspace_id,
        name,
        kind,
        protocol,
        base_url,
        credential_envelope,
        credential_hint,
        status,
        last_checked_at,
        last_error
      FROM provider_connections
      WHERE workspace_id = ${workspaceId}
      ORDER BY created_at, id
    `;
    return rows.map(summary);
  });
}

export async function createProviderConnection(
  workspaceId: string,
  input: CreateProviderInput
): Promise<ProviderConnectionSummary> {
  const connectionId = randomUUID();
  const runtime = isLocalProviderKind(input.kind) ? localRuntimeDefinition(input.kind) : null;
  const customLocalCli = input.kind === "local_custom";
  const customConfiguration = customLocalCli
    ? createCustomLocalCliConfiguration(input.localCommand ?? "", input.localArgs ?? [])
    : null;
  const localProvider = runtime !== null || customLocalCli;
  const baseUrl = runtime?.baseUrl ?? (customLocalCli ? customLocalProviderBaseUrl : normalizeProviderBaseUrl(input.kind, input.baseUrl));

  if (!localProvider) {
    await assertSafeProviderDestination(baseUrl);
  }

  const storedCredential = customConfiguration
    ? serializeCustomLocalCliConfiguration(customConfiguration)
    : localProvider ? `${input.kind}-login` : input.credential;
  const credentialEnvelope = encryptCredential(storedCredential, { workspaceId, connectionId });

  try {
    return await withWorkspace(workspaceId, async (transaction) => {
      const [row] = await transaction<ProviderRow[]>`
        INSERT INTO provider_connections (
          id,
          workspace_id,
          name,
          kind,
          protocol,
          base_url,
          credential_envelope,
          credential_hint,
          status
        ) VALUES (
          ${connectionId},
          ${workspaceId},
          ${input.name},
          ${input.kind},
          ${input.protocol},
          ${baseUrl},
          ${transaction.json(toJsonValue(credentialEnvelope))},
          ${runtime?.credentialHint ?? (customLocalCli ? "Trusted local command" : maskCredential(input.credential))},
          ${localProvider ? localProviderIsReady(input.kind, customConfiguration) ? "healthy" : "unhealthy" : "untested"}
        )
        RETURNING
          id,
          workspace_id,
          name,
          kind,
          protocol,
          base_url,
          credential_envelope,
          credential_hint,
          status,
          last_checked_at,
          last_error
      `;

      if (!row) {
        throw new Error("Failed to create provider connection");
      }

      return summary(row);
    });
  } catch (error) {
    if (isDatabaseError(error, "23505")) {
      throw new ApiError(409, "provider_name_conflict", "A provider connection with this name already exists");
    }
    throw error;
  }
}

export async function updateProviderConnection(
  workspaceId: string,
  connectionId: string,
  input: UpdateProviderInput
): Promise<ProviderConnectionSummary> {
  try {
    return await withWorkspace(workspaceId, async (transaction) => {
      const existing = await providerRow(transaction, workspaceId, connectionId);
      const kind = input.kind ?? existing.kind;
      const runtime = isLocalProviderKind(kind) ? localRuntimeDefinition(kind) : null;
      const customLocalCli = kind === "local_custom";
      const existingCustomConfiguration = existing.kind === "local_custom"
        ? parseCustomLocalCliConfiguration(decryptCredential(existing.credential_envelope, { workspaceId, connectionId }))
        : null;
      const customConfiguration = customLocalCli
        ? createCustomLocalCliConfiguration(
            input.localCommand ?? existingCustomConfiguration?.command ?? "",
            input.localArgs ?? existingCustomConfiguration?.args ?? []
          )
        : null;
      const localProvider = runtime !== null || customLocalCli;
      const baseUrl = runtime
        ? runtime.baseUrl
        : customLocalCli ? customLocalProviderBaseUrl : normalizeProviderBaseUrl(kind, input.baseUrl ?? existing.base_url);

      if (!localProvider) {
        await assertSafeProviderDestination(baseUrl);
      }

      if (!localProvider && isLocalProviderKind(existing.kind) && !input.credential) {
        throw new ApiError(400, "credential_required", "A credential is required when changing to a remote provider");
      }

      const credentialEnvelope = customConfiguration
        ? encryptCredential(serializeCustomLocalCliConfiguration(customConfiguration), { workspaceId, connectionId })
        : input.credential
          ? encryptCredential(input.credential, { workspaceId, connectionId })
          : existing.credential_envelope;
      const status = localProvider
        ? input.enabled === false ? "disabled" : localProviderIsReady(kind, customConfiguration) ? "healthy" : "unhealthy"
        : input.enabled === false
        ? "disabled"
        : input.enabled === true || input.credential || input.baseUrl || input.kind || input.protocol
          ? "untested"
          : existing.status;
      const [row] = await transaction<ProviderRow[]>`
        UPDATE provider_connections SET
          name = ${input.name ?? existing.name},
          kind = ${kind},
          protocol = ${localProvider ? kind === "local_codex" ? "codex_mcp" : "local_cli" : input.protocol ?? existing.protocol},
          base_url = ${baseUrl},
          credential_envelope = ${transaction.json(toJsonValue(credentialEnvelope))},
          credential_hint = ${runtime?.credentialHint ?? (customLocalCli ? "Trusted local command" : input.credential ? maskCredential(input.credential) : existing.credential_hint)},
          status = ${status},
          last_checked_at = ${status === "untested" ? null : existing.last_checked_at},
          last_error = ${status === "untested" ? null : existing.last_error}
        WHERE workspace_id = ${workspaceId} AND id = ${connectionId}
        RETURNING
          id,
          workspace_id,
          name,
          kind,
          protocol,
          base_url,
          credential_envelope,
          credential_hint,
          status,
          last_checked_at,
          last_error
      `;

      if (!row) {
        throw new Error("Failed to update provider connection");
      }

      return summary(row);
    });
  } catch (error) {
    if (isDatabaseError(error, "23505")) {
      throw new ApiError(409, "provider_name_conflict", "A provider connection with this name already exists");
    }
    throw error;
  }
}

export async function deleteProviderConnection(workspaceId: string, connectionId: string): Promise<void> {
  try {
    await withWorkspace(workspaceId, async (transaction) => {
      const result = await transaction`
        DELETE FROM provider_connections
        WHERE workspace_id = ${workspaceId} AND id = ${connectionId}
      `;

      if (result.count === 0) {
        throw new ApiError(404, "provider_not_found", "Provider connection was not found");
      }
    });
  } catch (error) {
    if (isDatabaseError(error, "23503")) {
      throw new ApiError(409, "provider_in_use", "Disable or remove this provider's agents before deleting it");
    }
    throw error;
  }
}

export async function testProviderConnection(
  workspaceId: string,
  connectionId: string
): Promise<ProviderConnectionSummary> {
  return withWorkspace(workspaceId, async (transaction) => {
    const existing = await providerRow(transaction, workspaceId, connectionId);

    if (existing.status === "disabled") {
      throw new ApiError(409, "provider_disabled", "Enable this provider connection before testing it");
    }

    let status: ProviderConnectionSummary["status"] = "healthy";
    let lastError: string | null = null;

    try {
      if (isLocalProviderKind(existing.kind)) {
        const runtime = localRuntimeDefinition(existing.kind);
        const binary = resolveLocalRuntimeBinary(existing.kind);

        if (!binary) {
          status = "unhealthy";
          lastError = `${runtime.name} CLI is not installed or is not executable`;
        }
      } else if (existing.kind === "local_custom") {
        const configuration = parseCustomLocalCliConfiguration(
          decryptCredential(existing.credential_envelope, { workspaceId, connectionId })
        );

        if (!isExecutableLocalCommand(configuration.command)) {
          status = "unhealthy";
          lastError = "Custom local CLI command is not installed or is not executable";
        }
      } else {
        await assertSafeProviderDestination(existing.base_url);
        const credential = decryptCredential(existing.credential_envelope, { workspaceId, connectionId });
        const response = await fetch(`${existing.base_url}/models`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${credential}`,
            Accept: "application/json"
          },
          redirect: "error",
          signal: AbortSignal.timeout(Number(process.env.PROVIDER_TEST_TIMEOUT_MS ?? 10_000))
        });

        if (!response.ok) {
          status = "unhealthy";
          lastError = `Provider returned HTTP ${response.status}`;
        }
      }
    } catch (error) {
      status = "unhealthy";
      lastError = error instanceof Error ? error.message.slice(0, 500) : "Provider request failed";
    }

    const [row] = await transaction<ProviderRow[]>`
      UPDATE provider_connections SET
        status = ${status},
        last_checked_at = now(),
        last_error = ${lastError}
      WHERE workspace_id = ${workspaceId} AND id = ${connectionId}
      RETURNING
        id,
        workspace_id,
        name,
        kind,
        protocol,
        base_url,
        credential_envelope,
        credential_hint,
        status,
        last_checked_at,
        last_error
    `;

    if (!row) {
      throw new Error("Failed to store provider health status");
    }

    return summary(row);
  });
}

function localProviderIsReady(
  kind: ProviderKind,
  customConfiguration: ReturnType<typeof createCustomLocalCliConfiguration> | null
): boolean {
  if (kind === "local_custom") {
    return Boolean(customConfiguration && isExecutableLocalCommand(customConfiguration.command));
  }

  return resolveLocalRuntimeBinary(kind) !== null;
}
