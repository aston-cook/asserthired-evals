// Single source of truth for model ids and per-model request shaping.
//
// promptfooconfig.yaml and promptfooconfig.redteam.yaml cannot import this
// file, so lib/models.test.ts asserts that their provider blocks match the
// scoring constants below. Change both together.

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// System under test: the model that scores interview answers.
// Adaptive thinking at medium effort is the starting point for structured
// grading on the Claude 5.5 models; run an effort sweep before moving it.
export const SCORING_MODEL = 'claude-sonnet-5-5';
export const SCORING_EFFORT: Effort = 'medium';
// Budget for the scoring JSON itself. Thinking headroom is added on top for
// adaptive models (see requestShape), so this number keeps meaning "the answer".
export const SCORING_ANSWER_TOKENS = 2000;

// LLM-as-judge default. Held on Haiku 4.5 on purpose: the v1 faithfulness and
// safety baselines and the judge calibration were all measured on a 4.x judge,
// and a judge change moves every judged metric at once. Claude Haiku 5.5 is the
// cheaper candidate; validate it with
//   ANTHROPIC_JUDGE_MODEL=claude-haiku-5-5 pnpm calibrate:judge
// before switching the default.
export const JUDGE_MODEL = 'claude-haiku-4-5';
// Effort used when the judge runs on an adaptive-thinking model. Judging is a
// rubric-driven classification, which is what `low` is for.
export const JUDGE_EFFORT: Effort = 'low';

// The v1 baseline runs (2026-07-21) scored on this model at temperature 0.2.
// EVAL_SCORING_MODEL=claude-sonnet-4-5 reproduces that request shape for the
// consistency sampler.
export const BASELINE_SCORING_MODEL = 'claude-sonnet-4-5';
export const BASELINE_SCORING_TEMPERATURE = 0.2;

// Models that take adaptive thinking with an effort level and reject
// non-default temperature, top_p, and top_k with a 400: Opus 4.7 and 4.8, and
// every Claude 5 model.
const ADAPTIVE_MODEL = /^claude-(opus-4-[78]|(opus|sonnet|haiku|fable|mythos)-5)(?![0-9])/;

export function isAdaptiveModel(model: string): boolean {
  return ADAPTIVE_MODEL.test(model);
}

// Thinking counts toward max_tokens even when its text is not returned, so an
// adaptive request gets this much on top of the answer budget. max_tokens is a
// ceiling, not a charge: unused headroom costs nothing.
const THINKING_HEADROOM: Record<Effort, number> = {
  low: 2000,
  medium: 4000,
  high: 8000,
  xhigh: 16000,
  max: 32000,
};

export interface ShapeOptions {
  answerTokens: number;
  effort: Effort;
  // Applied to legacy models only; adaptive models 400 on non-default values.
  temperature?: number;
}

export interface RequestShape {
  max_tokens: number;
  temperature?: number;
  thinking?: { type: 'adaptive' };
  output_config?: { effort: Effort };
}

export function requestShape(model: string, options: ShapeOptions): RequestShape {
  if (isAdaptiveModel(model)) {
    return {
      max_tokens: options.answerTokens + THINKING_HEADROOM[options.effort],
      thinking: { type: 'adaptive' },
      output_config: { effort: options.effort },
    };
  }
  return {
    max_tokens: options.answerTokens,
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
  };
}
