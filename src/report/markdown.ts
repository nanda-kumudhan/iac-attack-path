import { counts, type Report } from './schema';

// Treat infrastructure names and explanations as untrusted Markdown.
export function escapeMarkdown(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/@/g, '&#64;').replace(/[\\`*_{}\[\]()#+.!|~-]/g, '\\$&').replace(/[\r\n]/g, ' ');
}

export function formatMarkdown(report: Report): string {
  const total = counts(report);
  const lines = [
    '<!-- iac-attack-path-report -->',
    '# IaC attack-path report', '',
    ...(report.analysis.status === 'demo' ? ['**SYNTHETIC DEMO — no Terraform analysis was performed.**', ''] : []),
    `${total.introduced} introduced · ${total.removed} removed · ${total.unchanged} unchanged`, '',
    `${total.possible} introduced paths are possible (contain engine-reported uncertainty).`, '',
    'Results use a limited AWS/IAM model. An empty report does not prove that infrastructure is secure.', '',
  ];
  const display = (value: string, max = 1000) => escapeMarkdown(value.length > max ? `${value.slice(0, max)}…` : value);
  if (report.analysis.warnings.length) {
    lines.push('## Analysis warnings', '', ...report.analysis.warnings.slice(0, 10).map((warning) => `- ${display(warning, 800)}`), '');
    if (report.analysis.warnings.length > 10) lines.push('Additional warnings are available in the local viewer.', '');
  }
  // Keep comments bounded even when a large report is accepted by the viewer.
  for (const path of report.paths.slice(0, 20)) {
    const section = [
      `## ${path.change} / ${path.certainty}: ${display(path.id, 200)}`, '',
      display(path.steps.map((step) => step.resource).join(' → '), 2500), '',
      display(path.explanation, 1500), '',
    ];
    if (path.location) section.push(`Source: ${display(path.location.file)}:${path.location.line}`, '');
    if (path.remediation) section.push(`Engine-supplied suggestion: ${display(path.remediation.description, 1500)} (${display(path.remediation.resource, 400)} / ${display(path.remediation.attribute, 400)})`, '');
    if (lines.join('\n').length + section.join('\n').length > 45000) break;
    lines.push(...section);
  }
  const shown = lines.filter((line) => line.startsWith('## ') && !line.startsWith('## Analysis')).length;
  if (shown < report.paths.length) lines.push(`Showing ${shown} of ${report.paths.length} paths. Use the local viewer for the complete report.`, '');
  lines.push('Long fields may be shortened here. The local viewer retains the complete supplied report.', '');
  return lines.join('\n');
}
