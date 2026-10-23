import {
  AnalysisError,
  canonical,
  identity,
  possible,
  type AttackPath,
  type Edge,
  type Graph,
} from "./model";
export interface SearchOptions {
  maxPaths?: number;
  maxDepth?: number;
  maxStates?: number;
}
export function findPaths(
  graph: Graph,
  options: SearchOptions = {},
): AttackPath[] {
  const { maxPaths = 4000, maxDepth = 24, maxStates = 100000 } = options;
  if (
    ![maxPaths, maxDepth, maxStates].every((n) => Number.isInteger(n) && n > 0)
  )
    throw new AnalysisError("Search limits must be positive integers");
  const targets = new Set(
    graph.nodes
      .filter((n) => n.kind === "Bucket" || n.kind === "Database")
      .map((n) => n.id),
  );
  const outgoing = new Map<string, Edge[]>();
  const incoming = new Map<string, string[]>();
  for (const e of graph.edges) {
    const edges = outgoing.get(e.from) ?? [];
    edges.push(e);
    outgoing.set(e.from, edges);
    const parents = incoming.get(e.to) ?? [];
    parents.push(e.from);
    incoming.set(e.to, parents);
  }
  // Reverse reachability prevents irrelevant resource fan-out consuming the path budget.
  const relevant = new Set(targets);
  const reverse = [...targets];
  for (let i = 0; i < reverse.length; i++)
    for (const parent of incoming.get(reverse[i]!) ?? [])
      if (!relevant.has(parent)) {
        relevant.add(parent);
        reverse.push(parent);
      }
  for (const edges of outgoing.values())
    edges.sort((a, b) => a.id.localeCompare(b.id));
  const queue: {
    nodes: string[];
    edges: Edge[];
    family?: "ipv4" | "ipv6";
    ingress?: Edge;
  }[] = [{ nodes: ["internet"], edges: [] }];
  const paths: AttackPath[] = [];
  const identities = new Map<string, string>();
  for (let cursor = 0; cursor < queue.length; cursor++) {
    if (queue.length > maxStates)
      throw new AnalysisError(
        "Path search exceeded state limit; analysis is incomplete",
      );
    const state = queue[cursor]!;
    const at = state.nodes.at(-1)!;
    if (targets.has(at)) {
      const certainty = possible(...state.edges.map((e) => e.certainty));
      const key = canonical([state.edges.map((e) => e.id), certainty]);
      const id = identity("path", key);
      if (identities.has(id)) {
        if (identities.get(id) !== key)
          throw new AnalysisError("Path identity collision");
        continue;
      }
      identities.set(id, key);
      paths.push({ id, nodes: state.nodes, edges: state.edges, certainty });
      if (paths.length > maxPaths)
        throw new AnalysisError(
          "Path search exceeded path limit; analysis is incomplete",
        );
      continue;
    }
    const candidates = (outgoing.get(at) ?? []).filter(
      (e) =>
        relevant.has(e.to) &&
        !state.nodes.includes(e.to) &&
        (!e.families || !state.family || e.families.includes(state.family)) &&
        (e.requiresPort === undefined ||
          !state.ingress?.ports ||
          ((!state.ingress.protocol ||
            ["-1", "tcp", "6"].includes(state.ingress.protocol)) &&
            (state.ingress.protocol === "-1" ||
              (state.ingress.ports[0] <= e.requiresPort &&
                state.ingress.ports[1] >= e.requiresPort)))),
    );
    if (state.edges.length >= maxDepth && candidates.length)
      throw new AnalysisError(
        "Path search exceeded depth limit; analysis is incomplete",
      );
    for (const e of candidates)
      queue.push({
        nodes: [...state.nodes, e.to],
        edges: [...state.edges, e],
        family: e.family ?? state.family,
        ingress: e.kind === "ingress" ? e : state.ingress,
      });
  }
  return paths.sort((a, b) => a.id.localeCompare(b.id));
}
