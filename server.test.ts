import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startServer } from './server.ts';

class Client {
  ws: WebSocket;
  messages: any[] = [];
  joined: Promise<any>;
  join!: (message: any) => void;
  fail!: (error: Error) => void;
  constructor(url: string, message: object) {
    this.joined = new Promise((resolve, reject) => { this.join = resolve; this.fail = reject; });
    this.ws = new WebSocket(url);
    this.ws.on('open', () => this.ws.send(JSON.stringify(message)));
    this.ws.on('error', this.fail);
    this.ws.on('message', data => {
      const msg = JSON.parse(data.toString()); this.messages.push(msg);
      if (msg.type === 'joined') this.join(msg);
    });
  }
  send(message: object) { this.ws.send(JSON.stringify(message)); }
  clear() { this.messages.length = 0; }
  async state(test: (msg: any) => boolean, timeout = 3000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const found = this.messages.find(test); if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail(`state timeout: ${JSON.stringify(this.messages.slice(-3))}`);
  }
  async close() {
    if (this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) return;
    const closed = new Promise(resolve => this.ws.once('close', resolve));
    this.ws.close(); await closed;
  }
}

async function fixture(t: test.TestContext, roomTTL?: number) {
  const server = await startServer(0, false, roomTTL);
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const clients: Client[] = [];
  const connect = async (message: object) => {
    const client = new Client(url, message); clients.push(client);
    await client.joined; return client;
  };
  t.after(async () => {
    await Promise.all(clients.map(client => client.close()));
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return { connect, url };
}

test('legacy start remains compatible, snapshots are 10 Hz while Game runs at 20 Hz', async t => {
  const { connect } = await fixture(t);
  const host = await connect({ type: 'create' });
  const guest = await connect({ type: 'join', code: (await host.joined).code.toLowerCase() });
  const joined = await guest.joined; assert.equal(joined.owner, 1);
  host.send({ type: 'start', legend: '学霸' });
  await host.state(m => m.type === 'state' && m.started);
  host.send({ type: 'action', action: 'dispatch', args: { from: 0, to: 1, ratio: .5 } });
  const dispatched = await guest.state(m => m.type === 'state' && m.state?.units.some((u: any) => u.owner === 0 && u.from === 0 && u.to === 1));
  assert.ok(dispatched.state.cells[0].troops >= 7.5 && dispatched.state.cells[0].troops < 8);
  assert.ok(Array.isArray(dispatched.state.battles), 'state uses Game.toJSON rather than raw JSON.stringify');

  guest.clear();
  await new Promise(resolve => setTimeout(resolve, 510));
  const snapshots = guest.messages.filter(m => m.type === 'state' && m.started);
  assert.ok(snapshots.length >= 4 && snapshots.length <= 6, `expected about 5 snapshots, got ${snapshots.length}`);
  assert.ok(snapshots.at(-1).state.tick - snapshots[0].state.tick >= 8, 'Game advances at 20 Hz');
  guest.send({ type: 'action', action: 'dispatch', args: { from: 0, to: 2, ratio: .5 } });
  const denied = await guest.state(m => m.type === 'result' && m.action === 'dispatch');
  assert.equal(denied.ok, false, 'client cannot control another owner');

  const session = joined.session;
  await guest.close();
  await host.state(m => m.type === 'state' && m.players[1] === false);
  const reconnected = await connect({ type: 'join', code: joined.code, session });
  const resumed = await reconnected.joined;
  assert.equal(resumed.owner, 1); assert.equal(resumed.session, session);
  assert.deepEqual(resumed.roster, [true, true, false, false]);
  await reconnected.state(m => m.type === 'state' && m.started && m.state.tick > 0);
});

test('host configuration, independent legends and all-ready countdown start', async t => {
  const { connect } = await fixture(t);
  const host = await connect({ type: 'create' });
  const created = await host.joined;
  const guest = await connect({ type: 'join', code: created.code });
  host.send({ type: 'room', map: 'snow', mode: '2v2', dailySeed: 20261028 });
  const configured = await guest.state(m => m.type === 'state' && m.mode === '2v2');
  assert.equal(configured.map, 'snow'); assert.equal(configured.dailySeed, 20261028);
  assert.deepEqual(configured.teams, [[0, 1], [2, 3]]);

  host.send({ type: 'ready', ready: true, legend: '学霸' });
  const drafting = await guest.state(m => m.type === 'state' && m.ready[0]);
  assert.deepEqual(drafting.legend, ['学霸', '', '', '']);
  assert.equal(drafting.started, false); assert.equal(drafting.countdown, 0);
  guest.send({ type: 'ready', ready: true, legend: '体育生' });
  const countdown = await host.state(m => m.type === 'state' && m.countdown > 0 && m.countdown <= 3);
  assert.deepEqual(countdown.legend, ['学霸', '体育生', '', '']);
  const started = await host.state(m => m.type === 'state' && m.started, 4000);
  assert.equal(started.state.map, 'snow');
  assert.equal(started.state.players[0].legend, '学霸');
  assert.equal(started.state.players[1].legend, '体育生');
  assert.deepEqual(started.state.ai, [false, false, true, true], 'empty seats are AI');
});

test('unready cancels countdown and non-host cannot start or configure', async t => {
  const { connect } = await fixture(t);
  const host = await connect({ type: 'create' });
  const guest = await connect({ type: 'join', code: (await host.joined).code });
  guest.send({ type: 'start' });
  assert.match((await guest.state(m => m.type === 'error')).error, /only host/);
  guest.send({ type: 'room', map: 'dorm' });
  assert.match((await guest.state(m => m.type === 'error' && m.error.includes('configure'))).error, /only host/);
  host.send({ type: 'ready', ready: true, legend: '班干部' });
  guest.send({ type: 'ready', ready: true, legend: '后进生' });
  await host.state(m => m.type === 'state' && m.countdown > 0);
  guest.send({ type: 'ready', ready: false, legend: '后进生' });
  await host.state(m => m.type === 'state' && m.countdown === 0);
  await new Promise(resolve => setTimeout(resolve, 3100));
  assert.equal(host.messages.some(m => m.type === 'state' && m.started), false);
});

test('rejects malformed action numbers, targets, radio boost and room options', async t => {
  const { connect } = await fixture(t);
  const host = await connect({ type: 'create' });
  const created = await host.joined;
  host.send({ type: 'room', mode: '2v2', dailySeed: 'today' });
  await host.state(m => m.type === 'error' && m.error === 'invalid daily seed');
  host.send({ type: 'start' });
  await host.state(m => m.type === 'state' && m.started);
  for (const [action, args, message] of [
    ['dispatch', { from: '0', to: 1, ratio: .5 }, 'invalid dispatch arguments'],
    ['skill', { target: '0' }, 'invalid skill target'],
    ['useItem', { index: -1 }, 'invalid item arguments'],
    ['ally', { target: 0 }, 'unknown action'],
    ['radio', { boost: 'true' }, 'invalid radio boost'],
    ['radio', { boost: false, target: 99 }, 'invalid radio target'],
  ]) {
    host.clear(); host.send({ type: 'action', action, args });
    assert.equal((await host.state(m => m.type === 'error')).error, message);
    assert.equal(host.messages.some(m => m.type === 'result'), false);
  }
});

test('empty rooms stop advancing and expire after their TTL', async t => {
  const { connect, url } = await fixture(t, 120);
  const host = await connect({ type: 'create' });
  const created = await host.joined;
  host.send({ type: 'start' });
  await host.state(m => m.type === 'state' && m.started);
  await host.close();
  const frozen = await new Promise<any>((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'join', code: created.code, session: created.session })));
    ws.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (mStarted(msg)) { ws.close(); resolve(msg); }
    });
    ws.on('error', reject);
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  const replacement = await connect({ type: 'join', code: created.code, session: created.session });
  const resumed = await replacement.state(m => m.type === 'state' && m.started);
  assert.ok(resumed.state.tick - frozen.state.tick <= 1, 'empty game advanced beyond the queued close-handshake tick');
  const other = await connect({ type: 'create' });
  const empty = await other.joined;
  await other.close();
  await new Promise(resolve => setTimeout(resolve, 250));
  const expired = new Client(url, { type: 'join', code: empty.code });
  expired.joined.catch(() => {});
  t.after(() => { if (expired.ws.readyState !== WebSocket.CLOSED) expired.ws.terminate(); });
  await expired.state(m => m.type === 'error' && m.error === 'room not found');
  expired.ws.terminate();
});

function mStarted(msg: any) { return msg.type === 'state' && msg.started; }
