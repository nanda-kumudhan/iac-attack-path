export type Certainty = "definite" | "possible";
export type NodeKind =
  "Internet" | "SecurityGroup" | "Instance" | "Role" | "Bucket" | "Database";
export interface GraphNode {
  id: string;
  kind: NodeKind;
}
export interface Edit {
  id: string;
  resource: string;
  attribute: string;
  description: string;
}
export interface Edge {
  id: string;
  from: string;
  to: string;
  kind:
    | "ingress"
    | "network"
    | "credentials"
    | "grant"
    | "assume-role"
    | "escalation";
  certainty: Certainty;
  evidence: string;
  edit?: Edit;
  family?: "ipv4" | "ipv6";
  families?: ("ipv4" | "ipv6")[];
  ports?: [number, number];
  protocol?: string;
  requiresPort?: number;
}
export interface Graph {
  nodes: GraphNode[];
  edges: Edge[];
  warnings: string[];
}
export interface AttackPath {
  id: string;
  nodes: string[];
  edges: Edge[];
  certainty: Certainty;
}
export class AnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisError";
  }
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
// Two independently seeded 32-bit hashes; collisions are checked during search.
export function identity(prefix: string, value: unknown): string {
  const input = canonical(value);
  let a = 2166136261;
  let b = 3339675911;
  for (let i = 0; i < input.length; i++) {
    a = Math.imul(a ^ input.charCodeAt(i), 16777619);
    b = Math.imul(b ^ input.charCodeAt(i), 2246822519);
  }
  return `${prefix}-${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}
export const possible = (...values: Certainty[]): Certainty =>
  values.includes("possible") ? "possible" : "definite";
export const object = (v: unknown): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, any>)
    : {};
export const list = <T = any>(v: unknown): T[] => (Array.isArray(v) ? v : []);
export const strings = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [v]).filter(
    (x): x is string => typeof x === "string",
  );
export function wildcard(
  pattern: string,
  value: string,
  insensitive = false,
): boolean {
  if (insensitive) {
    pattern = pattern.toLowerCase();
    value = value.toLowerCase();
  }
  let p = 0,
    v = 0,
    star = -1,
    restart = 0;
  while (v < value.length) {
    if (p < pattern.length && (pattern[p] === "?" || pattern[p] === value[v])) {
      p++;
      v++;
    } else if (pattern[p] === "*") {
      star = p++;
      restart = v;
    } else if (star >= 0) {
      p = star + 1;
      v = ++restart;
    } else return false;
  }
  while (pattern[p] === "*") p++;
  return p === pattern.length;
}

export function hasUnknown(value: unknown): boolean {
  if (value === true) return true;
  if (Array.isArray(value)) return value.some(hasUnknown);
  if (value && typeof value === "object")
    return Object.values(value).some(hasUnknown);
  return false;
}
