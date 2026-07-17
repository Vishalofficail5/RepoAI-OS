import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function loadEnvironment(rootDirectory) {
  try {
    const content = await readFile(path.join(rootDirectory, '.env'), 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {
    return;
  }
}
