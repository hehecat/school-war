import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, type MapId } from './core.ts';
import { neighbors, shortestPath, poisonStep, visible, isHidden, extendIcePath, tarjan, isStronglyConnected, DORM_WALL_EDGES, choosePersonality, aiDelayMs, leaderWeight } from './map-rules.ts';

const game = (map: MapId) => new Game({ map, ai: [false, false, false, false] });

test('wrap adjacency and BFS shortest path', () => {
  const g = game('sports');
  assert.ok(neighbors(g, 0).includes(15));
  assert.deepEqual(shortestPath(g, 0, 15), [0, 15]);
  assert.equal(shortestPath(g, 0, 119).length, 15);
});

test('poison appears at 30 seconds and spreads at 40 seconds only', () => {
  const g = game('lab');
  g.tick = 599; g.time = 29.95; poisonStep(g); assert.equal(g.poison.size, 0);
  g.tick = 600; g.time = 30; poisonStep(g); assert.deepEqual([...g.poison], [119]);
  g.tick = 800; g.time = 40; poisonStep(g); assert.equal(g.poison.size, 5);
});

test('blackout vision includes only own territory and scouting', () => {
  const g = game('blackout');
  assert.equal(visible(g, 0, 0), true);
  assert.equal(visible(g, 0, 240), false);
  g.cells[240].owner = 1; assert.equal(visible(g, 0, 240), false);
  const scouting = game('blackout'); scouting.players[3].skillReady = 0; scouting.skill(3);
  assert.equal(visible(scouting, 3, 240), true);
});

test('forest ambush and ice overshoot', () => {
  const g = game('hill');
  const forest = g.cells.find(c => c.type === 'forest')!;
  forest.owner = 1; assert.equal(isHidden(g, 0, forest.id), true);
  forest.owner = 0; assert.equal(isHidden(g, 0, forest.id), false);
  const snow = game('snow');
  assert.deepEqual(extendIcePath(snow, [0, 3]), [0, 3, 4]);
  assert.deepEqual(extendIcePath(snow, [0, 16]), [0, 16]);
  assert.deepEqual(extendIcePath(snow, [0, 12]), [0, 12, 13]);
});

test('Tarjan rejects dead ends and dorm floors pass independently', () => {
  assert.equal(tarjan(new Map([[0, [1]], [1, []]])).length, 2);
  assert.equal(tarjan(new Map([[0, [1]], [1, [0]]])).length, 1);
  const g = game('dorm');
  assert.equal(isStronglyConnected(g.cells, DORM_WALL_EDGES), true);
  const broken = g.cells.map(c => ({ ...c }));
  for (let x = 0; x < 8; x++) broken[x + 8] = { ...broken[x + 8], type: 'obstacle' as const };
  assert.equal(isStronglyConnected(broken, DORM_WALL_EDGES), false);
});

test('AI delay bounds, personalities, and leader weights', () => {
  assert.equal(aiDelayMs(() => 0), 2500);
  assert.equal(aiDelayMs(() => .999999), 5000);
  assert.equal(choosePersonality(() => 0), 'cautious');
  assert.equal(choosePersonality(() => .999999), 'opportunist');
  const g = game('main');
  g.players[2].tiles = 20;
  assert.equal(leaderWeight(g, 2, 'aggressive'), 1.5);
  assert.equal(leaderWeight(g, 2, 'cautious'), .8);
  assert.equal(leaderWeight(g, 0, 'opportunist'), 1);
});
