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
}

export async function generateReply(params: LlmCallParams): Promise<LlmOutput | null> {
  const userPayload = {
    last_customer_message: params.lastCustomerMessage,
    state: params.state,
    timestamp_iso: new Date().toISOString(),
  };

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: params.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: params.systemPrompt },
        {
          role: "user",
          content:
            "Respond only as valid JSON with keys: reply, intent, fields_collected, fields_missing, notes_for_human.\n" +
            JSON.stringify(userPayload),
        },
      ],
      max_tokens: params.maxOutputTokens,
      temperature: 0.2,
    },
    {
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    },
  );

  const content = response.data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(content);
    const validated = llmOutputSchema.safeParse(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
}
