// 入口:组装状态、模拟、渲染、RTS 与 UI,并驱动主循环。
import { Vector3 } from 'three';
import { createStage } from './engine/scene.js';
import { CameraRig } from './engine/camera.js';
import { Game } from './sim/state.js';
import { Economy } from './sim/economy.js';
import { SimLoop } from './sim/loop.js';
import { TerrainView } from './world/terrain.js';
import { WorldView } from './world/view.js';
import { FogOfWar } from './world/fog.js';
import { RuinsView } from './world/ruins-view.js';
import { WeatherView } from './world/weather-view.js';
import { Overlay } from './world/overlay.js';
import { Clouds } from './world/clouds.js';
import { voxelMaterial } from './engine/voxel.js';
import { Quality } from './engine/quality.js';
import { DayNight } from './engine/daynight.js';
import { Audio } from './engine/audio.js';
import { bindSounds } from './ui/sounds.js';
import { MAP_W, MAP_H, PLAYER_HQ } from './world/map.js';
import { createRTS } from './rts/index.js';
import { UI } from './ui/ui.js';
import { Input } from './ui/input.js';
import { loadGame, hasSave, savedMeta, loadReplay, applySnapshot } from './save.js';
import { ReplayTransport } from './net/transport.js';
import { LockstepTransport, broadcastChannel } from './net/lockstep.js';

const params = new URLSearchParams(location.search);
const viewport = document.getElementById('viewport');
const stage = createStage(viewport);
const rig = new CameraRig(stage.renderer.domElement, { minX: 0, maxX: MAP_W, minZ: 0, maxZ: MAP_H });

const replay = params.has('replay') ? loadReplay() : null;
const game = replay
  ? new Game(replay.seed, replay.difficulty, replay.mapType)
  : new Game(Number(params.get('seed') ?? savedMeta()?.seed ?? 7), params.get('diff') ?? savedMeta()?.difficulty ?? 'normal', params.get('map') ?? savedMeta()?.mapType ?? 'river');
const economy = new Economy(game);
const terrain = new TerrainView(stage.scene, game.map);
const view = new WorldView(stage.scene, game, economy);
const rts = createRTS({ game, scene: stage.scene, rig, view, overlay: document.getElementById('dragbox') });
game.unitSystem = rts;

let resumedFog = null;
const coopId = params.get('coop');
const resumed = !replay && !coopId && !params.has('new') && hasSave() && loadGame({ game, rts, economy, onFog: (f) => { resumedFog = f; } });
const replayFromSnapshot = !!replay?.base && applySnapshot({ game, rts, economy, onFog: (f) => { resumedFog = f; } }, replay.base);
if (resumed || replayFromSnapshot) {
  view.rebuildAll();
  terrain.rebuild();
} else {
  game.setupStart();
  rts.setupEnemy();
}
if (replay) {
  game.transport = new ReplayTransport(game, replay.log);
  game.replay = replay;
}
if (coopId) {
  // 本机多标签页合作:所有标签页需同种子、同时开局;任一方暂停或落后时其他方会等待
  game.players = (params.get('peers') ?? 'p1,p2').split(',').filter(Boolean);
  if (!game.players.includes(coopId)) game.players.push(coopId);
  game.localId = coopId;
  game.transport = new LockstepTransport(game, broadcastChannel(`voxel-coop-${game.map.seed}`));
  game.coop = true;
}

const sim = new SimLoop(game, economy, rts);
const fog = new FogOfWar(game);
game.fog = fog;
if (resumed || replayFromSnapshot) fog.load(resumedFog);
const ruinsView = new RuinsView(stage.scene, game);
game.events.on('ruins:map', ({ x, z, radius }) => fog.reveal(x, z, radius));
const dayNight = new DayNight(stage);
const weatherView = new WeatherView(stage.scene, stage, game, rig);
const overlay = new Overlay(stage.scene, game, economy);
const clouds = new Clouds(stage.scene, game, rig);
dayNight.apply(voxelMaterial());
for (const mat of [voxelMaterial(), terrain.tileMaterial, terrain.water.material, terrain.base.material]) fog.apply(mat);
const quality = new Quality(stage, stage.scene);
const audio = new Audio();
const ui = new UI({ game, economy, rig, rts, view, terrain, quality, dayNight, audio, overlay });
bindSounds({ game, rts, rig, audio });
const input = new Input({ game, rig, scene: stage.scene, rts, ui, view, dom: stage.renderer.domElement });
ui.input = input;
rts.ui = ui;

const hq = game.playerHQ();
rig.lookAt(hq ? hq.x + 1.5 : PLAYER_HQ.x, hq ? hq.z + 1.5 : PLAYER_HQ.z);

// 地形变化(清林、铺路、扩地)合并到下一帧统一重建
let terrainDirty = { tiles: false, props: false, borders: false };
game.events.on('building:add', () => { terrainDirty.props = true; });
game.events.on('building:remove', () => { terrainDirty.props = true; });
game.events.on('road', () => { terrainDirty.props = true; });
game.events.on('chunk', () => { terrainDirty.tiles = true; terrainDirty.borders = true; });

// 去掉一次性的 new/seed/diff 参数,避免刷新页面时又开新局覆盖存档
if (params.has('new')) history.replaceState(null, '', location.pathname);

window.addEventListener('resize', () => {
  stage.renderer.setSize(viewport.clientWidth, viewport.clientHeight);
});

let last = performance.now();
let t = 0;
function frame(now) {
  const rawDt = (now - last) / 1000;
  const dt = Math.max(0, Math.min(0.05, rawDt));
  const lowered = quality.watch(Math.max(0, Math.min(1, rawDt)));
  if (lowered) ui.toast(`帧率较低,画质已自动调为「${lowered}」(菜单可修改)`);
  last = now;
  t += dt;
  sim.advance(dt);
  rts.render(dt);
  if (terrainDirty.tiles) terrain.rebuildTiles();
  if (terrainDirty.props) terrain.rebuildProps();
  if (terrainDirty.borders) terrain.rebuildBorders();
  terrainDirty = { tiles: false, props: false, borders: false };
  terrain.update(t);
  fog.update(dt);
  dayNight.update(game.time);
  weatherView.update(dt);
  overlay.update(dt);
  clouds.update(dt);
  ruinsView.update(t);
  view.update(dt);
  rig.update(dt);
  stage.followSun(rig.target, rig.view);
  stage.renderer.render(stage.scene, rig.camera);
  ui.update(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 供 Playwright 诊断读取(只读):断言状态、把世界坐标投影到屏幕;E2E 操作仍须走 DOM
window.__voxel = { game, rts, economy, sim, renderer: stage.renderer, scene: stage.scene, project: (x, z) => rig.toScreen(new Vector3(x, 0, z)) };
