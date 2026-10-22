/**
 * 与后端 Contracts/Dtos.cs 一一对应的类型。
 *
 * 两条铁律（和小程序端一致）：
 *   1. 金额一律是「分」的整数，只在这里以上显示时除 100；
 *   2. 时间一律是毫秒时间戳数字。
 */

/** 登录用户。纯微信账号 email 为 null；Web 账号 weChatBound 为 false */
export interface User {
  id: number
  nickName: string
  avatarUrl: string | null
  isDevAccount: boolean
  tagAutoEnabled: boolean
  email: string | null
  weChatBound: boolean
}

/** 统一响应壳：失败时后端返回 { ok:false, error } */
export interface OkResponse {
  ok: boolean
  error?: string
}

export interface AuthResponse extends OkResponse {
  token: string
  user: User
  isNew: boolean
}

export interface MeResponse extends OkResponse {
  user: User
  stats: {
    entryCount: number
    firstRecordAt: number | null
  }
}

/* --------------------------- 账目 --------------------------- */

export type EntryType = 'expense' | 'income'

export interface Entry {
  id: number
  type: EntryType
  /** 金额，单位：分 */
  amount: number
  category: string
  channel: string | null
  consumer: string | null
  account: string | null
  /** 交易时间，毫秒 */
  tradeAt: number
  /** 记录时间，毫秒 */
  createdAt: number
  remark: string | null
  tags: string[]
}

export interface EntryPage {
  items: Entry[]
  hasMore: boolean
  nextCursor: string | null
}

/* --------------------------- 选项源 --------------------------- */

export interface OptionItem {
  id: number
  kind: string
  name: string
  parent: string | null
  isPreset: boolean
}

export interface ChannelGroup {
  parent: string
  items: OptionItem[]
}

export interface Options {
  categories: OptionItem[]
  channels: OptionItem[]
  channelGroups: ChannelGroup[]
  consumers: OptionItem[]
  accounts: OptionItem[]
  tags: OptionItem[]
}

/* --------------------------- 报表 --------------------------- */

export interface CategoryStat {
  name: string
  /** 单位：分 */
  amount: number
  count: number
  percent: number
}

export interface DayPoint {
  /** yyyy-MM-dd */
  date: string
  income: number
  expense: number
}

export interface Report {
  income: number
  expense: number
  balance: number
  count: number
  categories: CategoryStat[]
  incomeCategories: CategoryStat[]
  days: DayPoint[]
}

export interface Overview {
  todayExpense: number
  todayIncome: number
  monthExpense: number
  monthIncome: number
  entryCount: number
}
