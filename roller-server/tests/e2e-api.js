const BASE = process.env.BASE || 'http://localhost:5000'

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
  let data = null
  const text = await res.text()
  try { data = text ? JSON.parse(text) : null } catch (e) { data = { raw: text } }
  return { status: res.status, data }
}

async function login(nick) {
  const r = await req('POST', '/api/auth/dev', { nickName: nick })
  if (!r.data || !r.data.token) throw new Error('登录失败 ' + nick + ' → ' + JSON.stringify(r.data))
  return { token: r.data.token, user: r.data.user }
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
  console.log('等待服务启动…')
  if (!await waitForServer()) { console.error('服务未启动'); process.exit(1) }
  console.log('服务已就绪\n')

  // 主题上限 10 字，随机后缀要短一些
  const stamp = Date.now().toString(36).slice(-4)

  /* ---------------- 1. 未登录访问被拒 ---------------- */
  console.log('【1】鉴权')
  const anon = await req('GET', '/api/groups')
  check('未带 token 访问返回 401', anon.status === 401, anon)
  check('401 返回统一 JSON 错误体', anon.data && anon.data.ok === false && typeof anon.data.error === 'string', anon.data)

  /* ---------------- 2. 登录与创建小队 ---------------- */
  console.log('\n【2】创建小队与主题校验')
  const leader = await login('队长' + stamp)
  const mate = await login('同事' + stamp)
  const stranger = await login('路人' + stamp)

  check('开发模式登录返回 token', !!leader.token)
  check('登录返回用户信息', leader.user && leader.user.id > 0 && leader.user.isDevAccount === true, leader.user)

  const tooLong = await req('POST', '/api/groups', { theme: '一二三四五六七八九十十一' }, leader.token)
  check('主题超过 10 字被拒绝', tooLong.status === 400 && /最多 10 个字符/.test(tooLong.data.error), tooLong.data)

  const badPass = await req('POST', '/api/groups', { theme: '测试', passcode: '1234' }, leader.token)
  check('口令非 5 位数字被拒绝', badPass.status === 400 && /5 位数字/.test(badPass.data.error), badPass.data)

  const created = await req('POST', '/api/groups', { theme: '午饭吃什么', passcode: '' }, leader.token)
  check('创建小队成功', created.data.ok === true, created.data)
  const gid = created.data.group.id
  const code = created.data.group.code
  check('邀请码为 6 位数字', /^\d{6}$/.test(code), code)
  check('创建者自动成为成员（人数 1）', created.data.group.memberCount === 1, created.data.group.memberCount)
  check('创建者即小队长', created.data.group.ownerId === leader.user.id)
  check('初始阶段为 config', created.data.group.stage === 'config')
  check('无口令时 hasPasscode=false', created.data.group.hasPasscode === false)

  /* ---------------- 3. 备选项与自动投票 ---------------- */
  console.log('\n【3】备选项与创建者自动投票')
  const optA = await req('POST', `/api/groups/${gid}/options`, { title: '火锅' }, leader.token)
  check('添加备选项成功', optA.data.ok === true, optA.data)
  check('返回 autoVoted=true', optA.data.autoVoted === true, optA.data)

  let w = await req('GET', `/api/groups/${gid}/weights`, null, leader.token)
  check('新备选项自带 1 票权重', w.data.items.length === 1 && w.data.items[0].votes === 1 && w.data.items[0].weight === 1, w.data.items)

  const dup = await req('POST', `/api/groups/${gid}/options`, { title: '火锅' }, leader.token)
  check('同组重复备选项被拒绝', dup.status === 400 && /已存在/.test(dup.data.error), dup.data)

  /* ---------------- 4. 加入小队 ---------------- */
  console.log('\n【4】加入小队')
  const joinB = await req('POST', `/api/groups/${gid}/join`, {}, mate.token)
  check('成员加入成功', joinB.data.ok === true, joinB.data)
  const again = await req('POST', `/api/groups/${gid}/join`, {}, mate.token)
  check('重复加入返回 already=true', again.data.already === true, again.data)

  const optB = await req('POST', `/api/groups/${gid}/options`, { title: '螺蛳粉' }, mate.token)
  check('普通成员也能添加备选项', optB.data.ok === true, optB.data)
  check('成员添加的备选项也自动投票', optB.data.autoVoted === true)

  const v1 = await req('POST', `/api/options/${optA.data.optionId}/vote`, {}, mate.token)
  check('成员可投票', v1.data.voted === true, v1.data)
  const v2 = await req('POST', `/api/options/${optA.data.optionId}/vote`, {}, mate.token)
  check('再点一次为撤票', v2.data.voted === false, v2.data)
  const v3 = await req('POST', `/api/options/${optA.data.optionId}/vote`, {}, mate.token)
  check('撤票后可重新投票', v3.data.voted === true)

  const bundle = await req('GET', `/api/groups/${gid}`, null, mate.token)
  check('成员视角 isMember=true / isLeader=false', bundle.data.isMember === true && bundle.data.isLeader === false)
  check('一次返回成员列表', bundle.data.members.length === 2, bundle.data.members.length)
  check('一次返回备选项列表', bundle.data.options.length === 2)
  check('票数即权重（火锅 2 票 / 螺蛳粉 1 票）',
    bundle.data.weights.totalVotes === 3 &&
    bundle.data.weights.items.find(i => i.title === '火锅').votes === 2 &&
    bundle.data.weights.items.find(i => i.title === '螺蛳粉').votes === 1,
    bundle.data.weights.items)
  check('百分比按权重分配',
    Math.abs(bundle.data.weights.items.find(i => i.title === '火锅').percent - 2 / 3) < 1e-9)

  const nonMember = await req('POST', `/api/groups/${gid}/options`, { title: '不该成功' }, stranger.token)
  check('非成员不能添加备选项', nonMember.status === 403, nonMember.data)

  /* ---------------- 5. 权限：只有创建者能删 ---------------- */
  console.log('\n【5】备选项删除权限')
  const delByOther = await req('DELETE', `/api/options/${optA.data.optionId}`, null, mate.token)
  check('非创建者删除被拒绝(403)', delByOther.status === 403 && /只有创建者/.test(delByOther.data.error), delByOther.data)

  const tmpOpt = await req('POST', `/api/groups/${gid}/options`, { title: '临时项' }, leader.token)
  const delByOwner = await req('DELETE', `/api/options/${tmpOpt.data.optionId}`, null, leader.token)
  check('创建者可删除自己的备选项', delByOwner.data.ok === true, delByOwner.data)
  const afterDel = await req('GET', `/api/groups/${gid}/weights`, null, leader.token)
  check('删除后备选项数量回到 2', afterDel.data.items.length === 2, afterDel.data.items.length)

  /* ---------------- 6. 小队设置 ---------------- */
  console.log('\n【6】小队设置修改权限')
  const patchByMate = await req('PATCH', `/api/groups/${gid}`, { theme: '换成别人改' }, mate.token)
  check('非小队长改主题被拒绝(403)', patchByMate.status === 403, patchByMate.data)

  const patchTheme = await req('PATCH', `/api/groups/${gid}`, { theme: '晚饭吃啥' }, leader.token)
  check('小队长可改主题', patchTheme.data.ok === true && patchTheme.data.group.theme === '晚饭吃啥', patchTheme.data.group && patchTheme.data.group.theme)
  check('只改主题不会清掉口令', patchTheme.data.group.hasPasscode === false)

  const mateView = await req('GET', `/api/groups/${gid}`, null, mate.token)
  check('成员侧看不到口令字段（防泄露）', mateView.data.group.passcode === '', mateView.data.group.passcode)

  /* ---------------- 7. 准备环节 ---------------- */
  console.log('\n【7】准备环节')
  const prepareByMate = await req('POST', `/api/groups/${gid}/prepare`, { deadlineSeconds: 300 }, mate.token)
  check('非小队长不能开启随机(403)', prepareByMate.status === 403, prepareByMate.data)

  const prepare = await req('POST', `/api/groups/${gid}/prepare`, { deadlineSeconds: 300 }, leader.token)
  check('小队长开启随机成功', prepare.data.ok === true && prepare.data.stage === 'preparing', prepare.data)
  check('返回了最晚结束时间', typeof prepare.data.prepDeadline === 'number' && prepare.data.prepDeadline > Date.now())

  const lockedAdd = await req('POST', `/api/groups/${gid}/options`, { title: '准备中别加' }, mate.token)
  check('准备环节备选项被锁定', lockedAdd.status === 400 && /锁定/.test(lockedAdd.data.error), lockedAdd.data)

  const lockedVote = await req('POST', `/api/options/${optA.data.optionId}/vote`, {}, mate.token)
  check('准备环节投票被拦截', lockedVote.status === 400, lockedVote.data)

  const confirmB = await req('POST', `/api/groups/${gid}/ready`, { action: 'confirm' }, mate.token)
  check('成员点确定，尚未全员', confirmB.data.allConfirmed === false, confirmB.data)

  const mid = await req('GET', `/api/groups/${gid}/state`, null, leader.token)
  check('状态接口显示 1 人已确认 / 共 2 人', mid.data.state.confirmedCount === 1 && mid.data.state.memberCount === 2, mid.data.state)

  const confirmA = await req('POST', `/api/groups/${gid}/ready`, { action: 'confirm' }, leader.token)
  check('全员确认后 allConfirmed=true', confirmA.data.allConfirmed === true, confirmA.data)

  /* ---------------- 8. 随机结果 ---------------- */
  console.log('\n【8】加权随机结果')
  const roll = await req('POST', `/api/groups/${gid}/roll`, {}, leader.token)
  check('产出结果', roll.data.ok === true && !!roll.data.chosen, roll.data)
  check('结果来自备选项之一', ['火锅', '螺蛳粉'].includes(roll.data.chosen && roll.data.chosen.title), roll.data.chosen)
  check('结果不带 pending 标记', roll.data.pending !== true)

  const detail = await req('GET', `/api/groups/${gid}`, null, mate.token)
  check('阶段变为 result', detail.data.group.stage === 'result', detail.data.group.stage)
  check('小队上记录了结果项', detail.data.group.resultOptionId === roll.data.chosen.optionId)

  const rollAgain = await req('POST', `/api/groups/${gid}/roll`, {}, mate.token)
  check('重复取结果幂等（不会重新抽）', rollAgain.data.chosen.optionId === roll.data.chosen.optionId, rollAgain.data.chosen)

  /* ---------------- 9. 通知 ---------------- */
  console.log('\n【9】通知')
  const notifB = await req('GET', '/api/notifications', null, mate.token)
  check('全员收到结果通知', notifB.data.items.some(n => n.type === 'result' && /随机结果已出/.test(n.content)), notifB.data.items.map(n => n.type))
  check('未读数大于 0', notifB.data.unread > 0, notifB.data.unread)
  await req('POST', '/api/notifications/read', {}, mate.token)
  const notifB2 = await req('GET', '/api/notifications', null, mate.token)
  check('标记已读后未读数归零', notifB2.data.unread === 0, notifB2.data.unread)

  /* ---------------- 10. 回到配置与取消流程 ---------------- */
  console.log('\n【10】重置与取消流程')
  const resetByMate = await req('POST', `/api/groups/${gid}/reset`, {}, mate.token)
  check('非小队长不能开始新一轮(403)', resetByMate.status === 403, resetByMate.data)

  const reset = await req('POST', `/api/groups/${gid}/reset`, {}, leader.token)
  check('小队长重置回 config', reset.data.ok === true && reset.data.stage === 'config', reset.data)

  await req('POST', `/api/groups/${gid}/prepare`, { deadlineSeconds: 300 }, leader.token)
  const cancel = await req('POST', `/api/groups/${gid}/ready`, { action: 'cancel' }, mate.token)
  check('成员取消准备成功', cancel.data.cancelled === true, cancel.data)
  const afterCancel = await req('GET', `/api/groups/${gid}`, null, leader.token)
  check('取消后阶段回到 config', afterCancel.data.group.stage === 'config', afterCancel.data.group.stage)
  check('取消后清空最晚结束时间', afterCancel.data.group.prepDeadline === null)
  check('取消后成员准备状态被重置', afterCancel.data.members.every(m => m.ready === 'none'))

  const notifA = await req('GET', '/api/notifications', null, leader.token)
  check('小队长收到取消通知', notifA.data.items.some(n => n.type === 'cancel'), notifA.data.items.map(n => n.type))

  /* ---------------- 11. 口令 ---------------- */
  console.log('\n【11】小队口令')
  const g2 = await req('POST', '/api/groups', { theme: '口令组' + stamp, passcode: '12345' }, leader.token)
  const gid2 = g2.data.group.id
  check('小队长能看到自己的口令', g2.data.group.passcode === '12345', g2.data.group.passcode)

  const noPass = await req('POST', `/api/groups/${gid2}/join`, {}, stranger.token)
  check('不带口令加入被拒绝', noPass.status === 400 && noPass.data.needPasscode === true, noPass.data)
  const wrongPass = await req('POST', `/api/groups/${gid2}/join`, { passcode: '99999' }, stranger.token)
  check('口令错误被拒绝', wrongPass.status === 400 && /口令不正确/.test(wrongPass.data.error), wrongPass.data)
  const rightPass = await req('POST', `/api/groups/${gid2}/join`, { passcode: '12345' }, stranger.token)
  check('口令正确可加入', rightPass.data.ok === true, rightPass.data)

  const clearPass = await req('PATCH', `/api/groups/${gid2}`, { passcode: '' }, leader.token)
  check('小队长可清除口令', clearPass.data.group.hasPasscode === false, clearPass.data.group.hasPasscode)

  /* ---------------- 12. 人数上限 ---------------- */
  console.log('\n【12】人数上限 20')
  const g3 = await req('POST', '/api/groups', { theme: '满员' + stamp }, leader.token)
  const gid3 = g3.data.group.id
  let okJoins = 0
  let lastErr = null
  for (let i = 0; i < 22; i++) {
    const u = await login('满员' + i + '_' + stamp)
    const r = await req('POST', `/api/groups/${gid3}/join`, {}, u.token)
    if (r.data && r.data.ok) okJoins++
    else lastErr = r.data
    if (i === 0) {
      const st = await req('GET', `/api/me/stats`, null, u.token)
      check('/api/me/stats 返回统计数据', st.data.ok === true && typeof st.data.stats.joinedCount === 'number', st.data)
    }
  }
  check('恰好 19 人补位成功（队长占 1 席）', okJoins === 19, okJoins)
  check('第 21 人被拒绝并提示上限', lastErr && /上限/.test(lastErr.error), lastErr)
  const g3View = await req('GET', `/api/groups/${gid3}`, null, leader.token)
  check('最终人数正好 20', g3View.data.group.memberCount === 20, g3View.data.group.memberCount)

  /* ---------------- 13. 搜索与退出 ---------------- */
  console.log('\n【13】大厅搜索与退出')
  const byCode = await req('GET', `/api/groups?keyword=${code}`, null, leader.token)
  check('可用 6 位邀请码精确搜索', byCode.data.groups.some(g => g.id === gid), byCode.data.groups.length)
  const byTheme = await req('GET', `/api/groups?keyword=晚饭`, null, leader.token)
  check('可按主题模糊搜索', byTheme.data.groups.some(g => g.id === gid), byTheme.data.groups.map(g => g.theme))
  const listMine = await req('GET', '/api/groups', null, leader.token)
  const mineRow = listMine.data.groups.find(g => g.id === gid)
  check('列表中标注我是否已加入', mineRow && mineRow.joined === true && mineRow.owner === true, mineRow)

  const leaveOwner = await req('POST', `/api/groups/${gid}/leave`, {}, leader.token)
  check('小队长不能退出（需解散）', leaveOwner.status === 400, leaveOwner.data)
  const leaveMate = await req('POST', `/api/groups/${gid}/leave`, {}, mate.token)
  check('普通成员可退出', leaveMate.data.ok === true, leaveMate.data)
  const afterLeave = await req('GET', `/api/groups/${gid}`, null, leader.token)
  check('退出后人数减 1', afterLeave.data.group.memberCount === 1, afterLeave.data.group.memberCount)

  /* ---------------- 14. 改昵称同步 ---------------- */
  console.log('\n【14】修改昵称')
  const newNick = '新名字' + stamp
  const renamed = await req('PUT', '/api/me', { nickName: newNick }, mate.token)
  check('修改昵称成功', renamed.data.ok === true && renamed.data.user.nickName === newNick, renamed.data)
  const emptyNick = await req('PUT', '/api/me', { nickName: '   ' }, mate.token)
  check('空昵称被拒绝', emptyNick.status === 400, emptyNick.data)

  /* ---------------- 15. 零票等权兜底 ---------------- */
  console.log('\n【15】全员零票时退化为等权')
  const g4 = await req('POST', '/api/groups', { theme: '零票' + stamp }, leader.token)
  const gid4 = g4.data.group.id
  const o41 = await req('POST', `/api/groups/${gid4}/options`, { title: '选项一' }, leader.token)
  const o42 = await req('POST', `/api/groups/${gid4}/options`, { title: '选项二' }, leader.token)
  await req('POST', `/api/options/${o41.data.optionId}/vote`, {}, leader.token)
  await req('POST', `/api/options/${o42.data.optionId}/vote`, {}, leader.token)
  const w4 = await req('GET', `/api/groups/${gid4}/weights`, null, leader.token)
  check('全部撤票后 uniform=true 且各项等权', w4.data.uniform === true && w4.data.items.every(i => i.weight === 1), w4.data)
  await req('POST', `/api/groups/${gid4}/prepare`, { deadlineSeconds: 60 }, leader.token)
  await req('POST', `/api/groups/${gid4}/ready`, { action: 'confirm' }, leader.token)
  const roll4 = await req('POST', `/api/groups/${gid4}/roll`, {}, leader.token)
  check('零票时依然能抽出结果', roll4.data.ok === true && !!roll4.data.chosen, roll4.data)

  /* ---------------- 16. 加权分布 ---------------- */
  console.log('\n【16】加权分布实测（权重 3:1，100 轮）')
  const g5 = await req('POST', '/api/groups', { theme: '分布' + stamp }, leader.token)
  const gid5 = g5.data.group.id
  const u5 = await login('分布员' + stamp)
  await req('POST', `/api/groups/${gid5}/join`, {}, u5.token)
  const u6 = await login('分布乙' + stamp)
  await req('POST', `/api/groups/${gid5}/join`, {}, u6.token)

  // 甲：仅队长创建时自动投的 1 票 → 权重 1
  // 乙：队长自动 1 票 + u5 一票 + u6 一票 → 权重 3
  const o5a = await req('POST', `/api/groups/${gid5}/options`, { title: '甲' }, leader.token)
  const o5b = await req('POST', `/api/groups/${gid5}/options`, { title: '乙' }, leader.token)
  await req('POST', `/api/options/${o5b.data.optionId}/vote`, {}, u5.token)
  await req('POST', `/api/options/${o5b.data.optionId}/vote`, {}, u6.token)
  const w5 = await req('GET', `/api/groups/${gid5}/weights`, null, leader.token)
  check('权重确认为 1 : 3', w5.data.items.find(i => i.title === '甲').weight === 1 && w5.data.items.find(i => i.title === '乙').weight === 3, w5.data.items)

  let hitsB = 0
  const rounds = 100
  for (let i = 0; i < rounds; i++) {
    await req('POST', `/api/groups/${gid5}/reset`, {}, leader.token)
    await req('POST', `/api/groups/${gid5}/prepare`, { deadlineSeconds: 60 }, leader.token)
    await req('POST', `/api/groups/${gid5}/ready`, { action: 'confirm' }, leader.token)
    await req('POST', `/api/groups/${gid5}/ready`, { action: 'confirm' }, u5.token)
    await req('POST', `/api/groups/${gid5}/ready`, { action: 'confirm' }, u6.token)
    const r = await req('POST', `/api/groups/${gid5}/roll`, {}, leader.token)
    if (r.data.chosen && r.data.chosen.title === '乙') hitsB++
  }
  const share = hitsB / rounds
  check('实测命中率接近 75%（' + (share * 100).toFixed(1) + '%）', share > 0.6 && share < 0.9, share)

  /* ---------------- 17. 解散小队 ---------------- */
  console.log('\n【17】解散小队')
  const delByMate = await req('DELETE', `/api/groups/${gid5}`, null, u5.token)
  check('非小队长不能解散(403)', delByMate.status === 403, delByMate.data)
  const delOk = await req('DELETE', `/api/groups/${gid5}`, null, leader.token)
  check('小队长解散成功', delOk.data.ok === true, delOk.data)
  const gone = await req('GET', `/api/groups/${gid5}`, null, leader.token)
  check('解散后小队不存在(404)', gone.status === 404, gone.data)

  console.log('\n================ 结果 ================')
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项')
  process.exit(fail === 0 ? 0 : 1)
})().catch(e => { console.error('脚本异常:', e); process.exit(1) })
