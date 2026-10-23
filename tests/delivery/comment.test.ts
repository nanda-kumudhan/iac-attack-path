import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { postComment } from '../../src/action/comment';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('opted-in comment publishing', () => {
  it('requires a token and a PR event before any request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(postComment('report', '')).rejects.toThrow('requires a github-token');
    vi.stubEnv('GITHUB_EVENT_NAME', 'pull_request_target');
    await expect(postComment('report', 'test-token')).rejects.toThrow('pull_request event');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses only runner context for the endpoint and serializes report text as JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'iac-comment-'));
    try {
      const eventFile = join(directory, 'event.json');
      await writeFile(eventFile, JSON.stringify({ pull_request: { number: 7 } }));
      vi.stubEnv('GITHUB_EVENT_NAME', 'pull_request');
      vi.stubEnv('GITHUB_EVENT_PATH', eventFile);
      vi.stubEnv('GITHUB_REPOSITORY', 'owner/repository');
      vi.stubEnv('GITHUB_API_URL', 'https://api.github.com');
      const fetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetch);
      const body = 'untrusted text\n$(no-execution)';
      await postComment(body, 'test-token');
      expect(fetch).toHaveBeenCalledWith('https://api.github.com/repos/owner/repository/issues/7/comments', expect.objectContaining({ method: 'POST', body: JSON.stringify({ body }), redirect: 'error' }));
      fetch.mockResolvedValue({ ok: false, status: 403 });
      await expect(postComment(body, 'test-token')).rejects.toThrow('HTTP 403');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
