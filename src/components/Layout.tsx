import { useEffect, useState } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  Home,
  Building2,
  FileText,
  LogOut,
  CreditCard,
  Tags,
  CalendarRange,
  Users,
  LayoutGrid,
  History,
  Download,
  Wallet,
  Megaphone,
  Settings,
  Dices,
  Menu,
  X,
} from 'lucide-react'
import { usePwaInstall } from '../hooks/usePwaInstall'
import './Layout.css'

const MIN_PASSWORD_LEN = 6

export default function Layout() {
  const { signOut, user, userRole, updatePassword } = useAuth()
  const location = useLocation()
  const { canUseNativePrompt, promptInstall, showIosAddToHomeHint } = usePwaInstall()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const closeMobileMenu = () => setMobileMenuOpen(false)

  useEffect(() => {
    closeMobileMenu()
  }, [location.pathname])

  useEffect(() => {
    if (!mobileMenuOpen) return
    const onResize = () => {
      if (typeof window !== 'undefined' && window.innerWidth > 768) closeMobileMenu()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [mobileMenuOpen])

  useEffect(() => {
    if (!mobileMenuOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [mobileMenuOpen])

  useEffect(() => {
    if (!mobileMenuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMobileMenu()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileMenuOpen])

  const closeSettings = () => {
    setSettingsOpen(false)
    setNewPassword('')
    setConfirmPassword('')
    setPasswordError(null)
  }

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError(null)
    if (newPassword.length < MIN_PASSWORD_LEN) {
      setPasswordError(`Паролата трябва да е поне ${MIN_PASSWORD_LEN} символа.`)
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Паролите не съвпадат.')
      return
    }
    setPasswordSaving(true)
    void updatePassword(newPassword)
      .then(() => {
        closeSettings()
        alert('Паролата е сменена успешно.')
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Грешка при смяна на парола.'
        setPasswordError(msg)
      })
      .finally(() => setPasswordSaving(false))
  }

  // Viewers виждат само ограничен набор от менюта
  const navItems = userRole === 'viewer' 
    ? [
        { path: '/', label: 'Начало', icon: Home },
        { path: '/announcements', label: 'Съобщения', icon: Megaphone },
        { path: '/units', label: 'Мои обекти', icon: Building2 },
        { path: '/obligations', label: 'Задължения', icon: CreditCard },
        { path: '/obligations-board', label: 'Табло задължения', icon: LayoutGrid },
        { path: '/finances', label: 'Финанси', icon: Wallet },
        { path: '/movements', label: 'Движения', icon: History },
        { path: '/documents', label: 'Документи', icon: FileText },
        { path: '/parking-lottery', label: 'Томбола паркоместа', icon: Dices },
      ]
    : [
        { path: '/', label: 'Начало', icon: Home },
        { path: '/announcements', label: 'Съобщения', icon: Megaphone },
        { path: '/units', label: 'Обекти', icon: Building2 },
        { path: '/users', label: 'Потребители', icon: Users },
        { path: '/obligations', label: 'Задължения', icon: CreditCard },
        { path: '/obligations-board', label: 'Табло задължения', icon: LayoutGrid },
        { path: '/finances', label: 'Финанси', icon: Wallet },
        { path: '/movements', label: 'Движения', icon: History },
        { path: '/documents', label: 'Документи', icon: FileText },
        { path: '/nomenclatures', label: 'Номенклатури', icon: Tags },
        { path: '/billing-periods', label: 'Периоди', icon: CalendarRange },
        { path: '/parking-lottery', label: 'Томбола паркоместа', icon: Dices },
      ]

  return (
    <div className="layout">
      <header className="layout-mobile-header">
        <button
          type="button"
          className="layout-mobile-menu-btn"
          onClick={() => setMobileMenuOpen((o) => !o)}
          aria-expanded={mobileMenuOpen}
          aria-controls="sidebar-nav"
          aria-label={mobileMenuOpen ? 'Затвори меню' : 'Отвори меню'}
        >
          {mobileMenuOpen ? <X size={22} strokeWidth={2.25} aria-hidden /> : <Menu size={22} strokeWidth={2.25} aria-hidden />}
        </button>
        <span className="layout-mobile-title">Домоуправител</span>
      </header>

      {mobileMenuOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Затвори меню"
          onClick={closeMobileMenu}
        />
      )}

      <aside className={`sidebar${mobileMenuOpen ? ' sidebar--open' : ''}`}>
        <div className="sidebar-header">
          <h1>Домоуправител</h1>
          <div className="user-info">
            <div className="user-email-row">
              <div className="user-email" title={user?.email ?? undefined}>
                {user?.email}
              </div>
              <button
                type="button"
                className="user-settings-btn"
                onClick={() => {
                  closeMobileMenu()
                  setSettingsOpen(true)
                }}
                aria-label="Настройки — смяна на парола"
                title="Настройки"
              >
                <Settings size={18} aria-hidden />
              </button>
            </div>
            <div className="user-role">{userRole === 'admin' ? 'Администратор' : userRole === 'editor' ? 'Редактор' : 'Преглед'}</div>
          </div>
          {canUseNativePrompt && (
            <button
              type="button"
              className="pwa-install-btn"
              onClick={() => {
                closeMobileMenu()
                void promptInstall()
              }}
            >
              <Download size={18} aria-hidden />
              <span>Инсталирай приложението</span>
            </button>
          )}
          {showIosAddToHomeHint && (
            <p className="pwa-ios-hint">
              За икона на началния екран: <strong>Share</strong> → <strong>Добави към началния екран</strong>.
            </p>
          )}
        </div>
        <nav className="sidebar-nav" id="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname === item.path
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={closeMobileMenu}
              >
                <Icon size={20} aria-hidden />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
        <button
          type="button"
          className="logout-btn"
          onClick={() => {
            closeMobileMenu()
            void signOut()
          }}
        >
          <LogOut size={20} />
          <span>Изход</span>
        </button>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>

      {settingsOpen && (
        <div
          className="layout-modal-overlay"
          role="presentation"
          onClick={closeSettings}
        >
          <div
            className="layout-modal"
            role="dialog"
            aria-labelledby="layout-settings-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="layout-settings-title">Настройки на акаунта</h2>
            <p className="layout-modal-lead">Смяна на парола за {user?.email}</p>
            <form onSubmit={handlePasswordSubmit}>
              <div className="layout-form-group">
                <label htmlFor="layout-new-password">Нова парола</label>
                <input
                  id="layout-new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={passwordSaving}
                  minLength={MIN_PASSWORD_LEN}
                />
              </div>
              <div className="layout-form-group">
                <label htmlFor="layout-confirm-password">Потвърди новата парола</label>
                <input
                  id="layout-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={passwordSaving}
                  minLength={MIN_PASSWORD_LEN}
                />
              </div>
              {passwordError && <p className="layout-modal-error">{passwordError}</p>}
              <div className="layout-modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={closeSettings}
                  disabled={passwordSaving}
                >
                  Отказ
                </button>
                <button type="submit" className="btn-primary" disabled={passwordSaving}>
                  {passwordSaving ? 'Запазване…' : 'Запази паролата'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

