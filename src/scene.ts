import * as THREE from 'three';
import { Game, FACTIONS } from './core';

export class CampusScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.OrthographicCamera;
  raycaster = new THREE.Raycaster();
  plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.2);
  tileMeshes: THREE.Mesh[] = [];
  unitGroup = new THREE.Group();
  targetRing: THREE.Mesh;
  selectedRing: THREE.Mesh;
  hoverRing: THREE.Mesh;
  decorations: THREE.Group[] = [];
  zoom = 17;
  floor = 0;
  target = new THREE.Vector3(0, 0, 0);
  onSelect: (id: number) => void = () => {};
  onDispatch: (from: number, to: number) => void = () => {};
  pointerDown: { x: number; y: number; cell: number } | null = null;
  private pressAt: { x: number; y: number } | null = null;
  private lastPan: { x: number; y: number } | null = null;
  private panning = false;
  private commandFrom = -1;
  private boxing = false;
  private boxRect: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private boxEl = document.createElement('div');
  private boxRings: THREE.Mesh[] = [];
  /** Shift+左键框选出来的己方格集合。 */
  boxSelect = new Set<number>();
  onDispatchMulti: (sources: number[], to: number) => void = () => {};
  private rightDown = false;
  private rightPanAt = 0;
  selected = -1;
  hovered = -1;
  dragTarget = -1;
  colors = FACTIONS.map(f => f.color);
  private tileGeometry = new THREE.BoxGeometry(.965, .16, .965);
  private decorMeshes: THREE.Mesh[] = [];
  private tileRefs: { mesh: THREE.InstancedMesh; index: number }[] = [];
  private threatGroup = new THREE.Group();
  private crossFloor = new THREE.Group();
  private poisonGroup = new THREE.Group();
  private unitBodyGeometry = new THREE.CylinderGeometry(.055, .075, .16, 5);
  private unitHeadGeometry = new THREE.SphereGeometry(.045, 5, 4);
  private unitBarGeometry = new THREE.PlaneGeometry(.46, .13);
  private unitMaterials = this.colors.map(color => this.material(color));
  private unitHeadMaterial = this.material('#e5ccaa');
  private unitBarMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private effectGeometry = {
    poison: new THREE.CircleGeometry(.39, 20),
    bubble: new THREE.RingGeometry(.045, .075, 10),
    warning: new THREE.RingGeometry(.415, .44, 4),
    arrow: new THREE.ConeGeometry(.14, .35, 4),
  };
  private effectMaterial = {
    poison: new THREE.MeshBasicMaterial({ color: '#8bc72d', transparent: true, opacity: .58, depthTest: false }),
    bubble: new THREE.MeshBasicMaterial({ color: '#e2ff74', side: THREE.DoubleSide, depthTest: false }),
    warning: new THREE.MeshBasicMaterial({ color: '#ff694d', side: THREE.DoubleSide, transparent: true, opacity: .8, depthTest: false }),
    arrow: new THREE.MeshBasicMaterial({ color: '#fff1a8', depthTest: false }),
  };
  private resizeObserver: ResizeObserver;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { distance: number; zoom: number } | null = null;
  private gesture = false;
  private cleanups: (() => void)[] = [];
  private overlay = document.createElement('div');
  private minimap = document.createElement('canvas');
  private minimapCtx: CanvasRenderingContext2D;
  private threatCue = document.createElement('div');
  private threatArrow = document.createElement('div');
  private leader = -1;
  constructor(public container: HTMLElement, public game: Game) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    container.append(this.renderer.domElement);
    this.scene.background = new THREE.Color('#e9ebe0');
    this.scene.fog = new THREE.Fog('#e9ebe0', 35, 70);
    this.zoom = game.map === 'dorm' ? 13 : 17;
    this.camera = new THREE.OrthographicCamera(-20, 20, 15, -15, .1, 100);
    this.camera.position.set(19, 24, 22);
    this.camera.lookAt(this.target);
    this.scene.add(new THREE.HemisphereLight('#fffce8', '#72806b', 2.7));
    const sun = new THREE.DirectionalLight('#fff5db', 3.8);
    this.scene.add(sun.target);
    sun.position.set(-10, 26, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 60 });
    sun.shadow.bias = -.0005;
    this.scene.add(sun);
    const width = this.game.size + 1.8;
    const ground = new THREE.Mesh(new THREE.BoxGeometry(width, .65, width), new THREE.MeshStandardMaterial({ color: '#b7bf9e', roughness: 1 }));
    ground.position.y = -.43; ground.receiveShadow = true; this.scene.add(ground);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(width + .3, .25, width + .3), new THREE.MeshStandardMaterial({ color: '#839379', roughness: 1 }));
    rim.position.y = -.73; this.scene.add(rim);
    this.buildTiles();
    if (this.game.map === 'main') this.buildLandscape();
    this.scene.add(this.unitGroup, this.threatGroup, this.crossFloor, this.poisonGroup);
    this.selectedRing = this.ring('#fffbd8', .49); this.scene.add(this.selectedRing);
    this.hoverRing = this.ring('#ffffff', .48); this.scene.add(this.hoverRing);
    this.targetRing = this.ring('#f6c65b', .48); this.scene.add(this.targetRing);
    this.overlay.className = 'scene-overlay';
    this.overlay.innerHTML = '<div class="scene-minimap"><span>战术小地图</span></div>';
    this.minimap.width = 192; this.minimap.height = 192;
    this.minimap.setAttribute('aria-label', '势力分布小地图；仅领先者显示驻军数字');
    this.overlay.querySelector('.scene-minimap')!.append(this.minimap);
    this.threatCue.className = 'scene-threat';
    this.threatArrow.className = 'scene-threat-arrow';
    this.threatArrow.textContent = '➤';
    this.overlay.append(this.threatCue, this.threatArrow);
    this.boxEl.className = 'select-box'; this.boxEl.style.display = 'none'; this.container.append(this.boxEl);
    container.append(this.overlay);
    this.minimapCtx = this.minimap.getContext('2d')!;
    this.bindPointer();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }
  pos(x: number, y: number, h = 0, floor = this.floor) { return new THREE.Vector3(x - (this.game.size - 1) / 2, h + (this.game.map === 'dorm' ? floor * 1.65 : 0), y - (this.game.size - 1) / 2); }
  ring(color: string, radius: number) {
    const m = new THREE.Mesh(new THREE.RingGeometry(radius - .025, radius, 4), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: .95, depthTest: false }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI / 4; m.renderOrder = 10; m.visible = false; return m;
  }
  material(color: string | number) { return new THREE.MeshStandardMaterial({ color, roughness: .94 }); }
  box(group: THREE.Group, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string | number) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), this.material(color));
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; group.add(m); return m;
  }
  /** 装饰网格也参与拾取，抓建筑就像抓地块。 */
  tagCell(group: any, cellId: number) {
    group?.traverse?.((m: any) => { if (m.isMesh) { m.userData.cell = cellId; this.decorMeshes.push(m); } });
    return group;
  }
  buildTiles() {
    const tile = new THREE.InstancedMesh(this.tileGeometry, this.material('#ced6b7'), this.game.cells.length);
    tile.userData.cells = this.game.cells.map(c => c.id);
    tile.receiveShadow = true;
    for (const cell of this.game.cells) {
      tile.setMatrixAt(cell.id, new THREE.Matrix4().makeTranslation(...this.pos(cell.x, cell.y, .03, cell.floor).toArray()));
      tile.setColorAt(cell.id, new THREE.Color('#ced6b7'));
      this.tileRefs[cell.id] = { mesh: tile, index: cell.id };
      this.tileMeshes[cell.id] = new THREE.Mesh(this.tileGeometry);
      const proxy = this.tileMeshes[cell.id];
      proxy.position.copy(this.pos(cell.x, cell.y, .03, cell.floor));
      proxy.userData.cell = cell.id; proxy.visible = false;
    }
    this.tileMeshes.push(tile); this.scene.add(tile);
    for (const cell of this.game.cells) {
      const g = new THREE.Group(); g.userData.floor = cell.floor; this.scene.add(g);
      if (cell.type === 'obstacle') this.tagCell(this.makeBuilding(cell.x, cell.y), cell.id);
      else if (cell.type === 'shop') this.tagCell(this.makeShop(cell.x, cell.y), cell.id);
      else if (cell.type === 'base') this.tagCell(this.makeBase(cell.x, cell.y), cell.id);
      else if (cell.type === 'wall') this.tagCell(this.makeWall(g, cell.x, cell.y), cell.id);
      else if (cell.type === 'forest') this.tagCell(this.makeForest(g, cell.x, cell.y), cell.id);
      else if (cell.type === 'snow') this.tagCell(this.makeSnow(g, cell.x, cell.y), cell.id);
      else if (cell.type !== 'plain') this.tagCell(this.makeSpecial(cell.x, cell.y, cell.type, cell.floor), cell.id);
    }
  }
  makeBuilding(x: number, y: number) {
    const g = new THREE.Group(); g.position.copy(this.pos(x, y));
    this.box(g, 0, .43, 0, .89, .8, .89, '#d8c7a5');
    this.box(g, 0, .87, 0, .94, .1, .94, '#867e66');
    this.box(g, 0, .99, 0, .6, .16, .6, '#b9a47e');
    for (const side of [-1, 1]) for (const z of [-.23, .17]) this.box(g, side * .452, .49, z, .012, .22, .15, '#788a83');
    for (const z of [-.23, .17]) this.box(g, -.1, .5, .452, .17, .23, .015, '#718b84');
    this.scene.add(g);
  }
  makeBase(x: number, y: number) {
    const g = new THREE.Group(); g.position.copy(this.pos(x, y));
    this.box(g, 0, .19, 0, .72, .22, .72, '#d4c9ab');
    this.box(g, 0, .42, 0, .52, .26, .52, '#e1d7ba');
    this.box(g, 0, .61, 0, .64, .12, .64, '#927655');
    this.box(g, 0, .87, 0, .035, .47, .035, '#625d4d');
    this.box(g, .14, .96, 0, .26, .18, .025, '#ffffff');
    this.scene.add(g); this.decorations.push(g); return g;
  }
  makeShop(x: number, y: number) {
    const g = new THREE.Group(); g.position.copy(this.pos(x, y));
    this.box(g, 0, .27, 0, .72, .4, .63, '#edddbb');
    this.box(g, 0, .51, 0, .82, .12, .75, '#ab6953');
    for (let i = 0; i < 4; i++) this.box(g, -.3 + i * .2, .38, .37, .1, .16, .16, i % 2 ? '#f3e6c9' : '#b66952');
    this.scene.add(g); return g;
  }
  makeWall(g: THREE.Group, x: number, y: number) {
    g.position.copy(this.pos(x, y, .16));
    this.box(g, 0, .21, 0, .94, .42, .22, '#9a9385');
    for (const a of [-.34, .34]) this.box(g, a, .32, 0, .13, .62, .3, '#797b73');
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(.12, .3, 3), new THREE.MeshBasicMaterial({ color: '#f8e7aa' }));
    arrow.rotation.z = -Math.PI / 2; arrow.position.set(0, .5, 0); g.add(arrow);
    return g;
  }
  makeForest(g: THREE.Group, x: number, y: number) {
    g.position.copy(this.pos(x, y, .13));
    for (const [a, b] of [[-.23, -.18], [.22, .13], [-.16, .24]]) {
      this.box(g, a, .16, b, .07, .32, .07, '#79654a');
      const crown = new THREE.Mesh(new THREE.ConeGeometry(.25, .48, 6), this.material('#426f4d'));
      crown.position.set(a, .48, b); crown.castShadow = true; g.add(crown);
    }
    return g;
  }
  makeSnow(g: THREE.Group, x: number, y: number) {
    g.position.copy(this.pos(x, y, .13));
    const snowy = (x * 3 + y * 5) % 4 !== 0;
    if (snowy) {
      for (const [a, b] of [[-.23, .2], [.22, -.2]]) {
        const drift = new THREE.Mesh(new THREE.SphereGeometry(.25, 8, 4), this.material('#f4f7f2'));
        drift.scale.set(1, .22, .75); drift.position.set(a, .035, b); g.add(drift);
      }
    } else {
      const ice = new THREE.Mesh(new THREE.PlaneGeometry(.87, .87), new THREE.MeshStandardMaterial({ color: '#9dd9e5', roughness: .15, metalness: .25, transparent: true, opacity: .85 }));
      ice.rotation.x = -Math.PI / 2; ice.position.y = .015; g.add(ice);
      for (const angle of [-.55, .65]) {
        const crack = new THREE.Mesh(new THREE.PlaneGeometry(.42, .018), new THREE.MeshBasicMaterial({ color: '#f5ffff', side: THREE.DoubleSide }));
        crack.rotation.x = -Math.PI / 2; crack.rotation.z = angle; crack.position.y = .022; g.add(crack);
      }
    }
    return g;
  }
  makeSpecial(x: number, y: number, type: string, floor = 0) {
    const colors: Record<string, string> = { heart: '#d48783', spade: '#778581', diamond: '#d4ae60', club: '#78966c', stairs: '#7a9276', radio: '#b78c65', forest: '#608764' };
    const g = new THREE.Group(); g.position.copy(this.pos(x, y, .16, floor));
    const shape = new THREE.Shape();
    if (type === 'stairs') { for (let i = 0; i < 4; i++) { const step = new THREE.Mesh(new THREE.BoxGeometry(.65, .07, .13), this.material('#e3d8b9')); step.position.set(0, i * .07, -.24 + i * .15); g.add(step); } this.scene.add(g); return; }
    if (type === 'diamond') { shape.moveTo(0, .27); shape.lineTo(.2, 0); shape.lineTo(0, -.27); shape.lineTo(-.2, 0); }
    else if (type === 'heart') { shape.moveTo(0, -.2); shape.bezierCurveTo(-.4, .02, -.22, .3, 0, .13); shape.bezierCurveTo(.22, .3, .4, .02, 0, -.2); }
    else if (type === 'spade') { shape.moveTo(0, .24); shape.bezierCurveTo(-.4, 0, -.23, -.25, -.06, -.11); shape.lineTo(-.1, -.25); shape.lineTo(.1, -.25); shape.lineTo(.06, -.11); shape.bezierCurveTo(.23, -.25, .4, 0, 0, .24); }
    else { for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3 + Math.PI / 2; shape.absellipse(Math.cos(a) * .09, Math.sin(a) * .09, .12, .12, 0, Math.PI * 2, false, 0); } }
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: colors[type], side: THREE.DoubleSide, transparent: true, opacity: .85 }));
    m.rotation.x = -Math.PI / 2; m.position.y = .01; g.add(m); this.scene.add(g);
    return g;
  }
  buildLandscape() {
    const positions = [[-8.25,-6.5],[-8.25,-2.1],[-8.4,3],[-8.1,7.7],[8.2,6.7],[8.2,1.8],[8.2,-3.4],[7.8,-8.2],[-4.5,8.3],[2.8,8.25],[4.5,-8.2],[-2.5,-8.2]];
    for (const [x,z] of positions) {
      const g = new THREE.Group(); g.position.set(x, 0, z);
      this.box(g, 0, .27, 0, .1, .54, .1, '#8e7956');
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(.42, 0), this.material('#91a375')); crown.position.y = .75; crown.scale.set(.8, 1.2, .8); crown.castShadow = true; g.add(crown); this.scene.add(g);
    }
    for (let i = 0; i < 16; i++) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(.018, .015, .25), new THREE.MeshBasicMaterial({ color: '#e7e5cc' }));
      line.position.set(-8.53, .005, i - 7.5); this.scene.add(line);
      const line2 = line.clone(); line2.position.x = 8.53; this.scene.add(line2);
    }
  }
  visible(cellId: number, owner = this.game.human) {
    const canSee = (this.game as Game & { canSee?: (owner: number, id: number) => boolean }).canSee;
    return this.game.map !== 'blackout' || !canSee || canSee.call(this.game, owner, cellId);
  }
  private delta(a: number, b: number) {
    const d = b - a;
    return this.game.map === 'sports' ? ((d + this.game.size / 2) % this.game.size + this.game.size) % this.game.size - this.game.size / 2 : d;
  }
  private distance(a: { x: number; y: number; floor: number }, b: { x: number; y: number; floor: number }) {
    return Math.abs(this.delta(a.x, b.x)) + Math.abs(this.delta(a.y, b.y)) + Math.abs(a.floor - b.floor) * 4;
  }
  private forestHidden(cellId: number) {
    const c = this.game.cells[cellId];
    if (c?.type !== 'forest' || c.owner < 0 || c.owner === this.game.human) return false;
    return this.game.map === 'hill';
  }
  update() {
    for (const cell of this.game.cells) {
      const tile = this.tileRefs[cell.id].mesh;
      const mat = tile.material as THREE.MeshStandardMaterial;
      const visible = this.visible(cell.id), otherFloor = this.game.map === 'dorm' && cell.floor !== this.floor;
      mat.transparent = otherFloor || !visible; mat.opacity = otherFloor ? .16 : visible ? 1 : .48; mat.depthWrite = !otherFloor;
      let color = '#c8d2af';
      if (cell.type === 'obstacle') color = '#b4baa2';
      else if (visible && cell.owner >= 0) color = ['#a394bd','#d8c87f','#9eb98d','#879294'][cell.owner];
      else if (cell.type === 'heart') color = '#dbc0ad';
      else if (cell.type === 'diamond') color = '#ddcf9c';
      else if (cell.type === 'club') color = '#b4c59d';
      else if (cell.type === 'spade') color = '#bdc5b2';
      else if (cell.type === 'shop') color = '#dcc6a6';
      else if (cell.type === 'forest') color = '#729374';
      else if (cell.type === 'wall') color = '#aaa18d';
      else if (cell.type === 'snow') color = (cell.x * 3 + cell.y * 5) % 4 ? '#e2e9e4' : '#a9d6df';
      if (visible && cell.base && cell.owner >= 0) color = ['#8b76aa','#c4ac52','#84a771','#6e7b7f'][cell.owner];
      if (!visible && cell.owner >= 0) color = '#c8d2af';
      if (this.game.poison.has(cell.id)) color = '#739d38';
      tile.setColorAt(this.tileRefs[cell.id].index, new THREE.Color(color));
      if (tile.instanceColor) tile.instanceColor.needsUpdate = true;
    }
    this.selectedRing.visible = this.selected >= 0 && this.visible(this.selected);
    if (this.selected >= 0) { const c = this.game.cells[this.selected]; this.selectedRing.position.copy(this.pos(c.x, c.y, .145)); }
    if (this.boxSelect.size) this.syncBoxRings();
    this.hoverRing.visible = this.hovered >= 0 && this.hovered !== this.selected && this.visible(this.hovered);
    if (this.hovered >= 0) { const c = this.game.cells[this.hovered]; this.hoverRing.position.copy(this.pos(c.x, c.y, .15)); }
    this.targetRing.visible = this.dragTarget >= 0;
    if (this.dragTarget >= 0) { const c = this.game.cells[this.dragTarget]; this.targetRing.position.copy(this.pos(c.x, c.y, .16)); }
    this.drawUnits(); this.drawEffects(); this.drawMinimap();
  }
  drawUnits() {
    this.unitGroup.clear();
    const groups = new Map<string, { x: number; y: number; owner: number; troops: number; z?: number }>();
    for (const c of this.game.cells) if (this.visible(c.id) && !this.forestHidden(c.id) && c.owner >= 0 && c.troops > .1 && c.type !== 'obstacle') groups.set('c' + c.id, { x: c.x, y: c.y, owner: c.owner, troops: c.troops, z: c.floor });
    for (const u of this.game.units) {
      const from = this.game.cells[u.from], next = this.game.cells[u.path[0]];
      if (!from || !this.visible(from.id) || !this.visible(u.to)) continue;
      const canSeeUnit = (this.game as Game & { canSeeUnit?: (owner: number, unit: typeof u) => boolean }).canSeeUnit;
      if (canSeeUnit ? !canSeeUnit.call(this.game, this.game.human, u) : this.forestHidden(from.id)) continue;
      groups.set('u' + u.id, { x: from.x + this.delta(from.x, next?.x ?? from.x) * Math.max(0, u.progress), y: from.y + this.delta(from.y, next?.y ?? from.y) * Math.max(0, u.progress), owner: u.owner, troops: u.troops, z: from.floor });
    }
    for (const u of groups.values()) {
      const floor = u.z ?? 0;
      if (this.game.map === 'dorm' && floor !== this.floor) continue;
      const g = new THREE.Group(); const p = this.pos(u.x, u.y, .13, floor); g.position.copy(p);
      const count = Math.min(4, Math.max(1, Math.ceil(u.troops / 6)));
      for (let i = 0; i < count; i++) {
        const a = i * 2.4; const x = Math.cos(a) * .13, z = Math.sin(a) * .13;
        const body = new THREE.Mesh(this.unitBodyGeometry, this.unitMaterials[u.owner]); body.position.set(x, .09, z); body.castShadow = true; g.add(body);
        const head = new THREE.Mesh(this.unitHeadGeometry, this.unitHeadMaterial); head.position.set(x, .21, z); g.add(head);
      }
      const troops = Math.floor(u.troops).toString();
      let barMaterial = this.unitBarMaterials.get(troops);
      if (!barMaterial) {
        barMaterial = new THREE.MeshBasicMaterial({ map: this.textTexture(troops), transparent: true, depthTest: false });
        this.unitBarMaterials.set(troops, barMaterial);
      }
      const bar = new THREE.Mesh(this.unitBarGeometry, barMaterial);
      bar.position.set(0, .58, 0); bar.rotation.x = -Math.PI / 5; bar.rotation.y = Math.PI / 5; bar.renderOrder = 20; g.add(bar);
      this.unitGroup.add(g);
    }
  }
  private clearEffects(group: THREE.Group) { group.clear(); }
  private drawEffects() {
    this.clearEffects(this.threatGroup); this.clearEffects(this.crossFloor); this.clearEffects(this.poisonGroup);
    for (const c of this.game.cells) {
      if (c.floor !== this.floor) continue;
      if (this.game.poison.has(c.id)) {
        const pool = new THREE.Mesh(this.effectGeometry.poison, this.effectMaterial.poison);
        pool.rotation.x = -Math.PI / 2; pool.position.copy(this.pos(c.x, c.y, .2)); pool.renderOrder = 7; this.poisonGroup.add(pool);
        for (const [x, y] of [[-.18, .1], [.16, -.16]]) {
          const bubble = new THREE.Mesh(this.effectGeometry.bubble, this.effectMaterial.bubble);
          bubble.rotation.x = -Math.PI / 2; bubble.position.copy(this.pos(c.x + x, c.y + y, .205)); bubble.renderOrder = 8; this.poisonGroup.add(bubble);
        }
      }
      if (c.owner !== this.game.human) continue;
      const threat = this.game.units.some(u => u.owner !== this.game.human && this.visible(u.from) && this.visible(u.to) && this.distance(this.game.cells[u.from], c) <= 2);
      if (!threat) continue;
      const warning = new THREE.Mesh(this.effectGeometry.warning, this.effectMaterial.warning);
      warning.rotation.x = -Math.PI / 2; warning.rotation.z = Math.PI / 4; warning.renderOrder = 10;
      warning.position.copy(this.pos(c.x, c.y, .19));
      (warning.material as THREE.MeshBasicMaterial).opacity = .45 + Math.sin(performance.now() / 110) * .35;
      this.threatGroup.add(warning);
    }
    for (const u of this.game.units) {
      const from = this.game.cells[u.from], next = this.game.cells[u.path[0]];
      if (!from || !next || from.floor === next.floor || !this.visible(from.id) || !this.visible(next.id)) continue;
      const arrow = new THREE.Mesh(this.effectGeometry.arrow, this.effectMaterial.arrow);
      arrow.position.copy(this.pos(from.x, from.y, .75, this.floor)); arrow.rotation.z = next.floor > from.floor ? 0 : Math.PI; arrow.renderOrder = 20; this.crossFloor.add(arrow);
    }
    this.drawThreatCue();
  }
  private drawThreatCue() {
    const own = this.game.cells.filter(c => c.owner === this.game.human);
    const threats = this.game.units.filter(u => u.owner !== this.game.human && this.visible(u.from) && this.visible(u.to) && own.some(c => this.distance(this.game.cells[u.from], c) <= 2));
    this.threatCue.classList.toggle('active', threats.length > 0);
    this.threatArrow.classList.toggle('active', threats.length > 0);
    if (!threats.length) { this.threatCue.textContent = ''; return; }
    const u = threats[0], c = this.game.cells[u.from];
    this.threatCue.textContent = `⚠ 敌军逼近 · ${u.owner !== this.game.human ? FACTIONS[u.owner].name : ''} · ${c.x + 1},${c.y + 1}${c.floor !== this.floor ? ` · ${c.floor + 1}F` : ''}`;
    const screen = this.pos(c.x, c.y, .2, c.floor).project(this.camera);
    const angle = Math.atan2(-screen.y, screen.x);
    this.threatArrow.style.transform = `translate(-50%,-50%) rotate(${angle}rad)`;
    this.threatArrow.title = `${FACTIONS[u.owner].name}正在接近`;
  }
  private drawMinimap() {
    const ctx = this.minimapCtx, size = this.minimap.width, n = this.game.size, cell = size / n;
    this.leader = [...this.game.players].sort((a, b) => b.tiles - a.tiles || a.id - b.id)[0]?.id ?? -1;
    ctx.clearRect(0, 0, size, size); ctx.fillStyle = '#e8e9df'; ctx.fillRect(0, 0, size, size);
    const floorHeight = size / this.game.floors;
    for (let floor = 0; floor < this.game.floors; floor++) {
      ctx.save(); ctx.translate(0, floor * floorHeight); ctx.scale(1, floorHeight / size);
      for (const c of this.game.cells) {
        if (c.floor !== floor) continue;
        const visible = this.visible(c.id), showOwner = visible;
        ctx.fillStyle = c.type === 'obstacle' ? '#a9aea0' : this.game.poison.has(c.id) ? '#83ac36' : showOwner && c.owner >= 0 ? this.colors[c.owner] : c.type === 'wall' ? '#8f8779' : c.type === 'snow' ? '#d8e9eb' : '#c6cfba';
        ctx.globalAlpha = visible ? .86 : .35; ctx.fillRect(c.x * cell + .5, c.y * cell + .5, cell - 1, cell - 1);
        if (showOwner && c.owner === this.leader && c.troops >= 1 && !this.forestHidden(c.id)) {
          ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(7, cell * .8)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(Math.floor(c.troops).toString(), (c.x + .5) * cell, (c.y + .5) * cell);
        }
      }
      ctx.restore();
      if (this.game.floors > 1) { ctx.globalAlpha = 1; ctx.fillStyle = '#46534b'; ctx.font = '9px sans-serif'; ctx.fillText(`${floor + 1}F`, 3, floor * floorHeight + 10); }
    }
    ctx.globalAlpha = 1;
  }
  textCache = new Map<string, THREE.CanvasTexture>();
  textTexture(text: string) {
    if (this.textCache.has(text)) return this.textCache.get(text)!;
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 48;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fffdf4'; ctx.beginPath(); ctx.roundRect(1, 1, 126, 46, 10); ctx.fill();
    ctx.font = 'bold 27px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#374334'; ctx.fillText(text, 64, 25);
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; this.textCache.set(text, tex); return tex;
  }
  /** 屏幕点附近（默认 44px）最近的己方格，用于"抓住基地建筑"这类按偏了的情况。 */
  ownCellNear(clientX: number, clientY: number, maxPx = 44) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    let best = -1, bestD = maxPx;
    for (const c of this.game.cells) {
      if (c.owner !== this.game.human || c.floor !== this.floor) continue;
      const v = this.pos(c.x, c.y, .2).project(this.camera);
      const sx = rect.left + (v.x * .5 + .5) * rect.width, sy = rect.top + (-v.y * .5 + .5) * rect.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestD) { bestD = d; best = c.id; }
    }
    return best;
  }
  private updateBox(x0: number, y0: number, x1: number, y1: number) {
    this.boxRect = { x0, y0, x1, y1 };
    const r = this.container.getBoundingClientRect();
    const left = Math.min(x0, x1) - r.left, top = Math.min(y0, y1) - r.top;
    const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
    this.boxEl.style.display = 'block'; this.boxEl.style.left = `${left}px`; this.boxEl.style.top = `${top}px`;
    this.boxEl.style.width = `${w}px`; this.boxEl.style.height = `${h}px`;
  }
  private finishBox(x0: number, y0: number, x1: number, y1: number) {
    this.boxEl.style.display = 'none'; this.boxRect = null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const l = Math.min(x0, x1), r = Math.max(x0, x1), t = Math.min(y0, y1), b = Math.max(y0, y1);
    this.boxSelect.clear();
    for (const c of this.game.cells) {
      if (c.owner !== this.game.human || c.floor !== this.floor) continue;
      const v = this.pos(c.x, c.y, .2).project(this.camera);
      const sx = rect.left + (v.x * .5 + .5) * rect.width, sy = rect.top + (-v.y * .5 + .5) * rect.height;
      if (sx >= l - 6 && sx <= r + 6 && sy >= t - 6 && sy <= b + 6) this.boxSelect.add(c.id);
    }
    this.syncBoxRings();
    if (this.boxSelect.size) { this.selected = [...this.boxSelect][0]; this.onSelect(this.selected); }
  }
  private syncBoxRings() {
    while (this.boxRings.length < this.boxSelect.size) {
      const m = this.ring('#9ad06a', .46); this.boxRings.push(m); this.scene.add(m);
    }
    let i = 0;
    for (const id of this.boxSelect) {
      const c = this.game.cells[id], m = this.boxRings[i++];
      m.position.copy(this.pos(c.x, c.y, .18, c.floor)); m.visible = true;
    }
    for (; i < this.boxRings.length; i++) this.boxRings[i].visible = false;
  }
  /** 清空框选。 */
  clearBox() { if (!this.boxSelect.size) return; this.boxSelect.clear(); this.syncBoxRings(); }
  cellAt(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1), this.camera);
    const hits = this.raycaster.intersectObjects([...this.tileMeshes.filter(m => m instanceof THREE.InstancedMesh), ...this.decorMeshes]);
    const hit = hits.find(h => {
      const id = h.object instanceof THREE.InstancedMesh ? h.object.userData.cells[h.instanceId!] : h.object.userData.cell;
      return id !== undefined && this.game.cells[id]?.floor === this.floor;
    });
    if (hit) return (hit.object instanceof THREE.InstancedMesh ? hit.object.userData.cells[hit.instanceId!] : hit.object.userData.cell) as number;
    // 平面回退：射线打到建筑顶、树、或从高处经过时，把点投到当前层地面再算格子
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(this.game.map === 'dorm' ? this.floor * 1.65 : 0));
    const ground = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, ground)) return -1;
    const off = (this.game.size - 1) / 2;
    const cx = Math.round(ground.x + off), cy = Math.round(ground.z + off);
    if (cx < 0 || cy < 0 || cx >= this.game.size || cy >= this.game.size) return -1;
    const cell = this.game.cells.find(c => c.x === cx && c.y === cy && c.floor === this.floor);
    return cell ? cell.id : -1;
  }
  /** 键盘/程序化平移视野（世界单位）。 */
  pan(dx: number, dz: number) {
    const limit = this.game.size * .65;
    this.target.x = THREE.MathUtils.clamp(this.target.x - dx, -limit, limit);
    this.target.z = THREE.MathUtils.clamp(this.target.z - dz, -limit, limit);
    const offset = this.camera.position.clone().sub(this.target);
    this.camera.position.copy(this.target).add(offset); this.camera.lookAt(this.target);
  }
  destroy() {
    this.resizeObserver.disconnect(); for (const cleanup of this.cleanups) cleanup();
    this.scene.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); const materials = Array.isArray(o.material) ? o.material : [o.material]; for (const m of materials) m.dispose(); } });
    for (const texture of this.textCache.values()) texture.dispose();
    this.renderer.dispose(); this.renderer.domElement.remove(); this.overlay.remove();
  }
  bindPointer() {
    const el = this.renderer.domElement;
    const on = <K extends keyof HTMLElementEventMap>(type: K, handler: (event: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions) => {
      el.addEventListener(type, handler, options); this.cleanups.push(() => el.removeEventListener(type, handler, options));
    };
    on('contextmenu', e => { e.preventDefault(); if (Date.now() - this.rightPanAt < 400) return; this.selected = -1; this.onSelect(-1); });
    on('pointerdown', e => {
      if (e.button !== 0 && e.button !== 2 && e.button !== 1) return;
      if (e.button === 2 || e.button === 1) { // 右键/中键拖动 = 只平移视野，绝不派兵
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); el.setPointerCapture(e.pointerId);
        this.pointerDown = { x: e.clientX, y: e.clientY, cell: -1 };
        this.pressAt = this.lastPan = { x: e.clientX, y: e.clientY }; this.panning = true; this.commandFrom = -1; this.rightDown = true; el.style.cursor = 'grabbing';
        return;
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); el.setPointerCapture(e.pointerId);
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom };
        this.gesture = true; this.pointerDown = null; this.dragTarget = -1; return;
      }
      const cell = this.cellAt(e.clientX, e.clientY);
      this.pointerDown = { x: e.clientX, y: e.clientY, cell };
      this.pressAt = this.lastPan = { x: e.clientX, y: e.clientY }; this.panning = false;
    });
    on('pointermove', e => {
      const point = this.pointers.get(e.pointerId); if (point) { point.x = e.clientX; point.y = e.clientY; }
      if (this.pinch && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()], distance = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoom = THREE.MathUtils.clamp(this.pinch.zoom * this.pinch.distance / Math.max(1, distance), 10, 34); this.resize(); return;
      }
      this.hovered = this.cellAt(e.clientX, e.clientY);
      if (!this.pointerDown || !this.pressAt || !this.lastPan) return;
      if (this.commandFrom < 0 && !this.panning && Math.hypot(e.clientX - this.pressAt.x, e.clientY - this.pressAt.y) > 8) {
        const own = (id: number) => id >= 0 && this.game.cells[id].owner === this.game.human;
        const pressed = this.pointerDown.cell;
        // 优先级：抓到的己方格 > 已选中的己方格 > 紧贴按点的己方格 > 平移
        const near = own(pressed) || own(this.selected) ? -1 : this.ownCellNear(this.pressAt.x, this.pressAt.y, 26);
        const src = own(pressed) ? pressed : own(this.selected) ? this.selected : own(near) ? near : -1;
        if (src >= 0) this.commandFrom = src;   // 起手在（或紧贴）己方格，或已有选中己方格：拖 = 派兵
        else if (e.shiftKey || e.pointerType === 'mouse') this.boxing = true; // 鼠标左键在空白处拖 = 框选己方格
        else this.panning = true;                 // 触摸单指在空白处拖 = 平移视野（手机没有右键）
      }
      if (this.commandFrom >= 0) {
        this.selected = this.commandFrom; this.dragTarget = this.hovered >= 0 && this.hovered !== this.commandFrom ? this.hovered : -1;
        el.style.cursor = 'crosshair';
        return;
      }
      if (this.boxing) { this.updateBox(this.pressAt.x, this.pressAt.y, e.clientX, e.clientY); return; }
      if (!this.panning) return;
      const dx = e.clientX - this.lastPan.x, dy = e.clientY - this.lastPan.y;
      this.lastPan = { x: e.clientX, y: e.clientY };
      const scale = this.zoom / el.clientHeight;
      this.pan((dx + dy) * scale / Math.SQRT2, -(dx - dy) * scale / Math.SQRT2);
      this.dragTarget = -1; el.style.cursor = 'grabbing';
    });
    const release = (e: PointerEvent) => {
      const wasGesture = this.gesture, didPan = this.panning, press = this.pointerDown, commandFrom = this.commandFrom, wasRight = this.rightDown;
      this.rightDown = false;
      if (wasRight && didPan) this.rightPanAt = Date.now();
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (!this.pointers.size) this.gesture = false;
      const wasBoxing = this.boxing; this.boxing = false;
      this.pointerDown = null; this.pressAt = null; this.lastPan = null; this.panning = false; this.commandFrom = -1; this.dragTarget = -1; el.style.cursor = '';
      if (wasBoxing) { this.finishBox(press?.x ?? e.clientX, press?.y ?? e.clientY, e.clientX, e.clientY); return; }
      if (!press || wasGesture || didPan) return;
      if (this.boxSelect.size) {
        const to0 = this.cellAt(e.clientX, e.clientY);
        if (to0 >= 0 && !this.boxSelect.has(to0)) { this.selected = [...this.boxSelect][0] ?? -1; this.onSelect(this.selected); this.onDispatchMulti([...this.boxSelect], to0); return; }
        if (to0 < 0) this.clearBox();
      }
      const to = this.cellAt(e.clientX, e.clientY);
      if (commandFrom >= 0) {
        // 面板始终显示真正的出兵格，避免"提示里的格子和选中的格子不一致"
        this.selected = commandFrom; this.onSelect(commandFrom);
        if (to >= 0 && to !== commandFrom) this.onDispatch(commandFrom, to);
        return;
      }
      const own = (id: number) => id >= 0 && this.game.cells[id].owner === this.game.human;
      // 点己方格 = 选中出兵格；点目标格 = 从选中格出击；点空地 = 取消选择
      if (own(to)) { this.selected = to; this.onSelect(to); }
      else if (to >= 0 && this.selected >= 0 && own(this.selected)) this.onDispatch(this.selected, to);
      else if (to >= 0) this.onSelect(to);
      else { this.selected = -1; this.onSelect(-1); }
    };
    on('pointerup', release); on('pointercancel', release);
    on('pointerleave', () => { if (!this.pointers.size) this.hovered = -1; });
    on('wheel', e => { e.preventDefault(); this.zoom = THREE.MathUtils.clamp(this.zoom + e.deltaY * .015, 10, 34); this.resize(); }, { passive: false });
  }
  focusBase() {
    const c = this.game.cells.find(c => c.base && c.owner === this.game.human);
    if (!c) return;
    this.floor = c.floor; this.selected = c.id;
    const p = this.pos(c.x, c.y, 0);
    const offset = this.camera.position.clone().sub(this.target);
    this.target.set(p.x, 0, p.z);
    this.camera.position.copy(this.target).add(offset); this.camera.lookAt(this.target);
    this.onSelect(c.id);
  }
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h); const aspect = w / h; const size = this.zoom;
    this.camera.left = -size * aspect / 2; this.camera.right = size * aspect / 2; this.camera.top = size / 2; this.camera.bottom = -size / 2;
    this.camera.updateProjectionMatrix();
  }
  render() { this.update(); this.renderer.render(this.scene, this.camera); }
}
