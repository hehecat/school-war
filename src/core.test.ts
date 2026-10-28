import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, BASE_RATE, FACTIONS, combatSurvivors, type Cell, type Unit } from './core.ts';

const quiet = () => { const g = new Game({ seed: 7, ai: [false, false, false, false] }); for (const p of g.players) p.legend = null; return g; };
const advance = (g: Game, seconds: number) => { for (let i = 0; i < seconds * 20; i++) g.update(0.05); };
const cell = (id: number, owner: Cell['owner'], troops: number): Cell => ({ id, x: id % 16, y: Math.floor(id / 16), floor: 0, owner, troops, type: 'plain', base: false, shieldUntil: 0, blockShield: false });
const unit = (from: number, to: number, troops: number, owner = 0): Unit => ({ id: 1, owner, from, to, path: [to], x: from % 16, y: Math.floor(from / 16), troops, ratio: 1, progress: 1.01, boostUntil: 0, slowUntil: 0 });

function melee(a: number, b: number, ticks = 100) {
  const g = quiet();
  g.cells = [cell(0, 1, b), cell(1, -1, 0)];
  // Isolate the symmetric exchange formula from faction stat modifiers.
  (FACTIONS[0] as { atk: number }).atk = 1;
  (FACTIONS[1] as { hp: number }).hp = 1;
  g.units = [unit(1, 0, a)];
  g.update(0.05); // Arrive and lock exchange rates.
  for (let i = 0; i < ticks && (g.cells[0].owner === 1 || (g as any).battles.size); i++) {
    g.update(0.05);
    if (i % 10 === 0 && !(g as any).battles.size) break;
  }
  return g.cells[0];
}

test('locked-exchange combat keeps fixed rates and handles discrete rounding', () => {
  for (const [a, b] of [[20, 15], [20, 10], [20, 18]]) {
    const result = melee(a, b);
    assert.equal(result.owner, 0);
    // Locked rates stay fixed for the whole discrete exchange.
    let defenders = b, attackers = a;
    const ra = b * 0.15, rb = a * 0.15;
    for (let tick = 0; tick < 100; tick++) {
      const nextA = attackers - ra, nextB = defenders - rb;
      attackers = nextA < 0.1 ? 0 : Math.round(nextA * 100) / 100;
      defenders = nextB < 0.1 ? 0 : Math.round(nextB * 100) / 100;
      if (!attackers || !defenders) break;
    }
    assert.ok(Math.abs(result.troops - attackers) < 1, `${a}/${b}: ${result.troops} != ${attackers}`);
  }
  assert.ok(Math.abs(combatSurvivors(20, 15) - 8.75) < 1e-9);
});

test('mutual KO keeps the defender owner and zero troops', () => {
  const g = quiet(); g.cells = [cell(0, 1, 20), cell(1, -1, 0), cell(2, 2, 0), cell(3, 3, 0)];
  (FACTIONS[0] as { atk: number }).atk = 1;
  (FACTIONS[1] as { hp: number }).hp = 1;
  g.units = [unit(1, 0, 20)]; g.update(.05);
  while (g.getBattle(0)) g.update(.05);
  assert.equal(g.cells[0].owner, 1);
  assert.equal(g.cells[0].troops, 0);
});

test('marginal production stays positive and total output grows with territory', () => {
  const totals: number[] = [];
  for (const n of [2, 4, 8, 16]) {
    const g = quiet();
    g.cells = Array.from({ length: 64 }, (_, id) => cell(id, id < n ? 0 : (id % 3) + 1, 0));
    const sum = () => g.cells.filter(c => c.owner === 0).reduce((k, c) => k + c.troops, 0);
    const before = sum(); advance(g, 60); const gained = sum() - before;
    assert.ok(gained > 0, `${n} cells produced nothing`);
    totals.push(gained);
  }
  totals.forEach((n, i) => { if (i) assert.ok(n > totals[i - 1], `${totals} is not increasing`); });
});

test('base production is BASE_RATE per second before modifiers and spawns whole troops', () => {
  const g = quiet();
  g.cells = Array.from({ length: 16 }, (_, id) => cell(id, id < 4 ? id : (id % 3) + 1, 0)); g.cells[0].base = true;
  const troops = () => g.cells[0].troops;
  advance(g, 1); assert.equal(troops(), 0);
  advance(g, 9); assert.equal(troops(), Math.floor(BASE_RATE * 10));
  advance(g, 30); assert.equal(troops(), Math.floor(BASE_RATE * 40));
});

test('enemy units arriving at the same cell automatically fight', () => {
  const g = quiet(); g.cells = [cell(0, 0, 0), cell(1, 1, 10)];
  g.units = [unit(0, 1, 15)]; g.update(.05);
  assert.ok(g.getBattle(0)); const before = g.cells[1].troops;
  advance(g, .5); assert.ok(g.cells[1].troops < before);
});

test('a faction can draw from each suit cell only once', () => {
  const g = quiet();
  const c = g.cells.find(c => c.type === 'heart')!;
  g.cells = Array.from({ length: c.id + 1 }, (_, id) => cell(id, -1, 0));
  g.cells[c.id] = c; c.owner = -1; c.troops = 0;
  g.units = [unit(c.id, c.id, 5)]; g.update(0.05);
  assert.equal(g.players[0].cards.heart, 1);
  c.owner = 1; c.troops = 0;
  g.units = [unit(c.id, c.id, 5)]; g.update(0.05);
  assert.equal(g.players[0].cards.heart, 1);
  assert.equal(g.playCards(0, 'heart'), false);
});

test('dispatch removes troops, moves a group, and captures an empty cell', () => {
  const g = quiet();
  g.cells = [cell(0, 0, 16), cell(1, -1, 0)];
  const u = g.dispatch(0, 1, 0.5)!;
  assert.equal(g.cells[0].troops, 8);
  assert.equal(u.troops, 8);
  advance(g, 1.1);
  assert.equal(g.units.length, 0);
  assert.equal(g.cells[1].owner, 0);
  assert.ok(Math.abs(g.cells[1].troops - 8) < .05);
});

test('in-combat retreat costs 40% and returns survivors to the nearest cell', () => {
  const g = quiet();
  g.cells = [cell(0, 0, 10), cell(1, 1, 15)];
  g.units = [unit(0, 1, 20)];
  advance(g, 0.05);
  assert.ok(g.getBattle(0));
  assert.equal(g.battleRetreat(0), true);
  assert.equal(g.getBattle(0), undefined);
  assert.ok(Math.abs(g.cells[0].troops - 22) < .05);
  assert.equal(g.cells[1].owner, 1);
});

test('black scouting and registration have independent cooldowns', () => {
  const g = quiet();
  g.cells[15].owner = 3; g.cells[14].owner = -1; g.cells[16].owner = -1;
  g.players[3].skillReady = 0; // 开局技能有冷却，测试前先就绪
  assert.equal(g.skill(3), true);
  assert.equal(g.isScouting(3), true);
  assert.equal(g.register(3, 14), true);
  assert.equal(g.cells[14].owner, 3);
  assert.equal(g.register(3, 17), false);
});

test('exile can rebuild on a neutral cell without a waiting period', () => {
  const g = quiet();
  g.cells.forEach(c => { c.owner = -1; c.troops = 0; });
  g.players[0].exiled = true;
  assert.equal(g.rebuild(0, 100), true);
  assert.equal(g.cells[100].owner, 0);
  assert.equal(g.cells[100].troops, 5);
});

test('dorm units path upstairs and capture an upper-floor cell', () => {
  const g = new Game({ map: 'dorm', ai: [false, false, false, false] });
  for (const c of g.cells) { c.owner = -1; c.troops = 0; }
  g.cells[0].owner = 0; g.cells[0].troops = 20;
  assert.equal(g.cells[17].floor, 0); assert.equal(g.cells[81].floor, 1);
  assert.ok(g.dispatch(0, 81, 1));
  advance(g, 9);
  assert.equal(g.cells[81].owner, 0);
  assert.ok(g.cells[81].troops > 0);
});

test('special maps initialize and radio requires a six second capture', () => {
  for (const map of ['main', 'dorm', 'canteen', 'blackout', 'sports', 'lab', 'hill', 'exam', 'snow'] as const) {
    const g = new Game({ map, ai: [false, false, false, false] });
    advance(g, 30); assert.ok(g.time >= 30);
    if (map === 'dorm') assert.equal(g.cells.length, 192);
    if (map === 'lab') assert.ok(g.poison.size > 0);
  }
  const g = quiet(); (g as any).accumulator = 0; g.time = 239.95; g.tick = 4799; g.update(.05); const radio = g.cells.find(c => c.type === 'radio')!; radio.owner = 0; g.radioCapture = { owner: 0, since: 240 };
  assert.equal(g.chooseRadio(0, true), false); g.time = 246; assert.equal(g.chooseRadio(0, true), true);
});

test('60% occupation held for 20 seconds wins', () => {
  const g = quiet();
  const occupiable = g.cells.filter(c => c.type !== 'obstacle');
  for (const c of g.cells) { c.owner = -1; c.troops = 0; }
  for (const c of occupiable.slice(0, Math.ceil(occupiable.length * 0.6))) c.owner = 0;
  g.players[0].tiles = Math.ceil(occupiable.length * 0.6);
  advance(g, 20.1);
  assert.equal(g.over, true);
  assert.equal(g.winner, 0);
});
