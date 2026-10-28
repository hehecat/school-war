import type { Cell, Game } from './core.ts';

export type Edge = readonly [from: number, to: number];
export type MapState = Pick<Game, 'cells' | 'size' | 'floors' | 'map'>;

/** Four fixed, one-way shortcuts on dorm 1F; ordinary grid routes provide the return path. */
export const DORM_WALL_EDGES = [[6, 48], [48, 57], [57, 15], [15, 6]] as const satisfies readonly Edge[];

/** Four-neighbour adjacency, with sports-map wrapping, stairs and directed wall edges. */
export function neighbors(game: MapState, id: number, edges: readonly Edge[] = game.map === 'dorm' ? DORM_WALL_EDGES : [], allowWalls = false): number[] {
  const c = game.cells[id];
  if (!c) return [];
  const out: number[] = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const x = c.x + dx, y = c.y + dy;
    if (game.map === 'sports') {
      const next = game.cells.find(v => v.floor === c.floor && v.x === (x + game.size) % game.size && v.y === (y + game.size) % game.size);
      if (next) out.push(next.id);
    } else {
      const next = game.cells.find(v => v.floor === c.floor && v.x === x && v.y === y);
      if (next) out.push(next.id);
    }
  }
  if (c.type === 'stairs') {
    if (c.floor < game.floors - 1 && game.cells[id + game.size * game.size]) out.push(id + game.size * game.size);
    if (c.floor > 0 && game.cells[id - game.size * game.size]) out.push(id - game.size * game.size);
  }
  for (const [from, to] of edges) if (from === id && game.cells[to] && game.cells[to].type !== 'wall') out.push(to);
  return [...new Set(out)];
}

/** BFS shortest path including both endpoints; [] means unreachable. */
export function shortestPath(game: MapState, from: number, to: number, edges?: readonly Edge[], allowWalls = false): number[] {
  if (!game.cells[from] || !game.cells[to] || ['obstacle', 'wall'].includes(game.cells[to].type)) return [];
  if (from === to) return [from];
  const queue = [from], previous = new Map<number, number>([[from, -1]]);
  for (let i = 0; i < queue.length; i++) {
    for (const next of neighbors(game, queue[i], edges, allowWalls)) {
      if (previous.has(next) || ['obstacle', 'wall'].includes(game.cells[next].type)) continue;
      previous.set(next, queue[i]);
      if (next === to) {
        const path = [to];
        for (let at = queue[i]; at >= 0; at = previous.get(at)!) { path.unshift(at); if (at === from) break; }
        return path;
      }
      queue.push(next);
    }
  }
  return [];
}

/** Call from the 20 Hz map-rule step: creates poison at 30 s, then spreads every 10 s. */
export function poisonStep(game: Game, origin = 119): Set<number> {
  if (game.map !== 'lab' || game.tick < 600 || game.tick % 200 !== 0) return game.poison;
  if (!game.poison.size) {
    if (game.cells[origin] && !['obstacle', 'wall'].includes(game.cells[origin].type)) game.poison.add(origin);
  } else {
    for (const id of [...game.poison]) for (const next of neighbors(game, id)) {
      if (!['obstacle', 'wall'].includes(game.cells[next].type)) game.poison.add(next);
    }
  }
  return game.poison;
}

/** Blackout fog: radius 3 from owned cells/units; scouting reveals the map. */
export function visible(game: Game, owner: number, id: number): boolean {
  const target = game.cells[id];
  if (!target) return false;
  if (game.map !== 'blackout') return true;
  const viewers = [owner];
  if (viewers.some(viewer => game.isScouting(viewer))) return true;
  const near = (x: number, y: number, floor: number) => floor === target.floor && Math.abs(x - target.x) + Math.abs(y - target.y) <= 3;
  return game.cells.some(c => viewers.includes(c.owner) && near(c.x, c.y, c.floor)) ||
    game.units.some(u => viewers.includes(u.owner) && near(u.x, u.y, game.cells[u.from]?.floor ?? -1));
}

/** Enemy troops stationed in hill forests are hidden from opponents. */
export function isHidden(game: Game, viewer: number, id: number): boolean {
  const c = game.cells[id];
  return !!c && game.map === 'hill' && c.type === 'forest' && c.owner >= 0 && c.owner !== viewer;
}

/** Append one cell after an icy destination, preserving the incoming direction. */
export function extendIcePath(game: MapState, path: readonly number[]): number[] {
  const out = [...path];
  if (path.length < 2) return out;
  const from = game.cells[path[path.length - 2]], to = game.cells[path[path.length - 1]];
  const ice = to && game.map === 'snow' && ((to.type as string) === 'ice' || to.type === 'plain');
  if (!from || !ice) return out;
  const dx = Math.sign(to.x - from.x), dy = Math.sign(to.y - from.y);
  if (Math.abs(dx) + Math.abs(dy) !== 1) return out;
  const next = game.cells.find(c => c.floor === to.floor && c.x === to.x + dx && c.y === to.y + dy);
  if (next && !['obstacle', 'wall'].includes(next.type)) out.push(next.id);
  return out;
}

/** Tarjan strongly connected components. */
export function tarjan(adjacency: ReadonlyMap<number, readonly number[]>): number[][] {
  let index = 0;
  const indices = new Map<number, number>(), low = new Map<number, number>(), stack: number[] = [], onStack = new Set<number>(), components: number[][] = [];
  function visit(v: number) {
    indices.set(v, index); low.set(v, index++); stack.push(v); onStack.add(v);
    for (const w of adjacency.get(v) ?? []) {
      if (!indices.has(w)) { visit(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, indices.get(w)!));
    }
    if (low.get(v) !== indices.get(v)) return;
    const component: number[] = [];
    for (let w = -1; w !== v;) { w = stack.pop()!; onStack.delete(w); component.push(w); }
    components.push(component);
  }
  for (const v of adjacency.keys()) if (!indices.has(v)) visit(v);
  return components;
}

/** Publishing check: every floor must independently be one SCC (GDD 8.2). */
export function isStronglyConnected(cells: readonly Cell[], edges: readonly Edge[] = []): boolean {
  const open = cells.filter(c => c.type !== 'obstacle');
  return [...new Set(open.map(c => c.floor))].every(floor => {
    const floorCells = open.filter(c => c.floor === floor), ids = new Set(floorCells.map(c => c.id));
    const at = new Map(floorCells.map(c => [`${c.x},${c.y}`, c.id]));
    const adjacency = new Map(floorCells.map(c => [c.id, [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dy]) => at.get(`${c.x + dx},${c.y + dy}`)).filter((id): id is number => id !== undefined)]));
    for (const [from, to] of edges) if (ids.has(from) && ids.has(to)) adjacency.get(from)!.push(to);
    for (const [from, to] of edges) if (ids.has(from) && ids.has(to)) adjacency.get(from)!.push(to);
    return tarjan(adjacency).length === 1;
  });
}

export const AI_PERSONALITIES = ['cautious', 'aggressive', 'opportunist'] as const;
export type Personality = typeof AI_PERSONALITIES[number];

export function choosePersonality(random: () => number = Math.random): Personality {
  return AI_PERSONALITIES[Math.min(2, Math.floor(random() * 3))];
}

/** Milliseconds; convert to game seconds at the scheduler boundary. */
export function aiDelayMs(random: () => number = Math.random): number {
  return 2500 + Math.floor(random() * 2501);
}

/** Target-score multiplier for the current tile leader(s), placeholder balance values. */
export function leaderWeight(game: Pick<Game, 'players'>, targetOwner: number, personality: Personality): number {
  const target = game.players[targetOwner];
  if (!target || target.tiles < Math.max(...game.players.map(p => p.tiles))) return 1;
  return { cautious: 0.8, aggressive: 1.5, opportunist: 1.2 }[personality];
}
