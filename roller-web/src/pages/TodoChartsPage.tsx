import { useEffect, useState } from 'react'
import { todoApi } from '../lib/api'
import { ApiError } from '../lib/http'
import type { TodoStats } from '../lib/api'
import styles from './todo.module.css'

const WEEK_LABEL = ['', '一', '二', '三', '四', '五', '六', '日']

/** 数据图表：近两周打卡柱状图 + 任务打卡榜 */
export default function TodoChartsPage() {
  const [stats, setStats] = useState<TodoStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await todoApi.stats(14)
        if (!cancelled) setStats(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : '加载失败，请重试')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const maxDaily = stats ? Math.max(1, ...stats.daily.map((d) => d.count)) : 1
  const maxRank = stats && stats.ranking.length > 0 ? Math.max(1, stats.ranking[0].count) : 1

  return (
    <>
      <header className="topbar">
        <h1 className="topbar-title">数据图表</h1>
      </header>

      <div className="content">
        {error && <div className="alert alert-error">{error}</div>}
        {loading && <div className="empty">正在加载…</div>}

        {!loading && stats && (
          <div className={styles.page}>
            <div className={styles.summary}>
              <div className={`card ${styles.summaryCard}`}>
                <span>累计打卡</span>
                <strong>{stats.totalCheckins}</strong>
                <em>所有任务合计</em>
              </div>
              <div className={`card ${styles.summaryCard}`}>
                <span>周期任务</span>
                <strong>{stats.recurringCount}</strong>
                <em>进行中</em>
              </div>
              <div className={`card ${styles.summaryCard}`}>
                <span>待完成一次性</span>
                <strong>{stats.pendingOnceCount}</strong>
                <em>尚未打卡</em>
              </div>
            </div>

            <section className={`card ${styles.panel}`}>
              <h2 className={styles.fieldLabel}>近 14 天每日完成</h2>
              <div className={styles.bars}>
                {stats.daily.map((d) => {
                  const day = new Date(d.day + 'T00:00:00')
                  return (
                    <div key={d.day} className={styles.barCol} title={`${d.day}：${d.count} 次`}>
                      <span className={styles.barNum}>{d.count > 0 ? d.count : ''}</span>
                      <div
                        className={`${styles.bar} ${d.count === maxDaily && d.count > 0 ? styles.hot : ''}`}
                        style={{ height: `${(d.count / maxDaily) * 100}%` }}
                      />
                      <span className={styles.barDay}>{WEEK_LABEL[day.getDay() === 0 ? 7 : day.getDay()]}</span>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className={`card ${styles.panel}`}>
              <h2 className={styles.fieldLabel}>任务打卡榜</h2>
              {stats.ranking.length === 0 ? (
                <div className="empty">还没有打卡记录</div>
              ) : (
                stats.ranking.map((t, i) => (
                  <div key={t.id} className={styles.rankRow}>
                    <span className={`${styles.rankIdx} ${i < 3 ? styles.top : ''}`}>{i + 1}</span>
                    <div className={styles.rankBody}>
                      <div className={styles.rankTitle}>{t.title}</div>
                      <div className={styles.rankTrack}>
                        <div className={styles.rankFill} style={{ width: `${(t.count / maxRank) * 100}%` }} />
                      </div>
                    </div>
                    <span className={styles.rankCount}>{t.count} 次</span>
                  </div>
                ))
              )}
            </section>
          </div>
        )}
      </div>
    </>
  )
}
