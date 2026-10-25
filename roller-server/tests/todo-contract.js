/**
 * 任务清单契约测试
 *   BASE=http://127.0.0.1:5299 node tests/todo-contract.js
 * 依赖 Development 环境的 /api/auth/dev 快捷登录。
 */
const BASE = process.env.BASE || 'http://127.0.0.1:5299'

let passed = 0
let failed = 0

function ok(cond, label) {
  if (cond) { passed++; console.log('  ✓', label) }
  else { failed++; console.log('  ✗', label) }
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
  try { data = await res.json() } catch (e) {}
  return { status: res.status, data }
}

/** 东八区今天，格式 yyyy-MM-dd */
function todayCN(offsetDays = 0) {
  const d = new Date(Date.now() + 8 * 3600e3 + offsetDays * 86400e3)
  return d.toISOString().slice(0, 10)
}

async function devLogin(nick) {
  const r = await api('POST', '/api/auth/dev', { nickName: nick })
  if (!r.data || !r.data.token) throw new Error('dev 登录失败: ' + JSON.stringify(r.data))
  return r.data.token
}

async function main() {
  const stamp = Date.now().toString(36)
  const shortId = stamp.slice(-6)
  const token = await devLogin('todo' + shortId)
  const tz = 480

  console.log('\n【1】创建任务与校验')
  {
    const blank = await api('POST', '/api/todos', { title: '   ', type: 'once', dueDate: todayCN() }, token)
    ok(blank.status >= 400, '空标题被拒')

    const noDue = await api('POST', '/api/todos', { title: '一次性任务', type: 'once' }, token)
    ok(noDue.status >= 400, '一次性任务缺目标日期被拒')

    const noWeek = await api('POST', '/api/todos', { title: '周期任务', type: 'recurring', weekDays: [] }, token)
    ok(noWeek.status >= 400, '周期任务缺重复日被拒')

    const badWeek = await api('POST', '/api/todos', { title: '周期任务', type: 'recurring', weekDays: [0, 9] }, token)
    ok(badWeek.status >= 400, '非法星期值被拒')
  }

  console.log('\n【2】今日任务（一次性）')
  let onceTodayId, onceOverdueId
  {
    const r = await api('POST', '/api/todos', { title: '今日一次性', type: 'once', dueDate: todayCN(), tz }, token)
    ok(r.status === 200 && r.data.ok, '创建今日一次性任务')
    onceTodayId = r.data.task.id
    ok(r.data.task.dueDate === todayCN(), 'dueDate 回显正确')

    const overdue = await api('POST', '/api/todos', { title: '昨天欠的', type: 'once', dueDate: todayCN(-1), tz }, token)
    onceOverdueId = overdue.data.task.id

    const tomorrow = await api('POST', '/api/todos', { title: '明天的任务', type: 'once', dueDate: todayCN(1), tz }, token)
    ok(tomorrow.status === 200, '创建明天的一次性任务')

    const list = await api('GET', `/api/todos/today?tz=${tz}`, undefined, token)
    ok(list.status === 200 && list.data.ok, '今日任务列表可获取')
    const titles = list.data.tasks.map(t => t.title)
    ok(titles.includes('今日一次性'), '今天的任务出现在今日列表')
    ok(titles.includes('昨天欠的'), '过期未完成任务出现在今日列表')
    ok(!titles.includes('明天的任务'), '明天的任务不出现')
    const od = list.data.tasks.find(t => t.title === '昨天欠的')
    ok(od && od.overdue === true && od.done === false, '过期任务标记 overdue')
  }

  console.log('\n【3】周期任务与打卡')
  let dailyId, weeklyId
  {
    const r = await api('POST', '/api/todos', { title: '每日读书', type: 'recurring', weekDays: [1, 2, 3, 4, 5, 6, 7], tz }, token)
    ok(r.status === 200 && r.data.task.weekDays.length === 7, '创建每日任务')
    dailyId = r.data.task.id

    // 未来才生效的周五任务：今天不应出现
    const fri = await api('POST', '/api/todos', {
      title: '未来周五', type: 'recurring', weekDays: [5],
      startDate: todayCN(14), tz
    }, token)
    weeklyId = fri.data.task.id
    ok(fri.status === 200, '创建带 startDate 的周五任务')

    let list = await api('GET', `/api/todos/today?tz=${tz}`, undefined, token)
    const titles = list.data.tasks.map(t => t.title)
    ok(titles.includes('每日读书'), '每日任务出现在今日列表')
    ok(!titles.includes('未来周五'), 'startDate 未到的周期任务不出现')

    const c1 = await api('POST', `/api/todos/${dailyId}/checkin`, { tz }, token)
    ok(c1.status === 200 && c1.data.ok && c1.data.count === 1, '打卡成功，count=1')

    const c2 = await api('POST', `/api/todos/${dailyId}/checkin`, { tz }, token)
    ok(c2.status === 200 && c2.data.already === true && c2.data.count === 1, '同一天重复打卡幂等')

    const future = await api('POST', `/api/todos/${dailyId}/checkin`, { date: todayCN(2), tz }, token)
    ok(future.status >= 400, '给未来打卡被拒')

    list = await api('GET', `/api/todos/today?tz=${tz}`, undefined, token)
    const daily = list.data.tasks.find(t => t.id === dailyId)
    ok(daily && daily.checkedIn === true && daily.done === true, '打卡后今日列表显示已完成')

    const detail = await api('GET', '/api/todos/', undefined, token)
    const row = detail.data.tasks.find(t => t.id === dailyId)
    ok(row && row.checkinCount === 1, '规划页累计打卡次数=1')

    // 撤销打卡
    const undo = await api('DELETE', `/api/todos/${dailyId}/checkin?tz=${tz}`, undefined, token)
    ok(undo.status === 200 && undo.data.count === 0, '撤销打卡成功')
    const re = await api('POST', `/api/todos/${dailyId}/checkin`, { tz }, token)
    ok(re.status === 200 && re.data.count === 1, '撤销后重新打卡')

    // 补卡昨天
    const back = await api('POST', `/api/todos/${dailyId}/checkin`, { date: todayCN(-1), tz }, token)
    ok(back.status === 200 && back.data.count === 2, '给昨天补卡成功 count=2')
  }

  console.log('\n【4】修改与删除')
  {
    const up = await api('PUT', `/api/todos/${onceTodayId}`, { title: '改名的一次性', type: 'once', dueDate: todayCN(), tz }, token)
    ok(up.status === 200 && up.data.task.title === '改名的一次性', '修改标题')

    const toRecurring = await api('PUT', `/api/todos/${onceTodayId}`, { title: '改成周期', type: 'recurring', weekDays: [1], tz }, token)
    ok(toRecurring.status === 200 && toRecurring.data.task.type === 'recurring', '一次性改为周期')
    // 改回一次性，避免影响后续断言
    await api('PUT', `/api/todos/${onceTodayId}`, { title: '今日一次性', type: 'once', dueDate: todayCN(), tz }, token)

    const del = await api('DELETE', `/api/todos/${weeklyId}`, undefined, token)
    ok(del.status === 200 && del.data.ok, '删除任务')

    const gone = await api('GET', '/api/todos/', undefined, token)
    ok(!gone.data.tasks.some(t => t.id === weeklyId), '删除后规划页不再返回')

    const delAgain = await api('DELETE', `/api/todos/${weeklyId}`, undefined, token)
    ok(delAgain.status === 404, '重复删除返回 404')
  }

  console.log('\n【5】一次性任务完成态')
  {
    const c = await api('POST', `/api/todos/${onceTodayId}/checkin`, { tz }, token)
    ok(c.status === 200 && c.data.count === 1, '一次性任务打卡即完成')

    let list = await api('GET', `/api/todos/today?tz=${tz}`, undefined, token)
    let row = list.data.tasks.find(t => t.id === onceTodayId)
    ok(row && row.done === true, '完成后 done=true')

    const undo = await api('DELETE', `/api/todos/${onceTodayId}/checkin?tz=${tz}`, undefined, token)
    ok(undo.status === 200, '撤销完成')
    list = await api('GET', `/api/todos/today?tz=${tz}`, undefined, token)
    row = list.data.tasks.find(t => t.id === onceTodayId)
    ok(row && row.done === false, '撤销后恢复未完成')
  }

  console.log('\n【6】数据图表')
  {
    const s = await api('GET', `/api/todos/stats?days=14&tz=${tz}`, undefined, token)
    ok(s.status === 200 && s.data.ok, 'stats 可获取')
    ok(Array.isArray(s.data.daily) && s.data.daily.length === 14, 'daily 覆盖 14 天')
    ok(s.data.daily[13].day === todayCN(), 'daily 最后一天是今天')
    ok(s.data.daily[13].count >= 1, '今天的打卡数 >= 1')
    ok(Array.isArray(s.data.ranking) && s.data.ranking.length > 0, '任务榜非空')
    const top = s.data.ranking[0]
    ok(top.id === dailyId && top.count === 2, '每日读书以 2 次打卡登顶')
    ok(s.data.totalCheckins >= 2, 'totalCheckins 统计正确')
  }

  console.log('\n【7】用户隔离')
  {
    const other = await devLogin('todoB' + shortId)
    const list = await api('GET', '/api/todos/', undefined, other)
    ok(list.data.tasks.length === 0, '其他用户看不到任务')

    const hack = await api('POST', `/api/todos/${dailyId}/checkin`, { tz }, other)
    ok(hack.status === 404, '其他用户不能给别人打卡')

    const del = await api('DELETE', `/api/todos/${dailyId}`, undefined, other)
    ok(del.status === 404, '其他用户不能删别人的任务')
  }

  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => { console.error('测试执行失败:', e.message); process.exit(1) })
