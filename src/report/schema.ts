import { z } from 'zod';

// Zod's optional JIT probe uses new Function. Disable it for the strict browser
// CSP rather than requiring unsafe-eval just to validate presentation JSON.
z.config({ jitless: true });

// Presentation boundary only. Path IDs, order, certainty and changes come from
// the hand-written engine. No Terraform types or analysis graph live here.
export const MAX_REPORT_BYTES = 5 * 1024 * 1024;

// Validate without normalizing: even opaque IDs must be preserved byte-for-byte.
const text = z.string().min(1).max(4000).refine((value) => value.trim().length > 0, 'Expected non-blank text');
const repositoryFile = z.string().min(1).max(1000).refine((file) =>
  !file.startsWith('/') && !file.includes('\\') &&
  !file.split('/').some((segment) => segment === '..' || segment === '.' || segment === '') &&
  !/[\u0000-\u001f\u007f:#?]/u.test(file),
  'Expected a repository-relative file path without traversal or URI syntax',
);

export const reportSchema = z.object({
  schemaVersion: z.literal(1),
  analysis: z.object({
    status: z.enum(['complete', 'demo']),
    warnings: z.array(text).max(100),
  }).strict(),
  paths: z.array(z.object({
    id: text,
    change: z.enum(['introduced', 'removed', 'unchanged']),
    certainty: z.enum(['definite', 'possible']),
    explanation: text,
    steps: z.array(z.object({ resource: text }).strict()).min(2).max(100),
    location: z.object({ file: repositoryFile, line: z.number().int().positive().max(2147483647) }).strict().optional(),
    remediation: z.object({
      description: text,
      resource: text,
      attribute: text,
    }).strict().optional(),
  }).strict()).max(10000),
}).strict().superRefine((report, context) => {
  const seen = new Set<string>();
  report.paths.forEach((path, index) => {
    if (seen.has(path.id)) context.addIssue({ code: 'custom', path: ['paths', index, 'id'], message: 'Duplicate path ID' });
    seen.add(path.id);
  });
});

export type Report = z.infer<typeof reportSchema>;
export type ReportPath = Report['paths'][number];

export function parseReport(raw: string): Report {
  if (new TextEncoder().encode(raw).length > MAX_REPORT_BYTES) throw new Error('Report exceeds the 5 MiB limit');
  return reportSchema.parse(JSON.parse(raw));
}

export function counts(report: Report) {
  return {
    introduced: report.paths.filter((path) => path.change === 'introduced').length,
    removed: report.paths.filter((path) => path.change === 'removed').length,
    unchanged: report.paths.filter((path) => path.change === 'unchanged').length,
    possible: report.paths.filter((path) => path.change === 'introduced' && path.certainty === 'possible').length,
  };
}
