# 生产安全基线与加固规范 (Issue #149)

本规范定义 SimCompanies 私服（`phantom-backend-7x`）在面向公网部署与生产运营时的安全基线与防御要求。

---

## 1. 核心安全防御矩阵

| 防御领域 | 生产基线规则 | 机制实现 |
| :--- | :--- | :--- |
| **调试接口防护** | 默认在生产环境彻底禁用所有 `/api/v2/debug/*` | 生产模式返回 403 Forbidden；显式开启时必须携带合法 `X-Admin-Password` 鉴权头 |
| **Cookie 安全** | 开启 `HttpOnly; SameSite=Lax; Secure` | 抵御 XSS 窃取会话 Token 与 CSRF 跨站伪造请求 |
| **敏感信息脱敏** | 日志与报错信息中严禁明文打印密码、Token 与支付信息 | 接入 `Logger` 敏感词自动过滤器（`[REDACTED]`） |
| **错误信息防泄漏**| 严禁向客户端抛出 SQL 语法细节与服务内部调用栈 | 捕获未知异常并以 `X-Request-Id` 关联服务端日志 |
| **环境基线强制校验**| 启动阶段必须验证强密码与端口合法性 | `validateEnvironment()` 启动前置拦截 |

---

## 2. 调试接口安全策略 (`/api/v2/debug/*`)

在开发和测试环境中，调试接口允许自由模拟时钟（Time Warp）、应用测试场景（Fixtures）及切换市场定价。
但在生产环境中：
1. **默认状态**：未设置 `ENABLE_DEBUG_ENDPOINTS=true` 时，任何调试请求均直接被拦截，返回 `403 Forbidden`。
2. **紧急运维授权**：仅当显式设置 `ENABLE_DEBUG_ENDPOINTS=true` 且请求附带正确的 `X-Admin-Password: <ADMIN_PASSWORD>` 或 `Authorization: Bearer <ADMIN_PASSWORD>` 时，方可执行调试操作。

---

## 3. 会话与鉴权加固

1. **Session Token 复杂度**：格式必须符合 `sess_[0-9a-f]{24,64}`，采用高强度密码学随机熵生成；
2. **密码存储**：使用 `scrypt` 密码哈希算法，禁止明文或弱哈希（如纯 MD5/SHA1）；
3. **过期清理**：服务启动及每小时自动从数据库清理超期会话（TTL 为 30 天）。

---

## 4. HTTPS 与反向代理配置示例 (Nginx)

生产环境务必在前端配置 Nginx 反向代理并启用 HTTPS：

```nginx
server {
    listen 443 ssl http2;
    server_name sim.example.com;

    ssl_certificate /etc/letsencrypt/live/sim.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sim.example.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```
