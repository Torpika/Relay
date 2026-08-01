import { z } from "zod";
import { providerKinds, providerProtocols } from "@/lib/contracts";
import { isLocalProviderKind, localRuntimeDefinition } from "@/local/runtime-registry";

export const createProviderSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(providerKinds),
  protocol: z.enum(providerProtocols),
  baseUrl: z.string().trim().min(1).max(2_048),
  credential: z.string().trim().max(20_000).optional().default("")
}).strict().superRefine((value, context) => {
  if (isLocalProviderKind(value.kind)) {
    const expectedProtocol = value.kind === "local_codex" ? "codex_mcp" : "local_cli";
    const runtime = localRuntimeDefinition(value.kind);

    if (value.protocol !== expectedProtocol || value.baseUrl !== runtime.baseUrl) {
      context.addIssue({ code: "custom", message: `${runtime.name} must use its local runtime` });
    }
    return;
  }

  if (value.protocol === "codex_mcp" || value.protocol === "local_cli") {
    context.addIssue({ code: "custom", message: "Remote providers cannot use a local runtime protocol" });
  }

  if (!value.credential) {
    context.addIssue({ code: "custom", path: ["credential"], message: "A provider credential is required" });
  }
});

export const updateProviderSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  kind: z.enum(providerKinds).optional(),
  protocol: z.enum(providerProtocols).optional(),
  baseUrl: z.string().trim().min(1).max(2_048).optional(),
  credential: z.string().trim().min(1).max(20_000).optional(),
  enabled: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

export type CreateProviderInput = z.infer<typeof createProviderSchema>;
export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;
