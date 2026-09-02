# 生产部署与运维操作指南 (Issue #147)

本指南针对 SimCompanies 私服（`phantom-backend-7x`）的生产环境部署、进程管理、日志监控、系统升级与回滚提供标准化规范。

---

## 1. 运行环境要求

- **操作系统**：Linux (Ubuntu 22.04 LTS / 24.04 LTS 或 Debian 12)
- **Node.js**：Node.js v22.0.0+ (支持 `--experimental-strip-types` 与原生 SQLite `node:sqlite`)
- **磁盘空间**：建议至少 10GB 可用空间（用于 SQLite 数据与定期 WAL Checkpoint）
- **内存**：建议 1GB~2GB 以上

---

## 2. 关键环境变量清单

| 变量名 | 必填/默认值 | 说明 |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` (生产环境) | 开启生产安全基线、NDJSON 结构化日志与严格密码检查 |
| `PORT` | 默认 `3000` | 监听 HTTP 端口 |
| `HOST` | 生产建议 `127.0.0.1` | 配合 Nginx 反向代理绑定本地接口 |
| `DATA_DIR` | 默认 `./data` | SQLite 数据库、持久化数据与备份目录 |
| `ADMIN_PASSWORD` | **生产必填** (>= 12 字符) | 管理员 Control Panel 与运维 API 的鉴权密码 |
| `BASE_URL` | 默认 `http://localhost:3000` | 服务的公开访问域名（如 `https://sim.example.com`） |
| `LOG_LEVEL` | 默认 `info` | 日志级别：`debug` / `info` / `warn` / `error` |

---

## 3. Systemd 托管部署步骤

### 3.1 安装服务文件
```bash
sudo cp deploy/simcompanies.service /etc/systemd/system/simcompanies.service
sudo systemctl daemon-reload
```

### 3.2 启动与开机自启
```bash
sudo systemctl enable simcompanies
sudo systemctl start simcompanies
```

### 3.3 状态检查与日志查看
```bash
# 查看运行状态
sudo systemctl status simcompanies

# 跟踪实时结构化日志
sudo journalctl -u simcompanies -f
```

---

## 4. 优雅关闭与平滑重启 (Graceful Shutdown)

服务监听了 `SIGTERM` 与 `SIGINT` 信号：
1. 收到关闭信号后立即停止接收新连接并关闭 HTTP Server；
2. 停止每日 UTC 23:30 调度器，确保没有进行中的原子任务被截断；
3. 执行 `PRAGMA wal_checkpoint(TRUNCATE)`，将所有内存 WAL 写入持久化磁盘；
4. 退出进程，确保数据零丢失。

```bash
# 优雅停止
sudo systemctl stop simcompanies

# 优雅重启
sudo systemctl restart simcompanies
```

---

## 5. 升级与回滚流程

### 5.1 生产升级步骤
1. **备份数据库**：
   ```bash
   node --experimental-strip-types scripts/dev-tool.ts backup --create
   ```
2. **拉取新代码**：
   ```bash
   git pull origin master
   ```
3. **执行数据库升级与校验**：
   ```bash
   node --experimental-strip-types scripts/dev-tool.ts migrate --up
   ```
4. **重启服务**：
   ```bash
   sudo systemctl restart simcompanies
   ```
5. **验证就绪探针**：
   ```bash
   curl http://127.0.0.1:3000/health/ready
   ```

### 5.2 灾难回滚步骤
若升级出现异常，可快速回滚：
```bash
# 1. 停止服务
sudo systemctl stop simcompanies

# 2. 恢复上一版本代码
git checkout <PREVIOUS_STABLE_COMMIT>

# 3. 恢复备份数据库
node --experimental-strip-types scripts/dev-tool.ts backup --restore <BACKUP_FILE>

# 4. 重新启动服务
sudo systemctl start simcompanies
```
