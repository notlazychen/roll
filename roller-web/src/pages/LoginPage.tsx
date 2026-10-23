import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { useAuth } from '../lib/auth'
import { authApi } from '../lib/api'
import { ApiError } from '../lib/http'
import styles from './LoginPage.module.css'

type Tab = 'login' | 'register'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** 扫码登录面板的状态机：待生成 → 展示配对码等小程序批准 → 完成/失败 */
type WxState =
  | { phase: 'idle' }
  | { phase: 'ready'; ticket: string; qrDataUrl: string; expiresAt: number }
  | { phase: 'done' }
  | { phase: 'error'; message: string }

export default function LoginPage() {
  const { login, register, completeWxLogin } = useAuth()
  const [tab, setTab] = useState<Tab>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nickName, setNickName] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [emailInvalid, setEmailInvalid] = useState(false)
  const [codeSending, setCodeSending] = useState(false)
  const [codeCooldown, setCodeCooldown] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [wx, setWx] = useState<WxState>({ phase: 'idle' })
  const pollRef = useRef<number | null>(null)
  const codeTimerRef = useRef<number | null>(null)

  // 离开页面/切换状态时停掉轮询与倒计时
  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearTimeout(pollRef.current)
      if (codeTimerRef.current) window.clearInterval(codeTimerRef.current)
    }
  }, [])

  const isRegister = tab === 'register'

  function switchTab(next: Tab) {
    if (busy) return
    setTab(next)
    setError(null)
    setEmailInvalid(false)
  }

  /** 发送注册验证码：先校验邮箱格式，再请求后端发信 */
  async function sendRegisterCode() {
    if (codeSending || codeCooldown > 0) return
    setError(null)

    const mail = email.trim()
    if (!EMAIL_RE.test(mail)) {
      setEmailInvalid(true)
      setError('请输入正确的邮箱地址')
      return
    }

    setCodeSending(true)
    try {
      const res = await authApi.sendEmailCode(mail, 'register')
      setCodeCooldown(60)
      codeTimerRef.current = window.setInterval(() => {
        setCodeCooldown((c) => {
          if (c <= 1) {
            if (codeTimerRef.current) window.clearInterval(codeTimerRef.current)
            return 0
          }
          return c - 1
        })
      }, 1000)

      if (res.debugCode) {
        // 开发环境邮件服务未配置，验证码直接展示出来方便联调
        setError(`开发模式验证码：${res.debugCode}`)
      } else {
        setError(null)
        alert('验证码已发送，请查收邮件')
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '发送失败，请稍后再试')
    } finally {
      setCodeSending(false)
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)
    setBusy(true)

    try {
      if (isRegister) {
        if (!emailCode.trim()) {
          setError('请输入邮箱验证码')
          setBusy(false)
          return
        }
        await register(email.trim(), password, emailCode.trim(), nickName.trim() || undefined)
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

  /* ------------------------- 微信扫码登录 ------------------------- */

  function stopPolling() {
    if (pollRef.current) {
      window.clearTimeout(pollRef.current)
      pollRef.current = null
    }
  }

  async function startWxLogin() {
    setError(null)
    stopPolling()
    try {
      const res = await authApi.createWebQr()
      const qrDataUrl = await QRCode.toDataURL(res.ticket, {
        margin: 1,
        width: 168,
        color: { dark: '#173f33', light: '#ffffff' }
      })
      setWx({ phase: 'ready', ticket: res.ticket, qrDataUrl, expiresAt: Date.now() + res.expiresInMs })
      poll(res.ticket)
    } catch (err) {
      setWx({
        phase: 'error',
        message: err instanceof ApiError ? err.message : '生成配对码失败，请稍后再试'
      })
    }
  }

  function poll(ticket: string) {
    pollRef.current = window.setTimeout(async () => {
      try {
        const res = await authApi.pollWebQr(ticket)
        if (res.status === 'approved' && res.token && res.user) {
          completeWxLogin(res.token, res.user)
          setWx({ phase: 'done' })
          return // 登录成功，路由守卫会跳走
        }
        if (res.status === 'expired' || res.status === 'consumed') {
          setWx({ phase: 'error', message: '配对码已失效，请重新生成' })
          return
        }
        poll(ticket)
      } catch {
        // 网络抖动：继续轮询，别让一次失败打断流程
        poll(ticket)
      }
    }, 2000)
  }

  function closeWxPanel() {
    stopPolling()
    setWx({ phase: 'idle' })
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
        {(wx.phase === 'ready' || wx.phase === 'error') && (
          <div className={styles.card}>
            <div>
              <h2 className={styles.title}>微信扫码登录</h2>
              <p className={styles.subtitle}>
                打开「哈姆斯特」小程序 → 我的 → 扫一扫登录网页
              </p>
            </div>

            {wx.phase === 'ready' && (
              <div className={styles.wxBox}>
                <img className={styles.wxQr} src={wx.qrDataUrl} alt="配对码二维码" />
                <div className={styles.wxCode}>
                  {wx.ticket.slice(0, 4)}<em>–</em>{wx.ticket.slice(4)}
                </div>
                <p className={styles.wxHint}>
                  也可以在小程序里手动输入这串配对码。码 5 分钟内有效，批准后本页会自动登录。
                </p>
              </div>
            )}

            {wx.phase === 'error' && <div className="alert alert-error">{wx.message}</div>}

            <div className={styles.wxActions}>
              {wx.phase === 'error' && (
                <button type="button" className="btn" onClick={startWxLogin}>
                  重新生成配对码
                </button>
              )}
              <button type="button" className={`btn ${styles.submit}`} onClick={closeWxPanel}>
                返回邮箱登录
              </button>
            </div>
          </div>
        )}

        {!(wx.phase === 'ready' || wx.phase === 'error') && (
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
            {isRegister ? (
              <>
                <div className={styles.field}>
                  <span>邮箱</span>
                  <div className={styles.emailRow}>
                    <input
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value)
                        setEmailInvalid(false)
                      }}
                      required
                    />
                    <button
                      type="button"
                      className={`btn btn-ghost ${styles.sendBtn} ${codeSending || codeCooldown > 0 ? styles.sendBtnDisabled : ''}`}
                      onClick={sendRegisterCode}
                      disabled={codeSending || codeCooldown > 0}
                    >
                      {codeSending
                        ? '发送中…'
                        : codeCooldown > 0
                          ? `${codeCooldown}s 后重发`
                          : '发送验证码'}
                    </button>
                  </div>
                  {emailInvalid && <p className={styles.errorText}>请输入正确的邮箱地址</p>}
                </div>

                <label className={styles.field}>
                  <span>验证码</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="6 位邮箱验证码"
                    value={emailCode}
                    onChange={(e) => setEmailCode(e.target.value)}
                    required
                  />
                </label>
              </>
            ) : (
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
            )}

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

          <div className={styles.divider}><span>或</span></div>
          <button
            type="button"
            className={`btn ${styles.wxBtn}`}
            onClick={startWxLogin}
            disabled={busy}
          >
            💬 微信扫码登录
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
        )}
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
