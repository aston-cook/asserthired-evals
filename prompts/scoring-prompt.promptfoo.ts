import { buildScoringMessages } from '../lib/scoring-messages.js';
import { decodeCaseVars } from '../lib/promptfoo-adapter.js';

interface PromptFunctionContext {
  vars: Record<string, unknown>;
}

export default async function scoringPrompt({ vars }: PromptFunctionContext) {
  const c = decodeCaseVars(vars);
  const { system, user } = buildScoringMessages(c);
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
