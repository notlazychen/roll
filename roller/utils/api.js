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
  return body.user
}

/** 用微信 code 换服务端 token */
async function loginByWeChat(code) {
  const res = await rawRequest('POST', '/api/auth/wechat', { code: code }, false)
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
 * 2) 否则 wx.login 换 code 走微信登录；
 * 3) 开发模式下微信登录不可用时，退化为本机账号登录（免配置即可联调）。
 */
function ensureLogin(force) {
  if (!force && getToken() && getUser()) {
    return Promise.resolve(getUser())
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
  logout,
  ensureLogin,
  loginByWeChat,
  loginByDev,
  randomKey,
  call,
  callValue,
  toastOnce,
  rawRequest
}
