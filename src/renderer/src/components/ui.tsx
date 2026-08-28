import type { ReactNode } from 'react'

/** Standard page heading with an optional right-hand action area. */
export function PageHeader({
  title,
  subtitle,
  actions
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3 mb-4 sm:mb-6">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && (
          <p className="text-xs sm:text-sm mt-0.5 sm:mt-1" style={{ color: 'var(--text-secondary)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">{actions}</div>}
    </div>
  )
}

export function Section({
  title,
  description,
  children,
  actions
}: {
  title: string
  description?: string
  children: ReactNode
  actions?: ReactNode
}): React.JSX.Element {
  return (
    <section className="card p-5 mb-4">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {description}
            </p>
          )}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint?: string
}): React.JSX.Element {
  return (
    <label className="flex items-center justify-between gap-4 py-2 cursor-pointer">
      <span>
        <span className="text-sm">{label}</span>
        {hint && (
          <span className="block text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {hint}
          </span>
        )}
      </span>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="relative shrink-0 rounded-full transition-colors"
        style={{
          width: 40,
          height: 22,
          background: checked ? 'var(--color-accent-500)' : 'var(--surface-3)',
          border: '1px solid var(--border-subtle)'
        }}
      >
        <span
          className="absolute rounded-full transition-transform"
          style={{
            width: 16,
            height: 16,
            top: 2,
            left: 2,
            background: checked ? 'oklch(0.18 0.02 155)' : 'var(--text-secondary)',
            transform: checked ? 'translateX(18px)' : 'translateX(0)'
          }}
        />
      </button>
    </label>
  )
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  format
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  label: string
  format?: (value: number) => string
}): React.JSX.Element {
  return (
    <label className="block py-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm">{label}</span>
        <span className="text-xs tabular" style={{ color: 'var(--text-muted)' }}>
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={{ accentColor: 'var(--color-accent-500)' }}
      />
    </label>
  )
}

export function Stat({
  label,
  value,
  sub,
  tone = 'default'
}: {
  label: string
  value: string | number
  sub?: string
  tone?: 'default' | 'good' | 'warn' | 'bad'
}): React.JSX.Element {
  const color =
    tone === 'good'
      ? 'var(--color-accent-400)'
      : tone === 'warn'
        ? 'var(--color-warn-400)'
        : tone === 'bad'
          ? 'var(--color-danger-400)'
          : 'var(--text-primary)'

  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className="text-2xl font-semibold tabular mt-1" style={{ color }}>
        {value}
      </div>
      {sub && (
        <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

/** Colour swatch plus a hex field, kept in sync. */
export function ColorField({
  value,
  onChange,
  label,
  hint
}: {
  value: string
  onChange: (value: string) => void
  label: string
  hint?: string
}): React.JSX.Element {
  // <input type="color"> only understands #rrggbb, so rgba() theme defaults are
  // shown as their opaque approximation while the text field keeps the real
  // value editable.
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : rgbaToHex(value)

  return (
    <div className="flex items-center gap-3 py-1.5">
      <input
        type="color"
        value={hex}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="shrink-0 rounded cursor-pointer"
        style={{ width: 34, height: 26, background: 'transparent', border: '1px solid var(--border-subtle)' }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{label}</div>
        {hint && (
          <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
            {hint}
          </div>
        )}
      </div>
      <input
        className="input font-mono shrink-0"
        style={{ width: 168 }}
        value={value}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

/** Best-effort conversion so the swatch shows something sensible for rgba(). */
function rgbaToHex(value: string): string {
  const match = value.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
  if (!match) return '#888888'
  const [, r, g, b] = match
  const to = (n: string): string => Number(n).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

export function Empty({
  title,
  message,
  action
}: {
  title: string
  message: string
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="card p-10 text-center">
      <div className="font-semibold">{title}</div>
      <p className="text-sm mt-2 mx-auto max-w-md" style={{ color: 'var(--text-secondary)' }}>
        {message}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Spinner({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <span
      className="inline-block rounded-full animate-spin"
      style={{
        width: size,
        height: size,
        border: '2px solid var(--border-strong)',
        borderTopColor: 'var(--color-accent-500)'
      }}
    />
  )
}
