// UI 总控:组装各面板,管理选中、提示、弹窗、快捷键与自动存档。
import { Hud } from './hud.js';
import { Toolbar } from './toolbar.js';
import { Panel } from './panel.js';
import { Labels } from './labels.js';
import { Minimap } from './minimap.js';
import { Missions } from './missions.js';
import { TechTree } from './tech.js';
import { ERAS, TECHS } from '../data/tech.js';
import { BUILDINGS } from '../data/buildings.js';
import { RESOURCES } from '../data/resources.js';
import { StatsPanel } from './stats.js';
import { GovPanel } from './gov.js';
import { Alerts } from './alerts.js';
import { Codex } from './codex.js';
import { saveGame, clearSave, storeReplay, exportSave, importSave } from '../save.js';
import { fmtTime } from '../engine/util.js';
import { DIFFICULTIES } from '../data/difficulty.js';
import { QUALITY } from '../engine/quality.js';
import { VICTORIES } from '../sim/victory.js';
import { UNITS } from '../data/units.js';
import { RANK_NAMES } from '../rts/combat.js';

const AUTOSAVE_SEC = 30;

export class UI {
  constructor({ game, economy, rig, rts, view, terrain, quality, dayNight, audio }) {
    Object.assign(this, { game, economy, rig, rts, view, terrain, quality, dayNight, audio });
    this.selection = null;
    this.toasts = document.getElementById('toasts');
    this.modal = document.getElementById('modal');
    this.modalKind = null;
    this.hud = new Hud(game);
    this.toolbar = new Toolbar(game, this);
    this.panel = new Panel(game, this);
    this.labels = new Labels(game, rig, view);
    this.minimap = new Minimap(game, rig);
    this.missions = new Missions(game, this);
    this.tech = new TechTree(game, this);
    this.statsPanel = new StatsPanel(game, economy);
    this.gov = new GovPanel(game, this);
    this.alerts = new Alerts(game, this);
    this.codex = new Codex(game);
    this.saveT = AUTOSAVE_SEC;
    this.modalT = 0;
    this.hitT = 0;

    document.getElementById('btn-tech').addEventListener('click', () => this.openTech());
    document.getElementById('btn-stats').addEventListener('click', () => this.openStats());
    document.getElementById('btn-gov').addEventListener('click', () => this.openGov());
    document.getElementById('btn-menu').addEventListener('click', () => this.openMenu());
    this.modal.addEventListener('click', (e) => this.onModalClick(e));
    this.bindEvents();
    if (game.replay) this.initReplay();
    else if (game.time < 1) this.openHelp(true);
  }

  /** 回放模式:禁止存档,显示横幅,到达录制终点时比对校验和以证明确定性。 */
  initReplay() {
    this.skipSave = true;
    const r = this.game.replay;
    const bar = document.createElement('div');
    bar.id = 'replay-bar';
    bar.innerHTML = `🎬 回放中 · <span data-k="p"></span> · <a href="${location.pathname}">返回游戏</a>`;
    document.getElementById('app').appendChild(bar);
    this.replayBar = bar.querySelector('[data-k="p"]');
    this.game.speed = 4;
    this.toast(`🎬 回放 ${r.log.length} 条命令,共 ${fmtTime(r.endTick * 0.05)}`, 'big');
  }

  updateReplay() {
    const g = this.game;
    const r = g.replay;
    if (!r || !this.replayBar) return;
    this.replayBar.textContent = `${fmtTime(g.time)} / ${fmtTime(r.endTick * 0.05)}`;
    if (!r.verified && g.tick >= r.endTick) {
      r.verified = true;
      const same = g.checksum() === r.checksum;
      g.paused = true;
      const why = r.reloaded ? '(本局中途读过档,存档取整会造成偏差)' : '';
      this.toast(same ? `✅ 回放终点校验一致(${r.checksum}):模拟完全确定` : `⚠️ 回放校验不一致${why}:${g.checksum()} ≠ ${r.checksum}`, same ? 'good' : 'bad');
    }
  }

  bindEvents() {
    const ev = this.game.events;
    ev.on('selection', (units) => {
      if (units.length) this.select({ units }, true);
      else if (this.selection?.units) this.select(null, true);
    });
    ev.on('era', (era) => {
      const e = ERAS[era - 1];
      this.toast(`🌅 文明迈入「${e.name}」!指挥中心现可升级`, 'big');
    });
    ev.on('tech', (id) => { if (id) this.toast(`🔬 研究完成:${TECHS[id].name}`, 'good'); });
    ev.on('building:done', (b) => {
      if (b.team === 'player' && b.type !== 'wall' && b.type !== 'house') this.toast(`✅ ${BUILDINGS[b.type].name} ${b.level > 1 ? `升至 ${b.level} 级` : '建成'}`);
    });
    ev.on('building:hit', (b) => {
      if (b.team !== 'player' || this.hitT > 0) return;
      this.hitT = 12;
      this.toast(`⚠️ ${BUILDINGS[b.type].name}遭到攻击!`, 'bad');
    });
    ev.on('building:remove', ({ b, destroyed }) => {
      if (destroyed && b.team === 'enemy' && b.type !== 'wall') this.toast(`💥 摧毁敌方${BUILDINGS[b.type].name}`, 'good');
    });
    ev.on('gameover', ({ result, kind }) => this.openGameOver(result, kind));
    ev.on('event', ({ msg, kind }) => this.toast(msg, kind));
    ev.on('ruins:claim', ({ msg }) => this.toast(`🏛️ ${msg}`, 'good'));
    ev.on('weather', () => {
      const w = this.game.weather.current;
      this.toast(`${w.icon} 天气转为「${w.name}」${w.desc ? `:${w.desc}` : ''}`);
    });
    ev.on('tribute', ({ wave, cost }) => this.toast(`🕊️ 向铁锈军团进贡 💰${cost},第 ${wave} 波推迟 2 分钟`, 'good'));
    ev.on('unit:promoted', ({ unit, rank }) => {
      if (unit.team === this.game.localPlayer) this.toast(`🎖️ ${UNITS[unit.type].name}晋升为「${RANK_NAMES[rank]}」${'★'.repeat(rank)}`, 'good');
    });
    ev.on('contract:new', (o) => this.toast(`📜 新合同:${o.client}求购 ${RESOURCES[o.res].name} ×${o.qty}(J 打开政务)`));
    ev.on('contract:done', (o) => this.toast(`🤝 合同完成:${o.client} 支付 💰${o.reward.money}`, 'good'));
    ev.on('contract:expired', (o) => this.toast(`⌛ ${o.client}的合同已过期,声望 -1`, 'bad'));
    ev.on('market:shock', ({ res, up }) => this.toast(`📈 市场:${RESOURCES[res].name}${up ? '需求旺盛,价格上涨' : '供过于求,价格下跌'}`));
  }

  // ---------- 选中 ----------
  select(sel, fromRts = false) {
    if (sel?.building && !fromRts) this.rts.clearSelection?.();
    this.selection = sel;
    this.view.showSelection(sel?.building ?? null);
    this.panel.show(sel);
  }

  onModeChange() {
    this.toolbar.render();
  }

  // ---------- 提示 ----------
  toast(text, kind = '') {
    if (kind === 'bad') this.audio?.play('error');
    this.history = this.history ?? [];
    this.history.push({ text, kind, t: this.game.time });
    if (this.history.length > 80) this.history.shift();
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 5) this.toasts.firstChild.remove();
    setTimeout(() => el.remove(), kind === 'big' ? 5000 : 2800);
  }

  // ---------- 弹窗 ----------
  openModal(kind, html) {
    this.modalKind = kind;
    this.modal.innerHTML = html;
    this.modal.hidden = false;
  }

  closeModal() {
    if (this.modal.hidden) return false;
    if (this.modalKind === 'gameover') return true;
    this.modal.hidden = true;
    this.modalKind = null;
    return true;
  }

  openTech() {
    if (this.modalKind === 'tech') { this.closeModal(); return; }
    this.techSig = this.tech.sig();
    this.openModal('tech', this.tech.html());
  }

  /** 科技状态变化才重建(避免点击丢失),研究进度条原地刷新。 */
  refreshTech() {
    const sig = this.tech.sig();
    if (sig !== this.techSig) {
      this.techSig = sig;
      const d = this.modal.querySelector('.dialog');
      const scroll = d ? [d.scrollLeft, d.scrollTop] : [0, 0];
      this.openModal('tech', this.tech.html());
      const nd = this.modal.querySelector('.dialog');
      if (nd) [nd.scrollLeft, nd.scrollTop] = scroll;
      return;
    }
    const bar = this.modal.querySelector('.tech.active .pbar i');
    if (bar && this.game.researching) bar.style.width = `${this.game.researching.progress * 100}%`;
  }

  openGov() {
    if (this.modalKind === 'gov') { this.closeModal(); return; }
    this.govSig = this.gov.sig();
    this.openModal('gov', this.gov.html());
  }

  openLog() {
    if (this.modalKind === 'log') { this.closeModal(); return; }
    const rows = [...(this.history ?? [])].reverse().map((h) => `<div class="logrow ${h.kind}"><span>${fmtTime(h.t)}</span>${h.text}</div>`).join('') || '<p>暂无消息</p>';
    this.openModal('log', `<div class="dialog" style="max-width:640px;min-width:min(520px,92vw)"><h2><span>📨 消息记录</span><button class="btn" data-close>关闭 Esc</button></h2>${rows}</div>`);
  }

  openCodex() {
    if (this.modalKind === 'codex') { this.closeModal(); return; }
    this.openModal('codex', this.codex.html());
  }

  openStats() {
    if (this.modalKind === 'stats') { this.closeModal(); return; }
    this.openModal('stats', this.statsPanel.html());
  }

  openHelp(first = false) {
    this.openModal('help', `<div class="dialog" style="max-width:640px">
      <h2><span>🧱 体素纪元</span><button class="btn primary" data-close>${first ? '开始游戏' : '关闭'}</button></h2>
      <p>从拓荒时代起步,搭建「原料 → 加工 → 高级品」的产业链,研究科技迈入工业与现代,
      训练军队渡河摧毁东北方的敌军指挥中心。所有生产建筑都需要邻接<b>连通指挥中心的道路</b>,产品由卡车沿道路运回。</p>
      <div class="keys">
        <kbd>WASD / 方向键</kbd><span>平移镜头(中键或空格+左键拖动)</span>
        <kbd>滚轮</kbd><span>缩放 · <kbd>Q</kbd>/<kbd>E</kbd> 旋转视角</span>
        <kbd>F1–F6</kbd><span>建筑分类 · <kbd>R</kbd> 道路 · <kbd>X</kbd> 拆除 · <kbd>G</kbd> 扩地 · <kbd>V</kbd> 选择</span>
        <kbd>左键</kbd><span>放置 / 选择 · 拖拽框选部队 · Shift 连续放置</span>
        <kbd>右键</kbd><span>取消建造 · 部队移动/攻击 · 兵营集结点</span>
        <kbd>A</kbd><span>攻击移动 · <kbd>H</kbd> 停止 · <kbd>F</kbd> 全选部队 · <kbd>Ctrl+数字</kbd> 编队</span>
        <kbd>O</kbd><span>经济统计 · <kbd>J</kbd> 政务(外交/政策/合同) · <kbd>B</kbd> 百科 · <kbd>N</kbd> 消息 · <kbd>Home</kbd> 回到总部</span>
        <kbd>T</kbd><span>科技树 · <kbd>P</kbd> 暂停 · <kbd>L</kbd> 标签 · <kbd>M</kbd> 静音 · <kbd>Esc</kbd> 取消/关闭</span>
      </div>
      <p>敌军第一波进攻约在 ${fmtTime(300)} 后到来。进度每 ${AUTOSAVE_SEC} 秒自动保存到本机浏览器。</p>
    </div>`);
  }

  openMenu() {
    this.openModal('menu', `<div class="dialog"><h2><span>☰ 菜单</span><button class="btn" data-close>关闭</button></h2>
      <div class="menu-list">
        <button class="btn" data-menu="save">💾 立即保存</button>
        <div class="btns"><button class="btn" data-menu="export">⬇️ 导出存档</button><button class="btn" data-menu="import">⬆️ 导入存档</button></div>
        <button class="btn" data-menu="replay">🎬 观看本局回放(验证确定性)</button>
        <button class="btn" data-menu="help">❓ 操作说明</button>
        <button class="btn" data-menu="codex">📖 百科(建筑与产业链)B</button>
        <button class="btn" data-menu="labels">🏷️ 开关建筑标签 (L)</button>
        <button class="btn" data-menu="fog">🌫️ 开关战争迷雾</button>
        <button class="btn" data-menu="daynight">🌙 开关昼夜循环</button>
        <button class="btn" data-menu="mute">🔇 开关音效 (M)</button>
        <div class="btns">画质:${Object.entries(QUALITY).map(([id, q]) => `<button class="btn${this.quality?.level === id ? ' primary' : ''}" data-quality="${id}">${q.name}</button>`).join('')}</div>
        <button class="btn danger" data-menu="setup">🆕 新游戏…</button>
      </div></div>`);
  }

  openSetup() {
    const opts = Object.entries(DIFFICULTIES).map(([id, d]) => `<label class="diff"><input type="radio" name="diff" value="${id}" ${id === this.game.difficultyId ? 'checked' : ''}>
      <b>${d.name}</b><span>${d.desc}</span></label>`).join('');
    this.openModal('setup', `<div class="dialog" style="max-width:520px"><h2><span>🆕 新游戏</span><button class="btn" data-close>取消</button></h2>
      <div class="menu-list">${opts}
        <label class="diff"><b>地图种子</b><input id="seed-input" type="number" value="${Math.floor(Math.random() * 9999)}" style="width:110px"></label>
        <button class="btn primary" data-menu="start">开始(将覆盖当前存档)</button>
      </div></div>`);
  }

  openGameOver(result, kind = 'domination') {
    const win = result === 'win';
    clearSave();
    const c = this.game.counters;
    this.openModal('gameover', `<div class="dialog" style="text-align:center;max-width:480px">
      <h2 style="justify-content:center">${win ? `🏆 ${VICTORIES[kind].icon} ${VICTORIES[kind].name}!` : '💀 指挥中心陷落'}</h2>
      <p>${win ? ({ domination: '敌军指挥中心已被摧毁,你的文明统一了这片土地。', science: '星际探测器升空,你的文明迈向群星。', economic: '你的商业帝国主宰了整个大陆的贸易。' })[kind] : '敌军摧毁了你的指挥中心。'}<br>
      用时 ${fmtTime(this.game.time)} · 训练单位 ${c.unitsTrained} · 歼敌 ${c.enemyKilled} · 击退 ${c.wavesSurvived} 波</p>
      <button class="btn primary" data-menu="setup">再来一局</button></div>`);
  }

  onModalClick(e) {
    if (e.target === this.modal) { this.closeModal(); return; }
    if (e.target.closest('[data-close]')) { this.closeModal(); return; }
    const m = e.target.closest('[data-menu]')?.dataset.menu;
    if (m === 'save') { saveGame(this); this.toast('💾 已保存', 'good'); this.closeModal(); }
    if (m === 'help') this.openHelp();
    if (m === 'export') {
      const text = exportSave(this);
      if (!text) { this.toast('导出失败', 'bad'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = `voxel-era-${Math.floor(this.game.time / 60)}min.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    if (m === 'import') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const r = importSave(await file.text());
        if (!r.ok) { this.toast(r.reason, 'bad'); return; }
        this.skipSave = true;
        location.href = location.pathname;
      };
      input.click();
    }
    if (m === 'replay') {
      if (this.game.replay) { this.toast('已在回放中', 'bad'); return; }
      saveGame(this);
      if (storeReplay(this.game)) location.href = `${location.pathname}?replay=1`;
      else this.toast('录像保存失败(浏览器存储不可用)', 'bad');
    }
    if (m === 'codex') this.openCodex();
    if (m === 'labels') { this.labels.enabled = !this.labels.enabled; this.closeModal(); }
    if (m === 'mute') { this.toast(this.audio.toggleMute() ? '🔇 已静音' : '🔊 音效已开启'); this.closeModal(); }
    if (m === 'daynight' && this.dayNight) { this.dayNight.enabled = !this.dayNight.enabled; this.closeModal(); }
    if (m === 'fog' && this.game.fog) { this.game.fog.enabled = !this.game.fog.enabled; this.closeModal(); }
    const q = e.target.closest('[data-quality]')?.dataset.quality;
    if (q) { this.quality.set(q); this.openMenu(); }
    if (m === 'setup') this.openSetup();
    if (m === 'start') {
      const diff = this.modal.querySelector('input[name="diff"]:checked')?.value ?? 'normal';
      const seed = Number(this.modal.querySelector('#seed-input')?.value) || 7;
      clearSave();
      this.skipSave = true;
      location.href = `${location.pathname}?new=1&seed=${seed}&diff=${diff}`;
    }
    if (this.modalKind === 'tech' && this.tech.onClick(e)) this.refreshTech();
    if (this.modalKind === 'codex' && this.codex.onClick(e)) this.openModal('codex', this.codex.html());
    if (this.modalKind === 'gov' && this.gov.onClick(e)) { this.govSig = this.gov.sig(); this.openModal('gov', this.gov.html()); }
  }

  hotkey(e, input) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.code;
    const fk = /^F([1-6])$/.exec(k);
    if (fk) {
      e.preventDefault();
      this.toolbar.setCat(this.toolbar.catOrder[Number(fk[1]) - 1]);
      return;
    }
    if (k === 'KeyR') input.setMode({ kind: 'road' });
    if (k === 'KeyX') input.setMode({ kind: 'demolish' });
    if (k === 'KeyG') input.setMode({ kind: 'expand' });
    if (k === 'KeyV') input.setMode({ kind: 'select' });
    if (k === 'KeyT') this.openTech();
    if (k === 'KeyO') this.openStats();
    if (k === 'KeyJ') this.openGov();
    if (k === 'KeyB') this.openCodex();
    if (k === 'KeyN') this.openLog();
    if (k === 'Home') {
      const hq = this.game.playerHQ();
      if (hq) this.rig.lookAt(hq.x + 1.5, hq.z + 1.5);
    }
    if (k === 'KeyM') this.toast(this.audio.toggleMute() ? '🔇 已静音' : '🔊 音效已开启');
    if (k === 'KeyP') this.hud.setSpeed(0);
    if (k === 'KeyL') this.labels.enabled = !this.labels.enabled;
  }

  update(dt) {
    this.hud.update(dt);
    this.toolbar.update(dt);
    this.panel.update();
    this.labels.update();
    this.minimap.update(dt);
    this.missions.update(dt);
    this.alerts.update(dt);
    this.updateReplay();
    this.hitT -= dt;
    this.modalT -= dt;
    if (this.modalKind === 'gov' && this.modalT <= 0) {
      this.modalT = 0.5;
      const sig = this.gov.sig();
      if (sig !== this.govSig) { this.govSig = sig; this.openModal('gov', this.gov.html()); }
    }
    if (this.modalKind === 'stats' && this.modalT <= 0) {
      this.modalT = 1;
      this.openModal('stats', this.statsPanel.html());
    }
    if (this.modalKind === 'tech' && this.modalT <= 0) {
      this.modalT = 0.25;
      this.refreshTech();
    }
    this.saveT -= dt;
    if (this.saveT <= 0 && !this.game.over && !this.skipSave) {
      this.saveT = AUTOSAVE_SEC;
      saveGame(this);
    }
  }
}
