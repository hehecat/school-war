import { createServer, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { Game, type MapId } from './src/core.ts';

type Client = WebSocket & { room?: Room; owner?: number; session?: string };
type Args = Record<string, unknown>;
type Room = {
  code: string; game?: Game; players: (Client | null)[]; sessions: string[];
  ready: boolean[]; legends: string[]; map: MapId; mode: 'ffa' | '2v2';
  dailySeed?: number; countdownUntil?: number; lastSeen: number;
};

const maps: MapId[] = ['main', 'dorm', 'canteen', 'blackout', 'sports', 'lab', 'hill', 'exam', 'snow'];
const legends = ['学霸', '体育生', '班干部', '后进生', '转校生'];
const ROOM_TTL = 5 * 60_000;
const rooms = new Map<string, Room>();
const dist = resolve(import.meta.dirname, 'dist');
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const send = (ws: WebSocket, message: object) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); };
const error = (ws: WebSocket, message: string, id?: unknown) => send(ws, { type: 'error', error: message, id });
const code = () => {
  do { var value = randomBytes(4).readUInt32BE().toString(36).toUpperCase().padStart(6, '0').slice(-6); } while (rooms.has(value));
  return value;
};
const validId = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const validSeed = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const snapshot = (room: Room) => ({
  type: 'state', code: room.code, players: room.players.map(Boolean), ready: [...room.ready],
  legend: [...room.legends], legends: [...room.legends], map: room.map, mode: room.mode,
  teams: room.mode === '2v2' ? [[0, 1], [2, 3]] : [[0], [1], [2], [3]],
  dailySeed: room.dailySeed, countdown: room.countdownUntil ? Math.max(0, (room.countdownUntil - Date.now()) / 1000) : 0,
  started: !!room.game, state: room.game ? room.game.toJSON() : null,
});
const broadcast = (room: Room) => { const state = snapshot(room); for (const ws of room.players) if (ws) send(ws, state); };
const result = (ws: Client, msg: Args, ok: boolean) => send(ws, { type: 'result', action: typeof msg.action === 'string' ? msg.action : msg.type, ok, id: msg.id });

function join(ws: Client, msg: Args, create: boolean) {
  if (ws.room) return error(ws, 'already joined', msg.id);
  let room: Room | undefined, owner = -1, session = '';
  if (create) {
    const key = code();
    room = { code: key, players: [null, null, null, null], sessions: [], ready: [false, false, false, false], legends: ['', '', '', ''], map: 'main', mode: 'ffa', lastSeen: Date.now() };
    rooms.set(key, room); owner = 0;
  } else {
    if (typeof msg.code !== 'string') return error(ws, 'invalid room code', msg.id);
    room = rooms.get(msg.code.toUpperCase());
    if (!room) return error(ws, 'room not found', msg.id);
    if (msg.session !== undefined && typeof msg.session !== 'string') return error(ws, 'invalid session', msg.id);
    if (typeof msg.session === 'string' && (owner = room.sessions.indexOf(msg.session)) >= 0 && !room.players[owner]) session = msg.session;
    else if (room.game) return error(ws, 'game already started', msg.id);
    else owner = room.players.indexOf(null);
  }
  if (owner < 0) return error(ws, 'room full or seat occupied', msg.id);
  session ||= randomBytes(18).toString('base64url');
  room.players[owner] = ws; room.sessions[owner] = session; room.lastSeen = Date.now();
  room.game?.setAI(owner, false);
  ws.room = room; ws.owner = owner; ws.session = session;
  send(ws, { type: 'joined', code: room.code, owner, session, roster: room.players.map(Boolean), ready: [...room.ready], legend: [...room.legends], map: room.map, mode: room.mode, teams: snapshot(room).teams, dailySeed: room.dailySeed, id: msg.id });
  broadcast(room);
}

function ready(ws: Client, msg: Args) {
  const room = ws.room, owner = ws.owner;
  if (!room || room.game || owner === undefined) return error(ws, 'room is not drafting', msg.id);
  if (typeof msg.ready !== 'boolean' || typeof msg.legend !== 'string' || !legends.includes(msg.legend)) return error(ws, 'invalid ready or legend', msg.id);
  room.ready[owner] = msg.ready; room.legends[owner] = msg.legend;
  result(ws, msg, true);
  const allReady = () => room.players.some(Boolean) && room.ready.every((value, seat) => !room.players[seat] || value);
  if (allReady() && !room.countdownUntil) {
    room.countdownUntil = Date.now() + 3000;
    setTimeout(() => {
      if (!room.game && room.countdownUntil && allReady()) startGame(room);
    }, 3000).unref();
  } else if (!allReady()) room.countdownUntil = undefined;
  broadcast(room);
}

function configure(ws: Client, msg: Args) {
  const room = ws.room;
  if (!room || ws.owner !== 0 || room.game) return error(ws, 'only host can configure a draft room', msg.id);
  if (msg.map !== undefined) {
    if (typeof msg.map !== 'string' || !maps.includes(msg.map as MapId)) return error(ws, 'invalid map', msg.id);
    room.map = msg.map as MapId;
  }
  if (msg.mode !== undefined) {
    if (msg.mode !== 'ffa' && msg.mode !== '2v2') return error(ws, 'invalid mode', msg.id);
    room.mode = msg.mode;
  }
  if (msg.dailySeed !== undefined && msg.dailySeed !== null && !validSeed(msg.dailySeed)) return error(ws, 'invalid daily seed', msg.id);
  room.dailySeed = msg.dailySeed === null ? undefined : msg.dailySeed as number | undefined;
  result(ws, msg, true); broadcast(room);
}

function startGame(room: Room) {
  const game = room.game = new Game({ ai: room.players.map(p => !p), map: room.map, mode: room.mode, seed: room.dailySeed });
  for (let owner = 0; owner < 4; owner++) if (room.legends[owner]) game.setLegend(owner, room.legends[owner]);
  room.countdownUntil = undefined;
  broadcast(room);
}

function command(ws: Client, msg: Args) {
  const room = ws.room, game = room?.game, owner = ws.owner;
  if (!room || !game || owner === undefined) return error(ws, 'game not started', msg.id);
  const a = msg.args && typeof msg.args === 'object' && !Array.isArray(msg.args) ? msg.args as Args : {};
  let value: unknown;
  switch (msg.action) {
    case 'dispatch':
      if (!validId(a.from) || !validId(a.to) || typeof a.ratio !== 'number' || ![0.25, 0.5, 1].includes(a.ratio)) return error(ws, 'invalid dispatch arguments', msg.id);
      value = game.dispatch(a.from, a.to, a.ratio, owner); break;
    case 'skill':
      if (a.target !== undefined && !validId(a.target)) return error(ws, 'invalid skill target', msg.id);
      value = game.skill(owner, a.target); break;
    case 'useItem':
      if (!validId(a.index) || a.target !== undefined && !validId(a.target)) return error(ws, 'invalid item arguments', msg.id);
      value = game.useItem(owner, a.index, a.target); break;
    case 'playCards':
      if (typeof a.suit !== 'string' || !['heart', 'spade', 'diamond', 'club'].includes(a.suit)) return error(ws, 'invalid suit', msg.id);
      value = game.playCards(owner, a.suit as 'heart' | 'spade' | 'diamond' | 'club'); break;
    case 'register': case 'rebuild': case 'sealBuilding':
      if (!validId(a.cellId)) return error(ws, 'invalid cell id', msg.id);
      value = game[msg.action](owner, a.cellId); break;
    case 'demolish':
      if (!validId(a.cellId)) return error(ws, 'invalid cell id', msg.id);
      value = game.demolish(a.cellId); break;
    case 'retreat':
      if (!validId(a.unitId)) return error(ws, 'invalid unit id', msg.id);
      value = game.retreat(a.unitId, owner); break;
    case 'battleRetreat': value = game.battleRetreat(owner); break;
    case 'radio':
      if (typeof a.boost !== 'boolean' && a.boost !== undefined) return error(ws, 'invalid radio boost', msg.id);
      if (a.target !== undefined && (!validId(a.target) || a.target > 3 || a.target === owner)) return error(ws, 'invalid radio target', msg.id);
      value = game.chooseRadio(owner, a.boost !== false, a.target);
      break;
    default: return error(ws, 'unknown action', msg.id);
  }
  result(ws, msg, value !== null && value !== false);
}

export async function startServer(port = Number(process.env.PORT) || 5173, dev = process.env.NODE_ENV !== 'production', roomTTL = ROOM_TTL): Promise<Server> {
  let vite: any;
  const http = createServer(async (req, res: ServerResponse) => {
    if (vite) return vite.middlewares(req, res, (e: unknown) => { if (e) { res.statusCode = 500; res.end(String(e)); } });
    try {
      const path = resolve(dist, '.' + new URL(req.url || '/', 'http://localhost').pathname);
      if (path !== dist && !path.startsWith(dist + sep)) throw new Error('invalid path');
      const file = await readFile(path).catch(() => readFile(resolve(dist, 'index.html')));
      const type = extname(path) || '.html';
      res.setHeader('Content-Type', mime[type] || 'application/octet-stream'); res.end(file);
    } catch { res.statusCode = 404; res.end('Not found'); }
  });
  // ws.server: 让 vite 复用这个 http server, 不再单独监听 24678 端口
  if (dev) vite = await (await import('vite')).createServer({
    base: process.env.BASE || '/',
    server: { middlewareMode: true, ws: { server: http }, allowedHosts: (process.env.ALLOWED_HOSTS || 'html.hehecat.win').split(',') },
    appType: 'spa',
  });
  if (dev) {
    // 反向代理剥掉了 /school 前缀, 而 vite 的 HMR ws 固定按 base 匹配路径;
    // 这里把带 vite-hmr 子协议的升级请求补回 base, HMR 才能穿过代理连上
    const base = '/' + (process.env.BASE || '/').replace(/^\/+|\/+$/g, '');
    http.prependListener('upgrade', (req: any) => {
      const url = new URL(req.url || '/', 'http://localhost');
      if (req.headers['sec-websocket-protocol'] === 'vite-hmr' && url.pathname === '/') req.url = `${base}/${url.search}`;
    });
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  http.on('upgrade', (req, socket, head) => {
    const wsPath = new URL(req.url || '/', 'http://localhost').pathname;
    const base = (process.env.BASE || '/').replace(/\/+$/, '');
    if (wsPath !== '/ws' && wsPath !== `${base}/ws`) { if (!vite) socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      const client = ws as Client;
      send(client, { type: 'hello' });
      client.on('message', data => {
        let msg: Args;
        try { msg = JSON.parse(data.toString()); if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw 0; } catch { return error(client, 'invalid JSON'); }
        if (msg.type === 'create') join(client, msg, true);
        else if (msg.type === 'join') join(client, msg, false);
        else if (msg.type === 'ready') ready(client, msg);
        else if (msg.type === 'room' || msg.type === 'configure') configure(client, msg);
        else if (msg.type === 'start') {
          const room = client.room;
          if (!room || client.owner !== 0 || room.game) return error(client, 'only host can start once', msg.id);
          if (msg.map !== undefined && (typeof msg.map !== 'string' || !maps.includes(msg.map as MapId))) return error(client, 'invalid map', msg.id);
          if (msg.legend !== undefined && (typeof msg.legend !== 'string' || !legends.includes(msg.legend))) return error(client, 'invalid legend', msg.id);
          room.map = msg.map as MapId || room.map;
          if (msg.legend) { room.legends[0] = msg.legend; room.ready[0] = true; }
          result(client, msg, true); startGame(room);
        }
        else if (msg.type === 'action') command(client, msg);
        else error(client, 'unknown message type', msg.id);
      });
      client.on('close', () => {
        const room = client.room, owner = client.owner;
        if (room && owner !== undefined && room.players[owner] === client) {
          room.players[owner] = null; room.lastSeen = Date.now();
          if (room.game) room.game.setAI(owner, true);
          else { room.ready[owner] = false; room.countdownUntil = undefined; }
          broadcast(room);
        }
      });
      client.on('error', () => {});
    });
  });
  let ticks = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, room] of rooms) {
      if (!room.players.some(Boolean)) {
        if (now - room.lastSeen >= roomTTL) rooms.delete(key);
        continue;
      }
      room.lastSeen = now;
      if (room.game) room.game.update(0.05);
      if (++ticks % 2 === 0) broadcast(room);
    }
  }, 50);
  timer.unref();
  http.on('close', () => { clearInterval(timer); wss.close(); void vite?.close(); rooms.clear(); });
  await new Promise<void>((ok, fail) => { http.once('error', fail); http.listen(port, () => { http.off('error', fail); ok(); }); });
  return http;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) startServer().then(s => {
  const address = s.address(); console.log(`School server: http://localhost:${typeof address === 'object' && address ? address.port : 5173}`);
});
