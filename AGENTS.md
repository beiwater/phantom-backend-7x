# AGENTS.md

SimCompanies 私有服务器:原版前端 + 本地后端的兼容性重建。完成标准是**真实可玩**,不是 HTTP 200 或页面能渲染。

本文件是所有 AI agent(Claude/Codex/Gemini/Copilot 等)的唯一入口;其他 agent 指令文件不再保留。优先级低于平台/用户指令。

## 工作方式

- **证据优先**:从具体 Issue/报错/Network/DOM 现象出发,用精确搜索(符号、路由、报错文本)定位,不通读仓库、不做架构巡游。
  - 初查预算:≤8 个文件精读、≤3 跳依赖、≤2 次全库搜索;已知「现象 + 位置 + 假设」后立即验证或最小修复,有反证再扩范围。
  - 顺手发现的无关 bug:只记录,不改。
- **根因链**:DOM → 请求 → 路由 → application(事务/鉴权)→ domain(规则)→ repository/DB → 响应 schema → 刷新后仍正确。修根因,不修表象。
- **循环**:真实 DOM 探索 → 记录证据 → 定位根因 → 修复 → DOM 重放 + 刷新验证 → 补 DOM-only Playwright 回归 → 继续探索。

## 硬规则

- `200 []`、`200 {}`、`{success:true}`、通用 `/api/*` 兜底、假数据都**不算实现**;缺路由就做带类型的兼容路由 + 真实状态变更。
- 响应字段只能来自 HAR/Network/前端消费证据,不得为压报错而臆造;保持原客户端大小写(`simBoosts`/`dbLetter`…)。
- 读压缩 bundle 前,先查 `server/data/decompile/`、`server/game-data/`、既有测试与 Issue;仅在缺关键事实时做窄范围反编译,并把结论写回仓库。
- E2E 首轮必须经可见 DOM 操作;禁止用业务 API、改库、注入 JS、改 localStorage 造状态。DB/Network 仅作诊断。
- 每个状态变更接口:先鉴权 + 校验归属,再前置条件;不得用硬编码回退公司。

## 经济/状态完整性(钱、SimBoosts、库存、奖励、槽位、订单)

- 分清 delta 与绝对值(`updateCompanyMoney` 收 delta);扣费前先校验余额,不依赖 clamp。
- 调用方必须处理失败返回(`consumeResource` 失败即中止);多资源需求全量预检,要么全成要么全不成。
- 领取/收取/加速/购买须幂等,重复请求不重复发放;未知奖励 ID 直接拒绝。
- 涉及多处持久状态用 DB 事务;已持久化的字段,响应必须读库,不得重置为常量。
- 验证矩阵:操作前后余额/库存、请求体、精确 delta、响应、刷新/重登持久、重复请求、资源不足、跨公司/访客拒绝。
- 严重度:无限钱/SimBoosts、重复奖励、无库存收入、跨公司修改、部分写入 = P0;刷新重置、余额字段错误、材料未校验 = P1。

## 代码规范

- Node 22+,原生 TS(`--experimental-strip-types`)+ ESM:相对导入带 `.ts` 扩展名,用 `node:` 前缀;2 空格、单引号、分号。
- 禁用 `any`(用 `unknown` + 守卫);DB 行、请求体、响应都有显式类型。路由处理器签名 `(req, res, pathname, method, ...) => Promise<boolean>`,处理返回 `true`,否则 `false`。
- **复用,不造轮子**:
  - 公司/余额 `server/game/company.ts`(`updateCompanyMoney`、`updateCompanySimboosts`、`getCompanyById`)
  - 仓库 `server/game/warehouse.ts`;建筑 `server/game/buildings.ts`;生产/公式 `server/game/constants.ts`、`research.ts`
  - 唯一 DB 实例 `server/db/database.ts` 的 `db`,禁止新建 `DatabaseSync`;工具 `hashPassword`/`sendJson`/`readJsonBody`/`getSession` 等
  - 静态数据与公式 `server/data/constants/`、`server/data/decompile/INDEX.md`,不得硬编码或自造查表
- **Schema 唯一来源**:`server/db/migrations/runner.ts`(新增 `version: N+1`);运行时模块和 `connection.ts` 不得写 `CREATE/ALTER TABLE`。新库须能由迁移 + seed 完整启动。
- 注释写「为什么」:Issue 号(`#42`)、公式出处(`formulas_retail.md §3.2`)、前端兼容 workaround;不写复述代码的注释。
- 删除死代码、未用导入、无意义的单表达式包装函数。单文件约 500 行(300–600),改到超限文件时顺手按职责拆分。
- 提交:原子、约定式前缀(`feat|fix|refactor|test|docs(...)`)。

## 交付与推送

- 完成定义:DOM 手动重放通过、请求/响应语义正确、刷新后状态持久、无致命 Console/PageError、有 DOM-only 回归、无遗留调试文件。
- 仅在用户要求时提交/推送;推送前须通过 `npm run e2e` 与 `node --experimental-strip-types tests/verify-all-routes.ts`。
- 修完汇报:剩余未实现/假 API,以及最严重的 5 个玩家可见问题。

## 常用命令

`./start.command` 启动(127.0.0.1:3100)· `npm run typecheck` · `npm test` · `npm run e2e` · `npm run smell:all`

## 参考

- Issue:[#57 执行契约](https://github.com/beiwater/phantom-backend-7x/issues/57)、[#58 缺失 API 记录](https://github.com/beiwater/phantom-backend-7x/issues/58)、[#162 反编译证据复用](https://github.com/beiwater/phantom-backend-7x/issues/162)
- 缺失/假 API 记录:`data/missing-api.ndjson`(记录时脱敏 cookie/token/密码)
- 分层边界(Issue #68):`server/compatibility`+`routes`(协议适配)→ `application`(事务/鉴权)→ `domain`(规则)→ `repositories`/`db`
