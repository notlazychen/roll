import { useCallback, useEffect, useState } from 'react'
import { optionApi } from '../lib/api'
import { ApiError } from '../lib/http'
import type { Options } from '../types'
import styles from './OptionsPage.module.css'

type Kind = 'category' | 'channel' | 'consumer' | 'account'

const KINDS: { key: Kind; label: string; hint: string; hasParent: boolean }[] = [
  { key: 'category', label: '分类', hint: '记一笔时最上层的选择', hasParent: false },
  { key: 'channel', label: '渠道', hint: '挂在分类下面，比如「餐饮 → 外卖」', hasParent: true },
  { key: 'consumer', label: '消费者', hint: '这笔钱花在谁身上', hasParent: false },
  { key: 'account', label: '账户', hint: '钱从哪个账户出', hasParent: false }
]

export default function OptionsPage() {
  const [kind, setKind] = useState<Kind>('category')
  const [options, setOptions] = useState<Options | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [newName, setNewName] = useState('')
  const [newParent, setNewParent] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      const data = await optionApi.all()
      setOptions(data)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const current = KINDS.find((k) => k.key === kind)!
  const categories = options?.categories ?? []

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name || busy) return
    if (kind === 'channel' && !newParent) {
      setError('渠道要挂在某个分类下面，请先选分类')
      return
    }

    setBusy(true)
    setError(null)
    try {
      await optionApi.add(kind, name, kind === 'channel' ? newParent : null)
      setNewName('')
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '添加失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  async function rename(id: number, oldName: string) {
    const next = window.prompt('改成什么名字？', oldName)?.trim()
    if (!next || next === oldName) return
    try {
      await optionApi.update(id, next)
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '修改失败')
    }
  }

  async function remove(id: number, name: string) {
    if (!window.confirm(`删除「${name}」？\n已经在用的选项不能删，请先改掉那些账目。`)) return
    try {
      await optionApi.remove(id)
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败')
    }
  }

  return (
    <>
      <header className="topbar">
        <h1 className="topbar-title">选项源</h1>
      </header>

      <div className="content">
        <div className={styles.tabs}>
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              className={`${styles.tab} ${kind === k.key ? styles.tabOn : ''}`}
              onClick={() => {
                setKind(k.key)
                setNewParent('')
                setError(null)
              }}
            >
              {k.label}
            </button>
          ))}
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className={styles.grid}>
          <section className={`card ${styles.panel}`}>
            <div className={styles.panelHead}>
              <div>
                <h2 className={styles.panelTitle}>{current.label}</h2>
                <p className={styles.panelHint}>{current.hint}</p>
              </div>
            </div>

            <form className={styles.addRow} onSubmit={add}>
              {current.hasParent && (
                <select
                  className={styles.select}
                  value={newParent}
                  onChange={(e) => setNewParent(e.target.value)}
                >
                  <option value="">选择分类</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              <input
                className={styles.input}
                placeholder={`新增${current.label}`}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={20}
              />
              <button type="submit" className="btn" disabled={busy || !newName.trim()}>
                添加
              </button>
            </form>

            {loading ? (
              <div className="empty">正在加载…</div>
            ) : (
              <OptionList
                kind={kind}
                options={options}
                onRename={rename}
                onRemove={remove}
              />
            )}
          </section>
        </div>
      </div>
    </>
  )
}

function OptionList({
  kind,
  options,
  onRename,
  onRemove
}: {
  kind: Kind
  options: Options | null
  onRename: (id: number, oldName: string) => void
  onRemove: (id: number, name: string) => void
}) {
  if (!options) return <div className="empty">暂无数据</div>

  // 渠道按分类分组展示，其余是平铺
  if (kind === 'channel') {
    if (options.channelGroups.length === 0) {
      return <div className="empty">还没有渠道，上面加一个吧</div>
    }
    return (
      <div className={styles.channelGroups}>
        {options.channelGroups.map((g) => (
          <div key={g.parent} className={styles.channelGroup}>
            <div className={styles.channelParent}>{g.parent}</div>
            <div className={styles.chips}>
              {g.items.map((item) => (
                <OptionChip
                  key={item.id}
                  name={item.name}
                  preset={item.isPreset}
                  onRename={() => onRename(item.id, item.name)}
                  onRemove={() => onRemove(item.id, item.name)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  const list =
    kind === 'category'
      ? options.categories
      : kind === 'consumer'
        ? options.consumers
        : options.accounts

  if (list.length === 0) return <div className="empty">还没有内容，上面加一个吧</div>

  return (
    <div className={styles.chips}>
      {list.map((item) => (
        <OptionChip
          key={item.id}
          name={item.name}
          preset={item.isPreset}
          onRename={() => onRename(item.id, item.name)}
          onRemove={() => onRemove(item.id, item.name)}
        />
      ))}
    </div>
  )
}

function OptionChip({
  name,
  preset,
  onRename,
  onRemove
}: {
  name: string
  preset: boolean
  onRename: () => void
  onRemove: () => void
}) {
  return (
    <span className={styles.chip}>
      {name}
      {preset && <i className={styles.presetTag}>预置</i>}
      <button type="button" className={styles.chipBtn} onClick={onRename} title="重命名">
        ✎
      </button>
      <button
        type="button"
        className={`${styles.chipBtn} ${styles.chipDel}`}
        onClick={onRemove}
        title="删除"
      >
        ×
      </button>
    </span>
  )
}
