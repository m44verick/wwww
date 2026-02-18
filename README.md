# WhatsApp Business API (Meta Cloud API) + AI Reply Engine

Production-ready Node.js + TypeScript webhook server for inbound WhatsApp messages with lightweight conversation state and LLM-driven replies.

## Features

- ✅ Meta Cloud API webhook verification (`GET /webhook`)
- ✅ Inbound message processing (`POST /webhook`)
- ✅ Lightweight per-phone state storage (memory implementation, swappable interface)
- ✅ LLM call with fixed `SYSTEM_PROMPT` and strict JSON response parsing
- ✅ Handoff flow (`intent == handoff`) with escalation log and ack message
- ✅ Idempotency (dedupe message IDs for 24h)
- ✅ Basic in-memory per-phone rate limiting
- ✅ No full chat-history persistence
- ✅ Optional manual send endpoint (`POST /send`)

## Tech Stack

- Node.js 20
- TypeScript
- Express
- dotenv
- zod
- axios

## Project Structure

```txt
src/
  server.ts      # webhook + orchestration
  meta.ts        # WhatsApp API helpers
  llm.ts         # LLM request/response handling
  state.ts       # state interface + in-memory implementation
  validators.ts  # zod schemas for env/payload/LLM output
.env.example
README.md
```

## Environment Variables

Copy `.env.example` to `.env` and fill values:

- `PORT`
- `META_VERIFY_TOKEN`
- `META_ACCESS_TOKEN`
- `META_PHONE_NUMBER_ID`
- `OPENAI_API_KEY` (or `LLM_API_KEY`)
- `SYSTEM_PROMPT` (long fixed system prompt)
- `MODEL_NAME` (default: `gpt-4o-mini`)
- `MAX_OUTPUT_TOKENS` (default: `300`)

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

For production build/run:

```bash
npm run build
npm start
```

## Meta Webhook Setup

In Meta Developer App > WhatsApp > Configuration:

1. Set callback URL to:
   - `https://<your-domain>/webhook`
2. Set verify token to exactly `META_VERIFY_TOKEN` in your `.env`.
3. Subscribe to message webhook events.

Verification behavior:
- `GET /webhook` reads `hub.mode`, `hub.verify_token`, `hub.challenge`
- If token matches, returns challenge
- Else returns `403`

## Runtime Flow (`POST /webhook`)

1. Validate webhook payload shape via zod.
2. Extract inbound message fields (`from`, text body, message id).
3. Ignore non-text messages (logged only).
4. Enforce idempotency using in-memory message-id cache (24h).
5. Apply basic in-memory per-phone rate limit.
6. Load state for phone.
7. Send LLM input:
   - system: `SYSTEM_PROMPT`
   - user JSON: `{ last_customer_message, state, timestamp_iso }`
8. Parse and validate strict JSON response fields:
   - `reply`
   - `intent`
   - `fields_collected`
   - `fields_missing`
   - `notes_for_human`
9. If invalid LLM output:
   - fallback Turkish clarifying question (usage + size)
10. Merge `fields_collected` into state and set `last_intent`.
11. If `intent == "handoff"`:
   - send fixed handoff ack message
   - log masked phone + notes/context to console (CRM placeholder)
12. Else send only `reply` to WhatsApp.

## WhatsApp Send API Used

`POST https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}/messages`

Body:

```json
{
  "messaging_product": "whatsapp",
  "to": "<recipient>",
  "type": "text",
  "text": { "body": "..." }
}
```

Auth header:
- `Authorization: Bearer <META_ACCESS_TOKEN>`

## Local Testing (curl)

### 1) Webhook Verification

```bash
curl "http://localhost:3000/webhook?hub.mode=subscribe&hub.verify_token=replace_with_your_verify_token&hub.challenge=12345"
```

Expected response body: `12345`

### 2) Simulate Inbound Text Message

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [
      {
        "changes": [
          {
            "field": "messages",
            "value": {
              "messages": [
                {
                  "id": "wamid.TEST123",
                  "from": "905551112233",
                  "timestamp": "1739000000",
                  "type": "text",
                  "text": { "body": "Saat kordonu toptan fiyat alabilir miyim?" }
                }
              ]
            }
          }
        ]
      }
    ]
  }'
```

### 3) Manual Send Endpoint

```bash
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -d '{"to":"905551112233","text":"Merhaba, nasıl yardımcı olabilirim?"}'
```

## Notes

- State is intentionally minimal and in memory; restart clears it.
- `StateStore` interface enables easy Redis replacement later.
- Phone numbers are masked in logs to reduce sensitive-data exposure.
- Do **not** use WhatsApp Web automation; this implementation uses Meta Cloud API webhook + send endpoint only.
