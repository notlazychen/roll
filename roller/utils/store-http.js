/**
 * 数据层 · 自建服务实现（当前使用）
 * ---------------------------------------------------------------
 * 全部数据保存在你自己的 ASP.NET Core + PostgreSQL 服务上，这里只做 HTTP 调用。
 *
 * 两套实现（本文件与 utils/store-cloud.js）的方法名与返回结构完全一致，
 * 由 utils/store.js 按 utils/config.js 的 DATA_SOURCE 分派，页面代码不区分：
 *   - 写入类返回 { ok, error?, ... }
 *   - 读取类返回数组或对象（失败时给兜底值，并节流提示一次）
 *
 * 环境切换见 utils/config.js 的 baseUrl；接入与部署说明见 ../roller-server/README.md。
 *
 * 服务端数据模型：
 *   user         { id, nickName, avatarUrl, isDevAccount }
 *                —— avatarUrl 是服务端现算的相对地址（/api/users/{id}/avatar?v=N），
 *                   这里用 api.absoluteUrl() 补成完整地址再交给页面
 *   group        { id, code, theme, passcode, ownerId, ownerName, stage,
 *                  prepDeadline, prepStartedAt, resultOptionId, resultAt, createdAt,
 *                  memberCount, hasPasscode }
 *   member       { id, groupId, uid, name, ready, joinedAt }
 *   option       { id, groupId, title, creatorId, creatorName, createdAt, voteCount, voters }
 *   notification { id, uid, groupId, groupTheme, type, content, read, createdAt }
 *
 * 阶段 stage：config（配置）-> preparing（准备）-> rolling（随机中）-> result（已出结果）
 * 阶段推进全部由服务端裁决，客户端只负责发起动作与轮询。
 *
 * 登录态：
 *   微信一键登录是静默的，所以 api.js 会把「用户主动退出」持久化成一个标记，
 *   退出后 ensureLogin() 一律拒绝 —— 否则页面 onShow 一刷新就又被登回来了。
 */

const api = require('./api')
const config = require('./config')

const MAX_MEMBERS = 20
const MAX_THEME = 10
const MAX_OPTION = 20

/* ------------------------- 当前用户 ------------------------- */

/** 同步取当前用户（来自本地缓存），未登录时 uid 为 0 */
function getMe() {
  const u = api.getUser()
  if (!u) return { uid: 0, name: '', avatarUrl: '' }
  return {
    uid: u.id,
    name: u.nickName,
    // 服务端只下发相对地址（/api/users/1/avatar?v=2），这里补成能直接塞进 <image src> 的完整地址
    avatarUrl: api.absoluteUrl(u.avatarUrl || '')
  }
}

function isLoggedIn() {
  return !!api.getToken() && !!api.getUser()
}

/** 用户主动退出登录后为 true —— 页面据此显示未登录状态，而不是被静默登回去 */
function isLoggedOut() {
  return api.isLoggedOut()
}

function isDevMode() {
  return !!config.allowDevLogin
}

/** 登录（必要时触发）。保留旧名字以便与页面兼容。 */
function ensureIdentity(force) {
  return api.ensureLogin(force)
}

function ensureLogin(force) {
  return api.ensureLogin(force)
}

/**
 * 微信一键登录（用户点按钮触发）。
 * 自建服务这边登录不需要弹授权框，点一下即可；返回结构与云版保持一致。
 */
async function loginByWeChat() {
  try {
    const user = await api.loginExplicit()
    return { ok: true, user: user }
  } catch (e) {
    return { ok: false, error: (e && e.message) || '微信登录失败' }
  }
}

/**
 * 改昵称。服务端会同步更新已加入小队里的显示名与队长名。
 * 头像不走这里 —— 见 saveAvatar / saveProfile。
 */
async function updateMyProfile(nickName) {
  const res = await api.call('PUT', '/api/me', { nickName: nickName })
  if (!res.ok) return res

  const prev = api.getUser() || {}
  const merged = {}
  for (const k in res.user) merged[k] = res.user[k]
  // 开发模式下要继续带着稳定的 deviceKey，否则下次冷启动会变成另一个账号
  if (prev.devKey) {
    merged.devKey = prev.devKey
    merged.devName = res.user.nickName
  }
  api.setUser(merged)

  if (prev.devKey) {
    const list = allDevIdentities()
    let changed = false
    list.forEach(function (i) {
      if (i.uid === res.user.id) { i.name = res.user.nickName; changed = true }
    })
    if (changed) api.setDevIdentities(list)
  }

  return res
}

/** 上传头像（base64 + mime），成功后把新的头像地址写回本地缓存 */
async function saveAvatar(imageBase64, contentType) {
  const res = await api.uploadAvatar(imageBase64, contentType)
  if (!res.ok) return res

  const prev = api.getUser() || {}
  prev.avatarUrl = res.avatarUrl || ''
  api.setUser(prev)

  return { ok: true, avatarUrl: getMe().avatarUrl }
}

/**
 * 「我的」页保存资料：一次提交昵称 + 头像。
 * 头像只有一个（不可清空），传了才更新；昵称为空时只更新头像。
 */
async function saveProfile(opt) {
  opt = opt || {}
  const name = String(opt.name || '').trim()

  if (name && name.length > 16) return { ok: false, error: '昵称最多 16 个字符' }

  if (opt.avatarBase64) {
    const up = await saveAvatar(opt.avatarBase64, opt.contentType)
    if (!up.ok) return up
  }

  if (name) {
    const res = await updateMyProfile(name)
    if (!res.ok) return res
  }

  const me = getMe()
  return { ok: true, name: me.name, avatarUrl: me.avatarUrl }
}

function logout() {
  api.logout()
}

/* ------------------------- 身份（仅开发模式） ------------------------- */

/**
 * 开发模式下的本机测试身份：每个昵称对应一个开发账号，
 * 用来在一台设备上模拟多人协作（替代之前在本地 Storage 里造假的身份）。
 */
/** 当前登录用户若来自开发模式，带上其稳定的 deviceKey */
function devKeyOfMe() {
  const u = api.getUser()
  return (u && u.devKey) || ''
}

function allDevIdentities() {
  const cached = api.getDevIdentities().slice()
  const me = getMe()
  const key = devKeyOfMe()
  if (me.uid && !cached.some(function (i) { return i.uid === me.uid })) {
    cached.unshift({ uid: me.uid, name: me.name, key: key })
  }
  return cached
}

function listIdentities() {
  if (!isDevMode()) {
    const me = getMe()
    return me.uid ? [{ uid: me.uid, name: me.name }] : []
  }
  return allDevIdentities()
}

async function addIdentity(name) {
  if (!isDevMode()) return null
  const t = String(name || '').trim()
  if (!t) return null

  // 关键：登录会把当前身份切走，所以必须在登录之前先把现有身份列表快照下来，
  // 否则原来的身份会从列表里消失，之后就切不回去了。
  const before = allDevIdentities()
  const key = 'dev-' + api.randomKey()

  const r = await api.loginByDev(t, key)
  if (!r.ok) return null

  const item = { uid: r.user.id, name: r.user.nickName, key: key }
  const list = before.slice()
  if (!list.some(function (i) { return i.uid === item.uid })) list.push(item)
  api.setDevIdentities(list)

  const u = api.getUser() || {}
  u.devName = t
  u.devKey = key
  api.setUser(u)
  return item
}

async function switchIdentity(uid) {
  if (!isDevMode()) return false
  const target = allDevIdentities().filter(function (i) { return i.uid === Number(uid) })[0]
  if (!target) return false

  // 用稳定的 deviceKey 登录，昵称变了也不会换账号
  const r = await api.loginByDev(target.name, target.key)
  if (!r.ok) return false

  const u = api.getUser() || {}
  u.devName = target.name
  u.devKey = target.key
  api.setUser(u)

  if (r.user.nickName && r.user.nickName !== target.name) {
    const list = allDevIdentities()
    list.forEach(function (i) { if (i.uid === target.uid) i.name = r.user.nickName })
    api.setDevIdentities(list)
  }
  return true
}

function removeIdentity(uid) {
  if (!isDevMode()) return false
  const me = getMe()
  if (me.uid === Number(uid)) return false
  api.setDevIdentities(allDevIdentities().filter(function (i) { return i.uid !== Number(uid) }))
  return true
}

/**
 * 改昵称。开发身份同样支持：先切过去改名再切回来。
 * 因为账号由 deviceKey 标识，uid 不变，所以组内关系不会丢。
 */
async function renameIdentity(uid, name) {
  const t = String(name || '').trim()
  if (!t) return false
  const me = getMe()

  if (me.uid === Number(uid)) {
    const res = await updateMyProfile(t)
    return !!res.ok
  }

  if (!isDevMode()) return false
  const switched = await switchIdentity(uid)
  if (!switched) return false
  const res = await updateMyProfile(t)
  await switchIdentity(me.uid)
  return !!res.ok
}

/* ------------------------- 小队 ------------------------- */

async function listGroups(keyword) {
  const kw = String(keyword || '').trim()
  const path = kw ? '/api/groups?keyword=' + encodeURIComponent(kw) : '/api/groups'
  const res = await api.callValue('GET', path, undefined, null)
  return (res && res.groups) || []
}

async function getGroup(id) {
  const res = await loadGroupBundle(id)
  return (res && res.ok && res.group) || null
}

/**
 * 小队页轮询用：一次拿回小队、成员、备选项、权重与我的身份。
 * 相比逐项请求，轮询时只需要 1 个请求。
 * 注意：失败时也会返回带 ok=false 的对象，页面据此区分「小队不存在」与「网络异常」。
 */
async function loadGroupBundle(id) {
  const res = await api.callValue('GET', '/api/groups/' + Number(id), undefined, null)
  return res || { ok: false, error: '请求失败' }
}

async function createGroup(opt) {
  opt = opt || {}
  return api.call('POST', '/api/groups', {
    theme: String(opt.theme || '').trim(),
    passcode: String(opt.passcode || '').trim()
  })
}

/** 只提交请求里真正想改的字段，避免误清掉口令 */
async function updateGroup(id, patch) {
  const body = {}
  if (patch && patch.theme !== undefined) body.theme = patch.theme
  if (patch && patch.passcode !== undefined) body.passcode = patch.passcode
  if (Object.keys(body).length === 0) {
    return { ok: true, group: await getGroup(id) }
  }
  return api.call('PATCH', '/api/groups/' + Number(id), body)
}

async function isMember(groupId, uid) {
  const bundle = await loadGroupBundle(groupId)
  if (!bundle || !bundle.ok) return false
  const u = uid === undefined ? getMe().uid : Number(uid)
  return (bundle.members || []).some(function (m) { return m.uid === u })
}

async function joinGroup(id, opt) {
  opt = opt || {}
  return api.call('POST', '/api/groups/' + Number(id) + '/join', {
    passcode: String(opt.passcode || '').trim()
  })
}

async function leaveGroup(groupId) {
  return api.call('POST', '/api/groups/' + Number(groupId) + '/leave')
}

async function deleteGroup(groupId) {
  return api.call('DELETE', '/api/groups/' + Number(groupId))
}

/* ------------------------- 成员 ------------------------- */

async function listMembers(groupId) {
  const bundle = await loadGroupBundle(groupId)
  return (bundle && bundle.ok && bundle.members) || []
}

/** 兼容旧接口：现在的准备状态由服务端在 ready 接口里维护 */
async function setReady() {
  return { ok: true }
}

async function resetReady() {
  return { ok: true }
}

/* ------------------------- 备选项 ------------------------- */

async function listOptions(groupId) {
  const bundle = await loadGroupBundle(groupId)
  return (bundle && bundle.ok && bundle.options) || []
}

/** 添加备选项；服务端会在同一步里为创建者投一票，返回 autoVoted=true */
async function addOption(groupId, title) {
  return api.call('POST', '/api/groups/' + Number(groupId) + '/options', {
    title: String(title || '').trim()
  })
}

async function deleteOption(optionId) {
  return api.call('DELETE', '/api/options/' + Number(optionId))
}

async function toggleVote(optionId) {
  return api.call('POST', '/api/options/' + Number(optionId) + '/vote')
}

/* ------------------------- 权重与阶段 ------------------------- */

async function computeWeights(groupId) {
  const bundle = await loadGroupBundle(groupId)
  return (bundle && bundle.ok && bundle.weights) || { items: [], totalVotes: 0, uniform: false }
}

/** 开启准备环节（仅小队长）。deadlineSeconds 为 0 或 null 表示不限时。 */
async function startPrepare(groupId, deadlineSeconds) {
  const v = Number(deadlineSeconds || 0)
  return api.call('POST', '/api/groups/' + Number(groupId) + '/prepare', {
    deadlineSeconds: v > 0 ? v : null
  })
}

async function confirmReady(groupId) {
  return api.call('POST', '/api/groups/' + Number(groupId) + '/ready', { action: 'confirm' })
}

async function cancelReady(groupId) {
  return api.call('POST', '/api/groups/' + Number(groupId) + '/ready', { action: 'cancel' })
}

/** 取本轮结果（幂等）。服务端同时会推进阶段并保证一轮只产出一个结果。 */
async function rollPick(groupId) {
  return api.call('POST', '/api/groups/' + Number(groupId) + '/roll')
}

async function backToConfig(groupId) {
  return api.call('POST', '/api/groups/' + Number(groupId) + '/reset')
}

/* ------------------------- 通知 ------------------------- */

async function listNotifications() {
  const res = await api.callValue('GET', '/api/notifications', undefined, null)
  return (res && res.items) || []
}

async function unreadCount() {
  const res = await api.callValue('GET', '/api/notifications/unread', undefined, null)
  return (res && typeof res.unread === 'number') ? res.unread : 0
}

async function markAllRead() {
  return api.call('POST', '/api/notifications/read')
}

async function clearNotifications() {
  return api.call('DELETE', '/api/notifications')
}

/** 通知改由服务端在业务动作里写入，这里保留空实现以兼容旧调用 */
function pushNotification() {
  return true
}

/* ------------------------- 维护 ------------------------- */

async function myStats() {
  const res = await api.callValue('GET', '/api/me/stats', undefined, null)
  return (res && res.stats) || { joinedCount: 0, ownedCount: 0 }
}

/**
 * 退出登录：清掉本机 token 与账号缓存，并留下「已主动退出」标记。
 * 标记不清掉的话，下一次 ensureLogin 会立刻静默登录回来 —— 看起来就像退出没生效。
 * 云端数据不受影响。
 */
function resetAll() {
  api.logout()
  api.setDevIdentities([])
  return true
}

/** 环境信息，便于「我的」页排查连不上服务端的问题 */
function envInfo() {
  return {
    dataSource: 'server',
    env: config.env,
    baseUrl: config.baseUrl,
    allowDevLogin: config.allowDevLogin,
    loggedIn: isLoggedIn(),
    loggedOut: isLoggedOut(),
    // 自建服务没有邮箱验证码登录（那是云服务特有的），页面据此决定要不要展示这一段
    supportEmailLogin: false
  }
}

module.exports = {
  MAX_MEMBERS,
  MAX_THEME,
  MAX_OPTION,

  ensureIdentity,
  ensureLogin,
  loginByWeChat,
  getMe,
  isLoggedIn,
  isLoggedOut,
  isDevMode,
  updateMyProfile,
  saveAvatar,
  saveProfile,
  logout,
  listIdentities,
  switchIdentity,
  addIdentity,
  renameIdentity,
  removeIdentity,

  listGroups,
  getGroup,
  loadGroupBundle,
  createGroup,
  updateGroup,
  isMember,
  joinGroup,
  leaveGroup,
  deleteGroup,

  listMembers,
  setReady,
  resetReady,

  listOptions,
  addOption,
  deleteOption,
  toggleVote,

  computeWeights,
  startPrepare,
  confirmReady,
  cancelReady,
  rollPick,
  backToConfig,

  listNotifications,
  unreadCount,
  markAllRead,
  clearNotifications,
  pushNotification,

  myStats,
  resetAll,
  envInfo
}
