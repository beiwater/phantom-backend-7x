// 昼夜循环:一天 DAY_SEC 游戏秒,夜晚约占 30%。调整太阳/天光强度与色温、天空背景;
// 夜间发光体素(aGlow=1)通过着色器自发光,城市灯火通明。纯视觉,不影响模拟。
import * as THREE from 'three';

const DAY_SEC = 360;
const SKY_DAY = new THREE.Color(0xbfd8e6);
const SKY_DUSK = new THREE.Color(0xe8a87c);
const SKY_NIGHT = new THREE.Color(0x1b2640);
const SUN_DAY = new THREE.Color(0xfff1d8);
const SUN_DUSK = new THREE.Color(0xffa060);
const SUN_NIGHT = new THREE.Color(0x8fa8ff);

export class DayNight {
  constructor(stage) {
    this.stage = stage;
    this.enabled = true;
    this.uniforms = { uNight: { value: 0 } };
    this.phase = 0.3;
  }

  /** 0 = 正午亮度,1 = 深夜。 */
  nightness(t) {
    const p = ((t / DAY_SEC) + 0.3) % 1; // 开局为上午
    this.phase = p;
    // 0.0–0.6 白天,0.6–0.7 黄昏,0.7–0.95 夜,0.95–1 黎明
    if (p < 0.6) return 0;
    if (p < 0.7) return (p - 0.6) / 0.1;
    if (p < 0.95) return 1;
    return 1 - (p - 0.95) / 0.05;
  }

  update(gameTime) {
    const n = this.enabled ? this.nightness(gameTime) : 0;
    const dusk = n > 0 && n < 1 ? 1 - Math.abs(n - 0.5) * 2 : 0;
    const { scene, sun, hemi } = this.stage;
    scene.background.copy(SKY_DAY).lerp(SKY_NIGHT, n).lerp(SKY_DUSK, dusk * 0.5);
    sun.color.copy(SUN_DAY).lerp(SUN_NIGHT, n).lerp(SUN_DUSK, dusk * 0.6);
    sun.intensity = 2.2 * (1 - n * 0.75);
    hemi.intensity = 1.5 * (1 - n * 0.55);
    this.uniforms.uNight.value = n;
  }

  isNight() { return this.uniforms.uNight.value > 0.5; }

  apply(material) {
    const uniforms = this.uniforms;
    const prev = material.onBeforeCompile;
    material.onBeforeCompile = (shader, r) => {
      prev?.call(material, shader, r);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform float uNight;')
        .replace('#include <dithering_fragment>', `gl_FragColor.rgb += vColor.rgb * vGlow * uNight * 0.9;
          #include <dithering_fragment>`);
    };
    const prevKey = material.customProgramCacheKey?.bind(material);
    material.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|daynight`;
    material.needsUpdate = true;
  }
}
