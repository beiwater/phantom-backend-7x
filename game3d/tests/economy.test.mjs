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
  for (let t = 0; t < seconds; t += step) { e.game.time += step; e.step(step); }
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

test('命令总线 + 固定步长:同一命令日志回放得到完全相同的状态校验和', async () => {
  const { SimLoop } = await import('../src/sim/loop.js');
  const { ReplayTransport } = await import('../src/net/transport.js');
  const play = () => {
    const g = new Game(11);
    g.setupStart();
    return { g, loop: new SimLoop(g, new Economy(g), null) };
  };
  const a = play();
  a.g.res.money = 5000;
  a.g.res.wood = 200;
  for (let i = 0; i < 400; i++) {
    if (i === 3) {
      const s = spotNear(a.g, 'farm');
      assert.ok(a.g.dispatch({ type: 'build', building: 'farm', x: s.x, z: s.z }).ok);
    }
    if (i === 50) {
      const s = spotNear(a.g, 'house');
      assert.ok(a.g.dispatch({ type: 'build', building: 'house', x: s.x, z: s.z }).ok);
    }
    if (i === 60) assert.equal(a.g.dispatch({ type: 'build', building: 'farm', x: 60, z: 2 }).ok, false);
    a.loop.stepTick();
  }
  const log = a.g.transport.log;
  assert.equal(log.length, 2, '只有成功的命令进入日志');
  const b = play();
  b.g.res.money = 5000;
  b.g.res.wood = 200;
  b.g.transport = new ReplayTransport(b.g, log);
  for (let i = 0; i < 400; i++) b.loop.stepTick();
  assert.equal(b.g.checksum(), a.g.checksum());
  assert.equal(b.g.dispatch({ type: 'build', building: 'farm', x: 1, z: 1 }).ok, false, '回放中拒绝本地操作');
});

test('命令校验:不能操作他人建筑,未知命令被拒绝', () => {
  const { g } = fresh();
  const hq = g.playerHQ();
  assert.equal(g.transport.send({ type: 'upgrade', p: 'enemy', uid: hq.uid }).ok, false);
  assert.equal(g.dispatch({ type: 'teleport' }).ok, false);
  assert.equal(g.dispatch({ type: 'build', building: 'nope', x: 1, z: 1 }).ok, false);
});

test('相邻协同:农场紧贴水泵站获得 +10%,不相邻无加成', async () => {
  const { synergyAt } = await import('../src/sim/synergy.js');
  const { g } = fresh();
  g.res.money = 9999;
  g.res.wood = 999;
  const s = spotNear(g, 'farm');
  g.placeBuilding('farm', s.x, s.z, 'player', { instant: true });
  const before = synergyAt(g, 'pump', s.x + 2, s.z, 1, 1);
  assert.equal(before.bonus, 0.1);
  assert.deepEqual(before.partners, ['farm']);
  assert.equal(synergyAt(g, 'pump', s.x + 5, s.z + 5, 1, 1).bonus, 0);
});

test('动态市场:抛售压低价格,随时间回升', () => {
  const { g, e } = fresh();
  const m = e.market;
  const first = m.sell('planks', 20);
  const second = m.sell('planks', 20);
  assert.ok(second < first, '连续抛售收入应下降');
  const low = m.mult.planks;
  m.shockT = 1e9;
  run(e, 60);
  assert.ok(m.mult.planks > low, '价格应回升');
  void g;
});

test('民心:民居被污染源包围时下降,断粮更低', () => {
  const { g, e } = fresh();
  g.res.money = 99999;
  const s = spotNear(g, 'house');
  g.placeBuilding('house', s.x, s.z, 'player', { instant: true });
  e.recomputeStats();
  for (let i = 0; i < 30; i++) e.society.recompute();
  const clean = e.society.happiness;
  g.techs.add('gunpowder');
  g.res.steel = 999;
  g.res.concrete = 999;
  let placed = 0;
  for (let z = s.z - 3; z <= s.z + 2 && placed < 2; z++) {
    for (let x = s.x - 3; x <= s.x + 2 && placed < 2; x++) {
      if (g.placeBuilding('munitions', x, z, 'player', { instant: true }).ok) placed++;
    }
  }
  assert.ok(placed > 0, '应能在民居旁放置污染源');
  for (let i = 0; i < 30; i++) e.society.recompute();
  assert.ok(e.society.happiness < clean, `污染后民心应下降 ${clean} → ${e.society.happiness}`);
});

test('政策:时代限制槽数,首次免费,替换收费且有冷却,效果计入 effect()', () => {
  const { g } = fresh();
  assert.equal(g.dispatch({ type: 'policy', slot: 1, id: 'levy' }).ok, false, '拓荒时代只有 1 个槽');
  assert.equal(g.dispatch({ type: 'policy', slot: 0, id: 'welfare' }).ok, false, '工业时代政策不可用');
  const money = g.res.money;
  assert.ok(g.dispatch({ type: 'policy', slot: 0, id: 'freeMarket' }).ok);
  assert.equal(g.res.money, money);
  assert.ok(Math.abs(g.effect('marketPrice') - 0.2) < 1e-9);
  assert.equal(g.dispatch({ type: 'policy', slot: 0, id: 'planned' }).ok, false, '冷却中');
  g.time += 61;
  assert.ok(g.dispatch({ type: 'policy', slot: 0, id: 'planned' }).ok);
  assert.equal(g.res.money, money - 150);
});

test('贸易合同:库存不足拒绝且不扣货;交付后发奖并移除(重复交付被拒)', () => {
  const { g, e } = fresh();
  const c = e.contracts;
  c.spawnT = 0;
  run(e, 0.2);
  assert.equal(c.offers.length, 1);
  const o = c.offers[0];
  g.res[o.res] = o.qty - 1;
  assert.equal(g.dispatch({ type: 'deliver', id: o.id }).ok, false);
  assert.equal(g.res[o.res], o.qty - 1);
  g.res[o.res] = o.qty;
  const money = g.res.money;
  assert.ok(g.dispatch({ type: 'deliver', id: o.id }).ok);
  assert.equal(g.res[o.res], 0);
  assert.equal(g.res.money, money + o.reward.money);
  assert.equal(g.dispatch({ type: 'deliver', id: o.id }).ok, false);
});

test('暂停生产:不占工人、不消耗原料;科技胜利在研究全部科技 + 3 级研究所后触发', async () => {
  const { TECH_IDS } = await import('../src/data/tech.js');
  const { g, e } = fresh();
  g.res.money = 9999;
  g.res.grain = 10;
  g.res.water = 10;
  const s = spotNear(g, 'foodFactory');
  const r = g.placeBuilding('foodFactory', s.x, s.z, 'player', { instant: true });
  assert.ok(g.dispatch({ type: 'togglePause', uid: r.building.uid }).ok);
  run(e, 15);
  assert.equal(g.res.grain, 10);
  assert.equal(g.stats.workersNeeded, 0);
  for (const id of TECH_IDS) g.techs.add(id);
  g.era = 3;
  run(e, 2);
  assert.equal(g.over, null, '缺研究所时不应胜利');
  g.res.electronics = 99; g.res.steel = 99; g.res.concrete = 99;
  let lab = null;
  for (let z = 40; z < 56 && !lab; z++) for (let x = 8; x < 24 && !lab; x++) { const p = g.placeBuilding('lab', x, z, 'player', { instant: true, level: 3 }); if (p.ok) lab = p.building; }
  assert.ok(lab);
  run(e, 2);
  assert.equal(g.over, 'win');
  assert.equal(g.victoryKind, 'science');
});

test('古代遗迹:按种子确定性生成于无主地块;单位靠近只领取一次,遗迹格不可建造', () => {
  const { g, e } = fresh();
  const again = new Game(7);
  assert.deepEqual(g.ruins.list.map((r) => [r.x, r.z]), again.ruins.list.map((r) => [r.x, r.z]));
  assert.ok(g.ruins.list.length >= 6);
  const r = g.ruins.list[0];
  assert.equal(g.map.ownerAt(r.x, r.z), 0);
  g.unitSystem = { units: [{ team: 'player', x: r.x + 0.5, z: r.z + 0.5 }], spawnUnit() {} };
  run(e, 0.2);
  assert.ok(r.claimed);
  assert.equal(g.counters.ruins, 1);
  run(e, 1);
  assert.equal(g.counters.ruins, 1, '不可重复领取');
  assert.equal(g.canPlace('house', g.ruins.list[1].x, g.ruins.list[1].z, 'enemy').reason, '古代遗迹(派单位探索)');
});

test('专精模块:未满 3 级拒绝;环保模块消除污染;重复安装不重复扣费', async () => {
  const { g, e } = fresh();
  g.res.money = 99999; g.res.concrete = 99; g.res.steel = 99; g.res.planks = 99; g.res.stone = 99;
  g.techs.add('metallurgy');
  let mill = null;
  for (let z = 40; z < 56 && !mill; z++) for (let x = 8; x < 24 && !mill; x++) { const p = g.placeBuilding('cement', x, z, 'player', { instant: true }); if (p.ok) mill = p.building; }
  assert.equal(g.dispatch({ type: 'setModule', uid: mill.uid, module: 'eco' }).ok, false);
  mill.level = 3;
  const before = g.res.money;
  assert.ok(g.dispatch({ type: 'setModule', uid: mill.uid, module: 'eco' }).ok);
  assert.equal(g.res.money, before - 250);
  assert.equal(g.dispatch({ type: 'setModule', uid: mill.uid, module: 'eco' }).ok, false);
  assert.equal(g.res.money, before - 250);
  assert.equal(e.society.pollutionAt(mill.x - 1, mill.z), 0);
});

test('多种子地图:起始区资源齐全,地面可达敌军基地,矿/煤/油总量足够', () => {
  for (const [seed, type] of [1, 2, 3, 42, 99, 1234, 31337].flatMap((sd) => ['river', 'lakes', 'highlands'].map((t) => [sd, t]))) {
    const g = new Game(seed, 'normal', type);
    g.setupStart();
    const m = g.map;
    const count = (t) => m.terrain.reduce((s, v) => s + (v === t ? 1 : 0), 0);
    for (const t of [T.ore, T.coal, T.oil]) assert.ok(count(t) >= 15, `seed ${seed}/${type} 资源 ${t} 太少`);
    const seen = new Uint8Array(64 * 64);
    const q = [[PLAYER_HQ.x + 1, PLAYER_HQ.z + 4]];
    seen[m.idx(...q[0])] = 1;
    for (let i = 0; i < q.length; i++) {
      const [x, z] = q[i];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const nz = z + dz;
        if (m.inside(nx, nz) && !seen[m.idx(nx, nz)] && m.t(nx, nz) !== T.water) { seen[m.idx(nx, nz)] = 1; q.push([nx, nz]); }
      }
    }
    assert.ok(seen[m.idx(44, 18)], `seed ${seed}/${type} 敌军基地不可达`);
    if (type === 'lakes') assert.ok(count(T.water) > 60, '湖泽应有大量水域');
    if (type === 'highlands') assert.ok(count(T.rock) > 300, '高地应有大量岩石');
  }
});

test('自动铺路:远离路网的建筑一并铺出最短道路并连通;资源不足时整体不执行', () => {
  const { g, e } = fresh();
  g.res.money = 5000; g.res.stone = 200; g.res.wood = 200;
  let spot = null;
  for (let z = 52; z < 56 && !spot; z++) for (let x = 8; x < 14 && !spot; x++) if (g.canPlace('farm', x, z).ok) spot = { x, z };
  const roads0 = g.map.road.reduce((s, v) => s + v, 0);
  const poor = { ...g.res };
  g.res.stone = 0;
  assert.equal(g.dispatch({ type: 'build', building: 'farm', x: spot.x, z: spot.z, autoRoad: true }).ok, false);
  assert.equal(g.map.road.reduce((s, v) => s + v, 0), roads0, '失败时不应铺任何路');
  g.res.stone = poor.stone;
  const r = g.dispatch({ type: 'build', building: 'farm', x: spot.x, z: spot.z, autoRoad: true });
  assert.ok(r.ok, r.reason);
  assert.ok(r.roads > 0);
  assert.equal(g.map.road.reduce((s, v) => s + v, 0), roads0 + r.roads);
  run(e, 1);
  assert.ok(r.building.connected, '自动铺路后应连通');
});

test('评审修复:不能冒充他人下令;未知 id 不崩溃;免费道路拆除不退款;拆兵营退还训练预付', () => {
  const { g, e } = fresh();
  assert.equal(g.transport.send({ type: 'train', p: 'enemy', uid: 1, unit: 'militia' }).ok, false);
  const forged = g.dispatch({ type: 'demolish', p: 'enemy', uid: g.playerHQ().uid });
  assert.equal(forged.ok, false, '冒充字段被覆盖为本地玩家,HQ 仍不可拆');
  for (const cmd of [{ type: 'research', tech: 'nope' }, { type: 'build', building: 'constructor', x: 1, z: 1 }, { type: 'policy', slot: 0, id: '__proto__' }, { type: 'constructor' }, { type: 'setModule', uid: 1, module: 'toString' }]) {
    assert.equal(g.dispatch(cmd).ok, false, JSON.stringify(cmd));
  }
  run(e, 0.2);
  const hq = g.playerHQ();
  const m0 = g.res.money;
  assert.ok(g.removeRoad(hq.x - 2, hq.z + 3).ok);
  assert.equal(g.res.money, m0, '起始免费道路拆除不退款');
  g.res.money = 9999; g.res.planks = 99; g.res.stone = 99; g.res.food = 99;
  g.techs.add('drill');
  let bar = null;
  for (let z = 40; z < 56 && !bar; z++) for (let x = 8; x < 24 && !bar; x++) { const p = g.placeBuilding('barracks', x, z, 'player', { instant: true }); if (p.ok) bar = p.building; }
  bar.trainQueue = ['militia', 'militia'];
  bar.trainPaid = [1, 1];
  const before = g.res.money;
  assert.ok(g.demolish(bar.uid).ok);
  assert.equal(g.res.money, before + 40 + 60, '退还 2 个民兵 + 50% 建筑金币');
});

test('军队补给:按单位扣食物/燃油;不足时标记补给不足并清零,恢复后解除', async () => {
  const { supplied } = await import('../src/sim/upkeep.js');
  const { g, e } = fresh();
  const units = [{ team: 'player', type: 'militia' }, { team: 'player', type: 'rifleman' }, { team: 'player', type: 'tank' }, { team: 'enemy', type: 'tank' }];
  g.unitSystem = { units };
  g.res.food = 10;
  g.res.fuel = 0;
  run(e, 30.1);
  assert.equal(g.res.food, 8, '两名步兵各消耗 1 食物');
  assert.equal(g.supply.food, true);
  assert.equal(g.supply.fuel, false);
  assert.equal(supplied(g, units[2]), false);
  assert.equal(supplied(g, units[0]), true);
  assert.equal(supplied(g, units[3]), true, '敌军不受玩家补给影响');
  g.res.fuel = 5;
  run(e, 30);
  assert.equal(g.supply.fuel, true);
});

test('伟人:点数达阈值诞生,使用一次即消耗(重复使用被拒),科学家完成当前研究', () => {
  const { g, e } = fresh();
  g.counters.researchMade = 100;
  run(e, 1.1);
  assert.deepEqual(g.great.ready, ['scientist']);
  g.res.research = 15;
  g.dispatch({ type: 'research', tech: 'mining' });
  assert.ok(g.dispatch({ type: 'useGreat', i: 0 }).ok);
  assert.ok(g.techs.has('mining'));
  assert.equal(g.dispatch({ type: 'useGreat', i: 0 }).ok, false);
  run(e, 2);
  assert.equal(g.great.ready.length, 0, '同一点数不会再次诞生');
  assert.ok(g.great.threshold('scientist') > 100);
});

test('桥梁:工程学前不可架桥;架桥收钢材且使水面可通行,拆除按桥梁价退一半', () => {
  const { g } = fresh();
  let w = null;
  for (let i = 0; i < g.map.terrain.length && !w; i++) {
    const x = i % 64;
    const z = Math.floor(i / 64);
    if (g.map.terrain[i] === T.water && g.map.ownerAt(x, z) === 1) w = { x, z };
  }
  g.res.steel = 10;
  assert.match(g.canRoad(w.x, w.z).reason, /工程学/);
  assert.equal(g.map.walkable(w.x, w.z), false);
  g.techs.add('engineering');
  const m0 = g.res.money;
  assert.ok(g.dispatch({ type: 'roads', cells: [[w.x, w.z]] }).ok);
  assert.equal(g.res.money, m0 - 30);
  assert.equal(g.res.steel, 8);
  assert.equal(g.map.walkable(w.x, w.z), true);
  assert.ok(g.removeRoad(w.x, w.z).ok);
  assert.equal(g.res.money, m0 - 15);
  assert.equal(g.res.steel, 9);
});

test('国家工程:按需投入(只扣实际需要的部分),完工后永久加成且不能再投,太空计划直接科技胜利', () => {
  const { g } = fresh();
  g.res.food = 100; g.res.planks = 500; g.res.money = 5000;
  assert.ok(g.dispatch({ type: 'fund', id: 'granary' }).ok);
  assert.equal(g.res.planks, 400, '木板只扣 100');
  assert.equal(g.res.food, 0);
  assert.equal(g.projects.done.has('granary'), false);
  g.res.food = 80;
  assert.ok(g.dispatch({ type: 'fund', id: 'granary' }).ok);
  assert.equal(g.res.food, 30);
  assert.ok(g.projects.done.has('granary'));
  assert.ok(g.effect('housing') >= 0.1);
  assert.equal(g.dispatch({ type: 'fund', id: 'granary' }).ok, false);
  assert.equal(g.dispatch({ type: 'fund', id: 'spaceport' }).reason, '时代不足');
  g.era = 3;
  Object.assign(g.res, { electronics: 200, steel: 400, fuel: 200, money: 9000 });
  assert.ok(g.dispatch({ type: 'fund', id: 'spaceport' }).ok);
  assert.equal(g.over, 'win');
  assert.equal(g.victoryKind, 'science');
  assert.equal(g.dispatch({ type: 'fund', id: 'nope' }).ok, false);
});

test('研究队列:排队需前置已规划,完成后自动开始下一项(科研点不足时等待)', () => {
  const { g, e } = fresh();
  g.res.research = 15;
  assert.ok(g.dispatch({ type: 'research', tech: 'mining' }).ok);
  assert.ok(g.dispatch({ type: 'queueResearch', tech: 'metallurgy' }).ok, '前置在研即可排队');
  assert.equal(g.dispatch({ type: 'queueResearch', tech: 'industry' }).ok, true, '前置已在队列中');
  assert.equal(g.dispatch({ type: 'queueResearch', tech: 'aviation' }).ok, false);
  run(e, 10);
  assert.ok(g.techs.has('mining'));
  assert.equal(g.researching, null, '科研点不足时等待');
  g.res.research = 35;
  run(e, 0.2);
  assert.equal(g.researching?.id, 'metallurgy');
  assert.deepEqual(g.researchQueue, ['industry']);
});

test('加速:按剩余时间收费,下一 tick 完工;已完工建筑不可加速', async () => {
  const { rushCost } = await import('../src/sim/economy.js');
  const { g, e } = fresh();
  const s = spotNear(g, 'farm');
  const r = g.placeBuilding('farm', s.x, s.z);
  const cost = rushCost(r.building);
  assert.equal(cost, 24, '8 秒 × 3 × 1 级');
  const m0 = g.res.money;
  assert.ok(g.dispatch({ type: 'rush', uid: r.building.uid }).ok);
  assert.equal(g.res.money, m0 - 24);
  run(e, 0.1);
  assert.equal(r.building.state, 'active');
  assert.equal(g.dispatch({ type: 'rush', uid: r.building.uid }).ok, false);
});
