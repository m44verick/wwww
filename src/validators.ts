import { z } from "zod";

export const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  META_VERIFY_TOKEN: z.string().min(1),
  META_ACCESS_TOKEN: z.string().min(1),
  META_PHONE_NUMBER_ID: z.string().min(1),
  OPENAI_API_KEY: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  SYSTEM_PROMPT: z.string().min(1),
  MODEL_NAME: z.string().default("gpt-4o-mini"),
  MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(300),
}).superRefine((val, ctx) => {
  if (!val.OPENAI_API_KEY && !val.LLM_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Either OPENAI_API_KEY or LLM_API_KEY must be provided",
      path: ["OPENAI_API_KEY"],
    });
  }
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

export type LlmOutput = z.infer<typeof llmOutputSchema>;
export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
export type EnvConfig = z.infer<typeof envSchema>;
