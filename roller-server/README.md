# 随机小队 · 服务端

「随机小队」小程序的独立后端：**ASP.NET Core 10 + PostgreSQL**。
部署在你自己维护的服务器上，小程序通过 `baseUrl` 指向它。

> **这条是备用通路。**
> 小程序目前跑在微信云服务上（`utils/config.js` 里 `DATA_SOURCE = 'cloud'`），
> 云服务那套的数据结构与业务函数归档在 `server/sql/cloud-database.sql`。
> 两套数据层的方法名与返回结构完全一致，切回去只要改一个开关 —— 见根目录 `README.md` 第二节。
> 下面讲的全部是自建这条路。

---

## 一、目录结构

```
server/
├─ RandomGroup.Api/                 主项目
│  ├─ Domain/                      阶段机常量、加权随机算法（纯函数，便于单测）
│  ├─ Data/                        EF Core 实体、DbContext、设计时工厂
│  ├─ Features/                    按业务分组的接口：认证 / 小队 / 备选项 / 随机 / 通知
│  ├─ Services/                    阶段引擎、权重计算、通知、小队权限
│  ├─ Infrastructure/              JWT、统一异常响应、微信 code2session 客户端
│  └─ Migrations/                  EF Core 迁移（第二个迁移含人数上限触发器）
├─ tests/
│  ├─ e2e-api.js                   后端接口端到端测试（96 项）
│  └─ miniprogram-contract.cjs     小程序数据层 ↔ 后端契约测试（70 项）
├─ deploy/
│  ├─ Dockerfile / docker-compose.yml / .env.example
│  ├─ nginx/randomgroup.conf       HTTPS 反向代理
│  ├─ systemd/randomgroup.service  裸机部署
│  └─ publish.sh                   发布 + 同步脚本
└─ README.md
```

数据库共 6 张业务表：

| 表 | 说明 | 关键约束 |
|---|---|---|
| `roll_users` | 用户 | `open_id` 唯一 |
| `roll_groups` | 小队 | `code`（6 位邀请码）唯一；`round` 用于保证一轮只出一条结果 |
| `roll_members` | 小队成员 | `(group_id, user_id)` 唯一；**触发器硬限制每组最多 20 人** |
| `roll_options` | 备选项 | `(group_id, title)` 唯一（同组不允许重名） |
| `roll_votes` | 投票 | `(option_id, user_id)` 唯一（一人一票） |
| `roll_notifications` | 站内通知 | 每人最多保留 100 条 |

---

## 二、本地开发

### 1. 准备 PostgreSQL

用你自己的 PG，或者起一个：

```bash
docker run -d --name roll-db \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=roll \
  -p 5432:5432 postgres:16-alpine
```

### 2. 建表

```bash
cd server
dotnet tool restore                        # 恢复本地 dotnet-ef 工具
export ROLL_CONNECTION="Host=127.0.0.1;Port=5432;Username=postgres;Password=postgres;Database=roll"
dotnet ef database update --project RandomGroup.Api
```

会依次应用两个迁移，包括那个把人数上限钉死在数据库层的触发器。

### 3. 启动

```bash
cd server/RandomGroup.Api
dotnet run
```

| 地址 | 用途 |
|---|---|
| `http://localhost:5000` | 接口 |
| `http://localhost:5000/swagger` | Swagger UI（可点，先取 token 再 Authorize） |
| `http://localhost:5000/health` | 健康检查 |

### 4. 配置

本地配置写在 `appsettings.Development.json`（已加入 `.gitignore`，因为里面有数据库密码）。
可以从 `appsettings.Development.example.json` 复制一份。

| 配置键 | 说明 | 生产环境怎么给 |
|---|---|---|
| `ConnectionStrings:Roll` | PostgreSQL 连接串 | 环境变量 `ConnectionStrings__Roll` |
| `Jwt:Key` | JWT 签名密钥，**至少 32 位** | 环境变量 `Jwt__Key`，用 `openssl rand -base64 48` 生成 |
| `WeChat:AppId` / `WeChat:AppSecret` | 微信小程序凭证 | 环境变量 `WeChat__AppId` / `WeChat__AppSecret` |
| `Auth:AllowDevLogin` | 开发模式登录开关 | 生产必须 `false` |
| `Database:AutoMigrate` | 启动时自动执行迁移 | 首次建表 `true`，稳定后 `false` |

> 生产环境不要把这些写进 `appsettings.json`。ASP.NET Core 的环境变量用双下划线表示层级，例如 `ConnectionStrings__Roll`。

---

## 三、接口一览

除标注「匿名」外，全部需要 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| POST | `/api/auth/wechat` | `wx.login` 的 code 换 token（服务端调 code2session） | 匿名 |
| POST | `/api/auth/dev` | 开发模式登录 | 匿名（仅 Development） |
| GET | `/api/me` | 当前用户 | 登录 |
| PUT | `/api/me` | 改昵称，同步组内显示名与队长名 | 登录 |
| POST | `/api/me/avatar` | 上传头像 `{imageBase64, contentType}`，存库并自增版本号 | 登录 |
| GET | `/api/users/{id}/avatar?v=N` | 读取头像（`<image src>` 不会带 token，所以匿名） | 匿名 |
| GET | `/api/me/stats` | 我加入/创建的小队数 | 登录 |
| GET | `/api/groups?keyword=` | 大厅列表，按主题模糊或 6 位邀请码精确匹配 | 登录 |
| POST | `/api/groups` | 创建小队（创建者自动成为队长并入组） | 登录 |
| GET | `/api/groups/{id}` | **小队页轮询用**：一次返回小队+成员+备选项+权重+我的身份 | 登录 |
| GET | `/api/groups/{id}/state` | 极简状态（阶段/人数/已确认数） | 登录 |
| GET | `/api/groups/{id}/members` | 成员列表 | 登录 |
| GET | `/api/groups/{id}/options` | 备选项列表 | 登录 |
| GET | `/api/groups/{id}/weights` | 权重与百分比 | 登录 |
| PATCH | `/api/groups/{id}` | 改主题 / 口令（只改请求体里出现的字段） | 队长 |
| POST | `/api/groups/{id}/join` | 加入（校验口令与 20 人上限） | 登录 |
| POST | `/api/groups/{id}/leave` | 退出 | 成员 |
| DELETE | `/api/groups/{id}` | 解散小队 | 队长 |
| POST | `/api/groups/{id}/options` | 添加备选项（同时自动投创建者一票） | 成员 + config |
| DELETE | `/api/options/{id}` | 删除备选项（连带清票） | 创建者 + config |
| POST | `/api/options/{id}/vote` | 投票 / 撤票 | 成员 + config |
| POST | `/api/groups/{id}/prepare` | 开启准备环节，`{deadlineSeconds}` | 队长 + config |
| POST | `/api/groups/{id}/ready` | `{action:"confirm"\|"cancel"}` | 成员 + preparing |
| POST | `/api/groups/{id}/roll` | 取本轮结果，**幂等** | 成员 |
| POST | `/api/groups/{id}/reset` | 回到配置环节，开始新一轮 | 队长 |
| GET | `/api/notifications` | 通知列表 + 未读数 | 登录 |
| GET | `/api/notifications/unread` | 仅未读数 | 登录 |
| POST | `/api/notifications/read` | 全部标记已读 | 登录 |
| DELETE | `/api/notifications` | 清空通知 | 登录 |

响应约定（与小程序原 `utils/store.js` 一致，所以页面几乎不用改）：

- 成功：HTTP 200，业务对象（如 `{ ok:true, group:{...} }`）
- 业务失败：HTTP 400/403/404，`{ ok:false, error:"中文提示", ...附加字段 }`
- 未登录/令牌过期：HTTP 401，`{ ok:false, error:"登录状态已失效，请重新登录" }`

所有时间字段都是**毫秒时间戳数字**，前端可直接做减法算倒计时。

---

## 四、鉴权与微信登录

```
小程序 wx.login() → code
        │
        ▼
POST /api/auth/wechat { code }
        │
        ▼
服务端带着 AppId + AppSecret 调 api.weixin.qq.com/sns/jscode2session
        │
        ▼
拿到 openid → 落库/更新用户 → 签发自己的 JWT 返回
```

两个关键约束：

1. **`api.weixin.qq.com` 不允许被配置成小程序的服务器域名**，所以这个调用只能在服务端做。
2. **`AppSecret` 绝对不能放进小程序代码**，只能放在服务端的环境变量里。

小程序端的 `utils/api.js` 在收到 401 时会自动重新走一遍登录并重试一次，用户无感。

### 头像与昵称从哪来

微信早已不再随登录下发头像和昵称（`wx.getUserProfile` 已回收），官方做法是
**「头像昵称填写能力」**：小程序里用 `<button open-type="chooseAvatar">` 取头像、
`<input type="nickname">` 取昵称，用户各确认一次。所以：

```
用户选头像 → 本地临时文件 → wx.compressImage 压到 240px → base64
        → POST /api/me/avatar → 存 roll_users.avatar_data(bytea) → 返回 /api/users/{id}/avatar?v=N
昵称框带出微信昵称 → PUT /api/me { nickName }
```

两个设计取舍：

1. **头像存库不落盘**：单机 Docker 部署里容器重建会丢掉容器内文件，而 bind mount 又要改服务器上的
   compose 才生效；头像压完只有几十 KB，放 `bytea` 最省事也最不容易丢。
2. **接口只下发相对路径**：`/api/users/{id}/avatar?v=N`，客户端自己拼服务地址
   （`utils/config.js` 的 `baseUrl`），所以反代域名、端口、本地调试地址都不用让服务端知道。
   `v` 是自增版本号，换头像后地址就变了，客户端和微信的图片缓存会自动失效。

> 小程序侧注意：`<image>` 加载网络图需要把服务域名加进后台的 **downloadFile 合法域名**
> （和 request 合法域名是两份配置）。开发时勾选「不校验合法域名」即可跳过。

### 开发模式登录

不接微信也能跑通完整多人流程：`POST /api/auth/dev` 用客户端生成的稳定 `deviceKey` 造测试账号。
它有三重限制：配置项 `Auth:AllowDevLogin` 为 true、当前必须是 `Development` 环境、小程序侧 `config.allowDevLogin` 为 true。
**生产环境务必保持关闭。**

---

## 五、阶段流转与并发安全

```
config ──小队长点 Roll──► preparing ──全员确认 / 到最晚结束时间──► rolling ──► result
  ▲                            │
  └────────任一成员取消─────────┘
```

阶段全部由服务端裁决，客户端只负责发起动作和轮询：

- 读取小队时服务端会自动推进阶段（超时或全员确认 → 直接产出结果），所以客户端不需要也不允许自己改阶段。
- **一轮只会产生一个结果**：进入 `rolling` 时用 `UPDATE ... SET round = round + 1 WHERE stage = 'preparing'` 原子推进，写结果时再以 `stage = 'rolling' AND round = 当前轮次` 为条件。并发请求中只有一个能改成功，其余直接返回已有结果。
- 准备环节任何成员取消 → 立即中断回 `config`，并给小队长写一条通知。
- 备选项无权重时（全员零票）退化为等权，保证一定抽得出结果。

---

## 六、部署到你自己的服务器

### 方式 A：Docker Compose（推荐）

```bash
cd server/deploy
cp .env.example .env      # 填数据库密码、Jwt__Key、微信 AppId/AppSecret
docker compose up -d --build
```

- 只部署 API、数据库用你现有的：`ConnectionStrings__Roll` 指向那台机器，然后 `docker compose up -d --build api`
- API 只监听 `127.0.0.1:5080`，由 Nginx 负责 HTTPS

### 方式 B：dotnet publish + systemd

```bash
cd server
dotnet publish RandomGroup.Api/RandomGroup.Api.csproj -c Release -o publish

# 上传到服务器
rsync -avz --delete publish/ user@server:/opt/random-group/app/

# 在服务器上
cp deploy/systemd/randomgroup.service /etc/systemd/system/
cp deploy/nginx/randomgroup.conf /etc/nginx/conf.d/
# 按注释创建 /opt/random-group/app.env 并写好环境变量
systemctl daemon-reload && systemctl enable --now randomgroup
nginx -t && systemctl reload nginx
```

也可以用脚本一把梭：

```bash
DEPLOY_HOST=user@your-server ./deploy/publish.sh
```

### HTTPS 证书

```bash
# 证书必须由受信任 CA 签发，自签在正式环境无效
certbot certonly --webroot -w /var/www/certbot -d api.your-domain.com
```

Nginx 里要指向 **fullchain**（完整证书链），只给站点证书会导致小程序校验失败。

---

## 七、微信侧的必做配置（这一步不做，真机一定失败）

| # | 要求 | 说明 |
|---|---|---|
| 1 | **域名 ICP 备案** | 微信明文要求。备案的前提是服务器在境内，所以最省事的路线是境内服务器 + 已备案域名 |
| 2 | **配置服务器域名** | 小程序后台 → 开发管理 → 开发设置 → 服务器域名 → request 合法域名，填入 `https://api.your-domain.com` |
| 3 | **HTTPS + TLS 1.2+** | 证书由受信任 CA 签发，TLS 1.0/1.1 会被拒绝 |
| 4 | **不能用 IP 或 localhost** | 域名格式只支持字母、数字、`-` |
| 5 | **只能配子域名** | 配了 `api.xxx.com` 就不能用 `xxx.com` |
| 6 | **端口规则** | 配 `https://api.xxx.com` 时 URL 里不能带端口（连 `:443` 也不行）；要带端口就配 `https://api.xxx.com:8443`，之后只能请求这个端口 |
| 7 | **不能配 `api.weixin.qq.com`** | 所以 AppSecret 必须留在服务端 |
| 8 | **体验版同样受限** | 真机调试时可以点右上角「开发调试」临时绕过校验，正式版不行 |

开发阶段不想折腾域名：在开发者工具里勾选 **详情 → 本地设置 → 不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书**，就能直接连 `http://localhost:5000`。

---

## 八、小程序侧要改的地方

只有一处：`utils/config.js`

```js
const ENV = 'dev'                       // 本地联调
// 发布时改成
const ENV = 'prod'
```

并把 `ENVS.prod.baseUrl` 换成你的域名，同时在 `project.config.json` 里确认 `appid` 是你自己的小程序。

> 注意：小程序的 `miniprogramRoot` 就是项目根目录，`server/` 目录如果不排除会被一起打包上传。
> 工程里已经在 `project.config.json` 的 `packOptions.ignore` 中排除了 `server`、`.workbuddy`，
> 如果你把服务端挪到别处，记得同步修改这个排除列表。

---

## 九、上线检查清单

- [ ] `Auth__AllowDevLogin=false`（生产环境）
- [ ] `Jwt__Key` 换成随机长串（`openssl rand -base64 48`）
- [ ] `WeChat__AppId` / `WeChat__AppSecret` 已配置，且 AppSecret 没有出现在小程序代码里
- [ ] 数据库连接串走环境变量，没有把密码提交进仓库
- [ ] 首次建表完成后把 `Database__AutoMigrate` 改为 `false`
- [ ] Nginx 证书链完整，`curl -I https://api.你的域名/health` 返回 200
- [ ] 小程序后台已把域名加入 request 合法域名，并等生效（几分钟）
- [ ] 小程序 `utils/config.js` 的 `env` 已改为 `prod`
- [ ] 小程序后台补好《用户隐私保护指引》（涉及昵称、头像）

---

## 十、测试

先启动服务端，然后：

```bash
# 后端接口端到端（直接打真实数据库）
node server/tests/e2e-api.js
# → 通过 96 项

# 小程序数据层与后端的契约（在 Node 里模拟 wx 环境，跑的是小程序真实的 utils/）
node server/tests/miniprogram-contract.cjs
# → 通过 70 项
```

第二个测试很关键：页面里大量使用 `===` 严格比较（`m.uid === me.uid`、`g.ownerId === me.uid`、`o.voters.indexOf(me.uid) >= 0`），
一旦前后端 id 类型不一致（数字 vs 字符串），界面会出现「看起来都对但就是不动」的问题。这个测试专门守住这条线。

---

## 十一、已知取舍（有意为之）

- **没有开启 `EnableRetryOnFailure`**：它会安装 `NpgsqlRetryingExecutionStrategy`，而该策略不支持我们自己发起的事务（加入小队、添加备选项都需要事务）。相比自动重试，这些场景更需要明确的事务语义，避免半提交后重试产生重复数据。
- **大厅列表最多返回 200 条**，按创建时间倒序。真要更多需要加分页。
- **备选项与投票在 `preparing` / `rolling` / `result` 阶段被服务端拒绝**，与「准备环节锁定备选项」的需求一致。
- **口令信息只下发给小队长**，其他成员拿到 `passcode: ""`，只保留 `hasPasscode` 供界面显示锁图标。
- **开发模式登录**只是本地联调便利设施，生产环境请关掉。
