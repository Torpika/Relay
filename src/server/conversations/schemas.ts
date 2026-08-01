import { z } from "zod";

const conversationFields = {
  title: z.string().trim().min(1).max(160),
  objective: z.string().trim().min(1).max(40_000),
  agentIds: z.array(z.string().uuid()).min(2).max(32).transform((ids) => [...new Set(ids)])
};

export const createConversationSchema = z.object({
  title: conversationFields.title,
  objective: conversationFields.objective,
  agentIds: conversationFields.agentIds
}).strict();

export const updateConversationSchema = z.object({
  title: conversationFields.title.optional(),
  objective: conversationFields.objective.optional(),
  agentIds: conversationFields.agentIds.optional()
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;
