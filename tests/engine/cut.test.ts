import { it, expect } from "vitest";
import { chokePoints, minCut } from "../../src/engine/cut";
import type { AttackPath } from "../../src/engine";
function path(labels: string[], index = 0): AttackPath {
  return {
    id: `p${index}`,
    nodes: ["internet", "data"],
    certainty: "possible",
    edges: labels.map((id, i) => ({
      id: `${index}-${i}`,
      from: `n${i}`,
      to: `n${i + 1}`,
      kind: "network",
      certainty: "possible",
      evidence: id,
      edit: { id, resource: id, attribute: "ingress", description: id },
    })),
  };
}
it("computes max-flow/min-cut including reverse residual arcs", () => {
  expect(
    minCut(
      4,
      [
        { from: 0, to: 1, capacity: 3 },
        { from: 0, to: 2, capacity: 2 },
        { from: 1, to: 2, capacity: 1 },
        { from: 1, to: 3, capacity: 2 },
        { from: 2, to: 3, capacity: 3 },
      ],
      0,
      3,
    ).flow,
  ).toBe(5);
});
it("groups a shared edit and cuts every introduced path", () => {
  const cut = chokePoints([path(["a", "shared"]), path(["b", "shared"], 1)]);
  expect(cut.cost).toBe(1);
  expect(cut.edits[0]?.id).toBe("shared");
});
it("returns multiple edits for independent paths", () =>
  expect(chokePoints([path(["a"]), path(["b"], 1)]).cost).toBe(2));
it("handles no introduced paths and rejects uncuttable paths", () => {
  expect(chokePoints([]).cost).toBe(0);
  expect(() => chokePoints([path([])])).toThrow(/actionable/);
});
it("matches exhaustive optimal edit sets across 80 deterministic small cases", () => {
  let seed = 23;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let trial = 0; trial < 80; trial++) {
    const sets = Array.from({ length: 2 + (rand() % 6) }, () => {
      const selected = ["a", "b", "c", "d", "e"].filter(() => rand() % 3 === 0);
      return selected.length ? selected : ["a"];
    });
    let optimal = 5;
    for (let mask = 0; mask < 32; mask++) {
      const selected = ["a", "b", "c", "d", "e"].filter(
        (_, i) => mask & (1 << i),
      );
      if (sets.every((s) => s.some((id) => selected.includes(id))))
        optimal = Math.min(optimal, selected.length);
    }
    const cut = chokePoints(sets.map((s, i) => path(s, i)));
    expect(cut.cost).toBe(optimal);
    expect(sets.every((s) => cut.edits.some((e) => s.includes(e.id)))).toBe(
      true,
    );
  }
});
