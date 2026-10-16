# 多人联机预留设计

当前是单人游戏,但核心按**确定性锁步(deterministic lockstep)**的前提搭建:同一份初始参数 + 同一串命令 ⇒ 每台机器得到逐位相同的状态。录像回放(菜单「观看本局回放」)就是这条路径的单机验证。

## 已具备

| 前提 | 位置 | 说明 |
| --- | --- | --- |
| 命令总线 | `src/net/commands.js` | 所有玩家意图都是 JSON 命令 `{ type, p, ... }`,在 `applyCommand` 中做**归属校验**(`cmd.p` 必须拥有目标建筑/单位)再执行 |
| 传输抽象 | `src/net/transport.js` | `LocalTransport`(单人,立即执行并记日志)、`ReplayTransport`(按 tick 重放) |
| **锁步传输(已实现)** | `src/net/lockstep.js` | `LockstepTransport`:命令调度到 `tick + delay` 并广播空/非空包;`ready(tick)` 未收齐时 `SimLoop` 停步等待;`memoryChannelPair()` 为进程内通道。`tests/lockstep.test.mjs` 证明两端在网络抖动下逐 tick 一致 |
| 合作模式身份 | `game.players` / `game.localId` / `game.teamOf()` | 多名玩家(各端 `localId` 不同)共同指挥同一阵营 `'player'`,共享经济与部队;命令按阵营校验归属 |
| 固定步长 | `src/sim/loop.js` | 20 Hz(`TICK = 0.05`),与帧率无关;每个 tick 先执行该 tick 的命令再模拟 |
| 种子随机数 | `game.rng()`(`engine/util.js` 的 `Rng`) | 模拟逻辑禁止 `Math.random`;随机状态 `game.random.s` 可序列化 |
| 状态校验和 | `game.checksum()` | 资源、建筑、单位关键字段的 FNV 哈希,用于检测不同步 |
| 阵营 | `game.localPlayer` / 建筑与单位的 `team` | 本地阵营 `'player'`,AI 为 `'enemy'`;模拟逻辑只能用阵营判断「我方」 |
| 视图与模拟分离 | 迷雾 `world/fog.js`、选择/编队/镜头 | 只属于本地视图,**不进入**模拟,联机时各端各算各的 |

命令类型:`build` `roads` `walls` `demolish` `removeRoad` `upgrade` `repair` `buyChunk` `research` `policy` `deliver` `togglePause` `setSell`(经济)与 `move` `attack` `stop` `rally` `train` `cancelTrain`(军事,由 `rts.applyCommand` 处理)。

## 立即可试:本机双开合作

同一浏览器打开两个标签页:`index.html?new=1&coop=p1` 与 `index.html?new=1&coop=p2`(可加 `&peers=p1,p2,p3` 支持更多人)。两端通过 `BroadcastChannel` 交换命令包,任一方暂停或掉帧时其余各方会显示「等待队友」并停步;执行失败的延迟命令会以 `command:rejected` 事件提示发送者本人。

## 接入联机还需要做的事

1. **网络通道适配**:`LockstepTransport` 只依赖 `{ post, onMessage }`,接 WebSocket 中继或 WebRTC DataChannel 即可;大厅分配 `players` 顺序与各端 `localId`。
2. **对抗模式需按玩家拆分经济**(合作模式已可用):目前 `game.res / techs / policies / era` 只有一份(本地玩家)。需改为 `game.players[p].{res, techs, policies, era, stats}`,`applyCommand` 中经济命令已对非本地玩家返回拒绝,改造时把 `game.res` 访问换成 `game.players[cmd.p].res` 即可。
3. **大厅与开局参数**:主机广播 `{ seed, difficulty, players: [{ id, team, spawn }] }`;各端 `new Game(seed, difficulty)` 后按玩家列表调用 `setupStart(p)`(需参数化起始地块与指挥中心位置,见 `world/map.js` 的 `PLAYER_CHUNKS/PLAYER_HQ`)。
4. **不同步检测**:每 N tick 交换 `checksum()`;不一致时上报命令日志与双方存档以便排查。
5. **断线重连**:用 `save.js` 的序列化作为快照 + 快照之后的命令日志追帧(注意存档会对单位坐标取整,快照需改为无损序列化)。

## 约束(写新代码时请遵守)

- 模拟内(`economy.step`、`rts.update`、`society`、`market`、`contracts`、`ruins`、`victory`)只用 `game.rng()`、`game.time`、`game.tick`,不读 `performance.now()`、`Date`、迷雾、镜头或 DOM。
- 任何改变模拟状态的操作都必须走 `game.dispatch(cmd)`;UI 只读状态、只发命令。
- 新命令在 `commands.js` 中先校验归属与前置条件,失败返回 `{ ok: false, reason }` 且不改任何状态。
