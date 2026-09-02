# SQLite 备份与灾难恢复操作手册 (Issue #148)

本手册定义 SimCompanies 私服（`phantom-backend-7x`）的数据库在线热备、校验、保留周期轮转及灾难恢复操作流程。

---

## 1. 备份机制原理

本项目使用原生 SQLite `VACUUM INTO` 机制实现 **非阻塞在线热备 (Online Hot Backup)**：
1. **一致性快照**：在服务器正常处理交易与玩家请求的同时，生成与当前时刻严格一致的 SQLite 快照文件；
2. **校验与防篡改**：自动生成 SHA-256 哈希校验文件（`<filename>.sha256`）；
3. **备份完整性检查**：备份完成后自动执行 `PRAGMA quick_check`，确保生成的快照文件无损坏；
4. **自动保留策略**：支持保留最近 N 份备份（默认 14 份），自动删除超期文件。

---

## 2. 常用操作命令

### 2.1 创建即时备份
```bash
node --experimental-strip-types scripts/dev-tool.ts backup --create
```

### 2.2 查看备份列表
```bash
node --experimental-strip-types scripts/dev-tool.ts backup --list
```

### 2.3 校验备份文件与 SHA-256 完整性
```bash
node --experimental-strip-types scripts/dev-tool.ts backup --verify data/backups/backup_2026-09-02T09-00-00-000Z.db
```

---

## 3. 定期自动备份配置 (Cron 策略)

建议在生产服务器配置 crontab，每天凌晨 02:00 自动执行一次热备：

```cron
# 每日凌晨 02:00 自动执行 SimCompanies 数据库备份
0 2 * * * cd /home/ubuntu/phantom-backend-7x && /opt/magnate/.node22/bin/node --experimental-strip-types scripts/dev-tool.ts backup --create >> /home/ubuntu/phantom-backend-7x/data/backups/cron.log 2>&1
```

---

## 4. 灾难恢复标准作业程序 (SOP)

当发生硬件故障、误操作或数据损坏需要恢复数据时，请严格按以下步骤操作：

```bash
# 1. 停止当前运行服务（防止写入冲突）
sudo systemctl stop simcompanies

# 2. 验证拟恢复备份文件的完整性与 SHA-256
node --experimental-strip-types scripts/dev-tool.ts backup --verify data/backups/backup_TARGET.db

# 3. 归档当前损坏的数据库文件
mv data/db.sqlite data/db.sqlite.corrupt.$(date +%s)
mv data/db.sqlite-wal data/db.sqlite-wal.corrupt.$(date +%s) 2>/dev/null || true
mv data/db.sqlite-shm data/db.sqlite-shm.corrupt.$(date +%s) 2>/dev/null || true

# 4. 将备份数据库复制到运行目录
cp data/backups/backup_TARGET.db data/db.sqlite

# 5. 执行一次数据库完整性与迁移检查
node --experimental-strip-types scripts/dev-tool.ts migrate --status

# 6. 重新启动服务
sudo systemctl start simcompanies

# 7. 检查服务就绪探针
curl http://127.0.0.1:3000/health/ready
```
