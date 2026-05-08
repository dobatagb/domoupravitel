import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import './ConfirmDialog.css'

export type ConfirmOptions = {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** 'danger' оцветява потвърждаващия бутон в червено (за изтриване, приключване). */
  variant?: 'default' | 'danger'
}

type Resolver = (value: boolean) => void

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | undefined>(undefined)

type ActiveDialog = ConfirmOptions & { resolve: Resolver }

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveDialog | null>(null)
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null)

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setActive({ ...opts, resolve })
    })
  }, [])

  const close = useCallback(
    (value: boolean) => {
      setActive((curr) => {
        if (curr) curr.resolve(value)
        return null
      })
    },
    []
  )

  // Focus confirm button at open + ESC handler.
  useEffect(() => {
    if (!active) return
    confirmBtnRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false)
      if (e.key === 'Enter') close(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active, close])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {active ? (
        <div
          className="confirm-overlay"
          role="presentation"
          onMouseDown={(e) => {
            // Close on backdrop click only (не върху самото съдържание).
            if (e.target === e.currentTarget) close(false)
          }}
        >
          <div
            className={`confirm-dialog confirm-dialog--${active.variant ?? 'default'}`}
            role="alertdialog"
            aria-modal
            aria-labelledby="confirm-dialog-title"
            aria-describedby="confirm-dialog-msg"
          >
            <div className="confirm-dialog-head">
              <span className="confirm-dialog-icon" aria-hidden>
                <AlertTriangle size={22} />
              </span>
              <h2 id="confirm-dialog-title" className="confirm-dialog-title">
                {active.title ?? 'Потвърждение'}
              </h2>
            </div>
            <p id="confirm-dialog-msg" className="confirm-dialog-msg">
              {active.message}
            </p>
            <div className="confirm-dialog-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => close(false)}
              >
                {active.cancelLabel ?? 'Отказ'}
              </button>
              <button
                ref={confirmBtnRef}
                type="button"
                className={
                  active.variant === 'danger'
                    ? 'btn-primary confirm-dialog-confirm--danger'
                    : 'btn-primary'
                }
                onClick={() => close(true)}
              >
                {active.confirmLabel ?? 'Потвърди'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    throw new Error('useConfirm трябва да се ползва вътре в <ConfirmDialogProvider>.')
  }
  return ctx
}

/** Удобство за извикване извън React (рядко) — резолвирано чрез глобален провайдър не е възможно. */
export function _useConfirmStability() {
  return useMemo(() => ({}), [])
}
