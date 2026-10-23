import { readFile } from 'node:fs/promises';

export async function postComment(body: string, token: string): Promise<void> {
  if (!token) throw new Error('post-comment requires a github-token');
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') throw new Error('Comments require a pull_request event');
  const eventFile = process.env.GITHUB_EVENT_PATH;
  if (!eventFile) throw new Error('Missing GITHUB_EVENT_PATH');
  const event = JSON.parse(await readFile(eventFile, 'utf8')) as { number?: number; pull_request?: { number?: number } };
  const number = event.pull_request?.number;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!Number.isSafeInteger(number) || !number || number < 1 || !repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid PR context');
  // These environment variables come from the runner, never from report content.
  const api = process.env.GITHUB_API_URL ?? 'https://api.github.com';
  if (new URL(api).protocol !== 'https:') throw new Error('GitHub API requires HTTPS');
  const response = await fetch(`${api}/repos/${repository}/issues/${number}/comments`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2026-03-10',
    },
    body: JSON.stringify({ body }),
  });
  if (!response.ok) throw new Error(`GitHub comment request failed (HTTP ${response.status}); report artifacts are still available`);
}
