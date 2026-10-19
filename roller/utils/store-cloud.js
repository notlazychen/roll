/**
 * 数据层 · 云服务实现
 * ---------------------------------------------------------------
 * 全部数据存在微信云服务（云数据库 + 业务函数），这里只负责调用。
 *
 * 方法名与返回结构与 utils/store-http.js（自建服务版本）完全一致，
 * 因此 utils/store.js 可以按配置在两者之间切换，而页面代码不用改：
 *   - 写入类返回 { ok, error?, ... }
 *   - 读取类返回数组或对象（失败时给兜底值，并节流提示一次）
 *
 * 关键差异（相比自建服务版）：
 *   1) 账号是真实云端账号，uid 是字符串（auth.uid()），不再是自增数字；
 *      业务 id（小队 / 备选项）仍然是数字。
 *   2) 阶段推进与加权随机都在数据库函数里完成，客户端只负责发起动作与轮询。
 *   3) 没有「本机切换测试身份」，换人了就用别的微信账号或邮箱登录。
 *
 * 数据库结构、RLS 与函数定义见 server/sql/cloud-database.sql。
 */

const config = require('./config')
const { cloud } = require('./cloud')

const MAX_MEMBERS = 20
const MAX_THEME = 10
const MAX_OPTION = 20

const USER_KEY = 'rg_cloud_user_v1'
const NICK_KEY = 'rg_cloud_nick_v1'
const LOCAL_AVATAR_KEY = 'rg_cloud_avatar_v1'
const LOGOUT_KEY = 'rg_logged_out_v2'

/* ------------------------- 本地缓存 ------------------------- */

function readStorage(key, fallback) {
  try {
    const v = wx.getStorageSync(key)
    if (v === '' || v === undefined || v === null) return fallback
    return v
  } catch (e) {
    return fallback
  }
}

function writeStorage(key, value) {
  try { wx.setStorageSync(key, value) } catch (e) {}
}

function removeStorage(key) {
  try { wx.removeStorageSync(key) } catch (e) {}
}

/**
 * 「用户主动退出登录」标记（与 utils/api.js 用同一个 key）。
 * 不留下这个标记的话，清会话之后 ensureLogin 会立刻静默登录回来，
 * 「退出登录」就等于没做。
 */
function isLoggedOut() {
  return !!readStorage(LOGOUT_KEY, false)
}

function setLoggedOut(flag) {
  if (flag) writeStorage(LOGOUT_KEY, true)
  else removeStorage(LOGOUT_KEY)
}

/** 昵称由用户自己设置，微信登录不提供昵称 */
function getNickname() {
  return String(readStorage(NICK_KEY, '') || '')
}

function setNickname(name) {
  writeStorage(NICK_KEY, String(name || ''))
}

function getCachedUser() {
  const u = readStorage(USER_KEY, null)
  return u && typeof u === 'object' ? u : null
}

function setCachedUser(u) {
  if (u) writeStorage(USER_KEY, u)
  else removeStorage(USER_KEY)
}

/* ------------------------- 错误文案 ------------------------- */

function errText(error, fallback) {
  const raw = (error && (error.message || error.error_description || error.code)) || ''
  const text = String(raw || '').trim()
  if (!text) return fallback || '操作失败'
  if (/not in domain list|domain list/i.test(text)) {
    return '请求域名未在合法域名列表中，请在微信后台配置后重试'
  }
  if (/timeout|timed out/i.test(text)) return '请求超时，请检查网络后重试'
  if (/network|abort|ERR_/i.test(text)) return '网络异常，请检查网络后重试'
  // 云后端拿 wx.login 的 code 去微信换会话时被拒（invalid_client）：
  // 平台侧还没有当前小程序的有效凭证 —— 应用还没绑定小程序，
  // 或绑定的 appid 与当前运行的不一致。这是配置问题，不是代码问题。
  if (/credential is invalid|client credential|invalid_client|revoked/i.test(text)) {
    return '微信一键登录还未绑定到当前小程序：可先用下方的邮箱验证码登录，发布并绑定小程序后即可使用微信登录'
  }
  if (/未打开微信登录|wechat/i.test(text)) {
    return '该应用尚未开启微信登录，可先用邮箱验证码登录'
  }
  return text
}

/* ------------------------- 节流提示 ------------------------- */

// 小队页每秒轮询，网络异常时不能每秒弹一次 toast
let lastToast = { msg: '', at: 0 }

function toastOnce(msg) {
  if (!msg) return
  const now = Date.now()
  if (msg === lastToast.msg && now - lastToast.at < 5000) return
  lastToast = { msg: msg, at: now }
  try { wx.showToast({ title: String(msg), icon: 'none', duration: 2000 }) } catch (e) {}
}

/* ------------------------- 调用业务函数 ------------------------- */

function unwrapRpcData(data) {
  if (Array.isArray(data)) {
    if (data.length === 0) return null
    if (data.length === 1) return data[0]
  }
  return data
}

/**
 * 调用云数据库里的业务函数（rpc）。
 * 不抛异常：出错统一返回 { ok:false, error }，与页面写法保持一致。
 */
async function rpc(fn, args) {
  let res
  try {
    res = await cloud.database.rpc(fn, args || {})
  } catch (e) {
    return { ok: false, error: (e && e.message) || '网络异常，请重试' }
  }
  if (res && res.error) {
    return { ok: false, error: errText(res.error, '请求失败') }
  }
  const data = unwrapRpcData(res && res.data)
  if (data === null || data === undefined) {
    return { ok: false, error: '服务未返回数据，请重试' }
  }
  return data
}

/* ------------------------- 当前用户 ------------------------- */

function getMe() {
  const u = getCachedUser()
  if (!u || !u.id) return { uid: '', name: '', avatarUrl: '' }
  return {
    uid: String(u.id),
    name: u.name || getNickname() || '冒险者',
    // 优先本机头像（云版没有头像字段）
    avatarUrl: u.localAvatar || u.avatarUrl || ''
  }
}

function isLoggedIn() {
  const u = getCachedUser()
  return !!(u && u.id)
}

/** 云服务使用真实账号，没有「在一台设备上模拟多人」的本地测试身份 */
function isDevMode() {
  return false
}

function applySession(session) {
  const su = session && session.user
  if (!su || !su.id) return null
  const cached = {
    id: String(su.id),
    name: getNickname() || su.name || '冒险者',
    avatarUrl: su.avatarUrl || '',
    // 云版没有头像字段，用户在这里选的头像只能存在本机（换设备/重新登录会丢）
    localAvatar: readStorage(LOCAL_AVATAR_KEY, '')
  }
  setCachedUser(cached)
  // 登录成功即视为「重新登录」，清掉主动退出标记
  setLoggedOut(false)
  return cached
}

/* ------------------------- 登录 ------------------------- */

function currentAppId() {
  try {
    const info = wx.getAccountInfoSync()
    return (info && info.miniProgram && info.miniProgram.appId) || ''
  } catch (e) {
    return ''
  }
}

function wxLoginCode() {
  return new Promise(function (resolve, reject) {
    wx.login({
      success: function (r) {
        if (r && r.code) resolve(r.code)
        else reject(new Error('未取到微信登录凭证'))
      },
      fail: function (e) {
        reject(new Error((e && e.errMsg) || '调用微信登录失败'))
      }
    })
  })
}

/** 微信一键登录：wx.login 取 code，交给云服务换会话（内部使用） */
async function wechatSignIn() {
  let code = ''
  try {
    code = await wxLoginCode()
  } catch (e) {
    return { ok: false, error: (e && e.message) || '调用微信登录失败' }
  }

  let res
  try {
    res = await cloud.auth.signInWithWechat(code, currentAppId())
  } catch (e) {
    return { ok: false, error: (e && e.message) || '微信登录失败，请重试' }
  }
  if (res && res.error) {
    return { ok: false, error: errText(res.error, '微信登录失败，请重试') }
  }
  const u = applySession(res && res.data)
  if (!u) return { ok: false, error: '微信登录未返回账号信息' }
  return { ok: true, user: getMe() }
}

/**
 * 邮箱验证码登录 · 第一步：发送验证码。
 * 在没有微信授权环境的场景下（例如开发者工具）可以用它登录，方便联调。
 */
async function sendEmailCode(email) {
  const addr = String(email || '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
    return { ok: false, error: '请输入正确的邮箱地址' }
  }

  let res
  try {
    res = await cloud.auth.sendOtp({ email: addr })
  } catch (e) {
    return { ok: false, error: (e && e.message) || '验证码发送失败' }
  }
  if (res && res.error) {
    return { ok: false, error: errText(res.error, '验证码发送失败') }
  }
  const d = (res && res.data) || {}
  return {
    ok: true,
    email: addr,
    verificationId: d.verificationId,
    isExistingUser: !!d.isExistingUser
  }
}

/** 邮箱验证码登录 · 第二步：校验并建立会话（pending 必须是刚发送时保存的那一份） */
async function submitEmailCode(pending, token) {
  if (!pending || !pending.verificationId) {
    return { ok: false, error: '请先获取邮箱验证码' }
  }
  const code = String(token || '').trim()
  if (!code) return { ok: false, error: '请输入邮箱验证码' }

  let res
  try {
    res = await cloud.auth.verifyOtp({
      email: pending.email,
      verificationId: pending.verificationId,
      isExistingUser: pending.isExistingUser,
      token: code
    })
  } catch (e) {
    return { ok: false, error: (e && e.message) || '验证码校验失败' }
  }
  if (res && res.error) {
    return { ok: false, error: errText(res.error, '验证码不正确或已过期') }
  }
  const u = applySession(res && res.data)
  if (!u) return { ok: false, error: '登录未返回账号信息' }
  return { ok: true, user: getMe() }
}

let loginPromise = null

/**
 * 确保处于登录态。
 * 1) 本地已有账号且未强制刷新 → 直接用；
 * 2) 否则先尝试恢复云端会话（SDK 会自动续期）；
 * 3) 再退到微信一键登录。
 * 微信登录不可用时抛错，由页面引导用户到「我的」页用邮箱验证码登录。
 */
function ensureLogin(force) {
  if (!force && isLoggedIn()) return Promise.resolve(getMe())
  // 用户主动退出过：不再静默登录，等他自己点「登录」
  if (isLoggedOut()) {
    const err = new Error('已退出登录，点「微信一键登录」可以重新登录')
    err.needsManualLogin = true
    return Promise.reject(err)
  }
  if (loginPromise) return loginPromise

  loginPromise = (async function () {
    if (!force) {
      try {
        const s = await cloud.auth.getSession()
        if (s && !s.error && s.data) {
          const u = applySession(s.data)
          if (u) return getMe()
        }
      } catch (e) {}
    }

    const r = await wechatSignIn()
    if (r.ok) return r.user

    const err = new Error(r.error || '登录失败')
    err.needsManualLogin = true
    throw err
  })()

  loginPromise.then(
    function () { loginPromise = null },
    function () { loginPromise = null }
  )
  return loginPromise
}

function ensureIdentity(force) {
  return ensureLogin(force)
}

async function signOut() {
  try { await cloud.auth.signOut() } catch (e) {}
  setCachedUser(null)
  removeStorage(LOCAL_AVATAR_KEY)
  // 留下标记，避免下一次 ensureLogin 又静默登回来
  setLoggedOut(true)
}

function logout() {
  return signOut()
}

/**
 * 微信一键登录（用户主动点按钮时调用）。
 * 先清掉「已主动退出」标记，再强制登录一次。
 * 与自建服务版同名同结构，页面代码不用区分数据源。
 */
async function loginByWeChat() {
  setLoggedOut(false)
  try {
    const user = await ensureLogin(true)
    return { ok: true, user: user }
  } catch (e) {
    return { ok: false, error: (e && e.message) || '微信登录失败' }
  }
}

/* ------------------------- 昵称 ------------------------- */

/** 改昵称：本地立即生效，同时同步到云端所有「我在的小队」里的显示名 */
async function updateMyProfile(nickName) {
  const name = String(nickName || '').trim()
  if (!name) return { ok: false, error: '昵称不能为空' }
  if (name.length > 12) return { ok: false, error: '昵称最多 12 个字' }

  setNickname(name)
  const cur = getCachedUser()
  if (cur) {
    cur.name = name
    setCachedUser(cur)
  }

  const res = await rpc('roll_set_nickname', { p_name: name })
  if (!res || res.ok === false) {
    return res || { ok: false, error: '保存失败，请重试' }
  }
  return { ok: true, name: name, user: getMe() }
}

/**
 * 保存头像。
 * 说明：云服务的用户表没有头像字段（roll_set_nickname 只改昵称），
 * 所以云版只能把头像存在本机 —— 换设备或清缓存后会回到「底色 + 首字」占位。
 * 自建服务版是真正上传到服务端存库的，两边行为差异只在这里。
 */
function saveAvatar(imageBase64) {
  const data = String(imageBase64 || '')
  if (!data) return { ok: false, error: '没有读取到头像数据' }

  const uri = data.indexOf('data:') === 0 ? data : 'data:image/jpeg;base64,' + data
  writeStorage(LOCAL_AVATAR_KEY, uri)

  const cur = getCachedUser()
  if (cur) {
    cur.localAvatar = uri
    setCachedUser(cur)
  }
  return { ok: true, avatarUrl: uri }
}

/** 「我的」页保存资料：一次提交昵称 + 头像（语义与自建服务版一致） */
async function saveProfile(opt) {
  opt = opt || {}
  const name = String(opt.name || '').trim()
  if (name && name.length > 12) return { ok: false, error: '昵称最多 12 个字' }

  if (opt.avatarBase64) {
    const up = saveAvatar(opt.avatarBase64)
    if (!up.ok) return up
  }

  if (name) {
    const res = await updateMyProfile(name)
    if (!res.ok) return res
  }

  const me = getMe()
  return { ok: true, name: me.name, avatarUrl: me.avatarUrl }
}

/* ------------------------- 身份（云版只有自己） ------------------------- */

function listIdentities() {
  const me = getMe()
  return me.uid ? [{ uid: me.uid, name: me.name }] : []
}

function switchIdentity() {
  return false
}

function addIdentity() {
  return null
}

function renameIdentity(uid, name) {
  const me = getMe()
  if (String(uid) !== me.uid) return false
  return updateMyProfile(name)
}

function removeIdentity() {
  return false
}

/* ------------------------- 冒险者大厅 ------------------------- */

async function listGroups(keyword) {
  const kw = String(keyword || '').trim()
  const res = await rpc('roll_hall', { p_keyword: kw })
  if (!res || res.ok === false) {
    if (res && res.error) toastOnce(res.error)
    return []
  }
  return res.groups || []
}

async function getGroup(id) {
  const res = await loadGroupBundle(id)
  return (res && res.ok && res.group) || null
}

/**
 * 小队页轮询用：一次拿回小队、成员、备选项、权重与我的身份。
 * 云版里 roll_sync 同时负责推进阶段（超时 / 全员确认）与产出结果，
 * 所以轮询只需要 1 次调用。
 */
async function loadGroupBundle(id) {
  const gid = Number(id)
  if (!gid) return { ok: false, error: '小队参数有误' }
  const res = await rpc('roll_sync', { p_group_id: gid })
  if (!res || res.ok === false) {
    return res && res.error ? res : { ok: false, error: '请求失败' }
  }
  res.me = getMe()
  return res
}

async function createGroup(opt) {
  opt = opt || {}
  const me = getMe()
  const res = await rpc('roll_create_group', {
    p_theme: String(opt.theme || '').trim(),
    p_passcode: String(opt.passcode || '').trim(),
    p_user_name: me.name
  })
  if (!res || res.ok === false) {
    return res || { ok: false, error: '创建失败，请重试' }
  }
  return { ok: true, group: { id: Number(res.groupId), code: res.code } }
}

/**
 * 只提交请求里真正想改的字段，避免误清掉口令。
 * 主题与口令是两个独立的开关：
 *   - 只想改主题 → p_theme 有值，p_change_passcode=false、p_passcode=null（原口令不动）
 *   - 只想改口令 → p_theme=null，p_change_passcode=true，p_passcode 传新值（传空串表示取消口令）
 * 返回后页面会自己 reload 拿最新快照，所以这里不再多打一次 roll_sync。
 */
async function updateGroup(id, patch) {
  patch = patch || {}
  const hasTheme = patch.theme !== undefined
  const hasPass = patch.passcode !== undefined
  if (!hasTheme && !hasPass) return { ok: true }

  const res = await rpc('roll_update_group', {
    p_group_id: Number(id),
    p_theme: hasTheme ? String(patch.theme).trim() : null,
    p_passcode: hasPass ? String(patch.passcode).trim() : null,
    p_change_passcode: hasPass
  })
  if (!res || res.ok === false) {
    return res || { ok: false, error: '保存失败，请重试' }
  }
  return { ok: true }
}

async function isMember(groupId, uid) {
  const bundle = await loadGroupBundle(groupId)
  if (!bundle || !bundle.ok) return false
  const target = uid === undefined ? getMe().uid : String(uid)
  return (bundle.members || []).some(function (m) {
    return String(m.uid) === target
  })
}

async function joinGroup(id, opt) {
  opt = opt || {}
  const me = getMe()
  const res = await rpc('roll_join', {
    p_group_id: Number(id),
    p_passcode: String(opt.passcode || '').trim(),
    p_user_name: me.name
  })
  return res || { ok: false, error: '加入失败，请重试' }
}

async function leaveGroup(groupId) {
  const res = await rpc('roll_leave', { p_group_id: Number(groupId) })
  return res || { ok: false, error: '退出失败，请重试' }
}

async function deleteGroup(groupId) {
  const res = await rpc('roll_delete_group', { p_group_id: Number(groupId) })
  return res || { ok: false, error: '解散失败，请重试' }
}

/* ------------------------- 成员 ------------------------- */

async function listMembers(groupId) {
  const bundle = await loadGroupBundle(groupId)
  return (bundle && bundle.ok && bundle.members) || []
}

/** 兼容旧接口：准备状态现在由 roll_set_ready 维护 */
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

/** 添加备选项：云端会在同一步里为创建者投一票，返回 autoVoted=true */
async function addOption(groupId, title) {
  const me = getMe()
  const res = await rpc('roll_add_option', {
    p_group_id: Number(groupId),
    p_title: String(title || '').trim(),
    p_user_name: me.name
  })
  return res || { ok: false, error: '添加失败，请重试' }
}

async function deleteOption(optionId) {
  const res = await rpc('roll_delete_option', { p_option_id: Number(optionId) })
  return res || { ok: false, error: '删除失败，请重试' }
}

async function toggleVote(optionId) {
  const res = await rpc('roll_toggle_vote', { p_option_id: Number(optionId) })
  return res || { ok: false, error: '操作失败，请重试' }
}

/* ------------------------- 权重与阶段 ------------------------- */

async function computeWeights(groupId) {
  const bundle = await loadGroupBundle(groupId)
  return (bundle && bundle.ok && bundle.weights) || { items: [], totalVotes: 0, uniform: false }
}

/** 开启准备环节（仅队长）。deadlineSeconds 为 0 或 null 表示不限时。 */
async function startPrepare(groupId, deadlineSeconds) {
  const v = Number(deadlineSeconds || 0)
  const res = await rpc('roll_start_prepare', {
    p_group_id: Number(groupId),
    p_seconds: v > 0 ? v : 0
  })
  return res || { ok: false, error: '开启失败，请重试' }
}

async function confirmReady(groupId) {
  const res = await rpc('roll_set_ready', { p_group_id: Number(groupId), p_action: 'confirm' })
  return res || { ok: false, error: '操作失败，请重试' }
}

async function cancelReady(groupId) {
  const res = await rpc('roll_set_ready', { p_group_id: Number(groupId), p_action: 'cancel' })
  return res || { ok: false, error: '操作失败，请重试' }
}

/**
 * 取本轮结果（幂等）。
 * 云版把「推进阶段 + 加权抽取 + 写通知」都放在数据库函数 roll_sync 里，
 * 由条件更新保证一轮只产出一个结果，所以这里复用同一个入口。
 */
async function rollPick(groupId) {
  const res = await loadGroupBundle(groupId)
  if (!res || !res.ok) return res || { ok: false, error: '请求失败' }
  return { ok: true, group: res.group }
}

async function backToConfig(groupId) {
  const res = await rpc('roll_back_to_config', { p_group_id: Number(groupId) })
  return res || { ok: false, error: '操作失败，请重试' }
}

/* ------------------------- 通知 ------------------------- */

async function listNotifications() {
  let res
  try {
    res = await cloud.database
      .from('roll_notifications')
      .select('id, group_id, group_theme, type, content, is_read, created_at')
      .order('created_at', { ascending: false })
      .limit(MAX_MEMBERS * 10)
  } catch (e) {
    toastOnce('通知加载失败')
    return []
  }
  if (res.error) {
    toastOnce(errText(res.error, '通知加载失败'))
    return []
  }
  return (res.data || []).map(function (n) {
    return {
      id: Number(n.id),
      groupId: n.group_id === null || n.group_id === undefined ? 0 : Number(n.group_id),
      groupTheme: n.group_theme || '',
      type: n.type,
      content: n.content,
      read: !!n.is_read,
      createdAt: n.created_at ? new Date(n.created_at).getTime() : 0
    }
  })
}

async function unreadCount() {
  let res
  try {
    res = await cloud.database
      .from('roll_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('is_read', false)
  } catch (e) {
    return 0
  }
  if (res.error) return 0
  return typeof res.count === 'number' ? res.count : 0
}

async function markAllRead() {
  const res = await rpc('roll_mark_notifications_read', {})
  return res || { ok: false, error: '操作失败，请重试' }
}

async function clearNotifications() {
  const res = await rpc('roll_clear_notifications', {})
  return res || { ok: false, error: '操作失败，请重试' }
}

/** 通知由云端在业务动作里写入，这里保留空实现以兼容旧调用 */
function pushNotification() {
  return true
}

/* ------------------------- 维护 ------------------------- */

async function myStats() {
  const res = await rpc('roll_my_stats', {})
  if (!res || res.ok === false) return { joinedCount: 0, ownedCount: 0 }
  return { joinedCount: res.joinedCount || 0, ownedCount: res.ownedCount || 0 }
}

/** 退出登录并清掉本机缓存（云端数据不受影响） */
async function resetAll() {
  await signOut()
  setNickname('')
  removeStorage(LOCAL_AVATAR_KEY)
  return true
}

/** 连接信息，便于「我的」页排查问题 */
function envInfo() {
  return {
    dataSource: 'cloud',
    env: 'cloud',
    baseUrl: config.cloud.endpoint,
    allowDevLogin: false,
    loggedIn: isLoggedIn(),
    loggedOut: isLoggedOut(),
    // 云服务自带邮箱验证码登录
    supportEmailLogin: true
  }
}

module.exports = {
  MAX_MEMBERS,
  MAX_THEME,
  MAX_OPTION,

  ensureIdentity,
  ensureLogin,
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
  envInfo,

  // 两个数据源都有的登录入口
  loginByWeChat,

  // 云服务特有的登录方式（自建服务版没有，页面通过 envInfo().supportEmailLogin 判断）
  sendEmailCode,
  submitEmailCode,
  signOut
}
