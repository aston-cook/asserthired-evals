import { describe, expect, it } from 'vitest';
import { buildReviewQueue, renderReviewQueue } from './review-queue.js';
import { makeRunSummary } from '../tests/fixtures.js';

function summaryWithFailures(
  timestamp: string,
  failures: Array<{ id: string; reason: string }>,
) {
  return makeRunSummary({
    timestamp,
    scoreInRange: {
      ran: true,
      passed: 65 - failures.length,
      total: 65,
      passRate: (65 - failures.length) / 65,
      failures,
    },
  });
}

describe('buildReviewQueue', () => {
  it('flags cases that fail repeatedly and ignores one-off misses', () => {
    const queue = buildReviewQueue([
      summaryWithFailures('2026-07-01', [
        { id: 'api-0020', reason: 'Overall 40 outside [8, 38]' },
        { id: 'manual-0003', reason: 'Overall 91 outside [60, 85]' },
      ]),
      summaryWithFailures('2026-07-08', [
        { id: 'api-0020', reason: 'Overall 41 outside [8, 38]' },
      ]),
      summaryWithFailures('2026-07-15', []),
    ]);

    expect(queue.flags.map((f) => f.id)).toEqual(['api-0020']);
    expect(queue.flags[0]?.occurrences).toHaveLength(2);
  });

  it('only counts failures inside the window', () => {
    const queue = buildReviewQueue(
      [
        summaryWithFailures('2026-06-01', [{ id: 'old-case', reason: 'miss' }]),
        summaryWithFailures('2026-07-01', [{ id: 'old-case', reason: 'miss' }]),
        summaryWithFailures('2026-07-08', []),
        summaryWithFailures('2026-07-15', []),
      ],
      { window: 3 },
    );
    expect(queue.runsConsidered).toEqual(['2026-07-01', '2026-07-08', '2026-07-15']);
    expect(queue.flags).toEqual([]);
  });

  it('sorts flags by occurrence count, then id', () => {
    const miss = (id: string) => ({ id, reason: 'out of range' });
    const queue = buildReviewQueue([
      summaryWithFailures('2026-07-01', [miss('b-case'), miss('a-case')]),
      summaryWithFailures('2026-07-08', [miss('b-case'), miss('a-case')]),
      summaryWithFailures('2026-07-15', [miss('b-case')]),
    ]);
    expect(queue.flags.map((f) => f.id)).toEqual(['b-case', 'a-case']);
  });

  it('respects a custom minimum occurrence count', () => {
    const miss = { id: 'api-0020', reason: 'out of range' };
    const queue = buildReviewQueue(
      [
        summaryWithFailures('2026-07-01', [miss]),
        summaryWithFailures('2026-07-08', [miss]),
        summaryWithFailures('2026-07-15', []),
      ],
      { minOccurrences: 3 },
    );
    expect(queue.flags).toEqual([]);
  });
});

describe('renderReviewQueue', () => {
  it('renders flagged cases with per-run reasons', () => {
    const queue = buildReviewQueue([
      summaryWithFailures('2026-07-01', [{ id: 'api-0020', reason: 'Overall 40 outside [8, 38]' }]),
      summaryWithFailures('2026-07-08', [{ id: 'api-0020', reason: 'Overall 41 outside [8, 38]' }]),
      summaryWithFailures('2026-07-15', []),
    ]);
    const text = renderReviewQueue(queue);
    expect(text).toContain('`api-0020` (2 of 3 runs)');
    expect(text).toContain('Overall 41 outside [8, 38]');
  });

  it('says so when the queue is empty', () => {
    const queue = buildReviewQueue([
      summaryWithFailures('2026-07-01', []),
      summaryWithFailures('2026-07-08', []),
    ]);
    expect(renderReviewQueue(queue)).toContain('Queue is empty');
  });

  it('says so when there are no runs at all', () => {
    expect(renderReviewQueue(buildReviewQueue([]))).toContain('No run summaries found');
  });
});
