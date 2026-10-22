import { useCallback, useEffect, useMemo, useState } from 'react'
import { entryApi } from '../lib/api'
import { ApiError } from '../lib/http'
import { formatMoney, friendlyDayLabel, formatDateTime, endOfMonth, startOfMonth } from '../lib/format'
import type { Entry, EntryType, Overview } from '../types'
import EntryForm from '../components/EntryForm'
import MonthPicker from '../components/MonthPicker'
import styles from './EntriesPage.module.css'

export default function EntriesPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())

  const [entries, setEntries] = useState<Entry[]>([])
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [keyword, setKeyword] = useState('')
  const [typeFilter, setTypeFilter] = useState<EntryType | 'all'>('all')

  const [editing, setEditing] = useState<Entry | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const range = useMemo(
    () => ({ from: startOfMonth(year, month), to: endOfMonth(year, month) }),
    [year, month]
  )

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const [page, ov] = await Promise.all([
          entryApi.list({
            from: range.from,
            to: range.to,
            keyword: keyword.trim() || undefined,
            type: typeFilter === 'all' ? undefined : typeFilter,
            limit: 100
          }),
          entryApi.overview()
        ])
        if (cancelled) return
        setEntries(page.items)
        setOverview(ov)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : '加载失败，请重试')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [range, keyword, typeFilter, reloadKey])

  // 按天分组：列表本身就是按 tradeAt 倒序，直接顺序切段即可
  const groups = useMemo(() => {
    const map: { day: number; items: Entry[]; expense: number; income: number }[] = []
    for (const e of entries) {
      const d = new Date(e.tradeAt)
      const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
      let g = map[map.length - 1]
      if (!g || g.day !== day) {
        g = { day, items: [], expense: 0, income: 0 }
        map.push(g)
      }
      g.items.push(e)
      if (e.type === 'expense') g.expense += e.amount
      else g.income += e.amount
    }
    return map
  }, [entries])

  const monthExpense = overview?.monthExpense ?? 0
  const monthIncome = overview?.monthIncome ?? 0

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(entry: Entry) {
    setEditing(entry)
    setFormOpen(true)
  }

  return (
    <>
      <header className="topbar">
        <h1 className="topbar-title">明细</h1>
        <div className="topbar-right">
          <MonthPicker
            year={year}
            month={month}
            onChange={(y, m) => {
              setYear(y)
              setMonth(m)
            }}
          />
          <button type="button" className="btn" onClick={openCreate}>
            + 记一笔
          </button>
        </div>
      </header>

      <div className="content">
        <div className={styles.stats}>
          <StatCard label="本月支出" value={formatMoney(monthExpense)} tone="expense" />
          <StatCard label="本月收入" value={formatMoney(monthIncome)} tone="income" />
          <StatCard
            label="本月结余"
            value={formatMoney(monthIncome - monthExpense)}
            tone="neutral"
          />
          <StatCard label="今日支出" value={formatMoney(overview?.todayExpense ?? 0)} tone="plain" />
        </div>

        <div className={styles.toolbar}>
          <div className={styles.search}>
            <SearchIcon />
            <input
              type="search"
              placeholder="搜索备注、渠道、消费者"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>

          <div className={styles.segmented}>
            {(
              [
                ['all', '全部'],
                ['expense', '支出'],
                ['income', '收入']
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`${styles.segment} ${typeFilter === value ? styles.segmentOn : ''}`}
                onClick={() => setTypeFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className={`card ${styles.listCard}`}>
          {loading ? (
            <div className="empty">正在加载…</div>
          ) : groups.length === 0 ? (
            <div className="empty">
              这个月还没有记录
              <br />
              点右上角「记一笔」开始吧
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.day} className={styles.dayGroup}>
                <div className={styles.dayHead}>
                  <span className={styles.dayLabel}>{friendlyDayLabel(g.day)}</span>
                  <span className={styles.daySum}>
                    {g.expense > 0 && <b className={styles.expense}>-{formatMoney(g.expense)}</b>}
                    {g.income > 0 && <b className={styles.income}>+{formatMoney(g.income)}</b>}
                  </span>
                </div>

                {g.items.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className={styles.row}
                    onClick={() => openEdit(e)}
                  >
                    <span className={styles.rowIcon}>{e.category.charAt(0)}</span>
                    <span className={styles.rowMain}>
                      <span className={styles.rowTitle}>
                        {e.category}
                        {e.channel && <i className={styles.rowChannel}>{e.channel}</i>}
                      </span>
                      <span className={styles.rowMeta}>
                        {formatDateTime(e.tradeAt)}
                        {e.consumer && ` · ${e.consumer}`}
                        {e.account && ` · ${e.account}`}
                        {e.remark && ` · ${e.remark}`}
                      </span>
                      {e.tags.length > 0 && (
                        <span className={styles.tags}>
                          {e.tags.map((t) => (
                            <i key={t} className={styles.tag}>
                              #{t}
                            </i>
                          ))}
                        </span>
                      )}
                    </span>
                    <span
                      className={`${styles.rowAmount} ${
                        e.type === 'expense' ? styles.expense : styles.income
                      }`}
                    >
                      {e.type === 'expense' ? '-' : '+'}
                      {formatMoney(e.amount)}
                    </span>
                  </button>
                ))}
              </section>
            ))
          )}
        </div>
      </div>

      {formOpen && (
        <EntryForm
          entry={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false)
            reload()
          }}
        />
      )}

      {/* 移动端悬浮记账按钮：手机上「记一笔」是最高频动作，别让它藏在顶栏 */}
      {!formOpen && (
        <button
          type="button"
          className={styles.fab}
          onClick={openCreate}
          aria-label="记一笔"
        >
          +
        </button>
      )}
    </>
  )
}

function StatCard({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone: 'expense' | 'income' | 'neutral' | 'plain'
}) {
  const toneClass =
    tone === 'expense' ? styles.expense : tone === 'income' ? styles.income : undefined
  return (
    <div className={`card ${styles.statCard} ${tone === 'expense' ? styles.statAccent : ''}`}>
      <span className={styles.statLabel}>{label}</span>
      <strong className={`${styles.statValue} ${toneClass ?? ''}`}>{value}</strong>
    </div>
  )
}

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m16.5 16.5 4 4" />
    </svg>
  )
}
