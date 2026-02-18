import axios from "axios";
import { llmOutputSchema, type LlmOutput } from "./validators";
import type { ConversationState } from "./state";

interface LlmCallParams {
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  systemPrompt: string;
  lastCustomerMessage: string;
  state: ConversationState;
  timeoutMs?: number;
  developerPrompt?: string;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`LLM timeout after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function extractFirstJsonObject(raw: string): string | null {
  const match = raw.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

function parseLlmContent(content: string): LlmOutput | null {
  const direct = llmOutputSchema.safeParse(JSON.parse(content));
  if (direct.success) {
    return direct.data;
  }

  const repaired = extractFirstJsonObject(content);
  if (!repaired) {
    return null;
  }

  const repairedParsed = llmOutputSchema.safeParse(JSON.parse(repaired));
  return repairedParsed.success ? repairedParsed.data : null;
}

export async function generateReply(params: LlmCallParams): Promise<LlmOutput | null> {
  const userPayload = {
    last_customer_message: params.lastCustomerMessage,
    state: params.state,
    timestamp_iso: new Date().toISOString(),
  };

  const developerPrompt =
    params.developerPrompt ??
    "Return ONLY valid JSON, no markdown, no extra text. Required keys: reply, intent, fields_collected, fields_missing, notes_for_human.";

  const request = axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: params.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: params.systemPrompt },
        { role: "developer", content: developerPrompt },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
      max_tokens: params.maxOutputTokens,
      temperature: 0.2,
    },
    {
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: Math.min(params.timeoutMs ?? 8000, 7900),
    },
  );

  const response = await withTimeout(request, params.timeoutMs ?? 8000);

  const content = response.data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    return null;
  }

  try {
    return parseLlmContent(content);
  } catch {
    return null;
  }
}
