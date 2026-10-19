/**
 * 数据层（统一入口）
 * ---------------------------------------------------------------
 * 页面只 require 这一个文件。除了网络请求，还负责把服务端的
 * 「分 / 时间戳」原始结构整理成页面直接能渲染的形状（图标、金额文案、日期分组）。
 *
 * 约定：
 *   - 写入类返回 { ok, error?, ... }
 *   - 读取类失败时返回兜底值（[] / null / {}），并节流提示一次
 *   - 金额在数据层内部一律是「分」，只有 *_text 字段才是给人看的字符串
 */

const api = require('./api')
const util = require('./util')

/* ------------------------- 当前用户 ------------------------- */

function getMe() {
  const u = api.getUser()
  if (!u || !u.id) return { uid: 0, name: '', avatarUrl: '', tagAutoEnabled: true }
  return {
    uid: u.id,
    name: u.nickName || '',
    avatarUrl: u.avatarUrl || '',
    tagAutoEnabled: u.tagAutoEnabled !== false
  }
}

function isLoggedIn() {
  return !!api.getToken() && !!api.getUser()
}

function ensureLogin(force) {
  return api.ensureLogin(force)
}

function logout() {
  api.logout()
}

/** 本地直接更新缓存里的用户字段（服务端已保存后调用，避免再请求一次） */
function patchLocalUser(patch) {
  const u = api.getUser() || {}
  for (const k in patch) u[k] = patch[k]
  api.setUser(u)
  return getMe()
}

/* ------------------------- 账号 ------------------------- */

async function fetchMe() {
  const res = await api.callValue('GET', '/api/me', undefined, null)
  if (!res || res.ok === false) return null
  if (res.user) {
    api.setUser(res.user)
    if (api.getUser() && api.getUser().devKey) {
      // 开发身份要保留 deviceKey，否则下次冷启动会变成另一个账号
      const u = api.getUser()
      u.devKey = api.getUser().devKey
      api.setUser(u)
    }
  }
  return { user: getMe(), stats: res.stats || { entryCount: 0, firstRecordAt: 0 } }
}

/** 改昵称 / 头像 / 标签自动识别开关 */
async function updateProfile(patch) {
  const body = {}
  if (patch && patch.nickName !== undefined) body.nickName = String(patch.nickName).trim()
  if (patch && patch.avatarUrl !== undefined) body.avatarUrl = patch.avatarUrl
  if (patch && patch.tagAutoEnabled !== undefined) body.tagAutoEnabled = !!patch.tagAutoEnabled

  if (body.nickName !== undefined && !body.nickName) return { ok: false, error: '昵称不能为空' }

  const res = await api.call('PUT', '/api/me', body)
  if (!res || res.ok === false) return res || { ok: false, error: '保存失败' }

  const prev = api.getUser() || {}
  const merged = res.user || {}
  if (prev.devKey) merged.devKey = prev.devKey
  if (prev.devName) merged.devName = merged.nickName
  api.setUser(merged)

  return { ok: true, user: getMe() }
}

/* ------------------------- 账目 ------------------------- */

/** 服务端账目 → 页面用的形状 */
function decorate(e) {
  const isIncome = e.type === 'income'
  return {
    id: e.id,
    type: e.type,
    isIncome: isIncome,
    amount: e.amount,
    amountText: util.money(e.amount),
    signedText: util.money(e.amount, isIncome ? 'in' : 'out'),
    category: e.category,
    icon: util.categoryIcon(e.category),
    channel: e.channel || '',
    consumer: e.consumer || '',
    account: e.account || '',
    tradeAt: e.tradeAt,
    createdAt: e.createdAt,
    remark: e.remark || '',
    tags: Array.isArray(e.tags) ? e.tags : [],
    timeText: util.formatTime(e.tradeAt),
    dateText: util.monthDay(e.tradeAt),
    dateKey: util.dateKey(e.tradeAt),
    dayLabel: util.dayLabel(e.tradeAt),
    createdText: util.fromNow(e.createdAt)
  }
}

/**
 * 明细列表（游标分页）。
 * filter: { type, category, from, to, keyword }
 */
async function listEntries(filter, cursor, limit) {
  const f = filter || {}
  const path = '/api/entries' + api.qs({
    type: f.type,
    category: f.category,
    from: f.from,
    to: f.to,
    keyword: f.keyword,
    cursor: cursor,
    limit: limit || 30
  })
  const res = await api.callValue('GET', path, undefined, null)
  if (!res) return { items: [], hasMore: false, nextCursor: null }
  return {
    items: (res.items || []).map(decorate),
    hasMore: !!res.hasMore,
    nextCursor: res.nextCursor || null
  }
}

async function getEntry(id) {
  const res = await api.callValue('GET', '/api/entries/' + Number(id), undefined, null)
  if (!res || res.ok === false || !res.entry) return null
  return decorate(res.entry)
}

/** 把页面上的表单（金额是元字符串）整理成接口需要的结构（金额是分） */
function buildPayload(form) {
  const cents = util.toCents(form.amount)
  if (!isFinite(cents) || cents <= 0) return { ok: false, error: '请输入正确的金额' }

  return {
    ok: true,
    body: {
      type: form.type === 'income' ? 'income' : 'expense',
      amount: cents,
      category: form.category,
      channel: form.channel || null,
      consumer: form.consumer || null,
      account: form.account || null,
      tradeAt: Number(form.tradeAt) || Date.now(),
      remark: form.remark || '',
      tags: Array.isArray(form.tags) ? form.tags : []
    }
  }
}

async function createEntry(form) {
  const p = buildPayload(form)
  if (!p.ok) return p
  const res = await api.call('POST', '/api/entries', p.body)
  if (!res || res.ok === false) return res || { ok: false, error: '保存失败' }
  return { ok: true, entry: decorate(res.entry) }
}

async function updateEntry(id, form) {
  const p = buildPayload(form)
  if (!p.ok) return p
  const res = await api.call('PUT', '/api/entries/' + Number(id), p.body)
  if (!res || res.ok === false) return res || { ok: false, error: '保存失败' }
  return { ok: true, entry: decorate(res.entry) }
}

async function deleteEntry(id) {
  const res = await api.call('DELETE', '/api/entries/' + Number(id))
  return res || { ok: false, error: '删除失败' }
}

/** 备注标签预分析：返回自动命中的标签名数组 */
async function previewTags(remark) {
  const res = await api.call('POST', '/api/entries/tags/preview', { type: 'expense', amount: 1, remark: remark || '' })
  if (!res || res.ok === false) return []
  return res.tags || []
}

/** 概览：今日 / 本月收支 */
async function overview() {
  const res = await api.callValue('GET', '/api/stats/overview', undefined, null)
  if (!res) return { todayExpense: 0, todayIncome: 0, monthExpense: 0, monthIncome: 0, entryCount: 0 }
  return res
}

/* ------------------------- 报表 ------------------------- */

function decorateStat(s, total) {
  return {
    name: s.name,
    amount: s.amount,
    amountText: util.money(s.amount),
    count: s.count,
    percent: total > 0 ? s.amount / total : 0,
    percentText: (total > 0 ? (s.amount / total) * 100 : 0).toFixed(1) + '%'
  }
}

async function report(from, to) {
  const res = await api.callValue('GET', '/api/reports' + api.qs({ from: from, to: to, tz: util.tzOffset() }), undefined, null)
  if (!res) return null

  const income = res.income || 0
  const expense = res.expense || 0
  const days = (res.days || []).map(function (d) {
    return {
      date: d.date,
      label: String(d.date).slice(5).replace('-', '/'),
      income: d.income,
      expense: d.expense,
      incomeText: util.money(d.income),
      expenseText: util.money(d.expense)
    }
  })

  return {
    from: from,
    to: to,
    income: income,
    expense: expense,
    balance: income - expense,
    count: res.count || 0,
    incomeText: util.money(income),
    expenseText: util.money(expense),
    balanceText: util.money(income - expense),
    categories: (res.categories || []).map(function (c) { return decorateStat(c, expense) }),
    incomeCategories: (res.incomeCategories || []).map(function (c) { return decorateStat(c, income) }),
    days: days
  }
}

async function channelRanking(from, to) {
  const res = await api.callValue('GET', '/api/reports/channels' + api.qs({ from: from, to: to, tz: util.tzOffset() }), undefined, null)
  if (!res || !res.items) return []
  const top = res.items[0] ? res.items[0].amount : 0
  return res.items.map(function (it) {
    return {
      name: it.name,
      amount: it.amount,
      amountText: util.money(it.amount),
      count: it.count,
      ratio: top > 0 ? it.amount / top : 0
    }
  })
}

/* ------------------------- 选项源 ------------------------- */

const OPTION_LABELS = {
  category: '分类',
  channel: '渠道',
  consumer: '消费者',
  account: '账户',
  tag: '标签'
}

/** 拉取选项源，并补上图标等展示字段 */
async function loadOptions() {
  const res = await api.callValue('GET', '/api/options', undefined, null)
  if (!res || !res.options) {
    return { categories: [], channels: [], channelGroups: [], consumers: [], accounts: [], tags: [] }
  }
  const o = res.options

  function dec(list) {
    return (list || []).map(function (it) {
      return {
        id: it.id,
        kind: it.kind,
        name: it.name,
        parent: it.parent || '',
        isPreset: !!it.isPreset,
        // 渠道显示的是「/」后面那段
        shortName: it.kind === 'channel' && it.name.indexOf('/') >= 0 ? it.name.split('/')[1] : it.name,
        icon: it.kind === 'category' ? util.categoryIcon(it.name) : ''
      }
    })
  }

  return {
    categories: dec(o.categories),
    channels: dec(o.channels),
    channelGroups: (o.channelGroups || []).map(function (g) {
      return { parent: g.parent, items: dec(g.items) }
    }),
    consumers: dec(o.consumers),
    accounts: dec(o.accounts),
    tags: dec(o.tags)
  }
}

/** 新增选项：渠道要带 parent（分类名） */
async function addOption(kind, name, parent) {
  const res = await api.call('POST', '/api/options', { kind: kind, name: name, parent: parent || null })
  if (!res || res.ok === false) return res || { ok: false, error: '添加失败' }
  return { ok: true, option: res.option }
}

async function renameOption(id, name) {
  const res = await api.call('PUT', '/api/options/' + Number(id), { kind: '', name: name })
  if (!res || res.ok === false) return res || { ok: false, error: '保存失败' }
  return { ok: true, option: res.option }
}

async function deleteOption(id) {
  const res = await api.call('DELETE', '/api/options/' + Number(id))
  return res || { ok: false, error: '删除失败' }
}

async function moveOption(id, direction) {
  return api.call('POST', '/api/options/' + Number(id) + '/move' + api.qs({ direction: direction }))
}

/** 各选项被账目使用的次数，key 是选项 id */
async function optionUsage() {
  const res = await api.callValue('GET', '/api/options/usage', undefined, null)
  const map = {}
  const raw = (res && res.usage) || {}
  Object.keys(raw).forEach(function (k) {
    map[Number(k)] = Number(raw[k]) || 0
  })
  return map
}

/* ------------------------- 标签规则 ------------------------- */

async function listTagRules() {
  const res = await api.callValue('GET', '/api/tag-rules', undefined, null)
  return (res && res.rules) || []
}

async function addTagRule(keyword, tag) {
  const res = await api.call('POST', '/api/tag-rules', { keyword: keyword, tag: tag })
  if (!res || res.ok === false) return res || { ok: false, error: '添加失败' }
  return { ok: true, rule: res.rule }
}

async function deleteTagRule(id) {
  const res = await api.call('DELETE', '/api/tag-rules/' + Number(id))
  return res || { ok: false, error: '删除失败' }
}

module.exports = {
  OPTION_LABELS,
  getMe,
  isLoggedIn,
  ensureLogin,
  logout,
  patchLocalUser,
  fetchMe,
  updateProfile,

  listEntries,
  getEntry,
  createEntry,
  updateEntry,
  deleteEntry,
  previewTags,
  overview,

  report,
  channelRanking,

  loadOptions,
  addOption,
  renameOption,
  deleteOption,
  moveOption,
  optionUsage,

  listTagRules,
  addTagRule,
  deleteTagRule,

  envInfo: function () {
    return { env: api.config.env, baseUrl: api.config.baseUrl, allowDevLogin: api.config.allowDevLogin }
  }
}
