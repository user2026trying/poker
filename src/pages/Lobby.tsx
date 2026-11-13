import { useCallback, useState } from 'react'
import { fmt, supabase, useLive, type PokerTable, type Profile, type Seat } from '../supabase'
import { Coins, TopBar } from '../ui'

const categories = [
  { seats: 2, title: 'Heads Up', sub: '2 Player Table', text: 'Duel një kundër një. Lojë e shpejtë dhe agresive.', glow: 'from-gold-500/25' },
  { seats: 6, title: 'Short Handed', sub: '6 Player Table', text: 'Më shumë aksion, më shumë duar të luajtura.', glow: 'from-felt-400/30' },
  { seats: 9, title: 'Full Ring', sub: '9 Player Table', text: 'Tavolina klasike. Durim dhe strategji.', glow: 'from-sky-500/20' },
] as const

/** Tavolinë e vogël ilustruese me pikat e vendeve (të zëna = të arta). */
function MiniTable({ seats, taken = [] }: { seats: number; taken?: number[] }) {
  return (
    <div className="relative mx-auto h-20 w-36">
      <div className="rail absolute inset-2 rounded-[50%] p-1">
        <div className="felt h-full w-full rounded-[50%]" />
      </div>
      {Array.from({ length: seats }, (_, i) => {
        const a = Math.PI / 2 + (i * 2 * Math.PI) / seats
        const on = taken.includes(i + 1)
        return (
          <span
            key={i}
            className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-ink-900 ${on ? 'bg-gold-400' : 'bg-ink-500'}`}
            style={{ left: `${50 + 47 * Math.cos(a)}%`, top: `${50 + 44 * Math.sin(a)}%` }}
          />
        )
      })}
    </div>
  )
}

export function StatusBadge({ table, count }: { table: PokerTable; count: number }) {
  const status = count >= table.max_seats ? 'Full' : table.status === 'playing' ? 'Playing' : 'Waiting'
  const style = {
    Full: 'bg-red-500/15 text-red-300 ring-red-500/30',
    Playing: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    Waiting: 'bg-gold-500/15 text-gold-300 ring-gold-500/30',
  }[status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ring-1 ${style}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  )
}

export default function Lobby({ profile }: { profile: Profile }) {
  const [tables, setTables] = useState<PokerTable[]>([])
  const [seats, setSeats] = useState<Seat[]>([])
  const [category, setCategory] = useState<number | null>(null)

  const load = useCallback(async () => {
    const [t, s] = await Promise.all([
      supabase.from('poker_tables').select('*').order('sort_order'),
      supabase.from('table_seats').select('*'),
    ])
    if (t.data) setTables(t.data as PokerTable[])
    if (s.data) setSeats((s.data as Seat[]).filter((x) => !x.leaving))
  }, [])
  useLive(['poker_tables', 'table_seats'], load)

  const mySeat = seats.find((s) => s.player_id === profile.id)
  const myTable = mySeat && tables.find((t) => t.id === mySeat.table_id)
  const playersIn = (n: number) => seats.filter((s) => tables.find((t) => t.id === s.table_id)?.max_seats === n).length
  const active = categories.find((c) => c.seats === category)

  return (
    <div className="min-h-full pb-12">
      <TopBar profile={profile} />
      <main className="mx-auto max-w-6xl px-4 pt-6">
        {myTable && mySeat && (
          <a
            href={`#/table/${myTable.id}`}
            className="mb-6 flex animate-rise items-center justify-between gap-3 rounded-2xl border border-gold-500/40 bg-gold-500/10 px-4 py-3"
          >
            <div className="text-sm">
              <div className="font-semibold text-gold-300">Je i ulur te “{myTable.name}”</div>
              <div className="text-mist">Stack: {fmt(mySeat.stack)} Coins</div>
            </div>
            <span className="rounded-lg bg-gold-400 px-3 py-1.5 text-sm font-semibold text-ink-950">Kthehu →</span>
          </a>
        )}

        {!active ? (
          <>
            <h1 className="font-display text-2xl font-bold sm:text-3xl">Zgjidh tavolinën</h1>
            <p className="mt-1 text-sm text-mist">Texas Hold’em · No Limit</p>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {categories.map((c, i) => (
                <button
                  key={c.seats}
                  onClick={() => setCategory(c.seats)}
                  style={{ animationDelay: `${i * 70}ms` }}
                  className="group relative animate-rise overflow-hidden rounded-3xl border border-ink-600 bg-ink-800 p-6 text-left transition hover:-translate-y-1 hover:border-gold-500/50"
                >
                  <div className={`pointer-events-none absolute inset-0 bg-gradient-to-b ${c.glow} to-transparent opacity-70`} />
                  <div className="relative">
                    <MiniTable seats={c.seats} />
                    <div className="mt-5 text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-400">{c.sub}</div>
                    <div className="mt-1 font-display text-2xl font-bold text-white">{c.title}</div>
                    <p className="mt-2 min-h-[2.9rem] text-sm leading-relaxed text-mist">{c.text}</p>
                    <div className="mt-5 flex items-center justify-between border-t border-white/5 pt-4 text-sm">
                      <span className="text-mist">
                        {tables.filter((t) => t.max_seats === c.seats).length} tavolina · {playersIn(c.seats)} lojtarë
                      </span>
                      <span className="font-semibold text-gold-300 transition group-hover:translate-x-1">Hap →</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <button onClick={() => setCategory(null)} className="text-sm text-mist hover:text-white">
              ← Të gjitha kategoritë
            </button>
            <h1 className="mt-2 font-display text-2xl font-bold sm:text-3xl">{active.title}</h1>
            <p className="mt-1 text-sm text-mist">{active.sub}</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {tables
                .filter((t) => t.max_seats === category)
                .map((t, i) => {
                  const here = seats.filter((s) => s.table_id === t.id)
                  const full = here.length >= t.max_seats
                  const mine = mySeat?.table_id === t.id
                  return (
                    <div
                      key={t.id}
                      style={{ animationDelay: `${i * 60}ms` }}
                      className="animate-rise rounded-3xl border border-ink-600 bg-ink-800 p-5"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-display text-lg font-bold">{t.name}</div>
                          <div className="text-sm text-mist">
                            {here.length} / {t.max_seats} lojtarë
                          </div>
                        </div>
                        <StatusBadge table={t} count={here.length} />
                      </div>
                      <div className="my-4"><MiniTable seats={t.max_seats} taken={here.map((s) => s.seat_no)} /></div>
                      <dl className="grid grid-cols-3 gap-2 rounded-2xl bg-ink-900 p-3 text-center">
                        <div>
                          <dt className="text-[10px] uppercase tracking-wider text-mist">Buy-in</dt>
                          <dd className="mt-0.5 text-sm"><Coins value={t.buy_in} className="text-gold-300" /></dd>
                        </div>
                        <div>
                          <dt className="text-[10px] uppercase tracking-wider text-mist">Small Blind</dt>
                          <dd className="mt-0.5 text-sm font-semibold tabular-nums">{fmt(t.small_blind)}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] uppercase tracking-wider text-mist">Big Blind</dt>
                          <dd className="mt-0.5 text-sm font-semibold tabular-nums">{fmt(t.big_blind)}</dd>
                        </div>
                      </dl>
                      {full && !mine ? (
                        <div className="mt-4 rounded-xl border border-ink-600 py-2.5 text-center text-sm font-semibold text-ink-500">
                          Tavolina është plot
                        </div>
                      ) : (
                        <a
                          href={`#/table/${t.id}`}
                          className="mt-4 block rounded-xl bg-gradient-to-b from-gold-300 to-gold-500 py-2.5 text-center text-sm font-semibold text-ink-950 transition hover:brightness-110"
                        >
                          {mine ? 'Kthehu në tavolinë' : 'Hap tavolinën'}
                        </a>
                      )}
                    </div>
                  )
                })}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
