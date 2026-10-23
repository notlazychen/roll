/**
 * 记账小程序 · 前后端契约测试
 * ---------------------------------------------------------------
 * 在 Node 里模拟微信小程序的 wx 环境，直接 require 小程序的 utils/，
 * 请求真实的 ASP.NET Core 服务，逐项验证「页面依赖的字段确实存在且类型正确」。
 *
 * 之所以要做这层：页面里大量使用 === 严格比较和 .toFixed/.split 等字符串方法，
 * 一旦前后端字段类型不一致（分 vs 元、数字 vs 字符串），界面会静默不动。
 *
 * 用法：先启动服务端（Development + AllowDevLogin），然后
 *   node roller/tests/ledger-contract.cjs
 * 可用 BASE_URL 覆盖地址，默认读 utils/config.js 的 baseUrl。
 */

const path = require('path')

const MP_ROOT = path.resolve(__dirname, '..')

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')) }
}

/* ------------------------- 模拟 wx 环境 ------------------------- */

const memory = {}

global.wx = {
  getStorageSync: (k) => (k in memory ? JSON.parse(JSON.stringify(memory[k])) : ''),
  setStorageSync: (k, v) => { memory[k] = JSON.parse(JSON.stringify(v)) },
  removeStorageSync: (k) => { delete memory[k] },
  showToast: () => {},
  vibrateShort: () => {},
  login: ({ success }) => {
    // 给一个必然失败的 code，用来验证「微信登录不可用时退化为开发模式登录」
    setTimeout(() => success({ code: 'contract-test-invalid-code' }), 0)
  },
  request: (opt) => {
    const headers = Object.assign({}, opt.header)
    const init = { method: opt.method || 'GET', headers }
    if (opt.data !== undefined && opt.data !== null) init.body = JSON.stringify(opt.data)
    fetch(opt.url, init)
      .then(async (res) => {
        const text = await res.text()
        let data = null
        try { data = text ? JSON.parse(text) : null } catch (e) { data = null }
        opt.success && opt.success({ statusCode: res.status, data, header: {} })
      })
      .catch((e) => opt.fail && opt.fail({ errMsg: 'request:fail ' + e.message }))
  }
}

/* ------------------------- 加载被测模块 ------------------------- */

const config = require(path.join(MP_ROOT, 'utils', 'config.js'))
const util = require(path.join(MP_ROOT, 'utils', 'util.js'))
const api = require(path.join(MP_ROOT, 'utils', 'api.js'))
const store = require(path.join(MP_ROOT, 'utils', 'store.js'))

const isInt = (v) => typeof v === 'number' && isFinite(v) && Math.floor(v) === v
const isStr = (v) => typeof v === 'string'

;(async () => {
  console.log('服务地址：' + config.baseUrl)
  console.log('开发模式登录：' + (config.allowDevLogin ? '开启' : '关闭') + '\n')

  /* ---------------- 登录 ---------------- */
  console.log('【1】登录')
  let user
  try {
    user = await store.ensureLogin(true)
  } catch (e) {
    console.log('  ✗ 登录失败：' + e.message)
    process.exit(1)
  }
  check('自动登录成功', !!user && isInt(user.id), user)
  check('本地缓存了 token', !!api.getToken())
  check('getMe() 返回数字 uid', isInt(store.getMe().uid), store.getMe())
  check('getMe() 带 tagAutoEnabled', typeof store.getMe().tagAutoEnabled === 'boolean')

  /* ---------------- 选项源 ---------------- */
  console.log('\n【2】选项源（记账页依赖）')
  const options = await store.loadOptions()
  check('分类非空', options.categories.length > 0, options.categories.length)
  check('分类含图标字段', options.categories.every(c => isStr(c.icon) && c.icon.length > 0))
  check('渠道按分类分组', options.channelGroups.length > 0, options.channelGroups.map(g => g.parent))
  check('渠道分组项含 shortName（界面只显示子项名）',
    options.channelGroups[0].items.every(i => isStr(i.shortName) && i.shortName.indexOf('/') < 0),
    options.channelGroups[0].items[0])
  check('渠道名是「父/子」两段式', options.channels.every(c => c.name.indexOf('/') > 0))
  check('账户预置了支付宝/微信/现金/银行卡',
    ['支付宝', '微信', '现金', '银行卡'].every(n => options.accounts.some(a => a.name === n)),
    options.accounts.map(a => a.name))
  check('标签非空且有预置规则', options.tags.length > 0, options.tags.map(t => t.name))
  check('消费者非空', options.consumers.length > 0)

  const rulesBefore = await store.listTagRules()
  check('标签规则已预置', rulesBefore.length > 0, rulesBefore.length)

  /* ---------------- 计量单位 ---------------- */
  console.log('\n【3】金额换算（前端元 ↔ 后端分）')
  check('yuan(1234) = 12.34', util.yuan(1234) === '12.34', util.yuan(1234))
  check('yuan(1200) 去掉尾零 = 12', util.yuan(1200) === '12', util.yuan(1200))
  check('toCents("12.34") = 1234', util.toCents('12.34') === 1234, util.toCents('12.34'))
  check('toCents("0.1") = 10', util.toCents('0.1') === 10, util.toCents('0.1'))
  check('toCents("abc") 返回 NaN', isNaN(util.toCents('abc')))
  check('money 带千分位', util.money(123456789) === '1,234,567.89', util.money(123456789))

  /* ---------------- 记一笔 ---------------- */
  console.log('\n【4】新增账目（含备注自动打标签）')
  const now = Date.now()
  const created = await store.createEntry({
    type: 'expense',
    amount: '38.50',
    category: '餐饮',
    channel: '餐饮/肯德基',
    consumer: '本人',
    account: '支付宝',
    tradeAt: now,
    remark: '和同事聚餐，AA 一下',
    tags: ['聚餐']
  })
  check('createEntry 返回 ok', created.ok === true, created)
  const e0 = created.entry
  check('金额以分返回（3850）', e0.amount === 3850, e0.amount)
  check('signedText 带负号', e0.signedText.indexOf('-') === 0, e0.signedText)
  check('isIncome 为 false', e0.isIncome === false)
  check('自动识别出「聚餐」标签（备注含「聚餐」）', e0.tags.indexOf('聚餐') >= 0, e0.tags)
  check('手动标签去重后仍只有一个「聚餐」', e0.tags.filter(t => t === '聚餐').length === 1, e0.tags)
  check('带图标与时间文案', isStr(e0.icon) && isStr(e0.timeText) && isStr(e0.dayLabel), {
    icon: e0.icon, timeText: e0.timeText, dayLabel: e0.dayLabel
  })
  check('渠道保留完整名称', e0.channel === '餐饮/肯德基', e0.channel)

  const entryId = e0.id
  const e1 = await store.getEntry(entryId)
  check('getEntry 可取回', !!e1 && e1.id === entryId)

  /* ---------------- 标签预分析 ---------------- */
  console.log('\n【5】备注预分析（记账页边输边看）')
  const auto = await store.previewTags('打车去公司，顺便买点日用品')
  check('命中「交通」「日用」', auto.indexOf('交通') >= 0 && auto.indexOf('日用') >= 0, auto)
  const none = await store.previewTags('')
  check('空备注不返回标签', none.length === 0, none)

  /* ---------------- 明细列表 ---------------- */
  console.log('\n【6】明细列表与分页')
  const page1 = await store.listEntries({}, null, 5)
  check('listEntries 返回 items 数组', Array.isArray(page1.items))
  check('每项含 id/amountText/dateKey/dayLabel',
    page1.items.every(i => isInt(i.id) && isStr(i.amountText) && isStr(i.dateKey) && isStr(i.dayLabel)),
    page1.items[0])
  check('按交易时间倒序', page1.items[0].tradeAt >= page1.items[page1.items.length - 1].tradeAt)
  check('hasMore 与 nextCursor 类型正确',
    typeof page1.hasMore === 'boolean' && (page1.nextCursor === null || isStr(page1.nextCursor)),
    { hasMore: page1.hasMore, nextCursor: page1.nextCursor })

  const page2 = page1.nextCursor ? await store.listEntries({}, page1.nextCursor, 5) : { items: [] }
  const dup = page2.items.some(a => page1.items.some(b => b.id === a.id))
  check('第二页不含第一页的重复记录', !dup, page2.items.map(i => i.id))

  const filtered = await store.listEntries({ type: 'expense', category: '餐饮' }, null, 10)
  check('按类型与分类筛选生效',
    filtered.items.every(i => i.type === 'expense' && i.category === '餐饮'),
    filtered.items.map(i => i.category))

  const kwRes = await store.listEntries({ keyword: '肯德基' }, null, 10)
  check('关键词可搜到渠道', kwRes.items.some(i => i.id === entryId), kwRes.items.length)

  /* ---------------- 修改与删除 ---------------- */
  console.log('\n【7】修改账目')
  const updated = await store.updateEntry(entryId, {
    type: 'income',
    amount: '100',
    category: '工资',
    channel: '',
    consumer: '本人',
    account: '银行卡',
    tradeAt: now,
    remark: '月度工资',
    tags: []
  })
  check('updateEntry 返回 ok', updated.ok === true, updated)
  check('类型改为收入、金额 10000 分',
    updated.entry.type === 'income' && updated.entry.amount === 10000, updated.entry)
  check('收入 signedText 带正号', updated.entry.signedText.indexOf('+') === 0, updated.entry.signedText)
  check('清空渠道后为 null → 页面显示空串', updated.entry.channel === '')

  /* ---------------- 概览 ---------------- */
  console.log('\n【8】概览与报表')
  const ov = await store.overview()
  check('overview 字段齐全',
    isInt(ov.todayExpense) && isInt(ov.monthExpense) && isInt(ov.monthIncome), ov)

  const from = util.startOfMonth(Date.now())
  const to = util.startOfNextMonth(Date.now())
  const rep = await store.report(from, to)
  check('report 返回对象', !!rep)
  check('汇总含收入/支出/结余文本',
    isStr(rep.incomeText) && isStr(rep.expenseText) && isStr(rep.balanceText), {
    incomeText: rep.incomeText, expenseText: rep.expenseText, balanceText: rep.balanceText
  })
  check('结余 = 收入 - 支出', rep.balance === rep.income - rep.expense, rep.balance)
  check('分类占比在 0~1', rep.categories.every(c => c.percent >= 0 && c.percent <= 1))
  check('分类占比含百分数文案', rep.categories.every(c => /%$/.test(c.percentText)))
  check('每日数据覆盖整月（折线图不断线）', rep.days.length === new Date(to - 86400000).getDate(), rep.days.length)
  check('每日点含 label（图上横轴用）', rep.days.every(d => /^\d{2}\/\d{2}$/.test(d.label)), rep.days[0])

  const ch = await store.channelRanking(from, to)
  check('渠道排行为数组', Array.isArray(ch))
  check('排行项含 ratio（进度条宽度用）', ch.every(c => c.ratio >= 0 && c.ratio <= 1), ch[0])

  /* ---------------- 选项源维护 ---------------- */
  console.log('\n【9】选项源：新增 / 改名 / 删除限制')
  const addCat = await store.addOption('category', '宠物', '')
  check('新增分类成功', addCat.ok === true, addCat)

  const dupCat = await store.addOption('category', '宠物', '')
  check('重复分类被拒绝', dupCat.ok === false, dupCat)

  const addCh = await store.addOption('channel', '宠物医院', '宠物')
  check('新增渠道成功且名称是「宠物/宠物医院」',
    addCh.ok === true && addCh.option.name === '宠物/宠物医院', addCh.option)

  const noParent = await store.addOption('channel', '某某店', '不存在的分类')
  check('渠道挂到不存在的分类被拒绝', noParent.ok === false, noParent)

  const renamed = await store.renameOption(addCat.option.id, '宠物用品')
  check('分类改名成功', renamed.ok === true && renamed.option.name === '宠物用品', renamed.option)

  const usage = await store.optionUsage()
  const kfc = options.channels.filter(c => c.name === '餐饮/肯德基')[0]
  check('使用次数接口返回数字', isInt(usage[kfc.id]), usage[kfc.id])
  check('未使用的渠道使用次数为 0',
    usage[kfc.id] === 0,
    { 说明: '账目在【7】已改成「工资/银行卡」，肯德基不再被引用', 次数: usage[kfc.id] })

  // 删「本人」：这条账目刚把消费者改成它，属于「有引用」的选项
  const me = options.consumers.filter(c => c.name === '本人')[0]
  check('被引用中的消费者使用次数 > 0', usage[me.id] > 0, usage[me.id])
  const delUsed = await store.deleteOption(me.id)
  check('被使用过的选项不能删除', delUsed.ok === false && /不能删除/.test(delUsed.error || ''), delUsed)

  // 分类下还挂着渠道时也不允许删，否则渠道会变成孤儿
  // 拒绝理由有两种：「已被 N 条账目使用」和「下面还有渠道」，都算正确拦截
  const foodCat = options.categories.filter(c => c.name === '餐饮')[0]
  const delParent = await store.deleteOption(foodCat.id)
  check('分类下还有渠道时不能删除',
    delParent.ok === false && /不能删除|还有\s*\d+\s*个渠道/.test(delParent.error || ''), delParent)

  const delFree = await store.deleteOption(addCh.option.id)
  check('未使用的选项可以删除', delFree.ok === true, delFree)

  /* ---------------- 标签规则 ---------------- */
  console.log('\n【10】标签规则')
  const addedRule = await store.addTagRule('咖啡|拿铁', '聚餐')
  check('新增规则成功', addedRule.ok === true, addedRule)
  const hit = await store.previewTags('下午喝了杯拿铁')
  check('新规则立即生效', hit.indexOf('聚餐') >= 0, hit)
  const delRule = await store.deleteTagRule(addedRule.rule.id)
  check('删除规则成功', delRule.ok === true, delRule)

  /* ---------------- 用户设置 ---------------- */
  console.log('\n【11】用户设置')
  const off = await store.updateProfile({ tagAutoEnabled: false })
  check('关闭自动识别', off.ok === true && store.getMe().tagAutoEnabled === false, store.getMe())
  const offHit = await store.previewTags('聚餐')
  check('关闭后不再自动识别', offHit.length === 0, offHit)
  const on = await store.updateProfile({ tagAutoEnabled: true })
  check('重新开启自动识别', on.ok === true && store.getMe().tagAutoEnabled === true)
  // 昵称全局唯一：带上本轮时间戳，保证测试可以对着同一个库反复跑
  const nickWant = '契约测试' + Date.now().toString(36).slice(-6)
  const nick = await store.updateProfile({ nickName: nickWant })
  check('改昵称成功', nick.ok === true && store.getMe().name === nickWant, store.getMe())

  /* ---------------- 数据隔离 ---------------- */
  console.log('\n【12】数据隔离与参数校验')
  const bad = await store.createEntry({ type: 'expense', amount: '-5', category: '餐饮' })
  check('负数金额被前端拦截', bad.ok === false, bad)
  const badAmt = await store.createEntry({ type: 'expense', amount: '1.234', category: '餐饮' })
  check('三位小数被前端拦截', badAmt.ok === false, badAmt)
  const noCat = await store.createEntry({ type: 'expense', amount: '1', category: '' })
  check('缺分类被拒绝', noCat.ok === false, noCat)

  // 鉴权校验：这里不能走 store.listEntries——它的 call() 遇到 401 会自动重新登录，
  // 那是有意的产品行为（token 过期不该把用户踢出去），所以用裸请求直接看服务端是否真的拦。
  const savedToken = api.getToken()
  api.clearSession()
  const anon = await api.rawRequest('GET', '/api/entries?limit=5', undefined, true)
  check('清掉 token 后服务端返回 401', anon.status === 401, anon.status)

  const anonReport = await api.rawRequest('GET', '/api/reports', undefined, true)
  check('报表接口同样拦未登录', anonReport.status === 401, anonReport.status)

  // 带一个伪造 token 也必须拦住（签名校验生效，而不是只看有没有 Authorization 头）
  const forged = await new Promise(function (resolve) {
    wx.request({
      url: api.config.baseUrl + '/api/entries?limit=5',
      method: 'GET',
      header: { 'content-type': 'application/json', Authorization: 'Bearer forged.token.value' },
      success: function (r) { resolve(r.statusCode) },
      fail: function () { resolve(0) }
    })
  })
  check('伪造 token 被拒绝', forged === 401, forged)

  wx.setStorageSync('lg_token_v1', savedToken)

  // 恢复登录态后应能立刻读到数据（自动重登兜底确实有效）
  const back = await store.listEntries({}, null, 5)
  check('恢复 token 后能正常读数据', Array.isArray(back.items), back.items.length)

  /* ---------------- 清理 ---------------- */
  console.log('\n【13】删除账目')
  const del = await store.deleteEntry(entryId)
  check('deleteEntry 返回 ok', del.ok === true, del)
  check('删除后 getEntry 返回 null', (await store.getEntry(entryId)) === null)
  await store.deleteOption(addCat.option.id)

  console.log('\n================ 结果 ================')
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项')
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => { console.error('脚本异常:', e); process.exit(1) })
