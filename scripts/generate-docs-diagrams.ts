import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const docsDir = path.resolve(process.cwd(), 'docs');
fs.mkdirSync(docsDir, { recursive: true });

const diagrams: Record<string, string> = {
  'storyboard': `journey
    title 玩家核心商业生命周期全景故事板 (Player End-to-End Storyboard)
    section 1. 登入与初始化
      访客访问 /zh-cn/: 5: 玩家
      填写邮箱注册或密码登录: 4: 玩家
      加载公司主页 Landscape & 资产: 5: 玩家, 前端
    section 2. 基础设施建设
      点击空闲地块选择建筑 (如种植园/农场): 4: 玩家
      扣减现金与建材，进入建造倒计时: 5: 后端
      建造完成，地块转为可用状态: 5: 前端, 后端
    section 3. 生产与供应链
      点击建筑进入生产面板，配置配方与数量: 4: 玩家
      提交生产: 扣减原料库存，锁定建筑 busy_until: 5: 后端
      生产倒计时结束，点击 Collect 货物入库: 5: 玩家, 后端
    section 4. 商业流通与市场
      在仓库发起交易所挂单 (输入价格/品质/数量): 4: 玩家
      交易所挂单生效，扣除 3% 挂单手续费: 5: 后端
      其他公司购买，买方扣款入库，卖方收回货款: 5: 后端
    section 5. 扩张与资本运作
      雇佣高管团队 (COO/CFO/CMO/CTO) 降低生产成本: 4: 玩家
      发行公司债券获取流动资金，或投资其他公司债券: 4: 玩家
      开设高级零售/餐厅，安排 12h 运营周期与菜单: 5: 玩家, 后端`,

  'ipo-chart': `flowchart TD
    subgraph Construction_IPO [1. 建筑建造 IPO]
        In1["INPUT: companyId, position, kind"] --> Proc1["PROCESS: 校验槽位与建材库存<br/>扣减资金/建材, 插入 Building, 设 busy_until"]
        Proc1 --> Out1["OUTPUT: SimCompaniesBuildingDTO<br/>Building 锁定倒计时"]
    end

    subgraph Production_IPO [2. 生产队列 IPO]
        In2["INPUT: buildingId, recipeKind, amount"] --> Proc2["PROCESS: 校验原料充足, 原子扣库存<br/>扣减工人工资, 计算完成时间 finishes_at"]
        Proc2 --> Out2["OUTPUT: ProductionQueueDTO<br/>building.busy_until = finishes_at"]
    end

    subgraph Collect_IPO [3. 生产收取 IPO]
        In3["INPUT: queueId, companyId"] --> Proc3["PROCESS: 校验已到期且 resolved=0<br/>加权平均计算单位 COGS, 货物入库 Warehouse"]
        Proc3 --> Out3["OUTPUT: 产出品入库<br/>resolved=1, 触发 ProductionCollected 事件"]
    end

    subgraph Market_IPO [4. 市场买卖 IPO]
        In4["INPUT: orderId, buyQuantity"] --> Proc4["PROCESS: 校验买方余额, 严格防自买自卖<br/>买方扣款, 卖方收款, 转移物品所有权"]
        Proc4 --> Out4["OUTPUT: cash_ledger 双向流水<br/>market_trades 记录 VWAP 交易明细"]
    end`,

  'class-diagram': `classDiagram
    direction TB

    class Company {
        +int id
        +int companyId
        +int playerId
        +string name
        +float money
        +int simboosts
        +int level
        +string rating
        +int realmId
        +int extraBuildingSlots
        +creditMoney(amount)
        +debitMoney(amount)
        +spendSimBoosts(amount)
        +addExperience(xp)
    }

    class Building {
        +int id
        +int companyId
        +string position
        +string kind
        +int size
        +float cost
        +string category
        +Date busyUntil
        +isBusy() bool
        +canUpgrade() bool
    }

    class ProductionQueue {
        +int id
        +int buildingId
        +int companyId
        +int kind
        +int quality
        +float amount
        +float cost
        +Date startedAt
        +Date finishesAt
        +bool resolved
        +isFinished() bool
    }

    class WarehouseItem {
        +int id
        +int companyId
        +int kind
        +int quality
        +float amount
        +float costWorkers
        +float costAdmin
        +getUnitCost() float
    }

    class MarketOrder {
        +int id
        +int sellerId
        +int kind
        +int quality
        +float quantity
        +float price
        +float fees
        +bool active
        +bool isNpc
    }

    class Executive {
        +int id
        +int companyId
        +string name
        +string position
        +int skillManagement
        +int skillAccounting
        +int skillScience
        +int skillCommunication
        +float salary
        +string status
    }

    class Bond {
        +int id
        +int sellerCompanyId
        +int buyerCompanyId
        +float amount
        +float interestRate
        +string status
        +Date maturityDate
    }

    class Contract {
        +int id
        +int senderCompanyId
        +int recipientCompanyId
        +int kind
        +int quality
        +float amount
        +float price
        +string status
    }

    class RestaurantRun {
        +int id
        +int buildingId
        +int companyId
        +string status
        +float rating
        +float revenue
        +float cost
        +Date cycleStart
        +Date cycleEnd
    }

    Company "1" *-- "many" Building : owns
    Company "1" *-- "many" WarehouseItem : holds
    Company "1" *-- "many" Executive : employs
    Building "1" *-- "0..*" ProductionQueue : schedules
    Building "1" *-- "0..*" RestaurantRun : operates
    Company "1" *-- "0..*" MarketOrder : posts
    Company "1" *-- "0..*" Bond : issues/invests
    Company "1" *-- "0..*" Contract : transacts`,

  'state-diagram': `stateDiagram-v2
    direction TB

    state "生产队列状态机 (Production Queue)" as ProdState {
        [*] --> Idle
        Idle --> InProduction: POST /order/start/ (扣料/锁定建筑)
        InProduction --> Cancelled: POST /order/cancel/ (退料/解锁)
        InProduction --> Finished: 到期 finishes_at <= now
        Finished --> Collected: POST /order/take/ (COGS加权入库/解锁)
        Cancelled --> [*]
        Collected --> [*]
    }

    state "餐厅 12 小时周期状态机 (Restaurant Cycle)" as RestState {
        [*] --> Closed
        Closed --> Scheduled: 玩家配置菜单与员工排期
        Scheduled --> Running: 12h 周期准时开始运行
        Running --> StopScheduled: 玩家点击"周期结束后停业"
        Running --> Running: 自动连续营业结算并进入下一期
        StopScheduled --> Closed: 周期结束彻底停业结算
    }

    state "建筑生命周期 (Building Lifecycle)" as BuildState {
        [*] --> UnderConstruction: 建造扣款/扣建材
        UnderConstruction --> Ready: busy_until 到期
        Ready --> Upgrading: 升级扣款/扣建材
        Upgrading --> Ready: 升级完成 size += 1
        Ready --> Demolishing: 拆除返还 Scrap
        Demolishing --> [*]: 地块释放
    }

    state "市场订单状态机 (Market Order)" as MarketState {
        [*] --> Active: 挂单托管库存/扣3%手续费
        Active --> Active: 部分成交 quantity -= buyQty
        Active --> Fulfilled: 全部成交 quantity == 0
        Active --> UserCancelled: 撤单退回库存
        Fulfilled --> [*]
        UserCancelled --> [*]
    }`,

  'sequence-diagram': `sequenceDiagram
    autonumber
    actor Player as 玩家浏览器 (DOM)
    participant Route as Declarative Router / Route Handler
    participant Adapter as Compatibility DTO Adapter
    participant UseCase as Application Use Case (Collect)
    participant Repo as Domain Repositories
    participant DB as SQLite Transaction Manager
    participant EventBus as In-Process Domain Event Bus
    participant WS as WebSocket Push Service

    Player->>Route: POST /api/v2/order/take/:id/ (Session Cookie)
    activate Route
    Route->>Route: resolveGameContext(session) 校验登录态与 CompanyId
    
    Route->>UseCase: execute(CollectProductionCommand)
    activate UseCase
    
    UseCase->>DB: runTransaction(async tx => { ... })
    activate DB
    
    DB->>Repo: getQueueById(queueId)
    Repo-->>DB: ProductionQueueEntity (resolved=0, finishes_at<=now)
    
    DB->>Repo: getBuildingById(buildingId)
    Repo-->>DB: BuildingEntity (ownership ok)
    
    DB->>Repo: addWarehouseInventory(companyId, kind, quality, amount, cogs)
    DB->>Repo: markQueueResolved(queueId)
    DB->>Repo: clearBuildingBusy(buildingId)
    
    DB-->>UseCase: Transaction Committed (原子提交)
    deactivate DB
    
    UseCase->>EventBus: publishAfterCommit(new ProductionCollectedEvent(...))
    activate EventBus
    EventBus-->>WS: broadcastUpdate(companyId, "warehouse_updated")
    deactivate EventBus
    
    UseCase-->>Route: CollectProductionResult (内部领域模型)
    deactivate UseCase
    
    Route->>Adapter: toSimCompaniesCollectResponse(result)
    Adapter-->>Route: { success: true, moneyUpdate: ..., resourceTransactions: ... }
    
    Route-->>Player: HTTP 200 JSON Response
    deactivate Route
    
    Player->>Player: 客户端 DOM 局部刷新 (库存增加、建筑恢复空闲)`,

  'erd': `erDiagram
    PLAYERS ||--o{ SESSIONS : "authenticates"
    PLAYERS ||--|{ COMPANIES : "owns"
    
    COMPANIES ||--o{ BUILDINGS : "constructs"
    COMPANIES ||--o{ WAREHOUSE : "holds inventory"
    COMPANIES ||--o{ MARKET_ORDERS : "posts"
    COMPANIES ||--o{ CONTRACTS : "sender/recipient"
    COMPANIES ||--o{ BONDS : "issues/invests"
    COMPANIES ||--o{ EXECUTIVES : "employs"
    COMPANIES ||--o{ RESEARCH : "researches"
    COMPANIES ||--o{ CASH_LEDGER : "audits transactions"
    
    BUILDINGS ||--o{ PRODUCTION_QUEUES : "schedules"
    BUILDINGS ||--o{ RETAIL_ORDERS : "retails"
    BUILDINGS ||--o{ RESTAURANT_RUNS : "executes"
    
    NEWSPAPER_ISSUES ||--o{ NEWSPAPER_ARTICLES : "publishes"
    NEWSPAPER_ARTICLES ||--o{ NEWSPAPER_REACTIONS : "reacts"
    
    PLAYERS {
        int id PK
        int player_id UK
        string email UK
        string password_hash
        int is_admin
        string created_at
    }

    COMPANIES {
        int id PK
        int company_id UK
        int player_id FK
        string name
        float money
        int simboosts
        int level
        int realm_id
        int extra_building_slots
    }

    BUILDINGS {
        int id PK
        int company_id FK
        string position
        string kind
        int size
        float cost
        string busy_until
    }

    PRODUCTION_QUEUES {
        int id PK
        int building_id FK
        int company_id FK
        int kind
        int quality
        float amount
        float cost
        string finishes_at
        int resolved
    }

    WAREHOUSE {
        int id PK
        int company_id FK
        int kind
        int quality
        float amount
        float cost_workers
        float cost_admin
    }

    MARKET_ORDERS {
        int id PK
        int seller_id FK
        int kind
        int quality
        float quantity
        float price
        float fees
        int active
    }

    CASH_LEDGER {
        int id PK
        int company_id FK
        float amount
        string reason
        string created_at
    }`,

  'dfd': `flowchart TD
    subgraph Market_Trading_Context [市场交易数据流图]
        Buyer[买方公司 (Buyer)] -->|1. 提交买单请求 POST /api/v2/market/buy/| Route[Market Route Handler]
        Route -->|2. 校验资金与订单状态| OrderEngine[Market Matching Engine]
        
        OrderEngine -->|3. 开启原子事务| TX[SQLite DB Transaction]
        
        TX -->|4. 扣减买方现金| CashDebit[Cash: Debit Buyer]
        TX -->|5. 增加卖方现金| CashCredit[Cash: Credit Seller]
        TX -->|6. 划转物品所有权| InventoryTransfer[Warehouse: Transfer Qty & Update COGS]
        TX -->|7. 更新挂单状态| OrderUpdate[MarketOrders: Set active / update qty]
        TX -->|8. 记录 VWAP 交易明细| TradeLedger[MarketTrades Ledger]
        
        CashDebit --> RecordLedger[Cash Ledger: 记录双边审计账本]
        CashCredit --> RecordLedger
        
        TX -->|9. Transaction Commit| Committed[事务成功提交]
    end

    subgraph After_Commit_Side_Effects [事务后异步副作用]
        Committed -->|10. Emit Typed Event| EventBus[Domain Event Bus: MarketTradeCompleted]
        EventBus -->|11. 检查交易成就| AchProg[Achievement Progress Updater]
        EventBus -->|12. 刷新实时行情| VWAPService[VWAP Price & Tick Tracker]
        EventBus -->|13. 消息通知| NotifyService[Chat / Notification Service]
        EventBus -->|14. 广播客户端| WS[WebSocket Push: Balance & Warehouse Delta]
    end`
};

async function main() {
  console.log('--- Rendering Mermaid Architecture Diagrams to PNG in docs/ ---');
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    for (const [name, code] of Object.entries(diagrams)) {
      console.log(`Rendering ${name}.png...`);
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    body {
      margin: 0;
      padding: 40px;
      background-color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      display: inline-block;
    }
    #container {
      background: #ffffff;
      border-radius: 8px;
      padding: 20px;
    }
  </style>
</head>
<body>
  <div id="container">
    <pre class="mermaid">
${code}
    </pre>
  </div>
  <script>
    mermaid.initialize({
      startOnLoad: true,
      theme: 'default',
      themeVariables: {
        fontSize: '16px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif'
      }
    });
  </script>
</body>
</html>
`;

      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
      await page.waitForSelector('svg', { timeout: 10000 });

      const container = await page.$('#container');
      if (container) {
        const outPath = path.join(docsDir, `${name}.png`);
        await container.screenshot({ path: outPath, omitBackground: false });
        console.log(`  -> Saved: docs/${name}.png`);
      }
      await page.close();
    }
    console.log('\nALL 7 DIAGRAMS RENDERED TO PNG SUCCESSFULLY IN docs/');
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Diagram rendering failed:', err);
  process.exit(1);
});
