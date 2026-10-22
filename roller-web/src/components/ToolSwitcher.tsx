import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './ToolSwitcher.module.css'

export interface ToolDef {
  key: string
  label: string
  desc: string
  icon: (p: { size?: number }) => React.ReactElement
  ready: boolean
  /** 已上线工具进入后落在哪个路由 */
  home: string
}

interface Props {
  tools: readonly ToolDef[]
  current: ToolDef
  /** 移动端点工具后收起抽屉 */
  onNavigate?: () => void
}

/**
 * 左侧主标题区的「工具名 + 切换按钮」。
 *
 * 交互：点右侧那个上下叠放的左右半箭头 → 展开工具列表 → 点某个工具名切换。
 * 未上线的工具也列出来但不可点，明确告诉用户后面有什么。
 */
export default function ToolSwitcher({ tools, current, onNavigate }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  // 点外面 / 按 Esc 收起
  useEffect(() => {
    if (!open) return

    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function pick(tool: ToolDef) {
    if (!tool.ready) return
    setOpen(false)
    onNavigate?.()
    navigate(tool.home)
  }

  const Icon = current.icon

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <div className={styles.head}>
        <div className={styles.current}>
          <span className={styles.mark}>
            <Icon size={20} />
          </span>
          <span className={styles.name}>{current.label}</span>
        </div>

        <button
          type="button"
          className={`${styles.toggle} ${open ? styles.toggleOpen : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label="切换工具"
          title="切换工具"
        >
          <SwapIcon />
        </button>
      </div>

      {open && (
        <ul className={styles.menu} role="listbox">
          <li className={styles.menuLabel}>切换工具</li>
          {tools.map((tool) => {
            const ItemIcon = tool.icon
            const isCurrent = tool.key === current.key
            return (
              <li key={tool.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  disabled={!tool.ready}
                  className={`${styles.item} ${isCurrent ? styles.itemOn : ''}`}
                  onClick={() => pick(tool)}
                >
                  <span className={styles.itemIcon}>
                    <ItemIcon size={17} />
                  </span>
                  <span className={styles.itemText}>
                    <span className={styles.itemName}>
                      {tool.label}
                      {!tool.ready && <i className={styles.soon}>即将上线</i>}
                      {isCurrent && <i className={styles.now}>当前</i>}
                    </span>
                    <span className={styles.itemDesc}>{tool.desc}</span>
                  </span>
                  {isCurrent && <span className={styles.check}>✓</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** 上下叠放的左右半箭头：一个朝左一个朝右，表达「可切换」 */
function SwapIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14.5 8.5 11 5 14.5 1.5" />
      <path d="M11 5h7" />
      <path d="M9.5 15.5 13 19l-3.5 3.5" />
      <path d="M13 19H6" />
    </svg>
  )
}
