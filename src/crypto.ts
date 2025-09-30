import crypto from 'crypto';

export function computeXHubSignature256(appSecret: string, payload: Buffer): string {
  return 'sha256=' + crypto.createHmac('sha256', appSecret).update(payload).digest('hex');
}

export function verifyXHubSignature256(params: {
  appSecret: string;
  payload: Buffer;
  signatureHeader?: string;
}): boolean {
  const { appSecret, payload, signatureHeader } = params;

  if (!signatureHeader) {
    return false;
  }

  const trimmedSignature = signatureHeader.trim();
  if (!trimmedSignature.startsWith('sha256=')) {
    return false;
  }

  const expected = computeXHubSignature256(appSecret, payload);
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(trimmedSignature, 'utf8');

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}
