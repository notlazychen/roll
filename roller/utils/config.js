/**
 * 环境配置
 * ---------------------------------------------------------------
 * DATA_SOURCE 决定小程序把数据存在哪里，两套实现方法完全一致
 * （utils/store.js 只做分派），页面代码无需感知。
 *
 *   'cloud'  —— 微信云服务（已弃用）
 *               免服务器、免备案、免域名证书；多人协作走云端账号体系。
 *               数据库结构与函数归档见 ../roller-server/sql/cloud-database.sql。
 *               弃用原因：微信一键登录依赖平台托管的 AppSecret 副本，
 *               该副本失效后平台侧无重新授权入口，无法自助修复。
 *
 *   'server' —— 自建 ASP.NET Core + PostgreSQL 服务（当前使用）
 *               需要自己维护服务器 / 域名 / 证书，接入说明见 ../roller-server/README.md。
 *               微信登录的 AppSecret 由自己配置，完全可控。
 */

const DATA_SOURCE = 'server'

/* ================= 云服务 ================= */

// 开通云服务时返回的 publicConfig。
// endpoint 是小程序的固定网关（所有小程序共用），不要改成自己的域名；
// publishableKey 只标识「是哪个应用」，本身不含权限，服务端会校验来源。
const CLOUD = {
  resourceId: 'wbcs_mrNiWOwpeHq2VkS7cHiNzc',
  endpoint: 'https://mp-api.app.workbuddy.host',
  publishableKey: 'wbpk_p0sx1yZd07GTa43kL2wLYf_WQWWD37MVP69D8Qo6gAeTttoRLPVUyzP'
}

/* ================= 自建服务（备用） ================= */

/*
 * 开发调试：env = 'dev'，在微信开发者工具里勾选
 *   「详情 → 本地设置 → 不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」
 *   即可直接访问 http://localhost:5000，无需域名与证书。
 *
 * 发布上线：env = 'prod' 并替换 prod.baseUrl。注意微信的硬性要求：
 *   1) 必须 HTTPS，证书由受信任 CA 签发，TLS 1.2 以上；
 *   2) 域名必须完成 ICP 备案，且不能用 IP 或 localhost；
 *   3) 需在小程序后台「开发管理 → 开发设置 → 服务器域名」加入 request 合法域名；
 *   4) 只能配子域名，配了端口就只能用该端口。
 */

const ENV = 'dev'

const ENVS = {
  dev: {
    baseUrl: 'http://localhost:5000',
    // 开发模式登录开关：不接微信也能造出多个账号，方便本机验证多人流程。
    // 服务端只有在 Development 环境且 Auth:AllowDevLogin=true 时才会接受。
    allowDevLogin: true
  },
  prod: {
    baseUrl: 'https://api.your-domain.com',
    allowDevLogin: false
  }
}

const current = ENVS[ENV] || ENVS.dev

module.exports = {
  // 数据源：'cloud' | 'server'
  dataSource: DATA_SOURCE,
  isCloud: DATA_SOURCE === 'cloud',

  // 云服务
  cloud: CLOUD,

  // 自建服务
  env: ENV,
  baseUrl: current.baseUrl,
  allowDevLogin: !!current.allowDevLogin,

  // 单次请求超时
  timeout: 15000,
  // 小队页轮询间隔（毫秒）
  pollInterval: 1000
}
