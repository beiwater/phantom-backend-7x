// 固定步长模拟循环:与帧率无关,保证同样的命令序列得到同样的结果(回放/锁步联机的前提)。
import { applyCommand } from '../net/commands.js';

export const TICK = 0.05;
const MAX_TICKS_PER_FRAME = 16;

export class SimLoop {
  constructor(game, economy, rts) {
    this.game = game;
    this.economy = economy;
    this.rts = rts;
    this.acc = 0;
  }

  /** 推进一个 tick:先执行该 tick 的远端/回放命令,再模拟。 */
  /** 锁步:当前 tick 的远端命令未到齐时返回 false(本帧停在原地等待)。 */
  stepTick() {
    const g = this.game;
    g.transport.flush?.(g.tick);
    if (g.transport.ready && !g.transport.ready(g.tick)) return false;
    for (const cmd of g.transport.commandsFor(g.tick)) applyCommand(g, cmd);
    this.economy.step(TICK);
    this.rts?.update(TICK);
    g.time += TICK;
    g.tick++;
    return true;
  }

  advance(realDt) {
    const g = this.game;
    if (g.paused || g.over) { this.acc = 0; return 0; }
    this.acc += realDt * g.speed;
    let n = 0;
    while (this.acc >= TICK && n < MAX_TICKS_PER_FRAME && !g.over) {
      if (!this.stepTick()) { this.acc = Math.min(this.acc, TICK); break; }
      this.acc -= TICK;
      n++;
    }
    if (n === MAX_TICKS_PER_FRAME) this.acc = 0; // 卡顿时丢弃积压,避免死亡螺旋
    return n;
  }
}
