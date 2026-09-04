# Sim Companies Frontend Reverse Engineering & Reconstruction Rules (铁律准则)

> **核心宗旨**：
> 本项目的目标是**把现有 production 网页尽可能逆向恢复成可维护规范源码**。
> 严禁“重新实现一个功能类似的游戏”或“凭空重构 UI”。生产环境 Bundle（`frontend-original/`）是唯一事实标准。
> 必须保留原网页的 DOM 结构、CSS 类名、交互时序、路由跳转、API 契约、Redux 状态机与资源数据流，逐步剥离混淆与压缩层。

---

## 10 条不可逾越的重构铁律 (Ten Immutable Laws)

### Rule 1: `frontend-original/` 绝对只读与不可变 (Immutable Source of Truth)
* `frontend-original/` 下的所有文件（`index.html`, `index-cgzgptQ8.js`, `index-BsDbFrGK.css`, 资源图片）均为原始历史快照，**绝对禁止直接在此目录中做不可逆覆盖修改**。
* 所有实验、规范化处理与逆向输出均放在独立的工作目录（`reconstruction-work/` 与 `reconstruction/`）。

### Rule 2: 生产 Bundle 是唯一业务真理 (Production Bundle is the Source of Truth)
* 不存在“官方应该是这样写的”、“我觉得这样设计更优雅”的假设。
* 任何函数行为、返回值结构、默认值、状态判断，必须以 Bundle 中的真实代码执行逻辑为准。

### Rule 3: 严禁凭空创造业务逻辑 (No Business Logic May Be Invented)
* AI 只允许执行：**语法展开 (Syntax Normalization)**、**符号提取 (Symbol Extraction)**、**上下文语义重命名 (Semantic Renaming)**、**类型定义补充 (TypeScript Types)**、**模块解耦与文档记录 (Modularization & Provenance)**。
* 严禁：重新设计 Store、重新发明 API 请求格式、重新设计 Router、改写游戏数值计算公式。

### Rule 4: 所有还原模块必须具备机器可审计的原产地追溯 (Every Module Must Have Machine-Readable Provenance)
* 每个切片必须提供 `reconstruction/<slice>/provenance.json`，并符合 `reconstruction-report/provenance.schema.json`。
* 每个顶层函数、selector、component 必须记录 `recoveredSymbol`、`originalSymbol`、`bundleRange`、`classification`、`confidence`、`evidence` 和 `semantic.mode`。
* 源文件路径和 SHA-256 必须匹配 `reconstruction-report/baseline-manifest.json`；注释不是权威证明。
* `npm run verify:reconstruction -- <slice> --static` 必须自动验证文件、范围、符号与分类。

### Rule 5: 语义命名推断必须提供证据链与置信度 (Evidence-Backed Inferences)
* 任何符号名称推断（例如将 `q` 命名为 `getCompany`），必须记录在 `symbol-ledger.json` 中，且必须包含：
  1. `proposedName`（提议名称）
  2. `confidence`（置信度：0.0 ~ 1.0）
  3. `evidence`（多维度证据：包含 API 路径、调用它的 React 组件、渲染的 prop 字段、文本字典 key 等）

### Rule 6: 低置信度符号严禁直接落地 (Low-Confidence Symbols Stay in Ledger Only)
* 置信度低于 `0.90` 的推断，仅允许保留在 `symbol-ledger.json` 和 `needs-review.json` 中作为线索，禁止直接将其写入正式源码模块。

### Rule 7: 机械解混淆必须保持运行时行为绝对等价 (AST Transformations Must Preserve Runtime Behaviour)
* AST 转换仅允许展开逗号表达式、展开三元运算符、展开对象解构别名。
* 规范化后的代码必须通过构建校验与语法解析，且能保持在浏览器中正常加载运行。

### Rule 8: 严禁为“代码洁癖”破坏原版 React 架构 (Do Not Redesign React Architecture for Cleanliness)
* 如果原版使用了 Class Component，恢复时优先还原为 Class Component，或在确保生命周期与 Context 行为 100% 相同的前提下迁移。
* 严禁随意将嵌套子组件打散或合并，必须忠实还原原版组件树层级。

### Rule 9: 严格保全 DOM 结构、CSS 类名与网络行为 (Preserve Original DOM, CSS & Network Parity)
* 恢复后的组件渲染出的 HTML 标签层级、`className`、`style` 属性必须与原网页完全吻合，确保原版 CSS（`index-BsDbFrGK.css`）完美生效。
* 组件触发的网络请求（Method, URL, Query, Body, Headers）必须与原版 1:1 对等。

### Rule 10: 每一个还原切片必须通过三重验收门 (Every Slice Requires Three Gates)
* **P — Provenance Gate**：来源文件、SHA-256、Bundle 范围、原始符号、恢复符号均可机器验证。
* **S — Semantic Diff Gate**：原 Bundle 与恢复符号的 AST/结构指纹一致；调用、分支、集合操作、参数、返回及 dispatch 顺序不可漂移。
* **B — Behaviour Differential Gate**：由独立 `VERIFY_ONLY` 验证者对官方版和恢复版执行相同行为，比较 DOM、Network、State、Console 与 Screenshot。
* 统一命令：`npm run verify:reconstruction -- <slice>`。缺少任何一项证据都必须失败。
* `L7 = P PASS + S PASS + B PASS`；编译成功、单元测试成功或 Agent 自述均不能替代这三个门。

---

## 恢复成熟度等级标准 (Maturity Levels L0 ~ L7)

每个符号、组件或模块必须按照以下 8 个级别严格演进，拒绝模糊的百分比估算：

| 等级 | 名称 | 判定标准 |
| :---: | :--- | :--- |
| **L0** | **Unknown** | 处于 6.8MB 压缩包中，未被定位或未被分析 |
| **L1** | **Located** | 已在 Bundle 中找到准确的字符偏移量（Byte Offset / Range） |
| **L2** | **Identified** | 已厘清其调用链（Call Graph）、API 依赖、传入 Props 或 Redux 状态绑定 |
| **L3** | **Renamed** | 已在 `symbol-ledger.json` 中完成语义推导，置信度 $\ge 0.90$，证据链完整 |
| **L4** | **Extracted** | 语法与控制流机械解混淆完成，已提取为独立结构代码块 |
| **L5** | **Reconstructed**| TS/TSX 模块已恢复，但只能在 Provenance、Classification 与 Semantic 静态门全部通过后授予 |
| **L6** | **Behaviour-Verified** | 已对目标用户行为完成真实浏览器差异测试，但仍可能存在未覆盖状态 |
| **L7** | **1:1 Verified** | Provenance、Semantic、Behaviour 三门全部通过，且 `SYNTHETIC_BUSINESS = 0` |

## Reconstruction Purity

每次验证必须报告明确分母和以下分类计数：

```text
RECOVERED
INFERRED
SYNTHETIC_GLUE
SYNTHETIC_BUSINESS
UNKNOWN
```

`SYNTHETIC_GLUE` 必须说明连接用途，不得改变业务；`SYNTHETIC_BUSINESS` 和 `UNKNOWN` 任一非零即拒绝。百分比只允许由报告中的确定计数计算，不允许主观估算。
