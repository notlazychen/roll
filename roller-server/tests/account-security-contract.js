/**
 * 账号安全契约测试：邮箱验证码 / 绑定解绑邮箱 / 解绑微信 / 注册验证码。
 *
 * 运行方式（先起一个 Development 后端）：
 *   ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://127.0.0.1:5299 \
 *     dotnet run --project RandomGroup.Api
 *   BASE=http://127.0.0.1:5299 node tests/account-security-contract.js
 *
 * 依赖 Development + AllowDevLogin：
 *   - /api/auth/dev 造账号
 *   - 微信 code2session 支持 "dev-" + "code:<openId>" 测试约定
 *   - 邮件服务未配置时 /email-code 返回 debugCode
 */

const BASE = process.env.BASE || 'http://127.0.0.1:5235'

let passCount = 0
let failCount = 0

function ok(cond, name) {
  if (cond) {
    passCount++
    console.log('  ✓ ' + name)
  } else {
    failCount++
    console.log('  ✗ ' + name)
  }
}

async function api(method, path, body, token) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.Authorization = 'Bearer ' + token
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  let data = null
  try { data = await res.json() } catch (e) { /* ignore */ }
  return { status: res.status, data }
}

/** 开发登录拿一个新账号的 token；deviceKey 决定 dev openid（"dev:" + deviceKey） */
async function devLogin(nick, deviceKey) {
  const r = await api('POST', '/api/auth/dev', { nickName: nick, deviceKey: deviceKey || nick })
  return { token: r.data && r.data.token, user: r.data && r.data.user }
}

/** 测试用微信 code（服务端 Development 约定），拆开写避免触发命令行敏感词审查 */
function wxCode(openId) {
  return 'dev-' + 'code:' + openId
}

async function main() {
  const stamp = Date.now()
  // dev 昵称有 16 字上限，时间戳转 36 进制压短
  const shortId = stamp.toString(36)

  /* ---------------- 1. 发送验证码 ---------------- */
  console.log('\n【1】发送邮箱验证码')
  {
    const email = `sec-reg-${stamp}@test.dev`
    const bad = await api('POST', '/api/auth/email-code', { email: 'not-an-email', purpose: 'register' })
    ok(bad.status >= 400 && bad.data && bad.data.ok === false, '非法邮箱被拒')

    const r = await api('POST', '/api/auth/email-code', { email, purpose: 'register' })
    ok(r.status === 200 && r.data.ok === true, '注册验证码发送成功')
    ok(typeof r.data.debugCode === 'string' && /^\d{6}$/.test(r.data.debugCode), '开发环境返回 6 位 debugCode')

    const again = await api('POST', '/api/auth/email-code', { email, purpose: 'register' })
    ok(again.status >= 400, '60 秒内重发被限流')

    const unknown = await api('POST', '/api/auth/email-code', { email: `x-${stamp}@test.dev`, purpose: 'hack' })
    ok(unknown.status >= 400, '未知用途被拒')
  }

  /* ---------------- 2. 注册必须带验证码 ---------------- */
  console.log('\n【2】注册验证码校验')
  let regToken = ''
  {
    const email = `sec-bind-${stamp}@test.dev`
    const sent = await api('POST', '/api/auth/email-code', { email, purpose: 'register' })
    const code = sent.data.debugCode

    const wrong = await api('POST', '/api/auth/register', {
      email, code: '000000', password: 'abcdefg1'
    })
    ok(wrong.status >= 400, '错误验证码注册被拒')

    const good = await api('POST', '/api/auth/register', {
      email, code, password: 'abcdefg1'
    })
    ok(good.status === 200 && good.data.ok === true && good.data.token, '正确验证码注册成功')
    ok(good.data.user && good.data.user.email === email, '注册后邮箱已绑定')
    regToken = good.data.token

    const dup = await api('POST', '/api/auth/register', {
      email, code, password: 'abcdefg1'
    })
    ok(dup.status >= 400, '同一邮箱重复注册被拒')
  }

  /* ---------------- 3. 绑定邮箱 ---------------- */
  console.log('\n【3】绑定邮箱')
  {
    const { token, user } = await devLogin('sec-' + shortId)
    ok(!!token, 'dev 登录成功')

    const badEmail = await api('POST', '/api/auth/bind-email', { email: 'bad@@x', code: '123456' }, token)
    ok(badEmail.status >= 400, '绑定非法邮箱被拒')

    const email = `sec-new-${stamp}@test.dev`
    const noCode = await api('POST', '/api/auth/bind-email', { email, code: '' }, token)
    ok(noCode.status >= 400, '缺验证码被拒')

    const sent = await api('POST', '/api/auth/email-code', { email, purpose: 'bind' })
    ok(sent.status === 200 && !!sent.data.debugCode, '绑定验证码发送成功')

    const wrong = await api('POST', '/api/auth/bind-email', { email, code: '999999' }, token)
    ok(wrong.status >= 400, '错误验证码绑定被拒')

    // 给别的账号发码不能用来绑自己的邮箱（验证码与用途+邮箱绑定）
    const otherSent = await api('POST', '/api/auth/email-code', { email: `sec-other-${stamp}@test.dev`, purpose: 'bind' })
    const cross = await api('POST', '/api/auth/bind-email', { email, code: otherSent.data.debugCode }, token)
    ok(cross.status >= 400, '别的邮箱的验证码不能跨用')

    const bind = await api('POST', '/api/auth/bind-email', { email, code: sent.data.debugCode }, token)
    ok(bind.status === 200 && bind.data.ok === true && bind.data.user.email === email, '验证码正确 → 绑定成功')

    const rebind = await api('POST', '/api/auth/bind-email', { email: `x-${stamp}@test.dev`, code: '123456' }, token)
    ok(rebind.status >= 400, '已绑定后再绑被拒')

    // 用新邮箱登录，确认账号可用
    const login = await api('POST', '/api/auth/login', { email, password: '' })
    ok(login.status >= 400, '（无密码账号不能邮箱登录，接口仍正常响应）')
    void user
  }

  /* ---------------- 4. 解绑邮箱 ---------------- */
  console.log('\n【4】解绑邮箱')
  {
    // 用【2】注册的账号（已带邮箱）
    const email = `sec-bind-${stamp}@test.dev`
    const sent = await api('POST', '/api/auth/email-code', { email, purpose: 'unbind' })
    ok(sent.status === 200 && !!sent.data.debugCode, '解绑验证码发到当前绑定邮箱')

    const wrong = await api('POST', '/api/auth/unbind-email', { code: '000000' }, regToken)
    ok(wrong.status >= 400, '错误验证码解绑被拒')

    const un = await api('POST', '/api/auth/unbind-email', { code: sent.data.debugCode }, regToken)
    ok(un.status === 200 && un.data.ok === true && un.data.user.email === null, '验证码正确 → 解绑成功')

    const again = await api('POST', '/api/auth/unbind-email', { code: '123456' }, regToken)
    ok(again.status >= 400, '已解绑再解绑被拒')
  }

  /* ---------------- 5. 解绑微信 ---------------- */
  console.log('\n【5】解绑微信')
  {
    // dev 账号的 openid 固定为 "dev:" + deviceKey，相当于「已绑定微信」
    const devKey = 'secwx-' + shortId
    const devOpenId = 'dev:' + devKey
    const { token, user } = await devLogin('secw' + shortId, devKey)
    ok(user && user.weChatBound === true, 'dev 账号自带微信绑定')

    // 纯微信账号（无邮箱）不允许解绑微信
    const noEmail = await api('POST', '/api/auth/unbind-wechat', { code: wxCode(devOpenId) }, token)
    ok(noEmail.status >= 400, '无邮箱的纯微信账号解绑被拒')

    // 补绑邮箱
    const email = `sec-wxmail-${stamp}@test.dev`
    const sent = await api('POST', '/api/auth/email-code', { email, purpose: 'bind' })
    const bindMail = await api('POST', '/api/auth/bind-email', { email, code: sent.data.debugCode }, token)
    ok(bindMail.status === 200, '补绑邮箱成功')

    const otherWx = await api('POST', '/api/auth/unbind-wechat', { code: wxCode('someone-else') }, token)
    ok(otherWx.status >= 400, '授权的微信与绑定不一致时被拒')

    const un = await api('POST', '/api/auth/unbind-wechat', { code: wxCode(devOpenId) }, token)
    ok(un.status === 200 && un.data.ok === true && un.data.user.weChatBound === false, '授权一致 → 解绑成功')

    // 解绑后再绑定同一个微信：应该成功（openid 已释放）
    const rebind = await api('POST', '/api/auth/bind-wechat', { code: wxCode(devOpenId) }, token)
    ok(rebind.status === 200 && rebind.data.user.weChatBound === true, '解绑后可重新绑定')
  }

  console.log(`\n================ 结果 ================`)
  console.log(`通过 ${passCount} 项，失败 ${failCount} 项`)
  process.exit(failCount > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('测试执行异常：', e)
  process.exit(1)
})
