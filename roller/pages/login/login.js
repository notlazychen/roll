const store = require('../../utils/store')
const util = require('../../utils/util')

Page({
  data: {
    busy: false,
    error: ''
  },

  /**
   * 登录页是「退出登录」和未登录状态的落地页。
   * 这里**不做任何自动登录**：只有用户点按钮才登录，
   * 这样退出后一定能停在这一页看到「微信一键登录」。
   */
  loginWechat() {
    if (this.data.busy) return
    this.setData({ busy: true, error: '' })

    store.ensureLogin(true).then(function () {
      if (!store.isLoggedIn()) {
        this.setData({ busy: false, error: '登录失败，请稍后重试' })
        return
      }
      util.toast('登录成功', 'success')
      wx.reLaunch({ url: '/pages/index/index' })
    }.bind(this)).catch(function (e) {
      this.setData({ busy: false })
      // 陌生微信：去绑定页（或创建新账号），票据已由 api 暂存
      if (e && e.needLink) {
        wx.navigateTo({ url: '/pages/account-link/account-link' })
        return
      }
      this.setData({ error: (e && e.message) || '登录失败，请稍后重试' })
    }.bind(this))
  },

  goEmailLogin() {
    wx.navigateTo({ url: '/pages/account-link/account-link' })
  }
})
