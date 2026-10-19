# 随机小队

一个微信小程序：小队内先凑备选项、各自投票，再走「准备确认 → 加权随机轮盘」抽出结果。

投票数就是权重 —— 投得多的备选项更容易被抽中，但票少的一样有机会。全队都没投票时自动退化为等权，
不会出现「没人投票就抽不出来」的死局。

整体是一套日式王道 RPG 的皮：大厅叫**冒险者大厅**，建队的人叫**队长**，每支队伍用 6 位**小队号**加进来。

---

## 一、这是什么

| 阶段 | 页面在做什么 |
|---|---|
| `config` | 加备选项、投票。加的时候会**自动给自己投一票**，保证新项立刻有权重、能参与抽取 |
| `preparing` | 队长开启随机（可选限时）。队员点「准备好了」，也可以撤销；队长可中断 |
| `rolling` | 转盘开始转 |
| `result` | 转盘停在抽中的备选项上，同时给全队推一条站内通知 |

推进规则（`roll_next_stage`）：**全员确认**或**倒计时到点**任一满足就进入随机环节。
一轮只出一个结果 —— 靠 `UPDATE ... AND result_option_id IS NULL` 保证，多人同时轮询也不会重复抽。

---

## 二、两套数据源（当前跑在自建服务上）

`utils/config.js` 里一行开关决定数据存哪里：

```js
const DATA_SOURCE = 'server'   // 'cloud' 云服务（已弃用） ｜ 'server' 自建 ASP.NET Core
```

`utils/store.js` 只是个分派门面，按开关 `require` 下面二者之一，**页面代码完全不用感知**：

| 文件 | 对应后端 | 说明 |
|---|---|---|
| `utils/store-http.js` | 自建 ASP.NET Core | **当前使用**。服务器、域名、证书、微信 AppSecret 全部自己可控 |
| `utils/store-cloud.js` | 微信云服务 | **已弃用**。见下方「为什么放弃云服务」 |

两边的方法名、参数、返回结构完全一致（读取类失败给兜底值、写入类返回 `{ ok, error? }`），
所以随时可以切回去。两者的差异只有一处：云版的 `uid` 是字符串（`auth.uid()`），自建版是自增数字。

```
小程序（本目录）
  ├─ pages/          四个页面：冒险者大厅 / 小队 / 消息 / 我的
  ├─ utils/
  │   ├─ config.js        数据源开关 + 云服务 publicConfig
  │   ├─ store.js         分派门面
  │   ├─ store-cloud.js   云服务实现
  │   ├─ store-http.js    自建服务实现
  │   ├─ cloud.js         云 SDK 单例
  │   └─ util.js          通用小工具
  ├─ miniprogram_npm/      预构建的云 SDK（开箱即用，无需点「构建 npm」）
  └─ tests/               数据层契约测试（已在 packOptions.ignore 中排除）

自建后端（../roller-server，与小程序目录平级）
  ├─ RandomGroup.Api/         ASP.NET Core 主项目
  ├─ sql/cloud-database.sql   云服务数据库结构归档
  ├─ deploy/                  Docker / nginx / systemd / 发布脚本
  └─ tests/e2e-api.js         后端接口端到端测试
```

> **为什么后端不在小程序目录里**：小程序预览会把项目目录**整体打包**，而 .NET 的构建产物里
> `Microsoft.CodeAnalysis.CSharp.dll` 单个就有 6.5MB，直接撞上「单文件超过 2MB」的编译失败。
> `packOptions.ignore` 在预览打包这一步**并不足以**排除它 —— 实测把它写进忽略列表后预览仍然失败。
> 所以后端被移到了小程序目录之外：这样无论怎么 `dotnet build`，都不会再撑大预览包。

---

## 三、为什么放弃云服务

云服务本身是好的 —— 数据库、21 个函数、行级安全、邮箱验证码登录全部实测通过，
切换开关一行就能用。放弃的原因是**微信一键登录走不通**：

登录链路是「小程序拿 code → 云服务用 AppSecret 副本向微信换 openid」。
云服务手里那份 AppSecret 是**绑定扫码时自动抄走的副本**，与微信侧不同步。
这份副本失效后（报错 `invalid_client: the client credential is invalid or revoked`）：

- 无法重新绑定 —— 绑定成功后平台 UI 不再显示「绑定已有小程序」入口
- 无法手动填密钥 —— 平台规范明令 `never ask the user for a WeChat AppID/AppSecret`
- 平台管理页只有「开关级」能力，没有「凭证级」能力

即：**凭证失效后没有自助修复路径**，只能依赖平台侧人工处理。

这条路走不通，而微信登录是登录方式里体验最好的一种，所以切回自建服务 ——
AppSecret 自己配、自己轮换，完全可控。

> 云服务环境本身没有删除（平台托管，需自行处理），代码侧的 `store-cloud.js`、
> `utils/cloud.js` 等都原样保留，开关改回 `'cloud'` 即可恢复使用。

---

## 附录：云服务方案存档（已弃用）

保留这部分是为了以后想切回去时不用重新设计。

### 数据放在哪

微信云服务环境（应用「随机小队」，`appType: miniprogram`），5 张表 + 21 个函数。
完整结构与注释见 **`../roller-server/sql/cloud-database.sql`**，那份文件是已部署结构的可读归档。

| 表 | 说明 |
|---|---|
| `roll_groups` | 小队：主题、6 位小队号、可选 5 位口令、阶段、本轮结果、轮次 |
| `roll_members` | 成员：队长建队时自动入队；`(group_id, owner_id)` 唯一 |
| `roll_options` | 备选项：`(group_id, title)` 唯一，同队不重名 |
| `roll_votes` | 投票：`(option_id, owner_id)` 唯一，一人一票 |
| `roll_notifications` | 站内通知：结果 / 准备 / 中断 / 新成员 / 解散 |

### 安全是怎么做的

**客户端对 5 张表只有 SELECT 权限**，一条 INSERT / UPDATE / DELETE 策略都没有。
所有写操作必须走 `SECURITY DEFINER` 函数，函数内部逐条校验登录态、成员资格、队长身份、当前阶段、人数上限。

查询侧也收得很紧：`roll_groups` 只让队内成员读到，大厅能看见别的小队是因为走了 `roll_hall` 函数；
小队口令只下发给队内成员，非成员拿到的是 `null`。

成员制策略里不能内联子查询查 `roll_members`（策略求值会再触发自身策略，无限递归），
所以拆出了两个 `SECURITY DEFINER` 辅助函数 `roll_is_member` / `roll_is_captain`。

### 关键实现点

- **`auth.uid()` 返回 `text`**（不是 uuid），所有 `owner_id` 列都是 `TEXT NOT NULL DEFAULT auth.uid()`
- **表 GRANT 与行策略是两道独立的门**，缺一道会报形似「策略失效」的 `42501`
- **业务函数要显式 `REVOKE EXECUTE ... FROM anon`**，平台建函数时默认连 anon 一起授予
- **`roll_sync` 是核心枢纽**：一次调用完成「推进阶段 + 加权抽取 + 广播通知 + 重置准备状态 + 返回快照」，
  所以小队页每秒轮询只需要 1 个请求
- 转盘用 `<canvas type="2d">`，原生组件层级在普通元素之上，所以**每次打开底部弹层都要先卸载 canvas**，
  关闭后重绘（`.wheel-box` 留了 `min-height` 防跳动）

---

## 四、本地怎么跑起来

### 小程序端

1. 微信开发者工具打开项目根目录
2. 直接编译即可
3. 登录：开发阶段用 `ENV = 'dev'`，后端提供 `/api/auth/dev` 开发登录，同一台设备能造出多个身份，方便本机验证多人流程

### 测试

```bash
# 登录态 / 退出登录 / 头像上传（37 项，纯离线，不需要后端）
node tests/auth-flow.cjs

# 自建服务数据层契约测试（70 项，需要后端在跑）
node tests/miniprogram-contract.cjs

# 自建后端接口端到端测试（96 项，需要后端在跑）
node tests/e2e-api.js

# 云服务数据层契约测试（85 项，不依赖后端；云方案已弃用，仅存档）
node tests/cloud-contract.cjs
```

### 起后端

```bash
cd ../roller-server && dotnet run --project RandomGroup.Api
```

PostgreSQL 连接串、微信 AppId/Secret、JWT 密钥见
`../roller-server/RandomGroup.Api/appsettings.Development.example.json`。

发布上线前注意微信的硬性要求：HTTPS + 受信任 CA 证书、域名已 ICP 备案、
在小程序后台配置 request 合法域名（细节见 `config.js` 注释里的四条）。

头像用的是网络图片，`<image src>` 走的是**另一份配置**：还需要把同一个域名加进
后台的 **downloadFile 合法域名**，否则头像会显示空白（开发时勾选「不校验合法域名」可跳过）。

---

## 五、已知边界

- 小队最多 20 人
- 主题最多 10 字，备选项最多 20 字，昵称最多 16 字，口令固定 5 位数字
- 微信不再随登录下发头像昵称，只能由用户在「我的」页用官方「头像昵称填写能力」确认一次
  （头像会压缩后上传服务端存库，昵称同步到已加入小队里的显示名）
- 「退出登录」会留下一个本机标记，之后不再自动登录，必须由用户再点一次「微信一键登录」
  （微信登录本身是静默的，没有这个标记就会立刻被登回来，看起来像退出没生效）
- 只有配置阶段能加 / 删备选项和投票；进入准备后就锁定了
- 自建服务模式下，小程序需要能访问到后端地址；开发用 `localhost` 需在开发者工具勾选「不校验合法域名」
