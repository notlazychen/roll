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
  register: (email: string, password: string, nickName?: string) =>
    http.post<AuthResponse>('/api/auth/register', { email, password, nickName }, true),

  login: (email: string, password: string) =>
    http.post<AuthResponse>('/api/auth/login', { email, password }, true),

  /** 修改/设置密码；纯微信账号可以借这个补一个密码，之后就能用邮箱登录 */
  changePassword: (newPassword: string, oldPassword?: string) =>
    http.post<{ ok: boolean; token: string }>('/api/auth/password', {
      newPassword,
      oldPassword: oldPassword ?? null
    }),

  me: () => http.get<MeResponse>('/api/me'),

  updateProfile: (patch: Partial<Pick<User, 'nickName' | 'avatarUrl' | 'tagAutoEnabled'>>) =>
    http.put<{ ok: boolean; user: User }>('/api/me', patch)
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
      tz: new Date().getTimezoneOffset()
    })
}
