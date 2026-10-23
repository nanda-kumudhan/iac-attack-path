import type { Report } from './schema';

export function formatSarif(report: Report) {
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: {
        name: 'iac-attack-path',
        version: '0.1.0',
        rules: [{
          id: 'IAC001',
          name: 'IntroducedInternetToDataPath',
          shortDescription: { text: 'An engine-reported route from the internet to data was introduced' },
          fullDescription: { text: 'Heuristic AWS analysis with limited IAM semantics. Possible paths include plan-time uncertainty.' },
          defaultConfiguration: { level: 'error' },
        }],
      } },
      properties: { analysisStatus: report.analysis.status, warnings: report.analysis.warnings },
      results: report.paths.filter((path) => path.change === 'introduced').map((path) => ({
        ruleId: 'IAC001',
        ruleIndex: 0,
        level: path.certainty === 'possible' ? 'warning' : 'error',
        message: { text: `${report.analysis.status === 'demo' ? '[SYNTHETIC DEMO] ' : ''}${path.certainty}: ${path.explanation}\n${path.steps.map((step) => step.resource).join(' → ')}${path.remediation ? `\nEngine-supplied suggestion: ${path.remediation.description}` : ''}` },
        ...(path.location ? { locations: [{ physicalLocation: {
          artifactLocation: { uri: path.location.file.split('/').map(encodeURIComponent).join('/'), uriBaseId: '%SRCROOT%' },
          region: { startLine: path.location.line },
        } }] } : {}),
        // Canonical identity belongs to the engine; presentation must preserve it.
        fingerprints: { 'enginePathId/v1': path.id },
        properties: { certainty: path.certainty, pathId: path.id },
      })),
    }],
  };
}
