const store = require('../../utils/store')
const util = require('../../utils/util')

const PAGE_SIZE = 30

Page({
  data: {
    loggedIn: false,
    loading: true,
    loadingMore: false,

    // 当前查看的月份
    year: 0,
    month: 0,
    monthLabel: '',
    monthValue: '',
    maxMonth: '',
    canNextMonth: false,

    // 概览四卡：本月支出 / 本月收入 / 本月结余 / 今日支出
    stats: [],

    // 列表按日期分组
    groups: [],
    hasMore: false,
    nextCursor: null,
    loadedCount: 0,
    total: 0,

    // 筛选：搜索词 + 收支类型
    keyword: '',
    type: ''
  },

  onLoad() {
    const now = new Date()
    this.setMonth(now.getFullYear(), now.getMonth(), false)
  },

  onShow() {
    // 从记账页回来时脏标记为真，需要整体刷新
    if (this._loaded && !getApp().globalData.dirty) return
    this._loaded = true
    getApp().globalData.dirty = false
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh(function () { wx.stopPullDownRefresh() })
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) this.loadMore()
  },

  /* ------------------------- 月份 ------------------------- */

  setMonth(year, month, reload) {
    const now = new Date()
    const curY = now.getFullYear()
    const curM = now.getMonth()
    const d = new Date(year, month, 1)
    const isCurrent = year === curY && month === curM

    this.setData({
      year: year,
      month: month,
      monthLabel: util.monthLabel(d.getTime()),
      monthValue: year + '-' + util.pad2(month + 1),
      maxMonth: curY + '-' + util.pad2(curM + 1),
      canNextMonth: !isCurrent && d.getTime() < new Date(curY, curM, 1).getTime()
    })

    if (reload) this.reload()
  },

  prevMonth() {
    const y = this.data.year
    const m = this.data.month - 1
    if (m < 0) this.setMonth(y - 1, 11, true)
    else this.setMonth(y, m, true)
  },

  nextMonth() {
    if (!this.data.canNextMonth) return
    const y = this.data.year
    const m = this.data.month + 1
    if (m > 11) this.setMonth(y + 1, 0, true)
    else this.setMonth(y, m, true)
  },

  onMonthPick(e) {
    const parts = String(e.detail.value || '').split('-')
    const y = Number(parts[0])
    const m = Number(parts[1]) - 1
    if (!y || isNaN(m) || m < 0) return
    const now = new Date()
    // 不允许翻到未来月份
    if (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth())) return
    this.setMonth(y, m, true)
  },

  /** 当前月份的左闭右开区间（与 Web 的 startOfMonth / endOfMonth 一致） */
  range() {
    return {
      from: new Date(this.data.year, this.data.month, 1).getTime(),
      to: new Date(this.data.year, this.data.month + 1, 1).getTime()
    }
  },

  /* ------------------------- 加载 ------------------------- */

  async refresh(done) {
    this.setData({ loading: true })

    let loggedIn = store.isLoggedIn()
    if (!loggedIn) {
      try {
        await store.ensureLogin()
        loggedIn = store.isLoggedIn()
      } catch (e) {
        loggedIn = false
        // 陌生微信：服务端不再静默建号，引导用户绑定已有账号或创建新账号
        if (e && e.needLink) this.guideLink()
      }
    }

    if (!loggedIn) {
      this.setData({ loggedIn: false, loading: false, groups: [], stats: [] })
      if (done) done()
      return
    }

    await Promise.all([this.loadFirstPage(), this.loadStats()])

    this.setData({ loggedIn: true, loading: false })
    if (done) done()
  },

  /** 陌生微信引导：绑定已有邮箱账号（保留账目）或创建新账号 */
  guideLink() {
    wx.showModal({
      title: '绑定账号',
      content: '这个微信还没有关联的账号。可以绑定已有的邮箱账号（历史账目保留），或创建新账号。',
      confirmText: '去绑定',
      cancelText: '暂不',
      success(res) {
        if (res.confirm) wx.navigateTo({ url: '/pages/account-link/account-link' })
      }
    })
  },

  currentFilter() {
    const r = this.range()
    return {
      type: this.data.type,
      keyword: this.data.keyword.trim(),
      from: r.from,
      to: r.to
    }
  },

  async loadFirstPage() {
    const res = await store.listEntries(this.currentFilter(), null, PAGE_SIZE)
    this._items = res.items
    this.setData({
      groups: groupByDay(res.items),
      hasMore: res.hasMore,
      nextCursor: res.nextCursor,
      loadedCount: res.items.length,
      // 首页加载时先按「已取到的条数」显示；还有下一页就说明不止这些
      total: res.hasMore ? -1 : res.items.length
    })
  },

  async loadMore() {
    this.setData({ loadingMore: true })
    const res = await store.listEntries(this.currentFilter(), this.data.nextCursor, PAGE_SIZE)
    this._items = (this._items || []).concat(res.items)
    this.setData({
      groups: groupByDay(this._items),
      hasMore: res.hasMore,
      nextCursor: res.nextCursor,
      loadedCount: this._items.length,
      loadingMore: false,
      total: res.hasMore ? -1 : this._items.length
    })
  },

  /** 概览四卡：当月收支用报表口径算，今日支出取 overview */
  async loadStats() {
    const r = this.range()
    const now = new Date()
    const isCurrent = this.data.year === now.getFullYear() && this.data.month === now.getMonth()
    const prefix = isCurrent ? '本月' : this.data.month + 1 + '月'

    const [rep, ov] = await Promise.all([store.report(r.from, r.to), store.overview()])

    // 报表失败时，本月还能退回 overview 的口径；其它月份只能显示 0
    const expense = rep ? rep.expense : (isCurrent ? ov.monthExpense || 0 : 0)
    const income = rep ? rep.income : (isCurrent ? ov.monthIncome || 0 : 0)

    this.setData({
      stats: [
        { key: 'expense', label: prefix + '支出', value: util.money(expense), tone: 'expense', accent: true },
        { key: 'income', label: prefix + '收入', value: util.money(income), tone: 'income' },
        { key: 'balance', label: prefix + '结余', value: util.money(income - expense), tone: 'neutral' },
        { key: 'today', label: '今日支出', value: util.money(ov.todayExpense || 0), tone: 'plain' }
      ]
    })
  },

  /* ------------------------- 筛选 ------------------------- */

  onKeyword(e) {
    const value = e.detail.value
    this.setData({ keyword: value })
    // 边打边搜，350ms 防抖，避免每个字符都发一次请求
    if (this._kwTimer) clearTimeout(this._kwTimer)
    const that = this
    this._kwTimer = setTimeout(function () {
      that.reload()
    }, 350)
  },

  onKeywordConfirm() {
    if (this._kwTimer) clearTimeout(this._kwTimer)
    this.reload()
  },

  clearKeyword() {
    if (this._kwTimer) clearTimeout(this._kwTimer)
    this.setData({ keyword: '' })
    this.reload()
  },

  onTypeFilter(e) {
    const type = e.currentTarget.dataset.type || ''
    if (type === this.data.type) return
    this.setData({ type: type })
    this.reload()
  },

  async reload() {
    this.setData({ loading: true, nextCursor: null })
    await this.loadFirstPage()
    this.setData({ loading: false })
  },

  /* ------------------------- 跳转 ------------------------- */

  addEntry() {
    util.haptic()
    wx.navigateTo({ url: '/pages/entry/entry' })
  },

  openEntry(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/entry/entry?id=' + id })
  },

  goMe() {
    wx.navigateTo({ url: '/pages/me/me' })
  }
})

/** 按「天」分组，并在组标题右侧显示当天收支（与 Web 的 daySum 一致） */
function groupByDay(items) {
  const out = []
  const map = {}
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const key = it.dateKey
    if (!map[key]) {
      map[key] = { key: key, label: it.dayLabel, items: [], income: 0, expense: 0 }
      out.push(map[key])
    }
    map[key].items.push(it)
    if (it.isIncome) map[key].income += it.amount
    else map[key].expense += it.amount
  }
  out.forEach(function (g) {
    g.expenseText = g.expense > 0 ? util.money(g.expense) : ''
    g.incomeText = g.income > 0 ? util.money(g.income) : ''
  })
  return out
}
