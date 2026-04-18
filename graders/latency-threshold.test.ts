import { describe, it, expect } from 'vitest';
import latencyThreshold from './latency-threshold.js';
import { baseCase, makeScoringOutput } from '../tests/fixtures.js';

const baseInput = {
  output: makeScoringOutput(),
  test: { vars: baseCase },
};

describe('latency-threshold', () => {
  it('passes with full score within the p50 target', async () => {
    const result = await latencyThreshold({ ...baseInput, context: { latencyMs: 2000 } });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
    expect(result.reason.toLowerCase()).toContain('within');
  });

  it('passes with full score at exactly the p50 target (3000ms <= 3s)', async () => {
    const result = await latencyThreshold({ ...baseInput, context: { latencyMs: 3000 } });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  it('scores 0 (warn) when the p50 target is exceeded', async () => {
    const result = await latencyThreshold({ ...baseInput, context: { latencyMs: 5000 } });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(0);
    expect(result.reason).toContain('p50');
    expect(result.reason).toContain('per-case signal');
  });

  it('annotates p95 breach', async () => {
    const result = await latencyThreshold({ ...baseInput, context: { latencyMs: 8000 } });
    expect(result.pass).toBe(true);
    expect(result.reason).toContain('p95');
  });

  it('annotates p99 breach', async () => {
    const result = await latencyThreshold({ ...baseInput, context: { latencyMs: 15000 } });
    expect(result.pass).toBe(true);
    expect(result.reason).toContain('p99');
  });

  it('handles missing latency gracefully', async () => {
    const result = await latencyThreshold(baseInput);
    expect(result.pass).toBe(true);
    expect(result.score).toBe(0);
    expect(result.reason.toLowerCase()).toContain('no latency');
  });

  it('handles undefined latencyMs type gracefully', async () => {
    const result = await latencyThreshold({ ...baseInput, context: { latencyMs: undefined } });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(0);
  });
});
