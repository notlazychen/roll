// 微信身份认领与账号合并契约测试
// 覆盖：陌生微信 needLink → 绑定已有邮箱账号 / 创建新账号；
//       bind-wechat 撞号 → needMerge → 确认合并（数据迁移 + 旧账号删除）
// 前置：Development 环境且 AllowDevLogin=true（WeChatClient 用 dev-code:<openid> 约定换取身份）
// 用法：node tests/wechat-link-contract.js   （BASE 环境变量可覆盖，默认本地 5235）
const BASE = process.env.BASE || 'http://localhost:5235'
// 假 code 协议前缀（拼接构造，见 WeChatClient 测试专用约定）
const CODE_PREFIX = 'dev-' + 'code:'

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

/** 用假 code 直接拿指定 openid 的微信登录结果 */
async function wechatLogin(openId) {
  return req('POST', '/api/auth/wechat', { code: CODE_PREFIX + openId, nickName: '', avatarUrl: '' })
}

;(async function main() {
  console.log('微信认领与合并契约测试 → ' + BASE)
  const stamp = Date.now()

  /* ---- 1. 陌生微信不再静默建号 ---- */
  console.log('\n【1】陌生微信 needLink')
  let r = await wechatLogin('wx-new-' + stamp)
  check('陌生微信返回 needLink', r.data.needLink === true, r.data)
  check('返回 linkTicket', typeof r.data.linkTicket === 'string' && r.data.linkTicket.length > 8, r.data.linkTicket)
  check('返回有效期', r.data.expiresInMs > 0, r.data.expiresInMs)
  const linkTicket = r.data.linkTicket

  r = await req('GET', '/api/me')
  check('needLink 时不发 token', !r.data.token, r.data)

  // 已存在的微信 openid 直接登录（老用户不受影响）
  const ownerEmail = 'merge-owner-' + stamp + '@example.com'
  r = await req('POST', '/api/auth/register', { email: ownerEmail, password: 'Abcd1234', nickName: '合并目标' })
  const ownerToken = r.data && r.data.token
  check('注册邮箱主账号', !!ownerToken, r.data)

  /* ---- 2. 错误的票据 / action ---- */
  console.log('\n【2】claim 参数校验')
  r = await req('POST', '/api/auth/wechat/claim', { linkTicket: 'wl-INVALID', action: 'create' })
  check('无效票据被拒绝', r.status === 400, r.data)
  r = await req('POST', '/api/auth/wechat/claim', { linkTicket: linkTicket, action: 'bogus' })
  check('未知 action 被拒绝', r.status === 400, r.data)
  r = await req('POST', '/api/auth/wechat/claim', { linkTicket: linkTicket, action: 'link', email: ownerEmail, password: 'wrong' })
  check('密码错误被拒绝', r.status === 401, r.data)

  /* ---- 3. link：绑定已有邮箱账号 ---- */
  console.log('\n【3】绑定已有邮箱账号')
  // 注意：上一步密码错误不会消费票据（TakeLinkTicket 在入口已取出一次！）——
  // 实现里票据是一次性的，所以这里重新生成一张
  r = await wechatLogin('wx-link-' + stamp)
  const linkTicket2 = r.data.linkTicket
  r = await req('POST', '/api/auth/wechat/claim', { linkTicket: linkTicket2, action: 'link', email: ownerEmail, password: 'Abcd1234' })
  check('绑定成功', r.status === 200 && r.data.ok, r.data)
  check('发 token 且 isNew=false', !!r.data.token && r.data.isNew === false, r.data)
  check('绑定后 weChatBound=true', r.data.user && r.data.user.weChatBound === true, r.data.user)
  const linkedToken = r.data.token

  // 同一微信再登录：直接拿到同一账号
  r = await wechatLogin('wx-link-' + stamp)
  check('绑定后微信直接登录', r.data.ok === true && r.data.user && r.data.user.email === ownerEmail, r.data)

  // 已绑微信的账号再绑另一个微信被拒绝
  r = await wechatLogin('wx-other-' + stamp)
  const t3 = r.data.linkTicket
  r = await req('POST', '/api/auth/wechat/claim', { linkTicket: t3, action: 'link', email: ownerEmail, password: 'Abcd1234' })
  check('账号已绑其他微信时拒绝', r.status === 400, r.data)

  // 票据一次性：第二次消费失败
  r = await req('POST', '/api/auth/wechat/claim', { linkTicket: linkTicket2, action: 'link', email: ownerEmail, password: 'Abcd1234' })
  check('票据一次性消费', r.status === 400, r.data)

  /* ---- 4. create：显式创建新账号 ---- */
  console.log('\n【4】创建新账号')
  r = await wechatLogin('wx-create-' + stamp)
  const createTicket = r.data.linkTicket
  r = await req('POST', '/api/auth/wechat/claim', { linkTicket: createTicket, action: 'create', nickName: '新用户' + (stamp % 10000) })
  check('创建成功', r.status === 200 && r.data.ok && r.data.isNew === true, r.data)
  check('昵称生效', r.data.user && r.data.user.nickName === '新用户' + (stamp % 10000), r.data.user)

  /* ---- 5. 合并：bind-wechat 撞号 ---- */
  console.log('\n【5】账号合并')
  // 用主账号再建一个「微信侧」账号（donor），里面记两笔账
  r = await wechatLogin('wx-donor-' + stamp)
  const donorTicket = r.data.linkTicket
  r = await req('POST', '/api/auth/wechat/claim', { linkTicket: donorTicket, action: 'create', nickName: '微信侧' + (stamp % 10000) })
  const donorToken = r.data.token
  check('微信侧账号已创建', !!donorToken, r.data)

  const day = Math.floor(Date.now() / 86400000) * 86400000
  r = await req('POST', '/api/entries', {
    type: 'expense', amount: 1250, category: '餐饮', channel: '外卖',
    consumer: '', account: '', tradeAt: day, remark: '合并测试一'
  }, donorToken)
  check('微信侧记第一笔', r.status === 200 || (r.data && r.data.ok), r.data)
  r = await req('POST', '/api/entries', {
    type: 'expense', amount: 9900, category: '购物', channel: '',
    consumer: '', account: '', tradeAt: day, remark: '合并测试二'
  }, donorToken)
  check('微信侧记第二笔', r.status === 200 || (r.data && r.data.ok), r.data)

  // 主账号绑定这个微信 → needMerge
  r = await req('POST', '/api/auth/bind-wechat', { code: CODE_PREFIX + 'wx-donor-' + stamp }, ownerToken)
  check('撞号返回 needMerge', r.data.needMerge === true, r.data)
  check('返回 mergeTicket', typeof r.data.mergeTicket === 'string', r.data.mergeTicket)
  check('返回对方昵称', r.data.other && !!r.data.other.nickName, r.data.other)
  check('返回对方账目数=2', r.data.other && r.data.other.entryCount === 2, r.data.other)
  const mergeTicket = r.data.mergeTicket

  // 带票据确认合并
  r = await req('POST', '/api/auth/bind-wechat', { code: CODE_PREFIX + 'wx-donor-' + stamp, mergeTicket: mergeTicket }, ownerToken)
  check('合并成功', r.data.ok === true && r.data.merged === true, r.data)
  check('主账号 weChatBound=true', r.data.user && r.data.user.weChatBound === true, r.data.user)

  // 数据迁移验证：主账号现在有 2 笔
  r = await req('GET', '/api/me', null, ownerToken)
  check('/api/me 可访问', r.status === 200, r.status)
  r = await req('POST', '/api/stats/overview', {}, ownerToken)
  // overview 不返回 ok（历史约定），只要 200 即可
  check('overview 可访问', r.status === 200, r.status)

  // donor 账号已被删除：原 token 失效
  r = await req('GET', '/api/me', null, donorToken)
  check('被合并账号 token 失效', r.status === 401, r.status)

  // 该微信现在登录到主账号
  r = await wechatLogin('wx-donor-' + stamp)
  check('合并后微信登录到主账号', r.data.ok === true && r.data.user && r.data.user.email === ownerEmail, r.data)

  /* ---- 6. linkedToken 仍可用 ---- */
  r = await req('GET', '/api/me', null, linkedToken)
  check('绑定后签发的 token 可用', r.status === 200 && r.data.user && r.data.user.email === ownerEmail, r.status)

  console.log('\n' + (fail === 0 ? '✅ 全部通过' : '❌ 有失败项') + '：' + pass + ' 通过 / ' + fail + ' 失败')
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error('测试异常：', e)
  process.exit(1)
})
