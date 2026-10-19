/**
 * 环境配置
 * ---------------------------------------------------------------
 * 小程序通过 utils/api.js 请求自建 ASP.NET Core 服务。
 *
 * 开发调试：env = 'dev'，在微信开发者工具里勾选
 *   「详情 → 本地设置 → 不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」
 *   即可直接访问 http://localhost:5235（launchSettings 的 http 配置），无需域名与证书。
 *
 * 发布上线：env = 'prod' 并替换 prod.baseUrl。微信的硬性要求：
 *   1) 必须 HTTPS，证书由受信任 CA 签发，TLS 1.2 以上；
 *   2) 域名必须完成 ICP 备案，且不能用 IP 或 localhost；
 *   3) 需在小程序后台「开发管理 → 开发设置 → 服务器域名」加入 request 合法域名；
 *   4) 只能配子域名，配了端口就只能用该端口。
 */

// 发布用 'prod'；本机联调改 'dev'（改完记得切回来，否则线上包会指向 localhost）。
// 跑契约测试时可用环境变量覆盖，免去手改文件：LEDGER_ENV=dev node tests/ledger-contract.cjs
const ENV = 'prod'

const ENVS = {
  dev: {
    baseUrl: 'http://localhost:5235',
    // 开发模式登录：不接微信也能造出账号，方便本机验证记账流程。
    // 服务端只有在 Development 环境且 Auth:AllowDevLogin=true 时才会接受。
    allowDevLogin: true
  },
  prod: {
    // 生产后端：沿用原有 Lighthouse 单机 Docker 部署，nginx 反代到容器 8080。
    baseUrl: 'https://roll.acgun.cn',
    allowDevLogin: false
  }
}

const current = ENVS[ENV] || ENVS.dev

module.exports = {
  env: ENV,
  baseUrl: process.env.LEDGER_BASE_URL || current.baseUrl,
  allowDevLogin: process.env.LEDGER_ALLOW_DEV_LOGIN
    ? process.env.LEDGER_ALLOW_DEV_LOGIN === '1'
    : !!current.allowDevLogin,
  // 单次请求超时
  timeout: 15000
}
