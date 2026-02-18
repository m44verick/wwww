import { z } from "zod";

export const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  META_VERIFY_TOKEN: z.string().min(1),
  META_ACCESS_TOKEN: z.string().min(1),
  META_PHONE_NUMBER_ID: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  LLM_API_KEY: z.string().optional(),
  SYSTEM_PROMPT: z.string().min(1),
  MODEL_NAME: z.string().default("gpt-4o-mini"),
  MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(300),
  SIMULATE_ONLY: z.coerce.boolean().default(true),
});

const textMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z.object({ body: z.string().min(1) }).optional(),
});

const valueSchema = z.object({
  messages: z.array(textMessageSchema).optional(),
});

const changeSchema = z.object({
  field: z.string(),
  value: valueSchema,
});

const entrySchema = z.object({
  id: z.string().optional(),
  changes: z.array(changeSchema),
});

export const webhookPayloadSchema = z.object({
  object: z.string(),
  entry: z.array(entrySchema),
});

export const llmOutputSchema = z.object({
  reply: z.string().min(1),
  intent: z.string().min(1),
  fields_collected: z.record(z.string(), z.string()).default({}),
  fields_missing: z.array(z.string()).default([]),
  notes_for_human: z.string().default(""),
});

export const simulateInputSchema = z.object({
  from: z.string().min(6),
  text: z.string().min(1),
});

export const simulateOutputSchema = z.object({
  reply: z.string(),
  intent: z.string(),
  fields_collected: z.array(z.string()),
  fields_missing: z.array(z.string()),
  notes_for_human: z.string(),
});

export type LlmOutput = z.infer<typeof llmOutputSchema>;
export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
export type EnvConfig = z.infer<typeof envSchema>;
export type SimulateOutput = z.infer<typeof simulateOutputSchema>;
