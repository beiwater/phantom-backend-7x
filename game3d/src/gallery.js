// 体素模型画廊:等距正交相机下按行展示所有建筑(每级)、道路/城墙、单位、道具,用于目测验收。
// 查询参数:?only=<建筑id> 只看一种建筑;?section=buildings|military|infra|units|props;?ids=a,b 子集;?smoke=0 隐藏烟口标记。
import * as THREE from 'three';
import { voxelMaterial } from './engine/voxel.js';
import { BUILDINGS, BUILDING_IDS } from './data/buildings.js';
import { UNIT_IDS } from './data/units.js';
import * as M from './models/index.js';

const params = new URLSearchParams(location.search);
const only = params.get('only');
const section = params.get('section') ?? 'all';
const idsParam = params.get('ids');
const showSmoke = params.get('smoke') !== '0';
const TEAM_BUILDINGS = ['hq', 'barracks', 'vehicleFactory', 'airfield', 'turret', 'wall'];
const SQ2 = Math.SQRT2;
const R_HAT = new THREE.Vector3(1, 0, -1).normalize();
const D_HAT = new THREE.Vector3(1, 0, 1).normalize();
const U_HAT = new THREE.Vector3(-1, 2, -1).normalize();

let maxVox = { n: 0, label: '' };
let totalVox = 0;

function track(model, label) {
  totalVox += model.voxels.size;
  if (model.voxels.size > maxVox.n) maxVox = { n: model.voxels.size, label };
}

function buildingItem(id, level, team) {
  const [w, d] = BUILDINGS[id].size;
  const m = M.buildBuildingModel(id, level, team);
  track(m, `${id} L${level} ${team}`);
  const parts = [{ geo: m.toGeometry({ footW: w, footD: d }), x: 0, y: 0, z: 0 }];
  let h = m.height() / 8;
  if (id === 'turret') {
    const head = M.buildTurretHeadModel(level, team);
    parts.push({ geo: head.toGeometry({ footW: 0, footD: 0 }), x: 0, y: head.pivotY / 8, z: 0, ry: 0.6 });
    h = Math.max(h, (head.pivotY + head.height()) / 8);
  }
  const smoke = (m.smoke ?? []).map(([x, y, z]) => [(x + 0.5 - w * 4) / 8, (y + 1) / 8, (z + 0.5 - d * 4) / 8]);
  return { label: `L${level} · ${m.voxels.size}v`, w, d, h, parts, smoke };
}

function buildingRows(ids) {
  const rows = [];
  for (const id of ids) {
    const b = BUILDINGS[id];
    const teams = TEAM_BUILDINGS.includes(id) ? ['player', 'enemy'] : ['player'];
    for (const team of teams) {
      const items = [];
      for (let l = 1; l <= b.maxLevel; l++) items.push(buildingItem(id, l, team));
      rows.push({ title: `${b.name} ${id}${teams.length > 1 ? ` (${team})` : ''}`, items });
    }
  }
  return rows;
}

function network(build, cells, label) {
  const set = new Set(cells.map(([x, z]) => `${x},${z}`));
  const has = (x, z) => set.has(`${x},${z}`);
  const xs = cells.map((c) => c[0]);
  const zs = cells.map((c) => c[1]);
  const w = Math.max(...xs) + 1;
  const d = Math.max(...zs) + 1;
  const parts = cells.map(([x, z]) => {
    const mask = (has(x, z - 1) ? 1 : 0) | (has(x + 1, z) ? 2 : 0) | (has(x, z + 1) ? 4 : 0) | (has(x - 1, z) ? 8 : 0);
    return { geo: build(mask).toGeometry({ footW: 1, footD: 1 }), x: x + 0.5 - w / 2, y: 0, z: z + 0.5 - d / 2 };
  });
  return { label, w, d, h: 2, parts, smoke: [] };
}

const NET = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [0, 1], [2, 1], [4, 1], [0, 2], [1, 2], [2, 2], [3, 2], [2, 3], [2, 4], [3, 4], [5, 2], [6, 2], [6, 3], [6, 4], [5, 4]];

function infraRows() {
  const roads = [];
  for (let k = 0; k < 16; k++) {
    const m = M.buildRoadModel(k);
    track(m, `road ${k}`);
    roads.push({ label: `mask ${k}`, w: 1, d: 1, h: 0.3, parts: [{ geo: m.toGeometry({ footW: 1, footD: 1, jitter: 0.03 }), x: 0, y: 0, z: 0 }], smoke: [] });
  }
  const rows = [{ title: 'road masks', items: roads }];
  rows.push({ title: 'road network', items: [network(M.buildRoadModel, NET, 'network')] });
  for (const team of ['player', 'enemy']) {
    const items = [];
    for (let l = 1; l <= 3; l++) {
      items.push(network((mask) => M.buildWallModel(mask, l, team), NET.slice(0, 14), `wall L${l}`));
    }
    rows.push({ title: `walls (${team})`, items });
  }
  const masks = [];
  for (let k = 0; k < 16; k++) {
    const m = M.buildWallModel(k, 2, 'player');
    masks.push({ label: `${k}`, w: 1, d: 1, h: m.height() / 8, parts: [{ geo: m.toGeometry({ footW: 1, footD: 1 }), x: 0, y: 0, z: 0 }], smoke: [] });
  }
  rows.push({ title: 'wall masks L2', items: masks });
  return rows;
}

function unitRows() {
  const rows = [];
  for (const team of ['player', 'enemy']) {
    const items = [];
    for (const id of UNIT_IDS) {
      const p = M.buildUnitModel(id, team);
      track(p.body, `${id} ${team}`);
      const parts = [{ geo: p.body.toGeometry({ footW: p.body.footW, footD: p.body.footD, scale: 1 / 16 }), x: 0, y: 0, z: 0 }];
      if (p.top) parts.push({ geo: p.top.toGeometry({ footW: 0, footD: 0, scale: 1 / 16 }), x: 0, y: p.topY / 16, z: 0, ry: id === 'helicopter' ? 0.4 : 0.5 });
      const s = p.body.footW / 2;
      items.push({ label: id, w: s, d: s, h: p.body.height() / 16 + 0.3, parts, smoke: [] });
    }
    const t = M.buildTruckModel(team);
    items.push({ label: 'truck', w: 0.75, d: 0.75, h: 0.5, parts: [{ geo: t.toGeometry({ footW: t.footW, footD: t.footD, scale: 1 / 16 }), x: 0, y: 0, z: 0 }], smoke: [] });
    rows.push({ title: `units (${team})`, items });
  }
  return rows;
}

function simple(model, label, w = 1, d = 1) {
  track(model, label);
  return { label, w, d, h: model.height() / 8, parts: [{ geo: model.toGeometry({ footW: w, footD: d }), x: 0, y: 0, z: 0 }], smoke: [] };
}

function propRows() {
  const nature = [];
  for (let v = 0; v < 4; v++) nature.push(simple(M.buildTreeModel(v), `tree ${v}`));
  for (let v = 0; v < 3; v++) nature.push(simple(M.buildRockModel(v), `rock ${v}`));
  for (const k of ['ore', 'coal', 'oil']) nature.push(simple(M.buildDepositModel(k), k));
  const sites = [];
  for (const [w, d] of [[1, 1], [2, 2], [3, 2], [3, 3]]) sites.push(simple(M.buildScaffoldModel(w, d), `scaffold ${w}x${d}`, w, d));
  for (const [w, d] of [[1, 1], [2, 2], [3, 3]]) sites.push(simple(M.buildRubbleModel(w, d), `rubble ${w}x${d}`, w, d));
  return [{ title: 'trees / rocks / deposits', items: nature }, { title: 'construction / rubble', items: sites }];
}

function collectRows() {
  if (only) return buildingRows([only]);
  const civil = BUILDING_IDS.filter((id) => !TEAM_BUILDINGS.includes(id));
  if (idsParam) return buildingRows(idsParam.split(','));
  switch (section) {
    case 'buildings': return buildingRows(civil);
    case 'military': return buildingRows(TEAM_BUILDINGS);
    case 'infra': return infraRows();
    case 'units': return unitRows();
    case 'props': return propRows();
    default: return [...buildingRows(BUILDING_IDS), ...infraRows(), ...unitRows(), ...propRows()];
  }
}

// ---------- 布局:行沿屏幕向下,行内沿屏幕向右 ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfe3ea);
const rows = collectRows();
const GAP = 0.9;
const placed = [];
const rowTitles = [];
let screenY = 0;
let prevBottom = 0;
for (const row of rows) {
  const top = Math.max(...row.items.map((it) => 0.816 * it.h + 0.204 * (it.w + it.d)));
  const bottom = Math.max(...row.items.map((it) => 0.204 * (it.w + it.d))) + 0.35;
  screenY -= prevBottom + top + GAP;
  prevBottom = bottom;
  const t = -screenY / 0.5774;
  let s = 0;
  row.items.forEach((it, i) => {
    const half = (it.w + it.d) / (2 * SQ2);
    s += i === 0 ? 0 : half + GAP;
    const center = R_HAT.clone().multiplyScalar(s).add(D_HAT.clone().multiplyScalar(t));
    placed.push({ it, center });
    s += half;
  });
  rowTitles.push({ title: row.title, pos: R_HAT.clone().multiplyScalar(-1.2).add(D_HAT.clone().multiplyScalar(t)) });
}

const mat = voxelMaterial();
const smokeGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const smokeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
const bounds = new THREE.Box3();
for (const { it, center } of placed) {
  for (const p of it.parts) {
    const mesh = new THREE.Mesh(p.geo, mat);
    mesh.position.set(center.x + p.x, p.y, center.z + p.z);
    if (p.ry) mesh.rotation.y = p.ry;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  if (showSmoke) {
    for (const [x, y, z] of it.smoke) {
      for (let k = 0; k < 3; k++) {
        const puff = new THREE.Mesh(smokeGeo, smokeMat);
        puff.position.set(center.x + x + k * 0.04, y + 0.08 + k * 0.14, center.z + z);
        puff.scale.setScalar(1 + k * 0.6);
        scene.add(puff);
      }
    }
  }
  bounds.expandByPoint(new THREE.Vector3(center.x - it.w / 2, 0, center.z - it.d / 2));
  bounds.expandByPoint(new THREE.Vector3(center.x + it.w / 2, it.h, center.z + it.d / 2));
}

const size = bounds.getSize(new THREE.Vector3());
const mid = bounds.getCenter(new THREE.Vector3());
const ground = new THREE.Mesh(new THREE.PlaneGeometry(size.x + 40, size.z + 40), new THREE.MeshLambertMaterial({ color: 0xb9cfa0 }));
ground.rotation.x = -Math.PI / 2;
ground.position.set(mid.x, -0.01, mid.z);
ground.receiveShadow = true;
scene.add(ground);

scene.add(new THREE.HemisphereLight(0xf4f8ff, 0x8a8070, 1.4));
const sun = new THREE.DirectionalLight(0xfff2dc, 2.2);
const radius = Math.max(size.x, size.z) * 0.75 + 4;
sun.position.copy(mid).add(new THREE.Vector3(0.45, 1, 0.75).normalize().multiplyScalar(radius * 2));
sun.target.position.copy(mid);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 0.1, far: radius * 5 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

// ---------- 相机:按屏幕投影包围盒适配,支持拖拽平移与滚轮缩放 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 1000);
const target = mid.clone();
const corners = rowTitles.map((r) => r.pos.clone().sub(R_HAT.clone().multiplyScalar(2.5)));
for (const { it, center } of placed) {
  for (const x of [-it.w / 2, it.w / 2]) for (const y of [0, it.h]) for (const z of [-it.d / 2, it.d / 2]) corners.push(new THREE.Vector3(center.x + x, y, center.z + z));
}
let sx0 = Infinity; let sx1 = -Infinity; let sy0 = Infinity; let sy1 = -Infinity;
for (const c of corners) {
  const v = c.clone().sub(mid);
  sx0 = Math.min(sx0, v.dot(R_HAT)); sx1 = Math.max(sx1, v.dot(R_HAT));
  sy0 = Math.min(sy0, v.dot(U_HAT)); sy1 = Math.max(sy1, v.dot(U_HAT));
}
target.add(R_HAT.clone().multiplyScalar((sx0 + sx1) / 2)).add(U_HAT.clone().multiplyScalar((sy0 + sy1) / 2));
const viewW = (sx1 - sx0) * 1.03 + 0.6;
const viewH = (sy1 - sy0) * 1.03 + 1.2;

function fit() {
  const aspect = window.innerWidth / window.innerHeight;
  const halfH = Math.max(viewH, viewW / aspect) / 2;
  camera.left = -halfH * aspect;
  camera.right = halfH * aspect;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.position.copy(target).add(new THREE.Vector3(1, 1, 1).normalize().multiplyScalar(300));
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}

const labelRoot = document.getElementById('labels');
const labels = placed.map(({ it, center }) => {
  const el = document.createElement('div');
  el.className = 'lbl';
  el.textContent = it.label;
  labelRoot.appendChild(el);
  return { el, world: new THREE.Vector3(center.x + it.w / 2, 0, center.z + it.d / 2) };
});
for (const r of rowTitles) {
  const el = document.createElement('div');
  el.className = 'lbl row';
  el.textContent = r.title;
  labelRoot.appendChild(el);
  labels.push({ el, world: r.pos.clone().add(new THREE.Vector3(0, 0.2, 0)) });
}

function render() {
  renderer.render(scene, camera);
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (const l of labels) {
    const p = l.world.clone().project(camera);
    l.el.style.left = `${((p.x + 1) / 2) * w}px`;
    l.el.style.top = `${((1 - p.y) / 2) * h + 2}px`;
  }
}

fit();
render();
window.addEventListener('resize', () => { renderer.setSize(window.innerWidth, window.innerHeight); fit(); render(); });
let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
window.addEventListener('pointerup', () => { drag = null; });
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const k = (camera.top - camera.bottom) / camera.zoom / window.innerHeight;
  target.add(R_HAT.clone().multiplyScalar(-(e.clientX - drag.x) * k)).add(U_HAT.clone().multiplyScalar((e.clientY - drag.y) * k));
  drag = { x: e.clientX, y: e.clientY };
  camera.position.copy(target).add(new THREE.Vector3(1, 1, 1).normalize().multiplyScalar(300));
  render();
});
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  camera.zoom = Math.max(0.2, Math.min(40, camera.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
  camera.updateProjectionMatrix();
  render();
}, { passive: false });

document.getElementById('stats').textContent = `${placed.length} items · ${totalVox} voxels · max ${maxVox.n} (${maxVox.label})`;
window.__gallery = { items: placed.length, totalVox, maxVox, ready: true };
