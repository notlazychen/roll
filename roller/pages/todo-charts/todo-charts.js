const api = require('../../utils/api')
const util = require('../../utils/util')

Page({
  data: {
    loading: true,
    totalText: '0',
    recurringCount: 0,
    pendingOnceCount: 0,
    bars: [],
    ranking: [],
    hasRanking: false
  },

  onShow() {
    this.load()
  },

  async load() {
    if (!api.getToken()) {
      try { await api.ensureLogin() } catch (e) {}
      if (!api.getToken()) { this.setData({ loading: false }); return }
    }

    this.setData({ loading: true })
    const s = await api.todoStats(14)
    if (!s) { this.setData({ loading: false }); return }

    const maxDaily = Math.max.apply(null, [1].concat((s.daily || []).map(function (d) { return d.count })))
    const bars = (s.daily || []).map(function (d) {
      const day = new Date(d.day + 'T00:00:00')
      return {
        day: d.day,
        label: String(day.getDate()),
        count: d.count,
        heightPct: Math.round((d.count / maxDaily) * 100),
        hot: d.count > 0 && d.count === maxDaily
      }
    })

    const maxRank = s.ranking && s.ranking.length > 0 ? Math.max(1, s.ranking[0].count) : 1
    const ranking = (s.ranking || []).map(function (t, i) {
      return Object.assign({}, t, {
        fillPct: Math.round((t.count / maxRank) * 100),
        top3: i < 3
      })
    })

    this.setData({
      loading: false,
      totalText: String(s.totalCheckins || 0),
      recurringCount: s.recurringCount || 0,
      pendingOnceCount: s.pendingOnceCount || 0,
      bars: bars,
      ranking: ranking,
      hasRanking: ranking.length > 0
    })
  }
})
