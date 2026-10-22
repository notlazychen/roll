import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import { AUTH_EXPIRED_EVENT, clearToken, getToken, setToken } from '../lib/http'
import { authApi } from '../lib/api'
import type { User } from '../types'

interface AuthState {
  user: User | null
  /** 首次进来要拿 /api/me 校验本地 token，这段期间先别渲染业务页 */
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, nickName?: string) => Promise<void>
  logout: () => void
  /** 改完昵称等资料后同步到全局 */
  patchUser: (patch: Partial<User>) => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // 启动时用本地 token 换一次用户信息：token 过期/被改就自动登出
  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      if (!getToken()) {
        setLoading(false)
        return
      }
      try {
        const res = await authApi.me()
        if (!cancelled) setUser(res.user)
      } catch {
        // 401 已经由 http 层清了 token 并广播，这里只需保证不卡在 loading
        if (!cancelled) setUser(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  // 任何接口返回 401，都视为登录态失效
  useEffect(() => {
    const onExpired = () => setUser(null)
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password)
    setToken(res.token)
    setUser(res.user)
  }, [])

  const register = useCallback(async (email: string, password: string, nickName?: string) => {
    // 注册接口直接签发 token，不用再走一次登录
    const res = await authApi.register(email, password, nickName)
    setToken(res.token)
    setUser(res.user)
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
  }, [])

  const patchUser = useCallback((patch: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, register, logout, patchUser }),
    [user, loading, login, register, logout, patchUser]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用')
  return ctx
}
