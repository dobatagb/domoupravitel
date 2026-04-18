import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Units from './pages/Units'
import Obligations from './pages/Obligations'
import ObligationsBoard from './pages/ObligationsBoard'
import Expenses from './pages/Expenses'
import Income from './pages/Income'
import Finances from './pages/Finances'
import Documents from './pages/Documents'
import Nomenclatures from './pages/Nomenclatures'
import BillingPeriods from './pages/BillingPeriods'
import Movements from './pages/Movements'
import UserManagement from './pages/UserManagement'
import Announcements from './pages/Announcements'
import Layout from './components/Layout'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div>Зареждане...</div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="units" element={<Units />} />
        <Route path="obligations" element={<Obligations />} />
        <Route path="obligations-board" element={<ObligationsBoard />} />
        <Route path="income" element={<Income />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="finances" element={<Finances />} />
        <Route path="documents" element={<Documents />} />
        <Route path="nomenclatures" element={<Nomenclatures />} />
        <Route path="billing-periods" element={<BillingPeriods />} />
        <Route path="movements" element={<Movements />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="announcements" element={<Announcements />} />
      </Route>
    </Routes>
  )
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AuthProvider>
  )
}

export default App

