import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { ApiError } from '../lib/http'
import styles from './LoginPage.module.css'

type Tab = 'login' | 'register'

export default function LoginPage() {
  const { login, register } = useAuth()
  const [tab, setTab] = useState<Tab>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nickName, setNickName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isRegister = tab === 'register'

  function switchTab(next: Tab) {
    if (busy) return
    setTab(next)
    setError(null)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)
    setBusy(true)

    try {
      if (isRegister) {
        await register(email.trim(), password, nickName.trim() || undefined)
      } else {
        await login(email.trim(), password)
      }
      // 成功后由路由守卫自动跳到明细页
    } catch (err) {
      // 后端的文案已经很具体（「密码至少 8 位」「邮箱或密码不正确」），直接展示
      setError(err instanceof ApiError ? err.message : '出了点问题，请稍后再试')
      setBusy(false)
    }
  }

  return (
    <div className={styles.page}>
      {/* 左：品牌区，深绿渐变（设计稿 2:2） */}
      <aside className={styles.brand}>
        <div className={styles.logoRow}>
          <div className={styles.logoMark}>
            <HamsterMark />
          </div>
          <div className={styles.logoTextCol}>
            <span className={styles.logoText}>哈姆斯特</span>
            <span className={styles.logoSub}>仓鼠之家 · 贴身小工具集</span>
          </div>
        </div>

        <div className={styles.slogan}>
          <h1>
            像仓鼠一样，
            <br />
            把日子过明白
          </h1>
          <p>
            一个账号，网页与小程序同步使用。记账已经上线，待办清单和更多小工具正在路上——工具会一件件多起来。
          </p>
          <div className={styles.chips}>
            <span className={`${styles.chip} ${styles.chipOn}`}>🐹 记账</span>
            <span className={styles.chip}>待办清单 · 即将上线</span>
          </div>
        </div>

        <div className={styles.copyright}>© 2026 哈姆斯特 · 仓鼠之家</div>
      </aside>

      {/* 右：表单区 */}
      <main className={styles.formArea}>
        <form className={styles.card} onSubmit={onSubmit}>
          <div>
            <h2 className={styles.title}>{isRegister ? '创建账号' : '欢迎回来'}</h2>
            <p className={styles.subtitle}>
              {isRegister ? '注册后即可在网页和小程序上记账' : '登录你的账号，继续记账'}
            </p>
          </div>

          <div className={styles.tabs} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={!isRegister}
              className={`${styles.tab} ${!isRegister ? styles.tabActive : ''}`}
              onClick={() => switchTab('login')}
            >
              登录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isRegister}
              className={`${styles.tab} ${isRegister ? styles.tabActive : ''}`}
              onClick={() => switchTab('register')}
            >
              注册
            </button>
          </div>

          <div className={styles.fields}>
            <label className={styles.field}>
              <span>邮箱</span>
              <input
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>

            <label className={styles.field}>
              <span>密码</span>
              <input
                type="password"
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                placeholder={isRegister ? '至少 8 位，含字母和数字' : '请输入密码'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>

            {isRegister && (
              <label className={styles.field}>
                <span>
                  昵称 <em>选填</em>
                </span>
                <input
                  type="text"
                  autoComplete="nickname"
                  placeholder="不填就用邮箱前缀"
                  value={nickName}
                  onChange={(e) => setNickName(e.target.value)}
                  maxLength={16}
                />
              </label>
            )}
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <button type="submit" className={`btn ${styles.submit}`} disabled={busy}>
            {busy ? '处理中…' : isRegister ? '注 册' : '登 录'}
          </button>

          <p className={styles.foot}>
            {isRegister ? (
              <>
                已经有账号了？{' '}
                <button type="button" className={styles.link} onClick={() => switchTab('login')}>
                  去登录
                </button>
              </>
            ) : (
              <>
                还没有账号？{' '}
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => switchTab('register')}
                >
                  立即注册
                </button>
              </>
            )}
          </p>
        </form>
      </main>
    </div>
  )
}

/** 品牌区的小仓鼠：白色线稿，和深绿渐变底搭配 */
function HamsterMark() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="13.5" r="7" />
      <path d="M5.5 9.5C4 8.5 3.5 6.5 4.5 5c1.8.2 3 1.4 3.5 2.8M18.5 9.5c1.5-1 2-3 1-4.5-1.8.2-3 1.4-3.5 2.8" />
      <circle cx="9.5" cy="12.5" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="12.5" r="0.6" fill="currentColor" stroke="none" />
      <path d="M10.5 15.5c.5.6 2.5.6 3 0" />
    </svg>
  )
}
