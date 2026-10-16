// 入口:组装状态、模拟、渲染、RTS 与 UI,并驱动主循环。
import { Vector3 } from 'three';
import { createStage } from './engine/scene.js';
import { CameraRig } from './engine/camera.js';
import { Game } from './sim/state.js';
import { Economy } from './sim/economy.js';
import { SimLoop } from './sim/loop.js';
import { TerrainView } from './world/terrain.js';
import { WorldView } from './world/view.js';
import { MAP_W, MAP_H, PLAYER_HQ } from './world/map.js';
import { createRTS } from './rts/index.js';
import { UI } from './ui/ui.js';
import { Input } from './ui/input.js';
import { loadGame, hasSave, savedMeta } from './save.js';

const params = new URLSearchParams(location.search);
const viewport = document.getElementById('viewport');
const stage = createStage(viewport);
const rig = new CameraRig(stage.renderer.domElement, { minX: 0, maxX: MAP_W, minZ: 0, maxZ: MAP_H });

const game = new Game(Number(params.get('seed') ?? savedMeta()?.seed ?? 7), params.get('diff') ?? savedMeta()?.difficulty ?? 'normal');
const economy = new Economy(game);
const terrain = new TerrainView(stage.scene, game.map);
const view = new WorldView(stage.scene, game, economy);
const rts = createRTS({ game, scene: stage.scene, rig, view, overlay: document.getElementById('dragbox') });
game.unitSystem = rts;

const resumed = !params.has('new') && hasSave() && loadGame({ game, rts, economy });
if (resumed) {
  view.rebuildAll();
  terrain.rebuild();
} else {
  game.setupStart();
  rts.setupEnemy();
}

const sim = new SimLoop(game, economy, rts);
const ui = new UI({ game, economy, rig, rts, view, terrain });
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

window.addEventListener('resize', () => {
  stage.renderer.setSize(viewport.clientWidth, viewport.clientHeight);
});

let last = performance.now();
let t = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;
  sim.advance(dt);
  rts.render(dt);
  if (terrainDirty.tiles) terrain.rebuildTiles();
  if (terrainDirty.props) terrain.rebuildProps();
  if (terrainDirty.borders) terrain.rebuildBorders();
  terrainDirty = { tiles: false, props: false, borders: false };
  terrain.update(t);
  view.update(dt);
  rig.update(dt);
  stage.followSun(rig.target, rig.view);
  stage.renderer.render(stage.scene, rig.camera);
  ui.update(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 供 Playwright 诊断读取(只读):断言状态、把世界坐标投影到屏幕;E2E 操作仍须走 DOM
window.__voxel = { game, rts, economy, project: (x, z) => rig.toScreen(new Vector3(x, 0, z)) };
