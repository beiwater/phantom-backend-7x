// 古代遗迹:断裂石柱 + 苔藓 + 发光宝箱(1×1 格,8 体素/格)。
import { VoxelModel } from '../engine/voxel.js';
import { C } from './common.js';

export function buildRuinModel(variant = 0) {
  const m = new VoxelModel();
  const moss = (x, y, z) => ((x * 7 + y * 3 + z * 5) % 4 === 0 ? C.leafDark : null);
  m.box(0, 0, 0, 8, 1, 8, (x, y, z) => ((x + z) % 3 === 0 ? C.stoneDark : C.stone));
  const cols = variant % 2 ? [[1, 1, 5], [6, 1, 3], [1, 6, 2], [6, 6, 6]] : [[1, 1, 6], [6, 1, 2], [1, 6, 4], [6, 6, 3]];
  for (const [x, z, h] of cols) {
    m.box(x, 1, z, 1, h, 1, C.stoneLight);
    m.box(x, 1, z, 1, h, 1, moss);
    if (h > 4) m.box(x - 1, h + 1, z, 3, 1, 1, C.stone);
  }
  m.box(2, 1, 6, 3, 1, 1, C.stoneDark);
  // 宝箱:木箱 + 金色发光锁扣
  m.box(3, 1, 3, 2, 2, 2, C.woodDark);
  m.box(3, 3, 3, 2, 1, 2, C.wood);
  m.set(4, 2, 5, C.yellow, true);
  m.set(3, 2, 5, C.yellow, true);
  m.labelY = 8;
  return m;
}
