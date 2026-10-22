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
    nameInput: ''
  },

  onShow() {
    this.load()
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
        tagAutoEnabled: me.tagAutoEnabled
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
    const ok = await util.confirm('退出登录', '将清除本机登录状态，云端账目不受影响。下次进入会重新用微信登录。', '退出')
    if (!ok) return
    store.logout()
    getApp().globalData.dirty = true
    // 只刷当前页还不够：底栏的明细/图表还留着上一个账号的数据，
    // 因此退出后直接回到明细页并重启到登录前状态
    util.toast('已退出登录')
    setTimeout(function () {
      wx.reLaunch({ url: '/pages/index/index' })
    }, 600)
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

  copyBaseUrl() {
    const url = (this.data.env && this.data.env.baseUrl) || ''
    wx.setClipboardData({
      data: url,
      success: function () { util.toast('已复制服务地址') }
    })
  },

  /* ------------------------- 网页扫码登录 ------------------------- */

  /** 在网页 roll.acgun.cn 登录页生成配对码，这里扫二维码或手输批准 */
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
