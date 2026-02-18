import "dotenv/config";
import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { envSchema, simulateInputSchema, simulateOutputSchema, webhookPayloadSchema, type SimulateOutput } from "./validators";
import { InMemoryStateStore } from "./state";
import { generateReply } from "./llm";
import { maskPhone, sendWhatsAppText } from "./meta";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

const parsedEnv = envSchema.safeParse(process.env);
if (!parsedEnv.success) {
  console.error("Invalid environment variables", parsedEnv.error.format());
  process.exit(1);
}

const env = parsedEnv.data;
const app = express();
const stateStore = new InMemoryStateStore();

app.use(express.json({ limit: "512kb" }));

app.use((req: Request, _res: Response, next: NextFunction) => {
  req.requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[REQ] method=${req.method} path=${req.path} request_id=${req.requestId}`);
  next();
});

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

function fallbackSimulate(): SimulateOutput {
  return {
    reply: "Anladım. Hangi ürün için kullanacaksınız ve kaç mm/ligne ölçü istiyorsunuz?",
    intent: "qualify",
    fields_collected: [],
    fields_missing: ["usage", "size"],
    notes_for_human: "LLM failed or timed out",
  };
}

async function maybeSendWhatsAppText(to: string, body: string): Promise<void> {
  if (env.SIMULATE_ONLY) {
    throw new Error("Outbound Meta call blocked: SIMULATE_ONLY=true");
  }

  await sendWhatsAppText({
    accessToken: env.META_ACCESS_TOKEN,
    phoneNumberId: env.META_PHONE_NUMBER_ID,
    to,
    body,
  });
}

app.get("/health", (_req, res) => {
  return res.status(200).json({ ok: true, uptime: process.uptime(), ts: new Date().toISOString() });
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const verifyToken = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && verifyToken === env.META_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.status(403).send("Forbidden");
});

app.post("/simulate", async (req, res) => {
  const inputParsed = simulateInputSchema.safeParse(req.body);
  if (!inputParsed.success) {
    return res.status(400).json({ error: true, request_id: req.requestId, details: inputParsed.error.flatten() });
  }

  const from = inputParsed.data.from;
  const text = inputParsed.data.text;

  console.log("SIMULATE_IN", {
    request_id: req.requestId,
    from: maskPhone(from),
    text: text.slice(0, 200),
  });

  const state = await stateStore.get(from);

  try {
    const llmResult = await generateReply({
      apiKey: env.OPENAI_API_KEY,
      model: env.MODEL_NAME,
      maxOutputTokens: env.MAX_OUTPUT_TOKENS,
      systemPrompt: env.SYSTEM_PROMPT,
      lastCustomerMessage: text,
      state,
      timeoutMs: 8000,
      developerPrompt:
        "Return ONLY valid JSON, no markdown, no extra text. Required keys: reply, intent, fields_collected, fields_missing, notes_for_human.",
    });

    const output = llmResult
      ? {
          reply: llmResult.reply,
          intent: llmResult.intent,
          fields_collected: Object.keys(llmResult.fields_collected),
          fields_missing: llmResult.fields_missing,
          notes_for_human: llmResult.notes_for_human,
        }
      : fallbackSimulate();

    const validatedOutput = simulateOutputSchema.parse(output);

    if (llmResult) {
      await stateStore.merge(from, {
        ...llmResult.fields_collected,
        last_intent: llmResult.intent,
        last_reply: llmResult.reply,
      });
    }

    console.log("SIMULATE_OUT", {
      request_id: req.requestId,
      intent: validatedOutput.intent,
      reply: validatedOutput.reply.slice(0, 80),
    });

    return res.status(200).json(validatedOutput);
  } catch (error) {
    console.error("SIMULATE_ERR", {
      request_id: req.requestId,
      stack: error instanceof Error ? error.stack : String(error),
    });

    return res.status(200).json(fallbackSimulate());
  }
});

app.post("/webhook", async (req, res, next) => {
  try {
    if (env.SIMULATE_ONLY) {
      return res.status(403).json({
        error: true,
        message: "Outbound Meta call blocked because SIMULATE_ONLY=true",
        request_id: req.requestId,
      });
    }

    const parsedPayload = webhookPayloadSchema.safeParse(req.body);
    if (!parsedPayload.success) {
      return res.status(400).json({ ok: false, request_id: req.requestId });
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
          const llmResult = await generateReply({
            apiKey: env.OPENAI_API_KEY,
            model: env.MODEL_NAME,
            maxOutputTokens: env.MAX_OUTPUT_TOKENS,
            systemPrompt: env.SYSTEM_PROMPT,
            lastCustomerMessage: message.text.body,
            state: currentState,
            timeoutMs: 8000,
          });

          if (!llmResult) {
            await maybeSendWhatsAppText(
              from,
              "Teşekkürler. Size doğru teklif hazırlamak için kullanım alanı ve ölçü (mm) bilgisini paylaşır mısınız?",
            );
            continue;
          }

          await stateStore.merge(from, {
            ...llmResult.fields_collected,
            last_intent: llmResult.intent,
            last_reply: llmResult.reply,
          });

          if (llmResult.intent.toLowerCase() === "handoff") {
            await maybeSendWhatsAppText(
              from,
              "Tamam. Yetkili arkadaşım devreye girsin. Ürün tipi + ölçü (mm) + adet yazar mısınız?",
            );

            console.log("[HUMAN_HANDOFF]", {
              request_id: req.requestId,
              phone: maskPhone(from),
              notes_for_human: llmResult.notes_for_human,
              latest_customer_message: message.text.body.slice(0, 200),
              state: await stateStore.get(from),
            });
            continue;
          }

          await maybeSendWhatsAppText(from, llmResult.reply);
        }
      }
    }

    return res.status(200).json({ ok: true, request_id: req.requestId });
  } catch (error) {
    return next(error);
  }
});

const sendSchema = z.object({
  to: z.string().min(6),
  text: z.string().min(1),
});

app.post("/send", async (req, res, next) => {
  try {
    if (env.SIMULATE_ONLY) {
      return res.status(403).json({
        error: true,
        message: "Outbound Meta call blocked because SIMULATE_ONLY=true",
        request_id: req.requestId,
      });
    }

    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, request_id: req.requestId, error: parsed.error.flatten() });
    }

    await maybeSendWhatsAppText(parsed.data.to, parsed.data.text);

    return res.status(200).json({ ok: true, request_id: req.requestId });
  } catch (error) {
    return next(error);
  }
});

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  console.error("UNHANDLED_ERR", {
    request_id: req.requestId,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });

  return res.status(500).json({
    error: true,
    message: err instanceof Error ? err.message : "Internal server error",
    request_id: req.requestId,
  });
});

app.listen(env.PORT, () => {
  console.log(`Server listening on :${env.PORT} simulate_only=${String(env.SIMULATE_ONLY)}`);
});
