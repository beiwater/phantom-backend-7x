// 战争迷雾(文明式):未探索 = 漆黑,已探索但不在视野 = 灰暗(只记得地形与建筑),视野内 = 明亮。
// 迷雾是「本地玩家的视图」而非模拟状态:不影响确定性模拟,联机时每端各算各的。
// 实现:64×64 DataTexture 存每格亮度,注入到所有体素/地形材质的片元着色器,按世界 XZ 采样。
import * as THREE from 'three';
import { MAP_W, MAP_H, OWNER } from './map.js';

const BUILDING_SIGHT = 4;
const UNIT_SIGHT = { militia: 5, rifleman: 6, tank: 6, artillery: 7, helicopter: 8 };

export class FogOfWar {
  constructor(game) {
    this.game = game;
    this.explored = new Uint8Array(MAP_W * MAP_H);
    this.visibleNow = new Uint8Array(MAP_W * MAP_H);
    this.level = new Float32Array(MAP_W * MAP_H);
    this.data = new Uint8Array(MAP_W * MAP_H * 4);
    this.texture = new THREE.DataTexture(this.data, MAP_W, MAP_H, THREE.RGBAFormat);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.uniforms = { uFogTex: { value: this.texture }, uFogSize: { value: new THREE.Vector2(MAP_W, MAP_H) }, uFogOn: { value: 1 } };
    this.t = 0;
    this.enabled = true;
    this.recompute();
    this.level.set(Array.from(this.visibleNow, (v, i) => (v ? 1 : this.explored[i] ? 0.5 : 0)));
    this.upload();
  }

  reveal(cx, cz, r) {
    const r2 = r * r;
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) continue;
        if ((x + 0.5 - cx) ** 2 + (z + 0.5 - cz) ** 2 > r2) continue;
        const i = z * MAP_W + x;
        this.visibleNow[i] = 1;
        this.explored[i] = 1;
      }
    }
  }

  recompute() {
    const g = this.game;
    const me = g.localPlayer;
    this.visibleNow.fill(0);
    const m = g.map;
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        if (m.ownerAt(x, z) === OWNER.player) { this.visibleNow[z * MAP_W + x] = 1; this.explored[z * MAP_W + x] = 1; }
      }
    }
    for (const b of g.buildings.values()) {
      if (b.team === me) this.reveal(b.x + b.w / 2, b.z + b.d / 2, BUILDING_SIGHT + Math.max(b.w, b.d) / 2 + (b.type === 'turret' ? 3 : 0));
    }
    for (const u of g.unitSystem?.units ?? []) {
      if (u.team === me) this.reveal(u.x, u.z, UNIT_SIGHT[u.type] ?? 5);
    }
  }

  /** 本地视图查询:敌方单位只在可见格显示;建筑在已探索格显示。 */
  visible(x, z) {
    if (!this.enabled) return true;
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    if (xi < 0 || zi < 0 || xi >= MAP_W || zi >= MAP_H) return false;
    return this.visibleNow[zi * MAP_W + xi] === 1;
  }

  isExplored(x, z) {
    if (!this.enabled) return true;
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    if (xi < 0 || zi < 0 || xi >= MAP_W || zi >= MAP_H) return false;
    return this.explored[zi * MAP_W + xi] === 1;
  }

  upload() {
    for (let i = 0; i < this.level.length; i++) {
      const v = Math.round(this.level[i] * 255);
      this.data[i * 4] = v;
      this.data[i * 4 + 3] = 255;
    }
    this.texture.needsUpdate = true;
  }

  update(dt) {
    this.uniforms.uFogOn.value = this.enabled ? 1 : 0;
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0.25;
      this.recompute();
    }
    // 平滑过渡,避免视野边缘闪烁
    const k = Math.min(1, dt * 4);
    for (let i = 0; i < this.level.length; i++) {
      const target = this.visibleNow[i] ? 1 : this.explored[i] ? 0.5 : 0;
      this.level[i] += (target - this.level[i]) * k;
    }
    this.upload();
  }

  /** 给材质注入迷雾采样;同一 uniforms 对象共享,所以只需更新一次纹理。 */
  apply(material) {
    const uniforms = this.uniforms;
    const prev = material.onBeforeCompile;
    material.onBeforeCompile = (shader, r) => {
      prev?.call(material, shader, r);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFogXZ;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          vec4 fogWP = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            fogWP = instanceMatrix * fogWP;
          #endif
          fogWP = modelMatrix * fogWP;
          vFogXZ = fogWP.xz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFogXZ;\nuniform sampler2D uFogTex;\nuniform vec2 uFogSize;\nuniform float uFogOn;')
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          if (uFogOn > 0.5) {
            float fogL = texture2D(uFogTex, vFogXZ / uFogSize).r;
            vec3 hidden = vec3(0.07, 0.09, 0.12);
            gl_FragColor.rgb = mix(hidden, gl_FragColor.rgb, 0.08 + 0.92 * smoothstep(0.0, 1.0, fogL));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(dot(gl_FragColor.rgb, vec3(0.3, 0.59, 0.11))), (1.0 - smoothstep(0.5, 1.0, fogL)) * 0.6);
          }`);
    };
    material.customProgramCacheKey = () => 'fog';
    material.needsUpdate = true;
  }

  serialize() {
    let s = '';
    for (const v of this.explored) s += v ? '1' : '0';
    return s;
  }

  load(s) {
    if (typeof s !== 'string' || s.length !== this.explored.length) return;
    for (let i = 0; i < s.length; i++) this.explored[i] = s[i] === '1' ? 1 : 0;
  }
}
