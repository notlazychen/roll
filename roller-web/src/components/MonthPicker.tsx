import styles from './MonthPicker.module.css'

interface Props {
  year: number
  month: number
  onChange: (year: number, month: number) => void
}

/** 月份切换：左右箭头 + 当前月份；不允许翻到未来 */
export default function MonthPicker({ year, month, onChange }: Props) {
  const now = new Date()
  const atCurrentMonth = year === now.getFullYear() && month === now.getMonth()

  function shift(delta: number) {
    const d = new Date(year, month + delta, 1)
    onChange(d.getFullYear(), d.getMonth())
  }

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.arrow}
        onClick={() => shift(-1)}
        aria-label="上个月"
      >
        ‹
      </button>
      <span className={styles.label}>
        {year} 年 {month + 1} 月
      </span>
      <button
        type="button"
        className={styles.arrow}
        onClick={() => shift(1)}
        disabled={atCurrentMonth}
        aria-label="下个月"
      >
        ›
      </button>
      {!atCurrentMonth && (
        <button
          type="button"
          className={styles.today}
          onClick={() => onChange(now.getFullYear(), now.getMonth())}
        >
          本月
        </button>
      )}
    </div>
  )
}
