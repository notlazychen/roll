// Web 微信扫码登录契约测试：配对码生成 / 待批准 / 批准后一次性发 token / 过期与重复消费
// 用法：node tests/web-qr-contract.js   （BASE 环境变量可覆盖，默认本地 5235）
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

;(async function main() {
  console.log('Web 扫码登录契约测试 → ' + BASE)

  /* ---- 1. 生成配对码 ---- */
  console.log('\n【1】生成配对码')
  let r = await req('POST', '/api/auth/web-qr')
  check('匿名可生成', r.status === 200 && r.data.ok, r.data)
  const ticket = r.data && r.data.ticket
  check('配对码为 8 位', typeof ticket === 'string' && ticket.length === 8, ticket)
  check('不含易混字符 0O1IL', !/[0O1IL]/.test(ticket || ''), ticket)
  check('返回有效期', r.data.expiresInMs === 300000, r.data.expiresInMs)

  /* ---- 2. 初始状态为 pending ---- */
  console.log('\n【2】轮询状态')
  r = await req('GET', '/api/auth/web-qr/' + ticket)
  check('未批准时 status=pending', r.status === 200 && r.data.status === 'pending', r.data)
  check('未批准时不发 token', !r.data.token, r.data)

  /* ---- 3. 不存在的码 ---- */
  r = await req('GET', '/api/auth/web-qr/ZZZZZZZZ')
  check('未知配对码返回 expired', r.data.status === 'expired', r.data)

  /* ---- 4. 匿名不能批准 ---- */
  console.log('\n【3】批准权限')
  r = await req('POST', '/api/auth/web-qr/' + ticket + '/approve')
  check('未登录不能批准', r.status === 401, r.data)

  /* ---- 5. 登录后批准 ---- */
  console.log('\n【4】登录后批准')
  const email = 'qr' + Date.now() + '@example.com'
  r = await req('POST', '/api/auth/register', { email, password: 'Abcd1234' })
  const token = r.data && r.data.token
  check('注册测试账号', !!token, r.data)

  r = await req('POST', '/api/auth/web-qr/' + ticket + '/approve', null, token)
  check('批准成功', r.status === 200 && r.data.ok, r.data)

  r = await req('GET', '/api/auth/web-qr/' + ticket)
  check('批准后 status=approved', r.data.status === 'approved', r.data)
  check('拿到 token', typeof r.data.token === 'string' && r.data.token.length > 20, r.data.status)
  check('返回用户信息', !!(r.data.user && r.data.user.email === email), r.data.user)

  /* ---- 6. 一次性消费 ---- */
  console.log('\n【5】一次性消费')
  r = await req('GET', '/api/auth/web-qr/' + ticket)
  check('第二次轮询不再发 token', !r.data.token, r.data)
  check('第二次轮询 status=consumed', r.data.status === 'consumed', r.data)

  r = await req('POST', '/api/auth/web-qr/' + ticket + '/approve', null, token)
  check('已消费的码不能再次批准', r.status === 400, r.data)

  /* ---- 7. 用拿到的 token 能正常访问 ---- */
  console.log('\n【6】token 可用性')
  const issued = await req('GET', '/api/auth/web-qr/' + ticket)
  check('已消费码不覆盖之前的 token', !issued.data.token, issued.data)
  r = await req('GET', '/api/me', null, token)
  check('token 可访问 /api/me', r.status === 200 && r.data.user && r.data.user.email === email, r.status)

  console.log('\n' + (fail === 0 ? '✅ 全部通过' : '❌ 有失败项') + '：' + pass + ' 通过 / ' + fail + ' 失败')
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error('测试异常：', e)
  process.exit(1)
})
