// Paneli i Head Office: Dashboard, Players, Create Player, Coins Management, Rake Settings.
import { useCallback, useState, type FormEvent, type ReactNode } from 'react'
import {
  errMsg, fmt, rpc, supabase, useLive,
  type CoinTx, type PokerTable, type Profile, type Seat,
} from '../supabase'
import { Avatar, Button, Coins, Logo, Modal, Notice } from '../ui'

type Stats = { total_players: number; online_players: number; total_coins: number; total_rake: number }
type Tab = 'Dashboard' | 'Players' | 'Create Player' | 'Coins Management' | 'Rake Settings'
const tabs: Tab[] = ['Dashboard', 'Players', 'Create Player', 'Coins Management', 'Rake Settings']
type Msg = { kind: 'ok' | 'error'; text: string } | null

const txLabels: Record<string, string> = {
  initial: 'Coins fillestare',
  admin_add: 'Shtim nga Head Office',
  admin_remove: 'Zbritje nga Head Office',
  buy_in: 'Buy-in',
  cash_out: 'Kthim nga tavolina',
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-ink-600 bg-ink-800 p-5 sm:p-6 ${className}`}>{children}</div>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-mist">{label}</span>
      {children}
    </label>
  )
}

/** Kthen numër të plotë pozitiv nga teksti i fushës, ose null nëse nuk është i vlefshëm. */
const toInt = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : null)

export default function HeadOffice({ profile }: { profile: Profile }) {
  const [tab, setTab] = useState<Tab>('Dashboard')
  const [stats, setStats] = useState<Stats | null>(null)
  const [players, setPlayers] = useState<Profile[]>([])
  const [seats, setSeats] = useState<Seat[]>([])
  const [tables, setTables] = useState<PokerTable[]>([])
  const [txs, setTxs] = useState<CoinTx[]>([])
  const [coinsFor, setCoinsFor] = useState('') // lojtari i parazgjedhur te Coins Management

  const load = useCallback(async () => {
    const [st, pl, se, ta, tx] = await Promise.all([
      rpc<Stats>('admin_dashboard').catch(() => null),
      supabase.from('profiles').select('*').eq('role', 'player').order('username'),
      supabase.from('table_seats').select('*'),
      supabase.from('poker_tables').select('*').order('max_seats').order('sort_order'),
      supabase.from('coin_transactions').select('*').order('id', { ascending: false }).limit(25),
    ])
    if (st) setStats(st)
    if (pl.data) setPlayers(pl.data as Profile[])
    if (se.data) setSeats(se.data as Seat[])
    if (ta.data) setTables(ta.data as PokerTable[])
    if (tx.data) setTxs(tx.data as CoinTx[])
  }, [])
  useLive(['profiles', 'table_seats', 'poker_tables'], load)

  return (
    <div className="min-h-full md:flex">
      {/* Menuja: anash në desktop, sipër në telefon */}
      <aside className="sticky top-0 z-30 border-b border-white/5 bg-ink-950/90 backdrop-blur-md md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-3 md:block md:px-5 md:py-6">
          <Logo />
          <div className="text-right text-[11px] uppercase tracking-widest text-gold-400 md:mt-2 md:text-left">
            Head Office
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:px-3">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`whitespace-nowrap rounded-xl px-3.5 py-2.5 text-left text-sm font-medium transition ${
                tab === t ? 'bg-gold-500/15 text-gold-300' : 'text-mist hover:bg-ink-800 hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
          <button
            onClick={() => supabase.auth.signOut()}
            className="whitespace-nowrap rounded-xl px-3.5 py-2.5 text-left text-sm font-medium text-red-300/80 hover:bg-red-500/10 md:mt-4"
          >
            Logout
          </button>
        </nav>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8">
        <div className="mx-auto max-w-4xl animate-rise" key={tab}>
          <div className="mb-6 flex items-end justify-between">
            <h1 className="font-display text-2xl font-bold">{tab}</h1>
            <span className="text-xs text-mist">{profile.username}</span>
          </div>

          {tab === 'Dashboard' && <Dashboard stats={stats} />}
          {tab === 'Players' && (
            <Players
              players={players}
              seats={seats}
              reload={load}
              openCoins={(id) => { setCoinsFor(id); setTab('Coins Management') }}
            />
          )}
          {tab === 'Create Player' && <CreatePlayer reload={load} />}
          {tab === 'Coins Management' && (
            <CoinsManagement key={coinsFor} players={players} txs={txs} reload={load} initial={coinsFor} />
          )}
          {tab === 'Rake Settings' && <RakeSettings tables={tables} stats={stats} reload={load} />}
        </div>
      </main>
    </div>
  )
}

function Dashboard({ stats }: { stats: Stats | null }) {
  const items = [
    { label: 'Total Players', value: stats?.total_players },
    { label: 'Online Players', value: stats?.online_players, dot: true },
    { label: 'Total Coins në qarkullim', value: stats?.total_coins, coin: true },
    { label: 'Total Rake i platformës', value: stats?.total_rake, coin: true },
  ]
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {items.map((it) => (
        <Card key={it.label}>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-mist">
            {it.dot && <span className="h-2 w-2 rounded-full bg-emerald-400" />}
            {it.label}
          </div>
          <div className="mt-3 font-display text-4xl font-bold tabular-nums text-white">
            {it.value === undefined ? '—' : it.coin ? <Coins value={it.value} className="!font-bold" /> : fmt(it.value)}
          </div>
        </Card>
      ))}
    </div>
  )
}

function Players({ players, seats, reload, openCoins }: {
  players: Profile[]; seats: Seat[]; reload: () => Promise<void>; openCoins: (id: string) => void
}) {
  const [edit, setEdit] = useState<Profile | null>(null)
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true)
    try {
      await fn()
      await reload()
      setMsg({ kind: 'ok', text: ok })
    } catch (e) {
      setMsg({ kind: 'error', text: errMsg(e) })
    }
    setBusy(false)
  }

  if (!players.length) return <Card><p className="text-sm text-mist">Nuk ka ende lojtarë. Krijo të parin te “Create Player”.</p></Card>

  return (
    <>
      <div className="mb-4"><Notice kind={msg?.kind ?? 'ok'}>{!edit && msg?.text}</Notice></div>
      <Card className="!p-0 overflow-hidden">
        <div className="hidden grid-cols-[1fr_9rem_7rem_11rem] gap-3 border-b border-white/5 px-5 py-3 text-[11px] font-medium uppercase tracking-wider text-mist sm:grid">
          <span>Username</span><span>Current Coins</span><span>Status</span><span className="text-right">Veprime</span>
        </div>
        {players.map((p) => {
          const seat = seats.find((s) => s.player_id === p.id)
          return (
            <div key={p.id} className="grid grid-cols-2 items-center gap-3 border-b border-white/5 px-5 py-3.5 last:border-0 sm:grid-cols-[1fr_9rem_7rem_11rem]">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={p.username} className="h-9 w-9 text-sm" />
                <span className="truncate font-medium">{p.username}</span>
              </div>
              <div className="text-right sm:text-left">
                <Coins value={p.coins} className="text-gold-300" />
                {seat && <div className="text-[11px] text-mist">+ {fmt(seat.stack)} në tavolinë</div>}
              </div>
              <div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ring-1 ${
                  p.is_active ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' : 'bg-red-500/15 text-red-300 ring-red-500/30'
                }`}>
                  {p.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" className="!px-3 !py-1.5" onClick={() => { setEdit(p); setPassword(''); setMsg(null) }}>
                  Edit
                </Button>
                <Button
                  variant={p.is_active ? 'danger' : 'ghost'}
                  className="!px-3 !py-1.5"
                  disabled={busy}
                  onClick={() => run(
                    () => rpc('admin_set_active', { p_player_id: p.id, p_active: !p.is_active }),
                    `${p.username} u ${p.is_active ? 'çaktivizua' : 'aktivizua'}.`,
                  )}
                >
                  {p.is_active ? 'Deactivate' : 'Activate'}
                </Button>
              </div>
            </div>
          )
        })}
      </Card>

      {edit && (
        <Modal title={`Edit · ${edit.username}`} onClose={() => setEdit(null)}>
          <div className="mb-4 flex items-center justify-between rounded-2xl bg-ink-900 p-4 text-sm">
            <span className="text-mist">Bilanci</span>
            <Coins value={players.find((p) => p.id === edit.id)?.coins ?? edit.coins} className="text-gold-300" />
          </div>
          <form
            className="space-y-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              run(() => rpc('admin_reset_password', { p_player_id: edit.id, p_password: password }), 'Password u ndryshua.')
                .then(() => setPassword(''))
            }}
          >
            <Field label="Password i ri (Reset Password)">
              <input className="input" type="text" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Notice kind={msg?.kind ?? 'ok'}>{msg?.text}</Notice>
            <Button type="submit" disabled={busy} className="w-full">Ruaj password-in</Button>
          </form>
          <div className="mt-3 flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={() => openCoins(edit.id)}>Ndrysho Coins</Button>
            <Button variant="ghost" className="flex-1" onClick={() => setEdit(null)}>Mbyll</Button>
          </div>
        </Modal>
      )}
    </>
  )
}

function CreatePlayer({ reload }: { reload: () => Promise<void> }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [coins, setCoins] = useState('1000')
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const amount = toInt(coins)
    if (amount === null) return setMsg({ kind: 'error', text: 'Starting Coins duhet të jetë numër i plotë (0 ose më shumë).' })
    setBusy(true)
    try {
      await rpc('admin_create_player', { p_username: username, p_password: password, p_coins: amount })
      await reload()
      setMsg({ kind: 'ok', text: `Llogaria “${username.trim().toLowerCase()}” u krijua me ${fmt(amount)} Coins.` })
      setUsername('')
      setPassword('')
    } catch (err) {
      setMsg({ kind: 'error', text: errMsg(err) })
    }
    setBusy(false)
  }

  return (
    <Card className="max-w-md">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Username">
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="off" required />
          <span className="mt-1 block text-xs text-ink-500">3–20 karaktere: shkronja, numra ose _</span>
        </Field>
        <Field label="Password">
          <input className="input" type="text" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} autoComplete="off" required />
          <span className="mt-1 block text-xs text-ink-500">Të paktën 6 karaktere</span>
        </Field>
        <Field label="Starting Coins">
          <input className="input" inputMode="numeric" value={coins} onChange={(e) => setCoins(e.target.value)} required />
        </Field>
        <Notice kind={msg?.kind ?? 'ok'}>{msg?.text}</Notice>
        <Button type="submit" disabled={busy} className="w-full !py-3">{busy ? 'Duke krijuar…' : 'Create Account'}</Button>
      </form>
    </Card>
  )
}

function CoinsManagement({ players, txs, reload, initial }: {
  players: Profile[]; txs: CoinTx[]; reload: () => Promise<void>; initial: string
}) {
  const [playerId, setPlayerId] = useState(initial)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)
  const player = players.find((p) => p.id === playerId)

  async function adjust(sign: 1 | -1) {
    const value = toInt(amount)
    if (!player) return setMsg({ kind: 'error', text: 'Zgjidh një lojtar.' })
    if (!value) return setMsg({ kind: 'error', text: 'Shkruaj një shumë më të madhe se 0.' })
    setBusy(true)
    try {
      const balance = await rpc<number>('admin_adjust_coins', { p_player_id: player.id, p_amount: sign * value, p_note: note })
      await reload()
      setMsg({ kind: 'ok', text: `${sign > 0 ? 'U shtuan' : 'U hoqën'} ${fmt(value)} Coins. Bilanci i ri i ${player.username}: ${fmt(balance)}.` })
      setAmount('')
      setNote('')
    } catch (e) {
      setMsg({ kind: 'error', text: errMsg(e) })
    }
    setBusy(false)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <div className="space-y-4">
          <Field label="Lojtari">
            <select className="input" value={playerId} onChange={(e) => { setPlayerId(e.target.value); setMsg(null) }}>
              <option value="">— Zgjidh lojtarin —</option>
              {players.map((p) => <option key={p.id} value={p.id}>{p.username}</option>)}
            </select>
          </Field>
          {player && (
            <div className="flex items-center justify-between rounded-2xl bg-ink-900 p-4 text-sm">
              <span className="text-mist">Bilanci aktual</span>
              <Coins value={player.coins} className="text-lg text-gold-300" />
            </div>
          )}
          <Field label="Shuma (Coins)">
            <input className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="p.sh. 5000" />
          </Field>
          <Field label="Shënim (opsional)">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} />
          </Field>
          <Notice kind={msg?.kind ?? 'ok'}>{msg?.text}</Notice>
          <div className="flex gap-3">
            <Button className="flex-1 !py-3" disabled={busy} onClick={() => adjust(1)}>+ Shto Coins</Button>
            <Button variant="danger" className="flex-1 !py-3" disabled={busy} onClick={() => adjust(-1)}>− Hiq Coins</Button>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-mist">Transaksionet e fundit</h2>
        {!txs.length && <p className="text-sm text-mist">Ende asnjë transaksion.</p>}
        <ul className="divide-y divide-white/5">
          {txs.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{players.find((p) => p.id === t.player_id)?.username ?? '—'}</div>
                <div className="truncate text-xs text-mist">
                  {txLabels[t.kind] ?? t.kind}{t.note ? ` · ${t.note}` : ''} · {new Date(t.created_at).toLocaleString('sq-AL', { dateStyle: 'short', timeStyle: 'short' })}
                </div>
              </div>
              <div className="text-right">
                <div className={`font-semibold tabular-nums ${t.amount > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  {t.amount > 0 ? '+' : '−'}{fmt(Math.abs(t.amount))}
                </div>
                <div className="text-xs tabular-nums text-mist">{fmt(t.balance_after)}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

function RakeSettings({ tables, stats, reload }: { tables: PokerTable[]; stats: Stats | null; reload: () => Promise<void> }) {
  const [draft, setDraft] = useState<Record<string, { percent: string; cap: string }>>({})
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)

  async function save(t: PokerTable) {
    const d = draft[t.id]
    const percent = Number(d.percent.replace(',', '.'))
    const cap = toInt(d.cap)
    if (!d.percent.trim() || Number.isNaN(percent) || cap === null) {
      return setMsg({ kind: 'error', text: 'Vendos vlera të vlefshme (p.sh. Rake 1 dhe Maximum 30).' })
    }
    setBusy(true)
    try {
      await rpc('admin_update_rake', { p_table_id: t.id, p_percent: percent, p_cap: cap })
      await reload()
      setDraft(({ [t.id]: _saved, ...rest }) => rest)
      setMsg({ kind: 'ok', text: `Rake për “${t.name}” u ruajt: ${percent}% · maksimumi ${fmt(cap)} Coins.` })
    } catch (e) {
      setMsg({ kind: 'error', text: errMsg(e) })
    }
    setBusy(false)
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <div className="text-xs font-medium uppercase tracking-wider text-mist">Bilanci i platformës (Rake)</div>
          <div className="mt-2 font-display text-3xl font-bold"><Coins value={stats?.total_rake ?? 0} className="!font-bold" /></div>
        </Card>
        <Card>
          <div className="text-xs font-medium uppercase tracking-wider text-mist">No Flop, No Drop</div>
          <div className="mt-2 flex items-center gap-2 font-display text-3xl font-bold text-emerald-300">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> Aktiv
          </div>
          <p className="mt-1 text-xs text-mist">Nuk merret Rake kur dora mbaron para Flop-it.</p>
        </Card>
      </div>
      <Notice kind={msg?.kind ?? 'ok'}>{msg?.text}</Notice>
      <Card className="!p-0 overflow-hidden">
        <div className="hidden grid-cols-[1fr_7rem_8rem_6rem] gap-3 border-b border-white/5 px-5 py-3 text-[11px] font-medium uppercase tracking-wider text-mist sm:grid">
          <span>Tavolina</span><span>Rake %</span><span>Maximum Rake</span><span />
        </div>
        {tables.map((t) => {
          const d = draft[t.id]
          const set = (patch: Partial<{ percent: string; cap: string }>) =>
            setDraft({ ...draft, [t.id]: { ...(d ?? { percent: String(t.rake_percent), cap: String(t.rake_cap) }), ...patch } })
          return (
            <div key={t.id} className="grid grid-cols-[1fr_1fr] items-center gap-3 border-b border-white/5 px-5 py-3 last:border-0 sm:grid-cols-[1fr_7rem_8rem_6rem]">
              <div className="col-span-2 sm:col-span-1">
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-mist">{t.max_seats} lojtarë · Blinds {fmt(t.small_blind)}/{fmt(t.big_blind)}</div>
              </div>
              <span className="-mb-2 text-[10px] uppercase tracking-wider text-mist sm:hidden">Rake %</span>
              <span className="-mb-2 text-[10px] uppercase tracking-wider text-mist sm:hidden">Maximum Rake</span>
              <input className="input !py-2" inputMode="decimal" aria-label="Rake %" value={d?.percent ?? String(t.rake_percent)} onChange={(e) => set({ percent: e.target.value })} />
              <input className="input !py-2" inputMode="numeric" aria-label="Maximum Rake" value={d?.cap ?? String(t.rake_cap)} onChange={(e) => set({ cap: e.target.value })} />
              <Button className="col-span-2 !py-2 sm:col-span-1" disabled={!d || busy} onClick={() => save(t)}>Ruaj</Button>
            </div>
          )
        })}
      </Card>
    </div>
  )
}
