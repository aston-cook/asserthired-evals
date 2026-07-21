import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const MARKER = join('prompts', 'scoring-prompt.v1.txt');

export function findRepoRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, MARKER))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start);
}
