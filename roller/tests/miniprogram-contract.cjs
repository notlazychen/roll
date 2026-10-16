/**
 * 小程序数据层契约测试 · 自建服务版（utils/store-http.js）
 * ---------------------------------------------------------------
 * 在 Node 里模拟微信小程序的 wx API 环境，直接 require 小程序的 utils/，
 * 拿真实服务端的数据，逐字段验证「页面依赖的字段确实存在且类型正确」。
 *
 * 之所以要做这层测试：页面里大量使用 === 严格比较（m.uid === me.uid、
 * g.ownerId === me.uid、o.voters.indexOf(me.uid) >= 0），
 * 一旦前后端 id 类型不一致（数字 vs 字符串）就会出现「看起来都对但界面不动」的问题。
 *
 * 注意：这里直接 require store-http.js，绕开 utils/store.js 的分派，
 * 因为本测试针对自建 ASP.NET Core 服务；云服务版见 cloud-contract.cjs。
 *
 * 用法：先启动服务端，然后
 *   node server/tests/miniprogram-contract.cjs
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
    // 返回一个必然失败的 code：用于验证「微信登录不可用时自动退化为开发模式登录」
    setTimeout(() => success({ code: 'contract-test-invalid-code' }), 0)
  },
  request: (opt) => {
    const url = opt.url
    const headers = Object.assign({}, opt.header)
    const init = { method: opt.method || 'GET', headers }
    if (opt.data !== undefined && opt.data !== null) init.body = JSON.stringify(opt.data)
    fetch(url, init)
      .then(async (res) => {
        const text = await res.text()
        let data = null
        try { data = text ? JSON.parse(text) : null } catch (e) { data = null }
        opt.success && opt.success({ statusCode: res.status, data, header: {} })
      })
      .catch((e) => {
        opt.fail && opt.fail({ errMsg: 'request:fail ' + e.message })
      })
  }
}

/* ------------------------- 加载被测模块 ------------------------- */

const config = require(path.join(MP_ROOT, 'utils', 'config.js'))
const api = require(path.join(MP_ROOT, 'utils', 'api.js'))
const store = require(path.join(MP_ROOT, 'utils', 'store-http.js'))

function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v }

;(async () => {
  console.log('服务地址：' + config.baseUrl)
  console.log('开发模式登录：' + (config.allowDevLogin ? '开启' : '关闭') + '\n')

  /* ---------------- 登录 ---------------- */
  console.log('【1】登录（含微信登录失败后自动退化）')
  let user
  try {
    user = await store.ensureLogin(true)
  } catch (e) {
    console.log('  ✗ 登录失败：' + e.message)
    process.exit(1)
  }
  check('自动登录成功', !!user && isInt(user.id), user)
  check('本地缓存了 token', !!api.getToken())
  check('getMe() 同步返回数字 uid（页面用 === 比较）', isInt(store.getMe().uid), store.getMe())
  check('envInfo() 返回环境信息', store.envInfo().baseUrl === config.baseUrl, store.envInfo())

  /* ---------------- 大厅列表 ---------------- */
  console.log('\n【2】大厅列表（index 页依赖字段）')
  const groups = await store.listGroups()
  check('listGroups() 返回数组', Array.isArray(groups), typeof groups)
  check('列表非空（服务端已有数据）', groups.length > 0, groups.length)
  const g0 = groups[0]
  check('每项含 id/code/theme/stage',
    isInt(g0.id) && typeof g0.code === 'string' && typeof g0.theme === 'string' && typeof g0.stage === 'string', g0)
  check('每项含 memberCount/hasPasscode（卡片右下角与左上角锁）',
    typeof g0.memberCount === 'number' && typeof g0.hasPasscode === 'boolean', g0)
  check('每项含 joined / owner（用于"已加入"与队长标识）',
    typeof g0.joined === 'boolean' && typeof g0.owner === 'boolean', { joined: g0.joined, owner: g0.owner })
  check('主题不超过 10 个字符', groups.every(g => g.theme.length <= 10))

  /* ---------------- 建房 ---------------- */
  console.log('\n【3】创建小队与备选项')
  const theme = '契约' + Date.now().toString(36).slice(-4)
  const created = await store.createGroup({ theme: theme, passcode: '' })
  check('createGroup 返回 { ok, group }', created.ok === true && !!created.group, created)
  const gid = created.group.id
  check('group.id 为数字', isInt(gid))
  check('创建者即队长（group.ownerId === getMe().uid，页面用它判断 isLeader）',
    created.group.ownerId === store.getMe().uid, { ownerId: created.group.ownerId, me: store.getMe().uid })
  check('创建者自动入组（memberCount = 1）', created.group.memberCount === 1, created.group.memberCount)

  const added = await store.addOption(gid, '契约选项甲')
  check('addOption 返回 { ok, optionId, autoVoted }',
    added.ok === true && isInt(added.optionId) && added.autoVoted === true, added)

  /* ---------------- 小队详情聚合 ---------------- */
  console.log('\n【4】小队聚合接口（group 页轮询只用这一个请求）')
  const bundle = await store.loadGroupBundle(gid)
  check('返回 ok=true', bundle.ok === true, bundle.ok)
  check('含 group / members / options / weights / isMember / isLeader',
    !!bundle.group && Array.isArray(bundle.members) && Array.isArray(bundle.options) &&
    !!bundle.weights && typeof bundle.isMember === 'boolean' && typeof bundle.isLeader === 'boolean',
    Object.keys(bundle))

  const m0 = bundle.members[0]
  check('member.uid 为数字（页面 m.uid === me.uid 能匹配上）',
    isInt(m0.uid) && bundle.members.some(m => m.uid === store.getMe().uid), m0)
  check('member 含 id/name/ready/joinedAt',
    isInt(m0.id) && typeof m0.name === 'string' && typeof m0.ready === 'string' && isInt(m0.joinedAt), m0)
  check('isLeader 判定与 ownerId 一致', bundle.isLeader === true)
  check('isMember 为 true', bundle.isMember === true)

  const o0 = bundle.options[0]
  check('option.voters 为数字数组（页面 votedByMe 用 indexOf 判断）',
    Array.isArray(o0.voters) && o0.voters.every(isInt) && o0.voters.indexOf(store.getMe().uid) >= 0, o0.voters)
  check('option 含 id/title/creatorId/creatorName/voteCount',
    isInt(o0.id) && typeof o0.title === 'string' && isInt(o0.creatorId) &&
    typeof o0.creatorName === 'string' && typeof o0.voteCount === 'number', o0)

  const w0 = bundle.weights
  check('weights 含 items/totalVotes/uniform',
    Array.isArray(w0.items) && typeof w0.totalVotes === 'number' && typeof w0.uniform === 'boolean', w0)
  const wi = w0.items[0]
  check('weights.items 项含 optionId/title/votes/weight/percent/colorIndex',
    isInt(wi.optionId) && typeof wi.title === 'string' && typeof wi.votes === 'number' &&
    typeof wi.weight === 'number' && typeof wi.percent === 'number' && isInt(wi.colorIndex), wi)
  check('percent 都在 0~1 之间', w0.items.every(i => i.percent >= 0 && i.percent <= 1))
  check('票数即权重（新项自动 1 票 → 权重 1）', wi.votes === 1 && wi.weight === 1, wi)

  /* ---------------- 第二个人 ---------------- */
  console.log('\n【5】切换测试身份并加入（模拟第二个成员）')
  const mate = await store.addIdentity('契约同事')
  check('addIdentity 返回 { uid, name }', !!mate && isInt(mate.uid), mate)
  check('切换后 getMe 变成新身份', store.getMe().uid === mate.uid, store.getMe())
  check('listIdentities 含两个身份', store.listIdentities().length >= 2, store.listIdentities())

  const joined = await store.joinGroup(gid, {})
  check('joinGroup 返回 { ok, group, me }', joined.ok === true && !!joined.group && !!joined.me, joined)
  check('新成员 uid 与当前登录一致', joined.me.uid === store.getMe().uid)

  const bundle2 = await store.loadGroupBundle(gid)
  check('现在 2 名成员', bundle2.members.length === 2, bundle2.members.length)
  check('非队长视角 isLeader=false', bundle2.isLeader === false)
  check('队长在这一视角下 ownerId 仍是原队长',
    bundle2.group.ownerId === created.group.ownerId)

  await store.addOption(gid, '契约选项乙')
  const bundle3 = await store.loadGroupBundle(gid)
  check('两个备选项各 1 票', bundle3.weights.totalVotes === 2, bundle3.weights.items)
  check('小队端看不到口令明文（非队长）', bundle3.group.passcode === '', bundle3.group)

  /* ---------------- 准备与随机 ---------------- */
  console.log('\n【6】准备环节与加权随机')
  // 切回队长（只有队长能开启随机）
  const leaderUid = created.group.ownerId
  const switched = await store.switchIdentity(leaderUid)
  check('切回队长身份', switched === true && store.getMe().uid === leaderUid, store.getMe())

  const prep = await store.startPrepare(gid, 180)
  check('startPrepare 传秒数，返回阶段与截止时间',
    prep.ok === true && prep.stage === 'preparing' && isInt(prep.prepDeadline), prep)
  check('截止时间在当前时间之后（服务端时钟）', prep.prepDeadline > Date.now() - 5000)

  const locked = await store.addOption(gid, '准备中不该加上')
  check('准备环节添加备选项被拒绝', locked.ok === false && /锁定/.test(locked.error || ''), locked)

  const c1 = await store.confirmReady(gid)
  check('队长确认后 allConfirmed 仍为 false（另一个成员还没确认）', c1.ok === true && c1.allConfirmed === false, c1)

  await store.switchIdentity(mate.uid)
  const c2 = await store.confirmReady(gid)
  check('第二个成员确认后 allConfirmed=true', c2.ok === true && c2.allConfirmed === true, c2)

  const afterConfirm = await store.loadGroupBundle(gid)
  check('全员确认后服务端直接推进到 result', afterConfirm.group.stage === 'result', afterConfirm.group.stage)
  check('group.resultOptionId 指向某个备选项',
    isInt(afterConfirm.group.resultOptionId) &&
    afterConfirm.options.some(o => o.id === afterConfirm.group.resultOptionId), afterConfirm.group.resultOptionId)
  check('group.resultAt 为毫秒时间戳（转盘动画用它做去重 key）', isInt(afterConfirm.group.resultAt), afterConfirm.group.resultAt)

  const roll = await store.rollPick(gid)
  check('rollPick 幂等返回同一结果',
    roll.ok === true && roll.chosen && roll.chosen.optionId === afterConfirm.group.resultOptionId, roll.chosen)
  check('chosen 含标题/票数/创建者/百分比（结果卡片展示）',
    typeof roll.chosen.title === 'string' && typeof roll.chosen.votes === 'number' &&
    typeof roll.chosen.creatorName === 'string' && typeof roll.chosen.percent === 'number', roll.chosen)

  // 模拟页面 computeTarget：按权重>0 的项计算扇区
  const pool = afterConfirm.weights.items.filter(i => i.weight > 0)
  check('转盘可绘制（存在权重 > 0 的扇区）', pool.length > 0, pool.length)
  const sum = pool.reduce((s, i) => s + i.weight, 0)
  check('权重总和等于总票数', Math.abs(sum - afterConfirm.weights.totalVotes) < 1e-9, { sum, totalVotes: afterConfirm.weights.totalVotes })

  /* ---------------- 通知 ---------------- */
  console.log('\n【7】通知')
  const notifs = await store.listNotifications()
  check('listNotifications 返回数组', Array.isArray(notifs), typeof notifs)
  check('含 result 类型通知', notifs.some(n => n.type === 'result'), notifs.map(n => n.type))
  const n0 = notifs[0]
  check('通知含 id/uid/type/content/read/createdAt',
    isInt(n0.id) && isInt(n0.uid) && typeof n0.type === 'string' &&
    typeof n0.content === 'string' && typeof n0.read === 'boolean' && isInt(n0.createdAt), n0)
  const unread = await store.unreadCount()
  check('unreadCount 返回数字', typeof unread === 'number', unread)
  const readRes = await store.markAllRead()
  check('markAllRead 返回 ok', readRes.ok === true, readRes)
  check('已读后未读数归零', (await store.unreadCount()) === 0)

  /* ---------------- 取消流程 ---------------- */
  console.log('\n【8】取消准备流程')
  await store.switchIdentity(leaderUid)
  await store.backToConfig(gid)
  const bc = await store.getGroup(gid)
  check('backToConfig 后阶段回到 config', bc.stage === 'config', bc.stage)
  await store.startPrepare(gid, 300)
  await store.switchIdentity(mate.uid)
  const cancel = await store.cancelReady(gid)
  check('cancelReady 返回 ok', cancel.ok === true, cancel)
  const afterCancel = await store.getGroup(gid)
  check('取消后阶段回到 config 且清空截止时间',
    afterCancel.stage === 'config' && afterCancel.prepDeadline === null, afterCancel)

  /* ---------------- 改昵称（开发身份也不该换账号） ---------------- */
  console.log('\n【8.5】改昵称不应改变账号身份')
  const uidBefore = mate.uid
  const renamed = await store.renameIdentity(mate.uid, '契约同事改名')
  const afterRename = store.getMe()
  check('改名成功', renamed === true, renamed)
  check('改名后 uid 不变（组内关系不丢）', afterRename.uid === uidBefore, { before: uidBefore, after: afterRename.uid })
  const bundleAfterRename = await store.loadGroupBundle(gid)
  check('改名后仍是该小队成员', bundleAfterRename.isMember === true)
  check('改名后组内显示名已同步',
    bundleAfterRename.members.some(m => m.uid === uidBefore && m.name === '契约同事改名'),
    bundleAfterRename.members.map(m => m.name))

  /* ---------------- 统计与退出 ---------------- */
  console.log('\n【9】统计与维护接口')
  await store.switchIdentity(leaderUid)
  check('切回队长后再执行管理操作', store.getMe().uid === leaderUid, store.getMe())
  const stats = await store.myStats()
  check('myStats 返回 { joinedCount, ownedCount }',
    typeof stats.joinedCount === 'number' && typeof stats.ownedCount === 'number', stats)
  const profile = await store.updateMyProfile('契约改名' + Date.now().toString(36).slice(-3))
  check('updateMyProfile 返回 { ok, user }', profile.ok === true && !!profile.user, profile)
  check('改名后 getMe 同步更新', store.getMe().name === profile.user.nickName, store.getMe())
  const listAfterRename = await store.listGroups()
  const mineRow = listAfterRename.find(g => g.id === gid)
  check('改名后小队列表里队长名同步', mineRow && mineRow.ownerName === profile.user.nickName, mineRow && mineRow.ownerName)

  const delRes = await store.deleteGroup(gid)
  check('队长可解散小队', delRes.ok === true, delRes)
  check('解散后 getGroup 返回 null（页面会提示并返回）', (await store.getGroup(gid)) === null)

  console.log('\n================ 结果 ================')
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项')
  process.exit(fail === 0 ? 0 : 1)
})().catch(e => { console.error('脚本异常:', e); process.exit(1) })
