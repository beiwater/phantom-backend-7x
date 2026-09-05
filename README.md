# SimCompanies Private Server

这是一个面向本机运行的 SimCompanies 私有服务器：使用仓库内的原版前端连接本地后端，便于离线体验、开发和兼容性重建。项目仍在持续重建中，个别功能可能尚未完整，不把本 README 视为“所有已知问题均已解决”的保证。

## 快速开始

### 环境要求

- Node.js：`start.command` 会检查 22.12 或更新版本；服务器需要支持 `node --experimental-strip-types` 和内置 `node:sqlite`。
- npm：`start.command` 会检查 7 或更新版本，用于首次启动时按锁文件安装 `package.json` 中的依赖。
- 能访问本机地址的现代浏览器。

### 安装并启动

在仓库根目录执行：

```bash
./start.command
```

在 macOS 中也可以双击 `start.command`。脚本会以脚本所在目录为项目目录；依赖缺失时，存在 `package-lock.json` 就使用 `npm ci`，否则使用 `npm install`。服务器以前台进程运行，启动后打开：

<http://127.0.0.1:3100/zh-cn/>

首次启动或前端版本刚更新后，如果浏览器仍显示旧页面，按提示手动刷新一次即可。不要在表单编辑过程中反复刷新。

`HOST`、`PORT` 可由 shell 或 `.env` 显式指定；没有显式值时脚本使用 `127.0.0.1:3100`。修改端口后，请使用对应地址访问。

## `start.command` 默认游戏预设

每次运行脚本都会在该次服务器进程中强制提供以下游玩预设；脚本不会为了套用预设而改写 `.env`：

| 项目 | 进程环境值 | 说明 |
| --- | --- | --- |
| Realm 阶段 | `REALM_PHASE_PRESET=full` | 全部阶段开放 |
| 游戏速度 | `SPEED_MULTIPLIER=1.0` | `1x` |
| 建造速度 | `CONSTRUCTION_SPEED_MULTIPLIER=1.0` | 不额外加速 |
| 建造与升级时间 | `CONSTRUCTION_TIME_MODE=realistic` | 按真实建造时长 |
| 市场价格 | `MARKET_PRICING_MODE=realistic` | 项目现有正常定价模式（realistic） |
| 聊天室 | `CHATROOM_PRESET=single` | 仅 `Game` 房间（single Game） |
| 新公司 SimBoosts | `INITIAL_SIMBOOSTS=50` | 仅新建公司 |
| 新公司现金 | `INITIAL_MONEY=100000` | `$100000`，仅新建公司 |

最后两项是**新建公司**的初始现金和 SimBoosts，不是现有公司的重置，也不是公司的总资产估值。现有账户、公司余额、仓库、建筑和其他数据都会保留。

## 数据、安全停止与重启

- 默认数据目录是仓库根目录下的 `data/`；请备份该目录后再进行迁移或实验。
- `.env` 是本地配置文件，包含密码、会话或管理员设置时不要提交、分享或写入截图。可参考 `.env.example`，但请替换其中的敏感值。
- 服务器运行在前台时使用 `Ctrl-C` 停止。脚本和服务器会执行正常关闭流程并写回 SQLite；看到进程退出后再重新执行 `./start.command`。不要为释放端口而批量终止其他进程，也不要用强制终止代替正常停止。
- 重启不会删除数据库；登录原有账户即可继续原来的公司。初始值只在创建新公司时读取。

## 浏览器与当前服务器的 SHA 更新

浏览器可通过同源的 `/api/frontend-version/` 获取当前服务器前端的 SHA-256 版本标识；检测到版本标识变化时，页面会在合适的时机刷新一次，以避免继续使用旧资源。当前校验范围包括 HTML 入口、转换后的主 JS、bundle/CACHE5 CSS、浏览器翻译脚本、realm/company 切换适配器、中英文语言 JSON 和 `manifest.json`。

这个机制只把入口所绑定的前端版本与服务器当前版本进行对比，并在合法版本标识不同时按条件刷新；它不是浏览器逐文件验签，不是从 GitHub、官方服务器或其他远端拉取代码，也不会修复后端 API、游戏逻辑或数据库中的问题。未列入上述范围的资源、已有业务数据及正在编辑的表单不因 SHA 变化而自动迁移；若页面正在编辑重点表单，先保存或取消编辑再刷新。SHA 不是签名，不能保证资源来源真实性；版本接口失败时只记录警告，不会替用户下载远端内容。

## 旧版文档

- [旧版 README（原文存档）](docs/archive/README.previous.md)

