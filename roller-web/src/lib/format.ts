/**
 * 金额与时间的格式化/解析。
 *
 * 金额在后端永远是以「分」为单位的整数，到了展示层才变成元。
 * 用整数做加减，浮点只出现在最后的显示环节。
 */

/** 分 → "1,234.50"（不带货币符号） */
export function centsToYuan(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.round(cents))
  const yuan = Math.floor(abs / 100)
  const fen = abs % 100
  return `${sign}${yuan.toLocaleString('zh-CN')}.${String(fen).padStart(2, '0')}`
}

/** 分 → "¥1,234.50" */
export function formatMoney(cents: number): string {
  return `¥${centsToYuan(cents)}`
}

/**
 * 用户输入（"12.3" / "12" / "1,200.05"）→ 分。
 * 输入非法返回 null，由调用方提示。
 */
export function parseYuanToCents(input: string): number | null {
  const cleaned = input.replace(/,/g, '').trim()
  if (!cleaned) return null
  if (!/^\d*\.?\d{0,2}$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

/* --------------------------- 时间 --------------------------- */

const pad = (n: number) => String(n).padStart(2, '0')

/** 毫秒 → "2026-10-22" */
export function formatDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 毫秒 → "10-22 14:30" */
export function formatDateTime(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 把日期分组标题写得像人话：今天 / 昨天 / 10月22日 周三 */
export function friendlyDayLabel(ms: number): string {
  const d = new Date(ms)
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startOfThat = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((startOfToday - startOfThat) / 86_400_000)

  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays === 2) return '前天'

  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  if (d.getFullYear() === today.getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日 ${weekday}`
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${weekday}`
}

/** 当天 00:00 的毫秒时间戳 */
export function startOfDay(ms = Date.now()): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** 某月 1 号 00:00 */
export function startOfMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex, 1).getTime()
}

/** 下月 1 号 00:00（作为不含的右边界） */
export function endOfMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 1).getTime()
}

/** input[type=datetime-local] 需要的 "2026-10-22T14:30" */
export function toDateTimeLocal(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "2026-10-22T14:30" → 毫秒；解析失败返回 null */
export function fromDateTimeLocal(value: string): number | null {
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}
