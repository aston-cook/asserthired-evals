import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCreate = vi.fn();
const mockConstructor = vi.fn();

// MockAnthropic is a real class, not vi.fn().mockImplementation(), because
// vi.fn() wrappers are not constructable and `new Anthropic(...)` would throw.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    public messages = { create: mockCreate };
    constructor(...args: unknown[]) {
      mockConstructor(...args);
    }
  },
}));

import { judge, ModelRefusalError, __resetClientForTests } from './claude-client.js';

function apiError(status: number, message = 'simulated'): Error {
  return Object.assign(new Error(message), { status });
}

function okResponse(text = 'ok') {
  return { content: [{ type: 'text', text }] };
}

describe('claude-client', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCreate.mockReset();
    mockConstructor.mockReset();
    __resetClientForTests();
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    delete process.env['ANTHROPIC_JUDGE_MODEL'];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns on first-try success', async () => {
    mockCreate.mockResolvedValue(okResponse('hi'));
    const result = await judge({ system: 's', user: 'u' });
    expect(result.text).toBe('hi');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('passes the 60s timeout to the SDK', async () => {
    mockCreate.mockResolvedValue(okResponse());
    await judge({ system: 's', user: 'u' });
    const opts = mockCreate.mock.calls[0]?.[1];
    expect(opts).toMatchObject({ timeout: 60_000 });
  });

  it('throws when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    await expect(judge({ system: 's', user: 'u' })).rejects.toThrow('ANTHROPIC_API_KEY');
  });

  it('retries on 429 and eventually succeeds', async () => {
    mockCreate
      .mockRejectedValueOnce(apiError(429))
      .mockResolvedValueOnce(okResponse('recovered'));
    const promise = judge({ system: 's', user: 'u' });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.text).toBe('recovered');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('retries on 500 and eventually succeeds', async () => {
    mockCreate
      .mockRejectedValueOnce(apiError(500))
      .mockRejectedValueOnce(apiError(503))
      .mockResolvedValueOnce(okResponse('finally'));
    const promise = judge({ system: 's', user: 'u' });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.text).toBe('finally');
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it('does not retry on 400', async () => {
    mockCreate.mockRejectedValue(apiError(400, 'bad request'));
    await expect(judge({ system: 's', user: 'u' })).rejects.toThrow('bad request');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('does not retry on 401', async () => {
    mockCreate.mockRejectedValue(apiError(401));
    await expect(judge({ system: 's', user: 'u' })).rejects.toThrow();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('gives up after MAX_RETRIES on persistent 429', async () => {
    mockCreate.mockRejectedValue(apiError(429));
    const promise = judge({ system: 's', user: 'u' });
    const assertion = expect(promise).rejects.toThrow();
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockCreate).toHaveBeenCalledTimes(4);
  });

  it('uses exponential backoff between retries', async () => {
    mockCreate
      .mockRejectedValueOnce(apiError(429))
      .mockRejectedValueOnce(apiError(429))
      .mockResolvedValueOnce(okResponse());

    const promise = judge({ system: 's', user: 'u' });

    await vi.advanceTimersByTimeAsync(999);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(mockCreate).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1999);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(mockCreate).toHaveBeenCalledTimes(3);

    await promise;
  });

  it('uses ANTHROPIC_JUDGE_MODEL when set', async () => {
    process.env['ANTHROPIC_JUDGE_MODEL'] = 'claude-sonnet-4-5';
    mockCreate.mockResolvedValue(okResponse());
    await judge({ system: 's', user: 'u' });
    const payload = mockCreate.mock.calls[0]?.[0];
    expect(payload).toMatchObject({ model: 'claude-sonnet-4-5' });
  });

  it('defaults to claude-haiku-4-5 when no env override (cost default)', async () => {
    mockCreate.mockResolvedValue(okResponse());
    await judge({ system: 's', user: 'u' });
    const payload = mockCreate.mock.calls[0]?.[0];
    expect(payload).toMatchObject({ model: 'claude-haiku-4-5' });
  });

  it('explicit model parameter overrides env var', async () => {
    process.env['ANTHROPIC_JUDGE_MODEL'] = 'claude-haiku-4-5';
    mockCreate.mockResolvedValue(okResponse());
    await judge({ system: 's', user: 'u', model: 'claude-opus-4-7' });
    const payload = mockCreate.mock.calls[0]?.[0];
    expect(payload).toMatchObject({ model: 'claude-opus-4-7' });
  });

  it('reads the answer from text blocks when a thinking block comes first', async () => {
    mockCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: '{"pass": true,' },
        { type: 'text', text: ' "violations": []}' },
      ],
    });
    const result = await judge({ system: 's', user: 'u', model: 'claude-haiku-5-5' });
    expect(result.text).toBe('{"pass": true, "violations": []}');
  });

  it('throws ModelRefusalError on a refusal instead of returning empty text', async () => {
    mockCreate.mockResolvedValue({
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'cyber', explanation: null },
      content: [],
    });
    const err = await judge({ system: 's', user: 'u', model: 'claude-sonnet-5-5' }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ModelRefusalError);
    expect(err).toMatchObject({ model: 'claude-sonnet-5-5', category: 'cyber' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('sends adaptive thinking, effort, and headroom (no temperature) to Claude 5.5 models', async () => {
    mockCreate.mockResolvedValue(okResponse());
    await judge({
      system: 's',
      user: 'u',
      model: 'claude-sonnet-5-5',
      maxTokens: 2000,
      effort: 'medium',
      temperature: 0.2,
    });
    const payload = mockCreate.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      max_tokens: 6000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
    });
    expect(payload).not.toHaveProperty('temperature');
  });

  it('defaults the judge to low effort on an adaptive judge model', async () => {
    process.env['ANTHROPIC_JUDGE_MODEL'] = 'claude-haiku-5-5';
    mockCreate.mockResolvedValue(okResponse());
    await judge({ system: 's', user: 'u' });
    const payload = mockCreate.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 1024 + 2000,
      output_config: { effort: 'low' },
    });
  });

  it('keeps temperature and no thinking params for legacy models', async () => {
    mockCreate.mockResolvedValue(okResponse());
    await judge({ system: 's', user: 'u', model: 'claude-sonnet-4-5', temperature: 0.2 });
    const payload = mockCreate.mock.calls[0]?.[0];
    expect(payload).toMatchObject({ model: 'claude-sonnet-4-5', max_tokens: 1024, temperature: 0.2 });
    expect(payload).not.toHaveProperty('thinking');
    expect(payload).not.toHaveProperty('output_config');
  });
});
