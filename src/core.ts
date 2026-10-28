import { neighbors as mapNeighbors, DORM_WALL_EDGES, visible, isHidden, extendIcePath, isStronglyConnected, choosePersonality, aiDelayMs, leaderWeight, type Personality } from './map-rules.ts';

export type CellType = 'plain' | 'heart' | 'spade' | 'diamond' | 'club' | 'shop' | 'base' | 'obstacle' | 'stairs' | 'snow' | 'forest' | 'wall' | 'radio';
export type Suit = 'heart' | 'spade' | 'diamond' | 'club';

export interface Cell {
  id: number; x: number; y: number; floor: number; owner: -1 | 0 | 1 | 2 | 3; troops: number;
  type: CellType; base: boolean; shieldUntil: number; blockShield: boolean;
}
export interface Unit {
  id: number; owner: number; from: number; to: number; path: number[]; x: number; y: number;
  troops: number; ratio: number; progress: number; boostUntil: number; slowUntil: number; relayUntil?: number;
}
export interface Player {
  id: number; tiles: number; troops: number; skillReady: number; items: string[];
  cards: Record<string, number>; legend: string; exiled: boolean; exiledSince: number;
}
export interface GameEvent { kind: string; at: number; warningAt: number; fired: boolean }
export type MapId = 'main' | 'dorm' | 'canteen' | 'blackout' | 'sports' | 'lab' | 'hill' | 'exam' | 'snow';
export interface GameOptions { seed?: number; ai?: boolean[]; map?: MapId; floors?: number; mode?: 'ffa' | '2v2' }

export const FACTIONS = [
  { id: 0, name: '紫 · 武斗派', color: '#8e44ad', atk: 1.5, hp: 1, production: 1, speed: 1, skill: '冲锋', description: '高攻；兵团10秒移速+50%、攻击+30%；乘胜追击3秒' },
  { id: 1, name: '黄 · 体育生', color: '#f1c40f', atk: 1, hp: 1.6, production: 0.9, speed: 1, skill: '护盾', description: '厚血；己方格15秒损失减半，红桃回血翻倍' },
  { id: 2, name: '绿 · 人海', color: '#27ae60', atk: 0.9, hp: 1, production: 1.6, speed: 1, skill: '征召', description: '快速出兵；己方格立即+10兵' },
  { id: 3, name: '黑 · 学生会', color: '#34495e', atk: 1.15, hp: 1.15, production: 1.2, speed: 1, skill: '侦察', description: '均衡；8秒全图视野；每60秒登记一个相邻中立格' },
] as const;

export const TYPES: Record<CellType, { label: string; icon: string }> = {
  plain: { label: '空地', icon: '·' }, heart: { label: '红桃', icon: '♥' },
  spade: { label: '黑桃', icon: '♠' }, diamond: { label: '方块', icon: '♦' },
  club: { label: '梅花', icon: '♣' }, shop: { label: '小卖部', icon: '🛒' },
  base: { label: '基地', icon: '⌂' }, obstacle: { label: '障碍', icon: '▧' }, stairs: { label: '楼梯', icon: '↕' },
  snow: { label: '积雪', icon: '❄' }, forest: { label: '树林', icon: '♣' }, wall: { label: '围墙', icon: '▥' }, radio: { label: '广播站', icon: '📻' },
};

const K = 0.15, TICK = 0.05, LIMIT = 20, EPS = 1e-9;
/** 单格基础出兵速率（兵/秒/格）。GDD 基准 0.5 为 [PLACEHOLDER]；实测节奏过快，下调到 0.1。 */
export const BASE_RATE = 0.1;
const clampTroops = (n: number) => Math.max(0, Math.round(n * 100) / 100);

/** Closed-form result of one locked-exchange battle (before rounding). */
export function combatSurvivors(a: number, b: number, atkA = 1, hpA = 1, atkB = 1, hpB = 1): number {
  return a - b * b * atkB * hpB / (a * atkA * hpA);
}

interface Battle { cell: number; attacker: number; a: number; b: number; ra: number; rb: number; next: number; momentumUntil: number; chargeUntil: number }

export class Game {
  cells: Cell[] = [];
  units: Unit[] = [];
  players: Player[] = [];
  time = 0;
  tick = 0;
  human = 0;
  paused = false;
  over = false;
  winner: number | null = null;
  events: GameEvent[] = [];
  log: string[] = [];
  selectedLegend = ['', '', '', ''];
  onCapture?: (capturer: number, oldOwner: number, cell: Cell, troops: number) => void;
  onNotice?: (text: string, kind: string) => void;
  private accumulator = 0;
  private nextUnit = 1;
  private battles = new Map<number, Battle>();
  private drawn = new Set<string>();
  private shopAt = [0, 0, 0, 0];
  private aiAt = [1, 1, 1, 1];
  private ai: boolean[];
  private seed: number;
  map: MapId;
  size = 16;
  floors = 1;
  poison = new Set<number>();
  radioUntil = 0;
  silentUntil = 0;
  relayAt = 45;
  private floorSize = 64;
  legendPool = ['学霸', '体育生', '班干部'];
  mode: 'ffa' | '2v2' = 'ffa';
  sealedUntil = new Map<number, number>();
  private personalities: Personality[] = ['cautious', 'aggressive', 'opportunist', 'cautious'];
  private relayHolder = -1;
  radioOwner = -1;
  radioTarget = -1;
  radioCapture = { owner: -1, since: -1 };
  private dispatchPausedUntil = 0;
  private cardUntil = Array.from({ length: 4 }, () => ({ heart: 0, spade: 0, diamond: 0, club: 0 }));
  private productionPausedUntil = 0;
  private combatPausedUntil = 0;
  private dominanceSince = -1;
  private exileWinSince = -1;
  private scoutingUntil = [0, 0, 0, 0];
  private registrationAt = [0, 0, 0, 0];
  private momentumUntil = new Map<number, number>();
  private chargeUntil = new Map<number, number>();


  constructor(options: GameOptions = {}) {
    this.seed = options.seed ?? 1;
    this.map = options.map ?? 'main';
    this.size = this.map === 'dorm' ? 8 : 16;
    this.floors = this.map === 'dorm' ? options.floors ?? 3 : 1;
    this.floorSize = this.size * this.size;
    this.ai = options.ai ?? [false, true, true, true];
    this.makeMap();
    this.personalities = this.personalities.map(() => choosePersonality(() => this.random()));
    this.players = FACTIONS.map(f => ({ id: f.id, tiles: 9, troops: 15, skillReady: 20, items: [],
      cards: { heart: 0, spade: 0, diamond: 0, club: 0 }, legend: '', exiled: false,
      exiledSince: -1 }));
    const pool = ['教导主任巡视', '消防演习', '食堂开饭', '停电', '转学生', '校霸出没', '流感', '谣言', '大扫除', '家长会', '校庆烟火'];
    for (let i = 0; i < 2; i++) {
      const kind = pool.splice(Math.floor(this.random() * pool.length), 1)[0];
      const at = 90 + i * 150 + Math.floor(this.random() * 30);
      this.events.push({ kind, at, warningAt: at - 10, fired: false });
    }
    this.recount();
  }

  private random() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  private notice(text: string, kind = 'info') { this.log.push(text); this.onNotice?.(text, kind); }
  private makeMap() {
    if (this.map === 'dorm') { this.makeDorm(); if (!isStronglyConnected(this.cells, DORM_WALL_EDGES)) throw new Error('宿舍地图有向图不连通'); return; }
    if (this.map !== 'main') { this.makeVariant(); return; }
    const bases = new Set([0, 15, 240, 255]);
    const starts = [[0, 0], [15, 0], [0, 15], [15, 15]];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const id = y * 16 + x;
      let owner: Cell['owner'] = -1;
      starts.forEach(([sx, sy], p) => { if (Math.abs(x - sx) <= 1 && Math.abs(y - sy) <= 1) owner = p as Cell['owner']; });
      const central = (x === 7 || x === 8) && (y === 7 || y === 8);
      const shop = (x === 7 || x === 8) && (y === 0 || y === 15) || (y === 7 || y === 8) && (x === 0 || x === 15);
      // Rotation/reflection invariant obstacle pattern; starts and special cells stay open.
      const obstacle = ((x === 4 || x === 11) && (y === 4 || y === 11)) || ((x === 5 || x === 10) && (y === 7 || y === 8)) || ((y === 5 || y === 10) && (x === 7 || x === 8));
      const suit: CellType = (x + y) % 4 === 0 ? 'heart' : (x + y) % 4 === 1 ? 'spade' : (x + y) % 4 === 2 ? 'club' : 'plain';
      const type: CellType = bases.has(id) ? 'base' : central ? 'diamond' : shop ? 'shop' : obstacle && owner === -1 ? 'obstacle' : suit;
      this.cells.push({ id, x, y, floor: 0, owner: type === 'obstacle' ? -1 : owner, troops: bases.has(id) ? 15 : 0,
        type, base: bases.has(id), shieldUntil: 0, blockShield: false });
    }
  }

  private makeVariant() {
    const bases = new Set([0, 15, 240, 255]), starts = [[0, 0], [15, 0], [0, 15], [15, 15]];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const id = y * 16 + x; let owner: Cell['owner'] = -1;
      starts.forEach(([sx, sy], p) => { if (Math.abs(x - sx) <= 1 && Math.abs(y - sy) <= 1) owner = p as Cell['owner']; });
      const central = x >= 6 && x <= 9 && y >= 6 && y <= 9;
      let type: CellType = central ? 'diamond' : (x + y) % 4 === 0 ? 'heart' : (x + y) % 4 === 1 ? 'spade' : 'plain';
      if (bases.has(id)) type = 'base';
      if (this.map === 'snow' && !bases.has(id)) type = (x + y) % 3 ? 'snow' : 'plain';
      if (this.map === 'hill' && (x === 8 && y === 7)) type = 'wall';
      if (this.map === 'hill' && !bases.has(id)) type = (x * y + x + y) % 5 === 0 ? 'forest' : (x === 7 && y > 2 && y < 13 && y !== 7) ? 'wall' : type;
      this.cells.push({ id, x, y, floor: 0, owner: type === 'wall' ? -1 : owner, troops: bases.has(id) ? 15 : 0, type, base: bases.has(id), shieldUntil: 0, blockShield: false });
    }
  }

  private makeDorm() {
    const bases = new Set([0, 7, 56, 63]);
    const stairs = new Set([17, 22, 41, 46]);
    const starts = [[0, 0], [7, 0], [0, 7], [7, 7]];
    for (let floor = 0; floor < this.floors; floor++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const local = y * 8 + x, id = floor * 64 + local;
      let owner: Cell['owner'] = -1;
      if (floor === 0) starts.forEach(([sx, sy], p) => { if (Math.abs(x - sx) <= 1 && Math.abs(y - sy) <= 1) owner = p as Cell['owner']; });
      const type: CellType = bases.has(local) && floor === 0 ? 'base' : floor === 0 && [6, 48, 57, 15].includes(local) ? 'wall' : stairs.has(local) ? 'stairs' : (x === 3 || x === 4) && (y === 3 || y === 4) ? 'diamond' : (x + y) % 4 === 0 ? 'heart' : (x + y) % 4 === 1 ? 'spade' : 'plain';
      this.cells.push({ id, x, y, floor, owner, troops: floor === 0 && bases.has(local) ? 15 : 0, type, base: floor === 0 && bases.has(local), shieldUntil: 0, blockShield: false });
    }
  }

  toJSON() {
    return { cells: this.cells, units: this.units, players: this.players, time: this.time, tick: this.tick, human: this.human, paused: this.paused, over: this.over, winner: this.winner, events: this.events, log: this.log, selectedLegend: this.selectedLegend, accumulator: this.accumulator, nextUnit: this.nextUnit, battles: [...this.battles], drawn: [...this.drawn], shopAt: this.shopAt, aiAt: this.aiAt, ai: this.ai, seed: this.seed, map: this.map, size: this.size, floors: this.floors, cardUntil: this.cardUntil, productionPausedUntil: this.productionPausedUntil, combatPausedUntil: this.combatPausedUntil, dominanceSince: this.dominanceSince, exileWinSince: this.exileWinSince, scoutingUntil: this.scoutingUntil, registrationAt: this.registrationAt, momentumUntil: [...this.momentumUntil], chargeUntil: [...this.chargeUntil], floorSize: this.floorSize, dispatchPausedUntil: this.dispatchPausedUntil, poison: [...this.poison], radioUntil: this.radioUntil, silentUntil: this.silentUntil, relayAt: this.relayAt, relayHolder: this.relayHolder, radioOwner: this.radioOwner, radioTarget: this.radioTarget, radioCapture: this.radioCapture };
  }

  static fromJSON(data: ReturnType<Game['toJSON']>) {
    const g = new Game({ map: data.map, floors: data.floors, ai: data.ai });
    for (const key of ['accumulator', 'nextUnit', 'shopAt', 'aiAt', 'ai', 'seed', 'map', 'size', 'floors', 'cardUntil', 'productionPausedUntil', 'combatPausedUntil', 'dominanceSince', 'exileWinSince', 'scoutingUntil', 'registrationAt', 'floorSize', 'dispatchPausedUntil', 'radioUntil', 'silentUntil', 'relayAt', 'relayHolder', 'radioOwner', 'radioTarget', 'radioCapture'] as const) (g as any)[key] = data[key];
    for (const key of ['cells', 'units', 'players', 'time', 'tick', 'human', 'paused', 'over', 'winner', 'events', 'log', 'selectedLegend'] as const) (g as any)[key] = data[key];
    g.battles = new Map(data.battles); g.drawn = new Set(data.drawn); g.momentumUntil = new Map(data.momentumUntil); g.chargeUntil = new Map(data.chargeUntil); g.poison = new Set(data.poison);
    return g;
  }

  troopsAt(cellId: number, owner?: number) {
    const cell = this.cells[cellId];
    if (!cell) return 0;
    const battle = this.battles.get(cellId);
    return (owner === undefined || cell.owner === owner ? cell.troops : 0) +
      (battle && (owner === undefined || battle.attacker === owner) ? battle.a : 0) +
      this.units.filter(u => u.to === cellId && (owner === undefined || u.owner === owner)).reduce((n, u) => n + u.troops, 0);
  }

  canAttack(owner: number, from: number, to: number) {
    const a = this.cells[from], b = this.cells[to];
    return !!a && !!b && a.owner === owner && a.troops > 0 && b.type !== 'obstacle' && this.path(from, to).length > 0;
  }

  sealBuilding(owner: number, cellId: number) {
    const c = this.cells[cellId];
    if (c?.owner !== owner || c.type !== 'obstacle' || this.sealedUntil.has(cellId)) return false;
    this.sealedUntil.set(cellId, this.time + 30); this.repath(); return true;
  }
  demolish(cellId: number) {
    const c = this.cells[cellId];
    if (!c || c.type !== 'wall' || c.x < 6 || c.x > 9 || c.y < 6 || c.y > 9) return false;
    c.type = 'plain'; this.repath(); this.notice('中央围墙已拆除，兵团重新寻路', 'event'); return true;
  }
  private repath() {
    for (const u of this.units) { const path = this.path(u.from, u.to); if (path.length) { u.path = path.slice(1); u.progress = 0; } else { const home = this.nearestOwned(u.owner, u.from); if (home >= 0) { u.to = home; u.path = this.path(u.from, home).slice(1); } } }
  }

  dispatch(from: number, to: number, ratio = 0.5, owner = 0): Unit | null {
    if (this.over || this.paused || this.dispatchPausedUntil > this.time || ![0.25, 0.5, 1].includes(ratio) || !this.canAttack(owner, from, to) || this.mode === '2v2' && Math.floor(owner / 2) === Math.floor(this.cells[to].owner / 2)) return null;
    const source = this.cells[from], target = this.cells[to], path = this.path(from, to);
    const troops = clampTroops(source.troops * ratio);
    if (troops <= 0) return null;
    source.troops = clampTroops(source.troops - troops);
    const unit: Unit = { id: this.nextUnit++, owner, from, to, path: path.slice(1), x: source.x, y: source.y,
      troops, ratio, progress: 0, boostUntil: 0, slowUntil: 0 };
    this.units.push(unit); this.recount(); return unit;
  }

  retreat(unitId: number, owner?: number) {
    const unit = this.units.find(u => u.id === unitId && (owner === undefined || u.owner === owner));
    if (!unit) return false;
    const home = this.nearestOwned(unit.owner, unit.from);
    if (home < 0) { unit.troops = 0; return true; }
    unit.from = unit.path[0] ?? unit.from; unit.x = this.cells[unit.from].x; unit.y = this.cells[unit.from].y;
    unit.troops = clampTroops(unit.troops * 0.6);
    unit.to = home; unit.path = this.path(unit.from, home).slice(1); unit.progress = 0; return true;
  }

  reinforce(from: number, unitId: number, ratio = 0.5, owner = 0) {
    const unit = this.units.find(u => u.id === unitId && u.owner === owner);
    const target = unit?.to ?? [...this.battles.values()].find(b => b.attacker === owner)?.cell;
    return target === undefined ? null : this.dispatch(from, target, ratio, owner);
  }

  getBattle(owner?: number) { return [...this.battles.values()].find(b => owner === undefined || b.attacker === owner || this.cells[b.cell].owner === owner); }

  battleRetreat(owner: number) {
    const b = this.getBattle(owner);
    if (!b || b.attacker !== owner) return false;
    const home = this.nearestOwned(owner, b.cell); if (home < 0) return false;
    this.cells[home].troops = clampTroops(this.cells[home].troops + b.a * 0.6);
    this.battles.delete(b.cell); return true;
  }

  skill(owner: number, target?: number) {
    const p = this.players[owner], f = FACTIONS[owner];
    if (!p || this.over || this.silentUntil > this.time || this.time < p.skillReady || p.exiled) return false;
    let ok = false;
    if (owner === 0) { const u = this.units.find(u => u.id === target && u.owner === owner); if (u) { u.boostUntil = this.time + 10; this.chargeUntil.set(u.id, this.time + 10); ok = true; } }
    if (owner === 1) { const c = target === undefined ? undefined : this.cells[target]; if (c?.owner === owner) { c.shieldUntil = this.time + 15; ok = true; } }
    if (owner === 2) { const c = target === undefined ? undefined : this.cells[target]; if (c?.owner === owner) { c.troops = Math.min(this.cap(c), c.troops + 10); ok = true; } }
    if (owner === 3) { this.scoutingUntil[owner] = this.time + 8; ok = true; }
    if (ok) p.skillReady = this.time + (p.legend === '学霸' ? 45 : 60);
    return ok;
  }

  useItem(owner: number, index: number, target?: number) {
    const p = this.players[owner], item = p?.items[index];
    if (!item || this.over || this.silentUntil > this.time) return false;
    const cell = target === undefined ? undefined : this.cells[target];
    const unit = this.units.find(u => u.id === target && u.owner === owner);
    let ok = false;
    if (item === '辣条' && unit) { unit.boostUntil = Math.max(unit.boostUntil, this.time + 8); ok = true; }
    if (item === '作业本' && cell?.owner === owner) { cell.blockShield = true; ok = true; }
    if (item === '橡皮擦' && cell && cell.owner >= 0 && cell.owner !== owner && !this.battles.has(cell.id)) { this.capture(cell, -1, 0); ok = true; }
    if (item === '请假条' && unit) { const base = this.cells.find(c => c.base && c.owner === owner); if (base) { base.troops = Math.min(this.cap(base), base.troops + unit.troops); unit.troops = 0; } ok = true; }
    if (ok) p.items.splice(index, 1);
    return ok;
  }

  playCards(owner: number, suit: Suit) {
    const p = this.players[owner], count = p?.cards[suit] ?? 0;
    if (count < 2 || this.over) return false;
    const duration = count === 2 ? 10 : count === 3 ? 15 : 20;
    this.cardUntil[owner][suit] = this.time + duration;
    p.cards[suit] = 0;
    if (suit === 'heart') for (const c of this.cells) if (c.owner === owner) c.troops = Math.min(this.cap(c), c.troops + count);
    this.notice(`${FACTIONS[owner].name}打出${count}张${TYPES[suit].label}`, 'cards'); return true;
  }

  setAI(owner: number, enabled: boolean) { this.ai[owner] = enabled; }
  setLegend(owner: number, legend: string) {
    if (!['学霸', '体育生', '班干部', '后进生', '转校生'].includes(legend) || this.time > 0) return false;
    this.players[owner].legend = this.selectedLegend[owner] = legend;
    if (legend === '转校生') {
      const c = this.cells.find(c => c.owner === -1 && c.type !== 'obstacle');
      if (c) this.units.push({ id: this.nextUnit++, owner, from: c.id, to: c.id, path: [], x: c.x, y: c.y, troops: 8, ratio: 0, progress: 0, boostUntil: 0, slowUntil: 0 });
    }
    return true;
  }

  register(owner: number, cellId: number) {
    const c = this.cells[cellId];
    if (owner !== 3 || this.time < this.registrationAt[owner] || c?.owner !== -1 || c.type === 'obstacle' || !this.neighbors(cellId).some(id => this.cells[id].owner === owner)) return false;
    this.registrationAt[owner] = this.time + 60;
    this.capture(c, owner, 0);
    return true;
  }

  isScouting(owner: number) { return this.scoutingUntil[owner] > this.time; }
  canSee(owner: number, cellId: number) { return visible(this, owner, cellId); }
  canSeeUnit(owner: number, unit: Unit) { return this.canSee(owner, unit.from) && !isHidden(this, owner, unit.from); }

  rebuild(owner: number, cellId: number) {
    const p = this.players[owner], c = this.cells[cellId];
    if (!p?.exiled || !c || c.owner !== -1 || c.type === 'obstacle') return false;
    p.exiled = false; p.exiledSince = -1; this.capture(c, owner, 5); return true;
  }

  update(dt: number) {
    if (this.over || this.paused || !Number.isFinite(dt) || dt <= 0) return;
    this.accumulator += Math.min(dt, 1); // Avoid an unbounded catch-up spiral after a background tab.
    while (this.accumulator + 1e-9 >= TICK && !this.over) { this.accumulator -= TICK; this.step(); }
  }

  private step() {
    this.tick++; this.time = this.tick * TICK;
    this.moveUnits(); this.fight(); this.produce(); this.runEvents(); this.runMapRules(); for (let o = 0; o < 4; o++) if (!this.ai[o]) this.autoSkill(o); this.runAI(); this.checkExiles(); this.checkWin(); this.recount();
  }

  private path(from: number, to: number): number[] {
    if (from === to) return [from];
    if (!this.cells[from] || !this.cells[to] || this.blocked(to)) return [];
    if (this.cells[to].type === 'wall' && this.map === 'dorm' && !mapNeighbors(this, from, []).includes(to)) return [];
    const queue = [from], prev = new Map<number, number>([[from, -1]]);
    for (let q = 0; q < queue.length; q++) for (const n of this.neighbors(queue[q])) if (!prev.has(n) && !this.blocked(n)) {
      prev.set(n, queue[q]); if (n === to) { const out = [to]; let at = queue[q]; while (at !== -1) { out.unshift(at); if (at === from) break; at = prev.get(at)!; } return this.map === 'snow' ? extendIcePath(this, out) : out; }
      queue.push(n);
    }
    return [];
  }
  private neighbors(id: number) { return mapNeighbors(this, id, undefined, true); }
  private blocked(id: number) { return ['obstacle', 'wall'].includes(this.cells[id].type) || (this.sealedUntil.get(id) ?? 0) > this.time; }
  private connected(c: Cell) {
    if (c.owner < 0) return false;
    const seen = new Set([c.id]), queue = [c.id];
    for (let i = 0; i < queue.length; i++) for (const n of this.neighbors(queue[i]!)) if (!seen.has(n) && this.cells[n]?.owner === c.owner) { seen.add(n); queue.push(n); }
    return [...seen].some(id => this.cells[id].base);
  }
  private cap(c: Cell) { return LIMIT + (c.type === 'spade' ? 10 : 0) + (c.owner >= 0 && this.cardUntil[c.owner].spade > this.time ? 5 : 0); }

  private moveUnits() {
    for (const u of [...this.units]) {
      if (u.troops <= 0) { this.units.splice(this.units.indexOf(u), 1); continue; }
      if (!u.path.length) { this.arrive(u); continue; }
      const speed = FACTIONS[u.owner].speed * (u.boostUntil > this.time ? (FACTIONS[u.owner].skill === '冲锋' ? 1.5 : 2) : 1) * (u.slowUntil > this.time ? 0.5 : 1) * (u.owner >= 0 && this.players[u.owner].legend === '体育生' ? 1.15 : 1) * (this.relayHolder === u.id ? 2 : 1) * (this.cells[u.from]?.type === 'snow' ? .6 : 1) * (this.map === 'canteen' && this.cells[u.from].troops > 15 ? .5 : 1) * (this.map === 'canteen' && this.units.filter(v => Math.abs(this.cells[v.from].x - this.cells[u.from].x) <= 1 && Math.abs(this.cells[v.from].y - this.cells[u.from].y) <= 1).reduce((n, v) => n + v.troops, 0) > 40 ? .7 : 1) * (this.radioUntil > this.time ? (this.radioOwner === u.owner ? 1.3 : this.radioTarget === u.owner ? .7 : 1) : 1);
      u.progress += TICK * speed;
      while (u.progress + EPS >= 1 && u.path.length) {
        u.progress -= 1; u.from = u.path.shift()!; const c = this.cells[u.from]; if (!c) { u.troops = 0; break; } u.x = c.x; u.y = c.y;
        if (c.type === 'club' && c.owner !== u.owner || c.owner >= 0 && c.owner !== u.owner && this.cardUntil[c.owner].club > this.time) u.slowUntil = this.time + 5;
        if (this.map === 'sports' && this.relayAt <= this.time && this.relayHolder < 0) { this.relayHolder = u.id; this.relayAt = this.time + 45; this.notice(`${FACTIONS[u.owner].name}获得接力棒`, 'event'); }
        if (!u.path.length) this.arrive(u);
      }
    }
  }

  private arrive(u: Unit) {
    this.units.splice(this.units.indexOf(u), 1);
    const c = this.cells[u.to];
    if (c.owner === u.owner) { c.troops = Math.min(this.cap(c), c.troops + u.troops); return; }
    if (c.blockShield) { c.blockShield = false; this.notice(`${TYPES[c.type].label}护盾抵挡了一次进攻`, 'shield'); return; }
    const old = c.owner;
    const existing = this.battles.get(c.id);
    if (existing && existing.attacker === u.owner) { existing.a += u.troops; this.lock(existing); return; }
    if (existing) { // Third parties wait as reinforcements instead of creating ill-defined three-way combat.
      this.units.push(u); u.path = [u.to]; u.progress = -TICK; return;
    }
    if (c.owner === -1 || c.troops <= 0) { this.capture(c, u.owner, u.troops); return; }
    const b: Battle = { cell: c.id, attacker: u.owner, a: u.troops, b: c.troops, ra: 0, rb: 0, next: this.time + 0.5, momentumUntil: this.momentumUntil.get(u.id) ?? 0, chargeUntil: this.chargeUntil.get(u.id) ?? 0 };
    this.lock(b); this.battles.set(c.id, b);
  }

  private lock(b: Battle) {
    const c = this.cells[b.cell], defender = c.owner as 0 | 1 | 2 | 3;
    const atkA = FACTIONS[b.attacker].atk * (b.attacker === 0 ? (b.chargeUntil > this.time ? 1.3 : 1) * (b.momentumUntil > this.time ? 1.2 : 1) : 1);
    b.ra = b.b * FACTIONS[defender].atk * K / FACTIONS[b.attacker].hp * (c.shieldUntil > this.time ? 0.5 : 1);
    b.rb = b.a * atkA * K / FACTIONS[defender].hp;
    c.troops = b.b;
  }
  private resolvedThisTick = new Set<number>();
  private spawnAcc = new Map<number, number>();

  private fight() {
    this.resolvedThisTick.clear();
    if (this.combatPausedUntil > this.time) return;
    for (const b of [...this.battles.values()]) {
      if (b.next > this.time) continue;
      b.next += 0.5;
      b.a = b.a - b.ra < 0.1 ? 0 : clampTroops(b.a - b.ra);
      b.b = b.b - b.rb < 0.1 ? 0 : clampTroops(b.b - b.rb);
      const c = this.cells[b.cell]; c.troops = Math.max(0, b.b);
      if (b.a > 0 && b.b > 0) continue;
      this.battles.delete(c.id); this.resolvedThisTick.add(c.id);
      if (b.a > 0) {
        const survivors = this.units.filter(u => u.owner === b.attacker && u.to === c.id);
        if (b.attacker === 0) for (const u of survivors) this.momentumUntil.set(u.id, this.time + 3);
        this.capture(c, b.attacker, b.a);
      } else c.troops = 0; // Mutual KO leaves the defender's empty cell.
      // Waiting third-party units are reconsidered on the next movement step.
      for (const u of this.units.filter(u => u.to === c.id && u.path.length === 1 && u.path[0] === c.id)) { u.path = []; this.arrive(u); }
    }
  }
  private capture(c: Cell, owner: number, troops: number) {
    const old = c.owner; c.owner = owner as Cell['owner']; c.troops = Math.min(this.cap(c), troops);
    if (c.type === 'radio') this.radioCapture = { owner, since: this.time };
    if (owner >= 0 && ['heart', 'spade', 'diamond', 'club'].includes(c.type)) {
      const key = `${owner}:${c.id}`;
      if (!this.drawn.has(key)) {
        this.drawn.add(key); const p = this.players[owner], suit = c.type as Suit;
        const suits = Object.keys(p.cards) as Suit[]; let oldest = suit;
        if (suits.reduce((n, s) => n + p.cards[s], 0) >= 4) oldest = suits.find(s => p.cards[s] > 0) ?? suit;
        if (oldest !== suit) p.cards[oldest]--;
        p.cards[suit]++;
      }
    }
    this.onCapture?.(owner, old, c, c.troops);
    const oldName = old < 0 ? '中立' : FACTIONS[old as 0 | 1 | 2 | 3].name;
    const newName = owner < 0 ? '橡皮擦' : FACTIONS[owner as 0 | 1 | 2 | 3].name;
    this.notice(`${oldName}的${c.x},${c.y}被${newName}占领`, 'capture');
  }

  private produce() {
    const S = this.cells.filter(c => c.type !== 'obstacle').length / 4;
    for (let owner = 0; owner < 4; owner++) {
      const p = this.players[owner];
      if (!this.cells.some(c => c.owner === owner)) continue;
      if (p.exiled || this.productionPausedUntil > this.time) continue;
      let modifier = 1;
      if (p.legend === '后进生' && p.tiles === Math.min(...this.players.map(p => p.tiles))) modifier *= 1.3;
      if (this.cardUntil[owner].diamond > this.time) modifier *= 1.5;
      const owned = this.cells.filter(c => c.owner === owner).map(c => ({ c, contribution: (c.type === 'diamond' || this.map === 'canteen' && c.x >= 6 && c.x <= 9 && c.y >= 6 && c.y <= 9 ? 2 : 1) * (this.connected(c) ? 1 : 0.5) })).sort((a, b) => b.contribution - a.contribution || a.c.id - b.c.id);
      owned.forEach(({ c, contribution }, i) => {
        if (c.type === 'heart' && this.tick % 60 === 0) c.troops = Math.min(this.cap(c), c.troops + (owner === 1 ? 2 : 1));
        if (this.battles.has(c.id) || this.resolvedThisTick.has(c.id)) return;
        const marginal = i + 1 <= S * 0.5 ? 1 : i + 1 <= S ? 0.6 : i + 1 <= S * 1.5 ? 0.35 : 0.15;
        const acc = (this.spawnAcc.get(c.id) ?? 0) + BASE_RATE * TICK * FACTIONS[owner].production * contribution * marginal * modifier;
        const whole = Math.floor(acc + 1e-6); // 吸收浮点累积误差，避免 3.0 退化成 2
        this.spawnAcc.set(c.id, acc - whole);
        if (whole > 0) c.troops = Math.min(this.cap(c), c.troops + whole);
      });
      const shop = this.cells.find(c => c.type === 'shop' && c.owner === owner);
      if (shop && this.time >= this.shopAt[owner]) {
        this.shopAt[owner] = this.time + 60;
        if (p.items.length < 2) p.items.push(['辣条', '作业本', '橡皮擦', '请假条'][Math.floor(this.random() * 4)]);
      }
    }
  }

  get currentEvent() {
    const e = this.events.find(e => !e.fired && this.time >= e.warningAt && this.time < e.at);
    return e ? { name: e.kind, time: e.at } : null;
  }

  private runEvents() {
    for (const e of this.events) {
      if (!e.fired && this.time === e.warningAt) this.notice(`${e.kind}将在10秒后触发`, 'warning');
      if (e.fired || this.time < e.at) continue;
      e.fired = true; this.notice(e.kind, 'event');
      if (e.kind === '教导主任巡视') {
        const owner = [...this.players].sort((a, b) => b.tiles - a.tiles)[0].id;
        for (const c of this.cells) if (c.owner === owner && c.x >= 6 && c.x <= 9 && c.y >= 6 && c.y <= 9) c.troops = clampTroops(c.troops * 0.7);
        for (const u of this.units) if (u.owner === owner) u.troops = clampTroops(u.troops * 0.7);
      } else if (e.kind === '消防演习') {
        for (const u of this.units) { const home = this.nearestOwned(u.owner, u.from); if (home >= 0) this.cells[home].troops = Math.min(this.cap(this.cells[home]), this.cells[home].troops + u.troops); }
        this.units = [];
        for (const c of this.cells) if (c.owner >= 0 && !c.base) c.troops = Math.ceil(c.troops / 2);
        this.dispatchPausedUntil = this.time + 10;
      } else if (e.kind === '食堂开饭') {
        for (const c of this.cells) if (c.owner >= 0) c.troops = Math.min(this.cap(c), c.troops + 10);
        this.combatPausedUntil = this.time + 10;
      } else {
        const leader = [...this.players].sort((a, b) => b.tiles - a.tiles)[0].id;
        for (const u of this.units) if (e.kind === '流感' || e.kind === '校霸出没' || e.kind === '大扫除' || e.kind === '停电') u.troops *= .8;
        if (e.kind === '家长会' || e.kind === '谣言') this.dispatchPausedUntil = this.time + 8;
        if (e.kind === '转学生') { const c = this.cells.find(c => c.owner === leader && !c.base); if (c) c.troops = Math.max(0, c.troops - 3); }
        if (e.kind === '校庆烟火') this.combatPausedUntil = this.time + 8;
      }
    }
  }

  private runMapRules() {
    if (this.map === 'exam') this.silentUntil = this.time >= 180 && this.time < 225 ? 225 : 0;
    if (this.map === 'lab' && this.time >= 30 && this.tick % 600 === 0) this.poison.add(119);
    if (this.map === 'lab' && this.time > 30 && this.tick % 200 === 0) for (const id of [...this.poison]) for (const n of this.neighbors(id)) if (this.cells[n].type !== 'wall') this.poison.add(n);
    if (this.poison.size && this.tick % 20 === 0) for (const id of this.poison) { const c = this.cells[id]; c.troops = Math.max(0, c.troops - 1); for (const u of this.units) if (u.from === id) u.troops = Math.max(0, u.troops - 1); }
    if (this.tick >= 4600 && this.tick < 4800 && this.tick % 20 === 0) this.notice(`广播站将在${Math.ceil((4800 - this.tick) / 20)}秒后开放`, 'warning');
    if (this.tick >= 4800 && !this.cells.some(c => c.type === 'radio')) { const c = this.cells[Math.floor(this.cells.length / 2) - Math.floor(this.size / 2)]; c.type = 'radio'; c.owner = -1; c.troops = 0; this.notice('中央广播站开放，占领可获得移速增益', 'event'); }
  }

  chooseRadio(owner: number, boost: boolean, target = -1) {
    const c = this.cells.find(c => c.type === 'radio' && c.owner === owner);
    if (!c || c.owner !== owner || this.radioUntil > this.time || this.radioCapture.owner !== owner || this.radioCapture.since < 0 || this.time - this.radioCapture.since < 6) return false;
    if (!boost && (target < 0 || target > 3 || target === owner)) return false;
    this.radioOwner = boost ? owner : -1; this.radioTarget = boost ? -1 : target; this.radioUntil = this.time + (boost ? 15 : 10); this.radioCapture.since = -1; return true;
  }

  /** 技能改为自动施放（UI 不再提供按钮），所有社团同一套判定。 */
  autoSkill(owner: number) {
    const p = this.players[owner];
    if (!p || p.exiled || this.time < p.skillReady) return;
    const own = this.cells.filter(c => c.owner === owner);
    const target = owner === 0 ? this.units.find(u => u.owner === owner)?.id : owner === 3 ? undefined : own.sort((a, b) => b.troops - a.troops)[0]?.id;
    this.skill(owner, target);
    if (owner === 3) { const cell = this.cells.find(c => c.owner === -1 && c.type !== 'obstacle' && this.neighbors(c.id).some(n => this.cells[n].owner === owner)); if (cell) this.register(owner, cell.id); }
  }

  private runAI() {
    for (let owner = 0; owner < 4; owner++) {
      const p = this.players[owner]; if (!this.ai[owner] || p.exiled || this.time < this.aiAt[owner]) continue;
      this.aiAt[owner] = this.time + aiDelayMs(() => this.random()) / 1000;
      if (p.skillReady <= this.time) this.autoSkill(owner);
      const sources = this.cells.filter(c => c.owner === owner && c.troops >= 4).sort((a, b) => b.troops - a.troops);
      for (const source of sources.slice(0, 1)) {
        const target = this.cells.filter(c => c.owner !== owner && !this.blocked(c.id) && this.canSee(owner, c.id)).sort((a, b) => {
          const score = (c: Cell) => (c.owner === -1 ? 3 : 0) + (c.type === 'diamond' || c.type === 'shop' ? 2 : 0) - c.troops / 10 - (Math.abs(c.x - source!.x) + Math.abs(c.y - source!.y)) / 8 + (c.owner >= 0 ? leaderWeight(this, c.owner, this.personalities[owner]) - 1 : 0);
          return score(b) - score(a);
        })[0];
        if (target) this.dispatch(source.id, target.id, 0.5, owner);
      }
    }
  }

  private nearestOwned(owner: number, from: number) {
    return this.cells.filter(c => c.owner === owner).sort((a, b) => (Math.abs(a.x - this.cells[from].x) + Math.abs(a.y - this.cells[from].y) + Math.abs(a.floor - this.cells[from].floor) * 4) - (Math.abs(b.x - this.cells[from].x) + Math.abs(b.y - this.cells[from].y) + Math.abs(b.floor - this.cells[from].floor) * 4))[0]?.id ?? -1;
  }
  private checkExiles() {
    for (const p of this.players) {
      if (p.exiled && this.ai[p.id]) { const c = this.cells.find(c => c.owner === -1 && c.type !== 'obstacle'); if (c) this.rebuild(p.id, c.id); }
      const active = this.cells.some(c => c.owner === p.id) || this.units.some(u => u.owner === p.id && u.troops > 0) || [...this.battles.values()].some(b => b.attacker === p.id);
      if (!active && !p.exiled) { for (const c of this.cells) if (c.owner === p.id) c.owner = -1; p.exiled = true; p.exiledSince = this.time; this.notice(`${FACTIONS[p.id].name}开始流亡`, 'exile'); if (p.id === this.human) this.notice(`EXILE_LOCATE:${this.cells.find(c => c.owner === -1 && c.type !== 'obstacle')?.id ?? -1}`, 'exile-locate'); }
    }
  }
  private checkWin() {
    const occupiable = this.cells.filter(c => c.type !== 'obstacle').length;
    if (this.mode === '2v2') {
      const teams = [[0, 1], [2, 3]].map(team => ({ team, tiles: team.reduce((n, id) => n + this.players[id].tiles, 0) }));
      const lead = teams.sort((a, b) => b.tiles - a.tiles)[0], other = teams[1];
      const dominance = lead.tiles >= occupiable * .6, exiles = lead.team.every(id => !this.players[id].exiled) && other.team.every(id => this.players[id].exiled);
      this.dominanceSince = dominance ? (this.dominanceSince < 0 ? this.time : this.dominanceSince) : -1;
      this.exileWinSince = exiles ? (this.exileWinSince < 0 ? this.time : this.exileWinSince) : -1;
      if (dominance && this.time - this.dominanceSince >= 20 || exiles && this.time - this.exileWinSince >= 20 || this.time >= 480 || this.time >= 420 && lead.tiles >= other.tiles * 2) { this.over = true; this.winner = lead.tiles > other.tiles ? lead.team[0] : null; }
      return;
    }
    const leader = [...this.players].sort((a, b) => b.tiles - a.tiles)[0];
    const second = [...this.players].sort((a, b) => b.tiles - a.tiles)[1];
    const dominance = leader.tiles >= occupiable * 0.6;
    this.dominanceSince = dominance ? (this.dominanceSince < 0 ? this.time : this.dominanceSince) : -1;
    const exiles = this.players.filter(p => p.exiled).length === 3;
    this.exileWinSince = exiles ? (this.exileWinSince < 0 ? this.time : this.exileWinSince) : -1;
    if ((dominance && this.time - this.dominanceSince >= 20) || (exiles && this.time - this.exileWinSince >= 20) || this.time >= 480 || this.time >= 420 && leader.tiles >= second.tiles * 2) {
      this.over = true; this.winner = leader.tiles > second.tiles ? leader.id : null; this.notice(this.winner === null ? '平局' : `${FACTIONS[this.winner].name}获胜`, 'gameover');
    }
  }
  private recount() {
    for (const p of this.players) {
      p.tiles = this.cells.filter(c => c.owner === p.id).length;
      p.troops = clampTroops(this.cells.filter(c => c.owner === p.id).reduce((n, c) => n + c.troops, 0) + this.units.filter(u => u.owner === p.id).reduce((n, u) => n + u.troops, 0));
    }
  }
}
