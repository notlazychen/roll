import { http } from './http'
import type { QueryParams } from './http'
import type {
  AuthResponse,
  Entry,
  EntryPage,
  EntryType,
  MeResponse,
  Options,
  Overview,
  Report,
  User
} from '../types'

/* --------------------------- 认证 --------------------------- */

export const authApi = {
  register: (email: string, password: string, code: string, nickName?: string) =>
    http.post<AuthResponse>('/api/auth/register', { email, password, code, nickName }, true),

  login: (email: string, password: string) =>
    http.post<AuthResponse>('/api/auth/login', { email, password }, true),

  /** 修改/设置密码（需要登录态） */
  changePassword: (newPassword: string, oldPassword?: string) =>
    http.post<{ ok: boolean; token: string }>('/api/auth/password', {
      newPassword,
      oldPassword: oldPassword ?? null
    }),

  /** 发送邮箱验证码。purpose: register（注册）/ bind（绑定邮箱）/ unbind（解绑邮箱） */
  sendEmailCode: (email: string, purpose: 'register' | 'bind' | 'unbind') =>
    http.post<{
      ok: boolean
      sent: boolean
      /** 开发环境邮件服务未配置时，验证码直接返回（仅 Development） */
      debugCode?: string
      hint?: string
    }>('/api/auth/email-code', { email, purpose }, true),

  /** 绑定邮箱：验证码发到新邮箱，验证通过后落库 */
  bindEmail: (email: string, code: string) =>
    http.post<{ ok: boolean; user: User }>('/api/auth/bind-email', { email, code }),

  /** 解绑邮箱：验证码发到当前绑定的邮箱 */
  unbindEmail: (code: string) =>
    http.post<{ ok: boolean; user: User }>('/api/auth/unbind-email', { code }),

  /** 解绑微信：网页端没有微信授权能力，登录态鉴权后直接解绑 */
  unbindWeChat: () =>
    http.post<{ ok: boolean; user: User }>('/api/auth/unbind-wechat', { code: null }),

  me: () => http.get<MeResponse>('/api/me'),

  updateProfile: (patch: Partial<Pick<User, 'nickName' | 'avatarUrl' | 'tagAutoEnabled'>>) =>
    http.put<{ ok: boolean; user: User }>('/api/me', patch),

  /* ------- 微信扫码登录（跨端配对，见后端 WebQrLoginEndpoints） ------- */

  /** 生成 8 位配对码，5 分钟内有效 */
  createWebQr: () =>
    http.post<{ ok: boolean; ticket: string; expiresInMs: number }>('/api/auth/web-qr', null, true),

  /** 轮询配对状态：pending / approved（带 token，只发一次）/ expired / consumed */
  pollWebQr: (ticket: string) =>
    http.get<{
      ok: boolean
      status: 'pending' | 'approved' | 'expired' | 'consumed'
      token?: string
      user?: User
    }>(`/api/auth/web-qr/${encodeURIComponent(ticket)}`, undefined, true)
}

/* --------------------------- 账目 --------------------------- */

export interface EntryQuery {
  type?: EntryType
  category?: string
  /** 起止时间，毫秒；to 是不含的右边界 */
  from?: number
  to?: number
  keyword?: string
  cursor?: string
  limit?: number
}

export const entryApi = {
  // EntryQuery 显式转成 QueryParams：具名接口没有隐式索引签名
  list: (query: EntryQuery = {}) => http.get<EntryPage>('/api/entries', query as QueryParams),

  get: (id: number) => http.get<Entry>(`/api/entries/${id}`),

  create: (body: Omit<Entry, 'id' | 'createdAt'>) =>
    http.post<{ ok: boolean; entry: Entry }>('/api/entries', body),

  update: (id: number, body: Omit<Entry, 'id' | 'createdAt'>) =>
    http.put<{ ok: boolean; entry: Entry }>(`/api/entries/${id}`, body),

  remove: (id: number) => http.del<{ ok: boolean }>(`/api/entries/${id}`),

  /** 根据备注试算自动标签，用于「记一笔」里的即时提示 */
  previewTags: (remark: string) =>
    http.post<{ ok: boolean; tags: string[] }>('/api/entries/tags/preview', { remark }),

  overview: () => http.get<Overview>('/api/stats/overview')
}

/* --------------------------- 选项源 --------------------------- */

export const optionApi = {
  /** 响应结构 { ok, options: {...} }，与小程序端一致 */
  all: () => http.get<{ ok: boolean; options: Options }>('/api/options').then((r) => r.options),

  add: (kind: string, name: string, parent?: string | null) =>
    http.post<{ ok: boolean }>('/api/options', { kind, name, parent: parent ?? null }),

  update: (id: number, name: string) => http.put<{ ok: boolean }>(`/api/options/${id}`, { name }),

  remove: (id: number) => http.del<{ ok: boolean }>(`/api/options/${id}`)
}

/* --------------------------- 报表 --------------------------- */

export const reportApi = {
  /** from/to 为毫秒；tz 传「客户端与 UTC 的分钟偏移」（getTimezoneOffset 的原值，东八区是 -480） */
  get: (from?: number, to?: number) =>
    http.get<Report>('/api/reports', {
      from,
      to,
      tz: tzOff()
    })
}

/* --------------------------- 任务清单 --------------------------- */

/** 与后端报表一致的时区约定：东八区 = 480（本地 = UTC + tz 分钟） */
function tzOff(): number {
  return -new Date().getTimezoneOffset()
}

export type TodoType = 'once' | 'recurring'

export interface TodoTask {
  id: number
  title: string
  type: TodoType
  /** yyyy-MM-dd；一次性任务才有 */
  dueDate: string | null
  /** 1=周一 … 7=周日；周期性任务才有 */
  weekDays: number[] | null
  startDate: string | null
  archived: boolean
  createdAt: number
  checkinCount: number
  lastCheckIn: string | null
}

export interface TodoTodayItem {
  id: number
  title: string
  type: TodoType
  dueDate: string | null
  weekDays: number[] | null
  checkedIn: boolean
  done: boolean
  overdue: boolean
  times: number
}

export interface TodoToday {
  date: string
  total: number
  done: number
  tasks: TodoTodayItem[]
}

export interface TodoStats {
  totalCheckins: number
  recurringCount: number
  pendingOnceCount: number
  daily: { day: string; count: number }[]
  ranking: { id: number; title: string; type: TodoType; count: number }[]
}

export interface TodoSavePayload {
  title: string
  type: TodoType
  /** 一次性任务目标日 yyyy-MM-dd */
  dueDate?: string
  /** 周期重复日（1=周一…7=周日） */
  weekDays?: number[]
  startDate?: string
  /** 与后端报表一致：东八区 = 480 */
  tz?: number
}

export const todoApi = {
  list: () => http.get<{ ok: boolean; tasks: TodoTask[] }>('/api/todos/').then((r) => r.tasks),

  today: () =>
    http.get<TodoToday>('/api/todos/today', { tz: tzOff() }),

  create: (payload: TodoSavePayload) =>
    http.post<{ ok: boolean; task: TodoTask }>('/api/todos/', payload),

  update: (id: number, payload: TodoSavePayload) =>
    http.put<{ ok: boolean; task: TodoTask }>(`/api/todos/${id}`, payload),

  remove: (id: number) => http.del<{ ok: boolean }>(`/api/todos/${id}`),

  checkin: (id: number) =>
    http.post<{ ok: boolean; already: boolean; count: number }>(`/api/todos/${id}/checkin`, {
      tz: tzOff()
    }),

  uncheckin: (id: number) =>
    http.del<{ ok: boolean; count: number }>(`/api/todos/${id}/checkin?tz=${tzOff()}`),

  stats: (days = 14) =>
    http.get<TodoStats>('/api/todos/stats', { days, tz: tzOff() })
}
