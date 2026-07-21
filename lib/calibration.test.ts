import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  loadLabeledCases,
  renderCalibrationReport,
  scoreJudgeVerdicts,
} from './calibration.js';
import type { LabeledFaithfulnessCase } from './calibration.js';
import { findRepoRoot } from './repo-root.js';

const DATASET_PATH = join(
  findRepoRoot(),
  'datasets/calibration/faithfulness-labeled.jsonl',
);

function makeLabeled(
  overrides: Partial<LabeledFaithfulnessCase> & { id: string },
): LabeledFaithfulnessCase {
  return {
    question: 'q',
    candidateAnswer: 'a',
    feedback: {
      technical_score: 50,
      communication_score: 50,
      examples_score: 50,
      depth_score: 50,
      technical_feedback: 'tf',
      communication_feedback: 'cf',
      examples_feedback: 'ef',
      depth_feedback: 'df',
      summary: 's',
      top_strength: 'ts',
      main_improvement: 'mi',
      question_notes: [{ score: 50, note: 'n', ideal: 'i' }],
    },
    expectedViolations: [],
    ...overrides,
  };
}

describe('loadLabeledCases', () => {
  it('loads the committed labeled set and it is well formed', () => {
    const cases = loadLabeledCases(DATASET_PATH);
    expect(cases.length).toBeGreaterThanOrEqual(10);

    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);

    // The set must exercise both judge failure modes: cases with planted
    // violations (recall) and known-clean cases (precision).
    expect(cases.some((c) => c.expectedViolations.length > 0)).toBe(true);
    expect(cases.some((c) => c.expectedViolations.length === 0)).toBe(true);
  });
});

describe('scoreJudgeVerdicts', () => {
  it('gives a perfect judge perfect precision and recall', () => {
    const cases = [
      makeLabeled({ id: 'c1', expectedViolations: [{ mustMatch: 'Selenium' }] }),
      makeLabeled({ id: 'c2' }),
    ];
    const result = scoreJudgeVerdicts(cases, [
      { id: 'c1', flaggedClaims: ['Great coverage of Selenium automation'] },
      { id: 'c2', flaggedClaims: [] },
    ]);
    expect(result.precision).toBe(1);
    expect(result.recall).toBe(1);
    expect(result.f1).toBe(1);
  });

  it('counts unexpected flags as false positives', () => {
    const cases = [makeLabeled({ id: 'c1' })];
    const result = scoreJudgeVerdicts(cases, [
      { id: 'c1', flaggedClaims: ['invented complaint'] },
    ]);
    expect(result.falsePositives).toBe(1);
    expect(result.precision).toBe(0);
    // Nothing was planted, so recall is untouched.
    expect(result.recall).toBe(1);
  });

  it('counts missed planted violations as false negatives', () => {
    const cases = [
      makeLabeled({
        id: 'c1',
        expectedViolations: [{ mustMatch: 'Selenium' }, { mustMatch: '95%' }],
      }),
    ];
    const result = scoreJudgeVerdicts(cases, [
      { id: 'c1', flaggedClaims: ['mentions Selenium'] },
    ]);
    expect(result.truePositives).toBe(1);
    expect(result.falseNegatives).toBe(1);
    expect(result.recall).toBe(0.5);
  });

  it('matches claims after normalization of case and punctuation', () => {
    const cases = [
      makeLabeled({
        id: 'c1',
        expectedViolations: [{ mustMatch: 'test automation pyramid' }],
      }),
    ];
    const result = scoreJudgeVerdicts(cases, [
      { id: 'c1', flaggedClaims: ['Your application of the Test-Automation Pyramid stood out'] },
    ]);
    expect(result.truePositives).toBe(1);
  });

  it('does not double-count one expected violation matched by two claims', () => {
    const cases = [
      makeLabeled({ id: 'c1', expectedViolations: [{ mustMatch: 'Selenium' }] }),
    ];
    const result = scoreJudgeVerdicts(cases, [
      { id: 'c1', flaggedClaims: ['Selenium praise', 'more Selenium praise'] },
    ]);
    // Two matching claims for one planted violation: claim-level TP is 2, but
    // only one distinct violation was found.
    expect(result.truePositives).toBe(2);
    expect(result.violationsFound).toBe(1);
    expect(result.falseNegatives).toBe(0);
    expect(result.recall).toBe(1);
  });

  it('does not let a duplicated true positive inflate recall when another violation is missed', () => {
    const cases = [
      makeLabeled({
        id: 'c1',
        expectedViolations: [{ mustMatch: 'Selenium' }, { mustMatch: '95%' }],
      }),
    ];
    // Judge cites the Selenium violation twice and never catches the 95% one.
    const result = scoreJudgeVerdicts(cases, [
      { id: 'c1', flaggedClaims: ['Selenium claim', 'again Selenium'] },
    ]);
    expect(result.violationsFound).toBe(1);
    expect(result.falseNegatives).toBe(1);
    // True detection rate is 1 of 2 = 0.5, not the claim-mixed 2/3 = 0.667.
    expect(result.recall).toBe(0.5);
  });

  it('reports cases without verdicts as unjudged and excludes them', () => {
    const cases = [
      makeLabeled({ id: 'c1', expectedViolations: [{ mustMatch: 'Selenium' }] }),
      makeLabeled({ id: 'c2' }),
    ];
    const result = scoreJudgeVerdicts(cases, [{ id: 'c2', flaggedClaims: [] }]);
    expect(result.unjudged).toEqual(['c1']);
    expect(result.falseNegatives).toBe(0);
    expect(result.perCase.map((c) => c.id)).toEqual(['c2']);
  });
});

describe('renderCalibrationReport', () => {
  it('renders metrics and per-case rows', () => {
    const cases = [
      makeLabeled({ id: 'c1', expectedViolations: [{ mustMatch: 'Selenium' }] }),
    ];
    const result = scoreJudgeVerdicts(cases, [
      { id: 'c1', flaggedClaims: ['flagged Selenium', 'bogus extra flag'] },
    ]);
    const text = renderCalibrationReport(result, {
      model: 'test-judge',
      datasetPath: 'datasets/calibration/faithfulness-labeled.jsonl',
    });
    expect(text).toContain('`test-judge`');
    expect(text).toContain('| Precision | 50.0% (1 TP, 1 FP) |');
    expect(text).toContain('| Recall | 100.0% (0 missed) |');
    expect(text).toContain('False alarm: "bogus extra flag"');
  });
});
