# 记账 · 服务端

「贴身小工具合集」记账小程序的独立后端：**ASP.NET Core 10 + PostgreSQL 18**。
小程序通过 `baseUrl` 指向线上地址 `https://roll.acgun.cn`。

---

## 一、目录结构

```
roller-server/
├─ RandomGroup.Api/                 主项目
│  ├─ Domain/                      选项预置项、类型/长度等常量
│  ├─ Data/                        EF Core 实体、DbContext
│  ├─ Features/                    按业务分组的接口：认证 / 账目 / 选项源 / 报表
│  ├─ Services/                    选项源初始化、标签识别、账号工具
│  ├─ Infrastructure/              JWT、统一异常响应、微信 code2session、密码哈希
│  ├─ Migrations/                  EF Core 迁移
│  ├─ appsettings.json             通用配置（不含密钥）
│  ├─ appsettings.Development.json 本地开发配置（含本机数据库口令，不进镜像）
│  └─ appsettings.Production.json  线上非密钥配置（日志级别、迁移开关）
├─ Dockerfile                      多阶段构建，非 root 运行
├─ .dockerignore                   排除 bin/obj 与开发配置
├─ tests/account-contract.js       账号体系契约测试（39 项）
└─ deploy/
   ├─ docker-compose.lighthouse.yml  Lighthouse 单机部署（线上用这份）
   ├─ docker-compose.yml             本地/通用 compose
   ├─ .env.example                   环境变量模板
   ├─ update.sh                      后端一键更新/回滚
   ├─ update-web.sh                  前端一键更新/回滚（从镜像取静态文件）
   └─ nginx/roll.acgun.cn.conf       HTTPS 反向代理 + 前端静态文件（nginx 容器用）
```

Web 前端在 `../roller-web/`（Vite + React + TypeScript），产物由**同一套发布链路**分发。

数据库共 4 张表：

| 表 | 说明 | 关键约束 |
|---|---|---|
| `ledger_users` | 用户（邮箱账号 / 微信账号，同一 uid） | `email` 唯一（非空时）、`nick_key` 唯一、`open_id` 唯一 |
| `ledger_options` | 选项源（分类/渠道/消费者/账户/标签） | `(user_id, kind, name)` 唯一 |
| `ledger_entries` | 账目 | `(user_id, trade_at)`、`(user_id, category, trade_at)` 索引 |
| `ledger_tag_rules` | 标签识别规则 | 关键词 → 标签 |

---

## 二、配置分层

三份配置各管一段，**密钥只走环境变量**，任何情况下都不进仓库、不进镜像：

| 文件 | 放什么 | 进镜像 |
|---|---|---|
| `appsettings.json` | 两套环境通用的项（JWT 签发者、日志默认级别） | 是 |
| `appsettings.Development.json` | 本机数据库连接串、开发登录开关、开发用 JWT 密钥 | **否**（`.dockerignore` 已排除） |
| `appsettings.Production.json` | 线上日志级别、迁移开关等不含密钥的项 | 是 |

线上真实密钥由 `deploy/.env` 注入，compose 里以 `__` 双下划线映射到配置节：

```
Jwt__Key             →  Jwt:Key
WeChat__AppId        →  WeChat:AppId
WeChat__AppSecret    →  WeChat:AppSecret
ConnectionStrings__Roll → ConnectionStrings:Roll
Database__AutoMigrate   →  Database:AutoMigrate
```

---

## 三、发布流程

**这条链路是唯一的上线路径**，不要再用 rsync / scp / systemd 手动发布。

```
本地提交  →  push 到 GitHub main
              ↓
        GitHub Actions 按改动路径分包构建
          ├─ roller-server/**  →  crazor6/roll       （后端镜像）
          └─ roller-web/**     →  crazor6/roll-web   （前端产物镜像）
              ↓
        推送到 Docker Hub
              ↓
    Lighthouse 服务器 pull + 更新
          ├─ ./update.sh      重建 api 容器
          └─ ./update-web.sh  取静态文件，nginx 自动生效
              ↓
        浏览器 / 小程序访问 https://roll.acgun.cn
```

两个 workflow 用 `paths` 过滤，改后端不会白打一次前端镜像，反之亦然。
只改小程序代码（`roller/**`）两个都不触发。

### 1. 提交代码触发构建

```bash
git add -A
git commit -m "feat: xxx"
git push origin main
```

镜像标签规则（前后端一致）：

| 场景 | 产生的标签 |
|---|---|
| 推送 `main` | `latest`、`sha-abc1234` |
| 打 `v1.2.3` 标签 | `1.2.3` |

> 只有默认分支才会打 `latest`，其他分支产出的镜像只有 `sha-xxxxxxx`，
> 避免半成品提交把线上版本顶掉。

### 2. 必需的仓库密钥

GitHub 仓库 → Settings → Secrets and variables → Actions：

| 名称 | 说明 |
|---|---|
| `DOCKERHUB_USERNAME` | Docker Hub 用户名（`crazor6`） |
| `DOCKERHUB_TOKEN` | Docker Hub **Access Token**，不是登录密码（Account Settings → Security 生成） |

两个 workflow 共用这一组，不用配两遍。

### 3. 服务器更新

构建成功后，在服务器 `/data/docker/roll/` 目录下按需执行：

```bash
./update.sh                # 后端：拉 latest 并滚动重启
./update-web.sh            # 前端：拉 latest 并原子切换静态文件
./update.sh sha-a1b2c3d    # 回滚后端到某个历史版本
./update-web.sh sha-a1b2c3d  # 回滚前端
```

两个脚本都会：拉镜像 → 更新 → 校验 → **失败自动回滚**，并打印当前版本与回滚命令。

`update-web.sh` 的工作原理值得一提：前端不跑容器，`crazor6/roll-web` 只是个
「装了静态文件的壳」。脚本 `docker create` 一个临时容器、`docker cp` 把
`/www` 取到宿主机 `/data/docker/web`，再原子切换目录，最后由已经在跑的
nginx 容器 serve。这样前端也就有了版本化、可回滚的发布介质，
不用再「本地 build 完手动传」。

> 前端发布不需要重启 nginx —— 它读的是宿主机目录，文件换了立刻生效。

### 4. 首次部署

```bash
cd /data/docker/roll
cp .env.example .env      # 填 POSTGRES_PASSWORD、Jwt__Key、WeChat__AppId/AppSecret
./update.sh               # 后端 + 数据库
```

前端多一步一次性挂载（nginx 容器启动时就带上，之后不用再管）：

```bash
# 若 nginx 由 docker run 启动，加上：
#   -v /data/docker/web:/var/www/web:ro
# 若由 compose 管理，在它的 volumes 里加：
#   - /data/docker/web:/var/www/web:ro
```

然后：

```bash
./update-web.sh           # 取前端产物
curl -I https://roll.acgun.cn/          # 200
curl -I https://roll.acgun.cn/login     # 200（SPA 回退生效）
```

首次启动会自动建表（`Database__AutoMigrate=true`），迁移幂等，后续版本也靠它自动升级表结构。

### 5. 数据库不丢失

PostgreSQL 数据通过 bind mount 落在宿主机 `/data/docker/pgsql/`，
重建或升级 api 容器都不会动它。删除数据只会在显式执行
`docker compose down -v` 或手动删该目录时发生 —— 不要执行这两条。

带迁移的版本发布前建议先备份：

```bash
docker exec roll-pgsql pg_dump -U postgres ledger | gzip > /data/backup/ledger-$(date +%F-%H%M).sql.gz
```

---

## 四、HTTPS 与静态文件

`deploy/nginx/roll.acgun.cn.conf` 由**已有的 nginx 容器**加载，
通过外部网络 `web` 反代到 `roll:8080`，同时负责两件事：

```nginx
location /api/ { proxy_pass http://roll:8080; }   # 后端
location /     { try_files $uri /index.html; }    # 前端 SPA
```

**单域名同源**带来的好处：浏览器不发跨域请求、没有预检、Cookie 同站，
小程序照旧请求 `https://roll.acgun.cn/api/...`，完全不受影响。

`try_files` 是 SPA 的关键 —— 直接访问 `/charts` 时磁盘上没有这个文件，
必须回落到 `index.html` 交给前端路由，否则刷新就 404。

几个小程序侧的硬性要求，配置里都已满足：

- 必须 HTTPS，证书由受信任 CA 签发（自签无效）
- TLS 1.2 及以上
- 必须返回完整证书链（`fullchain.pem`），只给站点证书会校验失败
- 不能用 IP 或 localhost，只能是域名

证书续期后重载 nginx：

```bash
docker exec <nginx容器名> nginx -t && docker exec <nginx容器名> nginx -s reload
```

---

## 五、微信侧必做配置（不做真机一定失败）

| # | 要求 | 说明 |
|---|---|---|
| 1 | 域名 ICP 备案 | 微信明文要求，前提是服务器在境内 |
| 2 | 配置服务器域名 | 小程序后台 → 开发管理 → 开发设置 → 服务器域名 → request 合法域名填 `https://roll.acgun.cn` |
| 3 | HTTPS + TLS 1.2+ | TLS 1.0/1.1 会被拒绝 |
| 4 | 不能带端口 | 配 `https://roll.acgun.cn` 时 URL 里不能出现 `:443` |
| 5 | 体验版同样受限 | 真机调试可点右上角「开发调试」临时绕过，正式版不行 |

---

## 六、本地开发

### 1. 准备数据库

```bash
docker run -d --name ledger-db \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ledger_dev \
  -p 5432:5432 postgres:16-alpine
```

### 2. 改 `appsettings.Development.json`

填本机数据库连接串即可，`Database:AutoMigrate` 已是 `true`，启动自动建表。

### 3. 启动

```bash
ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5235 \
  dotnet run --project RandomGroup.Api --no-launch-profile
```

`Development` 环境下 `Auth:AllowDevLogin=true`，微信登录不可用时会退化为本机账号登录，
不配 AppSecret 也能完整联调记账流程。

### 4. 契约测试

```bash
# 账号体系（邮箱注册/登录/改密/昵称规则/微信绑定/数据隔离），39 项
BASE=http://localhost:5235 node roller-server/tests/account-contract.js

# 小程序数据层（在仓库根目录执行，用环境变量把数据层指到本地后端），78 项
LEDGER_BASE_URL=http://localhost:5235 LEDGER_ALLOW_DEV_LOGIN=1 \
  node roller/tests/ledger-contract.cjs
```

后者在 Node 里模拟 `wx` 环境，跑的是小程序真实的 `utils/store.js`，
覆盖金额换算、标签识别、分页、筛选、报表补零、选项增删限制、鉴权拦截等。

### 5. Web 前端

```bash
cd roller-web
npm install
npm run dev        # http://localhost:5173，/api 自动代理到 5235
npm run build      # 产物到 dist/
npm run typecheck  # CI 里也跑这一步
```

前端代码里只写相对路径 `/api/xxx`，没有任何环境判断 ——
本地由 vite 代理，线上由 nginx 反代，两边行为一致。

---

## 七、上线检查清单

- [ ] 仓库已配置 `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN`
- [ ] 后端 Actions 构建成功，`crazor6/roll:latest` 已是新提交的 digest
- [ ] 前端 Actions 构建成功，`crazor6/roll-web:latest` 已更新
- [ ] nginx 容器已挂载 `/data/docker/web:/var/www/web:ro`
- [ ] 服务器 `.env` 里 `Jwt__Key` 是随机长串（`openssl rand -base64 48`）
- [ ] `WeChat__AppId` / `WeChat__AppSecret` 已填，且 AppSecret 没出现在小程序代码里
- [ ] `Auth:AllowDevLogin` 为 `false`（`Production` 配置已固定）
- [ ] `curl -I https://roll.acgun.cn/health` 返回 200
- [ ] `curl -I https://roll.acgun.cn/` 返回 200 且内容是前端页面
- [ ] `curl -I https://roll.acgun.cn/login` 返回 200（SPA 回退）
- [ ] 小程序后台 request 合法域名已加 `https://roll.acgun.cn` 并生效
- [ ] 小程序 `utils/config.js` 的 `ENV` 为 `'prod'`
- [ ] 小程序后台补好《用户隐私保护指引》（涉及昵称、头像）

---

## 八、已知取舍

- **金额用「分」存 `long`**：浮点数算钱会出精度问题，换算只在前端做。
- **选项源单表建模**：`kind` 区分类型，渠道用 `Name="父/子"` + `Parent` 记录层级，
  不用递归 CTE 就能查「某分类下的渠道」。
- **选项删除有保护**：用过的选项拒绝删除并告知使用次数；分类下还有渠道时不许删。
- **报表 `tz` 参数**：时间戳不带时区，接口收调用方的分钟偏移（东八区 480）才能把「天」切准。
- **开发模式登录**只是本地联调便利设施，生产环境固定关闭。
