// 地图:64×64 格,8×8 地块(chunk)。地形 + 地块归属 + 占用(建筑/道路)。
// 布局:玩家起于西南,敌军要塞在东北,中间有一条带浅滩的河流形成天然战线。
import { makeNoise, mulberry32 } from '../engine/util.js';

export const MAP_W = 64;
export const MAP_H = 64;
export const CHUNK = 8;
export const CHUNKS_X = MAP_W / CHUNK;
export const CHUNKS_Z = MAP_H / CHUNK;

export const T = { grass: 0, forest: 1, rock: 2, ore: 3, coal: 4, oil: 5, water: 6, sand: 7 };
export const T_NAMES = ['草地', '森林', '岩石', '铁矿脉', '煤层', '油田', '水域', '沙地'];
export const OWNER = { none: 0, player: 1, enemy: 2 };

export const PLAYER_CHUNKS = [[1, 5], [2, 5], [1, 6], [2, 6]];
export const ENEMY_CHUNKS = [[5, 1], [6, 1], [5, 2], [6, 2]];
export const PLAYER_HQ = { x: 14, z: 46 };
export const ENEMY_HQ = { x: 47, z: 14 };

export class GameMap {
  constructor(seed = 7) {
    this.seed = seed;
    this.terrain = new Uint8Array(MAP_W * MAP_H);
    this.chunkOwner = new Uint8Array(CHUNKS_X * CHUNKS_Z);
    /** 占用该格的建筑 uid,0 = 空 */
    this.building = new Int32Array(MAP_W * MAP_H);
    /** 1 = 道路 */
    this.road = new Uint8Array(MAP_W * MAP_H);
    this.version = 0;
    this.generate();
  }

  idx(x, z) { return z * MAP_W + x; }
  inside(x, z) { return x >= 0 && z >= 0 && x < MAP_W && z < MAP_H; }
  t(x, z) { return this.inside(x, z) ? this.terrain[this.idx(x, z)] : T.water; }

  chunkOf(x, z) { return [Math.floor(x / CHUNK), Math.floor(z / CHUNK)]; }
  ownerAt(x, z) {
    if (!this.inside(x, z)) return OWNER.none;
    const [cx, cz] = this.chunkOf(x, z);
    return this.chunkOwner[cz * CHUNKS_X + cx];
  }
  chunkOwnerAt(cx, cz) { return this.chunkOwner[cz * CHUNKS_X + cx]; }
  setChunkOwner(cx, cz, o) { this.chunkOwner[cz * CHUNKS_X + cx] = o; this.version++; }

  /** 地面单位可通行:非水、非建筑(城墙也算建筑)。道路可走。 */
  walkable(x, z) {
    if (!this.inside(x, z)) return false;
    const i = this.idx(x, z);
    return this.terrain[i] !== T.water && this.building[i] === 0;
  }

  generate() {
    const rnd = mulberry32(this.seed);
    const n1 = makeNoise(this.seed * 3 + 1);
    const n2 = makeNoise(this.seed * 7 + 5);
    const fbm = (n, x, z, s) => n(x / s, z / s) * 0.65 + n(x / (s / 2), z / (s / 2)) * 0.35;

    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        let t = T.grass;
        const f = fbm(n1, x, z, 10);
        const r = fbm(n2, x + 100, z + 100, 7);
        if (f > 0.62) t = T.forest;
        if (r > 0.74) t = T.rock;
        this.terrain[this.idx(x, z)] = t;
      }
    }

    // 河流:自西北向东南的对角蜿蜒带(x=z 线),把西南玩家区与东北敌区隔开,留 3 处浅滩
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        const along = (x + z) / 2 - 32;
        const off = Math.sin(along / 5) * 2.2 + (n1(x / 6, z / 6) - 0.5) * 2;
        const d = Math.abs(x - z + off);
        const ford = [-18, 0, 18].some((f) => Math.abs(along - f) < 2.2);
        if (d < 2.1) this.terrain[this.idx(x, z)] = ford ? T.sand : T.water;
        else if (d < 2.9) this.terrain[this.idx(x, z)] = T.sand;
      }
    }

    const blob = (cx, cz, r, t, jag = 0.35) => {
      for (let z = Math.floor(cz - r - 1); z <= cz + r + 1; z++) {
        for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
          if (!this.inside(x, z)) continue;
          const d = Math.hypot(x - cx, z - cz) / r;
          if (d < 1 - jag * (rnd() - 0.5)) this.terrain[this.idx(x, z)] = t;
        }
      }
    };

    // 起始区保证:池塘、森林、岩石;相邻地块铁/煤;油田在中部与远端
    blob(20, 52, 1.8, T.water, 0.2);
    blob(10, 42, 2.4, T.forest);
    blob(21, 42, 1.6, T.rock);
    blob(5, 51, 1.6, T.ore);
    blob(27, 54, 1.6, T.coal);
    blob(12, 33, 1.7, T.ore);
    blob(28, 46, 1.4, T.coal);
    blob(6, 58, 2.2, T.forest);
    blob(36, 52, 2.0, T.oil, 0.2);
    blob(14, 22, 2.0, T.oil, 0.2);
    blob(40, 36, 1.8, T.ore);
    blob(30, 12, 2.0, T.coal);
    blob(54, 40, 2.2, T.oil, 0.2);
    blob(46, 50, 2.4, T.forest);
    blob(52, 30, 1.6, T.rock);

    // 指挥中心周围清空为草地,避免开局无地可建
    const clear = (hx, hz, r) => {
      for (let z = hz - r; z < hz + 3 + r; z++) {
        for (let x = hx - r; x < hx + 3 + r; x++) {
          if (this.inside(x, z)) this.terrain[this.idx(x, z)] = T.grass;
        }
      }
    };
    clear(PLAYER_HQ.x, PLAYER_HQ.z, 2);
    clear(ENEMY_HQ.x - 5, ENEMY_HQ.z - 5, 0);
    for (let z = ENEMY_HQ.z - 6; z < ENEMY_HQ.z + 9; z++) {
      for (let x = ENEMY_HQ.x - 6; x < ENEMY_HQ.x + 9; x++) {
        if (this.inside(x, z) && this.terrain[this.idx(x, z)] !== T.water) this.terrain[this.idx(x, z)] = T.grass;
      }
    }

    for (const [cx, cz] of PLAYER_CHUNKS) this.setChunkOwner(cx, cz, OWNER.player);
    for (const [cx, cz] of ENEMY_CHUNKS) this.setChunkOwner(cx, cz, OWNER.enemy);
  }

  /** 与已拥有地块四邻接、且无主的地块才能购买。 */
  canBuyChunk(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= CHUNKS_X || cz >= CHUNKS_Z) return false;
    if (this.chunkOwnerAt(cx, cz) !== OWNER.none) return false;
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
      const nx = cx + dx;
      const nz = cz + dz;
      return nx >= 0 && nz >= 0 && nx < CHUNKS_X && nz < CHUNKS_Z && this.chunkOwnerAt(nx, nz) === OWNER.player;
    });
  }

  ownedChunkCount(owner = OWNER.player) {
    let n = 0;
    for (const o of this.chunkOwner) if (o === owner) n++;
    return n;
  }

  chunkPrice() {
    return Math.round(250 * 1.55 ** (this.ownedChunkCount() - PLAYER_CHUNKS.length));
  }

  /** 半径 r 内是否存在某地形(用于 near 要求)。 */
  hasNear(x, z, w, d, terrain, r = 2) {
    for (let zz = z - r; zz < z + d + r; zz++) {
      for (let xx = x - r; xx < x + w + r; xx++) {
        if (this.t(xx, zz) === terrain && this.inside(xx, zz)) return true;
      }
    }
    return false;
  }

  roadMask(x, z) {
    const r = (xx, zz) => (this.inside(xx, zz) && this.road[this.idx(xx, zz)] ? 1 : 0);
    return r(x, z - 1) * 1 + r(x + 1, z) * 2 + r(x, z + 1) * 4 + r(x - 1, z) * 8;
  }

  serialize() {
    return {
      seed: this.seed,
      terrain: Array.from(this.terrain),
      chunkOwner: Array.from(this.chunkOwner),
      road: Array.from(this.road),
    };
  }

  load(data) {
    this.terrain.set(data.terrain);
    this.chunkOwner.set(data.chunkOwner);
    this.road.set(data.road);
    this.building.fill(0);
    this.version++;
  }
}
