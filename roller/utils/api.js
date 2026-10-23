/**
 * 网络层
 * ---------------------------------------------------------------
 * 统一处理：baseUrl 拼接、token 注入、401 自动重新登录、错误归一化。
 * 所有方法都返回 Promise，并且**不抛异常**——失败时返回 { ok:false, error }，
 * 这样页面里的 `if (!res.ok) return util.toast(res.error)` 写法可以原样保留。
 */

const config = require('./config')

const TOKEN_KEY = 'lg_token_v1'
const USER_KEY = 'lg_user_v1'

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

/** 退出登录：只清本机登录态，云端账目不受影响 */
function clearSession() {
  try {
    wx.removeStorageSync(TOKEN_KEY)
    wx.removeStorageSync(USER_KEY)
  } catch (e) {}
}

/* ------------------------- 本机登出标记 -------------------------
 * 微信登录是静默的：不清标记的话，退出后下一次 ensureLogin 又会
 * 把同一个 openid 秒登回来，表现为「退出登录没用」。
 * 标记存在期间：启动/页面的自动登录一律跳过；只有用户在登录界面
 * 主动点按钮（force 登录）才清标记重新登录。
 */
const LOGGED_OUT_KEY = 'lg_logged_out_v1'

function markLoggedOut() {
  try { wx.setStorageSync(LOGGED_OUT_KEY, '1') } catch (e) {}
}

function clearLoggedOut() {
  try { wx.removeStorageSync(LOGGED_OUT_KEY) } catch (e) {}
}

function hasLoggedOut() {
  try { return !!wx.getStorageSync(LOGGED_OUT_KEY) } catch (e) { return false }
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

/** 用微信 code 换服务端 token。陌生微信返回 needLink（不再静默建号） */
async function loginByWeChat(code, profile) {
  const p = profile || {}
  const res = await rawRequest('POST', '/api/auth/wechat', {
    code: code,
    nickName: p.nickName || '',
    avatarUrl: p.avatarUrl || ''
  }, false)
  if (res.status >= 200 && res.status < 300 && res.data) {
    if (res.data.needLink && res.data.linkTicket) {
      try { wx.setStorageSync(PENDING_LINK_KEY, res.data.linkTicket) } catch (e) {}
      return { needLink: true, linkTicket: res.data.linkTicket }
    }
    if (res.data.ok) {
      clearPendingLink()
      clearLoggedOut()
      return { ok: true, user: storeLoginResult(res.data), body: res.data }
    }
  }
  return toError(res, '微信登录失败')
}

/** 待认领票据的本地暂存键：登录遇到陌生微信时写入，由 account-link 页消费 */
const PENDING_LINK_KEY = 'lg_pending_link_v1'

/** 取出待认领的 linkTicket（空串表示没有） */
function takePendingLink() {
  try { return wx.getStorageSync(PENDING_LINK_KEY) || '' } catch (e) { return '' }
}

function clearPendingLink() {
  try { wx.removeStorageSync(PENDING_LINK_KEY) } catch (e) {}
}

/** 开发模式登录（仅本地调试用，服务端只在 Development 环境开放） */
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

/**
 * 批准网页扫码登录：把当前小程序登录态批给网页上的配对码。
 * ticket 是 8 位配对码（可来自扫码内容或手动输入）。
 */
async function approveWebQr(ticket) {
  const code = String(ticket || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (code.length !== 8) return { ok: false, error: '配对码格式不对，应为 8 位字母数字' }
  const res = await rawRequest('POST', '/api/auth/web-qr/' + encodeURIComponent(code) + '/approve', undefined, true)
  if (res.status >= 200 && res.status < 300 && res.data && res.data.ok) {
    return { ok: true, webUser: res.data.webUser }
  }
  return toError(res, '批准失败')
}

/** 邮箱密码登录（与微信登录同一个账号体系） */
async function loginByEmail(email, password) {
  const res = await rawRequest('POST', '/api/auth/login', { email: email, password: password }, false)
  if (res.status >= 200 && res.status < 300 && res.data && res.data.ok) {
    clearPendingLink()
    clearLoggedOut()
    return { ok: true, user: storeLoginResult(res.data) }
  }
  return toError(res, '登录失败')
}

/**
 * 认领微信身份：/wechat 返回 needLink 后二选一。
 *   { action:'create', linkTicket, nickName?, avatarUrl? } → 显式创建新账号
 *   { action:'link',   linkTicket, email, password }       → 绑定已有邮箱账号
 */
async function claimWeChat(payload) {
  const res = await rawRequest('POST', '/api/auth/wechat/claim', payload, false)
  if (res.status >= 200 && res.status < 300 && res.data && res.data.ok) {
    clearPendingLink()
    clearLoggedOut()
    return { ok: true, user: storeLoginResult(res.data), isNew: !!res.data.isNew }
  }
  return toError(res, '认领失败')
}

/**
 * 给当前登录账号绑定微信。
 * openid 已属于其他账号时返回 { needMerge, mergeTicket, other }，
 * 用户确认后带 mergeTicket 重发即完成合并（对方账号数据并入当前账号）。
 */
async function bindWeChat(mergeTicket) {
  const code = await wxLogin()
  if (!code) return { ok: false, error: '未取到微信授权' }
  const res = await rawRequest('POST', '/api/auth/bind-wechat', {
    code: code,
    mergeTicket: mergeTicket || ''
  }, true)
  if (res.status >= 200 && res.status < 300 && res.data) {
    if (res.data.needMerge) {
      return { needMerge: true, mergeTicket: res.data.mergeTicket, other: res.data.other || {} }
    }
    if (res.data.ok) {
      setUser(res.data.user)
      return { ok: true, merged: !!res.data.merged, user: res.data.user }
    }
  }
  return toError(res, '绑定失败')
}

/* ------------------------- 邮箱验证码 / 绑定解绑 ------------------------- */

/** 发送邮箱验证码。purpose: 'register' | 'bind' | 'unbind' */
async function sendEmailCode(email, purpose) {
  const res = await rawRequest('POST', '/api/auth/email-code', {
    email: email,
    purpose: purpose
  }, false)
  if (res.status >= 200 && res.status < 300 && res.data && res.data.ok) {
    return {
      ok: true,
      sent: !!res.data.sent,
      // 开发环境邮件服务未配置时，验证码直接返回，方便联调
      debugCode: res.data.debugCode || ''
    }
  }
  return toError(res, '发送验证码失败')
}

/** 绑定邮箱：验证码发到新邮箱，验证通过后落库 */
async function bindEmail(email, code) {
  const res = await rawRequest('POST', '/api/auth/bind-email', {
    email: email,
    code: code
  }, true)
  if (res.status >= 200 && res.status < 300 && res.data && res.data.ok) {
    setUser(res.data.user)
    return { ok: true, user: res.data.user }
  }
  return toError(res, '绑定失败')
}

/** 解绑邮箱：验证码发到当前绑定的邮箱 */
async function unbindEmail(code) {
  const res = await rawRequest('POST', '/api/auth/unbind-email', {
    code: code
  }, true)
  if (res.status >= 200 && res.status < 300 && res.data && res.data.ok) {
    setUser(res.data.user)
    return { ok: true, user: res.data.user }
  }
  return toError(res, '解绑失败')
}

/** 解绑微信：带 wx.login 的 code 做二次校验（必须是绑定的那个微信） */
async function unbindWeChat() {
  const code = await wxLogin()
  if (!code) return { ok: false, error: '未取到微信授权' }
  const res = await rawRequest('POST', '/api/auth/unbind-wechat', {
    code: code
  }, true)
  if (res.status >= 200 && res.status < 300 && res.data && res.data.ok) {
    setUser(res.data.user)
    return { ok: true, user: res.data.user }
  }
  return toError(res, '解绑失败')
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
  // 用户主动退出过：自动登录一律拒绝，避免「退出了又被秒登回来」。
  // 只有登录界面里用户主动点按钮（force=true）才清标记重新登录。
  if (!force && hasLoggedOut()) {
    return Promise.reject(new Error('已退出登录'))
  }
  if (force) clearLoggedOut()
  if (loginPromise) return loginPromise

  loginPromise = (async function () {
    let lastError = null
    try {
      const code = await wxLogin()
      if (code) {
        const cached = getUser() || {}
        const r = await loginByWeChat(code, {
          nickName: cached.nickName || '',
          avatarUrl: cached.avatarUrl || ''
        })
        if (r.ok) return r.user
        if (r.needLink) {
          // 陌生微信：交给 account-link 页处理，不要落到 dev 兜底
          const err = new Error('NEED_LINK')
          err.needLink = true
          err.linkTicket = r.linkTicket
          throw err
        }
        lastError = r.error
      } else {
        lastError = '未取到微信登录凭证'
      }
    } catch (e) {
      if (e && e.needLink) throw e
      lastError = (e && e.errMsg) || '调用微信登录失败'
    }

    if (config.allowDevLogin) {
      const cached = getUser()
      const nick = (cached && cached.devName) || '本机用户'
      // deviceKey 稳定不变，保证改昵称不会变成另一个账号
      const key = wx.getStorageSync('lg_dev_key_v1') || ('local-' + randomKey())
      try { wx.setStorageSync('lg_dev_key_v1', key) } catch (e) {}
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

/** 主动登出：清掉本机 token，并打上登出标记——下次启动不再自动微信登录，
 *  停留在登录界面等用户手动登录 */
function logout() {
  clearSession()
  markLoggedOut()
}

/* ------------------------- 节流提示 ------------------------- */

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
    // 用户主动登出后的请求失败不算「登录失效」，不要偷偷重新登录
    if (hasLoggedOut()) {
      return { ok: false, error: '未登录，请先登录' }
    }
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
  return res || fallback
}

/** 组装查询串，自动跳过空值 */
function qs(params) {
  const parts = []
  Object.keys(params || {}).forEach(function (k) {
    const v = params[k]
    if (v === undefined || v === null || v === '') return
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v))
  })
  return parts.length ? '?' + parts.join('&') : ''
}

module.exports = {
  config,
  getToken,
  getUser,
  setUser,
  clearSession,
  logout,
  hasLoggedOut,
  markLoggedOut,
  clearLoggedOut,
  ensureLogin,
  loginByWeChat,
  loginByEmail,
  claimWeChat,
  bindWeChat,
  sendEmailCode,
  bindEmail,
  unbindEmail,
  unbindWeChat,
  loginByDev,
  approveWebQr,
  takePendingLink,
  clearPendingLink,
  randomKey,
  call,
  callValue,
  qs,
  toastOnce,
  rawRequest
}
