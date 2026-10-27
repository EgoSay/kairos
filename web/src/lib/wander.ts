import type { WanderDirection, WanderNeighborhood, WanderOriginal } from "@/hooks/useWanderQueries";

export interface WanderPosition {
  name: string;
  offset: number;
  scrollY: number;
}
export interface WanderRoute {
  history: string[];
  sources: Record<string, string>;
  index: number;
}
/** Session state contains identifiers and reading positions, never private bodies or generated evidence. */
export interface WanderSession extends WanderRoute {
  returns: { route: WanderRoute; position: WanderPosition }[];
  hints: string[];
  position?: WanderPosition;
}
export interface WanderEntry {
  original: WanderOriginal;
  neighborhood?: WanderNeighborhood;
  source?: string;
  direction?: WanderDirection;
}

export const WANDER_AUTOMATIC_LENGTH = 3;
export const WANDER_ROUTE_LIMIT = 12;

/** Only connected originals from one eligibility epoch may form the visible reading trail. */
export function readableWanderTrail(
  route: WanderRoute | undefined,
  nodes: ReadonlyMap<string, WanderNeighborhood | undefined>,
  hidden: (original: WanderOriginal) => boolean,
  unavailable: ReadonlySet<string>,
): WanderEntry[] {
  if (!route) return [];
  const first = nodes.get(route.history[0]);
  if (!first?.root || unavailable.has(first.root.name)) return [];
  const entries: WanderEntry[] = [{ original: first.root, neighborhood: first }];
  for (const name of route.history.slice(1)) {
    const source = route.sources[name];
    const parent = entries.find((entry) => entry.original.name === source);
    const node = nodes.get(name);
    const edge = parent?.neighborhood?.directions.find((direction) => direction.original.name === name);
    if (!parent?.neighborhood || hidden(parent.original) || unavailable.has(name)) break;
    if (node && (!node.root || node.epoch !== first.epoch || node.profile !== first.profile)) break;
    if (node?.root && node.root.name !== name) break;
    if (!edge) {
      // A dismissed/replaced edge must not keep its explanation alive. An
      // independently revalidated, previously visited original may still be read.
      if (!node?.root || hidden(node.root)) break;
      entries.push({ original: node.root, neighborhood: node });
      continue;
    }
    if (hidden(edge.original)) break;
    const original = node?.root ?? edge.original;
    if (hidden(original)) break;
    // A newer target cannot be explained using the old source's quote or relation.
    if (node?.root && original.revision !== edge.original.revision && edge.original.revision !== 0) break;
    entries.push({ original, neighborhood: node, source, direction: edge });
  }
  return entries;
}

/** Insert an explicitly chosen branch while keeping the previous path available for return. */
export function insertWanderBranch(route: WanderRoute, source: string, target: string, targetNode?: WanderNeighborhood): WanderRoute {
  if (route.history.includes(target) || route.history.length >= WANDER_ROUTE_LIMIT) return route;
  const at = route.history.indexOf(source);
  if (at < 0) return route;
  const history = [...route.history];
  history.splice(at + 1, 0, target);
  const sources = { ...route.sources, [target]: source };
  const next = history[at + 2];
  // Connect the next text through the new branch only when that actual edge exists.
  if (next && targetNode?.directions.some((direction) => direction.original.name === next)) sources[next] = target;
  return { history, sources, index: at + 1 };
}
