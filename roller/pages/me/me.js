const store = require('../../utils/store')
const util = require('../../utils/util')

Page({
  data: {
    loading: true,
    loggedIn: false,
    loginError: '',

    me: { name: '', avatarUrl: '', initial: '', tagAutoEnabled: true },
    stats: { entryCount: 0, sinceText: '' },
    month: { expenseText: '0.00', incomeText: '0.00' },
    counts: { categories: 0, channels: 0, consumers: 0, accounts: 0, tags: 0 },
    env: { baseUrl: '' },

    showName: false,
    nameInput: '',

    // 邮箱绑定 / 解绑弹层
    showEmail: false,
    emailMode: 'bind', // 'bind' | 'unbind'
    emailInput: '',
    emailInvalid: false,
    emailCode: '',
    emailError: '',
    codeSending: false,
    codeCooldown: 0,
    emailBusy: false
  },

  onShow() {
    this.load()
  },

  onUnload() {
    this.stopCodeTimer()
  },

  async load() {
    const loggedIn = store.isLoggedIn()
    if (!loggedIn) {
      // 本地缓存里的旧账号也要清掉，否则「我的」页会显示上一个账号的昵称/头像
      this.setData({
        loading: false,
        loggedIn: false,
        me: { name: '', avatarUrl: '', initial: '', tagAutoEnabled: true },
        stats: { entryCount: 0, sinceText: '' },
        month: { expenseText: '0.00', incomeText: '0.00' },
        counts: { categories: 0, channels: 0, consumers: 0, accounts: 0, tags: 0 },
        env: store.envInfo()
      })
      return
    }

    const that = this
    const [meRes, options, overview] = await Promise.all([
      store.fetchMe(),
      store.loadOptions(),
      store.overview()
    ])

    const me = store.getMe()
    const since = meRes && meRes.stats && meRes.stats.firstRecordAt
      ? '自 ' + util.monthDay(meRes.stats.firstRecordAt) + ' 起'
      : '还没有账目'

    that.setData({
      loading: false,
      loggedIn: true,
      me: {
        name: me.name,
        avatarUrl: me.avatarUrl,
        initial: util.initialOf(me.name || '账'),
        tagAutoEnabled: me.tagAutoEnabled,
        email: me.email || '',
        wechatBound: !!me.weChatBound
      },
      stats: {
        entryCount: (meRes && meRes.stats && meRes.stats.entryCount) || 0,
        sinceText: since
      },
      month: {
        expenseText: util.money(overview.monthExpense || 0),
        incomeText: util.money(overview.monthIncome || 0)
      },
      counts: {
        categories: options.categories.length,
        channels: options.channels.length,
        consumers: options.consumers.length,
        accounts: options.accounts.length,
        tags: options.tags.length
      },
      env: store.envInfo()
    })
  },

  /* ------------------------- 登录 ------------------------- */

  async login() {
    wx.showLoading({ title: '登录中', mask: true })
    try {
      await store.ensureLogin(true)
    } catch (e) {
      wx.hideLoading()
      // 陌生微信：服务端不会静默建号，去账号绑定页（绑定已有账号或创建新账号）
      if (e && e.needLink) {
        wx.navigateTo({ url: '/pages/account-link/account-link' })
        return
      }
      this.setData({ loginError: (e && e.message) || '登录失败' })
      return
    }
    wx.hideLoading()
    if (!store.isLoggedIn()) {
      this.setData({ loginError: '登录失败，请稍后重试' })
      return
    }
    util.toast('登录成功', 'success')
    this.load()
  },

  async logout() {
    const ok = await util.confirm('退出登录', '将清除本机登录状态，云端账目不受影响。退出后停留在登录界面，重新登录即可找回账号。', '退出')
    if (!ok) return
    store.logout()
    getApp().globalData.dirty = true
    // 直接落到独立的登录页：不经过明细页，避免被任何自动登录逻辑接管
    wx.reLaunch({ url: '/pages/login/login' })
  },

  /* ------------------------- 昵称 / 头像 ------------------------- */

  editName() {
    this.setData({ showName: true, nameInput: this.data.me.name })
  },

  closeName() {
    this.setData({ showName: false })
  },

  noop() {},

  onNameInput(e) {
    this.setData({ nameInput: e.detail.value })
  },

  async saveName() {
    const name = String(this.data.nameInput || '').trim()
    if (!name) return util.toast('昵称不能为空')
    const res = await store.updateProfile({ nickName: name })
    if (!res.ok) return util.toast(res.error || '保存失败')
    this.setData({ showName: false })
    util.toast('已保存')
    this.load()
  },

  /** 头像：chooseAvatar 拿到临时路径，先存本地用于展示，再同步到服务端 */
  async onChooseAvatar(e) {
    const tempUrl = e && e.detail && e.detail.avatarUrl
    if (!tempUrl) return

    // 临时文件过一段时间会失效，先落盘到用户目录再上传
    const avatarUrl = await persistAvatar(tempUrl)
    this.setData({ 'me.avatarUrl': avatarUrl })

    const res = await store.updateProfile({ avatarUrl: avatarUrl })
    if (!res.ok) util.toast('头像保存失败')
  },

  /* ------------------------- 偏好 ------------------------- */

  async onAutoTagChange(e) {
    const on = !!e.detail.value
    const res = await store.updateProfile({ tagAutoEnabled: on })
    if (!res.ok) {
      util.toast(res.error || '保存失败')
      this.setData({ 'me.tagAutoEnabled': !on })
      return
    }
    this.setData({ 'me.tagAutoEnabled': on })
    util.toast(on ? '已开启自动识别' : '已关闭自动识别')
  },

  /* ------------------------- 跳转 ------------------------- */

  goOptions(e) {
    const kind = e.currentTarget.dataset.kind || 'category'
    wx.navigateTo({ url: '/pages/options/options?kind=' + kind })
  },

  /* ------------------------- 网页扫码登录 ------------------------- */
  /* ------------------------- 账号绑定 ------------------------- */

  /** 绑定微信到当前账号；微信已属于其他账号时询问是否合并 */
  async bindWechat() {
    const r = await store.bindWeChat('')
    if (!r.ok && !r.needMerge) {
      util.toast(r.error || '绑定失败')
      return
    }

    if (r.needMerge) {
      const other = r.other || {}
      const ok = await util.confirm(
        '合并账号？',
        '这个微信已经属于账号「' + (other.nickName || '其他账号') + '」（' +
        (other.entryCount || 0) + ' 笔账目）。\n确认后该账号的全部数据会并入当前账号，且无法撤销。',
        '合并'
      )
      if (!ok) return

      const r2 = await store.bindWeChat(r.mergeTicket)
      if (!r2.ok) {
        util.toast(r2.error || '合并失败')
        return
      }
      util.toast('已合并，账目已迁移', 'success')
      this.load()
      return
    }

    util.toast(r.merged ? '已合并' : '绑定成功', 'success')
    this.load()
  },

  /* ------------------------- 解绑微信 ------------------------- */

  /** 解绑微信：wx.login 拿 code 做授权二次校验，服务端确认 openid 一致才解绑 */
  async unbindWechat() {
    if (!this.data.me.email) {
      util.toast('请先绑定邮箱，否则解绑后将无法登录本账号')
      return
    }
    const ok = await util.confirm(
      '解绑微信',
      '解绑后这个微信将无法直接登录该账号，可改用邮箱登录。确定解绑？',
      '解绑'
    )
    if (!ok) return

    wx.showLoading({ title: '解绑中', mask: true })
    const r = await store.unbindWeChat()
    wx.hideLoading()
    if (!r.ok) return util.toast(r.error || '解绑失败')
    util.toast('已解绑微信', 'success')
    this.load()
  },

  /* ------------------------- 绑定 / 解绑邮箱 ------------------------- */

  /** 未绑定：弹「绑定邮箱」面板（输入邮箱 + 发送验证码 + 输入验证码） */
  openEmailBind() {
    this.stopCodeTimer()
    this.setData({
      showEmail: true,
      emailMode: 'bind',
      emailInput: '',
      emailInvalid: false,
      emailCode: '',
      emailError: '',
      codeSending: false,
      codeCooldown: 0,
      emailBusy: false
    })
  },

  /** 已绑定：弹「解绑邮箱」面板（验证码发到当前绑定邮箱） */
  openEmailUnbind() {
    this.stopCodeTimer()
    this.setData({
      showEmail: true,
      emailMode: 'unbind',
      emailInput: this.data.me.email || '',
      emailInvalid: false,
      emailCode: '',
      emailError: '',
      codeSending: false,
      codeCooldown: 0,
      emailBusy: false
    })
  },

  closeEmail() {
    this.stopCodeTimer()
    this.setData({ showEmail: false })
  },

  onEmailInput(e) {
    this.setData({ emailInput: e.detail.value, emailInvalid: false, emailError: '' })
  },

  onEmailCodeInput(e) {
    this.setData({ emailCode: e.detail.value, emailError: '' })
  },

  stopCodeTimer() {
    if (this._codeTimer) {
      clearInterval(this._codeTimer)
      this._codeTimer = null
    }
  },

  /** 发送验证码：bind 发到输入的邮箱（格式不对标红），unbind 发到当前绑定邮箱 */
  async sendCode() {
    if (this.data.codeSending || this.data.codeCooldown > 0) return
    const mode = this.data.emailMode
    const email = mode === 'unbind'
      ? (this.data.me.email || '')
      : (this.data.emailInput || '').trim()

    if (mode === 'bind' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      this.setData({ emailInvalid: true, emailError: '请输入正确的邮箱地址' })
      return
    }

    this.setData({ codeSending: true, emailError: '' })
    const r = await store.sendEmailCode(email, mode === 'bind' ? 'bind' : 'unbind')
    this.setData({ codeSending: false })

    if (!r.ok) {
      this.setData({ emailError: r.error || '发送失败' })
      return
    }

    // 60 秒重发倒计时
    this.setData({ codeCooldown: 60 })
    const that = this
    this._codeTimer = setInterval(function () {
      const left = that.data.codeCooldown - 1
      if (left <= 0) {
        that.stopCodeTimer()
        that.setData({ codeCooldown: 0 })
      } else {
        that.setData({ codeCooldown: left })
      }
    }, 1000)

    if (r.debugCode) {
      // 开发模式：邮件服务未配置，验证码直接展示出来方便联调
      this.setData({ emailError: '开发模式验证码：' + r.debugCode })
    } else {
      util.toast('验证码已发送，请查收邮件', 'success')
    }
  },

  /** 确认绑定 / 解绑邮箱 */
  async submitEmail() {
    if (this.data.emailBusy) return
    const mode = this.data.emailMode
    const code = (this.data.emailCode || '').trim()
    if (!code) {
      this.setData({ emailError: '请输入验证码' })
      return
    }

    this.setData({ emailBusy: true, emailError: '' })
    const r = mode === 'bind'
      ? await store.bindEmail((this.data.emailInput || '').trim(), code)
      : await store.unbindEmail(code)
    this.setData({ emailBusy: false })

    if (!r.ok) {
      this.setData({ emailError: r.error || '操作失败' })
      return
    }

    util.toast(mode === 'bind' ? '邮箱已绑定' : '邮箱已解绑', 'success')
    this.closeEmail()
    this.load()
  },

  webLogin() {
    const self = this
    wx.scanCode({
      onlyFromCamera: false,
      success(res) {
        self.approveWebLogin(res.result)
      },
      fail() {
        // 用户取消或没有二维码可扫：提供手输入口
        wx.showModal({
          title: '扫一扫登录网页',
          editable: true,
          placeholderText: '输入网页上的 8 位配对码',
          confirmText: '批准',
          success(r) {
            if (r.confirm && r.content) self.approveWebLogin(r.content)
          }
        })
      }
    })
  },

  async approveWebLogin(raw) {
    const res = await store.approveWebQr(raw)
    if (!res.ok) {
      util.toast(res.error)
      return
    }
    wx.showModal({
      title: '已批准',
      content: '网页「' + (res.webUser || '你的账号') + '」的配对请求已通过，回到网页即可自动登录。',
      showCancel: false
    })
  }
})

/**
 * 头像落盘：chooseAvatar 给的是临时文件，重启后会失效。
 * 用 wx.getFileSystemManager().saveFile 存到用户目录，拿到持久路径。
 * 失败时退回临时路径（当次会话仍可显示）。
 */
function persistAvatar(tempPath) {
  return new Promise(function (resolve) {
    try {
      wx.getFileSystemManager().saveFile({
        tempFilePath: tempPath,
        success: function (r) { resolve(r.savedFilePath || tempPath) },
        fail: function () { resolve(tempPath) }
      })
    } catch (e) {
      resolve(tempPath)
    }
  })
}
