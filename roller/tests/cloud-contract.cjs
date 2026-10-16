/**
 * 小程序数据层契约测试 · 云服务版（utils/store-cloud.js）
 * ---------------------------------------------------------------
 * 云服务没法在本地起一个完整环境来跑真实请求，所以这里用「假云客户端」把
 * utils/cloud.js 换掉，重点守住三类最容易出错、又最难在真机上定位的问题：
 *
 *   1) 方法齐全：页面调用的每个 store.xxx 都存在（门面切换后不会漏）；
 *   2) 参数名正确：调 rpc 时报的参数名必须和数据库函数签名一致
 *      （p_group_id / p_option_id / p_seconds … 拼错在运行期才炸）；
 *   3) 出参形状：jsonb 被 PostgREST 包成单元素数组时要能拆开，
 *      通知表的 snake_case 字段要映射成页面用的 camelCase。
 *
 * 用法：
 *   node server/tests/cloud-contract.cjs
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
  getAccountInfoSync: () => ({ miniProgram: { appId: 'wx-test-appid' } }),
  login: ({ success }) => { setTimeout(() => success({ code: 'test-code-123' }), 0) }
}

/* ------------------------- 假云客户端 ------------------------- */

const rpcCalls = []
const notifRows = []

let rpcHandler = () => ({ data: { ok: true }, error: null })
let sessionResult = { data: null, error: null }
let wechatResult = { data: null, error: null }
let otpSendResult = { data: null, error: null }
let otpVerifyResult = { data: null, error: null }
let signedOut = false

function makeSession(id, name) {
  return { user: { id: id, name: name || '', avatarUrl: '' } }
}

/** 模拟 PostgREST 的链式查询构造器（可 await） */
function queryBuilder(result) {
  const chain = {
    select() { return chain },
    order() { return chain },
    limit() { return chain },
    eq() { return chain },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject) }
  }
  return chain
}

const mockCloud = {
  auth: {
    getSession: async () => sessionResult,
    signInWithWechat: async (code, appid) => {
      rpcCalls.push({ fn: 'auth.signInWithWechat', args: { code: code, appid: appid } })
      return wechatResult
    },
    sendOtp: async (args) => {
      rpcCalls.push({ fn: 'auth.sendOtp', args: args })
      return otpSendResult
    },
    verifyOtp: async (args) => {
      rpcCalls.push({ fn: 'auth.verifyOtp', args: args })
      return otpVerifyResult
    },
    signOut: async () => { signedOut = true }
  },
  database: {
    rpc: async (fn, args) => {
      rpcCalls.push({ fn: fn, args: args })
      return rpcHandler(fn, args)
    },
    from: () => queryBuilder({ data: notifRows, error: null, count: notifRows.length })
  }
}

// 把 utils/cloud.js 的导出换成假客户端，这样被测代码里的 require('./cloud') 拿到的是它
const cloudPath = path.join(MP_ROOT, 'utils', 'cloud.js')
require.cache[cloudPath] = {
  id: cloudPath,
  filename: cloudPath,
  loaded: true,
  exports: { cloud: mockCloud }
}

const store = require(path.join(MP_ROOT, 'utils', 'store-cloud.js'))

/** 取最近一次 rpc 调用 */
function lastRpc() { return rpcCalls[rpcCalls.length - 1] }
function resetCalls() { rpcCalls.length = 0 }

;(async () => {
  console.log('被测模块：utils/store-cloud.js（云服务数据层）\n')

  /* ---------------- 1. 页面依赖的方法必须齐全 ---------------- */

  console.log('【1】导出完整性（页面调用的方法一个都不能少）')
  const required = [
    'ensureLogin', 'ensureIdentity', 'getMe', 'isLoggedIn', 'isDevMode',
    'updateMyProfile', 'logout',
    'listGroups', 'getGroup', 'loadGroupBundle', 'createGroup', 'updateGroup',
    'isMember', 'joinGroup', 'leaveGroup', 'deleteGroup',
    'listMembers', 'setReady', 'resetReady',
    'listOptions', 'addOption', 'deleteOption', 'toggleVote',
    'computeWeights', 'startPrepare', 'confirmReady', 'cancelReady',
    'rollPick', 'backToConfig',
    'listNotifications', 'unreadCount', 'markAllRead', 'clearNotifications',
    'pushNotification',
    'myStats', 'resetAll', 'envInfo',
    'loginByWeChat', 'sendEmailCode', 'submitEmailCode'
  ]
  const missing = required.filter(function (k) { return typeof store[k] !== 'function' })
  check('全部 ' + required.length + ' 个方法都存在', missing.length === 0, missing)
  check('常量 MAX_MEMBERS=20', store.MAX_MEMBERS === 20)
  check('常量 MAX_THEME=10', store.MAX_THEME === 10)
  check('常量 MAX_OPTION=20', store.MAX_OPTION === 20)

  /* ---------------- 2. 登录 ---------------- */

  console.log('\n【2】登录流程')
  check('未登录时 getMe().uid 为空串', store.getMe().uid === '')

  // 微信登录：wx.login -> signInWithWechat(code, appid)
  wechatResult = { data: makeSession('uid_openid_abc', '微信用户'), error: null }
  resetCalls()
  const wlogin = await store.loginByWeChat()
  check('微信登录成功', wlogin.ok === true, wlogin)
  check('调用了 signInWithWechat', lastRpc() && lastRpc().fn === 'auth.signInWithWechat')
  check('传入了 wx.login 的 code', lastRpc().args.code === 'test-code-123', lastRpc().args)
  check('传入了当前小程序 appid', lastRpc().args.appid === 'wx-test-appid', lastRpc().args)

  const me = store.getMe()
  check('getMe() 返回云端 uid（字符串）', me.uid === 'uid_openid_abc', me)
  check('isLoggedIn() 为 true', store.isLoggedIn() === true)
  check('云版没有本机测试身份（isDevMode false）', store.isDevMode() === false)
  check('listIdentities 只返回自己', store.listIdentities().length === 1)

  // 会话恢复优先于重新登录
  resetCalls()
  sessionResult = { data: makeSession('uid_openid_abc', '微信用户'), error: null }
  await store.ensureLogin()
  check('已有会话时不再触发微信登录', rpcCalls.length === 0, rpcCalls)

  // 微信登录失败要抛出，页面据此引导手动登录
  wechatResult = { data: null, error: { kind: 'unauthenticated', message: '该应用尚未开启微信登录' } }
  const savedUser = memory['rg_cloud_user_v1']
  delete memory['rg_cloud_user_v1']
  let threw = null
  try { await store.ensureLogin(true) } catch (e) { threw = e }
  check('微信登录失败时抛出错误', !!threw)
  check('错误标记需要手动登录', !!(threw && threw.needsManualLogin))
  memory['rg_cloud_user_v1'] = savedUser

  /* ---------------- 3. 邮箱验证码登录 ---------------- */

  console.log('\n【3】邮箱验证码登录（无微信授权环境时的备用方式）')
  otpSendResult = { data: { verificationId: 'vid-1', isExistingUser: false }, error: null }
  resetCalls()
  const bad = await store.sendEmailCode('not-an-email')
  check('邮箱格式非法时本地拦截', bad.ok === false, bad)
  check('非法邮箱不发请求', rpcCalls.length === 0)

  const sent = await store.sendEmailCode('hero@example.com')
  check('验证码发送成功', sent.ok === true, sent)
  check('回传 verificationId', sent.verificationId === 'vid-1')
  check('sendOtp 只传 email 一个标识', lastRpc().args.email === 'hero@example.com' && lastRpc().args.phone === undefined)

  otpVerifyResult = { data: makeSession('uid_email_xyz', '勇者'), error: null }
  resetCalls()
  const submitted = await store.submitEmailCode(sent, '123456')
  check('验证码校验通过并登录', submitted.ok === true, submitted)
  check('verifyOtp 带上 email', lastRpc().args.email === 'hero@example.com')
  check('verifyOtp 复用保存的 verificationId', lastRpc().args.verificationId === 'vid-1')
  check('verifyOtp 带上 isExistingUser', lastRpc().args.isExistingUser === false)
  check('verifyOtp 带上用户输入的 token', lastRpc().args.token === '123456')

  const noPending = await store.submitEmailCode(null, '123456')
  check('没有先获取验证码时给出提示', noPending.ok === false && /先获取/.test(noPending.error), noPending)

  /* ---------------- 4. rpc 参数名必须与数据库函数签名一致 ---------------- */

  console.log('\n【4】rpc 函数名与参数名（拼错只会在真机上炸）')
  // 上一节用邮箱账号登录过，这里先退出再走一次会话恢复，切回微信账号（快照里的身份要对上）
  sessionResult = { data: makeSession('uid_openid_abc', '微信用户'), error: null }
  await store.logout()
  await store.ensureLogin()
  check('重新登录后身份切回微信账号', store.getMe().uid === 'uid_openid_abc', store.getMe())

  // 大厅
  rpcHandler = () => ({ data: { ok: true, groups: [{ id: 1, theme: '加班餐', owner: true, joined: true }] }, error: null })
  resetCalls()
  const groups = await store.listGroups('加班')
  check('listGroups -> roll_hall', lastRpc().fn === 'roll_hall', lastRpc())
  check('listGroups 参数为 p_keyword', lastRpc().args.p_keyword === '加班', lastRpc().args)
  check('listGroups 返回数组', Array.isArray(groups) && groups.length === 1, groups)

  // 小队快照
  rpcHandler = () => ({
    data: {
      ok: true,
      group: { id: 7, code: '123456', theme: '今天吃什么', ownerId: 'uid_openid_abc', stage: 'config', memberCount: 2, hasPasscode: false },
      members: [], options: [],
      weights: { items: [], totalVotes: 0, uniform: true },
      isMember: true, isLeader: true
    },
    error: null
  })
  resetCalls()
  const bundle = await store.loadGroupBundle(7)
  check('loadGroupBundle -> roll_sync', lastRpc().fn === 'roll_sync', lastRpc())
  check('loadGroupBundle 参数为 p_group_id（数字）', lastRpc().args.p_group_id === 7, lastRpc().args)
  check('快照里带上 me', !!(bundle.me && bundle.me.uid === 'uid_openid_abc'), bundle.me)
  check('快照保留 ok / group / members / weights', bundle.ok === true && !!bundle.group && Array.isArray(bundle.members) && !!bundle.weights)

  // 建队
  rpcHandler = () => ({ data: { ok: true, groupId: 12, code: '654321' }, error: null })
  resetCalls()
  const created = await store.createGroup({ theme: '加班餐', passcode: '12345' })
  check('createGroup -> roll_create_group', lastRpc().fn === 'roll_create_group', lastRpc())
  check('createGroup 三个参数齐全',
    lastRpc().args.p_theme === '加班餐' &&
    lastRpc().args.p_passcode === '12345' &&
    typeof lastRpc().args.p_user_name === 'string',
    lastRpc().args)
  check('建队返回 res.group.id 为数字（页面直接跳转要用）',
    created.ok === true && typeof created.group.id === 'number' && created.group.id === 12, created)

  // 改队（只提交想改的字段）
  rpcHandler = () => ({ data: { ok: true }, error: null })
  resetCalls()
  await store.updateGroup(7, { theme: '新主题' })
  check('updateGroup -> roll_update_group', lastRpc().fn === 'roll_update_group', lastRpc())
  check('只改主题时不带口令变更',
    lastRpc().args.p_theme === '新主题' &&
    lastRpc().args.p_change_passcode === false &&
    lastRpc().args.p_passcode === null, lastRpc().args)

  resetCalls()
  await store.updateGroup(7, { passcode: '54321' })
  check('改口令时 p_change_passcode 为 true', lastRpc().args.p_change_passcode === true, lastRpc().args)

  resetCalls()
  await store.updateGroup(7, { passcode: '' })
  check('口令置空表示取消口令', lastRpc().args.p_passcode === '' && lastRpc().args.p_change_passcode === true, lastRpc().args)

  // 加入 / 退出 / 解散
  resetCalls()
  await store.joinGroup(7, { passcode: '12345' })
  check('joinGroup -> roll_join', lastRpc().fn === 'roll_join', lastRpc())
  check('joinGroup 带 p_group_id / p_passcode / p_user_name',
    lastRpc().args.p_group_id === 7 && lastRpc().args.p_passcode === '12345' && typeof lastRpc().args.p_user_name === 'string',
    lastRpc().args)

  resetCalls()
  await store.leaveGroup(7)
  check('leaveGroup -> roll_leave', lastRpc().fn === 'roll_leave' && lastRpc().args.p_group_id === 7, lastRpc())

  resetCalls()
  await store.deleteGroup(7)
  check('deleteGroup -> roll_delete_group', lastRpc().fn === 'roll_delete_group' && lastRpc().args.p_group_id === 7, lastRpc())

  // 备选项
  resetCalls()
  await store.addOption(7, '海底捞')
  check('addOption -> roll_add_option', lastRpc().fn === 'roll_add_option', lastRpc())
  check('addOption 带 p_group_id / p_title / p_user_name',
    lastRpc().args.p_group_id === 7 && lastRpc().args.p_title === '海底捞' && typeof lastRpc().args.p_user_name === 'string',
    lastRpc().args)

  resetCalls()
  await store.deleteOption(33)
  check('deleteOption -> roll_delete_option 且参数为 p_option_id',
    lastRpc().fn === 'roll_delete_option' && lastRpc().args.p_option_id === 33, lastRpc())

  resetCalls()
  await store.toggleVote(33)
  check('toggleVote -> roll_toggle_vote 且参数为 p_option_id',
    lastRpc().fn === 'roll_toggle_vote' && lastRpc().args.p_option_id === 33, lastRpc())

  // 阶段
  resetCalls()
  await store.startPrepare(7, 180)
  check('startPrepare -> roll_start_prepare 且参数为 p_seconds',
    lastRpc().fn === 'roll_start_prepare' && lastRpc().args.p_seconds === 180, lastRpc())

  resetCalls()
  await store.startPrepare(7, null)
  check('不限时传 0（数据库函数用 0 表示不限时）', lastRpc().args.p_seconds === 0, lastRpc().args)

  resetCalls()
  await store.confirmReady(7)
  check('confirmReady -> roll_set_ready + p_action=confirm',
    lastRpc().fn === 'roll_set_ready' && lastRpc().args.p_action === 'confirm', lastRpc())

  resetCalls()
  await store.cancelReady(7)
  check('cancelReady -> roll_set_ready + p_action=cancel',
    lastRpc().fn === 'roll_set_ready' && lastRpc().args.p_action === 'cancel', lastRpc())

  resetCalls()
  const picked = await store.rollPick(7)
  check('rollPick 复用快照入口（阶段推进在数据库侧完成）',
    rpcCalls.some(function (c) { return c.fn === 'roll_sync' }) && picked.ok === true, rpcCalls)

  resetCalls()
  await store.backToConfig(7)
  check('backToConfig -> roll_back_to_config', lastRpc().fn === 'roll_back_to_config' && lastRpc().args.p_group_id === 7, lastRpc())

  resetCalls()
  await store.markAllRead()
  check('markAllRead -> roll_mark_notifications_read', lastRpc().fn === 'roll_mark_notifications_read', lastRpc())

  resetCalls()
  await store.clearNotifications()
  check('clearNotifications -> roll_clear_notifications', lastRpc().fn === 'roll_clear_notifications', lastRpc())

  resetCalls()
  await store.myStats()
  check('myStats -> roll_my_stats', lastRpc().fn === 'roll_my_stats', lastRpc())

  resetCalls()
  await store.updateMyProfile('勇者')
  check('updateMyProfile -> roll_set_nickname + p_name',
    lastRpc().fn === 'roll_set_nickname' && lastRpc().args.p_name === '勇者', lastRpc())
  check('改昵称后 getMe().name 同步', store.getMe().name === '勇者', store.getMe())

  /* ---------------- 5. 出参形状与错误处理 ---------------- */

  console.log('\n【5】出参形状与错误处理')

  // PostgREST 有时把 jsonb 包成单元素数组
  rpcHandler = () => ({ data: [{ ok: true, groupId: 99, code: '111111' }], error: null })
  const wrapped = await store.createGroup({ theme: 'x' })
  check('单元素数组能被拆开', wrapped.ok === true && wrapped.group.id === 99, wrapped)

  // 业务错误：数据库函数返回 { ok:false, error }
  rpcHandler = () => ({ data: { ok: false, error: '口令不正确' }, error: null })
  const bizErr = await store.joinGroup(7, { passcode: '00000' })
  check('业务错误按原样透传', bizErr.ok === false && bizErr.error === '口令不正确', bizErr)

  // 传输错误：error 对象
  rpcHandler = () => ({ data: null, error: { message: 'permission denied for function roll_sync' } })
  const denied = await store.loadGroupBundle(7)
  check('权限错误被归一化且不抛异常', denied.ok === false && !!denied.error, denied)

  // 微信登录被云后端拒绝（应用还没绑定小程序）：要把英文报错翻成人话
  wechatResult = { data: null, error: { message: 'the client credential is invalid or revoked' } }
  const credErr = await store.loginByWeChat()
  check('凭证无效报错翻译成中文指引',
    credErr.ok === false && /邮箱验证码/.test(credErr.error) && !/credential/i.test(credErr.error),
    credErr)
  wechatResult = { data: makeSession('uid_openid_abc', '微信用户'), error: null }

  rpcHandler = () => ({ data: null, error: null })
  const empty = await store.loadGroupBundle(7)
  check('空结果给出可读提示', empty.ok === false && !!empty.error, empty)

  // 读取类失败不抛错，给兜底值（页面直接渲染，不能崩）
  rpcHandler = () => ({ data: null, error: { message: 'boom' } })
  const lg = await store.listGroups('')
  check('listGroups 失败返回空数组', Array.isArray(lg) && lg.length === 0, lg)
  const unread = await store.unreadCount()
  check('unreadCount 失败返回 0', unread === 0, unread)
  const stats = await store.myStats()
  check('myStats 失败返回零值', stats.joinedCount === 0 && stats.ownedCount === 0, stats)

  // 非法 id
  const badId = await store.loadGroupBundle('abc')
  check('非法小队 id 被本地拦截', badId.ok === false && /参数/.test(badId.error), badId)

  rpcHandler = () => ({ data: { ok: true, members: [{ uid: 'u1' }, { uid: 'u2' }], options: [], weights: {} }, error: null })
  const isMem = await store.isMember(7, 'u2')
  check('isMember 用字符串 uid 比较正确', isMem === true)
  const notMem = await store.isMember(7, 'u9')
  check('isMember 对不在组内的 uid 返回 false', notMem === false)

  /* ---------------- 6. 通知字段映射 ---------------- */

  console.log('\n【6】通知字段映射（snake_case -> 页面用的 camelCase）')
  notifRows.length = 0
  notifRows.push({
    id: '5', group_id: '7', group_theme: '加班餐', type: 'result',
    content: '海底捞', is_read: false, created_at: '2026-10-15T08:00:00.000Z'
  })
  const notes = await store.listNotifications()
  check('通知条数正确', notes.length === 1, notes)
  check('id 转成数字', typeof notes[0].id === 'number' && notes[0].id === 5, notes[0])
  check('groupId 转成数字', typeof notes[0].groupId === 'number' && notes[0].groupId === 7, notes[0])
  check('groupTheme 映射正确', notes[0].groupTheme === '加班餐', notes[0])
  check('read 映射自 is_read', notes[0].read === false)
  check('createdAt 转成毫秒时间戳', typeof notes[0].createdAt === 'number' && notes[0].createdAt > 0, notes[0])

  notifRows[0].group_id = null
  const nullGroup = await store.listNotifications()
  check('groupId 为 null 时退化为 0（不出现 NaN）', nullGroup[0].groupId === 0, nullGroup[0])

  /* ---------------- 7. 退出登录与环境信息 ---------------- */

  console.log('\n【7】退出登录与环境信息')
  signedOut = false
  await store.resetAll()
  check('退出调用了云端 signOut', signedOut === true)
  check('退出后 isLoggedIn 为 false', store.isLoggedIn() === false)
  check('退出后 getMe().uid 为空串', store.getMe().uid === '')

  const env = store.envInfo()
  check('envInfo 标明数据源为 cloud', env.dataSource === 'cloud', env)
  check('envInfo 带出云端网关地址', typeof env.baseUrl === 'string' && env.baseUrl.indexOf('http') === 0, env)
  check('envInfo 里没有本机开发登录开关', env.allowDevLogin === false)

  console.log('\n================ 结果 ================')
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项')
  process.exit(fail === 0 ? 0 : 1)
})().catch(function (e) {
  console.error('\n测试脚本异常：', e)
  process.exit(1)
})
