import { useEffect, useState } from 'react'
import { reportApi } from '../lib/api'
import { ApiError } from '../lib/http'
import { formatMoney, centsToYuan } from '../lib/format'
import type { CategoryStat, DayPoint, Report } from '../types'
import styles from './ChartsPage.module.css'

type Range = 'month' | 'quarter' | 'year'

const RANGE_LABEL: Record<Range, string> = {
  month: '近一月',
  quarter: '近三月',
  year: '近一年'
}

/** 计算区间的起止（毫秒），to 为不含的右边界 */
function rangeOf(range: Range): { from: number; to: number } {
  const now = new Date()
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
  const months = range === 'month' ? 1 : range === 'quarter' ? 3 : 12
  const from = new Date(now.getFullYear(), now.getMonth() - months + 1, 1).getTime()
  return { from, to }
}

export default function ChartsPage() {
  const [range, setRange] = useState<Range>('month')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const { from, to } = rangeOf(range)
    ;(async () => {
      try {
        const data = await reportApi.get(from, to)
        if (!cancelled) setReport(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : '加载失败，请重试')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [range])

  return (
    <>
      <header className="topbar">
        <h1 className="topbar-title">图表</h1>
        <div className="topbar-right">
          <div className={styles.segmented}>
            {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
              <button
                key={r}
                type="button"
                className={`${styles.segment} ${range === r ? styles.segmentOn : ''}`}
                onClick={() => setRange(r)}
              >
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="content">
        {error && <div className="alert alert-error">{error}</div>}
        {loading && <div className="empty">正在加载…</div>}

        {!loading && report && (
          <div className={styles.wrap}>
            <div className={styles.summary}>
              <div className={`card ${styles.summaryCard}`}>
                <span>支出</span>
                <strong className={styles.expense}>{formatMoney(report.expense)}</strong>
                <em>{report.count} 笔记录</em>
              </div>
              <div className={`card ${styles.summaryCard}`}>
                <span>收入</span>
                <strong className={styles.income}>{formatMoney(report.income)}</strong>
                <em>日均支出 {formatMoney(dailyAvg(report))}</em>
              </div>
              <div className={`card ${styles.summaryCard}`}>
                <span>结余</span>
                <strong>{formatMoney(report.balance)}</strong>
                <em>{report.balance >= 0 ? '有结余，继续保持' : '支出超过收入'}</em>
              </div>
            </div>

            <div className={styles.two}>
              <section className={`card ${styles.panel}`}>
                <h2 className={styles.panelTitle}>分类占比</h2>
                {report.categories.length === 0 ? (
                  <div className="empty">这段时间没有支出</div>
                ) : (
                  <DonutChart data={report.categories} total={report.expense} />
                )}
              </section>

              <section className={`card ${styles.panel}`}>
                <h2 className={styles.panelTitle}>每日支出</h2>
                {report.days.length === 0 ? (
                  <div className="empty">还没有数据</div>
                ) : (
                  <TrendChart days={report.days} />
                )}
              </section>
            </div>

            <section className={`card ${styles.panel}`}>
              <h2 className={styles.panelTitle}>分类排行</h2>
              {report.categories.length === 0 ? (
                <div className="empty">这段时间没有支出</div>
              ) : (
                <RankList data={report.categories} />
              )}
            </section>
          </div>
        )}
      </div>
    </>
  )
}

function dailyAvg(r: Report): number {
  if (r.days.length === 0) return 0
  return Math.round(r.expense / r.days.length)
}

/* --------------------------- 环形图 --------------------------- */

const PALETTE = ['#1F8A70', '#2BAE8A', '#5CC9A7', '#9BD9C4', '#C8E9DD', '#8AA0A8', '#C4CCD2']

function DonutChart({ data, total }: { data: CategoryStat[]; total: number }) {
  const top = data.slice(0, 6)
  const rest = data.slice(6)
  const items = rest.length
    ? [
        ...top,
        {
          name: '其他',
          amount: rest.reduce((s, x) => s + x.amount, 0),
          count: rest.reduce((s, x) => s + x.count, 0),
          percent: rest.reduce((s, x) => s + x.percent, 0)
        }
      ]
    : top

  const R = 62
  const C = 2 * Math.PI * R
  let offset = 0

  return (
    <div className={styles.donutWrap}>
      <svg viewBox="0 0 160 160" className={styles.donut} role="img" aria-label="分类占比">
        <circle cx="80" cy="80" r={R} fill="none" stroke="#f1f3f6" strokeWidth="22" />
        {items.map((d, i) => {
          const ratio = total > 0 ? d.amount / total : 0
          const len = ratio * C
          const dash = `${Math.max(len - 2, 0)} ${C - Math.max(len - 2, 0)}`
          const el = (
            <circle
              key={d.name}
              cx="80"
              cy="80"
              r={R}
              fill="none"
              stroke={PALETTE[i % PALETTE.length]}
              strokeWidth="22"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              strokeLinecap="round"
              transform="rotate(-90 80 80)"
            />
          )
          offset += len
          return el
        })}
        <text x="80" y="74" textAnchor="middle" className={styles.donutTotalLabel}>
          总支出
        </text>
        <text x="80" y="96" textAnchor="middle" className={styles.donutTotalValue}>
          {centsToYuan(total)}
        </text>
      </svg>

      <ul className={styles.legend}>
        {items.map((d, i) => (
          <li key={d.name}>
            <i style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className={styles.legendName}>{d.name}</span>
            <span className={styles.legendPct}>{d.percent.toFixed(0)}%</span>
            <span className={styles.legendAmount}>{formatMoney(d.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* --------------------------- 折线趋势 --------------------------- */

function TrendChart({ days }: { days: DayPoint[] }) {
  const W = 560
  const H = 180
  const padX = 8
  const padY = 16

  const max = Math.max(...days.map((d) => d.expense), 1)
  const step = days.length > 1 ? (W - padX * 2) / (days.length - 1) : 0

  const points = days.map((d, i) => {
    const x = padX + i * step
    const y = H - padY - (d.expense / max) * (H - padY * 2)
    return [x, y] as const
  })

  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${(padX + (days.length - 1) * step).toFixed(1)},${H - padY} L${padX},${H - padY} Z`

  return (
    <div className={styles.trendWrap}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.trend} preserveAspectRatio="none">
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2BAE8A" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#2BAE8A" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#areaFill)" />
        <path d={line} fill="none" stroke="#1F8A70" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className={styles.trendAxis}>
        <span>{days[0]?.date}</span>
        <span>最高 {formatMoney(max)}</span>
        <span>{days[days.length - 1]?.date}</span>
      </div>
    </div>
  )
}

/* --------------------------- 排行 --------------------------- */

function RankList({ data }: { data: CategoryStat[] }) {
  const max = Math.max(...data.map((d) => d.amount), 1)
  return (
    <ul className={styles.rank}>
      {data.map((d, i) => (
        <li key={d.name}>
          <span className={styles.rankNo}>{i + 1}</span>
          <span className={styles.rankName}>{d.name}</span>
          <span className={styles.rankBar}>
            <i style={{ width: `${(d.amount / max) * 100}%` }} />
          </span>
          <span className={styles.rankCount}>{d.count} 笔</span>
          <span className={styles.rankAmount}>{formatMoney(d.amount)}</span>
        </li>
      ))}
    </ul>
  )
}
