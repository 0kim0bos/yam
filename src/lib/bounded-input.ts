export const HOOK_STDIN_MAX_BYTES = 1024 * 1024;
export const GENERAL_STDIN_MAX_BYTES = 4 * 1024 * 1024;

export type BoundedInputErrorCode = 'input_too_large' | 'invalid_json';

export class BoundedInputError extends Error {
  readonly code: BoundedInputErrorCode;
  readonly maxBytes?: number;

  constructor(code: BoundedInputErrorCode, options: { maxBytes?: number } = {}) {
    const detail = code === 'input_too_large' && options.maxBytes
      ? `stdin input exceeds the ${options.maxBytes}-byte limit`
      : 'stdin input is not a valid JSON object';
    super(`[${code}] ${detail}`);
    this.name = 'BoundedInputError';
    this.code = code;
    this.maxBytes = options.maxBytes;
  }
}

export async function readBoundedStdinText(
  input: NodeJS.ReadableStream & AsyncIterable<string | Buffer>,
  maxBytes: number
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('stdin byte limit must be a positive safe integer');
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of input) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.byteLength;
    if (totalBytes > maxBytes) {
      throw new BoundedInputError('input_too_large', { maxBytes });
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, totalBytes).toString('utf8');
}

export async function readBoundedStdinJson(
  input: NodeJS.ReadableStream & AsyncIterable<string | Buffer>,
  maxBytes: number
): Promise<Record<string, unknown>> {
  const text = (await readBoundedStdinText(input, maxBytes)).trim();
  if (!text) return {};

  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BoundedInputError('invalid_json');
    }
    return value;
  } catch (error) {
    if (error instanceof BoundedInputError) throw error;
    throw new BoundedInputError('invalid_json');
  }
}
