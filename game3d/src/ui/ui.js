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
import { saveGame, clearSave } from '../save.js';
import { fmtTime } from '../engine/util.js';
import { DIFFICULTIES } from '../data/difficulty.js';

const AUTOSAVE_SEC = 30;

export class UI {
  constructor({ game, economy, rig, rts, view, terrain }) {
    Object.assign(this, { game, economy, rig, rts, view, terrain });
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
    this.saveT = AUTOSAVE_SEC;
    this.modalT = 0;
    this.hitT = 0;

    document.getElementById('btn-tech').addEventListener('click', () => this.openTech());
    document.getElementById('btn-stats').addEventListener('click', () => this.openStats());
    document.getElementById('btn-gov').addEventListener('click', () => this.openGov());
    document.getElementById('btn-menu').addEventListener('click', () => this.openMenu());
    this.modal.addEventListener('click', (e) => this.onModalClick(e));
    this.bindEvents();
    if (game.time < 1) this.openHelp(true);
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
    ev.on('gameover', (r) => this.openGameOver(r));
    ev.on('event', ({ msg, kind }) => this.toast(msg, kind));
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
        <kbd>O</kbd><span>经济统计(产销/价格/民心) · <kbd>J</kbd> 政务(政策/贸易合同)</span>
        <kbd>T</kbd><span>科技树 · <kbd>P</kbd> 暂停 · <kbd>L</kbd> 开关标签 · <kbd>Esc</kbd> 取消/关闭</span>
      </div>
      <p>敌军第一波进攻约在 ${fmtTime(300)} 后到来。进度每 ${AUTOSAVE_SEC} 秒自动保存到本机浏览器。</p>
    </div>`);
  }

  openMenu() {
    this.openModal('menu', `<div class="dialog"><h2><span>☰ 菜单</span><button class="btn" data-close>关闭</button></h2>
      <div class="menu-list">
        <button class="btn" data-menu="save">💾 立即保存</button>
        <button class="btn" data-menu="help">❓ 操作说明</button>
        <button class="btn" data-menu="labels">🏷️ 开关建筑标签 (L)</button>
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

  openGameOver(result) {
    const win = result === 'win';
    clearSave();
    const c = this.game.counters;
    this.openModal('gameover', `<div class="dialog" style="text-align:center;max-width:480px">
      <h2 style="justify-content:center">${win ? '🏆 胜利!' : '💀 指挥中心陷落'}</h2>
      <p>${win ? '敌军指挥中心已被摧毁,你的文明统一了这片土地。' : '敌军摧毁了你的指挥中心。'}<br>
      用时 ${fmtTime(this.game.time)} · 训练单位 ${c.unitsTrained} · 歼敌 ${c.enemyKilled} · 击退 ${c.wavesSurvived} 波</p>
      <button class="btn primary" data-menu="setup">再来一局</button></div>`);
  }

  onModalClick(e) {
    if (e.target === this.modal) { this.closeModal(); return; }
    if (e.target.closest('[data-close]')) { this.closeModal(); return; }
    const m = e.target.closest('[data-menu]')?.dataset.menu;
    if (m === 'save') { saveGame(this); this.toast('💾 已保存', 'good'); this.closeModal(); }
    if (m === 'help') this.openHelp();
    if (m === 'labels') { this.labels.enabled = !this.labels.enabled; this.closeModal(); }
    if (m === 'setup') this.openSetup();
    if (m === 'start') {
      const diff = this.modal.querySelector('input[name="diff"]:checked')?.value ?? 'normal';
      const seed = Number(this.modal.querySelector('#seed-input')?.value) || 7;
      clearSave();
      this.skipSave = true;
      location.href = `${location.pathname}?new=1&seed=${seed}&diff=${diff}`;
    }
    if (this.modalKind === 'tech' && this.tech.onClick(e)) this.refreshTech();
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
