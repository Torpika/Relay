import { z } from "zod";

const agentRoles = ["draft", "review", "synthesize"] as const;
const reasoningEfforts = ["minimal", "low", "medium", "high", "xhigh"] as const;
const agentParameters = z.object({
  reasoningEffort: z.enum(reasoningEfforts).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  timeoutMs: z.number().int().positive().optional()
}).strict();
const agentFields = {
  name: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(160),
  connectionId: z.string().uuid(),
  roles: z.array(z.enum(agentRoles)).min(1).max(3).transform((roles) => [...new Set(roles)]),
  instructions: z.string().max(40_000),
  enabled: z.boolean(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  parameters: agentParameters
};

export const createAgentSchema = z.object({
  name: agentFields.name,
  model: agentFields.model,
  connectionId: agentFields.connectionId,
  roles: agentFields.roles,
  instructions: agentFields.instructions.default(""),
  enabled: agentFields.enabled.default(true),
  color: agentFields.color.default("#64748b"),
  parameters: agentFields.parameters.default({})
}).strict();

export const updateAgentSchema = z.object({
  name: agentFields.name.optional(),
  model: agentFields.model.optional(),
  connectionId: agentFields.connectionId.optional(),
  roles: agentFields.roles.optional(),
  instructions: agentFields.instructions.optional(),
  enabled: agentFields.enabled.optional(),
  color: agentFields.color.optional(),
  parameters: agentFields.parameters.optional()
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
