import { useEffect, useMemo, useRef, useState } from 'react'
import { entryApi, optionApi } from '../lib/api'
import { ApiError } from '../lib/http'
import { fromDateTimeLocal, parseYuanToCents, toDateTimeLocal } from '../lib/format'
import type { Entry, EntryType, Options } from '../types'
import styles from './EntryForm.module.css'

interface Props {
  /** 传 null 表示新增，传账目表示编辑 */
  entry: Entry | null
  onClose: () => void
  onSaved: () => void
}

export default function EntryForm({ entry, onClose, onSaved }: Props) {
  const isEdit = entry !== null

  const [type, setType] = useState<EntryType>(entry?.type ?? 'expense')
  const [amount, setAmount] = useState(entry ? (entry.amount / 100).toFixed(2) : '')
  const [category, setCategory] = useState(entry?.category ?? '')
  const [channel, setChannel] = useState(entry?.channel ?? '')
  const [consumer, setConsumer] = useState(entry?.consumer ?? '')
  const [account, setAccount] = useState(entry?.account ?? '')
  const [remark, setRemark] = useState(entry?.remark ?? '')
  const [tradeAt, setTradeAt] = useState(toDateTimeLocal(entry?.tradeAt ?? Date.now()))

  const [options, setOptions] = useState<Options | null>(null)
  const [autoTags, setAutoTags] = useState<string[]>(entry?.tags ?? [])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const amountRef = useRef<HTMLInputElement>(null)

  // 选项源：分类、渠道（按分类分组）、消费者、账户
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const opts = await optionApi.all()
        if (cancelled) return
        setOptions(opts)
        // 新增时默认选第一个分类，省一次点击
        setCategory((prev) => prev || opts.categories[0]?.name || '')
      } catch {
        if (!cancelled) setError('选项加载失败，可以稍后重试')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    amountRef.current?.focus()
  }, [])

  // 备注变化时试算自动标签（后端有防抖需求，这里自己控制一下频率）
  useEffect(() => {
    if (!remark.trim()) {
      setAutoTags([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const res = await entryApi.previewTags(remark.trim())
        if (!cancelled) setAutoTags(res.tags ?? [])
      } catch {
        /* 标签是锦上添花，失败就不显示，不打扰用户 */
      }
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [remark])

  // 当前分类下的渠道
  const channels = useMemo(() => {
    if (!options) return []
    const group = options.channelGroups.find((g) => g.parent === category)
    return group?.items ?? []
  }, [options, category])

  // 换分类时，若原渠道在新分类下不存在则清空
  useEffect(() => {
    if (channel && !channels.some((c) => c.name === channel)) setChannel('')
  }, [channels, channel])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)

    const cents = parseYuanToCents(amount)
    if (cents === null || cents <= 0) {
      setError('请输入有效金额，最多两位小数')
      return
    }
    if (!category) {
      setError('请选择分类')
      return
    }
    const ts = fromDateTimeLocal(tradeAt)
    if (ts === null) {
      setError('交易时间格式不正确')
      return
    }

    const body = {
      type,
      amount: cents,
      category,
      channel: channel || null,
      consumer: consumer || null,
      account: account || null,
      tradeAt: ts,
      remark: remark.trim() || null,
      tags: autoTags
    }

    setBusy(true)
    try {
      if (isEdit) await entryApi.update(entry.id, body)
      else await entryApi.create(body)
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败，请重试')
      setBusy(false)
    }
  }

  async function remove() {
    if (!isEdit || busy) return
    if (!window.confirm('确定删除这笔记录？删除后不可恢复。')) return

    setBusy(true)
    try {
      await entryApi.remove(entry.id)
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败，请重试')
      setBusy(false)
    }
  }

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className={styles.dialog} onSubmit={submit}>
        <div className={styles.head}>
          <h2>{isEdit ? '改一笔' : '记一笔'}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        {/* 金额：大号数字，符号跟着收支类型走 */}
        <div className={styles.amountRow}>
          <span className={`${styles.currency} ${type === 'expense' ? styles.cRed : styles.cGreen}`}>
            {type === 'expense' ? '−' : '+'} ¥
          </span>
          <input
            ref={amountRef}
            className={`${styles.amountInput} ${type === 'expense' ? styles.cRed : styles.cGreen}`}
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div className={styles.segmented}>
          {(
            [
              ['expense', '支出'],
              ['income', '收入']
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`${styles.segment} ${type === value ? styles.segmentOn : ''}`}
              onClick={() => setType(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <Field label="分类">
          <div className={styles.chips}>
            {(options?.categories ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                className={`${styles.chip} ${category === c.name ? styles.chipOn : ''}`}
                onClick={() => setCategory(c.name)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </Field>

        {channels.length > 0 && (
          <Field label="渠道">
            <div className={styles.chips}>
              {channels.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`${styles.chip} ${channel === c.name ? styles.chipOn : ''}`}
                  onClick={() => setChannel(channel === c.name ? '' : c.name)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </Field>
        )}

        <div className={styles.twoCol}>
          <Field label="消费者">
            <select value={consumer} onChange={(e) => setConsumer(e.target.value)}>
              <option value="">不限</option>
              {(options?.consumers ?? []).map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="账户">
            <select value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">不指定</option>
              {(options?.accounts ?? []).map((a) => (
                <option key={a.id} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="备注">
          <input
            type="text"
            placeholder="吃什么都记一下，标签会自动识别"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            maxLength={200}
          />
        </Field>

        {autoTags.length > 0 && (
          <div className={styles.tagHint}>
            <span>自动标签</span>
            {autoTags.map((t) => (
              <i key={t}>#{t}</i>
            ))}
          </div>
        )}

        <Field label="交易时间">
          <input
            type="datetime-local"
            value={tradeAt}
            onChange={(e) => setTradeAt(e.target.value)}
          />
        </Field>

        {error && <div className="alert alert-error">{error}</div>}

        <div className={styles.actions}>
          {isEdit && (
            <button type="button" className={`btn btn-danger ${styles.del}`} onClick={remove}>
              删除
            </button>
          )}
          <button type="submit" className={`btn ${styles.save}`} disabled={busy}>
            {busy ? '保存中…' : '保 存'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  )
}
