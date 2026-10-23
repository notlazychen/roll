# 记账本（ledger）

一个微信小程序 + 自建 ASP.NET Core 服务：记录每天的收支，看周/月/年报表。

界面与 Web 端同构：顶部是「☰ + 记账 + 哈姆斯特」条，点 ☰ 从左侧滑出抽屉，里面切换 **明细**、**图表**、**选项源**，底部是账号卡片。记账入口在明细页右上角与右下角悬浮按钮，改账/删账点列表里的任意一条。

---

## 一、功能清单

| 模块 | 能力 |
|---|---|
| 登录 | 微信一键登录（`wx.login` → 服务端 `code2session` → 签发 JWT）。未登录只能用「我的」页的登录按钮，其余页面不给操作 |
| 记账 | 收入 / 支出、金额、分类、渠道、交易时间、消费者、账户、备注、标签 |
| 明细 | 按天分组、当天收支汇总、月份切换、关键词搜索、类型筛选、游标分页、下拉刷新 |
| 图表 | 周 / 月 / 年切换 + 前后翻页；收支总额；分类饼图（支出/收入可切）；每日收支折线图；渠道排行 |
| 选项源 | 分类、渠道、消费者、账户、标签都支持新增/改名/删除；**已被账目用过的不能删** |
| 标签 | 备注关键词命中规则自动打标签（如「聚餐｜请客」→ 聚餐），也可手动补；规则可维护、可整体关闭 |
| 我的 | 微信头像/昵称、修改昵称、标签自动识别开关、各类选项管理入口、退出登录 |

### 账目的字段

```
type         expense | income
amount       金额（后端存「分」整数，前端展示「元」）
category     分类（餐饮/住宿/出行/购物/...）
channel      渠道，形如「餐饮/肯德基」「购物/淘宝」
consumer     消费者（本人/家人/朋友/...）
account      所属账户（支付宝/微信/现金/银行卡）
tradeAt      交易时间（这笔钱实际发生的时间）
createdAt    记录时间（录入系统的时间，服务端生成）
remark       备注
tags         标签（自动识别 + 手动补充，JSON 数组）
```

---

## 二、目录

```
roller/                     微信小程序（原生）
  app.json                  自定义导航（无 tabBar）：页面 = 明细 / 图表 / 我的 / 记一笔 / 选项源
  app.wxss                  设计系统：与 Web 端 tokens.css 同一套颜色、圆角、阴影、字号
  components/app-frame/     站点骨架：顶部条 + 左侧抽屉导航 + 用户卡
  utils/config.js           环境与后端地址
  utils/api.js              网络层：token、401 自动重登、错误归一
  utils/store.js            数据层：服务端结构 → 页面直接可渲染的形状
  utils/util.js             金额换算、日期分组、图标映射
  pages/index/              明细
  pages/charts/             图表
  pages/me/                 我的
  pages/entry/              记一笔 / 账目详情（新增与编辑共用一个页面）
  pages/options/            选项源管理 + 标签规则
  tests/ledger-contract.cjs 前后端契约测试

roller-server/              ASP.NET Core 10 + EF Core + PostgreSQL
  RandomGroup.Api/Data/         实体与 DbContext
  RandomGroup.Api/Domain/       常量、预置选项
  RandomGroup.Api/Features/     接口：认证、账目、选项源、报表
  RandomGroup.Api/Services/     选项源初始化、标签分析
  RandomGroup.Api/Migrations/   LedgerSchema 迁移
  deploy/                       Docker / nginx / 发布脚本
```

---

## 三、本地跑起来

### 1. 后端

```bash
cd roller-server
cp appsettings.Development.example.json RandomGroup.Api/appsettings.Development.json
# 改其中的 ConnectionStrings:Roll 指向本机 PostgreSQL，Jwt:Key 随便填 32 位以上

dotnet run --project RandomGroup.Api
```

`Database:AutoMigrate = true` 时启动会自动建表（`ledger_users` / `ledger_options` / `ledger_entries` / `ledger_tag_rules`）。
访问 `http://localhost:5235/swagger` 可以直接调接口。

新用户第一次请求 `/api/options` 时会自动写入预置选项（分类 13 项、渠道若干、消费者、账户、7 个标签 + 对应规则）。

### 2. 小程序

微信开发者工具打开 `roller/` 目录，`utils/config.js`：

```js
const ENV = 'dev'   // dev 用 http://localhost:5235，prod 用 https://roll.acgun.cn
```

并在「详情 → 本地设置」勾选 **不校验合法域名**。

开发模式下（服务端 `Development` + `Auth:AllowDevLogin = true`）微信登录失败会自动退化为本机账号登录，不用配 AppSecret 也能联调。

### 3. 契约测试

后端跑起来之后：

```bash
# config.js 保持 ENV='prod' 也能测，用环境变量指到本地后端
LEDGER_BASE_URL=http://localhost:5235 LEDGER_ALLOW_DEV_LOGIN=1 node roller/tests/ledger-contract.cjs
```

它在 Node 里模拟 `wx` 环境，直接跑 `utils/store.js` 的真实代码，验证：
金额换算（元↔分）、自动标签识别、分页不重复、筛选生效、报表每日补零、选项源增删限制、未登录拦截等 78 项。

两个环境变量只在测试时生效，`utils/config.js` 默认值不受影响（`LEDGER_BASE_URL` 覆盖服务地址，`LEDGER_ALLOW_DEV_LOGIN=1` 打开开发登录）。

---

## 四、几个设计决定

**金额用「分」存整数。** 浮点数算钱会出 `0.1 + 0.2 = 0.30000000000000004`，金额一律在后端用 `long` 存分，前端 `util.toCents/yuan/money` 负责换算与展示。

**选项源是一张表。** 分类/渠道/消费者/账户/标签用 `kind` 区分，渠道用 `Name = "父/子"` + `Parent` 记录层级。好处是不用递归 CTE 就能查出「某分类下的渠道」，唯一索引 `(user_id, kind, name)` 也能直接挡住重名。

**能删不能滥删。** 删除前先查使用次数，用过的直接拒绝并告诉用户「已被 N 条账目使用」。分类下还有渠道时也不许删，避免渠道挂在空分类下。

**改名会追溯。** 分类/渠道/消费者/账户/标签改名时，已记录的账目会同步改名，标签规则也一起改 —— 否则旧名称会变成孤儿数据。

**「天」以用户所在时区切分。** 时间戳只是绝对时刻，不带时区，服务端无从知道用户眼里的「10 月 1 日」从哪一刻开始。所以报表接口额外收一个 `tz`（分钟偏移，东八区 480），前端用 `util.tzOffset()` 自动带上，按天分组和日期文案都按这个时区算。不传则退回服务器本地时区。

**标签识别在服务端。** 规则存库、多端一致，也方便以后换成更强的语义分析。前端边输备注边调 `/api/entries/tags/preview`（节流 500ms）显示会命中哪些标签，保存时一同提交。

**图表不引第三方库。** 饼图用 `conic-gradient`（任意机型都清晰、不占包体），折线图用 Canvas 2D（`type="2d"` + DPR 缩放，不模糊）。主包现在只有几十 KB。

---

## 五、接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/wechat` | 微信登录，body: `{code, nickName?, avatarUrl?}` |
| POST | `/api/auth/dev` | 开发模式登录（仅 Development + 开关打开） |
| GET | `/api/me` | 当前用户 + 记账概览（总笔数、首笔时间） |
| PUT | `/api/me` | 改昵称 / 头像 / 标签自动识别开关 |
| GET | `/api/entries` | 明细，支持 `type/category/from/to/keyword/cursor/limit` |
| GET | `/api/entries/{id}` | 单条详情 |
| POST | `/api/entries` | 新增 |
| PUT | `/api/entries/{id}` | 修改 |
| DELETE | `/api/entries/{id}` | 删除 |
| POST | `/api/entries/tags/preview` | 备注标签预分析（不落库） |
| GET | `/api/stats/overview` | 今日/本月收支 |
| GET | `/api/reports` | 区间汇总 + 分类占比 + 每日收支（`from` 闭、`to` 开） |
| GET | `/api/reports/channels` | 支出渠道排行 |
| GET | `/api/options` | 全部选项源（首次访问写入预置项） |
| GET | `/api/options/usage` | 各选项使用次数 |
| POST | `/api/options` | 新增 `{kind, name, parent?}` |
| PUT | `/api/options/{id}` | 改名 |
| DELETE | `/api/options/{id}` | 删除（被使用过会拒绝） |
| POST | `/api/options/{id}/move` | 上移/下移排序 |
| GET/POST | `/api/tag-rules` | 标签规则列表 / 新增 |
| DELETE | `/api/tag-rules/{id}` | 删除规则 |

所有时间字段都是**毫秒时间戳**，所有金额字段都是**分**。

---

## 六、上线前检查

- [ ] `appsettings.json` 的 `Jwt:Key` 用环境变量 `Jwt__Key` 覆盖（≥32 位随机串）
- [ ] `WeChat:AppId` / `WeChat:AppSecret` 配好，`Auth:AllowDevLogin = false`
- [ ] 小程序后台「服务器域名」加入后端 HTTPS 域名（需备案、TLS 1.2+）
- [ ] `utils/config.js` 的 `ENV` 改成 `prod`
- [ ] 类目：纯工具类记账不涉及资质；若后续加「记账/金融服务」字样，需按微信最新规则核对类目要求
- [ ] 隐私：读取微信头像昵称走 `chooseAvatar` + `type="nickname"`，无需额外弹窗；若以后加手机号等接口，需先配置《用户隐私保护指引》
