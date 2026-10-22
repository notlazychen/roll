// 账号体系契约测试：邮箱注册 / 登录 / 改密 / 鉴权边界 / Web 与小程序同 uid 数据互通
// 用法：node tests/account-contract.js   （BASE 环境变量可覆盖，默认本地 5235）
const BASE = process.env.BASE || 'http://localhost:5235'

let pass = 0
let fail = 0

function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')) }
}

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = 'Bearer ' + token
  const options = { method, headers }
  if (body !== undefined && body !== null) options.body = JSON.stringify(body)
  const res = await fetch(BASE + path, options)
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch (e) { data = { raw: text } }
  return { status: res.status, data }
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE + '/health')
      if (r.ok) return true
    } catch (e) {}
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

;(async () => {
  if (!await waitForServer()) { console.error('服务未启动'); process.exit(1) }

  const stamp = Date.now().toString(36)
  const email = `t_${stamp}@example.com`
  const password = 'Passw0rd' + stamp.slice(-3)

  /* ---------------- 1. 参数校验 ---------------- */
  console.log('\n【1】注册参数校验')
  let r = await req('POST', '/api/auth/register', { email: 'not-an-email', password })
  check('邮箱格式错误被拒', r.status === 400 && /邮箱/.test(r.data.error), r.data)

  r = await req('POST', '/api/auth/register', { email, password: '12345678' })
  check('纯数字密码被拒', r.status === 400 && /字母和数字/.test(r.data.error), r.data)

  r = await req('POST', '/api/auth/register', { email, password: 'abcdefgh' })
  check('纯字母密码被拒', r.status === 400 && /字母和数字/.test(r.data.error), r.data)

  r = await req('POST', '/api/auth/register', { email, password: 'Ab1' })
  check('过短密码被拒', r.status === 400 && /至少 8 位/.test(r.data.error), r.data)

  /* ---------------- 2. 注册成功 ---------------- */
  console.log('\n【2】注册')
  r = await req('POST', '/api/auth/register', { email, password })
  check('注册成功并直接返回 token', r.status === 200 && !!r.data.token, r.data)
  check('昵称默认取邮箱前缀', r.data.user && r.data.user.nickName === `t_${stamp}`, r.data.user)
  check('返回的邮箱已归一化', r.data.user && r.data.user.email === email, r.data.user)
  check('未绑定微信时 weChatBound=false', r.data.user && r.data.user.weChatBound === false, r.data.user)
  const uid = r.data.user && r.data.user.id
  const token = r.data.token

  r = await req('POST', '/api/auth/register', { email, password })
  check('重复注册被拒', r.status === 400 && /已注册/.test(r.data.error), r.data)

  r = await req('POST', '/api/auth/register', { email: email.toUpperCase(), password })
  check('大小写不同的同一邮箱算重复', r.status === 400, r.data)

  /* ---------------- 3. 选项源预置 ---------------- */
  // 响应结构：{ ok, options: { categories, channels, channelGroups, ... } }（与小程序端一致）
  console.log('\n【3】新账号预置数据')
  r = await req('GET', '/api/options', null, token)
  check('选项源可直接读取', r.status === 200 && r.data.ok, r.data && r.data.error)
  const opts = r.data.options || {}
  check('预置了分类', opts.categories && opts.categories.length > 0, opts.categories && opts.categories.length)
  check('预置了渠道且按分类分组', opts.channelGroups && opts.channelGroups.length > 0, opts.channelGroups && opts.channelGroups.length)
  check('预置了账户', opts.accounts && opts.accounts.length > 0, opts.accounts && opts.accounts.length)

  /* ---------------- 4. 登录 ---------------- */
  console.log('\n【4】登录')
  r = await req('POST', '/api/auth/login', { email, password: 'wrongPass1' })
  check('错误密码被拒', r.status === 401 && /不正确/.test(r.data.error), r.data)

  r = await req('POST', '/api/auth/login', { email: 'no_such_user@example.com', password })
  check('不存在邮箱返回同样的错误文案（防枚举）', r.status === 401 && /不正确/.test(r.data.error), r.data)

  r = await req('POST', '/api/auth/login', { email: email.toUpperCase(), password })
  check('正确密码可登录（邮箱大小写无关）', r.status === 200 && !!r.data.token, r.data)
  const token2 = r.data.token
  check('两次登录 uid 一致', (await req('GET', '/api/me', null, token2)).data.user.id === uid)

  /* ---------------- 5. 鉴权边界 ---------------- */
  console.log('\n【5】鉴权边界')
  r = await req('GET', '/api/entries', null, null)
  check('未登录访问账目返回 401', r.status === 401, r.data)

  r = await req('GET', '/api/me', null, 'garbage.token.value')
  check('伪造 token 返回 401', r.status === 401, r.data)

  /* ---------------- 6. 记账链路（Web 端与小程序共用同一套接口） ---------------- */
  console.log('\n【6】记账链路')
  r = await req('POST', '/api/entries', {
    type: 'expense', amount: 3250, category: '餐饮', channel: '餐饮/肯德基',
    consumer: '本人', account: '支付宝', tradeAt: Date.now(), remark: '午饭 外卖'
  }, token2)
  check('新增账目成功', r.status === 200 && r.data.ok, r.data)
  const entryId = r.data.entry && r.data.entry.id
  check('金额按分为单位返回', r.data.entry && r.data.entry.amount === 3250, r.data.entry)
  check('备注自动打标签', r.data.entry && Array.isArray(r.data.entry.tags) && r.data.entry.tags.length > 0, r.data.entry && r.data.entry.tags)

  r = await req('GET', '/api/entries', null, token2)
  check('账目列表可读', r.status === 200 && r.data.items.length >= 1, r.data && r.data.items && r.data.items.length)

  r = await req('GET', '/api/stats/overview', null, token2)
  check('概览接口可用', r.status === 200 && typeof r.data.monthExpense === 'number', r.data)

  r = await req('GET', '/api/reports', null, token2)
  check('报表接口可用', r.status === 200 && typeof r.data.expense === 'number' && Array.isArray(r.data.days), r.data && r.data.error)

  /* ---------------- 7. 改密 ---------------- */
  console.log('\n【7】修改密码')
  r = await req('POST', '/api/auth/password', { oldPassword: 'wrongOld1', newPassword: 'NewPass123' }, token2)
  check('原密码错误被拒', r.status === 400 && /原密码/.test(r.data.error), r.data)

  // 密码规则要求「同时包含字母和数字」；stamp 是 base36，尾部可能全是字母，
  // 所以固定补一个数字保证合法
  const newPassword = 'NewPass' + stamp.slice(-4) + '9'
  r = await req('POST', '/api/auth/password', { oldPassword: password, newPassword }, token2)
  check('改密成功', r.status === 200 && r.data.ok, r.data)

  r = await req('POST', '/api/auth/login', { email, password })
  check('旧密码失效', r.status === 401, r.data)

  r = await req('POST', '/api/auth/login', { email, password: newPassword })
  check('新密码可登录', r.status === 200 && !!r.data.token, r.data)
  const token3 = r.data.token

  /* ---------------- 8. 昵称唯一 ---------------- */
  console.log('\n【8】昵称规则')
  r = await req('PUT', '/api/me', { nickName: 'x' }, token3)
  check('过短昵称被拒', r.status === 400 && /2-16/.test(r.data.error), r.data)

  r = await req('PUT', '/api/me', { nickName: '正常昵称_' + stamp.slice(-4) }, token3)
  check('合法昵称可修改', r.status === 200 && r.data.ok, r.data)

  const otherEmail = `o_${stamp}@example.com`
  r = await req('POST', '/api/auth/register', { email: otherEmail, password: 'Other1234', nickName: '正常昵称_' + stamp.slice(-4) })
  check('注册时重名自动追加序号', r.status === 200 && r.data.user.nickName !== '正常昵称_' + stamp.slice(-4), r.data.user && r.data.user.nickName)

  r = await req('PUT', '/api/me', { nickName: '正常昵称_' + stamp.slice(-4) }, r.data.token)
  check('改名撞车时明确报错', r.status === 400 && /已被使用/.test(r.data.error), r.data)

  /* ---------------- 9. 微信身份合并语义 ---------------- */
  console.log('\n【9】微信绑定接口')
  r = await req('POST', '/api/auth/bind-wechat', { code: '' }, token3)
  check('缺少 code 被拒', r.status === 400 && /code/.test(r.data.error), r.data)

  r = await req('POST', '/api/auth/bind-wechat', { code: 'invalid-code' }, token3)
  check('无效 code 走微信校验失败分支', r.status >= 400 && r.data.ok === false, r.data)

  r = await req('POST', '/api/auth/bind-wechat', { code: 'x' }, null)
  check('未登录不能调用绑定', r.status === 401, r.data)

  /* ---------------- 10. 数据隔离 ---------------- */
  console.log('\n【10】账号间数据隔离')
  r = await req('POST', '/api/auth/register', { email: `s_${stamp}@example.com`, password: 'Isolate123' })
  const otherToken = r.data.token
  r = await req('GET', '/api/entries', null, otherToken)
  check('新账号看不到别人的账目', r.status === 200 && r.data.items.length === 0, r.data && r.data.items && r.data.items.length)

  r = await req('GET', `/api/entries/${entryId}`, null, otherToken)
  check('跨账号读取单条账目被拒', r.status === 404 || r.status === 403, r.data)

  console.log(`\n结果：${pass} 通过，${fail} 失败`)
  process.exit(fail === 0 ? 0 : 1)
})()
