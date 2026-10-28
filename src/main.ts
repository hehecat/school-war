import './style.css';
import { Game, BASE_RATE, FACTIONS, type MapId } from './core';
import { NetClient } from './net';
import { CampusScene } from './scene';

const icons: Record<string, string> = {
  school: '<path d="m3 10 9-6 9 6-9 6z"/><path d="M7 12v6c3 3 7 3 10 0v-6M21 10v7"/>',
  volume: '<path d="m11 5-6 4H2v6h3l6 4zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
  mute: '<path d="m11 5-6 4H2v6h3l6 4zM17 9l5 6m0-6-5 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1-1.5 2M12 17h.01"/>',
  pause: '<path d="M8 5v14M16 5v14"/>', play: '<path d="m7 4 14 8-14 8z"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  flag: '<path d="M5 21V4m0 0h12l-3 4 3 4H5"/>', plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  cursor: '<path d="m4 3 6 18 3-7 7-3z"/>', target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  cards: '<rect x="6" y="3" width="13" height="18" rx="2"/><path d="m6 6-3 1v13h11"/>', bag: '<path d="M5 8h14l1 13H4zM9 8V5a3 3 0 0 1 6 0v3"/>',
  feed: '<path d="M4 5h16v12H9l-5 4zM8 9h8M8 13h5"/>', book: '<path d="m3 5 9 4 9-4-9-4zM3 10l9 4 9-4M3 15l9 4 9-4"/>',
  run: '<circle cx="14" cy="4" r="2"/><path d="m8 21 3-7-3-3 3-5 4 4h4M5 13l3-2M13 14l4 7"/>',
  medal: '<circle cx="12" cy="15" r="6"/><path d="m8 10-3-8h5l2 6 2-6h5l-3 8M12 12v6M9 15h6"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-3-5.5 3 1-6.2L3 9.6l6.2-.9z"/>',
  transfer: '<path d="M4 7h13l-3-3m3 3-3 3M20 17H7l3 3m-3-3 3-3"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>', home: '<path d="m3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/>', refresh: '<path d="M20 7v5h-5M4 17v-5h5M19 12a7 7 0 0 0-12-5L4 10M5 12a7 7 0 0 0 12 5l3-3"/>'
};
const icon = (name: string) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.star}</svg>`;
const suitNames: Record<string, string> = { heart: '红桃', spade: '黑桃', diamond: '方块', club: '梅花' };
const suitSymbols: Record<string, string> = { heart: '♥', spade: '♠', diamond: '♦', club: '♣' };
const suitColors: Record<string, string> = { heart: '#bd7770', spade: '#6f7d79', diamond: '#ba984f', club: '#799465' };
const suitEffects: Record<string, string> = { heart: '全军恢复兵力', spade: '驻军上限提升', diamond: '出兵速度提升', club: '梅花减速领域' };
const legends = [
  { id: '学霸', icon: 'book', desc: '技能冷却 −25%' }, { id: '体育生', icon: 'run', desc: '兵团移速 +15%' },
 { id: '后进生', icon: 'star', desc: '落后时出兵 +30%' },
  { id: '转校生', icon: 'transfer', desc: '开局额外 8 兵' }
];
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<header class="topbar"><div class="brand"><div class="brand-mark">${icon('school')}</div><div><h1>校园战争</h1><p>CAMPUS WAR · REMASTERED</p></div></div><div class="top-divider"></div><div class="room-label"><i class="live-dot"></i> 本地对战 · 3 位 AI 同学</div><div class="top-spacer"></div><div class="top-actions"><button class="icon-btn" id="sound" aria-label="切换声音">${icon('volume')}</button><button class="icon-btn" id="help" aria-label="游戏指南">${icon('help')}</button><button class="text-btn" id="pause">${icon('pause')} 暂停</button></div></header>
<main class="game-shell"><section class="match-row"><div><div class="eyebrow">${icon('flag')} 四人混战 · 占领校园</div><h2 class="match-title">课间十分钟，校园是我的。</h2></div><div class="match-meta"><div class="map-chip" id="map-label">${icon('map')} 主教学区 <span>16 × 16</span></div><div class="timer"><strong id="timer">08:00</strong><span>剩余时间</span></div></div></section>
<div class="layout"><section class="board-column"><div class="board-wrap"><div id="scene" aria-label="校园战场，拖拽己方格子向目标派兵" tabindex="0"></div><div class="board-top"><div class="board-tag">${icon('map')} 主教学区 <span>/ 秋季学期</span></div><div class="season-tag" id="floor-controls"></div></div><div class="event-banner" id="event"></div><div class="view-controls"><button id="zoom-in" aria-label="放大">${icon('plus')}</button><button id="zoom-out" aria-label="缩小">${icon('minus')}</button><button id="home" aria-label="回到基地">${icon('home')}</button></div><div class="map-legend"><span class="legend-item"><i class="legend-dot" style="background:#c0cca7"></i>中立</span><span class="legend-item"><span class="legend-symbol" style="color:#b39245">♦</span>双倍产出</span><span class="legend-item"><span class="legend-symbol" style="color:#bd7770">♥</span>恢复</span><span class="legend-item"><span class="legend-symbol" style="color:#6f7d79">♠</span>扩容</span></div><div class="hint" id="hint"></div><div class="compass"><span>N</span></div><div class="paused-overlay hidden" id="paused"><div><strong>课间休息</strong><span>点击「继续」回到战场</span></div></div></div><div class="scoreboard" id="scoreboard"></div></section>
<aside class="side"><section class="panel"><div class="panel-heading"><div class="panel-title">${icon('target')} 作战指挥</div><span class="panel-caption" id="ratio-caption">50% 派兵</span></div><div id="selection"></div><div class="ratio-label"><span>投入兵力</span><span>1 / 2 / 3 快捷切换</span></div><div class="ratios"><button class="ratio" data-ratio="0.25">25%</button><button class="ratio selected" data-ratio="0.5">50%</button><button class="ratio" data-ratio="1">100%</button></div><p class="dispatch-hint">从己方格拖到目标格 = 派兵，也可点两下。<br>在空白处拖出方框 = 框选多格，再点目标格一起出击。<br>移动视野：右键拖动、WASD / 方向键、滚轮。</p><button class="action-btn hidden" id="register" style="width:100%;margin-top:8px">${icon('flag')} 登记中立格</button><button class="action-btn hidden" id="rebuild" style="width:100%;margin-top:8px">${icon('home')} 在中立格重建</button></section>
<section class="panel"><div class="panel-heading"><div class="panel-title">${icon('cards')} 校园手牌</div><span class="panel-caption">同花色 2 张可打出</span></div><div class="cards-list" id="cards"></div></section>
<section class="panel"><div class="panel-heading"><div class="panel-title">${icon('bag')} 随身道具</div><span class="panel-caption" id="bag-count">背包 0 / 2</span></div><div class="item-slots" id="items"></div></section>
<section class="panel feed-panel"><div class="panel-heading"><div class="panel-title">${icon('feed')} 校园广播</div><span class="panel-caption">LIVE</span></div><div class="feed" id="feed"></div></section></aside></div>
<footer class="bottom-strip"><div class="shortcuts"><span><i class="key">拖拽己方格</i>派兵</span><span><i class="key">空白处拖框</i>多格出击</span><span><i class="key">右键拖动</i>移动视野</span><span><i class="key">Space</i>定位基地</span><span><i class="key">P</i>暂停</span></div><span class="version">v0.6 · 左键派兵/框选 · 右键移动视野</span></footer></main><div class="toast" id="toast" role="status"></div><div id="modal-root"></div>`;

let game: Game;
let scene: CampusScene;
let human = 0;
let ratio = .5;
let selected = -1;
let map: MapId = 'main';
let mode: 'ffa' | '2v2' = 'ffa';
const maps: [MapId, string][] = [['main', '主教学区'], ['dorm', '三层宿舍楼'], ['canteen', '食堂 · 拥堵'], ['blackout', '停电夜自习'], ['sports', '运动会 · 接力'], ['lab', '实验楼 · 毒区'], ['hill', '后山废弃校区'], ['exam', '考场 · 静默'], ['snow', '雪天']];
let net: NetClient | null = null;
let resuming = false;
const networkGame = () => {
  game = Game.fromJSON(net!.state); map = game.map; mode = game.mode; game.human = net!.owner; human = net!.owner;
  $('.room-label').textContent = `房间 ${net!.room} · ${maps.find(([id]) => id === map)?.[1] || map}${resuming ? ' · 已恢复连接' : ''}`;
  if (!scene) { scene = new CampusScene($('#scene'), game); bindScene(); }
  else scene.game = game;
  (window as any).campusGame = game; // 调试/自动化用钩子
  renderUI();
};
let muted = false;
let audio: AudioContext | undefined;
let lastTime = performance.now();
let lastRender = 0;
let logs: { time: number; text: string }[] = [];
let toastTimer = 0;
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;

const cellName = (id: number) => { const c = game.cells[id]; if (!c) return '目标格'; return `${c.base ? '基地' : '校园'}${String.fromCharCode(65 + c.y)}${c.x + 1}`; };
function toast(text: string) { $('#toast').textContent = text; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = window.setTimeout(() => $('#toast').classList.remove('show'), 2400); }
function sound(freq = 400, duration = .07) { if (muted) return; audio ||= new AudioContext(); const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = freq; o.type = 'sine'; g.gain.setValueAtTime(.035, audio.currentTime); g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration); o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + duration); }
function timeText(t: number) { return `${Math.floor(t / 60).toString().padStart(2, '0')}:${Math.floor(t % 60).toString().padStart(2, '0')}`; }
function addLog(text: string) { logs.unshift({ time: game?.time || 0, text }); logs = logs.slice(0, 6); }
function joinOnline(code?: string) {
  net?.close(); net = new NetClient();
  net.onMessage = msg => {
    if (msg.type === 'joined') { localStorage.setItem('campus-session', msg.session); localStorage.setItem('campus-room', msg.code); human = msg.owner; toast(`房间 ${msg.code} · ${FACTIONS[human].name}`); }
    if (msg.type === 'state') {
      if (human !== 0 || msg.started) { map = msg.map || 'main'; mode = msg.mode || 'ffa'; }
      if (msg.state) { $('.modal-backdrop')?.remove(); if (scene?.game.map !== msg.map) { scene?.destroy(); scene = undefined!; } networkGame(); }
      else if ($('#room-roster') && $('#online-start')) { $('#room-roster').textContent = msg.players.map((p: boolean, i: number) => `${FACTIONS[i].name}${p ? (msg.ready?.[i] ? ' ✓' : ' 等待') : ' · AI'}`).join('  '); $('#online-start').textContent = msg.countdown > 0 ? `开局倒计时 ${Math.ceil(msg.countdown)}` : msg.ready?.[human] ? '已准备，等待其他玩家' : '选择地图并准备'; }
    }
    if (msg.type === 'error') toast(msg.error);
    if (msg.type === 'result' && !msg.ok) toast('该操作未执行');
  };
  net.onStatus = status => { if (status === 'reconnecting') toast('连接中断，正在重连…'); if (status === 'open') toast('已连接校园战场'); };
  if (!code && localStorage.getItem('campus-room') && localStorage.getItem('campus-session')) { code = localStorage.getItem('campus-room')!; }
  if (code) { resuming = !!localStorage.getItem('campus-session'); net.join(code, localStorage.getItem('campus-session') || undefined); } else net.create();
  const box = document.createElement('div'); box.className = 'modal-backdrop'; box.innerHTML = `<div class="modal" style="text-align:center"><div class="eyebrow">联机大厅</div><h2>房间已创建</h2><p>邀请同学输入房间码 · 所有在线玩家准备后开局</p><div id="room-roster"></div><div id="room-code" style="font-size:36px;font-weight:900;letter-spacing:8px;margin:24px">······</div><button class="start-btn" id="online-start">选择地图并准备</button><button class="text-btn" id="online-back" style="margin:15px auto">返回</button></div>`;
  document.body.append(box);
  const timer = setInterval(() => { if (!net || !document.body.contains(box)) return clearInterval(timer); $('#room-code').textContent = net.room || '······'; }, 100);
  $('#online-start').onclick = () => { box.remove(); showStart(); };
  $('#online-back').onclick = () => { net?.close(); net = null; localStorage.removeItem('campus-room'); localStorage.removeItem('campus-session'); box.remove(); showStart(); };
}

function showStart(helpOnly = false) {
  if (game) game.paused = true;
  const legendId = (game as any)?.players?.[human]?.legend || '学霸';
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="开始游戏"><div class="modal-eyebrow">A LITTLE CAMPUS. A BIG WAR.</div><h2>${helpOnly ? '同学，欢迎来到战场。' : '新学期，地盘重新划分。'}</h2><p class="modal-sub">拖拽派兵，占领校园。地盘越大，出兵越快。<br>8 分钟后占格最多的社团获胜，也可以选择占领 60% 校园速胜。</p><div class="tutorial"><div class="tutorial-step"><b>01 / 选择</b><p>点击你的格子，选择投入 25%、50% 或全部兵力。</p></div><div class="tutorial-step"><b>02 / 出发</b><p>按住己方格拖到目标格（也可点两下），兵团会自动寻路、交战与占领。在空白处拖框可框选多格同时出击。</p></div><div class="tutorial-step"><b>03 / 翻盘</b><p>收集花色牌与道具，利用事件，抓住反击时机。</p></div></div><div class="panel-heading"><div class="panel-title">选择一条校园传说</div><span class="panel-caption">所有社团从同一池选择</span></div><div class="legend-grid">${legends.map(l => `<button class="legend-choice ${legendId === l.id ? 'selected' : ''}" data-legend="${l.id}">${icon(l.icon)}<strong>${l.id}</strong><small>${l.desc}</small></button>`).join('')}</div><div class="panel-caption">你的社团</div><div class="faction-options">${FACTIONS.map((f, i) => `<button class="faction-option ${i === human ? 'selected' : ''}" data-faction="${i}" style="color:${f.color}">${f.name}</button>`).join('')}</div><button class="primary-btn" id="start">${helpOnly ? '明白了，回到战场' : '进入校园'} ${icon('arrow')}</button><div class="faction-options"><button class="faction-option ${mode === 'ffa' ? 'selected' : ''}" data-mode="ffa">四人混战</button><button class="faction-option ${mode === '2v2' ? 'selected' : ''}" data-mode="2v2">组队 2v2</button></div><div class="faction-options">${maps.map(([id, name]) => `<button class="map-option ${map === id ? 'selected' : ''}" data-map="${id}">${name}</button>`).join('')}</div><p class="modal-footer-note">单人对 AI · 所有进度仅保留在本局 · 无需登录</p>${helpOnly ? '' : '<div style="display:flex;gap:8px;justify-content:center;margin-top:14px"><button class="text-btn" id="online">创建联机房间</button><button class="text-btn" id="join">输入房间码</button></div>'}</section></div>`;
  document.querySelectorAll<HTMLButtonElement>('[data-legend]').forEach(b => b.onclick = () => { document.querySelectorAll('[data-legend]').forEach(x => x.classList.remove('selected')); b.classList.add('selected'); });
  document.querySelectorAll<HTMLButtonElement>('[data-faction]').forEach(b => b.onclick = () => {
    if (!helpOnly) { human = Number(b.dataset.faction); document.querySelectorAll<HTMLButtonElement>('[data-faction]').forEach(x => x.classList.remove('selected')); b.classList.add('selected'); }
  });
  document.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(b => b.onclick = () => { if (!helpOnly) { map = b.dataset.map as MapId; document.querySelectorAll('[data-map]').forEach(x => x.classList.remove('selected')); b.classList.add('selected'); } });
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode as 'ffa' | '2v2'; document.querySelectorAll('[data-mode]').forEach(x => x.classList.remove('selected')); b.classList.add('selected'); });
  const online = $('#online'); if (online) online.onclick = () => { $('#modal-root').innerHTML = ''; joinOnline(); };
  const join = $('#join'); if (join) join.onclick = () => { $('#modal-root').innerHTML = '<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><h2>加入校园战场</h2><p class="modal-sub">输入同学分享的 6 位房间码</p><input id="room-input" class="room-input" maxlength="6" autocomplete="off" placeholder="例如 ABC123" aria-label="房间码"><div class="faction-options"><button class="primary-btn" id="join-go">加入房间</button><button class="text-btn" id="join-cancel">返回</button></div></section></div>'; $('#room-input').focus(); $('#join-go').onclick = () => { const code = ($('#room-input') as HTMLInputElement).value.trim().toUpperCase(); if (/^[A-Z0-9]{6}$/.test(code)) { $('#modal-root').innerHTML = ''; joinOnline(code); } else toast('请输入 6 位房间码'); }; $('#join-cancel').onclick = () => showStart(); };
  $('#start').onclick = () => { if (net) { if (human === 0) net.send({ type: 'configure', map, mode }, true); net.send({ type: 'ready', ready: true, legend: document.querySelector<HTMLButtonElement>('[data-legend].selected')?.dataset.legend || '学霸' }, true); $('#modal-root').innerHTML = ''; toast('已准备，等待其他玩家'); return; } const l = document.querySelector<HTMLButtonElement>('[data-legend].selected')?.dataset.legend || '学霸'; if (helpOnly && game) { game.setLegend(human, l); game.paused = false; } else startGame(l); $('#modal-root').innerHTML = ''; sound(520, .1); };
}
function startGame(legend: string) {
  net?.close(); net = null; resuming = false; localStorage.removeItem('campus-room'); localStorage.removeItem('campus-session');
  $('.room-label').textContent = '本地对战 · 3 位 AI 同学';
  game = new Game({ ai: [0, 1, 2, 3].map(i => i !== human), map, mode });
  $('#floor-controls').innerHTML = '';
  (window as any).campusGame = game; // 调试/自动化用钩子
  game.human = human; game.setLegend(human, legend); game.paused = false;
  selected = -1; logs = []; scene?.destroy(); $('#scene').innerHTML = '';
  scene = new CampusScene($('#scene'), game);
  (window as any).campusScene = scene; // 调试/自动化用钩子
  bindScene();
  setTimeout(() => {
    scene?.focusBase(); // 开局把镜头拉到自家基地
    toast(`你是 ${FACTIONS[human as 0 | 1 | 2 | 3].name}：点自己的格子，再点目标格出兵`);
    addLog(`你是 ${FACTIONS[human as 0 | 1 | 2 | 3].name}，地盘在标记为「你」的那一角`);
  }, 80);
}
function bindScene() {
  scene.onSelect = id => {
    selected = id; renderUI();
    if (id < 0 || !game) return;
    const c = game.cells[id];
    if (c.owner >= 0 && c.owner !== human) toast(`这是${FACTIONS[c.owner as 0 | 1 | 2 | 3].name}的地盘，只能从自己的格子派兵`);
  };
  scene.onDispatchMulti = (sources, to) => {
    if (net) { for (const from of sources) net.action('dispatch', { from, to, ratio }); sound(290); toast(`框选 ${sources.length} 格 → ${cellName(to)}`); return; }
    let sent = 0, moved = 0;
    for (const from of sources) { const u = game.dispatch(from, to, ratio, human); if (u) { sent++; moved += u.troops; } }
    if (sent) { sound(290); selected = sources[0]; toast(`框选 ${sent} 格 共 ${Math.floor(moved)} 兵 → ${cellName(to)}`); }
    else toast('框选的格子里没有可派的兵');
  };
  scene.onDispatch = (from, to) => {
    if (net) {
      if (net.action('dispatch', { from, to, ratio })) { sound(290); selected = from; toast(`已派出 → ${cellName(to)}`); }
      else toast('无法派兵：请选择有驻军的己方格子');
      return;
    }
    const unit = game.dispatch(from, to, ratio, human);
    if (unit) { sound(290); selected = from; toast(`已从 ${cellName(from)} 派出 ${Math.floor(unit.troops)} 兵 → ${cellName(to)}`); }
    else toast('无法派兵：请选择有驻军的己方格子');
  };
  game.onCapture = (capturer: number, oldOwner: number, cell: any, troops: number) => { if (capturer === human || oldOwner === human) { const text = oldOwner === human ? `${FACTIONS[capturer as 0 | 1 | 2 | 3].name} · ${Math.floor(troops)} 兵夺走了你的格子` : `你占领了${cell.type === 'shop' ? '小卖部' : '新格子'}！`; toast(text); addLog(text); sound(capturer === human ? 620 : 160, .12); } };
  game.onNotice = (text: string, kind: string) => { if (text.startsWith('EXILE_LOCATE:')) { const id = Number(text.split(':')[1]); if (id >= 0) { scene.floor = game.cells[id].floor; selected = id; scene.selected = id; toast('已定位可重建的中立格'); } } else { addLog(text); if (kind === 'warning') sound(760, .08); } };
  addLog('校园战争开始，向操场进发！'); lastTime = performance.now(); renderUI();
}
function renderUI() {
  if (!game) return;
  const p = game.players[human]; const remain = Math.max(0, 480 - game.time);
  $('#timer').textContent = timeText(remain);
  $('#map-label').innerHTML = `${icon('map')} ${maps.find(([id]) => id === game.map)?.[1]} <span>${game.floors} × ${game.size} × ${game.size}</span>`;
  if (!$('[data-floor]')) {
    $('#floor-controls').innerHTML = game.map === 'dorm' ? Array.from({length: game.floors}, (_, f) => f).map(f => `<button class="floor-btn" data-floor="${f}">${f + 1}F ${f ? '透视下层' : '当前层'}</button>`).join('') : '';
    document.querySelectorAll<HTMLButtonElement>('[data-floor]').forEach(b => b.onclick = () => { scene.floor = Number(b.dataset.floor); selected = -1; scene.selected = -1; renderUI(); });
  }
  document.querySelectorAll('[data-floor]').forEach(b => b.classList.toggle('selected', scene.floor === Number((b as HTMLElement).dataset.floor)));
  $('#pause').innerHTML = `${icon(game.paused ? 'play' : 'pause')} ${game.paused ? '继续' : '暂停'}`;
  $('#paused').classList.toggle('hidden', !game.paused);
  $('#scoreboard').innerHTML = game.players.map((pl: any, i: number) => `<div class="score ${i === human ? 'active' : ''}"><div class="faction-mark" style="background:${FACTIONS[i].color}">${FACTIONS[i].name[0]}</div><div class="score-text"><div class="score-name">${FACTIONS[i].name}${pl.legend ? ` · ${pl.legend}` : ''}${i === human ? '<span class="you">你</span>' : ''}</div><div class="score-stat"><b>${pl.tiles}</b> 格 · ${Math.floor(pl.troops)} 兵 · ${Object.keys(suitNames).map(s => `${suitSymbols[s]}${pl.cards[s]}`).join(' ')}</div></div><span class="score-rank">${pl.tiles ? '活跃' : '流亡'}</span></div>`).join('');
  const c = game.cells[selected];
  const eventPreview = game.currentEvent;
  const ownerFaction = c && c.owner >= 0 ? FACTIONS[c.owner as 0 | 1 | 2 | 3] : null;
  $('#selection').innerHTML = !c ? `<div class="selection-empty"><div class="select-illustration">${icon('cursor')}</div>选择己方格子<br>开始你的第一步</div>` : `<div class="selection-name"><strong>${c.base ? '社团基地' : c.type === 'shop' ? '校园小卖部' : c.type === 'obstacle' ? '教学楼' : `校园 ${String.fromCharCode(65 + c.y)}${c.x + 1}`}</strong><span class="owner-pill" style="color:${ownerFaction?.color || '#899087'}">${ownerFaction?.name || '中立'}</span></div><div class="cell-detail"><span>${suitNames[c.type] ? suitNames[c.type] + '格 · ' : ''}${c.type === 'diamond' ? '产出 ×2' : c.type === 'heart' ? '每 3 秒恢复 1 兵' : c.type === 'spade' ? '驻军上限 +10' : c.type === 'club' ? '进入后减速' : c.type === 'shop' ? '每 60 秒刷新道具' : '普通区域'}${c.owner >= 0 ? ` · 产出 +${(BASE_RATE * FACTIONS[c.owner as 0 | 1 | 2 | 3].production).toFixed(2)} 兵/秒` : ''}</span><span>${c.x + 1}, ${c.y + 1}</span></div><div class="troop-number">${Math.floor(c.troops)}<small>/ ${c.type === 'spade' ? 30 : 20} 驻军</small></div>${c.owner === human ? '<p class="select-hint">已选中这个出兵格 · 点目标格出击，或直接拖过去</p>' : ''}`;
  $('#register').classList.toggle('hidden', human !== 3 || p.exiled);
  $('#rebuild').classList.toggle('hidden', !p.exiled);
  $('#event').textContent = c?.type === 'radio' && c.owner === human ? `广播站：${game.time - game.radioCapture.since >= 6 ? '读条完成，二选一' : '读条中 ' + Math.max(0, Math.ceil(6 - game.time + game.radioCapture.since)) + '秒'}${game.radioCapture.since >= 0 && game.time - game.radioCapture.since >= 6 ? ' · 点击增益 / 干扰' : ''}` : (game.currentEvent ? `${game.currentEvent.name} · ${Math.max(0, Math.ceil(game.currentEvent.time - game.time))} 秒` : game.radioUntil > game.time ? '广播增益生效中' : '校园广播站将在第 4 分钟开放');
  $('#selection').ondblclick = () => {
    if (!c) return;
    const ok = net ? net.action(c.type === 'obstacle' ? 'sealBuilding' : 'demolish', { cellId: selected }) : c.type === 'obstacle' ? game.sealBuilding(human, selected) : game.demolish(selected);
    if (ok) toast(c.type === 'obstacle' ? '教学楼封闭30秒，兵团重新寻路' : '中央围墙已拆除');
  };
  $('#event').onclick = () => {
    if (c?.type !== 'radio' || c.owner !== human || game.radioCapture.owner !== human || game.time - game.radioCapture.since < 6) return;
    const boost = confirm('确定：己方移速 +30%；取消：干扰敌方 -30%');
    const target = boost ? -1 : Number(prompt('干扰目标：0 紫 / 1 黄 / 2 绿 / 3 黑', String((human + 1) % 4)));
    const ok = net ? net.action('radio', { boost, target }) : game.chooseRadio(human, boost, target);
    if (!ok) toast('广播站指令未执行');
  };
  $('#cards').innerHTML = Object.keys(suitNames).map(s => `<div class="mini-card ${p.cards[s] >= 2 ? 'playable' : ''}" data-suit="${s}" title="${p.cards[s] >= 2 ? '点击打出同花色手牌' : '占领新的花色格抽牌'}"><span class="mini-suit" style="color:${suitColors[s]}">${suitSymbols[s]}</span><div class="mini-card-info"><div class="mini-card-name">${suitNames[s]}</div><div class="mini-card-effect">${suitEffects[s]}</div></div><span class="card-count">× ${p.cards[s]}</span></div>`).join('');
  document.querySelectorAll<HTMLButtonElement>('[data-suit]').forEach(b => b.onclick = () => { const s = b.dataset.suit!; if (p.cards[s] >= 2) { const ok = net ? net.action('playCards', { suit: s }) : game.playCards(human, s as 'heart' | 'spade' | 'diamond' | 'club'); if (ok) { sound(700); toast(`打出${p.cards[s]} 张${suitNames[s]}，增益生效`); } else toast('指令未执行，请检查连接与手牌'); } });
  const items = p.items || [];
  $('#bag-count').textContent = `背包 ${items.length} / 2`;
  $('#items').innerHTML = [0, 1].map(i => `<button class="item" data-item="${i}" ${!items[i] ? 'disabled' : ''}>${icon('bag')} ${items[i] || '空道具位'}</button>`).join('') + '';
  document.querySelectorAll<HTMLButtonElement>('[data-item]').forEach(b => b.onclick = () => {
    const i = Number(b.dataset.item), item = items[i];
    const target = item === '辣条' || item === '请假条' ? game.units.find(u => u.owner === human)?.id : selected;
    if (target === undefined || target < 0) return toast(item === '辣条' || item === '请假条' ? '先派出一支兵团' : '先选择道具目标格');
    if (net ? net.action('useItem', { index: i, target }) : game.useItem(human, i, target)) { sound(540); toast(`${item}已使用`); } else toast('该道具不适用于这个目标');
  });
  $('#feed').innerHTML = logs.map(l => `<div class="feed-entry"><span class="feed-time">${timeText(l.time)}</span><span>${l.text}</span></div>`).join('');
  const ev = (game as any).currentEvent || (game as any).activeEvent || (game as any).event;
  const eventEl = $('#event'); eventEl.classList.remove('active');
  if (ev && ev.time && ev.time > game.time) { eventEl.classList.add('active'); eventEl.innerHTML = `${icon('clock')} ${ev.name || ev.id} <strong>${Math.ceil(ev.time - game.time)}s</strong>`; }
  if (game.over) showEnd();
}
function showEnd() {
  if ($('#end-modal')) return;
  game.paused = true;
  const rank = [...game.players].sort((a: any, b: any) => b.tiles - a.tiles);
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal" id="end-modal"><div class="modal-eyebrow">THE BELL HAS RUNG</div><h2>${game.winner === human ? '校园，现在听你的。' : '下课了，再战一局？'}</h2><p class="modal-sub">${FACTIONS[game.winner ?? 0].name}成为本学期校园霸主。每一次派兵，都是下一次胜利的伏笔。</p><div class="end-stats"><div class="end-stat"><strong>${game.players[human].tiles}</strong><span>最终占地</span></div><div class="end-stat"><strong>${Math.floor(game.players[human].troops)}</strong><span>剩余兵力</span></div><div class="end-stat"><strong>${timeText(game.time)}</strong><span>对局时长</span></div></div><div class="result-rank">${rank.map((p: any) => `<div class="result-row"><span class="faction-mark" style="background:${FACTIONS[p.id].color};width:25px;height:25px;font-size:11px">${FACTIONS[p.id].name[0]}</span>${FACTIONS[p.id].name}${p.id === human ? '（你）' : ''}<b>${p.tiles} 格</b></div>`).join('')}</div><button class="primary-btn" id="restart">再来一局 ${icon('refresh')}</button></section></div>`;
  $('#restart').onclick = () => showStart();
}
$('#pause').onclick = () => { if (net) return toast('联机对局不能暂停'); game.paused = !game.paused; $('#pause').innerHTML = `${icon(game.paused ? 'play' : 'pause')} ${game.paused ? '继续' : '暂停'}`; $('#paused').classList.toggle('hidden', !game.paused); };
$('#help').onclick = () => net ? toast('联机对局进行中：拖拽己方格派兵；右键拖动或 WASD 移动视野。') : showStart(true);
$('#sound').onclick = () => { muted = !muted; $('#sound').innerHTML = icon(muted ? 'mute' : 'volume'); };
$('#home').onclick = () => scene?.focusBase();
$('#zoom-in').onclick = () => { if (scene) { scene.zoom = Math.max(15, scene.zoom - 2); scene.resize(); } };
$('#zoom-out').onclick = () => { if (scene) { scene.zoom = Math.min(34, scene.zoom + 2); scene.resize(); } };
$('#register').onclick = () => { if (selected >= 0 && (net ? net.action('register', { cellId: selected }) : game.register(human, selected))) { toast('相邻中立格已登记'); sound(620); } else toast('请选择相邻中立格；登记每 60 秒可用一次'); };
$('#rebuild').onclick = () => { if (selected >= 0 && (net ? net.action('rebuild', { cellId: selected }) : game.rebuild(human, selected))) toast('重建成功'); else toast('点击一个中立格即可重建'); };
document.querySelectorAll<HTMLButtonElement>('[data-ratio]').forEach(b => b.onclick = () => { ratio = Number(b.dataset.ratio); document.querySelectorAll('[data-ratio]').forEach(x => x.classList.remove('selected')); b.classList.add('selected'); $('#ratio-caption').textContent = `${ratio * 100}% 派兵`; });
window.addEventListener('keydown', e => { if ($('.modal-backdrop') || !game) return; if (['1', '2', '3'].includes(e.key)) document.querySelectorAll<HTMLButtonElement>('[data-ratio]')[Number(e.key) - 1].click(); if (e.code === 'Space') { e.preventDefault(); scene.focusBase(); }
  if (e.key.startsWith('Arrow') || ['w', 'a', 's', 'd'].includes(e.key.toLowerCase())) {
    e.preventDefault(); const step = scene.zoom / 5, k = e.key.toLowerCase();
    if (k === 'arrowright' || k === 'd') scene.pan(step, -step);
    if (k === 'arrowleft' || k === 'a') scene.pan(-step, step);
    if (k === 'arrowup' || k === 'w') scene.pan(step, step);
    if (k === 'arrowdown' || k === 's') scene.pan(-step, -step);
  } if (e.key.toLowerCase() === 'p') $('#pause').click(); if (e.key === 'Escape') { selected = -1; scene.selected = -1; renderUI(); } });
function frame(now: number) {
  const dt = Math.min((now - lastTime) / 1000, .1); lastTime = now;
  if (game && !game.paused && !game.over) if (!net) game.update(dt);
  if (scene && now - lastRender > 100) { scene.selected = selected; scene.render(); renderUI(); lastRender = now; }
  requestAnimationFrame(frame);
}
if (localStorage.getItem('campus-room') && localStorage.getItem('campus-session')) joinOnline();
else showStart();
requestAnimationFrame(frame);
