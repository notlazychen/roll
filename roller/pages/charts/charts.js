const store = require('../../utils/store')
const util = require('../../utils/util')

// 分类配色：与 Web 端环形图同一套品牌绿梯度，浅色主题下对比度足够
const PIE_COLORS = ['#1F8A70', '#2BAE8A', '#5CC9A7', '#9BD9C4', '#C8E9DD', '#8AA0A8', '#C4CCD2']

Page({
  data: {
    tabs: [
      { key: 'week', label: '周' },
      { key: 'month', label: '月' },
      { key: 'year', label: '年' }
    ],
    tab: 'month',
    canNext: false,

    rangeLabel: '',
    rangeSub: '',
    from: 0,
    to: 0,

    summary: { incomeText: '0.00', expenseText: '0.00', balanceText: '0.00', count: 0, avgText: '0.00', balanceHint: '' },

    pieType: 'expense',
    pieItems: [],
    pieStyle: '',

    days: [],
    hasDayData: false,

    channels: []
  },

  onLoad() {
    this.anchor = Date.now()
    this.bindChart()
  },

  onShow() {
    if (this._loaded && !getApp().globalData.dirty) return
    this._loaded = true
    getApp().globalData.dirty = false
    this.anchor = Date.now()
    this.load()
  },

  /* ------------------------- 区间计算 ------------------------- */

  /** 根据 tab 与锚点日期，算出左闭右开的 [from, to) */
  computeRange() {
    const a = new Date(this.anchor)
    let from, to, label, sub

    if (this.data.tab === 'week') {
      from = util.startOfWeek(a.getTime())
      to = new Date(from)
      to.setDate(to.getDate() + 7)
      to = to.getTime()
      const f = new Date(from), t = new Date(to - 86400000)
      label = '本周'
      sub = (f.getMonth() + 1) + '/' + f.getDate() + ' - ' + (t.getMonth() + 1) + '/' + t.getDate()
      if (util.startOfWeek(Date.now()) !== from) {
        const isThisYear = f.getFullYear() === new Date().getFullYear()
        label = isThisYear ? '' : f.getFullYear() + '年'
        sub = (f.getMonth() + 1) + '/' + f.getDate() + ' - ' + (t.getMonth() + 1) + '/' + t.getDate()
      }
    } else if (this.data.tab === 'month') {
      from = new Date(a.getFullYear(), a.getMonth(), 1).getTime()
      to = new Date(a.getFullYear(), a.getMonth() + 1, 1).getTime()
      label = a.getFullYear() + '年' + (a.getMonth() + 1) + '月'
      const days = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate()
      sub = '共 ' + days + ' 天'
    } else {
      from = new Date(a.getFullYear(), 0, 1).getTime()
      to = new Date(a.getFullYear() + 1, 0, 1).getTime()
      label = a.getFullYear() + '年'
      sub = '全年收支'
    }

    // 不能翻到未来
    const now = Date.now()
    this.setData({ from: from, to: to, rangeLabel: label, rangeSub: sub, canNext: to < now })
  },

  onTab(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.tab) return
    this.anchor = Date.now()
    this.setData({ tab: key })
    this.load()
  },

  shift(direction) {
    const a = new Date(this.anchor)
    if (this.data.tab === 'week') a.setDate(a.getDate() + 7 * direction)
    else if (this.data.tab === 'month') a.setMonth(a.getMonth() + direction)
    else a.setFullYear(a.getFullYear() + direction)
    this.anchor = a.getTime()
    this.load()
  },

  prevRange() {
    this.shift(-1)
  },

  nextRange() {
    if (!this.data.canNext) return
    this.shift(1)
  },

  /* ------------------------- 数据 ------------------------- */

  async load() {
    this.computeRange()

    if (!store.isLoggedIn()) {
      try { await store.ensureLogin() } catch (e) {}
      if (!store.isLoggedIn()) {
        this.setData({ pieItems: [], channels: [], hasDayData: false })
        return
      }
    }

    wx.showLoading({ title: '加载中', mask: false })
    const that = this
    const [rep, channels] = await Promise.all([
      store.report(this.data.from, this.data.to),
      store.channelRanking(this.data.from, this.data.to)
    ])
    wx.hideLoading()

    if (!rep) {
      this.setData({ days: [], hasDayData: false, pieItems: [] })
      return
    }

    that._report = rep
    const dayCount = (rep.days || []).length
    const dailyAvg = dayCount > 0 ? Math.round(rep.expense / dayCount) : 0
    that.setData({
      summary: {
        incomeText: rep.incomeText,
        expenseText: rep.expenseText,
        balanceText: rep.balanceText,
        count: rep.count || 0,
        avgText: util.money(dailyAvg),
        balanceHint: rep.balance >= 0 ? '有结余，继续保持' : '支出超过收入'
      },
      days: rep.days,
      hasDayData: rep.days.some(function (d) { return d.income > 0 || d.expense > 0 }),
      channels: (channels || []).map(function (c) {
        const total = rep.expense || 0
        return {
          name: c.name,
          shortName: c.name.indexOf('/') >= 0 ? c.name.split('/')[1] : c.name,
          amountText: c.amountText,
          count: c.count,
          ratio: c.ratio,
          percentText: total > 0 ? ((c.amount / total) * 100).toFixed(1) + '%' : '0.0%'
        }
      })
    })

    this.buildPie()
    this.drawChart()
  },

  onPieType(e) {
    const type = e.currentTarget.dataset.type
    if (type === this.data.pieType) return
    this.setData({ pieType: type })
    this.buildPie()
  },

  /** 用 conic-gradient 画环形饼图：不依赖 canvas，任何机型都清晰 */
  buildPie() {
    const rep = this._report
    if (!rep) return
    const src = this.data.pieType === 'income' ? rep.incomeCategories : rep.categories

    let acc = 0
    const items = src.slice(0, 6).map(function (c, i) {
      return {
        name: c.name,
        amountText: c.amountText,
        count: c.count,
        percent: c.percent,
        percentText: c.percentText,
        color: PIE_COLORS[i % PIE_COLORS.length]
      }
    })

    // 超过 6 类时把剩下的合并成「其他」，和 Web 环形图口径一致
    const rest = src.slice(6)
    if (rest.length > 0) {
      const amount = rest.reduce(function (s, c) { return s + c.amount }, 0)
      const total = src.reduce(function (s, c) { return s + c.amount }, 0)
      items.push({
        name: '其他',
        amountText: util.money(amount),
        count: rest.reduce(function (s, c) { return s + c.count }, 0),
        percent: total > 0 ? amount / total : 0,
        percentText: (total > 0 ? (amount / total) * 100 : 0).toFixed(1) + '%',
        color: PIE_COLORS[6 % PIE_COLORS.length]
      })
    }

    if (items.length === 0) {
      this.setData({ pieItems: [], pieStyle: '' })
      return
    }

    const total = items.reduce(function (s, c) { return s + c.percent }, 0) || 1
    const stops = []
    items.forEach(function (it) {
      const start = (acc / total) * 100
      acc += it.percent
      const end = (acc / total) * 100
      stops.push(it.color + ' ' + start.toFixed(2) + '% ' + end.toFixed(2) + '%')
    })

    this.setData({
      pieItems: items,
      pieStyle: 'background: conic-gradient(' + stops.join(', ') + ');'
    })
  },

  /* ------------------------- 折线图（Canvas 2D） ------------------------- */

  bindChart() {
    this.createSelectorQuery()
      .select('#lineChart')
      .fields({ node: true, size: true })
      .exec((res) => {
        const item = res && res[0]
        if (!item || !item.node) return
        const canvas = item.node
        const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio) || 2
        canvas.width = item.width * dpr
        canvas.height = item.height * dpr
        const ctx = canvas.getContext('2d')
        ctx.scale(dpr, dpr)
        this._chart = { canvas: canvas, ctx: ctx, w: item.width, h: item.height }
        this.drawChart()
      })
  },

  drawChart() {
    const chart = this._chart
    if (!chart) return
    const { ctx, w, h } = chart
    const days = this.data.days || []

    ctx.clearRect(0, 0, w, h)
    if (days.length === 0) return

    const padL = 8, padR = 8, padT = 14, padB = 26
    const plotW = w - padL - padR
    const plotH = h - padT - padB

    const maxVal = Math.max(
      1,
      ...days.map(function (d) { return Math.max(d.income, d.expense) })
    )
    // 纵轴取整到好看的刻度
    const step = niceStep(maxVal / 3)
    const top = Math.ceil(maxVal / step) * step

    const xOf = function (i) {
      return days.length === 1 ? padL + plotW / 2 : padL + (plotW * i) / (days.length - 1)
    }
    const yOf = function (v) {
      return padT + plotH - (v / top) * plotH
    }

    // 横向网格 + 纵轴刻度（元）
    ctx.lineWidth = 1
    ctx.font = '10px -apple-system, sans-serif'
    ctx.textBaseline = 'middle'
    for (let k = 0; k <= 3; k++) {
      const v = (top / 3) * k
      const y = yOf(v)
      ctx.beginPath()
      ctx.strokeStyle = k === 0 ? '#E5E8E3' : '#F1F3EF'
      ctx.moveTo(padL, y)
      ctx.lineTo(w - padR, y)
      ctx.stroke()

      ctx.fillStyle = '#B4B9B0'
      ctx.textAlign = 'right'
      ctx.fillText(shortYuan(v), w - padR, y - 7)
    }

    // 横轴日期标签：最多标 6 个，避免重叠
    const labelCount = Math.min(6, days.length)
    ctx.textAlign = 'center'
    ctx.fillStyle = '#9AA096'
    for (let k = 0; k < labelCount; k++) {
      const i = Math.round((days.length - 1) * (k / Math.max(1, labelCount - 1)))
      const x = xOf(i)
      const text = days[i].label
      const align = i === 0 ? 'left' : (i === days.length - 1 ? 'right' : 'center')
      ctx.textAlign = align
      ctx.fillText(text, align === 'left' ? padL : (align === 'right' ? w - padR : x), h - 10)
    }

    // 两条曲线（颜色与 Web 折线图一致）
    this.drawLine(ctx, days.map(function (d) { return d.expense }), xOf, yOf, '#E05B4A', 'rgba(224,91,74,0.10)')
    this.drawLine(ctx, days.map(function (d) { return d.income }), xOf, yOf, '#1F8A70', 'rgba(31,138,112,0.10)')
  },

  drawLine(ctx, values, xOf, yOf, color, fill) {
    if (!values.length) return

    // 面积
    ctx.beginPath()
    ctx.moveTo(xOf(0), yOf(0))
    values.forEach(function (v, i) { ctx.lineTo(xOf(i), yOf(v)) })
    ctx.lineTo(xOf(values.length - 1), yOf(0))
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()

    // 折线
    ctx.beginPath()
    values.forEach(function (v, i) {
      const x = xOf(i), y = yOf(v)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke()

    // 数据点：天数太多时不画，避免糊成一团
    if (values.length <= 16) {
      ctx.fillStyle = '#FFFFFF'
      values.forEach(function (v, i) {
        ctx.beginPath()
        ctx.arc(xOf(i), yOf(v), 2.6, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = color
        ctx.lineWidth = 1.6
        ctx.stroke()
      })
    }
  }
})

/** 取「好看」的刻度步长：1 / 2 / 5 × 10^n（单位：分） */
function niceStep(raw) {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))))
  const n = raw / pow
  const base = n <= 1 ? 1 : (n <= 2 ? 2 : (n <= 5 ? 5 : 10))
  return base * pow
}

/** 纵轴刻度文字：小于 100 元用元，超过用「万」 */
function shortYuan(cents) {
  const yuan = cents / 100
  if (yuan >= 10000) return (yuan / 10000).toFixed(yuan % 10000 === 0 ? 0 : 1) + '万'
  if (yuan >= 100) return Math.round(yuan) + ''
  return yuan.toFixed(0)
}
