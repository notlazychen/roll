/**
 * 登录态 / 退出登录 / 头像上传 · 离线冒烟测试
 * ---------------------------------------------------------------
 * 不依赖后端：用假的 wx.request 按路径返回固定响应，专测「客户端这边的行为」：
 *   1) 退出登录后不能再被静默登录回来（这是这次修的核心问题）；
 *   2) 再次点登录能正常登进去；
 *   3) 头像上传会把服务端下发的相对地址补成完整地址；
 *   4) 保存资料时昵称与头像分别走各自的接口，不会互相覆盖。
 *
 * 需要真实后端的测试见 miniprogram-contract.cjs / cloud-contract.cjs。
 *
 * 用法：node tests/auth-flow.cjs
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
const calls = []          // 记录发出去的请求：{ method, path, body, auth }
const routes = {}         // 'METHOD /path' -> { status, data }

function route(key, data, status) {
  routes[key] = { status: status || 200, data: data }
}

global.wx = {
  getStorageSync: function (k) {
    return k in memory ? JSON.parse(JSON.stringify(memory[k])) : ''
  },
  setStorageSync: function (k, v) { memory[k] = JSON.parse(JSON.stringify(v)) },
  removeStorageSync: function (k) { delete memory[k] },
  showToast: function () {},
  vibrateShort: function () {},
  login: function (opt) { setTimeout(function () { opt.success({ code: 'mock-code' }) }, 0) },
  request: function (opt) {
    const p = String(opt.url).replace(/^https?:\/\/[^/]+/, '')
    calls.push({
      method: opt.method || 'GET',
      path: p,
      body: opt.data,
      auth: !!(opt.header && opt.header.Authorization)
    })
    const hit = routes[(opt.method || 'GET') + ' ' + p]
    setTimeout(function () {
      if (!hit) return opt.fail({ errMsg: 'request:fail 未配置的路径 ' + p })
      opt.success({ statusCode: hit.status, data: hit.data, header: {} })
    }, 0)
  }
}

/* ------------------------- 加载被测模块 ------------------------- */

const config = require(path.join(MP_ROOT, 'utils', 'config.js'))
const api = require(path.join(MP_ROOT, 'utils', 'api.js'))
const store = require(path.join(MP_ROOT, 'utils', 'store-http.js'))

/* ------------------------- 固定响应 ------------------------- */

const ME = { id: 7, nickName: '契约用户', avatarUrl: null, isDevAccount: false }

route('POST /api/auth/wechat', { ok: true, token: 'tok-1', user: ME, isNew: false })
route('POST /api/me/avatar', { ok: true, avatarUrl: '/api/users/7/avatar?v=1' })
route('PUT /api/me', { ok: true, user: { id: 7, nickName: '契约新名', avatarUrl: '/api/users/7/avatar?v=1', isDevAccount: false } })

function lastCall(method, p) {
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i].method === method && calls[i].path === p) return calls[i]
  }
  return null
}

;(async () => {
  console.log('数据源：' + config.dataSource + '，服务地址：' + config.baseUrl + '\n')

  /* ---------------- 1. 初始状态 ---------------- */
  console.log('【1】初始状态')
  check('isLoggedIn() 为 false', store.isLoggedIn() === false)
  check('isLoggedOut() 为 false（还没退出过）', store.isLoggedOut() === false)
  check('getMe() 兜底返回 uid=0', store.getMe().uid === 0, store.getMe())

  /* ---------------- 2. 微信一键登录 ---------------- */
  console.log('\n【2】微信一键登录')
  const login1 = await store.loginByWeChat()
  check('loginByWeChat 返回 { ok, user }', login1.ok === true && !!login1.user, login1)
  const c = lastCall('POST', '/api/auth/wechat')
  check('登录请求带上了 wx.login 的 code', !!c && c.body && c.body.code === 'mock-code', c && c.body)
  check('登录后 isLoggedIn() 为 true', store.isLoggedIn() === true)
  check('getMe() 用数字 uid（页面 === 比较）', store.getMe().uid === 7, store.getMe())

  /* ---------------- 3. 退出登录必须真的退出去 ---------------- */
  console.log('\n【3】退出登录（本次修复的核心）')
  store.resetAll()
  check('退出后 isLoggedIn() 为 false', store.isLoggedIn() === false)
  check('退出后 token 已清除', api.getToken() === '')
  check('退出后留下「已主动退出」标记', store.isLoggedOut() === true)

  let rejected = false
  let rejectMsg = ''
  try {
    await store.ensureLogin()
  } catch (e) {
    rejected = true
    rejectMsg = e.message
  }
  check('退出后 ensureLogin() 不再静默登录', rejected === true, rejectMsg)
  check('退出后没有发出任何登录请求（页面 onShow 不会把人登回来）',
    lastCall('POST', '/api/auth/wechat') === c, lastCall('POST', '/api/auth/wechat') && lastCall('POST', '/api/auth/wechat').path)
  check('退出后 getMe() 回到 uid=0', store.getMe().uid === 0, store.getMe())

  // force 也不能绕过主动退出，否则 401 自动重登会把用户又登回去
  let forced = false
  try { await store.ensureLogin(true) } catch (e) { forced = true }
  check('ensureLogin(true) 同样被拦住', forced === true)

  /* ---------------- 4. 再点一次登录 ---------------- */
  console.log('\n【4】重新登录')
  const login2 = await store.loginByWeChat()
  check('退出后仍能正常登录', login2.ok === true, login2)
  check('登录成功后标记被清除', store.isLoggedOut() === false)
  check('getMe() 恢复为登录用户', store.getMe().uid === 7)

  /* ---------------- 5. 头像上传 ---------------- */
  console.log('\n【5】头像上传')
  const up = await store.saveAvatar('ZmFrZQ==', 'image/jpeg')
  check('saveAvatar 返回 ok', up.ok === true, up)
  const upCall = lastCall('POST', '/api/me/avatar')
  check('请求带上了 base64 与 mime',
    !!upCall && upCall.body.imageBase64 === 'ZmFrZQ==' && upCall.body.contentType === 'image/jpeg', upCall && upCall.body)
  check('上传接口带上了登录态', !!upCall && upCall.auth === true)
  check('服务端下发的相对地址被补成完整地址',
    store.getMe().avatarUrl === config.baseUrl + '/api/users/7/avatar?v=1', store.getMe().avatarUrl)
  check('已经是完整地址的不再拼接',
    api.absoluteUrl('https://cdn.example.com/a.png') === 'https://cdn.example.com/a.png')
  check('data URI 原样返回', api.absoluteUrl('data:image/jpeg;base64,AAA').indexOf('data:') === 0)

  /* ---------------- 6. 保存资料只改该改的字段 ---------------- */
  console.log('\n【6】保存资料（昵称 / 头像分开提交）')
  const saved = await store.saveProfile({ name: '契约新名', avatarBase64: 'ZmFrZTI=', contentType: 'image/jpeg' })
  check('saveProfile 返回 ok', saved.ok === true, saved)
  const putCall = lastCall('PUT', '/api/me')
  check('昵称走 PUT /api/me', !!putCall && putCall.body.nickName === '契约新名', putCall && putCall.body)
  check('PUT /api/me 不再带 avatarUrl（头像有专门接口）',
    !!putCall && putCall.body.avatarUrl === undefined, putCall && putCall.body)
  check('保存后 getMe 的名字同步更新', store.getMe().name === '契约新名', store.getMe())
  check('保存后头像地址仍在', /\/avatar\?v=1$/.test(store.getMe().avatarUrl), store.getMe().avatarUrl)

  /* ---------------- 7. 空昵称只改头像 ---------------- */
  console.log('\n【7】昵称为空时只提交头像')
  const before = calls.length
  const onlyAvatar = await store.saveProfile({ name: '   ', avatarBase64: 'ZmFrZTM=' })
  check('仍然返回 ok', onlyAvatar.ok === true, onlyAvatar)
  check('只发了头像请求，没有多余的 PUT /api/me',
    calls.slice(before).every(function (x) { return x.path === '/api/me/avatar' }),
    calls.slice(before).map(function (x) { return x.method + ' ' + x.path }))

  /* ---------------- 8. 云服务版同名接口 ---------------- */
  console.log('\n【8】云服务实现是否提供同样接口')
  try {
    const cloudStore = require(path.join(MP_ROOT, 'utils', 'store-cloud.js'))
    ;['loginByWeChat', 'saveProfile', 'saveAvatar', 'isLoggedOut', 'resetAll', 'envInfo'].forEach(function (name) {
      check('store-cloud 导出 ' + name + '()', typeof cloudStore[name] === 'function')
    })
    check('两个数据源的 envInfo 结构一致（页面不用分支）',
      typeof cloudStore.envInfo().loggedOut === 'boolean' && typeof store.envInfo().loggedOut === 'boolean')
  } catch (e) {
    console.log('  · 云 SDK 需要真实小程序环境，跳过（' + ((e && e.message) || e) + '）')
  }

  console.log('\n================ 结果 ================')
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项')
  process.exit(fail === 0 ? 0 : 1)
})().catch(function (e) {
  console.error('脚本异常:', e)
  process.exit(1)
})
