# Instagram Webhook Comment Detector

Node.js service that consumes Instagram Graph API webhooks and emits deduplicated comment jobs into Redis.

## Prerequisites

- Node.js 18+
- Redis instance accessible via URL

## Setup

```bash
npm install
cp .env.example .env
# edit .env with your secrets
```

## Running

- Development: `npm run dev`
- Production build: `npm run build`
- Start compiled server: `npm run start`

The server listens on `PORT` (defaults to `3000`).

## Endpoints

### GET `/webhooks/instagram`

Verification handshake. Returns the `hub.challenge` when `hub.mode=subscribe` and the verify token matches `IG_VERIFY_TOKEN`.

### POST `/webhooks/instagram`

Consumes webhook payloads, validates the `X-Hub-Signature-256` header, deduplicates comment events for seven days, pushes new jobs onto the `ig:comment_jobs` Redis list, and logs `type=ig_comment_detected` when a new comment is seen.

## Validating Signatures Locally

Create a payload file (`payload.json`) containing the sample payload below. Then compute the signature and send the request:

```bash
cat > payload.json <<'PAYLOAD'
{
  "object": "instagram",
  "entry": [
    {
      "id": "17841400000000000",
      "time": 1696000000,
      "changes": [
        {
          "field": "comments",
          "value": {
            "media_id": "17900000000000000",
            "comment_id": "17999999999999999",
            "from": { "id": "1234567890" }
          }
        }
      ]
    }
  ]
}
PAYLOAD

export APP_SECRET=replace-with-facebook-app-secret
SIGNATURE=$(node -e "const crypto = require('crypto'); const fs = require('fs'); const secret = process.env.APP_SECRET; const body = fs.readFileSync('payload.json'); const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex'); console.log(sig);")

curl -X POST "http://localhost:3000/webhooks/instagram" \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: $SIGNATURE" \
  --data-binary @payload.json
```

## Redis Keys

- Idempotency key: `ig:comment_seen:{commentId}` set with `NX` and `EX 604800`
- Job queue: `ig:comment_jobs`

## Sample Payload

```json
{
  "object": "instagram",
  "entry": [
    {
      "id": "17841400000000000",
      "time": 1696000000,
      "changes": [
        {
          "field": "comments",
          "value": {
            "media_id": "17900000000000000",
            "comment_id": "17999999999999999",
            "from": { "id": "1234567890" }
          }
        }
      ]
    }
  ]
}
```
