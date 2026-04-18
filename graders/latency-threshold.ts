import type { GraderInput, GraderResult } from '../lib/types.js';

const P50_TARGET_MS = 3000;
const P95_TARGET_MS = 7000;
const P99_TARGET_MS = 12000;

export default async function latencyThreshold({ context }: GraderInput): Promise<GraderResult> {
  const latency = context?.latencyMs;
  if (typeof latency !== 'number') {
    return {
      pass: true,
      score: 0,
      reason: 'No latency measurement available for this case',
    };
  }

  let tier: string | null = null;
  if (latency > P99_TARGET_MS) tier = `p99 target (${P99_TARGET_MS}ms)`;
  else if (latency > P95_TARGET_MS) tier = `p95 target (${P95_TARGET_MS}ms)`;
  else if (latency > P50_TARGET_MS) tier = `p50 target (${P50_TARGET_MS}ms)`;

  return {
    pass: true,
    score: tier ? 0 : 1,
    reason: tier
      ? `Case latency ${latency.toFixed(0)}ms exceeds ${tier} (per-case signal; suite percentiles computed by runner)`
      : `Case latency ${latency.toFixed(0)}ms within all per-case targets`,
  };
}
