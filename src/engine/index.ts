import { AnalysisError, canonical } from "./model";
import { buildGraph } from "./graph";
import { findPaths, type SearchOptions } from "./search";
import { chokePoints } from "./cut";
import { reportSchema, type Report, type ReportPath } from "../report/schema";
export * from "./model";
export { parsePlan, MAX_PLAN_BYTES } from "./plan";
export { buildGraph, findPaths, chokePoints };
export function comparePlans(
  base: unknown,
  head: unknown,
  options: SearchOptions = {},
) {
  const baseGraph = buildGraph(base),
    headGraph = buildGraph(head);
  const before = findPaths(baseGraph, options),
    after = findPaths(headGraph, options);
  const oldPaths = new Map(before.map((p) => [p.id, canonical(p.edges)]));
  for (const path of after)
    if (
      oldPaths.has(path.id) &&
      oldPaths.get(path.id) !== canonical(path.edges)
    )
      throw new AnalysisError("Cross-plan path identity collision");
  const oldIds = new Set(before.map((p) => p.id)),
    newIds = new Set(after.map((p) => p.id));
  const introduced = after.filter((p) => !oldIds.has(p.id));
  const cut = chokePoints(introduced);
  const convert = (
    p: (typeof after)[number],
    change: ReportPath["change"],
  ): ReportPath => {
    const edit = cut.edits.find((edit) =>
      p.edges.some((e) => e.edit?.id === edit.id),
    );
    return {
      id: p.id,
      change,
      certainty: p.certainty,
      steps: p.nodes.map((resource) => ({ resource })),
      explanation: p.edges.map((e) => e.evidence).join(" "),
      ...(edit
        ? {
            remediation: {
              resource: edit.resource,
              attribute: edit.attribute,
              description: edit.description,
            },
          }
        : {}),
    };
  };
  const report: Report = reportSchema.parse({
    schemaVersion: 1,
    analysis: {
      status: "complete",
      warnings: [
        ...new Set([...baseGraph.warnings, ...headGraph.warnings]),
      ].slice(0, 100),
    },
    paths: [
      ...after.map((p) =>
        convert(p, oldIds.has(p.id) ? "unchanged" : "introduced"),
      ),
      ...before
        .filter((p) => !newIds.has(p.id))
        .map((p) => convert(p, "removed")),
    ],
    cut,
  });
  return { report, baseGraph, headGraph, cut };
}
export function emptyPlan() {
  return {
    format_version: "1.0",
    planned_values: { root_module: { resources: [] } },
  };
}
