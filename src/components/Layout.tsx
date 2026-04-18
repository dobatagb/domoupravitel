import { Outlet, Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Home, Building2, TrendingDown, FileText, LogOut, CreditCard, Tags, CalendarRange, Users, LayoutGrid, History, Download, Wallet, Megaphone } from 'lucide-react'
import { usePwaInstall } from '../hooks/usePwaInstall'
import './Layout.css'

export default function Layout() {
  const { signOut, user, userRole } = useAuth()
  const location = useLocation()
  const { canUseNativePrompt, promptInstall, showIosAddToHomeHint } = usePwaInstall()

  // Viewers виждат само ограничен набор от менюта
  const navItems = userRole === 'viewer' 
    ? [
        { path: '/', label: 'Начало', icon: Home },
        { path: '/announcements', label: 'Съобщения', icon: Megaphone },
        { path: '/units', label: 'Мои обекти', icon: Building2 },
        { path: '/obligations', label: 'Задължения', icon: CreditCard },
        { path: '/obligations-board', label: 'Табло задължения', icon: LayoutGrid },
        { path: '/expenses', label: 'Разходи', icon: TrendingDown },
        { path: '/finances', label: 'Финанси', icon: Wallet },
        { path: '/documents', label: 'Документи', icon: FileText },
      ]
    : [
        { path: '/', label: 'Начало', icon: Home },
        { path: '/announcements', label: 'Съобщения', icon: Megaphone },
        { path: '/units', label: 'Обекти', icon: Building2 },
        { path: '/users', label: 'Потребители', icon: Users },
        { path: '/obligations', label: 'Задължения', icon: CreditCard },
        { path: '/obligations-board', label: 'Табло задължения', icon: LayoutGrid },
        { path: '/expenses', label: 'Разходи', icon: TrendingDown },
        { path: '/finances', label: 'Финанси', icon: Wallet },
        { path: '/movements', label: 'Движения', icon: History },
        { path: '/documents', label: 'Документи', icon: FileText },
        { path: '/nomenclatures', label: 'Номенклатури', icon: Tags },
        { path: '/billing-periods', label: 'Периоди', icon: CalendarRange },
      ]

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>Домоуправител</h1>
          <div className="user-info">
            <div className="user-email">{user?.email}</div>
            <div className="user-role">{userRole === 'admin' ? 'Администратор' : userRole === 'editor' ? 'Редактор' : 'Преглед'}</div>
          </div>
          {canUseNativePrompt && (
            <button
              type="button"
              className="pwa-install-btn"
              onClick={() => void promptInstall()}
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
        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname === item.path
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`nav-item ${isActive ? 'active' : ''}`}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
        <button type="button" className="logout-btn" onClick={() => void signOut()}>
          <LogOut size={20} />
          <span>Изход</span>
        </button>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}

