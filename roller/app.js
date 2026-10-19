const store = require('./utils/store')

App({
  globalData: {
    // 记账/改账后置为 true，明细页与图表页在 onShow 时据此刷新
    dirty: false,
    // 登录 Promise，页面可以 await 它来确保请求一定带上了身份
    // 解析结果形如 { ok, user?, error? }，不会 reject
    loginReady: null
  },

  onLaunch() {
    // 启动即静默登录：已登录直接复用 token，否则走 wx.login。
    // 失败不阻塞启动，页面会在真正需要时提示并引导到「我的」页重新登录。
    this.globalData.loginReady = store.ensureLogin()
      .then(function (user) {
        return { ok: true, user: user }
      })
      .catch(function (e) {
        console.warn('[记账] 登录失败：', (e && e.message) || e)
        return { ok: false, error: (e && e.message) || '登录失败' }
      })
  },

  /** 记账成功后的统一入口：通知各页面刷新 */
  markDirty() {
    this.globalData.dirty = true
  }
})
