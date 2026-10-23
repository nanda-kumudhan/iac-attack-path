import { describe, expect, it } from 'vitest';
import demo from '../../examples/reports/demo.json';
import { counts, MAX_REPORT_BYTES, parseReport } from '../../src/report/schema';
import { formatMarkdown } from '../../src/report/markdown';
import { formatSarif } from '../../src/report/sarif';

const fresh = () => structuredClone(demo);

describe('presentation boundary', () => {
  it('preserves engine identity, classifications and certainty', () => {
    const report = parseReport(JSON.stringify(fresh()));
    expect(report.paths[0]?.id).toBe(demo.paths[0]?.id);
    expect(counts(report)).toEqual({ introduced: 2, removed: 1, unchanged: 0, possible: 1 });
  });

  it.each([null, {}, { ...fresh(), schemaVersion: 2 }, { ...fresh(), plans: [] }])('rejects malformed or unsupported reports', (value) => {
    expect(() => parseReport(JSON.stringify(value))).toThrow();
  });

  it('rejects duplicate engine path IDs', () => {
    const input = fresh();
    input.paths.push(input.paths[0]!);
    expect(() => parseReport(JSON.stringify(input))).toThrow(/Duplicate path ID/);
  });

  it('does not normalize opaque engine identifiers', () => {
    const input = fresh();
    input.paths[0]!.id = '  opaque engine id  ';
    expect(parseReport(JSON.stringify(input)).paths[0]!.id).toBe('  opaque engine id  ');
  });

  it.each(['../main.tf', '/etc/passwd', 'file:///main.tf', 'infra/../../main.tf', 'infra\\main.tf', 'infra/main.tf#fragment', 'infra/./main.tf', 'infra//main.tf'])('rejects unsafe source location %s', (file) => {
    const input = { ...fresh(), paths: [{ ...fresh().paths[0], location: { file, line: 1 } }] };
    expect(() => parseReport(JSON.stringify(input))).toThrow();
  });

  it('accepts a real repository-relative location', () => {
    const input = { ...fresh(), paths: [{ ...fresh().paths[0], location: { file: 'infra/my folder/main.tf', line: 12 } }] };
    expect(parseReport(JSON.stringify(input)).paths[0]?.location?.line).toBe(12);
  });

  it('rejects oversized reports before parsing', () => {
    expect(() => parseReport(' '.repeat(MAX_REPORT_BYTES + 1))).toThrow(/5 MiB/);
  });
});

describe('review exports', () => {
  it('marks the demo and escapes infrastructure text instead of rendering HTML, links or mentions', () => {
    const report = parseReport(JSON.stringify(fresh()));
    report.paths[0]!.explanation = '<img src=x onerror=alert(1)> [click](https://invalid.example) @everyone';
    const markdown = formatMarkdown(report);
    expect(markdown).toContain('SYNTHETIC DEMO');
    expect(markdown).toContain('&lt;img');
    expect(markdown).toContain('\\[click\\]');
    expect(markdown).not.toContain('<img');
    expect(markdown).not.toContain('@everyone');
  });

  it('bounds even maximally escaped warnings and long path fields below the GitHub comment limit', () => {
    const report = parseReport(JSON.stringify(fresh()));
    report.analysis.warnings = Array.from({ length: 100 }, () => '<'.repeat(4000));
    report.paths = Array.from({ length: 100 }, (_, index) => ({ ...report.paths[0]!, id: `path-${index}`, explanation: '<'.repeat(4000) }));
    const markdown = formatMarkdown(report);
    expect(markdown.length).toBeLessThan(60000);
    expect(markdown).toMatch(/Showing \d+ of 100 paths/);
  });

  it('exports only introduced paths and preserves engine IDs without inventing source locations', () => {
    const report = parseReport(JSON.stringify(fresh()));
    const sarif = formatSarif(report);
    expect(sarif.version).toBe('2.1.0');
    const results = sarif.runs[0]!.results;
    expect(results).toHaveLength(2);
    expect(results.map((result) => result.level)).toEqual(['error', 'warning']);
    expect(results[0]?.fingerprints['enginePathId/v1']).toBe(report.paths[0]?.id);
    expect(results[0]).not.toHaveProperty('locations');
    expect(results[0]?.message.text).toContain('[SYNTHETIC DEMO]');
  });

  it('encodes source paths as SARIF URIs without changing line numbers', () => {
    const report = parseReport(JSON.stringify(fresh()));
    report.paths[0]!.location = { file: 'infra/my folder/main.tf', line: 12 };
    const location = formatSarif(report).runs[0]!.results[0]!.locations?.[0]?.physicalLocation;
    expect(location?.artifactLocation.uri).toBe('infra/my%20folder/main.tf');
    expect(location?.region.startLine).toBe(12);
  });
});
