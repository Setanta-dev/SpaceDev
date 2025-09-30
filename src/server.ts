import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import pino from 'pino';
import { createRedisClient } from './redis';
import { verifyXHubSignature256 } from './crypto';
import { CommentJob, IgChange, IgEntry, IgWebhookBody } from './types';

dotenv.config();

const {
  PORT,
  APP_SECRET,
  IG_VERIFY_TOKEN,
  REDIS_URL,
} = process.env;

if (!APP_SECRET) {
  throw new Error('APP_SECRET environment variable is required');
}

if (!IG_VERIFY_TOKEN) {
  throw new Error('IG_VERIFY_TOKEN environment variable is required');
}

if (!REDIS_URL) {
  throw new Error('REDIS_URL environment variable is required');
}

const port = Number(PORT) || 3000;
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const redis = createRedisClient(REDIS_URL);

const app = express();
const instagramRawBody = bodyParser.raw({ type: 'application/json' });

app.get('/webhooks/instagram', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const verifyToken = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && verifyToken === IG_VERIFY_TOKEN && typeof challenge === 'string') {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post('/webhooks/instagram', instagramRawBody, async (req: Request, res: Response) => {
  const rawBody = req.body;
  if (!Buffer.isBuffer(rawBody)) {
    logger.warn({ type: 'invalid_payload_body' }, 'Expected raw Buffer for request body');
    return res.status(400).json({ error: 'Malformed JSON' });
  }

  const signatureHeader = req.get('X-Hub-Signature-256');
  const signatureIsValid = verifyXHubSignature256({
    appSecret: APP_SECRET,
    payload: rawBody,
    signatureHeader,
  });

  if (!signatureIsValid) {
    logger.warn({ type: 'signature_verification_failed' }, 'Failed to verify X-Hub-Signature-256');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch (error) {
    logger.warn({ type: 'json_parse_error', error }, 'Failed to parse webhook payload JSON');
    return res.status(400).json({ error: 'Malformed JSON' });
  }

  if (!isIgWebhookBody(parsed)) {
    logger.warn({ type: 'unexpected_payload_shape' }, 'Received payload without required fields');
    return res.status(200).json({ received: true });
  }

  try {
    await processWebhookBody(parsed);
  } catch (error) {
    logger.error({ err: error, type: 'webhook_processing_error' }, 'Failed to process webhook payload');
    return res.status(500).json({ error: 'Internal server error' });
  }

  return res.status(200).json({ received: true });
});

function isIgWebhookBody(input: unknown): input is IgWebhookBody {
  if (!input || typeof input !== 'object') {
    return false;
  }

  const body = input as Partial<IgWebhookBody>;
  if (!Array.isArray(body.entry)) {
    return false;
  }

  return true;
}

async function processWebhookBody(body: IgWebhookBody): Promise<void> {
  if (!Array.isArray(body.entry)) {
    return;
  }

  for (const entry of body.entry) {
    if (!isValidEntry(entry)) {
      continue;
    }

    const eventTime = Number(entry.time) || Math.floor(Date.now() / 1000);

    for (const change of entry.changes) {
      if (!isCommentChange(change)) {
        continue;
      }

      const { commentId, mediaId } = extractCommentIdentifiers(change);
      if (!commentId || !mediaId) {
        continue;
      }

      const dedupeKey = `ig:comment_seen:${commentId}`;
      const inserted = await redis.set(dedupeKey, '1', 'NX', 'EX', 604800);
      if (inserted !== 'OK') {
        continue;
      }

      const job: CommentJob = {
        commentId,
        mediaId,
        eventTime,
      };

      await redis.lpush('ig:comment_jobs', JSON.stringify(job));

      logger.info({
        type: 'ig_comment_detected',
        commentId,
        mediaId,
        eventTime,
      }, 'Detected new Instagram comment');
    }
  }
}

function isValidEntry(entry: IgEntry): boolean {
  return Boolean(entry && typeof entry.id === 'string' && Array.isArray(entry.changes));
}

function isCommentChange(change: IgChange): boolean {
  if (!change || typeof change.field !== 'string' || typeof change.value !== 'object' || change.value === null) {
    return false;
  }

  const normalizedField = change.field.toLowerCase();
  return normalizedField === 'comments' || normalizedField === 'instagram_comments';
}

function extractCommentIdentifiers(change: IgChange): { commentId?: string; mediaId?: string } {
  const value = change.value;
  const commentId = typeof value.comment_id === 'string'
    ? value.comment_id
    : typeof value.id === 'string'
      ? value.id
      : undefined;

  const mediaId = typeof value.media_id === 'string' ? value.media_id : undefined;

  return { commentId, mediaId };
}

async function start() {
  try {
    await redis.connect();
    logger.info('Connected to Redis');
  } catch (error) {
    logger.error({ err: error }, 'Failed to connect to Redis');
    process.exitCode = 1;
    throw error;
  }

  app.listen(port, () => {
    logger.info({ port }, 'Instagram webhook listener started');
  });
}

start().catch((error) => {
  logger.error({ err: error }, 'Failed to start server');
  process.exit(1);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down');
  await redis.quit();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down');
  await redis.quit();
  process.exit(0);
});
