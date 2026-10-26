/**
 * 工具注册表 —— 站点信息架构的唯一来源。
 *
 * 加新工具（比如 todolist）只需在这里加一项 + 在 App.tsx 配好子路由，
 * 侧边栏、工具切换器、移动端导航都会自动跟上。
 */
export const TOOLS = [
  {
    key: 'ledger',
    label: '记账',
    desc: '收支明细、图表与选项源',
    icon: HamsterIcon,
    ready: true,
    home: '/',
    children: [
      { to: '/', label: '明细', icon: ListIcon, end: true },
      { to: '/charts', label: '图表', icon: ChartIcon },
      { to: '/options', label: '选项源', icon: TagIcon }
    ]
  },
  {
    key: 'todo',
    label: '任务清单',
    desc: '今日任务、规划与打卡图表',
    icon: CheckIcon,
    ready: true,
    home: '/todo',
    children: [
      { to: '/todo', label: '今日任务', icon: CheckIcon, end: true },
      { to: '/todo/plan', label: '任务规划', icon: ListIcon },
      { to: '/todo/charts', label: '数据图表', icon: ChartIcon }
    ]
  },
  {
    key: 'more',
    label: '更多工具',
    desc: '还在仓鼠的储藏室里',
    icon: GridIcon,
    ready: false,
    home: '/more',
    children: []
  }
] as const

export type Tool = (typeof TOOLS)[number]

/* --------------------------- 图标（内联 SVG，避免引图标库） --------------------------- */

interface IconProps {
  size?: number
}

/** 统一线性图标的外壳，保证视觉重量一致 */
function Icon({ size = 18, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** 品牌吉祥物：简笔仓鼠头（圆脸 + 两只小耳朵） */
export function HamsterIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <circle cx="12" cy="13.5" r="7" />
      <path d="M5.5 9.5C4 8.5 3.5 6.5 4.5 5c1.8.2 3 1.4 3.5 2.8M18.5 9.5c1.5-1 2-3 1-4.5-1.8.2-3 1.4-3.5 2.8" />
      <circle cx="9.5" cy="12.5" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="12.5" r="0.6" fill="currentColor" stroke="none" />
      <path d="M10.5 15.5c.5.6 2.5.6 3 0" />
    </Icon>
  )
}

export function ListIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="3.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function ChartIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </Icon>
  )
}

export function TagIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h9l7.6 7.6a2 2 0 0 1 0 2.8Z" />
      <circle cx="7.5" cy="7.5" r="1.3" />
    </Icon>
  )
}

export function CheckIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <rect x="3" y="4" width="18" height="17" rx="3" />
      <path d="m8 12.5 2.5 2.5L16 9.5" />
    </Icon>
  )
}

export function GridIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
    </Icon>
  )
}

export function LogoutIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </svg>
  )
}

export function MenuIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}
