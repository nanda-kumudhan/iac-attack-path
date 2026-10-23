import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { formatMarkdown } from '../report/markdown';
import { formatSarif } from '../report/sarif';
import { MAX_REPORT_BYTES, parseReport, type Report } from '../report/schema';

export async function readReport(file: string): Promise<Report> {
  if ((await stat(file)).size > MAX_REPORT_BYTES) throw new Error('Report exceeds the 5 MiB limit');
  return parseReport(await readFile(file, 'utf8'));
}

export async function writeArtifacts(report: Report, directory: string) {
  await mkdir(directory, { recursive: true });
  const markdownFile = resolve(directory, 'report.md');
  const sarifFile = resolve(directory, 'report.sarif');
  const markdown = formatMarkdown(report);
  await writeFile(markdownFile, markdown);
  await writeFile(sarifFile, `${JSON.stringify(formatSarif(report), null, 2)}\n`);
  return { markdownFile, sarifFile, markdown };
}
