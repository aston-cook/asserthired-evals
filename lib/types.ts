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

export const ScoringOutputSchema = z.object({
  score: z.number(),
  feedback: z.string(),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
});

export type ScoringOutput = z.infer<typeof ScoringOutputSchema>;

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
}

export interface JudgeVerdict {
  pass: boolean;
  violations: JudgeViolation[];
}
