import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Building2, TrendingUp, TrendingDown, FileText } from 'lucide-react'
import './Dashboard.css'

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalUnits: 0,
    totalIncome: 0,
    totalExpenses: 0,
    totalDocuments: 0,
  })

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      // Fetch units count
      const { count: unitsCount } = await supabase
        .from('units')
        .select('*', { count: 'exact', head: true })

      // Fetch total income
      const { data: incomeData } = await supabase
        .from('income')
        .select('amount')

      const totalIncome = incomeData?.reduce((sum, item) => sum + (item.amount || 0), 0) || 0

      // Fetch total expenses
      const { data: expensesData } = await supabase
        .from('expenses')
        .select('amount')

      const totalExpenses = expensesData?.reduce((sum, item) => sum + (item.amount || 0), 0) || 0

      // Fetch documents count
      const { count: docsCount } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true })

      setStats({
        totalUnits: unitsCount || 0,
        totalIncome,
        totalExpenses,
        totalDocuments: docsCount || 0,
      })
    } catch (error) {
      console.error('Error fetching stats:', error)
    }
  }

  const balance = stats.totalIncome - stats.totalExpenses

  return (
    <div className="dashboard">
      <h1>Начало</h1>
      <p className="dashboard-subtitle">Общ преглед на системата</p>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(37, 99, 235, 0.1)' }}>
            <Building2 size={24} color="var(--primary)" />
          </div>
          <div className="stat-content">
            <div className="stat-label">Единици</div>
            <div className="stat-value">{stats.totalUnits}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)' }}>
            <TrendingUp size={24} color="var(--success)" />
          </div>
          <div className="stat-content">
            <div className="stat-label">Приходи</div>
            <div className="stat-value">{stats.totalIncome.toFixed(2)} лв</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}>
            <TrendingDown size={24} color="var(--danger)" />
          </div>
          <div className="stat-content">
            <div className="stat-label">Разходи</div>
            <div className="stat-value">{stats.totalExpenses.toFixed(2)} лв</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(100, 116, 139, 0.1)' }}>
            <FileText size={24} color="var(--secondary)" />
          </div>
          <div className="stat-content">
            <div className="stat-label">Документи</div>
            <div className="stat-value">{stats.totalDocuments}</div>
          </div>
        </div>
      </div>

      <div className="balance-card">
        <h2>Баланс</h2>
        <div className={`balance-amount ${balance >= 0 ? 'positive' : 'negative'}`}>
          {balance >= 0 ? '+' : ''}{balance.toFixed(2)} лв
        </div>
        <p className="balance-description">
          {balance >= 0
            ? 'Положителен баланс'
            : 'Отрицателен баланс - необходими са допълнителни средства'}
        </p>
      </div>
    </div>
  )
}

