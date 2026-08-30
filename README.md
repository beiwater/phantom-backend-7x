# SimCompanies Private Server (私人服务器兼容层)

这是一个基于 SimCompanies 官方前端资源（HTML / CSS / Vite React JS Bundle / 静态资源 / 语言包），通过全套自研兼容后端与 SQLite 数据库驱动的独立私人服务器项目。

---

## 核心架构设计

```
simcompanies-private/
├── frontend-original/
│   ├── html/
│   │   ├── index.html                   # 本地修补后的前端入口（注入会话与安全存根）
│   │   └── original_zh_cn.html          # 官方原始页面备份
│   └── static/
│       ├── bundle/                      # Vite 打包的 React 核心 JS / CSS
│       ├── CACHE5/                      # 全局基础样式与框架 CSS
│       ├── js/lang6/                    # 多语言翻译字典 (zh-cn.json, en.json 等)
│       └── manifest.json                # Django 静态资源映射清单 (1937项)
├── server/
│   ├── index.ts                         # HTTP + WebSocket 服务器入口
│   ├── router.ts                        # 统一路由分发器与 API 控制器
│   ├── config.ts                        # 端口、倍速、初始资金配置
│   ├── auth/
│   │   └── session.ts                   # 多用户会话管理、Cookie 提取与凭证校验
│   ├── db/
│   │   └── database.ts                  # Node.js 原生 SQLite 驱动、多用户密码哈希与建表
│   ├── game/
│   │   ├── constants.ts                 # 核心公式、建筑与资源常数
│   │   ├── company.ts                   # 公司与用户服务、多公司与 Realm 切换
│   │   ├── buildings.ts                 # 地图建筑、建造、升级、降级与拆除
│   │   ├── warehouse.ts                 # 仓库库存、品质、成本核算
│   │   ├── production.ts                # 生产队列、配方输入消耗与定时产出
│   │   └── market.ts                    # 交易所挂单、行情 Ticker、撮合与购买
│   ├── ws/
│   │   └── websocket.ts                 # 原生 WebSocket 通信与频道同步 (/ws)
│   └── proxy/
│       └── asset-fetcher.ts             # 静态资源本地直读 + 上游按需拉取缓存管道
├── data/
│   └── simcompanies.sqlite              # 本地游戏持久化数据库
├── screenshots/                         # E2E 自动化测试全流程截图
├── package.json
└── tsconfig.json
```

---

## 多用户系统与认证路由

| 路由 / API 端点 | 方法 | 功能描述 |
|---|---|---|
| `/zh-cn/signin/` | `GET` | 用户登录前端页面 |
| `/zh-cn/signup/` | `GET` | 用户注册前端页面 |
| `/zh-cn/account-settings/` | `GET` | 个人账户设置、偏好与设备管理页面 |
| `/zh-cn/company/:realm/:name/` | `GET` | 公司公开档案主页 |
| `/zh-cn/signout/` & `/logout/` | `GET` | 登出当前用户并清除 Session Cookie |
| `/api/v2/auth/email/auth/` | `POST` | 邮箱密码登录验证，颁发 Session Token |
| `/api/v2/auth/email/connect/` | `POST` | 邮箱密码注册并创建初始公司 |
| `/api/v2/auth/email/reset/` | `POST` | 密码重置请求接口 |
| `/api/v1/realm/:realmId/switch/` | `POST` | 切换玩家激活 Realm (Magnates / Entrepreneurs) |
| `/api/v1/realm-create-company/:realmId/` | `POST` | 在指定 Realm 创建新分公司 |
| `/api/v2/players/:id/preferences/` | `POST` | 更新玩家偏好设置（主题/语言/通知） |
| `/api/v2/players/:id/personal-data/` | `GET` | 导出 GDPR 个人数据包 |
| `/api/v3/companies/:id/` | `PATCH` | 公司重置 (`level: 0`) 或修改公司信息 |

---

## 游戏核心闭环与多账号隔离

1. **多账号隔离**：
   - 每个账号拥有独立邮箱、密码哈希、Session Token。
   - 玩家之间资金独立、仓库独立、地图地块独立。
2. **多公司与 Realm 体系**：
   - 支持同一玩家在 Realm 0 (Magnates) 与 Realm 1 (Entrepreneurs) 分别拥有公司，并能随时平滑切换。
3. **商业循环闭环**：
   - `注册/登录 → 查阅公司地图 → 建造/扩建农场与工商业建筑 → 排产商品 → 自动扣除原料 → 交易所挂单售出 → 买家撮合交易 → 资金入账`。

---

## 运行与测试

### 启动服务器
```bash
cd simcompanies-private
npm start
```
访问：`http://127.0.0.1:3000/zh-cn/`

### 运行全套真实浏览器 E2E 测试
```bash
cd simcompanies-private
node --experimental-strip-types tests/full-user-journey.test.ts
node --experimental-strip-types tests/multi-account.test.ts
node --experimental-strip-types tests/interactive-gameplay.test.ts
```
