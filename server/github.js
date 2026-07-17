import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFile = promisify(execFileCallback);
const repositorySegment = /^[A-Za-z0-9_.-]+$/;

export function parseGitHubRepositoryUrl(value) {
  if (!/^https?:\/\//i.test(value)) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('GitHub repository URL is invalid');
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password) throw new Error('Use a public https://github.com/owner/repository URL');
  const [owner, repository, ...extra] = url.pathname.split('/').filter(Boolean);
  const name = repository?.replace(/\.git$/i, '');
  if (extra.length || !owner || !name || !repositorySegment.test(owner) || !repositorySegment.test(name)) throw new Error('Use a GitHub repository URL in owner/repository format');
  return { owner, name, url: `https://github.com/${owner}/${name}.git` };
}

export async function clonePublicGitHubRepository(repository, cloneDirectory) {
  await mkdir(cloneDirectory, { recursive: true });
  const suffix = createHash('sha256').update(repository.url).digest('hex').slice(0, 10);
  const destination = path.join(cloneDirectory, `${repository.owner}--${repository.name}-${suffix}`);
  try {
    if (existsSync(destination)) {
      if (!existsSync(path.join(destination, '.git'))) throw new Error('Existing clone directory is invalid');
      await execFile('git', ['-C', destination, 'fetch', '--depth', '1', 'origin'], { windowsHide: true });
    } else {
      await execFile('git', ['clone', '--depth', '1', repository.url, destination], { windowsHide: true });
    }
  } catch (error) {
    const detail = String(error.stderr ?? error.message).replace(/\s+/g, ' ').slice(0, 180);
    throw new Error(`Unable to clone ${repository.owner}/${repository.name}: ${detail}`);
  }
  return destination;
}
