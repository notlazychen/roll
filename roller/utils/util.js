/**
 * 通用工具方法
 */

// 转盘配色（10 色循环）
const WHEEL_COLORS = [
  '#6D5BF6', '#FF6B9D', '#FFA940', '#22C55E', '#3ABFF8',
  '#A855F7', '#FF5A5F', '#14B8A6', '#F59E0B', '#6366F1'
]

// 头像底色
const AVATAR_COLORS = [
  '#6D5BF6', '#FF6B9D', '#FFA940', '#22C55E', '#3ABFF8',
  '#A855F7', '#FF5A5F', '#14B8A6'
]

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

/** 时间戳 -> HH:mm */
function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

/** 时间戳 -> 相对时间 */
function fromNow(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前'
  const d = new Date(ts)
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + formatTime(ts)
}

/** 毫秒 -> mm:ss */
function countdownText(ms) {
  if (ms <= 0) return '00:00'
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return pad2(m) + ':' + pad2(s)
}

/** 依据字符串稳定取色 */
function colorOf(seed, palette) {
  const arr = palette || AVATAR_COLORS
  const str = String(seed || '')
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) % 100000007
  }
  return arr[h % arr.length]
}

/** 取名称首字作为头像文字 */
function initialOf(name) {
  const s = String(name || '').trim()
  if (!s) return '?'
  return s.slice(0, 1)
}

/** 轻提示（吞掉 API 不存在的异常） */
function toast(title, icon) {
  try {
    wx.showToast({ title: String(title || ''), icon: icon || 'none', duration: 1800 })
  } catch (e) {}
}

function haptic() {
  try {
    wx.vibrateShort({ type: 'light' })
  } catch (e) {}
}

module.exports = {
  WHEEL_COLORS,
  AVATAR_COLORS,
  formatTime,
  fromNow,
  countdownText,
  colorOf,
  initialOf,
  toast,
  haptic
}
