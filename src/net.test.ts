import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NetClient } from './net';

class FakeSocket {
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  sent: any[] = [];
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.({}); }
  message(data: object) { this.onmessage?.({ data: JSON.stringify(data) }); }
  drop() { this.readyState = 3; this.onclose?.({}); }
}

function client() {
  const sockets: FakeSocket[] = [];
  const net = new NetClient('ws://test', () => { const ws = new FakeSocket(); sockets.push(ws); return ws as any; });
  return { net, sockets };
}

test('actions fail immediately while offline and never queue; reliable controls queue', () => {
  const { net, sockets } = client();
  net.create();
  assert.equal(net.action('skill'), false);
  net.ready('学霸', 'main');
  net.start('dorm', '卷王');
  sockets[0].open();
  assert.deepEqual(sockets[0].sent.slice(1), [
    { type: 'start', map: 'main', legend: '学霸' },
    { type: 'start', map: 'dorm', legend: '卷王' },
  ]);
  assert.equal(net.action('skill'), true);
  assert.deepEqual(sockets[0].sent.at(-1), { type: 'action', action: 'skill', args: {} });
});

test('join only reuses a session for the same room and drops stale controls across rooms', () => {
  const { net, sockets } = client();
  net.join('ROOM1'); sockets[0].open();
  sockets[0].message({ type: 'joined', code: 'ROOM1', owner: 0, session: 'one' });
  net.ready(); sockets[0].drop();
  net.join('ROOM1'); sockets[1].open();
  assert.equal(sockets[1].sent[0].session, 'one');
  assert.equal(sockets[1].sent.length, 1); // joining an already-open room discards the old start
  net.join('ROOM2', 'wrong'); sockets[2].open();
  assert.equal(sockets[2].sent[0].session, 'wrong');
  assert.equal(sockets[2].sent.length, 1);
  net.ready(); net.create(); sockets[3].open();
  assert.equal(sockets[3].sent[0].session, undefined);
  assert.equal(sockets[3].sent.length, 1);
});

test('control queue is bounded and ignores a stale socket close', () => {
  const { net, sockets } = client();
  net.create();
  for (let i = 0; i < 40; i++) net.ready(`L${i}`);
  sockets[0].open();
  const starts = sockets[0].sent.filter(m => m.type === 'start');
  assert.equal(starts.length, 32);
  assert.equal(starts[0].legend, 'L8');
  assert.equal(starts.at(-1).legend, 'L39');
  const old = sockets[0];
  net.join('OTHER');
  old.drop();
  assert.equal(net.status, 'connecting');
});

test('result and reconnect status are observable', () => {
  const { net, sockets } = client();
  const results: object[] = [], statuses: string[] = [];
  net.onResult = m => results.push(m);
  net.onStatus = s => statuses.push(s);
  net.create(); sockets[0].open();
  sockets[0].message({ type: 'result', ok: false, action: 'dispatch' });
  assert.deepEqual(results, [{ type: 'result', ok: false, action: 'dispatch' }]);
  sockets[0].drop();
  assert.equal(net.status, 'reconnecting');
  assert.ok(statuses.includes('open'));
});
