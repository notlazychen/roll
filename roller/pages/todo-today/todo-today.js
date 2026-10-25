const api = require('../../utils/api')
const util = require('../../utils/util')

const WEEK_LABEL = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']

Page({
  data: {
    loading: true,
    dateText: '',
    total: 0,
    done: 0,
    percent: 0,
    tasks: [],
    busy: false
  },

  onShow() {
    if (!this._loaded || getApp().globalData.dirty) {
      this._loaded = true
      getApp().globalData.dirty = false
    }
    this.load()
  },

  async load() {
    if (!api.getToken()) {
      try { await api.ensureLogin() } catch (e) {}
      if (!api.getToken()) {
        this.setData({ loading: false, tasks: [], total: 0, done: 0 })
        return
      }
    }

    this.setData({ loading: true })
    const data = await api.todoToday()
    if (!data) {
      this.setData({ loading: false })
      return
    }

    const tasks = (data.tasks || []).map(function (t) {
      return Object.assign({}, t, {
        typeLabel: t.type === 'recurring'
          ? ((t.weekDays || []).length === 7 ? '每天' : '每' + (t.weekDays || []).map(function (w) { return WEEK_LABEL[w] }).join('·'))
          : '一次性',
        dueLabel: t.type === 'once' && t.dueDate ? t.dueDate.slice(5).replace('-', '/') : ''
      })
    })

    const d = data.date ? data.date.split('-') : []
    this.setData({
      loading: false,
      tasks: tasks,
      total: data.total || 0,
      done: data.done || 0,
      percent: data.total > 0 ? Math.round(((data.done || 0) / data.total) * 100) : 0,
      dateText: d.length === 3 ? parseInt(d[1], 10) + ' 月 ' + parseInt(d[2], 10) + ' 日 · ' + WEEK_LABEL[this.weekIndex(data.date)] : ''
    })
  },

  weekIndex(dateStr) {
    const p = dateStr.split('-')
    const day = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay()
    return day === 0 ? 7 : day
  },

  /** 打卡 / 撤销打卡：先翻转本地状态，接口幂等，失败回滚重拉 */
  async toggle(e) {
    if (this.data.busy) return
    const id = e.currentTarget.dataset.id
    const done = e.currentTarget.dataset.done
    this.setData({ busy: true })

    const tasks = this.data.tasks.map(function (t) {
      return t.id === id ? Object.assign({}, t, { done: !done, checkedIn: !done }) : t
    })
    this.setData({
      tasks: tasks,
      done: this.data.done + (done ? -1 : 1),
      percent: this.data.total > 0 ? Math.round(((this.data.done + (done ? -1 : 1)) / this.data.total) * 100) : 0
    })

    const res = await api.todoCheckIn(id, done)
    if (!res || !res.ok) {
      util.toast((res && res.error) || '操作失败')
      this.load()
    }
    this.setData({ busy: false })
  },

  goPlan() {
    wx.redirectTo({ url: '/pages/todo-plan/todo-plan' })
  }
})
