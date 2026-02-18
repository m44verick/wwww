import "dotenv/config";
import express from "express";
import { z } from "zod";
import { envSchema, webhookPayloadSchema } from "./validators";
import { InMemoryStateStore } from "./state";
import { generateReply } from "./llm";
import { maskPhone, sendWhatsAppText } from "./meta";

const parsedEnv = envSchema.safeParse(process.env);
if (!parsedEnv.success) {
  console.error("Invalid environment variables", parsedEnv.error.format());
  process.exit(1);
}

const env = parsedEnv.data;
const app = express();
const stateStore = new InMemoryStateStore();

app.use(express.json({ limit: "512kb" }));

const duplicateWindowMs = 24 * 60 * 60 * 1000;
const processedMessageIds = new Map<string, number>();

const rateWindowMs = 60 * 1000;
const rateLimitPerWindow = 20;
const phoneRateMap = new Map<string, { count: number; windowStart: number }>();

function cleanupProcessedIds(now: number): void {
  for (const [messageId, timestamp] of processedMessageIds.entries()) {
    if (now - timestamp > duplicateWindowMs) {
      processedMessageIds.delete(messageId);
    }
  }
}

function isRateLimited(phone: string, now: number): boolean {
  const current = phoneRateMap.get(phone);
  if (!current || now - current.windowStart > rateWindowMs) {
    phoneRateMap.set(phone, { count: 1, windowStart: now });
    return false;
  }

  current.count += 1;
  phoneRateMap.set(phone, current);
  return current.count > rateLimitPerWindow;
}

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const verifyToken = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && verifyToken === env.META_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.status(403).send("Forbidden");
});

app.post("/webhook", async (req, res) => {
  const parsedPayload = webhookPayloadSchema.safeParse(req.body);
  if (!parsedPayload.success) {
    console.warn("Invalid webhook payload shape");
    return res.status(400).json({ ok: false });
  }

  const payload = parsedPayload.data;
  const now = Date.now();
  cleanupProcessedIds(now);

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      for (const message of change.value.messages ?? []) {
        const messageId = message.id;
        const from = message.from;

        if (processedMessageIds.has(messageId)) {
          console.log(`Duplicate message ignored id=${messageId}`);
          continue;
        }

        processedMessageIds.set(messageId, now);

        if (isRateLimited(from, now)) {
          console.warn(`Rate limit exceeded for phone=${maskPhone(from)}`);
          continue;
        }

        if (message.type !== "text" || !message.text?.body) {
          console.log(
            `Ignoring non-text inbound message type=${message.type} from=${maskPhone(from)}`,
          );
          continue;
        }

        const currentState = await stateStore.get(from);

        let llmResult = null;
        try {
          llmResult = await generateReply({
            apiKey: env.OPENAI_API_KEY ?? env.LLM_API_KEY!,
            model: env.MODEL_NAME,
            maxOutputTokens: env.MAX_OUTPUT_TOKENS,
            systemPrompt: env.SYSTEM_PROMPT,
            lastCustomerMessage: message.text.body,
            state: currentState,
          });
        } catch (error) {
          console.error(
            `LLM call failed for phone=${maskPhone(from)}`,
            error instanceof Error ? error.message : "unknown error",
          );
        }

        if (!llmResult) {
          await sendWhatsAppText({
            accessToken: env.META_ACCESS_TOKEN,
            phoneNumberId: env.META_PHONE_NUMBER_ID,
            to: from,
            body: "Teşekkürler. Size doğru teklif hazırlamak için kullanım alanı ve ölçü (mm) bilgisini paylaşır mısınız?",
          });
          continue;
        }

        await stateStore.merge(from, {
          ...llmResult.fields_collected,
          last_intent: llmResult.intent,
        });

        if (llmResult.intent.toLowerCase() === "handoff") {
          await sendWhatsAppText({
            accessToken: env.META_ACCESS_TOKEN,
            phoneNumberId: env.META_PHONE_NUMBER_ID,
            to: from,
            body: "Tamam. Yetkili arkadaşım devreye girsin. Ürün tipi + ölçü (mm) + adet yazar mısınız?",
          });

          console.log("[HUMAN_HANDOFF]", {
            phone: maskPhone(from),
            notes_for_human: llmResult.notes_for_human,
            latest_customer_message: message.text.body,
            state: await stateStore.get(from),
          });
          continue;
        }

        await sendWhatsAppText({
          accessToken: env.META_ACCESS_TOKEN,
          phoneNumberId: env.META_PHONE_NUMBER_ID,
          to: from,
          body: llmResult.reply,
        });
      }
    }
  }

  return res.status(200).json({ ok: true });
});

const sendSchema = z.object({
  to: z.string().min(6),
  text: z.string().min(1),
});

app.post("/send", async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  try {
    await sendWhatsAppText({
      accessToken: env.META_ACCESS_TOKEN,
      phoneNumberId: env.META_PHONE_NUMBER_ID,
      to: parsed.data.to,
      body: parsed.data.text,
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "send failed",
    });
  }
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.listen(env.PORT, () => {
  console.log(`Server listening on :${env.PORT}`);
});
