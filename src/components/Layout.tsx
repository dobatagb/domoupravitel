import { Outlet, Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Home, Building2, TrendingDown, FileText, LogOut, CreditCard, Tags, CalendarRange, Users, LayoutGrid, History } from 'lucide-react'
import './Layout.css'

export default function Layout() {
  const { signOut, user, userRole } = useAuth()
  const location = useLocation()

  // Viewers виждат само ограничен набор от менюта
  const navItems = userRole === 'viewer' 
    ? [
        { path: '/', label: 'Начало', icon: Home },
        { path: '/units', label: 'Мои единици', icon: Building2 },
        { path: '/obligations', label: 'Задължения', icon: CreditCard },
        { path: '/obligations-board', label: 'Табло задължения', icon: LayoutGrid },
        { path: '/expenses', label: 'Разходи', icon: TrendingDown },
        { path: '/documents', label: 'Документи', icon: FileText },
      ]
    : [
        { path: '/', label: 'Начало', icon: Home },
        { path: '/units', label: 'Единици', icon: Building2 },
        { path: '/users', label: 'Потребители', icon: Users },
        { path: '/obligations', label: 'Задължения', icon: CreditCard },
        { path: '/obligations-board', label: 'Табло задължения', icon: LayoutGrid },
        { path: '/expenses', label: 'Разходи', icon: TrendingDown },
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

