import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../lib/api'
import { useAuth } from '../lib/auth'
import { ApiError } from '../lib/http'
import styles from './AccountPage.module.css'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * 账号管理：与小程序「我的 → 账号」保持一致。
 *   - 绑定微信：已绑定可解绑（网页端无微信授权能力，登录态鉴权后直接解绑）；
 *     未绑定时引导去小程序绑定。
 *   - 绑定邮箱：未绑定输入邮箱 → 发送验证码 → 输入验证码完成绑定；
 *     已绑定显示邮箱 + 解绑入口，解绑也走验证码确认（发到当前绑定邮箱）。
 */
export default function AccountPage() {
  const { user, patchUser } = useAuth()
  const navigate = useNavigate()

  /* ------------------------- 解绑微信 ------------------------- */

  const [wxBusy, setWxBusy] = useState(false)

  async function unbindWeChat() {
    if (wxBusy) return
    const ok = window.confirm(
      '解绑后这个微信将无法直接登录该账号，可改用邮箱登录。确定解绑？'
    )
    if (!ok) return

    setWxBusy(true)
    try {
      const res = await authApi.unbindWeChat()
      patchUser(res.user)
      alert('已解绑微信')
    } catch (err) {
      alert(err instanceof ApiError ? err.message : '解绑失败，请稍后再试')
    } finally {
      setWxBusy(false)
    }
  }

  /* ------------------------- 绑定 / 解绑邮箱 ------------------------- */

  const [emailForm, setEmailForm] = useState<'none' | 'bind' | 'unbind'>('none')

  function closeForm() {
    setEmailForm('none')
  }

  if (!user) return null

  return (
    <div className={styles.page}>
      <button type="button" className={styles.back} onClick={() => navigate(-1)}>
        ‹ 返回
      </button>
      <h2 className={styles.title}>账号</h2>

      <div className={`card ${styles.panel}`}>
        <div className={styles.row}>
          <div className={styles.rowInfo}>
            <div className={styles.rowName}>{user.nickName}</div>
            <div className={styles.rowSub}>
              {user.email ?? '未绑定邮箱'}
              {user.weChatBound ? ' · 已绑定微信' : ' · 未绑定微信'}
            </div>
          </div>
        </div>

        {/* ---------------- 绑定微信 ---------------- */}
        <div className={styles.row}>
          <div className={styles.rowInfo}>
            <div className={styles.rowName}>绑定微信</div>
            <div className={styles.rowSub}>
              {user.weChatBound
                ? '已绑定 · 解绑后可改用邮箱登录本账号'
                : '在小程序「我的 → 账号 → 绑定微信」完成绑定，之后即可用微信一键登录'}
            </div>
          </div>
          {user.weChatBound && (
            <button type="button" className="btn btn-danger" onClick={unbindWeChat} disabled={wxBusy}>
              {wxBusy ? '解绑中…' : '解绑'}
            </button>
          )}
        </div>

        {/* ---------------- 绑定邮箱 ---------------- */}
        <div className={styles.row}>
          <div className={styles.rowInfo}>
            <div className={styles.rowName}>绑定邮箱</div>
            <div className={styles.rowSub}>
              {user.email ?? '验证邮箱后即可用邮箱在网页和小程序登录同一账号'}
            </div>
          </div>
          {user.email ? (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setEmailForm(emailForm === 'unbind' ? 'none' : 'unbind')}
            >
              解绑
            </button>
          ) : (
            <button
              type="button"
              className={`btn btn-ghost ${styles.sendBtn}`}
              onClick={() => setEmailForm(emailForm === 'bind' ? 'none' : 'bind')}
            >
              {emailForm === 'bind' ? '收起' : '绑定'}
            </button>
          )}
        </div>

        {emailForm !== 'none' && (
          <EmailCodeForm
            mode={emailForm}
            boundEmail={user.email ?? ''}
            onDone={(u) => {
              patchUser(u)
              closeForm()
            }}
            onCancel={closeForm}
          />
        )}
      </div>
    </div>
  )
}

/* --------------------------- 邮箱验证码表单 --------------------------- */

function EmailCodeForm({
  mode,
  boundEmail,
  onDone,
  onCancel
}: {
  mode: 'bind' | 'unbind'
  /** 解绑时 = 当前绑定邮箱；绑定时忽略 */
  boundEmail: string
  onDone: (user: import('../types').User) => void
  onCancel: () => void
}) {
  const [email, setEmail] = useState(mode === 'unbind' ? boundEmail : '')
  const [emailInvalid, setEmailInvalid] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [busy, setBusy] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [])

  function startCooldown() {
    setCooldown(60)
    timerRef.current = window.setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          if (timerRef.current) window.clearInterval(timerRef.current)
          return 0
        }
        return c - 1
      })
    }, 1000)
  }

  async function sendCode() {
    if (sending || cooldown > 0) return
    setError(null)
    if (!EMAIL_RE.test(email.trim())) {
      setEmailInvalid(true)
      setError('请输入正确的邮箱地址')
      return
    }

    setSending(true)
    try {
      const res = await authApi.sendEmailCode(email.trim(), mode === 'bind' ? 'bind' : 'unbind')
      startCooldown()
      if (res.debugCode) {
        // 开发环境邮件服务未配置，验证码直接展示
        setError(`开发模式验证码：${res.debugCode}`)
      } else {
        setError(null)
        alert('验证码已发送，请查收邮件')
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '发送失败，请稍后再试')
    } finally {
      setSending(false)
    }
  }

  async function submit() {
    if (busy) return
    if (!code.trim()) {
      setError('请输入验证码')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const res =
        mode === 'bind'
          ? await authApi.bindEmail(email.trim(), code.trim())
          : await authApi.unbindEmail(code.trim())
      onDone(res.user)
      alert(mode === 'bind' ? '邮箱已绑定' : '邮箱已解绑')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '操作失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.form}>
      {mode === 'bind' ? (
        <>
          <p className={styles.formHint}>
            验证通过后，就可以在网页版和小程序用这个邮箱登录同一账号，账目完全同步。
          </p>
          <div className={styles.fieldRow}>
            <input
              type="email"
              className={`${styles.input} ${emailInvalid ? styles.inputInvalid : ''}`}
              placeholder="邮箱地址"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                setEmailInvalid(false)
                setError(null)
              }}
            />
            <button
              type="button"
              className={`btn btn-ghost ${styles.sendBtn} ${sending || cooldown > 0 ? styles.sendBtnDisabled : ''}`}
              onClick={sendCode}
              disabled={sending || cooldown > 0}
            >
              {sending ? '发送中…' : cooldown > 0 ? `${cooldown}s 后重发` : '发送验证码'}
            </button>
          </div>
          {emailInvalid && <p className={styles.errorText}>请输入正确的邮箱地址</p>}
        </>
      ) : (
        <p className={styles.formHint}>
          为了确认是本人操作，验证码将发送到当前绑定的邮箱 {boundEmail}。
        </p>
      )}

      <div className={styles.fieldRow}>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          className={styles.input}
          placeholder="6 位邮箱验证码"
          value={code}
          onChange={(e) => {
            setCode(e.target.value)
            setError(null)
          }}
        />
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className={styles.fieldRow}>
        <button type="button" className="btn" onClick={submit} disabled={busy} style={{ flex: 1 }}>
          {busy ? '处理中…' : mode === 'bind' ? '确认绑定' : '确认解绑'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  )
}
