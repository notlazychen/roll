/**
 * 站点骨架（与 Web 端 AppLayout + ToolSwitcher 结构一致）：
 *   - 顶部条：汉堡（或返回键）+ 当前工具名 + 右侧站点名「哈姆斯特」
 *   - 抽屉：工具名 + 切换按钮（点开列出全部工具）+ 仅当前工具的子导航
 *           + 落款 + 用户卡
 *   - <slot /> 放页面内容
 *
 * mode="menu" 用于抽屉导航的主页面；mode="back" 用于记一笔 / 选项源编辑
 * 这类二级页，左上角变成返回键。
 * tool="ledger" | "todo" 声明当前所属工具，决定顶栏标题与抽屉里显示的导航。
 */
const api = require('../../utils/api')

/** 工具注册表：与 roller-web/src/components/tools.tsx 的 TOOLS 一一对应 */
const TOOLS = [
  {
    key: 'ledger',
    name: '记账',
    icon: '🐹',
    desc: '收支明细、图表与选项源',
    ready: true,
    navs: [
      { key: 'index', label: '明细', icon: '📒', url: '/pages/index/index' },
      { key: 'charts', label: '图表', icon: '📊', url: '/pages/charts/charts' },
      { key: 'options', label: '选项源', icon: '🏷️', url: '/pages/options/options?kind=category' }
    ]
  },
  {
    key: 'todo',
    name: '任务清单',
    icon: '✅',
    desc: '今日任务、规划与打卡图表',
    ready: true,
    navs: [
      { key: 'todo-today', label: '今日任务', icon: '☀️', url: '/pages/todo-today/todo-today' },
      { key: 'todo-plan', label: '任务规划', icon: '🗂️', url: '/pages/todo-plan/todo-plan' },
      { key: 'todo-charts', label: '数据图表', icon: '📈', url: '/pages/todo-charts/todo-charts' }
    ]
  },
  {
    key: 'more',
    name: '更多工具',
    icon: '🧰',
    desc: '还在仓鼠的储藏室里',
    ready: false,
    navs: []
  }
]

Component({
  options: {
    multipleSlots: false
  },

  properties: {
    /** 背景滚回顶部条上的标题：menu 模式用当前工具名，back 模式由页面传 */
    title: { type: String, value: '' },
    mode: { type: String, value: 'menu' },
    /** 当前激活的导航 key：index / charts / options / todo-today / ... */
    active: { type: String, value: '' },
    /** 当前工具：ledger（默认）/ todo */
    tool: { type: String, value: 'ledger' }
  },

  data: {
    tools: TOOLS,
    currentName: '记账',
    currentIcon: '🐹',
    currentTool: 'ledger',
    currentNavs: [],
    toolMenuOpen: false,
    statusBarHeight: 20,
    navHeight: 44,
    brandRight: 8,
    drawerOpen: false,
    user: { name: '', avatarUrl: '', initial: '哈', sub: '' }
  },

  observers: {
    tool() {
      this.syncTool()
    }
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
      this.syncTool()
      this.setData({ statusBarHeight: statusBarHeight, navHeight: navHeight, brandRight: brandRight })
    }
  },

  methods: {
    syncTool() {
      const tool = TOOLS.find((t) => t.key === this.data.tool) || TOOLS[0]
      this.setData({
        currentName: tool.name,
        currentIcon: tool.icon,
        currentTool: tool.key,
        currentNavs: tool.navs
      })
    },

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
      this.setData({ drawerOpen: true, toolMenuOpen: false })
    },

    closeDrawer() {
      this.setData({ drawerOpen: false, toolMenuOpen: false })
    },

    noop() {},

    /** 点工具名右侧的切换钮：展开/收起工具列表（同 Web 的 ToolSwitcher） */
    toggleToolMenu() {
      this.setData({ toolMenuOpen: !this.data.toolMenuOpen })
    },

    /** 从工具列表里挑一个：未上线的忽略，当前工具直接收起 */
    pickTool(e) {
      const key = e.currentTarget.dataset.key
      const tool = TOOLS.find((t) => t.key === key)
      if (!tool || !tool.ready) return
      this.setData({ toolMenuOpen: false })
      if (key === this.data.currentTool || !tool.navs.length) return
      // 切工具等价于 Web 的跳到该工具首页：替换当前页，不堆栈
      this.setData({ drawerOpen: false })
      wx.redirectTo({ url: tool.navs[0].url })
    },

    goNav(e) {
      const key = e.currentTarget.dataset.key
      const url = e.currentTarget.dataset.url
      this.setData({ drawerOpen: false, toolMenuOpen: false })
      if (key === this.data.active) return
      // 抽屉切换页面等价于 Web 的路由跳转：替换当前页，不堆栈
      wx.redirectTo({ url: url })
    },

    goMe() {
      this.setData({ drawerOpen: false, toolMenuOpen: false })
      wx.navigateTo({ url: '/pages/me/me' })
    },

    goBack() {
      wx.navigateBack()
    }
  }
})
