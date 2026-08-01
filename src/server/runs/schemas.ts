import { z } from "zod";

export const startRunSchema = z.object({
  synthesizerAgentId: z.string().uuid().optional(),
  reviewTopology: z.enum(["all_to_all", "round_robin"]).default("all_to_all"),
  maxIterations: z.number().int().positive().max(1_000_000).nullable().optional(),
  maxTotalTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional()
}).strict();

export const stopRunSchema = z.object({
  mode: z.enum(["graceful", "immediate"]).default("graceful")
}).strict();

export const instructionSchema = z.object({
  instruction: z.string().trim().min(1).max(20_000)
}).strict();

export type StartRunInput = z.infer<typeof startRunSchema>;
export type StopRunInput = z.infer<typeof stopRunSchema>;
