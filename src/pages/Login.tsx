import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Building2 } from 'lucide-react'
import './Login.css'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn, user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  // Redirect if already logged in
  useEffect(() => {
    if (!authLoading && user) {
      navigate('/', { replace: true })
    }
  }, [user, authLoading, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await signIn(email, password)
      // After successful sign in, navigate to dashboard
      navigate('/', { replace: true })
    } catch (err: any) {
      console.error('Auth error:', err)
      const errorMessage = err.message || err.error_description || 'Грешка при вход'
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  // Show loading if auth is being checked
  if (authLoading) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div style={{ textAlign: 'center', padding: '2rem' }}>Зареждане...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <Building2 size={48} color="var(--primary)" />
          <h1>Ален Мак 22</h1>
          <p>Система за управление</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="error-message">{error}</div>}

          <div className="form-group">
            <label htmlFor="email">Имейл</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="ваш@имейл.com"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Парола</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              minLength={6}
            />
          </div>

          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? 'Зареждане...' : 'Вход'}
          </button>
        </form>
      </div>
    </div>
  )
}

