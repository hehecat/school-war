import type { MapId } from './core';

export type NetMessage = { type: string; [key: string]: any };
export type NetStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
type Handler = (message: NetMessage) => void;
type Socket = Pick<WebSocket, 'readyState' | 'send' | 'close' | 'onopen' | 'onmessage' | 'onclose' | 'onerror'>;
export type WebSocketFactory = (url: string) => Socket;

/** WebSocket transport only: the server owns and advances the Game. */
export class NetClient {
  room = '';
  owner = -1;
  session = '';
  state: any = null;
  status: NetStatus = 'idle';
  onMessage: Handler = () => {};
  onState: Handler = () => {};
  onResult: Handler = () => {};
  onOpen: Handler = () => {};
  onClose: Handler = () => {};
  onStatus: (status: NetStatus) => void = () => {};
  private ws?: Socket;
  private pending?: { type: 'create' | 'join'; code?: string };
  private queue: object[] = [];
  private retry = 0;
  private reconnect?: ReturnType<typeof setTimeout>;
  private closing = false;

  constructor(
    private url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${((import.meta as any).env?.BASE_URL || '/').replace(/\/$/, '')}/ws`,
    private createSocket: WebSocketFactory = url => new WebSocket(url),
  ) {}

  create() {
    this.session = ''; this.room = ''; this.owner = -1; this.queue = [];
    this.pending = { type: 'create' };
    this.restart();
  }

  join(code: string, session?: string) {
    code = code.toUpperCase();
    if (code !== this.room) { this.session = ''; this.room = ''; this.owner = -1; this.queue = []; }
    this.session = session ?? this.session;
    this.pending = { type: 'join', code };
    this.restart();
  }

  ready(legend = '学霸', map: MapId = 'main', mode?: string) { return this.send({ type: 'start', map, legend, mode }, true); }
  start(map: MapId = 'main', legend?: string) { return this.ready(legend, map); }
  action(action: string, args: Record<string, unknown> = {}) { return this.send({ type: 'action', action, args }); }
  dispatch(from: number, to: number, ratio = .5) { return this.action('dispatch', { from, to, ratio }); }
  skill(target?: number) { return this.action('skill', { target }); }
  useItem(index: number, target?: number) { return this.action('useItem', { index, target }); }
  playCards(suit: string) { return this.action('playCards', { suit }); }
  register(cellId: number) { return this.action('register', { cellId }); }
  rebuild(cellId: number) { return this.action('rebuild', { cellId }); }
  retreat(unitId: number) { return this.action('retreat', { unitId }); }
  battleRetreat() { return this.action('battleRetreat'); }

  close() {
    this.closing = true; this.queue = [];
    clearTimeout(this.reconnect); this.ws?.close();
    this.setStatus('closed');
  }

  private setStatus(status: NetStatus) { this.status = status; this.onStatus(status); }

  private restart() {
    clearTimeout(this.reconnect); this.reconnect = undefined;
    this.ws?.close(); this.ws = undefined;
    this.connect();
  }

  private connect() {
    if (!this.pending || this.closing) return;
    if (this.ws && this.ws.readyState < 2) return;
    const ws = this.createSocket(this.url);
    this.ws = ws;
    this.setStatus(this.retry ? 'reconnecting' : 'connecting');
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.retry = 0;
      ws.send(JSON.stringify({ ...this.pending!, session: this.session || undefined }));
      this.setStatus('open');
      this.onOpen({ type: 'open' });
      for (const message of this.queue.splice(0)) ws.send(JSON.stringify(message));
    };
    ws.onmessage = event => {
      if (this.ws !== ws) return;
      let message: NetMessage;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.type === 'joined') { this.room = message.code; this.owner = message.owner; this.session = message.session; }
      if (message.type === 'state') { this.state = message.state; this.onState(message); }
      if (message.type === 'result') this.onResult(message);
      this.onMessage(message);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.onClose({ type: 'close' });
      if (!this.closing && this.pending) {
        this.setStatus('reconnecting');
        this.reconnect ||= setTimeout(() => { this.reconnect = undefined; this.connect(); }, Math.min(5000, 250 * 2 ** this.retry++));
      }
    };
    ws.onerror = () => {};
  }

  send(message: object, reliable = false) {
    if (this.ws?.readyState === 1) { this.ws.send(JSON.stringify(message)); return true; }
    if (!reliable || this.closing) return false;
    if (this.queue.length === 32) this.queue.shift();
    this.queue.push(message);
    return true;
  }
}
