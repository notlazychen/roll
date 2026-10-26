import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import ToolSwitcher from './ToolSwitcher'
import { TOOLS, LogoutIcon, MenuIcon } from './tools'

/**
 * 工具集的站点骨架。
 *
 * 桌面端：左侧常驻侧边栏（工具名 + 切换器 + 当前工具的子页面）。
 * 移动端：侧边栏收进抽屉，左上角汉堡打开；切换工具后自动收起。
 */
export default function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [drawerOpen, setDrawerOpen] = useState(false)

  // 换页面就收起抽屉（移动端点完子项应该直接看到内容）
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  // 抽屉打开时锁住背景滚动
  useEffect(() => {
    if (!drawerOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [drawerOpen])

  function onLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  const initial = user?.nickName?.trim().charAt(0) || '哈'

  // 当前工具：按子路由匹配，匹配不上就默认第一个（记账）
  const currentTool =
    TOOLS.find((t) =>
      t.children.some((c) =>
        'end' in c && c.end ? location.pathname === c.to : location.pathname.startsWith(c.to)
      )
    ) ?? TOOLS[0]

  return (
    <div className="app-shell">
      {/* 移动端抽屉遮罩 */}
      {drawerOpen && (
        <div className="drawer-mask" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      )}

      <aside className={`sidebar ${drawerOpen ? 'is-open' : ''}`}>
        {/* 左上角主标题就是「工具名 + 切换按钮」；移动端靠点遮罩收起抽屉 */}
        <div className="sidebar-head">
          <ToolSwitcher
            tools={TOOLS}
            current={currentTool}
            onNavigate={() => setDrawerOpen(false)}
          />
        </div>

        <nav className="nav-group">
          <div className="nav-label">当前工具</div>
          {currentTool.children.map((child) => (
            <NavLink
              key={child.to}
              to={child.to}
              end={'end' in child ? child.end : false}
              className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}
            >
              <child.icon />
              {child.label}
            </NavLink>
          ))}

          {currentTool.children.length === 0 && (
            <p className="nav-empty">这个工具还在打造中，敬请期待。</p>
          )}
        </nav>

        <div className="sidebar-spacer" />

        {/* 站点标识（弱化，只在侧边栏底部作为落款） */}
        <div className="sidebar-foot">哈姆斯特 · 仓鼠之家</div>

        {/* 用户卡：点击进入账号管理（绑定微信/邮箱、退出登录在页内） */}
        <div
          className="user-card is-clickable"
          role="button"
          tabIndex={0}
          onClick={() => navigate('/account')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') navigate('/account')
          }}
        >
          {user?.avatarUrl ? (
            <img className="avatar" src={user.avatarUrl} alt="" />
          ) : (
            <div className="avatar">{initial}</div>
          )}
          <div className="user-info">
            <div className="user-name">{user?.nickName}</div>
            <div className="user-sub">
              {user?.email ?? (user?.weChatBound ? '微信账号' : '本地账号')}
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={(e) => {
              e.stopPropagation()
              onLogout()
            }}
            title="退出登录"
            aria-label="退出登录"
          >
            <LogoutIcon />
          </button>
        </div>
      </aside>

      <div className="main">
        {/* 移动端顶部条：只有小屏出现，提供抽屉入口 */}
        <div className="mobile-bar">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setDrawerOpen(true)}
            aria-label="打开菜单"
          >
            <MenuIcon />
          </button>
          <span className="mobile-tool">{currentTool.label}</span>
          <span className="mobile-brand">哈姆斯特</span>
        </div>

        <Outlet />
      </div>
    </div>
  )
}
