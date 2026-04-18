function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lastWordVariants(word: string): string[] {
  const variants = new Set<string>();
  if (word.length <= 1) return [];

  if (word.endsWith('y')) {
    const preY = word[word.length - 2];
    if (preY && !'aeiou'.includes(preY)) {
      variants.add(word.slice(0, -1) + 'ies');
    } else {
      variants.add(word + 's');
    }
  } else if (/(?:s|x|z|ch|sh)$/.test(word)) {
    variants.add(word + 'es');
  } else if (!word.endsWith('s')) {
    variants.add(word + 's');
  }

  if (word.endsWith('ies') && word.length > 3) {
    variants.add(word.slice(0, -3) + 'y');
  }
  if (/(?:s|x|z|ch|sh)es$/.test(word) && word.length > 2) {
    variants.add(word.slice(0, -2));
  }
  if (
    word.endsWith('s') &&
    !word.endsWith('ss') &&
    !word.endsWith('ies') &&
    word.length > 1
  ) {
    variants.add(word.slice(0, -1));
  }

  variants.delete(word);
  return [...variants];
}

export function mentions(haystack: string, needle: string): boolean {
  const h = normalize(haystack);
  const n = normalize(needle);
  if (!n) return false;
  if (h.includes(n)) return true;

  const words = n.split(' ');
  const lastIdx = words.length - 1;
  const last = words[lastIdx];
  if (!last) return false;

  for (const variant of lastWordVariants(last)) {
    const candidate = [...words.slice(0, lastIdx), variant].join(' ');
    if (h.includes(candidate)) return true;
  }
  return false;
}
