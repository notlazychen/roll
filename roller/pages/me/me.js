const store = require('../../utils/store')
const util = require('../../utils/util')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Page({
  data: {
    me: null,
    nameInput: '',
    stats: { joinedCount: 0, ownedCount: 0 },
    env: null,
    loading: true,

    loggedIn: false,
    loginError: '',
    busy: false,

    // 邮箱验证码登录（在没有微信授权环境时使用，例如开发者工具）
    email: '',
    emailError: '',
    codeSent: false,
    code: ''
  },

  onShow() {
    this.load()
  },

  async load() {
    let loginError = ''
    try {
      await store.ensureLogin()
    } catch (e) {
      loginError = (e && e.message) || '登录失败'
    }

    const me = store.getMe()
    const loggedIn = !!me.uid
    const stats = loggedIn ? await store.myStats() : { joinedCount: 0, ownedCount: 0 }

    this.setData({
      me: {
        uid: me.uid,
        name: me.name || '未登录',
        color: util.colorOf(me.uid || 'guest'),
        initial: util.initialOf(me.name || '未')
      },
      nameInput: me.name || '',
      stats: stats,
      env: store.envInfo(),
      loggedIn: loggedIn,
      loginError: loggedIn ? '' : loginError,
      loading: false
    })
  },

  /* ---------------- 微信一键登录 ---------------- */

  async loginWeChat() {
    if (this.data.busy) return
    this.setData({ busy: true })
    const res = await store.loginByWeChat()
    this.setData({ busy: false })
    if (!res.ok) {
      this.setData({ loginError: res.error || '微信登录失败' })
      return util.toast(res.error || '微信登录失败')
    }
    util.haptic()
    util.toast('登录成功')
    this.load()
  },

  /* ---------------- 邮箱验证码登录 ---------------- */

  onEmail(e) {
    // 换邮箱后之前拿到的验证码不再可用
    this._pendingEmail = null
    this.setData({ email: e.detail.value, emailError: '', codeSent: false, code: '' })
  },

  onCode(e) {
    this.setData({ code: e.detail.value })
  },

  async sendCode() {
    if (this.data.busy) return
    const email = String(this.data.email || '').trim()
    if (!EMAIL_RE.test(email)) {
      this.setData({ emailError: '请输入正确的邮箱地址' })
      return
    }

    this.setData({ busy: true })
    const res = await store.sendEmailCode(email)
    this.setData({ busy: false })

    if (!res.ok) {
      this.setData({ emailError: res.error || '验证码发送失败' })
      return
    }

    // 挑战要保存在事件处理函数之外，提交时复用；重新发送才会替换
    this._pendingEmail = {
      email: res.email,
      verificationId: res.verificationId,
      isExistingUser: res.isExistingUser
    }
    this.setData({ codeSent: true, emailError: '', code: '' })
    util.toast('验证码已发送')
  },

  async submitCode() {
    if (this.data.busy) return
    const pending = this._pendingEmail
    const email = String(this.data.email || '').trim()

    if (!pending || pending.email !== email) {
      this.setData({ emailError: '请先获取当前邮箱的验证码' })
      return
    }

    this.setData({ busy: true })
    const res = await store.submitEmailCode(pending, this.data.code)
    this.setData({ busy: false })

    if (!res.ok) return util.toast(res.error || '登录失败')

    this._pendingEmail = null
    this.setData({ codeSent: false, code: '', emailError: '' })
    util.haptic()
    util.toast('登录成功')
    this.load()
  },

  /* ---------------- 昵称 ---------------- */

  onNameInput(e) {
    this.setData({ nameInput: e.detail.value })
  },

  async saveName() {
    const t = String(this.data.nameInput || '').trim()
    if (!t) return util.toast('昵称不能为空')
    if (t.length > 12) return util.toast('昵称最多 12 个字')
    const res = await store.updateMyProfile(t)
    if (!res.ok) return util.toast(res.error || '保存失败')
    util.haptic()
    util.toast('已保存，小队内的显示名同步更新')
    this.load()
  },

  /* ---------------- 其它 ---------------- */

  copyBaseUrl() {
    const e = this.data.env || {}
    wx.setClipboardData({
      data: String(e.baseUrl || ''),
      success() { util.toast('服务地址已复制') }
    })
  },

  logout() {
    const that = this
    wx.showModal({
      title: '退出登录',
      content: '将清除本机的登录状态，云端数据不受影响。下次进入会重新登录。',
      confirmText: '退出',
      confirmColor: '#FF5A5F',
      success: async function (r) {
        if (!r.confirm) return
        await store.resetAll()
        util.toast('已退出登录')
        that.load()
      }
    })
  }
})
