// 传输层:决定命令何时在哪个 tick 执行。
// - LocalTransport:单人。命令在两个 tick 之间同步执行(UI 可立即拿到结果),同时写入命令日志供回放。
// - ReplayTransport:按日志 tick 重放,配合固定步长 + 种子随机数复现整局。
// - 联机(未实现,接口已留):LockstepTransport 应把命令调度到 tick + inputDelay,
//   广播给对端;每个 tick 收齐所有玩家该 tick 的命令后才推进,并定期交换 game.checksum() 检测不同步。
import { applyCommand } from './commands.js';

export class LocalTransport {
  constructor(game) {
    this.game = game;
    /** @type {{tick:number, cmd:object}[]} */
    this.log = [];
  }

  send(cmd) {
    const res = applyCommand(this.game, cmd);
    if (res.ok) this.log.push({ tick: this.game.tick, cmd });
    return res;
  }

  /** 每个 tick 开始前调用;本地命令已即时执行,无需处理。 */
  commandsFor() {
    return [];
  }
}

export class ReplayTransport {
  constructor(game, log) {
    this.game = game;
    this.log = [...log].sort((a, b) => a.tick - b.tick);
    this.i = 0;
  }

  send() {
    return { ok: false, reason: '回放中不能操作' };
  }

  commandsFor(tick) {
    const out = [];
    while (this.i < this.log.length && this.log[this.i].tick <= tick) out.push(this.log[this.i++].cmd);
    return out;
  }

  get done() {
    return this.i >= this.log.length;
  }
}
