const store = require('../../utils/store')
const util = require('../../utils/util')

const TYPE_ICON = {
  join: '🧑‍🤝‍🧑',
  member: '🧑‍🤝‍🧑',
  prepare: '🎯',
  cancel: '⛔',
  dissolved: '💨',
  result: '🎉',
  info: '🔔'
}

const TYPE_TEXT = {
  join: '成员动态',
  member: '成员动态',
  prepare: '准备提醒',
  cancel: '准备中断',
  dissolved: '小队解散',
  result: '随机结果',
  info: '通知'
}

Page({
  data: {
    list: [],
    me: null,
    loading: true
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load(function () {
      wx.stopPullDownRefresh()
    })
  },

  async load(done) {
    try {
      // 主动退出登录后就别再自动登录/打接口了，否则会 401 → 又被静默登回来
      if (!store.envInfo().loggedOut) {
        try { await store.ensureLogin() } catch (e) {}
      }
      if (!store.isLoggedIn()) {
        this.setData({ list: [], me: store.getMe(), loading: false })
        if (typeof done === 'function') done()
        return
      }

      const me = store.getMe()
      const rows = await store.listNotifications()
      const list = rows.map(function (n) {
        return {
          id: n.id,
          type: n.type,
          icon: TYPE_ICON[n.type] || '🔔',
          typeText: TYPE_TEXT[n.type] || '通知',
          content: n.content,
          groupId: n.groupId,
          groupTheme: n.groupTheme,
          read: n.read,
          timeText: util.fromNow(n.createdAt)
        }
      })
      this.setData({ list: list, me: me, loading: false })
      // 渲染后清掉未读角标（本次仍保留未读样式）
      await store.markAllRead()
    } catch (e) {
      this.setData({ loading: false })
    }
    if (typeof done === 'function') done()
  },

  async onTapItem(e) {
    const gid = e.currentTarget.dataset.gid
    if (!gid) return
    const g = await store.getGroup(gid)
    if (!g) return util.toast('该小队已被解散')
    wx.navigateTo({ url: '/pages/group/group?id=' + gid })
  },

  clearAll() {
    const that = this
    wx.showModal({
      title: '清空消息',
      content: '将删除当前身份下的全部消息记录。',
      confirmText: '清空',
      confirmColor: '#FF5A5F',
      success: async function (r) {
        if (!r.confirm) return
        await store.clearNotifications()
        util.toast('已清空')
        that.load()
      }
    })
  }
})
