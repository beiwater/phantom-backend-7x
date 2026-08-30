# Sim Companies — 反编译数据索引

> 来源：`www.simcompanies.com` HAR 抓包 → Wakaru 解包 → 手工提取  
> 版本：2026-05-27 快照

---

## 数据性质：静态 vs 动态

| 性质 | 说明 | 示例 |
|------|------|------|
| 🔒 **静态** | 代码里写死的，版本更新才会变 | 资源配方、建筑工资系数、季节日期、公式 |
| 🔄 **动态** | 每次从服务端拉取，实时变化 | 市场价格、交易所订单、行政开销、建筑状态 |
| 📐 **半静态** | 参数写死，但计算结果受动态输入影响 | 经济模型参数（静态）× 经济状态（动态）= 实际零售需求 |

> **价格**: 全部走 API 动态拉取 (`/api/v3/market-ticker/`)，JS 里一个价格都没有。只有 **价格 Tick 表**（最小单位）和**交易所手续费**是静态的。

## 文件清单

| 文件 | 大小 | 行数 | 性质 | 内容 |
|------|------|------|------|------|
| [`resources.json`](#resourcesjson) | 77KB | 3524 | 🔒 静态 | **151 种资源**全量定义 |
| [`buildings.json`](#buildingsjson) | 22KB | 1059 | 🔒 静态 | **54 种建筑**+ 升级费用公式 |
| [`constants.json`](#constantsjson) | 12KB | 493 | 🔒 静态 | **游戏枚举**（分类/聊天室/高管/报告） |
| [`resource_lookups.json`](#resource_lookupsjson) | 5KB | 152 | 🔒 静态 | **季节曲线、活动日期、调谐常数** |
| [`formulas_production.md`](#formulas_productionmd) | 13KB | 453 | 🔒 静态 | 生产速度公式 |
| [`formulas_admin.md`](#formulas_adminmd) | 12KB | 462 | 📐 半静态 | 行政开销 + 高管技能公式 |
| [`formulas_market.md`](#formulas_marketmd) | 12KB | 365 | 🔒 静态 | 市场价格 + 交易所公式 |
| [`formulas_retail.md`](#formulas_retailmd) | 15KB | 408 | 📐 半静态 | 零售销售 + 季节 + 运输公式 |
| [`economy_model.json`](#economy_modeljson) | 115KB | — | 📐 半静态 | **151资源 × 3经济状态** 的经济模型参数 |
| [`research_tree.json`](#research_treejson) | 23KB | — | 🔒 静态 | **12种研究** + 9研究室 + 品质级别 |
| [`redux_store.json`](#redux_storejson) | 21KB | — | 🔒 静态 | **22个** Redux state slice 结构 |
| [`achievements.json`](#achievementsjson) | 20KB | — | 🔄 动态 | **13类成就** + 35种证书 + 5个API |
| [`tutorial.json`](#tutorialjson) | 31KB | — | 🔒 静态 | 新手教程**完整流程**（经典7步 + 新版9步） |
| [`formulas_government.md`](#formulas_governmentmd) | 15KB | 380 | 📐 半静态 | **政府订单** tier/投标/押金/奖励 |
| [`formulas_aerospace.md`](#formulas_aerospacemd) | 12KB | 276 | 🔒 静态 | **火箭/航空** 类型/发射/合同 |
| [`formulas_bonds.md`](#formulas_bondsmd) | 14KB | — | 📐 半静态 | **债券系统**（评级/利率/发行/购买/赎回/违约） |

---

## resources.json

**151 种资源**，每个资源包含：

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `dbLetter` | number | 资源 ID | 3 |
| `name` | string | 英文名（从图片路径推断） | Apples |
| `sincePhase` | number | 引入阶段 | 0 |
| `producedPerHourRaw` | number | 基础每小时产量 | 250 |
| `producedAt` | string | 生产建筑 dbLetter | "P" |
| `producedFrom` | object | 配方 `{原料ID: 数量}` | `{2:3, 66:1}` |
| `transportation` | number | 单位运输费 | 1 |
| `unitsSoldAnHour` | number | 零售需求/小时（0=不可零售） | 110 |
| `consumption` | number | 经济模型消费权重 | 12.46 |
| `isExchangeTradable` | boolean | 可交易所交易 | true |
| `isResearch` | boolean | 是研发品 | false |
| `hasEconomyModel` | boolean | 有经济模型 | true |
| `decay` | number | 衰减率（0=不衰减） | 0 |
| `productionSeason` | string\|null | 生产季节 | null |
| `retailSeason` | string\|null | 零售季节 | null |
| `productionMechanic` | object? | 特殊生产机制（accumulator） | — |

### 快速查找
- **原材料**：`producedFrom` 为空 `{}` → Power(1), Water(2), Seeds(66), Wood(...
- **可零售**：`unitsSoldAnHour` > 0
- **季节品**：`retailSeason` ≠ null → Xmas(67,144,150), Halloween(147,148), Easter(151,155), Ramadan(152), Summer(153,154)
- **有衰减**：`decay` > 0 → Icecream(153,154)
- **accumulator**：Tree(150) — baseValue=10, max=81910, bonusPerQuality=4%

---

## buildings.json

**54 种建筑**，分类：

| 分类 | 数量 | 典型建筑 |
|------|------|---------|
| production | 31 | Plantation, Factory, Mine, Oil Rig... |
| sales | 8 | Grocery Store, Car Dealership, Restaurant... |
| research | 10 | Academy, Tech Lab, Archeology Site... |
| recreation | 3 | Park, Beach, Plaza... |
| seasonal | 4 | Xmas Market, Halloween Shop, Easter Shop... |
| other | 2 | Headquarters, Warehouse... |

每条建筑记录：`name`, `dbLetter`, `category`, `costUnits`, `buildDuration`, `salaryModifier`, `tiers[]`

### 建筑造价公式
```
市场采购价 = Σ tickerPrice[kind] × costUnits × qp[kind]     (qp = {101:4, 102:55, 108:16, 111:1})
兜底价     = costUnits × 10 × 345 = costUnits × 3450
升级消耗   = qp[resId] × costUnits × currentSize
```

### 工资公式
```
单建筑工资/tick = 345 × salaryModifier × size
```

---

## constants.json

### 建筑分类 `on`
| 键 | 值 |
|----|-----|
| PRODUCTION | production |
| SALES | sales |
| RESEARCH | research |
| RECREATION | recreation |
| OTHER | other |
| SEASONAL | seasonal |

### 聊天室 `zd` | `Tm`
- `zd`: GAME_EN, GAME_HI, SUPPORTERS, MODERATORS, TEACHERS, AEROSPACE_EN
- `Tm`: GAME, ROLEPLAY, SUPPORTER, SOCIAL, HELP, SALES

### 高管动作 `Ts`
INTRO, OFFER, COUNTER_OFFER, RETRACT_OFFER, ACCEPT_OFFER, MERGER, MERGER_ACCEPT, REJECT_OFFER

### 平台 `hO`
APPLE, GOOGLE, STEAM

### 资源分组 `_resourceArrays`
- UP (农业 13种), OP (食品饮料 27种), IP (建筑 11种), MP (时尚 10种), RP (能源 7种)
- NP (电子 12种), DP (汽车 12种), LP (航空 20种), FP (原材料 16种), jP (研发 12种)

---

## resource_lookups.json

### 季节曲线 `npr`
5 个季节，每个有日期-饱和度折线。饱和度 > 0.8 视为"活跃"。
- Ramadan: 02-18 ~ 03-30
- Easter: 03-20 ~ 04-30
- Summer: 07-14 ~ 09-14
- Halloween: 10-15 ~ 11-15
- Xmas: 11-25 ~ 12-31 (带前期0.3)

### 游戏常数 `Ji`

| 常数 | 值 | 含义 |
|------|-----|------|
| AVERAGE_SALARY | 345 | 基准工资 |
| ROBOT_COST | 940 | 机器人单价 |
| PURCHASE_SIMBOOSTS_FEE | 0.1 | SimBoost 购买费率 |
| PRODUCTION_SPEED_MODIFIER_DAYS | 21 | 生产加速持续天数 |
| LAUNCH_QUEUE_MAX | 30 | 发射队列上限 |
| TUTORIAL_BONUS | 12000 | 教程奖励金 |
| RETAIL_MODELING_QUALITY_WEIGHT | 0.3 | 零售品质权重 |
| MIN_WEATHER_SPEED_MULTIPLIER | 0.3 | 天气最低倍率 |
| MAX_WEATHER_SPEED_MULTIPLIER | 1.7 | 天气最高倍率 |
| TAG_EXPIRY_DAYS | 3 | 标签过期天数 |

### 建筑分组 `dpr`
将建筑 dbLetter 映射到其可销售的资源 ID 数组。共 12 组。

---

## formulas_production.md

### 核心公式链

```
1. B6t(producedPerHourRaw, salaryMid, buildingType)
   = producedPerHourRaw × (345 / SALARY_MID[level]) ^ salaryModifier
   → 调整工资水平后的基础产量

2. $6t(dbLetter, salary%, quality, size, baseProd, modifier)
   = size × adjustedBase / (1 - salary% / 100)
   where adjustedBase = baseProd × (1 + speedModifier/100)
   采矿类额外 × quality/100

3. 机器人效果（仅 accumulator 建筑）：
   effectiveSalary = salary% + 4 × robots
   producedPerHour = size × adjustedBase / (1 - effectiveSalary/100)

4. 总加成：
   totalBonus = productionModifier + recreationBonus + accumulatorQualityBonus
   finalSpeed = anHour / (1 - totalBonus/100)

5. 生产时间：
   timePerUnit = 345 × salaryModifier × size / producedPerHour
   timeForQueue = max(0, spareCapacity-1) × timePerUnit
   spareCapacity = ph(adminOverhead, cooSkill)  [COO减免]
```

### 研发加成
```
researchProduction = $6t(...) × (100 + ctoSkill × 2) / 100
```

### 采矿资源（quality影响产量）
Crude Oil, Minerals, Bauxite, Iron Ore, Sand, Gold Ore, Methane, Clay, Limestone

### Accumulator 机制
```
accumulatorValue = baseValue × 2^quality
qualityLevel = max{u | currentValue ≥ baseValue × 2^u}
```

---

## formulas_admin.md

### 建筑点数
```
i = Σ building.size × 100   (排除HQ和免费建筑)
```

### 行政开销倍数
```
服务端计算 → GET /api/v2/companies/me/administration-overhead/
存储在 user.administrationOverhead（如 1.05 = 5% overhead）
```

### COO 减免
```
effectiveOverhead = AO - (AO - 1) × skillCOO / 100
```
COO 技能 100 时完全消除 overhead。

### 边际 Admin 成本
```
moreAdmins = (AO_plusOne - 1) × (i + 100) - (AO_current - 1) × i
```

### Admin 数量上限
```
ade(buildingPoints) = min(floor(buildingPoints / 4), K0)
```

### 高管技能计算
```
rawSum = Σ exec_skill × positionMultiplier
  positionMultiplier: 匹配=1.0 | 学徒=0.5 | 其他高管=0.25 | 非高管=0

effectiveSkill = floor(s5t(rawSum))
  s5t(x): x≤60→x, 60<x≤80→60+(x-60)/2, x>80→70+(x-80)/2
```

---

## formulas_market.md

### 价格 Tick 表（交易所最小价格单位）

| 价格区间 | Tick |
|----------|------|
| ≥20,000 | 500 |
| 10,000-19,999 | 100 |
| 5,000-9,999 | 25 |
| 1,000-4,999 | 10 |
| 500-999 | 5 |
| 200-499 | 2 |
| 100-199 | 1 |
| 50-99 | 0.5 |
| 20-49 | 0.25 |
| 5-19 | 0.1 |
| 2-4.9 | 0.05 |
| 1-1.9 | 0.01 |
| 0.5-0.9 | 0.005 |
| <0.5 | 0.001 |

### 交易所手续费
```
fee = ceil(amount × price × 0.04)    // 两服统一 4%
```

### 卖单利润估算
```
revenue = amount × price
sourceCost = amount × unitSourceCost
transportCost = ceil(amount × transportationRate) × transportationUnitPrice
fee = ceil(amount × price × 0.04)
profit = revenue - sourceCost - fee - transportCost
```

### 零售经济模型
核心函数 `kle(buildingKind, economyModel, ..., price, quality, saturation, ..., weather)`
→ 返回售出指定数量所需小时数

内层 `J7r` 考虑：
- 饱和度 → 需求弹性 (0.9–1.485)
- quality/12 → 品质影响
- Zor(370) × 经济模型 → 基础吞吐量
- 二次价格惩罚（偏离最优价越远卖越慢）

---

## formulas_retail.md

### 零售需求
```
unitsSoldAnHour → 资源定义的每小时基础需求
实际销量 = kle(...) → 受价格/品质/饱和度/季节/天气/加速共同影响
```

### 季节系统
```
U6t(resource, date) → 线性插值计算当前饱和度
饱和度 > 0.8 → 季节活跃 → 该资源可零售
```

### CMO 加成
```
effectiveSalesMod = salesModifier + recreationBonus + floor(skillCMO / 3)
```

### 利润计算

---

## economy_model.json

**151 种资源 × 3 个经济状态** (0=衰退, 1=正常, 2=繁荣) 的完整经济模拟参数。

每条记录 :
| 字段 | 说明 |
|------|------|
| `buildingLevelsNeededPerUnitPerHour` | 每单位/小时需要的建筑等级 |
| `modeledProductionCostPerUnit` | 单位生产成本 |
| `modeledStoreWages` | 零售店工资（null=不可零售） |
| `modeledUnitsSoldAnHour` | 每小时零售需求 |

质量子模型: 资源150 包含 quality[0..12] 的逐级参数。

---

## research_tree.json

**12 种研究类型**，通过 **9 种研究室** 产出:

| 研究类型 | 研究室 |
|----------|--------|
| Plant, Energy, Mining, Electronics | Plant Research Center, Physics Lab |
| Breeding | Breeding Research |
| Chemistry, Materials | Chemistry Research |
| Software | Software Research |
| Automotive | Race Track |
| Fashion | Fashion Research |
| Aerospace | Launchpad |
| Recipes | Kitchen |

**品质系统**: 12 个品质级别，专利需求递进: 12→50→500→2000→5000→10000(×5)→50000(×2)
**专利成功率**: 基础 6.25%/研究点，受 CTO 科学技能加成
Sourcing 成本: $50(Fashion) ~ $180(Electronics)
公司级别 10 解锁研究

---

## redux_store.json

**22 个 Redux state slice**，完整结构:

`user` (认证/公司/金钱/等级/行政开销/天气/高管/SimBoost...)
`buildings` (按 ID 索引，含 busy 状态)
`warehouse` (资源库存/合同)
`market` (ticker/订单/交易所)
`messages` (聊天室/联系人/通知)
`achievements` `executives` `research` `bonds` `governmentOrders` ...

中间件: redux-thunk + asyncDispatch

---

## achievements.json

**13 类成就**: Builder/Employer/RetailSeller/MarketSeller/MarketBuyer/Scientist/KnowItAll/Overachiever/Mentor/Supplier/Prospector/GOBureaucrat/Architect
**35 种证书**: 每类成就有对应的证书等级
**每日成就**: Logged in today + Produced or sold today
**等级加成**: 每 5 级 +1% 生产或销售速度
**5 个 API 端点**: 获取/删除/同步成就
**奖励**: 现金 + SimBoost + 动画采集流程
成就定义在服务端，前端仅获取展示

---

## tutorial.json

两套教程系统:

**经典教程** (7 步):
RESEARCH → BUYING_WATER → BUYING_SEEDS → PRODUCING → RETAILING → WAITING → DONE

**新版 FTUE** (9 步):
COLLECT_1 → SELL_1 → EVALUATE → PRODUCE_2 → WAITING_2 → COLLECT_2 → PRODUCE_3 → EXPAND → DONE

**13 个教程后建议** + **19 个语音引导 ID** + **14 类提示分类** (CATEGORY_EXCHANGE/PRODUCTION/RETAIL...)
**奖励**: 教程奖励金 12000 + 苹果 50 + 种子 150

---

## formulas_government.md

政府订单完整机制:
- **Tier 系统**: 多 tier 等级，每 tier 有不同资源需求
- **投标公式**: `floor(estimatedBaseValue × resourceMultiplicator × 0.1)` 计算押金
- **奖励公式**: `Σ amount × bidPrice` 每资源
- **最低品质**: `quality >= requiredQuality`
- **12 个 API 端点**: bid/contractor/fulfillment
- **4 种交易类型**: DEPOSIT/DEPOSIT_RETURNED/DEPOSIT_LOST/FULFILLED

---

## formulas_aerospace.md

航空/火箭系统:
- 火箭类型及参数
- 发射条件（资源/研究）
- 发射队列机制 (max 30)
- 发射成功/失败公式
- 航空合同系统
- 发射台建筑参数

---

## formulas_bonds.md

债券系统:
- **18 种评级** (7 个筛选组)
- 面值: `go = 5000`
- 利率公式: `dailyInterest = faceValue × interestRate / 365`
- 利率范围: 0.5% ~ 2.0%，步长 0.1%
- **14 天锁定期**: 发行后 14 天内不可赎回
- **部分赎回**: 支持部分提前赎回
- **违约/重组**: 无力偿还时可重组（降低债券持有者收益）
- 发行限制: 公司级别 ≥ 10，抵押品上限
- 现金流分类: 9 种债券相关交易类型
- **8 个 API 端点**
## 快速查询指南

| 我想知道... | 去看... |
|-------------|--------|
| 某个资源的配方/产量/零售需求 | 🔒 静态 | `resources.json` |
| 某个建筑的造价/工资/升级 | 🔒 静态 | `buildings.json` |
| 采矿为什么 quality 影响产量 | 🔒 静态 | `formulas_production.md` §3 |
| 怎么算生产一单位要多久 | 🔒 静态 | `formulas_production.md` §6 |
| 行政开销怎么算 | 📐 半静态 | `formulas_admin.md` §2 |
| COO 能减多少 overhead | 📐 半静态 | `formulas_admin.md` §5 |
| 高管技能怎么叠加 | 📐 半静态 | `formulas_admin.md` §6 |
| 交易所价格最小单位 | 🔒 静态 | `formulas_market.md` §2 |
| 交易所手续费多少 | 🔒 静态 | `formulas_market.md` §3 |
| 零售店怎么定价最优 | 🔒 静态 | `formulas_market.md` §9 + `formulas_retail.md` §3 |
| 什么时候能卖季节商品 | 📐 半静态 | `formulas_retail.md` §2 |
| 机器人对产量有什么用 | 🔒 静态 | `formulas_production.md` §3 |
| 建筑升级要多少材料 | 🔒 静态 | `buildings.json` _meta.upgradeFormula |
| 有哪几种建筑分类 | 🔒 静态 | `constants.json` on |
| 有哪几个季节活动 | 🔒 静态 | `resource_lookups.json` npr |
| 经济模型参数查询 | 📐 半静态 | `economy_model.json` |
| 研究树/品质系统 | 🔒 静态 | `research_tree.json` |
| Redux store 结构 | 🔒 静态 | `redux_store.json` |
| 成就列表和条件 | 🔄 动态 | `achievements.json` |
| 教程步骤流程 | 🔒 静态 | `tutorial.json` |
| 政府订单 tier/投标 | 📐 半静态 | `formulas_government.md` |
| 火箭/航空怎么玩 | 🔒 静态 | `formulas_aerospace.md` |
| 债券利率和赎回 | 📐 半静态 | `formulas_bonds.md` |

---

## 游戏更新后如何重新提取

### 哪些需要重跑

| 更新类型 | 需要重跑 | 例子 |
|----------|---------|------|
| 新资源/建筑 | 🔒 静态数据 | `resources.json`, `buildings.json` |
| 配方调整 | 🔒 静态数据 | `resources.json` producedFrom |
| 公式改动 | 🔒 静态数据 | `formulas_*.md` |
| 新玩法（债券/航空...） | 🔒 静态数据 + 新公式 | 新增对应文件 |
| 季节调整 | 🔒 静态数据 | `resource_lookups.json` |
| 经济模型调参 | 📐 半静态 | `economy_model.json` |
| **市场价变动** | ❌ 不用 | 走 API 的，本来就不是静态数据 |
| **成就进度** | ❌ 不用 | 服务端数据 |

### 操作步骤

```
1. 浏览器抓新 HAR（完整加载一次游戏页面）
   → 另存为 sources/simcompanies-YYYY-MM-DD.har

2. 解压 JS
   npx @wakaru/cli --unpack --level aggressive \
     -o decompiled/modules/ \
     extracted_js/main.js

3. 对照 INDEX.md 的 "来源" 列，重新提取 🔒 静态 和 📐 半静态 文件
   → 每个文件头都有 source: "chunk_xxx.js:line-range"

4. diff 新旧版本，看改了什么
   → git diff 或者 diff old/data/ new/data/
```

> 不走 API 的数据都随 JS 版本更新。更新频率：Sim Companies 大概 2-4 周一个版本。
