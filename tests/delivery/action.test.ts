import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import demo from '../../examples/reports/demo.json';

const execute = promisify(execFile);
let temporary: string;
let bundle: string;
let runNumber = 0;

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'iac-delivery-'));
  bundle = join(temporary, 'action.cjs');
  await build({ entryPoints: ['src/action/index.ts'], outfile: bundle, bundle: true, platform: 'node', target: 'node24', format: 'cjs' });
});
afterAll(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });

async function runAction(input: unknown, options: { allowDemo?: boolean; fail?: boolean; comment?: boolean } = {}) {
  const id = ++runNumber;
  const inputFile = join(temporary, `input-${id}.json`);
  const outputFile = join(temporary, `outputs-${id}`);
  const directory = join(temporary, `artifacts-${id}`);
  await writeFile(inputFile, typeof input === 'string' ? input : JSON.stringify(input));
  await writeFile(outputFile, '');
  const env = {
    ...process.env,
    'INPUT_REPORT-FILE': inputFile,
    'INPUT_OUTPUT-DIRECTORY': directory,
    'INPUT_ALLOW-DEMO': String(options.allowDemo ?? false),
    'INPUT_FAIL-ON-INTRODUCED': String(options.fail ?? true),
    'INPUT_POST-COMMENT': String(options.comment ?? false),
    'INPUT_GITHUB-TOKEN': '',
    GITHUB_OUTPUT: outputFile,
    GITHUB_EVENT_NAME: 'pull_request',
  };
  let code = 0;
  let stdout = '';
  try { stdout = (await execute(process.execPath, [bundle], { env })).stdout; }
  catch (error) {
    const failure = error as { code: number; stdout: string };
    if (typeof failure.code !== 'number') throw error;
    code = failure.code;
    stdout = failure.stdout;
  }
  return { code, stdout, directory, outputs: await readFile(outputFile, 'utf8') };
}

describe('Action delivery verdict', () => {
  it('rejects demo reports by default', async () => {
    const result = await runAction(demo);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('Synthetic demo rejected');
    expect(result.outputs).toBe('');
  });

  it('writes artifacts and fails for possible introduced paths even without definite paths', async () => {
    const input = structuredClone(demo);
    input.paths = input.paths.filter((path) => path.certainty === 'possible');
    const result = await runAction(input, { allowDemo: true });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('1 introduced attack path(s), including 1 possible');
    expect(result.outputs).toContain('introduced-count');
    expect(await readFile(join(result.directory, 'report.md'), 'utf8')).toContain('possible');
    expect(JSON.parse(await readFile(join(result.directory, 'report.sarif'), 'utf8')).version).toBe('2.1.0');
  });

  it('passes a complete empty engine report', async () => {
    const result = await runAction({ schemaVersion: 1, analysis: { status: 'complete', warnings: [] }, paths: [] });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Introduced: 0');
  });

  it('supports explicit report-only mode and avoids logging private resource names', async () => {
    const result = await runAction(demo, { allowDemo: true, fail: false });
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain('aws_s3_bucket');
  });

  it.each(['{', { schemaVersion: 1, paths: [] }])('fails invalid input rather than producing a clean report', async (input) => {
    const result = await runAction(input);
    expect(result.code).toBe(1);
    expect(result.outputs).toBe('');
    expect(result.stdout).toContain('Invalid report');
  });

  it('preserves a gate failure when an opted-in comment cannot be posted', async () => {
    const result = await runAction(demo, { allowDemo: true, comment: true });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('2 introduced attack path(s)');
    expect(result.stdout).toContain('requires a github-token');
  });
});
