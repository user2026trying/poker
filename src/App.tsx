// Pika qendrore: vendos cilën faqe të shfaqë (Login, Lobby, Tavolinë ose Head Office).
import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isConfigured, rpc, supabase, useLive, type Profile } from './supabase'
import { Logo } from './ui'
import Login from './pages/Login'
import Lobby from './pages/Lobby'
import TablePage from './pages/TablePage'
import HeadOffice from './pages/HeadOffice'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined) // undefined = duke u ngarkuar
  const [hash, setHash] = useState(window.location.hash)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => {
      data.subscription.unsubscribe()
      window.removeEventListener('hashchange', onHash)
    }
  }, [])

  if (!isConfigured) return <SetupNeeded />
  if (session === undefined) return <Splash />
  if (!session) return <Login />
  return <Signed key={session.user.id} userId={session.user.id} hash={hash} />
}

function Signed({ userId, hash }: { userId: string; hash: string }) {
  const [profile, setProfile] = useState<Profile | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (error) return // problem rrjeti: mbajmë gjendjen e fundit
    if (!data || !data.is_active) {
      await supabase.auth.signOut() // llogari e çaktivizuar ose pa profil
      return
    }
    setProfile(data as Profile)
  }, [userId])

  useLive(['profiles'], load) // bilanci përditësohet live

  // "Jam online" çdo 30 sekonda
  useEffect(() => {
    const beat = () => rpc('heartbeat').catch(() => {})
    beat()
    const timer = setInterval(beat, 30000)
    return () => clearInterval(timer)
  }, [])

  if (!profile) return <Splash />
  if (profile.role === 'head_office') return <HeadOffice profile={profile} />

  const tableId = hash.match(/^#\/table\/([0-9a-f-]{36})$/)?.[1]
  return tableId ? <TablePage profile={profile} tableId={tableId} /> : <Lobby profile={profile} />
}

function Splash() {
  return (
    <div className="grid h-full place-items-center">
      <div className="animate-pulse"><Logo size="lg" /></div>
    </div>
  )
}

function SetupNeeded() {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-md rounded-3xl border border-ink-600 bg-ink-800 p-8 text-center">
        <div className="mb-5 flex justify-center"><Logo size="lg" /></div>
        <h1 className="font-display text-xl font-bold">Mungon lidhja me Supabase</h1>
        <p className="mt-3 text-sm leading-relaxed text-mist">
          Krijo skedarin <code className="text-gold-300">.env</code> në folderin e projektit me{' '}
          <code className="text-gold-300">VITE_SUPABASE_URL</code> dhe{' '}
          <code className="text-gold-300">VITE_SUPABASE_ANON_KEY</code>, pastaj ndale dhe nise përsëri{' '}
          <code className="text-gold-300">npm run dev</code>. Hapat janë te skedari UDHEZIME.md.
        </p>
      </div>
    </div>
  )
}
