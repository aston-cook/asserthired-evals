export function extractJson(raw: string): unknown {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {}

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {}
  }

  const firstObj = trimmed.indexOf('{');
  const firstArr = trimmed.indexOf('[');
  const starts = [firstObj, firstArr].filter((i) => i !== -1);
  if (starts.length === 0) return null;
  const start = Math.min(...starts);
  const lastObj = trimmed.lastIndexOf('}');
  const lastArr = trimmed.lastIndexOf(']');
  const end = Math.max(lastObj, lastArr);
  if (end <= start) return null;

  const slice = trimmed.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {}

  return null;
}
