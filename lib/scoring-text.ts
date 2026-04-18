export interface LabeledSection {
  label: string;
  text: string;
}

export function buildLabeledCorpus(parsed: Record<string, unknown>): LabeledSection[] {
  const sections: LabeledSection[] = [];

  const topLevelKeys = [
    'technical_feedback',
    'communication_feedback',
    'examples_feedback',
    'depth_feedback',
    'summary',
    'top_strength',
    'main_improvement',
  ] as const;

  for (const key of topLevelKeys) {
    const value = parsed[key];
    if (typeof value === 'string') sections.push({ label: key, text: value });
  }

  const notes = parsed['question_notes'];
  if (Array.isArray(notes)) {
    notes.forEach((entry, i) => {
      if (!entry || typeof entry !== 'object') return;
      const e = entry as Record<string, unknown>;
      if (typeof e['note'] === 'string') {
        sections.push({ label: `question_notes[${i}].note`, text: e['note'] });
      }
      if (typeof e['ideal'] === 'string') {
        sections.push({ label: `question_notes[${i}].ideal`, text: e['ideal'] });
      }
    });
  }

  return sections;
}

export function flatCorpus(sections: LabeledSection[]): string {
  return sections.map((s) => s.text).join(' ');
}

export function formatLabeledCorpus(sections: LabeledSection[]): string {
  return sections
    .map((s) => `[${s.label}]\n"""\n${s.text}\n"""`)
    .join('\n\n');
}
