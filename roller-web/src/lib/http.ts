/**
 * 唯一的网络出口。
 *
 * 约定三条，和背后那套 .NET 服务对齐：
 *   1. 路径一律写相对路径 /api/xxx —— 线上由 nginx 反代，本地由 vite 代理，
 *      前端代码里没有任何环境判断，也不存在硬编码域名。
 *   2. 失败一律抛出 ApiError（带 status 与后端给的 error 文案），
 *      调用方只关心「成功拿到数据」或「catch 后展示 message」。
 *   3. 401 自动清 token 并广播，交给路由守卫统一跳登录页。
 */

const TOKEN_KEY = 'ledger.token'

/** 后端 { ok:false, error } 的统一异常 */
export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/* --------------------------- token 存取 --------------------------- */

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* 隐私模式下写不进去就算了，本次会话内仍可用 */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

/** 登录态失效事件：AuthProvider 监听后清空用户并切到登录页 */
export const AUTH_EXPIRED_EVENT = 'ledger:auth-expired'

function notifyExpired(): void {
  clearToken()
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
}

/* --------------------------- 请求核心 --------------------------- */

/** 查询参数值；EntryQuery 这类具名对象类型也能直接传进来 */
export type QueryValue = string | number | boolean | undefined | null
export type QueryParams = Record<string, QueryValue>

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  /** 查询参数，值为 undefined / null / '' 的会被丢掉 */
  query?: QueryParams
  /** 这个请求不需要登录态（登录、注册用） */
  anonymous?: boolean
}

function buildUrl(path: string, query?: QueryParams): string {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue
    params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, anonymous } = options

  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  if (!anonymous) {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  let res: Response
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch {
    // 网络层失败（断网、服务没起来、证书问题），给一句人话
    throw new ApiError('无法连接服务器，请检查网络后重试', 0)
  }

  // 204 之类没有响应体
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (res.status === 401) {
    // 未登录/过期：除了登录接口本身，都视为会话失效
    if (!anonymous) notifyExpired()
    throw new ApiError(extractError(data) ?? '登录状态已失效，请重新登录', 401)
  }

  if (!res.ok) {
    throw new ApiError(extractError(data) ?? `请求失败（${res.status}）`, res.status)
  }

  return data as T
}

function extractError(data: unknown): string | null {
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (typeof obj.error === 'string' && obj.error) return obj.error
    // ASP.NET 默认的 ProblemDetails
    if (typeof obj.title === 'string' && obj.title) return obj.title
  }
  return null
}

export const http = {
  get: <T>(path: string, query?: QueryParams, anonymous = false) =>
    request<T>(path, { query, anonymous }),
  post: <T>(path: string, body?: unknown, anonymous = false) =>
    request<T>(path, { method: 'POST', body, anonymous }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' })
}
