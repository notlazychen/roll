const store = require('./utils/store')

App({
  globalData: {
    refreshFlag: false,
    // 登录 Promise，页面可以 await 它来确保请求一定带上了身份
    // 解析结果形如 { ok, user?, error? }，不会 reject，页面据此提示即可
    loginReady: null
  },

  onLaunch() {
    // 启动即静默登录：先复用云端已有会话，没有则走微信一键登录。
    // 失败不阻塞启动（例如应用还没开启微信登录、或开发者工具拿不到真实凭证），
    // 页面会在真正需要时提示，并引导到「我的」页用邮箱验证码登录。
    this.globalData.loginReady = store.ensureLogin()
      .then(function (user) {
        return { ok: true, user: user }
      })
      .catch(function (e) {
        console.warn('[随机小队] 登录失败：', (e && e.message) || e)
        return { ok: false, error: (e && e.message) || '登录失败' }
      })
  },

  onShow() {},

  onHide() {}
})
