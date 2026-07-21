// Self-healing dataset support (roadmap item from v1). A case whose observed
// score falls outside its expectedScoreRange once is probably model noise; a
// case that misses in run after run is probably a miscalibrated expectation.
// This flags the repeat offenders across recent run summaries and queues them
// for human review instead of silently letting them drag the pass rate down.
// The output is a review queue for a human, deliberately not an auto-editor:
// expectation changes should stay reviewable dataset commits.

import type { RunSummary } from './report.js';

export interface ReviewOccurrence {
  timestamp: string;
  reason: string;
}

export interface ReviewFlag {
  id: string;
  occurrences: ReviewOccurrence[];
}

export interface ReviewQueue {
  runsConsidered: string[];
  minOccurrences: number;
  flags: ReviewFlag[];
}

export interface ReviewQueueOptions {
  // How many of the most recent runs to inspect.
  window?: number;
  // In how many of those runs a case must fail before it is flagged.
  minOccurrences?: number;
}

export function buildReviewQueue(
  summaries: RunSummary[],
  options: ReviewQueueOptions = {},
): ReviewQueue {
  const window = options.window ?? 5;
  const minOccurrences = options.minOccurrences ?? 2;

  const recent = [...summaries]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-window);

  const byCase = new Map<string, ReviewOccurrence[]>();
  for (const summary of recent) {
    for (const failure of summary.scoreInRange.failures ?? []) {
      const list = byCase.get(failure.id) ?? [];
      list.push({ timestamp: summary.timestamp, reason: failure.reason });
      byCase.set(failure.id, list);
    }
  }

  const flags = [...byCase.entries()]
    .filter(([, occurrences]) => occurrences.length >= minOccurrences)
    .map(([id, occurrences]) => ({ id, occurrences }))
    .sort(
      (a, b) =>
        b.occurrences.length - a.occurrences.length || a.id.localeCompare(b.id),
    );

  return {
    runsConsidered: recent.map((s) => s.timestamp),
    minOccurrences,
    flags,
  };
}

export function renderReviewQueue(queue: ReviewQueue): string {
  const lines: string[] = [];
  lines.push('# Dataset review queue');
  lines.push('');
  lines.push(
    `Cases whose overall score fell outside expectedScoreRange in at least ${queue.minOccurrences} of the last ${queue.runsConsidered.length} run(s).`,
  );
  lines.push('');

  if (queue.runsConsidered.length === 0) {
    lines.push('No run summaries found. Run an eval first.');
    return lines.join('\n');
  }

  if (queue.flags.length === 0) {
    lines.push('**Queue is empty.** No case failed its range repeatedly in this window.');
    return lines.join('\n');
  }

  for (const flag of queue.flags) {
    lines.push(
      `## \`${flag.id}\` (${flag.occurrences.length} of ${queue.runsConsidered.length} runs)`,
    );
    lines.push('');
    for (const occurrence of flag.occurrences) {
      lines.push(`- ${occurrence.timestamp}: ${occurrence.reason}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(
    'For each flagged case, decide: is the expectation wrong (recalibrate the range, see the authoring rules in IDEAS.md, widen before upgrading difficulty) or is the model wrong (keep the case as a regression tripwire and file the behavior as a finding)?',
  );
  return lines.join('\n');
}
