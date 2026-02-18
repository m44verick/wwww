# WhatsApp Business API (Meta Cloud API) + AI Reply Engine

Production-ready Node.js + TypeScript webhook server for inbound WhatsApp messages, lightweight per-phone state, strict JSON LLM outputs, and a local simulation endpoint that works without WhatsApp.

## Features

- ✅ Webhook verification (`GET /webhook`)
- ✅ Webhook ingestion (`POST /webhook`) with zod validation
- ✅ Local simulation endpoint (`POST /simulate`) for debugging without Meta/WhatsApp
- ✅ 8-second LLM timeout and guaranteed fallback response
- ✅ Strict JSON parsing with one-shot repair attempt
- ✅ In-memory per-phone state abstraction (easy Redis swap)
- ✅ Idempotency (duplicate message dedupe for 24h)
- ✅ Basic per-phone rate limiting
- ✅ Request-level `request_id` and structured logs
- ✅ Global JSON error handler
- ✅ `SIMULATE_ONLY=true` guard to block outbound Meta calls locally

## Tech Stack

- Node.js 20+
- TypeScript
- Express
- dotenv
- zod
- axios

## Project Structure

```txt
src/
  server.ts      # routes, orchestration, middleware, error handling
  meta.ts        # WhatsApp API send + phone masking
  llm.ts         # OpenAI call + timeout + JSON repair parse
  state.ts       # state interface + in-memory impl
  validators.ts  # zod schemas
.env.example
README.md
```

## Environment Variables

Copy `.env.example` to `.env` and fill values:

- `PORT`
- `META_VERIFY_TOKEN`
- `META_ACCESS_TOKEN`
- `META_PHONE_NUMBER_ID`
- `OPENAI_API_KEY`
- `SYSTEM_PROMPT`
- `MODEL_NAME` (default: `gpt-4o-mini`)
- `MAX_OUTPUT_TOKENS` (default: `300`)
- `SIMULATE_ONLY` (default: `true`)

> With `SIMULATE_ONLY=true`, outbound Meta/WhatsApp calls are blocked by design and `/send` returns 403.

## Local Run (Recommended)

```bash
npm install
cp .env.example .env
npm run dev
```

Server starts on `http://localhost:3000`.

### Health check

```bash
curl http://localhost:3000/health
```

Expected JSON:

```json
{ "ok": true, "uptime": 12.34, "ts": "2026-02-18T...Z" }
```

### Local simulation (no WhatsApp required)

```bash
curl -X POST http://localhost:3000/simulate \
  -H "Content-Type: application/json" \
  -d '{"from":"905551112233","text":"Saat kordonu için teklif istiyorum"}'
```

Expected response shape (strict):

```json
{
  "reply": "...",
  "intent": "...",
  "fields_collected": ["..."],
  "fields_missing": ["..."],
  "notes_for_human": "..."
}
```

If the LLM fails or times out, fallback is returned quickly:

```json
{
  "reply":"Anladım. Hangi ürün için kullanacaksınız ve kaç mm/ligne ölçü istiyorsunuz?",
  "intent":"qualify",
  "fields_collected":[],
  "fields_missing":["usage","size"],
  "notes_for_human":"LLM failed or timed out"
}
```

## Webhook Verification Test URL

Use this locally to verify route behavior:

```bash
curl "http://localhost:3000/webhook?hub.mode=subscribe&hub.verify_token=replace_with_your_verify_token&hub.challenge=12345"
```

Expected response body: `12345` if token matches.

## Webhook Runtime Flow (`POST /webhook`)

1. Validate payload with zod.
2. Deduplicate message IDs (24h in-memory cache).
3. Rate-limit per phone.
4. Ignore non-text messages.
5. Load state and call LLM with strict JSON instructions.
6. Parse model output (direct parse + one-shot `{...}` repair attempt).
7. Merge collected fields into state (`last_intent`, `last_reply` included).
8. Send fallback/normal/handoff response via Meta API.

## Production Build

```bash
npm run build
npm start
```

## Notes

- No WhatsApp Web automation used (Meta Cloud API only).
- State is in-memory for MVP and resets on restart.
- Logs mask phone numbers and avoid secret values.
