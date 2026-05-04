'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'

type Tab = 'signup' | 'signin'

export default function AuthGateModal() {
  const [tab,      setTab]      = useState<Tab>('signup')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [error,    setError]    = useState<string | null>(null)
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      if (tab === 'signup') {
        if (password !== confirm) {
          setError("Passwords don't match")
          return
        }
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        const data = await res.json()
        if (!res.ok) { setError(data.error ?? 'Registration failed'); return }
      }

      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        setError('Invalid email or password')
      } else {
        // Session is now active — useViewGate will clear the gate
        window.location.reload()
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    padding: '10px 12px', borderRadius: 8,
    border: '0.5px solid #D4D1C3', background: '#FAFAF7',
    fontSize: 14, color: '#111111', outline: 'none',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.55)',
      backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: '#FFFFFF', borderRadius: 16,
        padding: '32px 28px', width: '100%', maxWidth: 380,
        margin: '0 16px',
        boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
      }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 11, fontWeight: 500, color: '#0601B4', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
            NYC Building Complaints
          </p>
          <h2 style={{ fontSize: 22, fontWeight: 500, color: '#111111', letterSpacing: '-0.02em', margin: '0 0 8px' }}>
            {tab === 'signup' ? 'Create a free account' : 'Welcome back'}
          </h2>
          <p style={{ fontSize: 14, color: '#6B6B65', lineHeight: 1.5, margin: 0 }}>
            {tab === 'signup'
              ? "You've used your 5 free building views. Create an account to keep exploring."
              : 'Sign in to continue researching buildings.'}
          </p>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, background: '#F5F3EA', borderRadius: 8, padding: 3, marginBottom: 20 }}>
          {(['signup', 'signin'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(null) }}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 6, border: 'none',
                fontSize: 13, fontWeight: 500, cursor: 'pointer',
                background: tab === t ? '#FFFFFF' : 'transparent',
                color: tab === t ? '#111111' : '#6B6B65',
                boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s',
              }}
            >
              {t === 'signup' ? 'Sign up' : 'Sign in'}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            style={inputStyle}
          />
          {tab === 'signup' && (
            <input
              type="password"
              placeholder="Confirm password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              style={inputStyle}
            />
          )}

          {error && (
            <p style={{ fontSize: 13, color: '#EF4637', margin: 0 }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '11px 0', borderRadius: 8, border: 'none',
              background: loading ? '#9B99E8' : '#0601B4',
              color: '#FFFFFF', fontSize: 14, fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer',
              letterSpacing: '-0.01em', marginTop: 4,
              transition: 'background 0.15s',
            }}
          >
            {loading ? 'Please wait…' : tab === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <p style={{ fontSize: 12, color: '#A5A39A', textAlign: 'center', marginTop: 20, marginBottom: 0, lineHeight: 1.5 }}>
          Your data is never shared or sold.
        </p>
      </div>
    </div>
  )
}
