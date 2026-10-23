import { AnalysisError, type AttackPath, type Edit } from "./model";
export interface Cut {
  cost: number;
  model: string;
  edits: Edit[];
}
interface Arc {
  to: number;
  reverse: number;
  capacity: number;
}
// Edmonds–Karp: integral capacities, residual reverse arcs and BFS augmentations.
export function minCut(
  vertexCount: number,
  edges: { from: number; to: number; capacity: number }[],
  source: number,
  sink: number,
) {
  if (
    source === sink ||
    vertexCount < 2 ||
    [source, sink].some((n) => n < 0 || n >= vertexCount)
  )
    throw new AnalysisError("Invalid flow terminals");
  const residual: Arc[][] = Array.from({ length: vertexCount }, () => []);
  for (const e of edges) {
    if (
      !Number.isFinite(e.capacity) ||
      e.capacity < 0 ||
      e.from < 0 ||
      e.to < 0 ||
      e.from >= vertexCount ||
      e.to >= vertexCount ||
      e.from === e.to
    )
      throw new AnalysisError("Invalid flow edge");
    const a: Arc = {
      to: e.to,
      reverse: residual[e.to]!.length,
      capacity: e.capacity,
    };
    const b: Arc = {
      to: e.from,
      reverse: residual[e.from]!.length,
      capacity: 0,
    };
    residual[e.from]!.push(a);
    residual[e.to]!.push(b);
  }
  let flow = 0;
  let reached = new Set<number>();
  while (true) {
    const parent = new Map<number, [number, number]>();
    const queue = [source];
    reached = new Set([source]);
    for (let cursor = 0; cursor < queue.length; cursor++)
      for (const [index, e] of residual[queue[cursor]!]!.entries())
        if (e.capacity > 0 && !reached.has(e.to)) {
          reached.add(e.to);
          parent.set(e.to, [queue[cursor]!, index]);
          queue.push(e.to);
        }
    if (!reached.has(sink)) break;
    let amount = Infinity;
    for (let at = sink; at !== source;) {
      const [prev, index] = parent.get(at)!;
      amount = Math.min(amount, residual[prev]![index]!.capacity);
      at = prev;
    }
    for (let at = sink; at !== source;) {
      const [prev, index] = parent.get(at)!;
      const e = residual[prev]![index]!;
      e.capacity -= amount;
      residual[at]![e.reverse]!.capacity += amount;
      at = prev;
    }
    flow += amount;
  }
  return { flow, reached };
}
export function chokePoints(paths: AttackPath[], maxStates = 200000): Cut {
  const model =
    "Unit cost per distinct rule/statement/profile edit; exact minimum over all enumerated introduced paths. Max-flow seed with shared-edit refinement.";
  if (!paths.length) return { cost: 0, model, edits: [] };
  const edits = new Map<string, Edit>();
  const sets = paths.map(
    (p) =>
      new Set(
        p.edges.flatMap((e) =>
          e.edit ? (edits.set(e.edit.id, e.edit), [e.edit.id]) : [],
        ),
      ),
  );
  if (sets.some((s) => !s.size))
    throw new AnalysisError("An introduced path has no actionable cut");
  // Shared edit gates give a valid upper bound, including any recombined routes.
  const labels = new Map<string, number>();
  const vertex = (key: string) => {
    if (!labels.has(key)) labels.set(key, labels.size);
    return labels.get(key)!;
  };
  const source = vertex("source"),
    sink = vertex("sink");
  const arcs: { from: number; to: number; capacity: number }[] = [];
  const infinity = edits.size + 1;
  for (const e of edits.values())
    arcs.push({
      from: vertex(`in:${e.id}`),
      to: vertex(`out:${e.id}`),
      capacity: 1,
    });
  for (const [i, p] of paths.entries()) {
    let previous = source;
    for (const [j, e] of p.edges.entries()) {
      const next = vertex(`path:${i}:${j}`);
      if (e.edit) {
        arcs.push(
          { from: previous, to: vertex(`in:${e.edit.id}`), capacity: infinity },
          { from: vertex(`out:${e.edit.id}`), to: next, capacity: infinity },
        );
      } else arcs.push({ from: previous, to: next, capacity: infinity });
      previous = next;
    }
    arcs.push({ from: previous, to: sink, capacity: infinity });
  }
  const cut = minCut(labels.size, arcs, source, sink);
  let best = [...edits.keys()].filter(
    (id) =>
      cut.reached.has(vertex(`in:${id}`)) &&
      !cut.reached.has(vertex(`out:${id}`)),
  );
  if (!sets.every((s) => best.some((id) => s.has(id))))
    throw new AnalysisError("Internal min-cut verification failed");
  // Attribute labels can share graph edges. Exact hitting-set refinement avoids
  // claiming the transformed graph's overapproximation is a minimal edit set.
  let visited = 0;
  const memo = new Map<string, number>();
  function search(remaining: Set<string>[], chosen: string[]) {
    if (++visited > maxStates)
      throw new AnalysisError(
        "Minimum-edit search exceeded limit; minimality is unverified",
      );
    if (!remaining.length) {
      if (chosen.length < best.length) best = [...chosen];
      return;
    }
    if (chosen.length >= best.length) return;
    const key = remaining
      .map((s) => [...s].sort().join(","))
      .sort()
      .join(";");
    if ((memo.get(key) ?? Infinity) <= chosen.length) return;
    memo.set(key, chosen.length);
    // Disjoint constraints supply a safe lower bound on additional edits.
    const used = new Set<string>();
    let lower = 0;
    for (const s of [...remaining].sort((a, b) => a.size - b.size))
      if (![...s].some((id) => used.has(id))) {
        lower++;
        for (const id of s) used.add(id);
      }
    if (chosen.length + lower >= best.length) return;
    const target = [...remaining].sort((a, b) => a.size - b.size)[0]!;
    const coverage = (id: string) => remaining.filter((s) => s.has(id)).length;
    for (const id of [...target].sort(
      (a, b) => coverage(b) - coverage(a) || a.localeCompare(b),
    ))
      search(
        remaining.filter((s) => !s.has(id)),
        [...chosen, id],
      );
  }
  search(sets, []);
  if (!sets.every((s) => best.some((id) => s.has(id))))
    throw new AnalysisError("Internal edit coverage verification failed");
  return {
    cost: best.length,
    model,
    edits: best.sort().map((id) => edits.get(id)!),
  };
}
