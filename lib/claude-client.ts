import Anthropic from '@anthropic-ai/sdk';
import { JUDGE_EFFORT, JUDGE_MODEL, requestShape } from './models.js';
import type { Effort } from './models.js';

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

// See JUDGE_MODEL in lib/models.ts for why the judge stays on Haiku 4.5. The
// initial baseline runs on 2026-07-21 used claude-sonnet-4-5 as the judge; set
// ANTHROPIC_JUDGE_MODEL=claude-sonnet-4-5 to reproduce them.
export function defaultModel(): string {
  return process.env['ANTHROPIC_JUDGE_MODEL'] ?? JUDGE_MODEL;
}

// Raised when the model's safety classifiers decline the request. The API
// returns HTTP 200 with stop_reason "refusal", so without this check the caller
// would see an empty string and report it as malformed JSON.
export class ModelRefusalError extends Error {
  constructor(
    public readonly model: string,
    public readonly category: string | null,
  ) {
    super(`${model} refused the request${category ? ` (${category})` : ''}`);
    this.name = 'ModelRefusalError';
  }
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
  // Answer budget. Adaptive-thinking models get thinking headroom on top.
  maxTokens?: number;
  // Sent to legacy models only; adaptive models reject non-default values.
  temperature?: number;
  // Thinking effort on adaptive models; ignored by legacy models.
  effort?: Effort;
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
  temperature,
  effort = JUDGE_EFFORT,
}: JudgeCallInput): Promise<JudgeCallOutput> {
  const client = getClient();
  const selectedModel = model ?? defaultModel();
  const shape = requestShape(selectedModel, { answerTokens: maxTokens, effort, temperature });
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const start = performance.now();
      const response = await client.messages.create(
        {
          model: selectedModel,
          system,
          messages: [{ role: 'user', content: user }],
          ...shape,
        },
        { timeout: TIMEOUT_MS },
      );
      const latencyMs = performance.now() - start;

      if (response.stop_reason === 'refusal') {
        throw new ModelRefusalError(selectedModel, response.stop_details?.category ?? null);
      }

      // Read blocks by type: on adaptive-thinking models the first block is
      // usually a thinking block, not the answer.
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

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
