const api = require('../../utils/api')
const util = require('../../utils/util')

Page({
  data: {
    hasTicket: false,
    tab: 'link',
    email: '',
    password: '',
    nickName: '',
    busy: false,
    error: ''
  },

  onLoad(query) {
    const ticket = (query && query.ticket) || api.takePendingLink() || ''
    this.setData({
      hasTicket: !!ticket,
      tab: ticket ? 'link' : 'email'
    })
    this.linkTicket = ticket
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab && tab !== this.data.tab) this.setData({ tab: tab, error: '' })
  },

  onEmail(e) { this.setData({ email: e.detail.value, error: '' }) },
  onPassword(e) { this.setData({ password: e.detail.value, error: '' }) },
  onNickName(e) { this.setData({ nickName: e.detail.value, error: '' }) },

  fail(msg) {
    this.setData({ busy: false, error: msg || '操作失败' })
  },

  done() {
    this.setData({ busy: false })
    // 清掉旧的登录缓存引用，重新以新账号进入主流程
    wx.reLaunch({ url: '/pages/index/index' })
  },

  /* ---------- 绑定已有邮箱账号 ---------- */
  async submitLink() {
    if (this.data.busy) return
    const email = (this.data.email || '').trim()
    const password = this.data.password || ''
    if (!email || !password) return this.fail('请输入邮箱和密码')

    this.setData({ busy: true })
    const r = await api.claimWeChat({
      action: 'link',
      linkTicket: this.linkTicket,
      email: email,
      password: password
    })
    if (!r.ok) return this.fail(r.error)
    util.toast('已绑定，欢迎回来')
    this.done()
  },

  /* ---------- 创建新账号 ---------- */
  async submitCreate() {
    if (this.data.busy) return
    this.setData({ busy: true })
    const r = await api.claimWeChat({
      action: 'create',
      linkTicket: this.linkTicket,
      nickName: (this.data.nickName || '').trim(),
      avatarUrl: ''
    })
    if (!r.ok) return this.fail(r.error)
    util.toast('账号已创建')
    this.done()
  },

  /* ---------- 纯邮箱登录（无票据时） ---------- */
  async submitEmailLogin() {
    if (this.data.busy) return
    const email = (this.data.email || '').trim()
    const password = this.data.password || ''
    if (!email || !password) return this.fail('请输入邮箱和密码')

    this.setData({ busy: true })
    const r = await api.loginByEmail(email, password)
    if (!r.ok) return this.fail(r.error)
    util.toast('登录成功')
    this.done()
  }
})
