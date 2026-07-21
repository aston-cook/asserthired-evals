// Deterministic local provider for smoke runs. Emits a plausible scoring payload
// shaped like the production scoring output, with dimension scores at the midpoint
// of the case's expectedScoreRange and feedback that references the mustMention
// terms. No network calls.
export default class MockScoringProvider {
  constructor(options = {}) {
    this.providerId = options.id || 'mock-scoring';
  }

  id() {
    return this.providerId;
  }

  async callApi(_prompt, context) {
    const vars = (context && context.vars) || {};
    let goldenCase = {};
    try {
      goldenCase = JSON.parse(vars.caseJson);
    } catch {
      // fall through to defaults
    }
    const range = Array.isArray(goldenCase.expectedScoreRange)
      ? goldenCase.expectedScoreRange
      : [50, 70];
    const mid = Math.round((Number(range[0]) + Number(range[1])) / 2);
    const mustMention = Array.isArray(goldenCase.mustMention)
      ? goldenCase.mustMention
      : [];
    const mentionText =
      mustMention.length > 0
        ? ` Concepts worth reinforcing here include ${mustMention.join(', ')}.`
        : '';

    const payload = {
      technical_score: mid,
      communication_score: mid,
      examples_score: mid,
      depth_score: mid,
      technical_feedback: `The answer engages with the core of the question.${mentionText}`,
      communication_feedback:
        'The response is organized clearly enough to follow the main points.',
      examples_feedback:
        'Adding concrete project context and outcomes would strengthen the response.',
      depth_feedback:
        'There is room to elaborate on the reasoning behind each point next time.',
      summary:
        'The response shows engagement with the question and effort to structure an answer. Building more depth into each point is the top growth area.',
      top_strength: 'Willingness to engage directly with the question asked.',
      main_improvement: 'Focus on adding depth and specifics to each point.',
      question_notes: [
        {
          score: mid,
          note: 'The answer addresses the question at a general level.',
          ideal: 'A perfect answer would combine specific techniques with concrete examples.',
        },
      ],
    };

    return { output: JSON.stringify(payload) };
  }
}
