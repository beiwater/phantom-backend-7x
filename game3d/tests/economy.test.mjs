// 经济模拟无头测试:node --test game3d/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/sim/state.js';
import { Economy, ring } from '../src/sim/economy.js';
import { BUILDING_IDS, BUILDINGS } from '../src/data/buildings.js';
import { T, PLAYER_HQ } from '../src/world/map.js';

function fresh() {
  const g = new Game(7);
  g.setupStart();
  const e = new Economy(g);
  return { g, e };
}

function run(e, seconds, step = 0.1) {
  for (let t = 0; t < seconds; t += step) e.update(step);
}

/** 在指挥中心附近找一个可放置且紧贴起始道路的位置。 */
function spotNear(g, type) {
  const [w, d] = BUILDINGS[type].size;
  for (let z = PLAYER_HQ.z - 6; z < PLAYER_HQ.z + 10; z++) {
    for (let x = PLAYER_HQ.x - 6; x < PLAYER_HQ.x + 10; x++) {
      const touchesRoad = ring({ x, z, w, d }).some(([rx, rz]) => g.map.inside(rx, rz) && g.map.road[g.map.idx(rx, rz)]);
      if (touchesRoad && g.canPlace(type, x, z).ok) return { x, z };
    }
  }
  return null;
}

test('恰好 28 种建筑', () => {
  assert.equal(BUILDING_IDS.length, 28);
});

test('农场邻接连通道路后生产谷物,并扣除建造成本', () => {
  const { g, e } = fresh();
  const money0 = g.res.money;
  const wood0 = g.res.wood;
  const s = spotNear(g, 'farm');
  assert.ok(s, '应能找到农场位置');
  const r = g.placeBuilding('farm', s.x, s.z);
  assert.ok(r.ok, r.reason);
  assert.equal(g.res.money, money0 - 50);
  assert.equal(g.res.wood, wood0 - 4);
  run(e, 8 + 8 + 1);
  assert.equal(r.building.state, 'active');
  assert.ok(r.building.connected, '紧贴起始道路应连通');
  assert.ok(g.res.grain >= 2, `应产出谷物,实际 ${g.res.grain}`);
});

test('未连通道路的建筑不生产', () => {
  const { g, e } = fresh();
  g.res.money = 9999;
  // 起始区左下角远离道路
  let spot = null;
  for (let z = 52; z < 56 && !spot; z++) for (let x = 8; x < 14 && !spot; x++) if (g.canPlace('farm', x, z).ok) spot = { x, z };
  assert.ok(spot);
  const r = g.placeBuilding('farm', spot.x, spot.z);
  run(e, 30);
  assert.equal(r.building.connected, false);
  assert.equal(g.res.grain, 0);
  assert.equal(r.building.status, '未连接道路');
});

test('资源不足时放置失败且不扣任何资源(全量预检)', () => {
  const { g } = fresh();
  g.res.money = 10;
  const before = { ...g.res };
  const s = spotNear(g, 'house') ?? { x: PLAYER_HQ.x, z: PLAYER_HQ.z + 5 };
  const r = g.placeBuilding('house', s.x, s.z);
  assert.equal(r.ok, false);
  assert.deepEqual(g.res, before);
});

test('不能在未购买地块或水上建造;采石场必须覆盖岩石', () => {
  const { g } = fresh();
  assert.equal(g.canPlace('farm', 40, 40).reason, '需先购买该地块');
  let water = null;
  for (let i = 0; i < g.map.terrain.length && !water; i++) {
    const x = i % 64;
    const z = Math.floor(i / 64);
    if (g.map.terrain[i] === T.water && g.map.ownerAt(x, z) === 1) water = { x, z };
  }
  assert.ok(water, '起始区应有池塘');
  assert.equal(g.canPlace('pump', water.x, water.z).reason, '不能建在水上');
  const s = spotNear(g, 'farm');
  assert.match(g.canPlace('quarry', s.x, s.z).reason, /岩石/);
});

test('加工链:食品厂消耗谷物+净水产出食物', () => {
  const { g, e } = fresh();
  g.res.money = 9999;
  g.res.grain = 10;
  g.res.water = 10;
  const s = spotNear(g, 'foodFactory');
  const r = g.placeBuilding('foodFactory', s.x, s.z, 'player');
  assert.ok(r.ok, r.reason);
  const food0 = g.res.food;
  run(e, 10 + 10 + 1);
  assert.ok(g.res.food >= food0 + 2, `食物应增加,实际 ${g.res.food}`);
  assert.ok(g.res.grain <= 8);
});

test('科研:科研点不足不能研究;足够时扣除并按时完成', () => {
  const { g, e } = fresh();
  assert.equal(g.startResearch('mining').ok, false);
  g.res.research = 15;
  assert.ok(g.startResearch('mining').ok);
  assert.equal(g.res.research, 0);
  run(e, 20);
  assert.ok(g.techs.has('mining'));
  assert.ok(g.isUnlocked('ironMine'));
});

test('地块购买:只能买相邻地块,价格递增', () => {
  const { g } = fresh();
  g.res.money = 99999;
  assert.equal(g.buyChunk(4, 4).ok, false);
  const p1 = g.map.chunkPrice();
  assert.ok(g.buyChunk(3, 5).ok);
  assert.ok(g.map.chunkPrice() > p1);
  assert.equal(g.buyChunk(3, 5).ok, false, '重复购买应被拒绝');
});

test('拆除返还 50%,指挥中心不可拆', () => {
  const { g, e } = fresh();
  const s = spotNear(g, 'farm');
  const r = g.placeBuilding('farm', s.x, s.z);
  run(e, 10);
  const money = g.res.money;
  assert.ok(g.demolish(r.building.uid).ok);
  assert.equal(g.res.money, money + 25);
  assert.equal(g.demolish(g.playerHQ().uid).ok, false);
});

test('升级:扣费、进度完成后等级 +1,满级拒绝', () => {
  const { g, e } = fresh();
  g.res.money = 99999;
  g.res.wood = 999;
  const s = spotNear(g, 'farm');
  const r = g.placeBuilding('farm', s.x, s.z);
  run(e, 9);
  assert.ok(g.upgrade(r.building.uid).ok);
  assert.equal(g.upgrade(r.building.uid).ok, false, '升级中不能重复升级');
  run(e, 20);
  assert.equal(r.building.level, 2);
});

test('集市只卖勾选货物并获得金币', () => {
  const { g, e } = fresh();
  g.res.money = 9999;
  g.res.planks = 50;
  const s = spotNear(g, 'market');
  const r = g.placeBuilding('market', s.x, s.z);
  run(e, 9);
  r.building.sell.add('planks');
  const m0 = g.res.money;
  const wood0 = g.res.wood;
  run(e, 8);
  assert.ok(g.res.planks < 50);
  assert.ok(g.res.money > m0);
  assert.equal(g.res.wood, wood0, '未勾选的货物不应被卖出');
});

test('地图:起始区有森林/岩石/水,地面单位可经浅滩从玩家基地走到敌军基地', () => {
  const { g } = fresh();
  const m = g.map;
  const inStart = (t) => {
    for (let z = 40; z < 56; z++) for (let x = 8; x < 24; x++) if (m.t(x, z) === t) return true;
    return false;
  };
  assert.ok(inStart(T.forest) && inStart(T.rock) && inStart(T.water));
  const seen = new Uint8Array(64 * 64);
  const q = [[PLAYER_HQ.x + 1, PLAYER_HQ.z + 4]];
  seen[m.idx(...q[0])] = 1;
  for (let i = 0; i < q.length; i++) {
    const [x, z] = q[i];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      if (m.inside(nx, nz) && !seen[m.idx(nx, nz)] && m.t(nx, nz) !== T.water) {
        seen[m.idx(nx, nz)] = 1;
        q.push([nx, nz]);
      }
    }
  }
  assert.ok(seen[m.idx(44, 18)], '敌军基地附近应可达');
});
