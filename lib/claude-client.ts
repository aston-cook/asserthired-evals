import Anthropic from '@anthropic-ai/sdk';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const TIMEOUT_MS = 60_000;

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

function defaultModel(): string {
  return process.env['ANTHROPIC_JUDGE_MODEL'] ?? 'claude-sonnet-4-5';
}

function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = (err as { status?: unknown }).status;
  if (typeof status !== 'number') return false;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface JudgeCallInput {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
}

export interface JudgeCallOutput {
  text: string;
  latencyMs: number;
}

export async function judge({
  system,
  user,
  model,
  maxTokens = 1024,
}: JudgeCallInput): Promise<JudgeCallOutput> {
  const client = getClient();
  const selectedModel = model ?? defaultModel();
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const start = performance.now();
      const response = await client.messages.create(
        {
          model: selectedModel,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
        },
        { timeout: TIMEOUT_MS },
      );
      const latencyMs = performance.now() - start;

      const firstBlock = response.content[0];
      const text = firstBlock && firstBlock.type === 'text' ? firstBlock.text : '';

      return { text, latencyMs };
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === MAX_RETRIES) {
        throw err;
      }
      await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt));
    }
  }

  throw lastError;
}

export function __resetClientForTests(): void {
  cachedClient = null;
}
