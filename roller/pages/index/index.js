const store = require('../../utils/store')
const util = require('../../utils/util')

// 卡片柔和底色 / 主题文字色（浅色主题）
const TINTS = ['#EEEAFF', '#FFEAF3', '#FFF4E3', '#E7F8EF', '#E6F4FE', '#F3EAFF', '#FFECEC', '#E3F7F4']
const INKS = ['#5B47E0', '#D6437B', '#C97A12', '#1E9E5A', '#1E86C9', '#7B3FD4', '#D94144', '#0E9384']

const STAGE_TEXT = {
  preparing: '准备中',
  rolling: '随机中',
  result: '已出结果'
}

Page({
  data: {
    me: null,
    groups: [],
    keyword: '',
    unread: 0,
    loading: true,
    // 未登录时给出的提示文案；为空表示登录正常
    loginError: '',

    showCreate: false,
    cTheme: '',
    cUsePass: false,
    cPasscode: '',

    showJoin: false,
    joinTarget: null,
    joinPasscode: ''
  },

  onLoad() {
    this.refresh()
  },

  onShow() {
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh(function () {
      wx.stopPullDownRefresh()
    })
  },

  /* ---------------- 数据 ---------------- */

  async refresh(done) {
    try {
      // 大厅需要登录态。云端登录是静默的（不弹授权框）；
      // 若应用还没开启微信登录，这里会失败，页面给出「去登录」引导。
      let loginError = ''
      try {
        await store.ensureLogin()
      } catch (e) {
        loginError = (e && e.message) || '需要登录后才能使用'
      }

      const me = store.getMe()
      let groups = []
      let unread = 0
      if (!loginError) {
        groups = await store.listGroups(this.data.keyword)
        unread = await store.unreadCount()
      }

      const list = []
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i]
        list.push({
          id: g.id,
          code: g.code,
          theme: g.theme,
          stage: g.stage,
          stageText: STAGE_TEXT[g.stage] || '',
          memberCount: g.memberCount,
          hasPasscode: g.hasPasscode,
          // 数据源在同一份列表里就返回了「我是否已加入 / 我是否是队长」
          isLeader: !!g.owner,
          joined: !!g.joined,
          tint: TINTS[i % TINTS.length],
          ink: INKS[i % INKS.length]
        })
      }

      this.setData({
        me: me,
        groups: list,
        unread: unread,
        loginError: loginError,
        loading: false
      })
    } catch (e) {
      this.setData({ loading: false })
      util.toast('加载失败，请重试')
    }
    if (typeof done === 'function') done()
  },

  /* ---------------- 搜索 ---------------- */

  onKeyword(e) {
    this.setData({ keyword: e.detail.value })
  },

  doSearch() {
    this.refresh()
  },

  clearKeyword() {
    this.setData({ keyword: '' }, () => this.refresh())
  },

  /* ---------------- 创建小队 ---------------- */

  openCreate() {
    this.setData({ showCreate: true, cTheme: '', cUsePass: false, cPasscode: '' })
  },

  closeCreate() {
    this.setData({ showCreate: false })
  },

  onCTheme(e) {
    this.setData({ cTheme: e.detail.value })
  },

  onTogglePass(e) {
    const on = e.detail.value
    this.setData({ cUsePass: on, cPasscode: on ? this.data.cPasscode : '' })
  },

  onCPasscode(e) {
    this.setData({ cPasscode: String(e.detail.value).replace(/\D/g, '').slice(0, 5) })
  },

  async submitCreate() {
    const theme = String(this.data.cTheme || '').trim()
    if (!theme) return util.toast('请填写小队主题')
    if (theme.length > store.MAX_THEME) return util.toast('主题最多 10 个字符')
    if (this.data.cUsePass && !/^\d{5}$/.test(this.data.cPasscode)) {
      return util.toast('口令必须是 5 位数字')
    }
    const res = await store.createGroup({
      theme: theme,
      passcode: this.data.cUsePass ? this.data.cPasscode : ''
    })
    if (!res.ok) return util.toast(res.error || '创建失败')
    util.haptic()
    this.setData({ showCreate: false })
    wx.navigateTo({ url: '/pages/group/group?id=' + res.group.id })
  },

  /* ---------------- 加入小队 ---------------- */

  async onTapGroup(e) {
    const id = e.currentTarget.dataset.id
    const me = store.getMe()
    const joined = await store.isMember(id, me.uid)
    if (joined) {
      wx.navigateTo({ url: '/pages/group/group?id=' + id })
      return
    }
    const g = await store.getGroup(id)
    if (!g) return util.toast('小队不存在')
    this.setData({ showJoin: true, joinTarget: g, joinPasscode: '' })
  },

  closeJoin() {
    this.setData({ showJoin: false, joinTarget: null })
  },

  onJoinPasscode(e) {
    this.setData({ joinPasscode: String(e.detail.value).replace(/\D/g, '').slice(0, 5) })
  },

  async submitJoin() {
    const g = this.data.joinTarget
    if (!g) return
    if (g.memberCount >= store.MAX_MEMBERS) {
      return util.toast('小队人数已达上限（20 人）')
    }
    if (g.hasPasscode && !/^\d{5}$/.test(this.data.joinPasscode)) {
      return util.toast('请输入 5 位数字口令')
    }
    const res = await store.joinGroup(g.id, { passcode: this.data.joinPasscode })
    if (!res.ok) return util.toast(res.error || '加入失败')
    util.haptic()
    util.toast(res.already ? '你已在小队中' : '加入成功')
    this.setData({ showJoin: false, joinTarget: null })
    wx.navigateTo({ url: '/pages/group/group?id=' + g.id })
  },

  /* ---------------- 跳转 ---------------- */

  goMessages() {
    wx.navigateTo({ url: '/pages/messages/messages' })
  },

  goMe() {
    wx.navigateTo({ url: '/pages/me/me' })
  },

  noop() {}
})
