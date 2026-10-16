/**
 * 云服务客户端
 * ---------------------------------------------------------------
 * 只在这里初始化一次，Auth / Database / Storage / LLM 共用同一个实例。
 * 不要在别处再 new 一个客户端，也不要自己用 wx.request 去请求 /.cloud/**，
 * 那会绕过 publishableKey 注入与登录态管理。
 *
 * endpoint 与 publishableKey 都来自 utils/config.js 的 cloud 配置
 * （即开通云服务时返回的 publicConfig），不要改成自己的域名。
 */

const { createMiniProgramWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram')
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics')
const config = require('./config')

const cloud = createMiniProgramWorkBuddyCloud({
  endpoint: config.cloud.endpoint,
  publishableKey: config.cloud.publishableKey,
  // 包一层 wx 适配器：请求失败时会在手机日志里输出方法、URL、状态码与错误码，
  // 便于排查「数据没保存 / 登录失败」这类问题。成功时保持静默。
  wx: createDiagnosticWx(wx)
})

module.exports = { cloud }
