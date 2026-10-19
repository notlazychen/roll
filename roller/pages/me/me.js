const store = require('../../utils/store')
const util = require('../../utils/util')
const avatar = require('../../utils/avatar')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// 服务端给新用户生成的临时昵称（成员1234），看到它就说明还没设置过
const AUTO_NAME_RE = /^成员\d+$/

Page({
  data: {
    me: null,
    heroSub: '',
    stats: { joinedCount: 0, ownedCount: 0 },
    env: null,
    loading: true,

    loggedIn: false,
    loggedOut: false,
    loginError: '',
    busy: false,

    // 微信「头像昵称填写能力」：头像先拿到本地临时文件，保存时再上传
    avatarDraft: '',
    nameInput: '',

    // 邮箱验证码登录（只有云服务数据源才有，自建服务这条线不展示）
    supportEmailLogin: false,
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
    const before = store.envInfo()
    const loggedOut = !!before.loggedOut

    // 用户主动退出过就不再自动登录（微信一键登录是静默的，否则会立刻被登回来）
    if (!loggedOut) {
      try {
        await store.ensureLogin()
      } catch (e) {
        loginError = (e && e.message) || '登录失败'
      }
    }

    const me = store.getMe()
    const loggedIn = !!me.uid
    const stats = loggedIn ? await store.myStats() : { joinedCount: 0, ownedCount: 0 }
    const env = store.envInfo()

    // 没有头像、或昵称还是服务端生成的临时昵称 → 提示用户完善一次
    const autoName = !me.name || AUTO_NAME_RE.test(me.name)
    const incomplete = loggedIn && (!me.avatarUrl || autoName)

    let heroSub = '未登录'
    if (loggedIn) {
      heroSub = incomplete
        ? '资料还没完善，点下方头像与昵称设置一下'
        : ('已登录 · ' + (env.dataSource === 'cloud' ? '数据保存在微信云服务' : '数据保存在自建服务'))
    }

    this.setData({
      me: {
        uid: me.uid,
        name: me.name || '未登录',
        avatarUrl: me.avatarUrl || '',
        color: util.colorOf(me.uid || 'guest'),
        initial: util.initialOf(me.name || '未')
      },
      heroSub: heroSub,
      // 临时昵称不预填，让用户直接点输入框使用微信昵称
      nameInput: loggedIn && !autoName ? me.name : '',
      stats: stats,
      env: env,
      loggedIn: loggedIn,
      loggedOut: loggedOut,
      supportEmailLogin: !!env.supportEmailLogin,
      loginError: loggedIn ? '' : (loggedOut ? '你已退出登录，点下方按钮可以重新登录' : loginError),
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

  /* ---------------- 头像与昵称 ---------------- */

  /**
   * 用户选好微信头像。微信只给本地临时路径，不能直接用，
   * 先留在 avatarDraft 里做预览，点「保存」时再压缩上传。
   */
  onChooseAvatar(e) {
    const path = (e && e.detail && e.detail.avatarUrl) || ''
    if (!path) return
    this.setData({ avatarDraft: path })
  },

  onNameInput(e) {
    this.setData({ nameInput: (e && e.detail && e.detail.value) || '' })
  },

  async saveProfile() {
    if (this.data.busy) return

    const name = String(this.data.nameInput || '').trim()
    const draft = this.data.avatarDraft

    if (!name && !draft) return util.toast('请先选择头像或填写昵称')
    if (name && name.length > 16) return util.toast('昵称最多 16 个字')

    this.setData({ busy: true })

    let payload = null
    if (draft) {
      payload = await avatar.toBase64(draft)
      if (!payload.ok) {
        this.setData({ busy: false })
        return util.toast(payload.error || '头像读取失败，请换一张试试')
      }
    }

    const res = await store.saveProfile({
      name: name,
      avatarBase64: payload && payload.base64,
      contentType: payload && payload.contentType
    })

    this.setData({ busy: false })
    if (!res.ok) return util.toast(res.error || '保存失败')

    util.haptic()
    util.toast('已保存')
    // 草稿清掉，改为显示服务端返回的新头像地址
    this.setData({ avatarDraft: '' })
    this.load()
  },

  /* ---------------- 邮箱验证码登录（仅云服务数据源） ---------------- */

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
    if (typeof store.sendEmailCode !== 'function') {
      return util.toast('当前数据源不支持邮箱验证码登录')
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
    if (typeof store.submitEmailCode !== 'function') {
      return util.toast('当前数据源不支持邮箱验证码登录')
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
      content: '退出后会清除本机的登录状态，需要重新点击登录才能使用；云端数据不受影响。',
      confirmText: '退出',
      confirmColor: '#FF5A5F',
      success: async function (r) {
        if (!r.confirm) return
        await store.resetAll()
        // 先立刻切到未登录状态，再刷新；
        // resetAll 已经留下「主动退出」标记，load() 不会再自动登回去
        that.setData({
          loggedIn: false,
          loggedOut: true,
          avatarDraft: '',
          nameInput: '',
          loginError: '你已退出登录，点下方按钮可以重新登录',
          heroSub: '未登录'
        })
        util.toast('已退出登录')
        that.load()
      }
    })
  }
})
