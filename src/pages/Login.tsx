import { useState, type FormEvent } from 'react'
import { supabase, usernameToEmail } from '../supabase'
import { Button, Logo, Notice } from '../ui'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password })
    if (error) {
      setError(
        error.message.toLowerCase().includes('banned')
          ? 'Kjo llogari është çaktivizuar. Kontakto Head Office.'
          : error.status === 400
            ? 'Username ose password i gabuar.'
            : 'Nuk u arrit lidhja me serverin. Provo përsëri.',
      )
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-full place-items-center px-5 py-10">
      <div className="w-full max-w-sm animate-rise">
        <div className="mb-8 flex flex-col items-center gap-3">
          <Logo size="lg" />
          <p className="text-sm tracking-wide text-mist">Texas Hold’em · Private Club</p>
        </div>
        <form
          onSubmit={submit}
          className="space-y-4 rounded-3xl border border-ink-600 bg-ink-800/80 p-6 shadow-2xl shadow-black/50 backdrop-blur"
        >
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-mist">Username</span>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              required
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-mist">Password</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <Notice kind="error">{error}</Notice>
          <Button type="submit" disabled={busy} className="w-full !py-3 !text-base">
            {busy ? 'Duke hyrë…' : 'Login'}
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-ink-500">
          Llogaritë krijohen vetëm nga Head Office. Coins janë virtuale, pa vlerë monetare.
        </p>
      </div>
    </div>
  )
}
