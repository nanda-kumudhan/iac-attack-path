import { readdir, readFile, writeFile } from "node:fs/promises";
import { comparePlans } from "../../src/engine";
import { resolve } from "node:path";
export async function evaluate() {
  const root = resolve("fixtures/scenarios");
  const results = [];
  for (const name of (await readdir(root)).sort()) {
    const read = async (file: string) =>
      JSON.parse(await readFile(resolve(root, name, file), "utf8"));
    const [base, head, labels, provenance] = await Promise.all(
      ["base.json", "head.json", "labels.json", "provenance.json"].map(read),
    );
    const result = comparePlans(base, head);
    const key = (chain: string[]) => JSON.stringify(chain);
    const expected = new Set<string>(labels.expectedChains.map(key));
    const actual = new Set(
      result.report.paths
        .filter((p) => p.change === "introduced")
        .map((p) => key(p.steps.map((s) => s.resource))),
    );
    const found = [...expected].filter((x) => actual.has(x));
    const missed = [...expected].filter((x) => !actual.has(x));
    const falsePaths = [...actual].filter((x) => !expected.has(x));
    results.push({
      scenario: name,
      found: found.length,
      missed: missed.length,
      falsePaths: falsePaths.length,
      missedChains: missed.map((x) => JSON.parse(x)),
      falseChains: falsePaths.map((x) => JSON.parse(x)),
      minimumEdits: result.cut.cost,
      upstreamCommit: provenance.commit,
      fixtureKind: provenance.kind,
      independentReview: labels.independentReview,
    });
  }
  return {
    method:
      "Unique ordered resource-chain match on manually normalized static slices. Labels prepared from upstream source; not independently human-reviewed. Not a full-lab or unbiased accuracy estimate.",
    results,
    totals: results.reduce(
      (a, r) => ({
        found: a.found + r.found,
        missed: a.missed + r.missed,
        falsePaths: a.falsePaths + r.falsePaths,
      }),
      { found: 0, missed: 0, falsePaths: 0 },
    ),
  };
}
if (process.argv[1]?.endsWith("run.ts")) {
  const report = await evaluate();
  await writeFile(
    "docs/evaluation-results.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
}
