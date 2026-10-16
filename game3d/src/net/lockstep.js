// 确定性锁步传输(合作模式):每个玩家把命令调度到 tick + delay 并广播;
// 某 tick 只有收齐所有玩家对该 tick 的命令包(可为空)后才允许模拟推进。
// channel 只需提供 post(msg) 与 onMessage(fn);浏览器可用 BroadcastChannel / WebSocket 适配。
export const INPUT_DELAY = 3;

export class LockstepTransport {
  constructor(game, channel, { delay = INPUT_DELAY } = {}) {
    this.game = game;
    this.channel = channel;
    this.delay = delay;
    /** @type {Map<number, Map<string, object[]>>} tick → 玩家 → 命令 */
    this.inbox = new Map();
    this.pending = [];
    this.sentUpTo = -1;
    this.log = [];
    channel.onMessage((msg) => this.receive(msg));
  }

  /** 本地命令不立即执行:进入下一个发送包,在 tick+delay 时由所有端同时执行。 */
  send(cmd) {
    this.pending.push(cmd);
    return { ok: true, pending: true };
  }

  receive({ tick, player, cmds }) {
    if (!this.inbox.has(tick)) this.inbox.set(tick, new Map());
    this.inbox.get(tick).set(player, cmds);
  }

  /** 每个 tick 开始时调用:为 tick+delay 发出本地命令包(没有命令也发空包)。 */
  flush(tick) {
    const target = tick + this.delay;
    if (target <= this.sentUpTo) return;
    const pkt = { tick: target, player: this.game.localId, cmds: this.pending };
    this.pending = [];
    this.sentUpTo = target;
    this.receive(pkt);
    this.channel.post(pkt);
  }

  /** 开局前 delay 个 tick 没有人能发命令,视为空包已齐。 */
  ready(tick) {
    if (tick < this.delay) return true;
    const got = this.inbox.get(tick);
    return !!got && this.game.players.every((p) => got.has(p));
  }

  /** 按玩家列表顺序合并,保证各端执行顺序一致。 */
  commandsFor(tick) {
    const got = this.inbox.get(tick);
    this.inbox.delete(tick);
    if (!got) return [];
    const out = [];
    for (const p of this.game.players) for (const c of got.get(p) ?? []) out.push({ ...c, p });
    for (const c of out) this.log.push({ tick, cmd: c });
    return out;
  }
}

/** 进程内的成对通道(测试与本地双开演示用),可模拟网络延迟(以投递轮次计)。 */
export function memoryChannelPair() {
  const make = () => ({ handlers: [], queue: [], peer: null });
  const a = make();
  const b = make();
  a.peer = b;
  b.peer = a;
  const api = (side) => ({
    post: (msg) => side.peer.queue.push(structuredClone(msg)),
    onMessage: (fn) => side.handlers.push(fn),
    /** 投递所有积压消息(模拟网络到达)。 */
    deliver: () => { for (const m of side.queue.splice(0)) for (const h of side.handlers) h(m); },
  });
  return [api(a), api(b)];
}
