import * as core from '@actions/core';
import { readReport, writeArtifacts } from './artifacts';
import { counts } from '../report/schema';
import { postComment } from './comment';

async function run() {
  const allowDemo = core.getBooleanInput('allow-demo');
  const failOnIntroduced = core.getBooleanInput('fail-on-introduced');
  const shouldComment = core.getBooleanInput('post-comment');
  const report = await readReport(core.getInput('report-file', { required: true }));
  if (report.analysis.status === 'demo' && !allowDemo) throw new Error('Synthetic demo rejected. A security gate needs an engine-produced complete report.');
  const artifacts = await writeArtifacts(report, core.getInput('output-directory') || 'iac-report');
  const total = counts(report);
  core.setOutput('introduced-count', total.introduced);
  core.setOutput('markdown-file', artifacts.markdownFile);
  core.setOutput('sarif-file', artifacts.sarifFile);
  // Summary is opt-in to GitHub too: local artifacts are the offline default.
  core.info(`Report written. Introduced: ${total.introduced}; possible: ${total.possible}.`);
  if (failOnIntroduced && total.introduced > 0) core.setFailed(`${total.introduced} introduced attack path(s), including ${total.possible} possible path(s)`);
  if (shouldComment) {
    try { await postComment(artifacts.markdown, core.getInput('github-token')); }
    catch (error) { core.warning(error instanceof Error ? error.message : 'Comment failed'); }
  }
}

void run().catch((error: unknown) => {
  // Validation errors can include private input: do not dump raw reports into CI logs.
  core.setFailed(error instanceof SyntaxError ? 'Invalid report JSON' : error instanceof Error && error.name !== 'ZodError' ? error.message : 'Invalid report schema; see docs/report-contract.md');
});
