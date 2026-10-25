import { useCallback, useEffect, useState } from 'react'
import { todoApi } from '../lib/api'
import { ApiError } from '../lib/http'
import type { TodoTask, TodoType } from '../lib/api'
import styles from './todo.module.css'

const WEEK_LABEL = ['一', '二', '三', '四', '五', '六', '日']

function todayLocal(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

interface FormState {
  id: number | null
  title: string
  type: TodoType
  dueDate: string
  weekDays: number[]
  startDate: string
}

const EMPTY_FORM: FormState = {
  id: null,
  title: '',
  type: 'once',
  dueDate: todayLocal(),
  weekDays: [],
  startDate: todayLocal()
}

/** 任务规划：新建 / 编辑 / 删除任务，周期任务用星期芯片选择重复日 */
export default function TodoPlanPage() {
  const [tasks, setTasks] = useState<TodoTask[]>([])
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setTasks(await todoApi.list())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function toggleWeekDay(w: number) {
    setForm((f) => ({
      ...f,
      weekDays: f.weekDays.includes(w) ? f.weekDays.filter((x) => x !== w) : [...f.weekDays, w].sort()
    }))
  }

  function editTask(t: TodoTask) {
    setForm({
      id: t.id,
      title: t.title,
      type: t.type,
      dueDate: t.dueDate ?? todayLocal(),
      weekDays: t.weekDays ?? [],
      startDate: t.startDate ?? todayLocal()
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function submit() {
    if (busy) return
    const title = form.title.trim()
    if (!title) {
      setError('请填写任务内容')
      return
    }
    if (form.type === 'recurring' && form.weekDays.length === 0) {
      setError('周期任务请至少选择一个重复日')
      return
    }

    setBusy(true)
    setError(null)
    const payload = {
      title,
      type: form.type,
      dueDate: form.type === 'once' ? form.dueDate : undefined,
      weekDays: form.type === 'recurring' ? form.weekDays : undefined,
      startDate: form.type === 'recurring' ? form.startDate : undefined,
      tz: -new Date().getTimezoneOffset()
    }
    try {
      if (form.id === null) await todoApi.create(payload)
      else await todoApi.update(form.id, payload)
      setForm({ ...EMPTY_FORM })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  async function remove(t: TodoTask) {
    if (!window.confirm(`删除「${t.title}」？它的打卡记录也会一并删除。`)) return
    try {
      await todoApi.remove(t.id)
      setTasks((prev) => prev.filter((x) => x.id !== t.id))
      if (form.id === t.id) setForm({ ...EMPTY_FORM })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败，请重试')
    }
  }

  const editing = form.id !== null

  return (
    <>
      <header className="topbar">
        <h1 className="topbar-title">任务规划</h1>
      </header>

      <div className="content">
        <div className={styles.page}>
          {/* ---------------- 新建 / 编辑表单 ---------------- */}
          <section className={`card ${styles.formGrid}`}>
            <div>
              <label className={styles.fieldLabel} htmlFor="todo-title">
                {editing ? '编辑任务' : '新建任务'}
              </label>
              <input
                id="todo-title"
                className={styles.titleInput}
                placeholder="例如：睡前读 20 页书"
                maxLength={64}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>

            <div>
              <span className={styles.fieldLabel}>类型</span>
              <div className={styles.segmented}>
                <button
                  type="button"
                  className={`${styles.segment} ${form.type === 'once' ? styles.segmentOn : ''}`}
                  onClick={() => setForm((f) => ({ ...f, type: 'once' }))}
                >
                  一次性
                </button>
                <button
                  type="button"
                  className={`${styles.segment} ${form.type === 'recurring' ? styles.segmentOn : ''}`}
                  onClick={() => setForm((f) => ({ ...f, type: 'recurring' }))}
                >
                  周期性
                </button>
              </div>
            </div>

            {form.type === 'once' ? (
              <div>
                <span className={styles.fieldLabel}>目标日期（这天出现在今日任务里）</span>
                <input
                  type="date"
                  className={styles.dateInput}
                  value={form.dueDate}
                  onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
              </div>
            ) : (
              <>
                <div>
                  <span className={styles.fieldLabel}>重复日</span>
                  <div className={styles.weekChips}>
                    {WEEK_LABEL.map((label, i) => (
                      <button
                        key={label}
                        type="button"
                        className={`${styles.chip} ${form.weekDays.includes(i + 1) ? styles.on : ''}`}
                        onClick={() => toggleWeekDay(i + 1)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className={styles.fieldLabel}>开始日期（可选，默认今天生效）</span>
                  <input
                    type="date"
                    className={styles.dateInput}
                    value={form.startDate}
                    onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                  />
                </div>
              </>
            )}

            {error && <div className="alert alert-error">{error}</div>}

            <div className={styles.formActions}>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
                {busy ? '保存中…' : editing ? '保存修改' : '创建任务'}
              </button>
              {editing && (
                <button type="button" className="btn btn-ghost" onClick={() => setForm({ ...EMPTY_FORM })}>
                  取消
                </button>
              )}
            </div>
          </section>

          {/* ---------------- 任务列表 ---------------- */}
          {loading && <div className="empty">正在加载…</div>}

          {!loading && tasks.length === 0 && <div className="empty">还没有任务，先创建一个。</div>}

          {!loading && tasks.length > 0 && (
            <section className="card">
              {tasks.map((t) => (
                <div key={t.id} className={styles.planRow}>
                  <div className={styles.taskBody}>
                    <div className={styles.taskTitle}>{t.title}</div>
                    <div className={styles.planMeta}>
                      {t.type === 'recurring' ? (
                        <span>
                          {(t.weekDays ?? []).length === 7
                            ? '每天'
                            : `每周${(t.weekDays ?? []).map((w) => WEEK_LABEL[w - 1]).join('、')}`}
                          {' · '}自 {t.startDate} 生效
                        </span>
                      ) : (
                        <span>目标日 {t.dueDate}</span>
                      )}
                      {t.lastCheckIn && <span>最近打卡 {t.lastCheckIn}</span>}
                    </div>
                  </div>
                  <span className={styles.countBadge}>打卡 {t.checkinCount} 次</span>
                  <button type="button" className="btn btn-ghost" onClick={() => editTask(t)}>
                    编辑
                  </button>
                  <button type="button" className="btn btn-danger" onClick={() => remove(t)}>
                    删除
                  </button>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </>
  )
}
