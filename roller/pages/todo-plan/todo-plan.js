const api = require('../../utils/api')
const util = require('../../utils/util')

const WEEK_SHORT = ['一', '二', '三', '四', '五', '六', '日']

/** 本地今天 yyyy-MM-dd */
function todayStr() {
  const d = new Date()
  const p = function (n) { return (n < 10 ? '0' : '') + n }
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

Page({
  data: {
    // 表单
    editingId: 0,
    title: '',
    type: 'once',
    dueDate: todayStr(),
    weekDays: [],
    weekMap: {},
    startDate: todayStr(),
    busy: false,

    tasks: [],
    loading: true
  },

  onShow() {
    this.load()
  },

  async load() {
    if (!api.getToken()) {
      try { await api.ensureLogin() } catch (e) {}
      if (!api.getToken()) { this.setData({ loading: false, tasks: [] }); return }
    }
    this.setData({ loading: true })
    const list = await api.todoList()
    const tasks = list.map(function (t) {
      return Object.assign({}, t, {
        ruleText: t.type === 'recurring'
          ? ((t.weekDays || []).length === 7 ? '每天' : '每周' + (t.weekDays || []).map(function (w) { return WEEK_SHORT[w - 1] }).join('、')) + ' · 自 ' + (t.startDate || '') + ' 生效'
          : '目标日 ' + (t.dueDate || ''),
        lastText: t.lastCheckIn ? '最近打卡 ' + t.lastCheckIn : '还没打过卡'
      })
    })
    this.setData({ tasks: tasks, loading: false })
  },

  onTitle(e) { this.setData({ title: e.detail.value }) },
  onDueDate(e) { this.setData({ dueDate: e.detail.value }) },
  onStartDate(e) { this.setData({ startDate: e.detail.value }) },

  onType(e) {
    this.setData({ type: e.currentTarget.dataset.type })
  },

  onWeekDay(e) {
    const w = Number(e.currentTarget.dataset.w)
    const cur = this.data.weekDays
    const idx = cur.indexOf(w)
    const next = idx >= 0 ? cur.filter(function (x) { return x !== w }) : cur.concat(w).sort(function (a, b) { return a - b })
    const map = {}
    next.forEach(function (x) { map[x] = true })
    this.setData({ weekDays: next, weekMap: map })
  },

  async submit() {
    if (this.data.busy) return
    const title = (this.data.title || '').trim()
    if (!title) { util.toast('请填写任务内容'); return }
    if (this.data.type === 'recurring' && this.data.weekDays.length === 0) {
      util.toast('周期任务请至少选一个重复日')
      return
    }

    const payload = { title: title, type: this.data.type }
    if (this.data.type === 'once') payload.dueDate = this.data.dueDate
    else {
      payload.weekDays = this.data.weekDays
      payload.startDate = this.data.startDate
    }

    this.setData({ busy: true })
    const res = await api.todoSave(this.data.editingId || 0, payload)
    this.setData({ busy: false })
    if (!res || !res.ok) {
      util.toast((res && res.error) || '保存失败')
      return
    }
    util.toast(this.data.editingId ? '已保存' : '已创建', 'success')
    this.resetForm()
    this.load()
  },

  edit(e) {
    const id = e.currentTarget.dataset.id
    const t = this.data.tasks.find(function (x) { return x.id === id })
    if (!t) return
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
    this.setData({
      editingId: t.id,
      title: t.title,
      type: t.type,
      dueDate: t.dueDate || todayStr(),
      weekDays: t.weekDays || [],
      weekMap: (function (arr) { const m = {}; (arr || []).forEach(function (x) { m[x] = true }); return m })(t.weekDays),
      startDate: t.startDate || todayStr()
    })
  },

  cancelEdit() {
    this.resetForm()
  },

  resetForm() {
    this.setData({ editingId: 0, title: '', type: 'once', weekDays: [], weekMap: {}, dueDate: todayStr(), startDate: todayStr() })
  },

  async remove(e) {
    const id = e.currentTarget.dataset.id
    const t = this.data.tasks.find(function (x) { return x.id === id })
    const ok = await util.confirm('删除任务', '删除「' + (t ? t.title : '') + '」？它的打卡记录也会一并删除。', '删除')
    if (!ok) return
    const res = await api.todoRemove(id)
    if (!res || !res.ok) {
      util.toast((res && res.error) || '删除失败')
      return
    }
    if (this.data.editingId === id) this.resetForm()
    this.load()
  }
})
