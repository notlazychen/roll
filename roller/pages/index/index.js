const store = require('../../utils/store')
const util = require('../../utils/util')

const PAGE_SIZE = 30

Page({
  data: {
    loggedIn: false,
    loading: true,
    loadingMore: false,

    overview: {
      monthExpenseText: '0.00',
      monthIncomeText: '0.00',
      todayExpenseText: '0.00',
      todayIncomeText: '0.00'
    },
    monthLabel: '',

    // 列表按日期分组
    groups: [],
    hasMore: false,
    nextCursor: null,
    loadedCount: 0,
    total: 0,

    // 筛选
    keyword: '',
    showFilter: false,
    filter: { type: '', category: '' },
    filterActive: false,
    options: { categories: [] }
  },

  onLoad() {
    this.setData({ monthLabel: util.monthLabel(Date.now()) })
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
      }
    }

    if (!loggedIn) {
      this.setData({ loggedIn: false, loading: false, groups: [] })
      if (done) done()
      return
    }

    // 选项源只用于筛选条，与列表并行拉取
    const that = this
    await Promise.all([
      this.loadFirstPage(),
      this.loadOverview(),
      store.loadOptions().then(function (o) { that.setData({ options: o }) })
    ])

    this.setData({ loggedIn: true, loading: false })
    if (done) done()
  },

  async loadOverview() {
    const o = await store.overview()
    this.setData({
      overview: {
        monthExpenseText: util.money(o.monthExpense || 0),
        monthIncomeText: util.money(o.monthIncome || 0),
        todayExpenseText: util.money(o.todayExpense || 0),
        todayIncomeText: util.money(o.todayIncome || 0)
      },
      monthLabel: util.monthLabel(Date.now())
    })
  },

  currentFilter() {
    const f = this.data.filter
    return { type: f.type, category: f.category, keyword: this.data.keyword }
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

  /* ------------------------- 筛选 ------------------------- */

  onKeyword(e) {
    this.setData({ keyword: e.detail.value })
  },

  clearKeyword() {
    this.setData({ keyword: '' })
    this.reload()
  },

  toggleFilter() {
    this.setData({ showFilter: !this.data.showFilter })
  },

  onFilterType(e) {
    this.setData({ 'filter.type': e.currentTarget.dataset.type })
  },

  onFilterCategory(e) {
    this.setData({ 'filter.category': e.currentTarget.dataset.cat })
  },

  applyFilter() {
    this.setData({ showFilter: false })
    this.reload()
  },

  resetFilter() {
    this.setData({ filter: { type: '', category: '' }, keyword: '' })
    this.reload()
  },

  async reload() {
    const f = this.data.filter
    const active = !!(f.type || f.category || this.data.keyword)
    this.setData({ filterActive: active, loading: true, nextCursor: null })
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

  goCharts() {
    wx.switchTab({ url: '/pages/charts/charts' })
  },

  goMe() {
    wx.switchTab({ url: '/pages/me/me' })
  }
})

/** 按「天」分组，并在组标题右侧显示当天收支 */
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
    const parts = []
    if (g.expense > 0) parts.push('支出 ' + util.money(g.expense))
    if (g.income > 0) parts.push('收入 ' + util.money(g.income))
    g.summary = parts.join(' · ')
  })
  return out
}
