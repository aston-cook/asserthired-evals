import { z } from 'zod';

export const GoldenCaseSchema = z
  .object({
    id: z.string(),
    category: z.enum(['manual-testing', 'automation', 'api-testing', 'live-coding']),
    difficulty: z.enum(['entry', 'mid', 'senior', 'principal']),
    question: z.string(),
    candidateAnswer: z.string(),
    expectedTier: z.enum(['strong', 'mid', 'weak', 'off-topic', 'refusal']),
    expectedScoreRange: z.tuple([z.number(), z.number()]),
    mustMention: z.array(z.string()),
    mustNotMention: z.array(z.string()),
    notes: z.string().optional(),
  })
  .refine(({ expectedScoreRange: [min, max] }) => max - min >= 10, {
    message: 'expectedScoreRange must span at least 10 points (Section 5.4)',
    path: ['expectedScoreRange'],
  });

export type GoldenCase = z.infer<typeof GoldenCaseSchema>;

export const QuestionNoteSchema = z.object({
  score: z.number(),
  note: z.string(),
  ideal: z.string(),
});

export type QuestionNote = z.infer<typeof QuestionNoteSchema>;

export const ScoringOutputSchema = z.object({
  technical_score: z.number(),
  communication_score: z.number(),
  examples_score: z.number(),
  depth_score: z.number(),
  technical_feedback: z.string(),
  communication_feedback: z.string(),
  examples_feedback: z.string(),
  depth_feedback: z.string(),
  summary: z.string(),
  top_strength: z.string(),
  main_improvement: z.string(),
  question_notes: z.array(QuestionNoteSchema),
});

export type ScoringOutput = z.infer<typeof ScoringOutputSchema>;

export function computeOverallScore(dimensions: {
  technical_score: number;
  communication_score: number;
  examples_score: number;
  depth_score: number;
}): number {
  const { technical_score, communication_score, examples_score, depth_score } = dimensions;
  return Math.round(
    (technical_score + communication_score + examples_score + depth_score) / 4,
  );
}

export interface GraderResult {
  pass: boolean;
  score: number;
  reason: string;
}

export interface GraderContext {
  latencyMs?: number;
}

export interface GraderInput {
  output: string;
  test: { vars: GoldenCase };
  context?: GraderContext;
}

export type SafetyCategory =
  | 'demographic-bias'
  | 'toxic-language'
  | 'personal-attack'
  | 'other';

export type Severity = 'low' | 'medium' | 'high';

export interface JudgeViolation {
  reason: string;
  claim?: string;
  supportingSpan?: string | null;
  category?: SafetyCategory;
  severity?: Severity;
  excerpt?: string;
  field?: string;
}

export interface JudgeVerdict {
  pass: boolean;
  violations: JudgeViolation[];
}
