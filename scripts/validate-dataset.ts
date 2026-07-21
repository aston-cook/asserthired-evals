import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GoldenCaseSchema } from '../datasets/golden/_schema.js';

const DATASET_DIRS = ['datasets/golden', 'datasets/adversarial'];

interface ValidationError {
  file: string;
  line: number;
  message: string;
}

// Mirrors the normalization in lib/mention.ts.
function normalizeTerm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateFile(dir: string, file: string, seenIds: Map<string, string>): ValidationError[] {
  const errors: ValidationError[] = [];
  const fullPath = join(dir, file);
  const contents = readFileSync(fullPath, 'utf8');
  const lines = contents.split(/\r?\n/);

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (line.length === 0) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      errors.push({
        file: fullPath,
        line: lineNo,
        message: `Invalid JSON: ${(err as Error).message}`,
      });
      return;
    }

    const result = GoldenCaseSchema.safeParse(parsed);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
        errors.push({
          file: fullPath,
          line: lineNo,
          message: `${path}: ${issue.message}`,
        });
      }
      return;
    }

    const { id, mustMention, mustNotMention } = result.data;

    // A mustMention term that is a normalized substring of a mustNotMention
    // term (or vice versa) in the same case means legitimate feedback can earn
    // mention credit and trip the zero-tolerance violation gate at once.
    for (const mention of mustMention) {
      for (const trap of mustNotMention) {
        const m = normalizeTerm(mention);
        const t = normalizeTerm(trap);
        if (m.length > 0 && t.length > 0 && (t.includes(m) || m.includes(t))) {
          errors.push({
            file: fullPath,
            line: lineNo,
            message: `mustMention "${mention}" and mustNotMention "${trap}" overlap as substrings; the mention matcher cannot tell them apart`,
          });
        }
      }
    }

    const firstSeen = seenIds.get(id);
    if (firstSeen) {
      errors.push({
        file: fullPath,
        line: lineNo,
        message: `Duplicate case id "${id}" (first seen in ${firstSeen})`,
      });
    } else {
      seenIds.set(id, `${fullPath}:${lineNo}`);
    }
  });

  return errors;
}

function main(): void {
  const allErrors: ValidationError[] = [];
  const seenIds = new Map<string, string>();
  let totalLines = 0;
  let totalFiles = 0;

  for (const dir of DATASET_DIRS) {
    if (!existsSync(dir)) continue;
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    } catch (err) {
      console.error(`Failed to read ${dir}: ${(err as Error).message}`);
      process.exit(1);
      return;
    }

    for (const file of files) {
      totalFiles += 1;
      const contents = readFileSync(join(dir, file), 'utf8');
      const nonEmpty = contents.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
      totalLines += nonEmpty;
      allErrors.push(...validateFile(dir, file, seenIds));
    }
  }

  if (totalFiles === 0) {
    console.log('No .jsonl dataset files found.');
    return;
  }

  if (allErrors.length === 0) {
    console.log(`Validated ${totalLines} case(s) across ${totalFiles} file(s). All pass.`);
    return;
  }

  console.error(`Validation failed with ${allErrors.length} issue(s):`);
  for (const e of allErrors) {
    console.error(`  ${e.file}:${e.line}  ${e.message}`);
  }
  process.exit(1);
}

main();
