/**
 * 站点骨架（与 Web 端 AppLayout + AppLayout 移动端断点一致）：
 *   - 顶部条：汉堡（或返回键）+ 工具名 + 右侧站点名「哈姆斯特」
 *   - 抽屉：工具徽标 + 当前工具菜单（明细 / 图表 / 选项源）+ 落款 + 用户卡
 *   - <slot /> 放页面内容
 *
 * mode="menu" 用于抽屉导航的三个主页面；mode="back" 用于记一笔 / 选项源编辑
 * 这类二级页，左上角变成返回键。
 */
const api = require('../../utils/api')

const NAVS = [
  { key: 'index', label: '明细', icon: '📒', url: '/pages/index/index' },
  { key: 'charts', label: '图表', icon: '📊', url: '/pages/charts/charts' },
  { key: 'options', label: '选项源', icon: '🏷️', url: '/pages/options/options?kind=category' }
]

Component({
  options: {
    multipleSlots: false
  },

  properties: {
    /** 背景滚回顶部条上的标题：menu 模式固定「记账」，back 模式由页面传 */
    title: { type: String, value: '' },
    mode: { type: String, value: 'menu' },
    /** 当前激活的导航 key：index / charts / options */
    active: { type: String, value: '' }
  },

  data: {
    navs: NAVS,
    statusBarHeight: 20,
    navHeight: 44,
    brandRight: 8,
    drawerOpen: false,
    user: { name: '', avatarUrl: '', initial: '哈', sub: '' }
  },

  lifetimes: {
    attached() {
      let statusBarHeight = 20
      let navHeight = 44
      let brandRight = 8
      try {
        const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
        statusBarHeight = win.statusBarHeight || 20
        const rect = wx.getMenuButtonBoundingClientRect()
        if (rect && rect.height) {
          // 胶囊上下留白对称，算出导航条高度
          navHeight = (rect.top - statusBarHeight) * 2 + rect.height
          // 右侧站点名要给右上角胶囊让位
          brandRight = (win.windowWidth - rect.left) + 8
        }
      } catch (e) { /* 兜底值已足够 */ }
      this.setData({ statusBarHeight: statusBarHeight, navHeight: navHeight, brandRight: brandRight })
    }
  },

  methods: {
    syncUser() {
      const u = api.getUser() || {}
      const name = u.nickName || ''
      this.setData({
        user: {
          name: name,
          avatarUrl: u.avatarUrl || '',
          initial: name ? name.charAt(0).toUpperCase() : '哈',
          sub: u.email || '微信账号'
        }
      })
    },

    openDrawer() {
      this.syncUser()
      this.setData({ drawerOpen: true })
    },

    closeDrawer() {
      this.setData({ drawerOpen: false })
    },

    noop() {},

    goNav(e) {
      const key = e.currentTarget.dataset.key
      const url = e.currentTarget.dataset.url
      this.setData({ drawerOpen: false })
      if (key === this.data.active) return
      // 抽屉切换页面等价于 Web 的路由跳转：替换当前页，不堆栈
      wx.redirectTo({ url: url })
    },

    goMe() {
      this.setData({ drawerOpen: false })
      wx.navigateTo({ url: '/pages/me/me' })
    },

    goBack() {
      wx.navigateBack()
    }
  }
})
