import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { todoApi } from '../lib/api'
import { ApiError } from '../lib/http'
import type { TodoToday } from '../lib/api'
import styles from './todo.module.css'

const WEEK_LABEL = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']

function fmtDate(d: Date): string {
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

function weekLabel(d: Date): string {
  return WEEK_LABEL[d.getDay() === 0 ? 7 : d.getDay()]
}

/** 今日任务：打卡是唯一的动作，列表由后端按任务规则生成 */
export default function TodoTodayPage() {
  const [data, setData] = useState<TodoToday | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setData(await todoApi.today())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function toggle(id: number, done: boolean) {
    if (busyId !== null) return
    setBusyId(id)
    // 先本地翻转，打卡接口幂等且足够快，体验优先
    setData((prev) =>
      prev
        ? {
            ...prev,
            done: prev.done + (done ? -1 : 1),
            tasks: prev.tasks.map((t) =>
              t.id === id ? { ...t, done: !done, checkedIn: !done } : t
            )
          }
        : prev
    )
    try {
      if (done) await todoApi.uncheckin(id)
      else await todoApi.checkin(id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '操作失败，请重试')
      await load() // 失败回滚到服务端真值
    } finally {
      setBusyId(null)
    }
  }

  const now = new Date()
  const progress = data && data.total > 0 ? Math.round((data.done / data.total) * 100) : 0

  return (
    <>
      <header className="topbar">
        <h1 className="topbar-title">今日任务</h1>
      </header>

      <div className="content">
        <div className={styles.page}>
          <section className="card">
            <div className={styles.dateLine}>
              {fmtDate(now)} · {weekLabel(now)}
            </div>
            <div className={styles.progressWrap} style={{ marginTop: 10 }}>
              <div className={styles.progressBar} style={{ width: `${progress}%` }} />
            </div>
            <div className={styles.progressText}>
              {data ? (data.total === 0 ? '今天没有安排任务' : `已完成 ${data.done} / ${data.total}（${progress}%）`) : ' '}
            </div>
          </section>

          {error && <div className="alert alert-error">{error}</div>}
          {loading && <div className="empty">正在加载…</div>}

          {!loading && data && data.tasks.length === 0 && (
            <div className="empty">
              今天没有要做的任务。
              <br />
              去 <Link to="/todo/plan">任务规划</Link> 里安排一个吧。
            </div>
          )}

          {!loading && data && data.tasks.length > 0 && (
            <section className="card">
              <div className={styles.taskList}>
                {data.tasks.map((t) => (
                  <div key={t.id} className={styles.taskRow}>
                    <button
                      type="button"
                      className={`${styles.check} ${t.done ? styles.on : ''}`}
                      onClick={() => toggle(t.id, t.done)}
                      disabled={busyId === t.id}
                      aria-label={t.done ? '撤销打卡' : '打卡'}
                    >
                      ✓
                    </button>
                    <div className={styles.taskBody}>
                      <div className={`${styles.taskTitle} ${t.done ? styles.done : ''}`}>{t.title}</div>
                      <div className={styles.taskTags}>
                        {t.overdue && <span className={`${styles.tag} ${styles.tagWarn}`}>已过期</span>}
                        {t.type === 'recurring' ? (
                          <span className={styles.tag}>
                            {(t.weekDays ?? []).length === 7 ? '每天' : `每${(t.weekDays ?? []).map((w) => WEEK_LABEL[w]).join('·')}`}
                          </span>
                        ) : (
                          <span className={`${styles.tag} ${styles.tagMuted}`}>一次性</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  )
}
