import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dataDirectory = path.join(process.cwd(), '.repoai-data');
const dataFile = path.join(dataDirectory, 'repositories.json');

export async function loadRepositories() {
  try {
    return JSON.parse(await readFile(dataFile, 'utf8'));
  } catch {
    return [];
  }
}

export async function saveRepositories(repositories) {
  await mkdir(dataDirectory, { recursive: true });
  const temporaryFile = `${dataFile}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(repositories, null, 2));
  await rename(temporaryFile, dataFile);
}
