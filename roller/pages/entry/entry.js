const store = require('../../utils/store')
const util = require('../../utils/util')

const SHEET_TITLES = {
  channel: '选择渠道',
  consumer: '选择消费者',
  account: '选择账户',
  tag: '选择标签',
  time: '交易时间'
}

const KIND_LABELS = {
  category: '分类',
  channel: '渠道',
  consumer: '消费者',
  account: '账户',
  tag: '标签'
}

Page({
  data: {
    isEdit: false,
    editId: 0,
    autoFocus: false,

    form: {
      type: 'expense',
      amount: '',
      category: '',
      channel: '',
      consumer: '',
      account: '',
      tradeAt: 0,
      remark: '',
      tags: []
    },

    options: { categories: [], channels: [], channelGroups: [], consumers: [], accounts: [], tags: [] },
    categories: [],
    tradeText: '',
    dateValue: '',
    timeValue: '12:00',

    amountTip: '',
    autoTags: [],
    channelShort: '',

    // 弹层
    sheet: '',
    sheetTitle: '',
    sheetLabel: '',
    sheetItems: [],
    channelGroup: '',
    channelItems: [],

    // 新增选项
    showNewOption: false,
    newOptionKind: '',
    newOptionLabel: '',
    newOptionName: ''
  },

  async onLoad(query) {
    const id = Number(query && query.id) || 0
    this.setData({ isEdit: !!id, editId: id, autoFocus: !id })

    const options = await store.loadOptions()
    this.applyOptions(options)

    if (id) {
      wx.setNavigationBarTitle({ title: '账目详情' })
      const entry = await store.getEntry(id)
      if (!entry) {
        util.toast('账目不存在或已删除')
        setTimeout(function () { wx.navigateBack() }, 1200)
        return
      }
      this.setData({
        form: {
          type: entry.type,
          amount: util.yuan(entry.amount),
          category: entry.category,
          channel: entry.channel,
          consumer: entry.consumer,
          account: entry.account,
          tradeAt: entry.tradeAt,
          remark: entry.remark,
          tags: entry.tags.slice()
        }
      })
      this.syncDerived()
      return
    }

    // 新建：默认账户取「支付宝」，分类取第一个，交易时间取现在
    const now = Date.now()
    const patch = { 'form.tradeAt': now }
    if (options.categories.length > 0) patch['form.category'] = options.categories[0].name
    if (options.accounts.some(function (a) { return a.name === '支付宝' })) patch['form.account'] = '支付宝'
    this.setData(patch)
    this.syncDerived()
  },

  /* ------------------------- 选项源 ------------------------- */

  applyOptions(options) {
    this._options = options
    this.setData({ options: options, categories: options.categories })
  },

  /** 选中分类后，渠道只在当前分类下选择；切换分类时清掉不适用的渠道 */
  onCategory(e) {
    const name = e.currentTarget.dataset.name
    const cur = this.data.form.channel
    const stillValid = cur && cur.indexOf(name + '/') === 0
    this.setData({
      'form.category': name,
      'form.channel': stillValid ? cur : '',
      channelGroup: name
    })
    this.syncChannelView()
    this.syncDerived()
  },

  onType(e) {
    const type = e.currentTarget.dataset.type
    this.setData({ 'form.type': type })
  },

  onAmount(e) {
    const v = e.detail.value
    const cents = util.toCents(v)
    let tip = ''
    if (v && (!isFinite(cents) || !/^\d*(\.\d{0,2})?$/.test(v))) tip = '金额最多两位小数'
    this.setData({ 'form.amount': v, amountTip: tip })
  },

  onRemark(e) {
    const remark = e.detail.value
    this.setData({ 'form.remark': remark })
    this.scheduleAnalyze(remark)
  },

  /** 备注边输边分析：节流 500ms，避免每个字符都发请求 */
  scheduleAnalyze(remark) {
    const that = this
    if (this._analyzeTimer) clearTimeout(this._analyzeTimer)
    this._analyzeTimer = setTimeout(async function () {
      const auto = await store.previewTags(remark)
      that.setData({ autoTags: auto })
    }, 500)
  },

  /* ------------------------- 弹层：选择 ------------------------- */

  openSheet(e) {
    const kind = e.currentTarget.dataset.kind
    const patch = {
      sheet: kind,
      sheetTitle: SHEET_TITLES[kind] || '',
      sheetLabel: KIND_LABELS[kind] || ''
    }

    if (kind === 'channel') {
      // 默认定位到已选渠道所属分类，没选则用当前分类
      const group = this.data.form.channel
        ? this.data.form.channel.split('/')[0]
        : (this.data.form.category || (this.data.options.channelGroups[0] || {}).parent || '')
      patch.channelGroup = group
      this.setData(patch)
      this.syncChannelView()
      return
    }

    if (kind === 'consumer' || kind === 'account') {
      const key = kind === 'consumer' ? 'consumers' : 'accounts'
      patch.sheetItems = this.data.options[key] || []
      this.setData(patch)
      return
    }

    if (kind === 'time') {
      const ts = this.data.form.tradeAt || Date.now()
      const d = new Date(ts)
      patch.dateValue = util.dateKey(ts)
      patch.timeValue = util.formatTime(ts)
      this.setData(patch)
      return
    }

    this.setData(patch)
  },

  syncChannelView() {
    const group = this.data.channelGroup
    const g = (this.data.options.channelGroups || []).filter(function (x) { return x.parent === group })[0]
    this.setData({ channelItems: (g && g.items) || [] })
  },

  pickChannelGroup(e) {
    this.setData({ channelGroup: e.currentTarget.dataset.parent })
    this.syncChannelView()
  },

  pickOption(e) {
    const name = e.currentTarget.dataset.name
    const kind = this.data.sheet
    const patch = {}
    patch['form.' + kind] = name
    this.setData(patch)
    this.syncDerived()
    this.closeSheet()
  },

  clearValue() {
    const kind = this.data.sheet
    const patch = {}
    patch['form.' + kind] = ''
    this.setData(patch)
    this.syncDerived()
    this.setData({ sheet: '' })
  },

  toggleTag(e) {
    const name = e.currentTarget.dataset.name
    const tags = this.data.form.tags.slice()
    const i = tags.indexOf(name)
    if (i >= 0) tags.splice(i, 1)
    else if (tags.length >= 8) return util.toast('最多 8 个标签')
    else tags.push(name)
    this.setData({ 'form.tags': tags })
  },

  removeTag(e) {
    const name = e.currentTarget.dataset.tag
    this.setData({ 'form.tags': this.data.form.tags.filter(function (t) { return t !== name }) })
  },

  closeSheet() {
    this.setData({ sheet: '' })
  },

  noop() {},

  /* ------------------------- 时间 ------------------------- */

  onDate(e) {
    const d = e.detail.value
    this.setData({ dateValue: d })
    this.composeTime()
  },

  onTime(e) {
    this.setData({ timeValue: e.detail.value })
    this.composeTime()
  },

  quickTime(e) {
    const offset = Number(e.currentTarget.dataset.offset) || 0
    const ts = Date.now() - offset * 3600 * 1000
    this.setData({
      'form.tradeAt': ts,
      dateValue: util.dateKey(ts),
      timeValue: util.formatTime(ts)
    })
    this.syncDerived()
    this.setData({ sheet: '' })
  },

  /** 日期 + 时刻 合成时间戳（iOS 不接受 'YYYY-MM-DD HH:mm'，要用 / 或 T） */
  composeTime() {
    const s = String(this.data.dateValue).replace(/-/g, '/') + ' ' + this.data.timeValue + ':00'
    const ts = new Date(s).getTime()
    if (!isFinite(ts)) return
    this.setData({ 'form.tradeAt': ts })
    this.syncDerived()
  },

  /* ------------------------- 新增选项 ------------------------- */

  newOption(e) {
    const kind = e.currentTarget.dataset.kind
    this.setData({
      showNewOption: true,
      newOptionKind: kind,
      newOptionLabel: KIND_LABELS[kind] || '选项',
      newOptionName: ''
    })
  },

  onNewOptionName(e) {
    this.setData({ newOptionName: e.detail.value })
  },

  closeNewOption() {
    this.setData({ showNewOption: false })
  },

  async submitNewOption() {
    const name = String(this.data.newOptionName || '').trim()
    const kind = this.data.newOptionKind
    if (!name) return util.toast('请输入名称')

    const parent = kind === 'channel' ? (this.data.channelGroup || this.data.form.category) : ''
    if (kind === 'channel' && !parent) return util.toast('请先选择分类')

    const res = await store.addOption(kind, name, parent)
    if (!res.ok) return util.toast(res.error || '添加失败')

    // 重新拉取，保证排序与去重口径和服务端一致
    const options = await store.loadOptions()
    this.applyOptions(options)
    this.setData({ showNewOption: false })

    const full = res.option ? res.option.name : name
    if (kind === 'tag') {
      const tags = this.data.form.tags.slice()
      if (tags.indexOf(full) < 0) tags.push(full)
      this.setData({ 'form.tags': tags })
    } else if (kind === 'channel') {
      this.setData({ 'form.channel': full, channelGroup: parent })
      this.syncChannelView()
      this.syncDerived()
    } else {
      const patch = {}
      patch['form.' + kind] = full
      this.setData(patch)
    }
    util.toast('已添加')
  },

  manageOptions(e) {
    const kind = e.currentTarget.dataset.kind || 'category'
    wx.navigateTo({ url: '/pages/options/options?kind=' + kind })
  },

  /* ------------------------- 派生显示 ------------------------- */

  syncDerived() {
    const f = this.data.form
    const ts = f.tradeAt || Date.now()
    const short = f.channel ? String(f.channel).split('/').pop() : ''
    this.setData({
      tradeText: util.dayLabel(ts) + ' ' + util.formatTime(ts),
      channelShort: short
    })
  },

  /* ------------------------- 保存 / 删除 ------------------------- */

  async save() {
    if (this._saving) return
    const f = this.data.form

    if (!f.category) return util.toast('请选择分类')
    const cents = util.toCents(f.amount)
    if (!isFinite(cents) || cents <= 0) return util.toast('请输入正确的金额')

    // 自动识别出的标签也要一起带上：用户没手动删就保留
    const tags = f.tags.slice()
    this.data.autoTags.forEach(function (t) {
      if (tags.indexOf(t) < 0) tags.push(t)
    })

    const form = {
      type: f.type,
      amount: f.amount,
      category: f.category,
      channel: f.channel,
      consumer: f.consumer,
      account: f.account,
      tradeAt: f.tradeAt || Date.now(),
      remark: f.remark,
      tags: tags
    }

    this._saving = true
    wx.showLoading({ title: '保存中', mask: true })

    const res = this.data.isEdit
      ? await store.updateEntry(this.data.editId, form)
      : await store.createEntry(form)

    wx.hideLoading()
    this._saving = false

    if (!res.ok) return util.toast(res.error || '保存失败')

    util.haptic()
    getApp().markDirty()
    util.toast(this.data.isEdit ? '已保存' : '记账成功', 'success')
    setTimeout(function () { wx.navigateBack() }, 500)
  },

  async remove() {
    const ok = await util.confirm('删除账目', '删除后无法恢复，确定删除这笔账吗？', '删除')
    if (!ok) return

    const res = await store.deleteEntry(this.data.editId)
    if (!res.ok) return util.toast(res.error || '删除失败')

    util.haptic()
    getApp().markDirty()
    util.toast('已删除')
    setTimeout(function () { wx.navigateBack() }, 400)
  }
})
