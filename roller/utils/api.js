/**
 * 网络层
 * ---------------------------------------------------------------
 * 统一处理：baseUrl 拼接、token 注入、401 自动重新登录、错误归一化。
 * 所有方法都返回 Promise，并且**不抛异常**——失败时返回 { ok:false, error }，
 * 这样页面里的 `if (!res.ok) return util.toast(res.error)` 写法可以原样保留。
 */

const config = require('./config')

const TOKEN_KEY = 'rg_token_v2'
const USER_KEY = 'rg_user_v2'
const DEV_IDS_KEY = 'rg_dev_identities_v2'
const LOGOUT_KEY = 'rg_logged_out_v2'

/* ------------------------- 本地缓存 ------------------------- */

function getToken() {
  try { return wx.getStorageSync(TOKEN_KEY) || '' } catch (e) { return '' }
}

function setToken(token) {
  try { wx.setStorageSync(TOKEN_KEY, token || '') } catch (e) {}
}

function getUser() {
  try { return wx.getStorageSync(USER_KEY) || null } catch (e) { return null }
}

function setUser(user) {
  try { wx.setStorageSync(USER_KEY, user || null) } catch (e) {}
}

function getDevIdentities() {
  try {
    const v = wx.getStorageSync(DEV_IDS_KEY)
    return Array.isArray(v) ? v : []
  } catch (e) { return [] }
}

function setDevIdentities(list) {
  try { wx.setStorageSync(DEV_IDS_KEY, list || []) } catch (e) {}
}

function clearSession() {
  try {
    wx.removeStorageSync(TOKEN_KEY)
    wx.removeStorageSync(USER_KEY)
  } catch (e) {}
}

/**
 * 「用户主动退出登录」标记。
 * ---------------------------------------------------------------
 * 微信一键登录是静默的（wx.login 不弹授权框），所以光清掉 token 没用：
 * 下一次 ensureLogin() 会立刻又把人静默登回来，界面看起来「退出登录不起作用」。
 * 因此把「已主动退出」持久化下来，只有用户再点一次登录按钮才会清除。
 */
function isLoggedOut() {
  try { return !!wx.getStorageSync(LOGOUT_KEY) } catch (e) { return false }
}

function setLoggedOut(flag) {
  try {
    if (flag) wx.setStorageSync(LOGOUT_KEY, true)
    else wx.removeStorageSync(LOGOUT_KEY)
  } catch (e) {}
}

/* ------------------------- 网络错误文案 ------------------------- */

function networkMessage(err) {
  const raw = (err && (err.errMsg || err.message)) || ''
  if (/domain list|not in domain/i.test(raw)) {
    return '请求域名未在合法域名列表中：开发时请在开发者工具勾选「不校验合法域名」，上线前需在后台配置'
  }
  if (/timeout/i.test(raw)) return '请求超时，请检查网络或服务是否已启动'
  if (/fail/i.test(raw)) {
    return '无法连接服务器（' + config.baseUrl + '），请确认后端已启动、地址与端口正确'
  }
  return raw || '网络请求失败'
}

/* ------------------------- 原始请求 ------------------------- */

function rawRequest(method, path, data, withToken) {
  return new Promise(function (resolve) {
    const header = { 'content-type': 'application/json' }
    if (withToken) {
      const token = getToken()
      if (token) header.Authorization = 'Bearer ' + token
    }
    wx.request({
      url: config.baseUrl + path,
      method: method,
      data: data === undefined ? undefined : data,
      header: header,
      timeout: config.timeout,
      success: function (res) {
        resolve({ status: res.statusCode, data: res.data })
      },
      fail: function (err) {
        resolve({ status: 0, data: { ok: false, error: networkMessage(err) } })
      }
    })
  })
}

/* ------------------------- 统一返回体 ------------------------- */

function toError(res, fallback) {
  const body = res.data && typeof res.data === 'object' ? res.data : {}
  const out = {}
  for (const k in body) out[k] = body[k]
  out.ok = false
  out.error = body.error || fallback || ('请求失败（' + res.status + '）')
  return out
}

/* ------------------------- 登录 ------------------------- */

let loginPromise = null

function wxLogin() {
  return new Promise(function (resolve, reject) {
    wx.login({
      success: function (r) { resolve(r && r.code) },
      fail: function (e) { reject(e) }
    })
  })
}

function storeLoginResult(body) {
  if (!body || !body.token || !body.user) return null
  setToken(body.token)
  setUser(body.user)
  // 任何一次登录成功都算「重新登录」，把主动退出标记清掉
  setLoggedOut(false)
  return body.user
}

/** 用微信 code 换服务端 token。profile 可选：已拿到头像昵称时顺带带上 */
async function loginByWeChat(code, profile) {
  const body = { code: code }
  if (profile && profile.nickName) body.nickName = String(profile.nickName).trim().slice(0, 16)
  const res = await rawRequest('POST', '/api/auth/wechat', body, false)
  if (res.status >= 200 && res.status < 300 && res.data && res.data.ok) {
    return { ok: true, user: storeLoginResult(res.data), body: res.data }
  }
  return toError(res, '微信登录失败')
}

/** 开发模式登录（仅本地调试用，服务端默认只在 Development 环境开放） */
async function loginByDev(nickName, deviceKey) {
  if (!config.allowDevLogin) return { ok: false, error: '当前环境未开启开发模式登录' }
  const res = await rawRequest('POST', '/api/auth/dev', {
    nickName: nickName,
    deviceKey: deviceKey
  }, false)
  if (res.status >= 200 && res.status < 300 && res.data && res.data.ok) {
    return { ok: true, user: storeLoginResult(res.data), body: res.data }
  }
  return toError(res, '开发模式登录失败')
}

function randomKey() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/**
 * 确保处于登录态。
 * 1) 本地已有 token 且未强制刷新 → 直接用；
 * 2) 用户主动退出过 → 直接拒绝（不能静默把人登回来，否则「退出登录」等于没做）；
 * 3) 否则 wx.login 换 code 走微信登录；
 * 4) 开发模式下微信登录不可用时，退化为本机账号登录（免配置即可联调）。
 *
 * force=true 只表示「忽略本地缓存的 token」，不代表可以忽略主动退出。
 * 用户点「登录」按钮走的是 loginExplicit()。
 */
function ensureLogin(force) {
  if (!force && getToken() && getUser()) {
    return Promise.resolve(getUser())
  }
  if (isLoggedOut()) {
    return Promise.reject(new Error('已退出登录，点「微信一键登录」可以重新登录'))
  }
  if (loginPromise) return loginPromise

  loginPromise = (async function () {
    let lastError = null
    try {
      const code = await wxLogin()
      if (code) {
        const r = await loginByWeChat(code)
        if (r.ok) return r.user
        lastError = r.error
      } else {
        lastError = '未取到微信登录凭证'
      }
    } catch (e) {
      lastError = (e && e.errMsg) || '调用微信登录失败'
    }

    if (config.allowDevLogin) {
      const cached = getUser()
      const nick = (cached && cached.devName) || '本机用户'
      // deviceKey 稳定不变，保证改昵称不会变成另一个账号
      const key = (cached && cached.devKey) || ('local-' + randomKey())
      const r = await loginByDev(nick, key)
      if (r.ok) {
        const u = {}
        for (const k in r.user) u[k] = r.user[k]
        u.devName = nick
        u.devKey = key
        setUser(u)
        return u
      }
      lastError = r.error
    }

    return Promise.reject(new Error(lastError || '登录失败'))
  })()

  loginPromise.then(function () { loginPromise = null }, function () { loginPromise = null })
  return loginPromise
}

function logout() {
  clearSession()
  // 关键：留下标记，否则下一次 ensureLogin 会立刻静默登录回来
  setLoggedOut(true)
}

/** 用户主动点「登录」：先清掉主动退出标记，再强制走一次登录 */
function loginExplicit() {
  setLoggedOut(false)
  return ensureLogin(true)
}

/* ------------------------- 头像 ------------------------- */

/**
 * 上传头像（base64）。
 * 服务端存 bytea 并返回新的地址（带自增版本号，用来刷掉图片缓存）。
 */
async function uploadAvatar(imageBase64, contentType) {
  const data = String(imageBase64 || '')
  if (!data) return { ok: false, error: '没有读取到头像数据' }

  const res = await call('POST', '/api/me/avatar', {
    imageBase64: data,
    contentType: contentType || 'image/jpeg'
  })
  if (res && res.ok === false) return res
  return { ok: true, avatarUrl: (res && res.avatarUrl) || '' }
}

/**
 * 把服务端下发的相对地址补成完整地址（接口只回 /api/users/1/avatar?v=2，
 * 这样服务端不用关心自己被哪个域名访问）。
 */
function absoluteUrl(url) {
  const u = String(url || '').trim()
  if (!u) return ''
  if (/^(https?:|data:|wxfile:|blob:|file:)/i.test(u)) return u
  return u.charAt(0) === '/' ? config.baseUrl + u : config.baseUrl + '/' + u
}

/* ------------------------- 节流提示 ------------------------- */

// 小队页每秒轮询，服务端挂掉时不能每秒弹一次 toast，同一个错误 5 秒内只提示一次
let lastToast = { msg: '', at: 0 }

function toastOnce(msg) {
  if (!msg) return
  const now = Date.now()
  if (msg === lastToast.msg && now - lastToast.at < 5000) return
  lastToast = { msg: msg, at: now }
  try { wx.showToast({ title: String(msg), icon: 'none', duration: 2000 }) } catch (e) {}
}

/* ------------------------- 带自动重登的业务请求 ------------------------- */

async function call(method, path, data, retried) {
  const res = await rawRequest(method, path, data, true)

  if (res.status === 401 && !retried) {
    try {
      await ensureLogin(true)
    } catch (e) {
      return { ok: false, error: '登录状态已失效，请重新登录' }
    }
    return call(method, path, data, true)
  }

  if (res.status >= 200 && res.status < 300) {
    return res.data && typeof res.data === 'object' ? res.data : { ok: true }
  }

  return toError(res, '请求失败（' + res.status + '）')
}

/** 只关心数据、不关心 ok 的读取类接口用这个：失败时返回兜底值（错误提示做节流） */
async function callValue(method, path, data, fallback) {
  const res = await call(method, path, data)
  if (res && res.ok === false) {
    toastOnce(res.error)
    return fallback
  }
  return res
}

module.exports = {
  config,
  getToken,
  getUser,
  setUser,
  getDevIdentities,
  setDevIdentities,
  clearSession,
  isLoggedOut,
  setLoggedOut,
  logout,
  ensureLogin,
  loginExplicit,
  loginByWeChat,
  loginByDev,
  uploadAvatar,
  absoluteUrl,
  randomKey,
  call,
  callValue,
  toastOnce,
  rawRequest
}
