// 合成音效(WebAudio,无音频文件):首次用户手势后才创建 AudioContext(浏览器自动播放策略)。
// 同类音效节流,避免大战时爆音;按镜头距离衰减战斗音效。
const KEY = 'voxel-era-mute';

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.last = new Map();
    try { this.muted = localStorage.getItem(KEY) === '1'; } catch { this.muted = false; }
    const unlock = () => this.init();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.35;
    this.master.connect(this.ctx.destination);
    this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem(KEY, this.muted ? '1' : '0'); } catch { /* 存储不可用 */ }
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.35;
    return this.muted;
  }

  throttle(key, ms) {
    const now = performance.now();
    if (now - (this.last.get(key) ?? 0) < ms) return false;
    this.last.set(key, now);
    return true;
  }

  tone(freq, dur, { type = 'sine', vol = 0.3, slide = 0, delay = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, { vol = 0.3, freq = 800, q = 1, delay = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.2), t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  play(name, vol = 1) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'click': if (this.throttle(name, 40)) this.tone(660, 0.05, { type: 'triangle', vol: 0.12 * vol }); break;
      case 'place': this.noise(0.12, { vol: 0.35 * vol, freq: 500 }); this.tone(180, 0.12, { type: 'square', vol: 0.08 * vol, slide: 0.6 }); break;
      case 'done': this.tone(523, 0.12, { type: 'triangle', vol: 0.18 * vol }); this.tone(784, 0.2, { type: 'triangle', vol: 0.18 * vol, delay: 0.1 }); break;
      case 'coin': if (this.throttle(name, 300)) { this.tone(988, 0.06, { type: 'square', vol: 0.05 * vol }); this.tone(1318, 0.12, { type: 'square', vol: 0.05 * vol, delay: 0.06 }); } break;
      case 'error': if (this.throttle(name, 200)) this.tone(160, 0.18, { type: 'sawtooth', vol: 0.1 * vol }); break;
      case 'shot': if (this.throttle(name, 60)) this.noise(0.07, { vol: 0.18 * vol, freq: 2400 }); break;
      case 'cannon': if (this.throttle(name, 120)) { this.noise(0.35, { vol: 0.4 * vol, freq: 700 }); this.tone(90, 0.3, { vol: 0.25 * vol, slide: 0.5 }); } break;
      case 'boom': if (this.throttle(name, 90)) { this.noise(0.6, { vol: 0.5 * vol, freq: 900 }); this.tone(60, 0.5, { vol: 0.3 * vol, slide: 0.4 }); } break;
      case 'alarm': for (let i = 0; i < 3; i++) this.tone(440, 0.25, { type: 'square', vol: 0.09, slide: 1.5, delay: i * 0.32 }); break;
      case 'tech': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', vol: 0.14, delay: i * 0.08 })); break;
      case 'win': [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', vol: 0.2, delay: i * 0.15 })); break;
      case 'lose': [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.4, { type: 'sawtooth', vol: 0.1, delay: i * 0.25 })); break;
      default: break;
    }
  }

  /** 战斗音效按与镜头目标的距离衰减,远处战斗几乎听不见。 */
  playAt(name, x, z, rig) {
    const d = Math.hypot(x - rig.target.x, z - rig.target.z);
    const vol = Math.max(0, 1 - d / (rig.view * 2.2));
    if (vol > 0.05) this.play(name, vol);
  }
}
