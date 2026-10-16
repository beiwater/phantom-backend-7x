// 锁步联机(合作模式)验证:两个独立实例各自下达命令,经带延迟的通道交换,逐 tick 状态一致。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/sim/state.js';
import { Economy } from '../src/sim/economy.js';
import { SimLoop } from '../src/sim/loop.js';
import { LockstepTransport, memoryChannelPair } from '../src/net/lockstep.js';
import { mulberry32 } from '../src/engine/util.js';

function peer(id, channel) {
  const g = new Game(5);
  g.players = ['alice', 'bob'];
  g.localId = id;
  g.setupStart();
  g.transport = new LockstepTransport(g, channel, { delay: 3 });
  return { g, loop: new SimLoop(g, new Economy(g), null) };
}

test('锁步合作:两端随机命令 + 网络延迟,每 100 tick 校验和一致,未到齐时停步等待', () => {
  const [ca, cb] = memoryChannelPair();
  const A = peer('alice', ca);
  const B = peer('bob', cb);
  const rndA = mulberry32(1);
  const rndB = mulberry32(2);
  const types = ['farm', 'house', 'lumber', 'pump', 'market', 'academy'];
  const act = (side, rnd) => {
    const r = rnd();
    if (r < 0.04) side.g.dispatch({ type: 'build', building: types[Math.floor(rnd() * types.length)], x: 8 + Math.floor(rnd() * 16), z: 40 + Math.floor(rnd() * 16), autoRoad: true });
    else if (r < 0.05) side.g.dispatch({ type: 'research', tech: 'mining' });
    else if (r < 0.06) side.g.dispatch({ type: 'roads', cells: [[8 + Math.floor(rnd() * 16), 40 + Math.floor(rnd() * 16)]] });
  };
  for (let step = 0; step < 3000; step++) {
    act(A, rndA);
    act(B, rndB);
    A.loop.stepTick();
    B.loop.stepTick();
    // 每两轮才投递一次,模拟网络抖动;delay=3 时偶尔会等待
    if (step % 2 === 1) { ca.deliver(); cb.deliver(); }
    if (A.g.tick === B.g.tick && A.g.tick % 100 === 0) assert.equal(A.g.checksum(), B.g.checksum(), `tick ${A.g.tick} 不同步`);
  }
  ca.deliver(); cb.deliver();
  while (A.g.tick < B.g.tick) A.loop.stepTick();
  while (B.g.tick < A.g.tick) B.loop.stepTick();
  assert.equal(A.g.checksum(), B.g.checksum());
  assert.ok(A.g.buildings.size > 3, '双方命令都应生效');
  const issuers = new Set(A.g.transport.log.map((l) => l.cmd.p));
  assert.deepEqual([...issuers].sort(), ['alice', 'bob']);
  assert.ok(A.g.tick > 2500, `应基本保持推进,实际 ${A.g.tick}`);
});

test('锁步:对端命令未到时停在当前 tick', () => {
  const [ca, cb] = memoryChannelPair();
  const A = peer('alice', ca);
  peer('bob', cb);
  for (let i = 0; i < 3; i++) assert.ok(A.loop.stepTick(), '前 delay 个 tick 无需等待');
  assert.equal(A.loop.stepTick(), false, 'bob 的第 3 tick 包未到');
  assert.equal(A.g.tick, 3);
});
