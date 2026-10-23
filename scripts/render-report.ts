import { parseArgs } from 'node:util';
import { readReport, writeArtifacts } from '../src/action/artifacts';

try {
  const { values } = parseArgs({ options: {
    input: { type: 'string' },
    'out-dir': { type: 'string', default: 'iac-report' },
  } });
  if (!values.input) throw new Error('Usage: npm run report -- --input report.json [--out-dir iac-report]');
  const report = await readReport(values.input);
  const artifacts = await writeArtifacts(report, values['out-dir']!);
  console.log(`Wrote ${artifacts.markdownFile} and ${artifacts.sarifFile}. Formatting only; no Terraform analysis performed.`);
} catch (error) {
  console.error(error instanceof Error && error.name !== 'ZodError' ? error.message : 'Invalid report schema; see docs/report-contract.md');
  process.exitCode = 2;
}
