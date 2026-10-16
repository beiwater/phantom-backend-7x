// 单位与货车:以 1/16 比例构建(16 体素 = 1 格),朝向 +z。
// body.footW/footD = N/8,游戏用 toGeometry({footW, footD, scale: 1/16}) 居中;
// top 部件的原点即旋转轴(footW=footD=0)。
import { C, shade, finish, newModel, teamColors, cylX } from './common.js';

const SKIN = 0xf0c8a0;

function soldier(kind, t) {
  const m = newModel();
  const uniform = t.primary;
  const pants = kind === 'militia' ? 0x6a5236 : t.dark;
  for (const x of [2, 4]) {
    m.box(x, 0, 3, 1, 1, 1, C.black);
    m.box(x, 1, 3, 1, 2, 1, pants);
  }
  m.box(1, 3, 2, 5, 4, 3, (x, y) => {
    if (y === 3) return kind === 'militia' ? C.woodDark : C.black;
    if (x === 1 || x === 5) return y === 3 ? SKIN : shade(uniform, 0.85);
    return uniform;
  });
  m.set(1, 3, 3, SKIN);
  m.set(5, 3, 3, SKIN);
  m.box(2, 7, 2, 3, 2, 3, SKIN);
  m.set(2, 8, 4, C.black);
  m.set(4, 8, 4, C.black);
  if (kind === 'militia') {
    // 布头巾 + 长矛
    m.box(2, 9, 2, 3, 1, 3, t.secondary === 0x2a2a2e ? 0x4a3a30 : C.khaki);
    m.box(2, 8, 2, 3, 1, 1, t.primary);
    m.box(6, 1, 4, 1, 10, 1, C.wood);
    m.box(6, 11, 4, 1, 2, 1, C.stoneLight);
    m.set(5, 5, 4, SKIN);
    m.box(1, 4, 1, 3, 2, 1, C.woodDark);
  } else {
    // 钢盔 + 步枪平端 + 背包
    m.box(1, 9, 1, 5, 1, 5, t.dark);
    m.box(2, 10, 2, 3, 1, 3, t.dark);
    m.set(3, 10, 2, t.primary);
    m.box(4, 5, 5, 1, 1, 4, C.iron);
    m.set(4, 4, 5, C.woodDark);
    m.set(4, 5, 4, SKIN);
    m.set(4, 6, 8, C.iron);
    m.box(2, 4, 1, 3, 3, 1, C.olive);
  }
  return m;
}

function tank(t) {
  const body = newModel();
  for (const x of [2, 11]) {
    body.box(x, 0, 1, 3, 3, 14, (i, j, k) => (j === 1 && k % 3 === 1 && i !== x + 1 ? C.steelDark : C.iron));
    body.box(x, 3, 1, 3, 1, 14, shade(t.primary, 0.7));
  }
  body.box(5, 1, 2, 6, 4, 12, t.primary);
  body.box(4, 5, 2, 8, 1, 12, (i, j, k) => (k >= 12 ? shade(t.primary, 0.85) : t.primary));
  body.box(5, 4, 14, 6, 1, 1, shade(t.primary, 0.8));
  body.set(5, 5, 13, C.winCool, true);
  body.set(10, 5, 13, C.winCool, true);
  body.box(6, 6, 2, 4, 1, 2, C.steelDark);
  const top = newModel();
  top.box(-4, 0, -4, 8, 3, 8, (x, y) => (y === 1 ? t.secondary : t.primary));
  top.box(-3, 3, -3, 6, 1, 6, shade(t.primary, 0.9));
  top.box(-1, 4, -2, 2, 1, 2, C.steelDark);
  top.box(-1, 1, 4, 2, 2, 6, C.iron);
  top.box(-1, 1, 10, 2, 2, 2, C.black);
  top.box(3, 3, -3, 1, 5, 1, C.steel);
  return finishUnit(body, 16, top, 6);
}

function artillery(t) {
  const body = newModel();
  // 分叉大架向后收拢
  for (let z = 0; z < 8; z++) {
    const off = Math.round((7 - z) * 0.45);
    body.box(4 + off, 1, z, 2, 1, 1, t.dark);
    body.box(10 - off, 1, z, 2, 1, 1, t.dark);
  }
  body.box(4, 0, 0, 8, 1, 1, C.iron);
  body.box(3, 2, 7, 10, 2, 3, t.primary);
  for (const x of [1, 13]) {
    for (let j = 0; j < 6; j++) {
      for (let k = 0; k < 6; k++) {
        const d = Math.hypot(j - 2.5, k - 2.5);
        if (d > 3) continue;
        body.box(x, j, 6 + k, 2, 1, 1, d < 1.2 ? C.steel : d > 2.2 ? C.black : C.iron);
      }
    }
  }
  const top = newModel();
  top.box(-3, 0, -2, 6, 3, 4, t.primary);
  top.box(-5, 0, 2, 10, 5, 1, (x, y) => (y === 4 ? t.secondary : shade(t.primary, 0.9)));
  for (let i = 0; i < 14; i++) top.box(-1, 2 + Math.floor(i * 0.45), i - 2, 2, 2, 1, i >= 12 ? C.black : C.iron);
  return finishUnit(body, 16, top, 4);
}

function helicopter(t) {
  const body = newModel();
  body.box(5, 2, 5, 6, 5, 10, (x, y, z) => (y === 4 ? t.dark : t.primary));
  body.box(6, 7, 7, 4, 1, 6, t.primary);
  body.box(6, 4, 14, 4, 3, 2, C.glass);
  body.box(6, 5, 15, 4, 1, 1, C.winCool, true);
  body.box(6, 2, 15, 4, 2, 1, shade(t.primary, 0.8));
  body.box(7, 5, 0, 2, 2, 5, t.primary);
  body.box(7, 7, 0, 2, 4, 2, t.dark);
  cylX(body, 9, 1, 8.5, 1, 2, C.steelDark);
  for (const x of [3, 12]) {
    body.box(x, 0, 4, 1, 1, 11, C.iron);
    body.box(x, 1, 7, 1, 1, 1, C.iron);
    body.box(x, 1, 12, 1, 1, 1, C.iron);
  }
  body.box(2, 4, 9, 12, 1, 2, t.dark);
  for (const x of [2, 13]) body.box(x, 3, 8, 1, 1, 4, C.black);
  body.box(7, 8, 9, 2, 2, 2, C.steelDark);
  const top = newModel();
  top.box(-1, 0, -1, 2, 2, 2, C.iron);
  top.box(-11, 1, -1, 22, 1, 2, (x) => (Math.abs(x + 0.5) > 9 ? t.primary : C.black));
  top.box(-1, 1, -11, 2, 1, 22, (x, y, z) => (Math.abs(z + 0.5) > 9 ? t.primary : C.black));
  return finishUnit(body, 16, top, 10);
}

function finishUnit(body, n, top = null, topY = 0) {
  finish(body, [], { footW: n / 8, footD: n / 8 });
  if (top) finish(top, [], { footW: 0, footD: 0 });
  return top ? { body, top, topY } : { body };
}

export function unit(unitId, team) {
  const t = teamColors(team);
  switch (unitId) {
    case 'militia': return finishUnit(soldier('militia', t), 7);
    case 'rifleman': return finishUnit(soldier('rifleman', t), 7);
    case 'tank': return tank(t);
    case 'artillery': return artillery(t);
    case 'helicopter': return helicopter(t);
    default: return finishUnit(soldier('militia', t), 7);
  }
}

// 运货卡车:驾驶室阵营色 + 木板货厢装箱
export function truck(team) {
  const t = teamColors(team);
  const m = newModel();
  m.box(2, 1, 0, 8, 1, 12, C.steelDark);
  for (const z of [2, 9]) for (const x of [1, 9]) m.box(x, 0, z, 2, 2, 2, C.black);
  m.box(2, 2, 8, 8, 4, 4, t.primary);
  m.box(3, 4, 11, 6, 2, 1, C.glass);
  m.box(3, 5, 11, 6, 1, 1, C.winCool, true);
  m.box(2, 2, 11, 1, 1, 1, C.lamp, true);
  m.box(9, 2, 11, 1, 1, 1, C.lamp, true);
  m.box(2, 6, 8, 8, 1, 3, shade(t.primary, 0.85));
  m.box(2, 2, 0, 8, 1, 8, C.woodDark);
  m.box(2, 3, 0, 1, 2, 8, C.wood);
  m.box(9, 3, 0, 1, 2, 8, C.wood);
  m.box(2, 3, 0, 8, 2, 1, C.wood);
  m.box(3, 3, 1, 3, 3, 3, C.woodLight);
  m.box(6, 3, 4, 3, 2, 3, 0xd8a838);
  m.box(3, 6, 1, 3, 1, 3, shade(C.woodLight, 0.85));
  return finish(m, [], { footW: 12 / 8, footD: 12 / 8 });
}
