/**
 * 通用工具方法
 */

/** 金额：分 → 元（字符串），保留两位小数，去掉多余的 .00 */
function yuan(cents, keepZero) {
  const v = Number(cents || 0) / 100
  if (!isFinite(v)) return '0.00'
  const s = Math.abs(v).toFixed(2)
  if (!keepZero && /\.00$/.test(s)) return (v < 0 ? '-' : '') + s.replace(/\.00$/, '')
  return (v < 0 ? '-' : '') + s
}

/** 金额：元（输入框字符串）→ 分（整数），非法值返回 0 */
function toCents(input) {
  const s = String(input === undefined || input === null ? '' : input).trim()
  if (!s) return 0
  if (!/^\d*(\.\d{0,2})?$/.test(s)) return NaN
  const n = Math.round(Number(s) * 100)
  return isFinite(n) ? n : NaN
}

/** 带千分位的金额展示 */
function money(cents, sign) {
  const v = Number(cents || 0) / 100
  const fixed = Math.abs(v).toFixed(2)
  const parts = fixed.split('.')
  const int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const body = int + '.' + parts[1]
  if (sign) return (sign === 'in' ? '+' : '-') + body
  return (v < 0 ? '-' : '') + body
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

/** 时间戳 -> HH:mm */
function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

/** 时间戳 -> YYYY-MM-DD */
function dateKey(ts) {
  const d = new Date(ts)
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

/** 时间戳 -> M月D日 */
function monthDay(ts) {
  const d = new Date(ts)
  return (d.getMonth() + 1) + '月' + d.getDate() + '日'
}

/** 时间戳 -> 2026年10月 */
function monthLabel(ts) {
  const d = new Date(ts)
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月'
}

/** 日期分组标题：今天 / 昨天 / M月D日 周几 */
function dayLabel(ts) {
  const d = new Date(ts)
  const now = new Date()
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((t0 - dd) / 86400000)
  const week = '日一二三四五六'[d.getDay()]
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  if (diff === 2) return '前天'
  if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + week
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日'
}

/** 相对记录时间 */
function fromNow(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前'
  return monthDay(ts) + ' ' + formatTime(ts)
}

/** 当天 00:00 的时间戳 */
function startOfDay(ts) {
  const d = new Date(ts || Date.now())
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** 当月 1 日 00:00 */
function startOfMonth(ts) {
  const d = new Date(ts || Date.now())
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

/** 下月 1 日 00:00（报表区间右端，左闭右开） */
function startOfNextMonth(ts) {
  const d = new Date(ts || Date.now())
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
}

/** 周一为一周起点 */
function startOfWeek(ts) {
  const d = new Date(ts || Date.now())
  const day = (d.getDay() + 6) % 7
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).getTime()
}

/** 秒级时间戳 -> 本地时间戳（iOS 兼容：不接受 'YYYY-MM-DD HH:mm:ss'） */
function parseServerTime(v) {
  if (!v) return 0
  if (typeof v === 'number') return v
  const s = String(v)
  const normalized = s.indexOf('T') > 0 ? s : s.replace(' ', 'T')
  const t = new Date(normalized).getTime()
  return isFinite(t) ? t : 0
}

/** 依据字符串稳定取色 */
const AVATAR_COLORS = [
  '#6D5BF6', '#FF6B9D', '#FFA940', '#22C55E', '#3ABFF8',
  '#A855F7', '#FF5A5F', '#14B8A6'
]

function colorOf(seed, palette) {
  const arr = palette || AVATAR_COLORS
  const str = String(seed || '')
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) % 100000007
  }
  return arr[h % arr.length]
}

function initialOf(name) {
  const s = String(name || '').trim()
  if (!s) return '?'
  return s.slice(0, 1)
}

function toast(title, icon) {
  try {
    wx.showToast({ title: String(title || ''), icon: icon || 'none', duration: 1800 })
  } catch (e) {}
}

function haptic() {
  try { wx.vibrateShort({ type: 'light' }) } catch (e) {}
}

function confirm(title, content, confirmText) {
  return new Promise(function (resolve) {
    wx.showModal({
      title: title,
      content: content,
      confirmText: confirmText || '确定',
      confirmColor: '#FF5A5F',
      success: function (r) { resolve(!!r.confirm) },
      fail: function () { resolve(false) }
    })
  })
}

/** 分类 → 图标（emoji 不依赖字体图标库，未命中的分类用默认）
 *  想换风格只改这里即可，wxml 里统一用 {{}} 取值 */
const CATEGORY_ICONS = {
  '餐饮': '🍜', '住宿': '🏨', '出行': '🚇', '购物': '🛍️',
  '娱乐': '🎬', '医疗': '💊', '学习': '📚', '人情往来': '🎁',
  '工资': '💼', '奖金': '🏆', '理财收益': '📈', '其他收入': '💰', '其他支出': '📌'
}

function categoryIcon(name) {
  return CATEGORY_ICONS[String(name || '')] || '📝'
}

/** 本机时区相对 UTC 的偏移（分钟，东八区 = 480）。报表接口靠它把「天」切准。 */
function tzOffset() {
  // getTimezoneOffset 返回的是「UTC - 本地」分钟数，东八区得 -480，取反即可
  return -new Date().getTimezoneOffset()
}

module.exports = {
  AVATAR_COLORS,
  pad2,
  yuan,
  toCents,
  money,
  formatTime,
  dateKey,
  tzOffset,
  monthDay,
  monthLabel,
  dayLabel,
  fromNow,
  startOfDay,
  startOfMonth,
  startOfNextMonth,
  startOfWeek,
  parseServerTime,
  colorOf,
  initialOf,
  toast,
  haptic,
  confirm,
  categoryIcon
}
