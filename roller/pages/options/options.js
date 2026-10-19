const store = require('../../utils/store')
const util = require('../../utils/util')

const KINDS = [
  { key: 'category', label: '分类' },
  { key: 'channel', label: '渠道' },
  { key: 'consumer', label: '消费者' },
  { key: 'account', label: '账户' },
  { key: 'tag', label: '标签' }
]

const HEAD_SUB = {
  category: '记账时可选的分类，新增后立即生效',
  channel: '渠道挂在分类下，如「餐饮 / 肯德基」',
  consumer: '这笔钱为谁花的，可多选场景',
  account: '钱从哪个账户出，如支付宝、微信',
  tag: '用关键词从备注里自动识别，也可手动选择'
}

Page({
  data: {
    kinds: KINDS,
    kind: 'category',
    kindLabel: '分类',
    headSub: '',

    items: [],
    groups: [],
    rules: [],
    options: { categories: [], tags: [] },

    // 新增 / 改名
    showEdit: false,
    editingId: 0,
    editName: '',
    addParent: '',

    // 规则
    showRule: false,
    ruleKeyword: '',
    ruleTag: ''
  },

  onLoad(query) {
    const kind = (query && query.kind) || 'category'
    this.applyKind(KINDS.some(function (k) { return k.key === kind }) ? kind : 'category')
  },

  onShow() {
    if (!this._loaded) { this._loaded = true; return }
    this.load()
  },

  applyKind(kind) {
    const label = (KINDS.filter(function (k) { return k.key === kind })[0] || {}).label || '分类'
    this.setData({ kind: kind, kindLabel: label, headSub: HEAD_SUB[kind] || '' })
    wx.setNavigationBarTitle({ title: label + '管理' })
    this.load()
  },

  onKind(e) {
    const kind = e.currentTarget.dataset.key
    if (kind === this.data.kind) return
    this.applyKind(kind)
  },

  async load() {
    const that = this
    const options = await store.loadOptions()
    const usage = await store.optionUsage()
    that.setData({ options: options })

    const kind = this.data.kind
    const source = {
      category: options.categories,
      consumer: options.consumers,
      account: options.accounts,
      tag: options.tags
    }[kind] || []

    const items = source.map(function (it) {
      return Object.assign({}, it, { used: usage[it.id] || 0 })
    })

    if (kind === 'channel') {
      const groups = options.channelGroups.map(function (g) {
        return {
          parent: g.parent,
          items: g.items.map(function (it) {
            return Object.assign({}, it, { used: usage[it.id] || 0 })
          })
        }
      })
      that.setData({ groups: groups, items: [] })
    } else {
      that.setData({ items: items, groups: [] })
    }

    if (kind === 'tag') {
      const rules = await store.listTagRules()
      that.setData({
        rules: rules.map(function (r) {
          return {
            id: r.id,
            tag: r.tag,
            keywordText: String(r.keyword).split('|').filter(Boolean).join('、')
          }
        })
      })
    }
  },

  /* ------------------------- 新增 / 改名 ------------------------- */

  openAdd() {
    const addParent = this.data.addParent || (this.data.kind === 'channel'
      ? ((this.data.options.categories[0] || {}).name || '')
      : '')
    this.setData({ showEdit: true, editingId: 0, editName: '', addParent: addParent })
  },

  pickParent(e) {
    this.setData({ addParent: e.currentTarget.dataset.parent })
  },

  rename(e) {
    this.setData({
      showEdit: true,
      editingId: Number(e.currentTarget.dataset.id),
      editName: e.currentTarget.dataset.name || ''
    })
  },

  closeEdit() {
    this.setData({ showEdit: false })
  },

  noop() {},

  onEditName(e) {
    this.setData({ editName: e.detail.value })
  },

  async submitEdit() {
    const name = String(this.data.editName || '').trim()
    if (!name) return util.toast('请输入名称')

    let res
    if (this.data.editingId) {
      res = await store.renameOption(this.data.editingId, name)
    } else {
      if (this.data.kind === 'channel' && !this.data.addParent) return util.toast('请选择所属分类')
      res = await store.addOption(this.data.kind, name, this.data.kind === 'channel' ? this.data.addParent : '')
    }

    if (!res.ok) return util.toast(res.error || '保存失败')

    this.setData({ showEdit: false })
    util.haptic()
    util.toast(this.data.editingId ? '已改名' : '已添加', 'success')
    getApp().markDirty()
    this.load()
  },

  /* ------------------------- 删除 ------------------------- */

  async remove(e) {
    const id = Number(e.currentTarget.dataset.id)
    const name = e.currentTarget.dataset.name
    const used = Number(e.currentTarget.dataset.used) || 0

    if (used > 0) {
      return util.toast('已被 ' + used + ' 条账目使用，不能删除')
    }

    const ok = await util.confirm('删除选项', '删除「' + name + '」后，记账时就不再出现这个选项了。', '删除')
    if (!ok) return

    const res = await store.deleteOption(id)
    if (!res.ok) return util.toast(res.error || '删除失败')

    getApp().markDirty()
    this.load()
  },

  /* ------------------------- 标签规则 ------------------------- */

  openRule() {
    this.setData({ showRule: true, ruleKeyword: '', ruleTag: '' })
  },

  closeRule() {
    this.setData({ showRule: false })
  },

  onRuleKeyword(e) {
    this.setData({ ruleKeyword: e.detail.value })
  },

  pickRuleTag(e) {
    this.setData({ ruleTag: e.currentTarget.dataset.name })
  },

  async submitRule() {
    const kw = String(this.data.ruleKeyword || '').trim()
    if (!kw) return util.toast('请输入关键词')
    if (!this.data.ruleTag) return util.toast('请选择标签')

    const res = await store.addTagRule(kw, this.data.ruleTag)
    if (!res.ok) return util.toast(res.error || '保存失败')

    this.setData({ showRule: false })
    util.toast('规则已添加', 'success')
    this.load()
  },

  async removeRule(e) {
    const id = Number(e.currentTarget.dataset.id)
    const ok = await util.confirm('删除规则', '删除后，备注里的对应关键词不再自动打标签。', '删除')
    if (!ok) return
    const res = await store.deleteTagRule(id)
    if (!res.ok) return util.toast(res.error || '删除失败')
    this.load()
  }
})
