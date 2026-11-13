// Tavolina e Poker-it. Ky skedar vetëm SHFAQ gjendjen që vjen nga serveri dhe dërgon
// veprimet e lojtarit. Kartat, radha, bastet, fituesi dhe rake vendosen në server.
import { useCallback, useEffect, useRef, useState } from 'react'
import { errMsg, fmt, rpc, useLive, type Profile, type TableState } from '../supabase'
import { Avatar, Button, CoinIcon, Coins, Modal, Notice, TopBar } from '../ui'
import { StatusBadge } from './Lobby'

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
const SUITS = ['♠', '♥', '♦', '♣']
const TURN_MS = 25000
const stageNames: Record<string, string> = { preflop: 'Pre-Flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' }

const cardSizes = {
  sm: 'h-9 w-[26px] rounded-[4px] text-[11px]',
  md: 'h-[50px] w-9 rounded-md text-[15px] md:h-[72px] md:w-[52px] md:text-xl',
  lg: 'h-16 w-[46px] rounded-md text-xl md:h-[84px] md:w-[60px] md:text-2xl',
}

/** Një kartë. `card` = numri 0..51 nga serveri; null = karta e kthyer mbrapsht. */
function PlayingCard({ card, size = 'md', delay = 0, className = '' }: {
  card: number | null; size?: keyof typeof cardSizes; delay?: number; className?: string
}) {
  const base = `${cardSizes[size]} shrink-0 animate-deal select-none ${className}`
  const style = { animationDelay: `${delay}ms` }
  if (card === null) return <div className={`card-back ${base}`} style={style} />
  const suit = card % 4
  const red = suit === 1 || suit === 2
  return (
    <div className={`card-face relative overflow-hidden ${red ? 'text-[#c8102e]' : 'text-[#14161a]'} ${base}`} style={style}>
      {/* Indeksi lart majtas + simboli i madh poshtë djathtas, si te kartat e vërteta */}
      <div className="absolute left-[9%] top-[5%] flex flex-col items-center leading-none">
        <span className="text-[0.85em] font-extrabold tracking-tighter">{RANKS[Math.floor(card / 4)]}</span>
        <span className="text-[0.62em]">{SUITS[suit]}</span>
      </div>
      <span className="absolute bottom-[3%] right-[8%] text-[1.55em] leading-none">{SUITS[suit]}</span>
    </div>
  )
}

/** Pozicioni rreth tavolinës. i = 0 është gjithmonë poshtë në mes (lojtari vetë). */
function seatPosition(i: number, total: number, scale = 1) {
  const a = Math.PI / 2 + (i * 2 * Math.PI) / total
  const round = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 0.8)
  return { left: `${50 + 48 * scale * round(Math.cos(a))}%`, top: `${50 + 47 * scale * round(Math.sin(a))}%` }
}

function Chip({ label, className }: { label: string; className: string }) {
  return (
    <span className={`grid h-5 w-5 place-items-center rounded-full text-[9px] font-extrabold shadow-md ring-1 ring-black/40 ${className}`}>
      {label}
    </span>
  )
}

export default function TablePage({ profile, tableId }: { profile: Profile; tableId: string }) {
  const [state, setState] = useState<TableState | null>(null)
  const [confirmSeat, setConfirmSeat] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [raiseTo, setRaiseTo] = useState(0)
  const clockOffset = useRef(0) // ora e serverit minus ora e këtij kompjuteri
  const ticking = useRef(false)

  const load = useCallback(async () => {
    try {
      const s = await rpc<TableState>('table_state', { p_table_id: tableId })
      if (!s) return
      clockOffset.current = Date.parse(s.now) - Date.now()
      // Përgjigjet mund të vijnë jashtë radhe: mos e zëvendëso gjendjen me një më të vjetër.
      setState((old) => (old?.table && s.table && s.table.action_seq < old.table.action_seq ? old : s))
    } catch {
      /* problem rrjeti: mbajmë gjendjen e fundit, rifreskimi provon përsëri */
    }
  }, [tableId])
  useLive(['poker_tables', 'table_seats'], load)

  const table = state?.table ?? null
  const seats = state?.seats ?? []
  const betting = !!table && ['preflop', 'flop', 'turn', 'river'].includes(table.stage)

  // "Ora": kur skadon koha e një lojtari ose duhet të fillojë dora e re, i kërkojmë serverit
  // të veprojë. Serveri kontrollon vetë orën e tij, pra kjo thirrje nuk mund të keqpërdoret.
  useEffect(() => {
    if (!table) return
    const timer = setInterval(() => {
      const now = Date.now() + clockOffset.current
      const ready = seats.filter((s) => !s.sitting_out && !s.leaving && s.stack > 0).length >= 2
      const due = betting
        ? !!table.turn_deadline && now > Date.parse(table.turn_deadline) + 400
        : table.stage === 'showdown'
          ? !!table.next_hand_at && now > Date.parse(table.next_hand_at) + 200
          : ready
      if (due && !ticking.current) {
        ticking.current = true
        rpc('table_tick', { p_table_id: tableId }).then(load).catch(() => {}).finally(() => { ticking.current = false })
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [table, seats, betting, tableId, load])

  const mySeat = seats.find((s) => s.player_id === profile.id && !s.leaving)
  const myTurn = betting && !!mySeat && mySeat.in_hand && table!.turn_seat === mySeat.seat_no

  // Kufijtë e bastit për mua (serveri i kontrollon përsëri).
  const toCall = mySeat && table ? Math.max(table.current_bet - mySeat.bet_round, 0) : 0
  const maxTo = mySeat ? mySeat.bet_round + mySeat.stack : 0
  const minTo = table ? Math.min(table.current_bet + table.min_raise, maxTo) : 0
  const rivalsCanBet = seats.some((s) => s.in_hand && !s.folded && !s.all_in && s.player_id !== profile.id)
  const canRaise = myTurn && !mySeat!.acted && maxTo > table!.current_bet && rivalsCanBet

  // Kartat e përbashkëta hapen me ritëm, edhe kur serveri i dërgon të gjitha njëherësh
  // (p.sh. kur lojtarët janë All-in): Flop, pastaj Turn, pastaj River, me pauzë mes tyre.
  const boardLen = table?.board.length ?? 0
  const [visible, setVisible] = useState(0)
  const [resultShown, setResultShown] = useState(false)
  useEffect(() => {
    if (boardLen < visible) return setVisible(boardLen) // dorë e re
    if (boardLen === visible) return
    const runout = table?.stage === 'showdown' && visible >= 3
    const timer = setTimeout(
      () => setVisible(Math.min(visible < 3 ? 3 : visible + 1, boardLen)),
      runout ? 1700 : visible === 0 ? 500 : 700,
    )
    return () => clearTimeout(timer)
  }, [boardLen, visible, table?.stage])
  // Fituesi shfaqet vetëm pasi të jenë hapur të gjitha kartat.
  const revealed = visible >= boardLen
  const isShowdown = table?.stage === 'showdown'
  useEffect(() => {
    if (!isShowdown || !revealed) return setResultShown(false)
    const timer = setTimeout(() => setResultShown(true), 900)
    return () => clearTimeout(timer)
  }, [isShowdown, revealed])

  const seq = table?.action_seq
  useEffect(() => setRaiseTo(minTo), [seq]) // eslint-disable-line react-hooks/exhaustive-deps

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(errMsg(e))
    }
    await load()
    setBusy(false)
    setConfirmSeat(null)
  }
  const act = (action: string, amount: number | null = null) =>
    run(() => rpc('player_action', { p_table_id: tableId, p_action: action, p_amount: amount, p_seq: table!.action_seq }))

  function leave() {
    if (betting && mySeat?.in_hand && !mySeat.folded && !window.confirm('Je në mes të një dore. Nëse largohesh tani, dora jote bëhet Fold. Të vazhdoj?')) return
    run(() => rpc('leave_table'))
  }

  if (!state) return <div className="min-h-full"><TopBar profile={profile} /></div>
  if (!table) {
    return (
      <div className="min-h-full">
        <TopBar profile={profile} />
        <p className="p-10 text-center text-mist">
          Tavolina nuk u gjet. <a href="#/" className="text-gold-300">Kthehu në Lobby</a>
        </p>
      </div>
    )
  }

  const offset = mySeat ? mySeat.seat_no - 1 : 0 // lojtari e sheh veten gjithmonë poshtë
  const turnSeat = seats.find((s) => s.seat_no === table.turn_seat)
  const winners = resultShown ? seats.filter((s) => s.won > 0) : []
  const remaining = table.turn_deadline ? Math.max(Date.parse(table.turn_deadline) - Date.now() - clockOffset.current, 0) : 0
  const potNow = table.pot + toCall // pot-i pasi të paguaj unë
  const clamp = (v: number) => Math.min(Math.max(Math.round(v), minTo), maxTo)

  return (
    <div className="flex min-h-full flex-col">
      {/* Kreu kompakt: emri i tavolinës, bilanci, Largohu */}
      <header className="border-b border-white/5 bg-ink-950/80">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <a href="#/" aria-label="Lobby" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-ink-600 bg-ink-800 text-lg text-white/80 hover:text-white">←</a>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate font-display text-base font-bold sm:text-lg">{table.name}</h1>
                <span className="hidden sm:block"><StatusBadge table={table} count={seats.filter((s) => !s.leaving).length} /></span>
              </div>
              <div className="truncate text-[11px] text-mist">
                Blinds {fmt(table.small_blind)}/{fmt(table.big_blind)}
                {table.hand_no > 0 && ` · Dora #${table.hand_no}`}
                {stageNames[table.stage] && ` · ${stageNames[table.stage]}`}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="rounded-full border border-ink-600 bg-ink-800 px-3 py-1.5 text-sm">
              <Coins value={profile.coins} className="text-gold-300" />
            </div>
            {mySeat && <Button variant="danger" className="!px-3 !py-2" disabled={busy} onClick={leave}>Largohu</Button>}
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-10 pb-8 pt-12 sm:px-16">
        {/* Portret në telefon, horizontale në ekran të madh */}
        <div className="relative aspect-[10/14] w-[clamp(270px,calc((100dvh-330px)*0.714),340px)] max-w-full md:aspect-[2/1] md:w-[clamp(600px,calc((100dvh-330px)*2),860px)]">
          <div className="table-glow absolute -inset-[12%]" />
          <div className="rail absolute inset-0 rounded-[9999px] p-3 md:p-[18px]">
            <div className="inlay h-full w-full rounded-[9999px] p-[2px]">
              <div className="felt relative h-full w-full overflow-hidden rounded-[9999px]">
                <div className="stitch absolute inset-2.5 rounded-[9999px] md:inset-3.5" />
                <svg viewBox="0 0 24 24" className="absolute left-1/2 top-[45%] h-28 w-28 -translate-x-1/2 -translate-y-1/2 opacity-[0.07] md:top-1/2 md:h-40 md:w-40" fill="#000">
                  <path d="M12 2.5c3.2 4 7.5 5.8 7.5 10a4.2 4.2 0 0 1-6.6 3.4l.9 5.6h-3.6l.9-5.6a4.2 4.2 0 0 1-6.6-3.4c0-4.2 4.3-6 7.5-10z" />
                </svg>
              </div>
            </div>
          </div>

          {/* Qendra: Pot, kartat e përbashkëta, fituesi */}
          <div className="absolute left-1/2 top-[31%] -translate-x-1/2 -translate-y-1/2 text-center md:top-[27%]">
            <div className="whitespace-nowrap rounded-full bg-black/45 px-4 py-1.5 text-sm shadow-inner ring-1 ring-white/10">
              <span className="mr-2 text-[10px] uppercase tracking-widest text-white/60">Pot</span>
              <Coins value={table.pot} className="text-gold-300" />
            </div>
          </div>
          <div className="absolute left-1/2 top-[45%] flex -translate-x-1/2 -translate-y-1/2 gap-1 md:top-1/2 md:gap-1.5">
            {[0, 1, 2, 3, 4].map((i) =>
              i < visible && table.board[i] !== undefined ? (
                <PlayingCard key={`${table.hand_no}-${i}`} card={table.board[i]} delay={i < 3 ? i * 160 : 0} />
              ) : (
                <div key={i} className={`${cardSizes.md} border border-white/10 bg-black/15 shadow-inner`} />
              ),
            )}
          </div>
          <div className="absolute left-1/2 top-[60%] w-[62%] -translate-x-1/2 -translate-y-1/2 text-center md:top-[74%]">
            {winners.length > 0 ? (
              <div className="animate-pop space-y-0.5">
                {winners.map((w) => (
                  <div key={w.seat_no} className="text-sm font-semibold text-gold-300 drop-shadow">
                    {w.username} fiton {fmt(w.won)}
                    {w.hand_name && <span className="font-normal text-white/85"> · {w.hand_name}</span>}
                  </div>
                ))}
                {!!table.last_result?.rake && <div className="text-[10px] text-white/50">Rake {fmt(table.last_result.rake)}</div>}
              </div>
            ) : (
              table.stage === 'idle' && (
                <p className="text-xs leading-relaxed text-white/70">
                  Duke pritur lojtarë… ({seats.filter((s) => !s.sitting_out).length}/{table.max_seats})
                </p>
              )
            )}
          </div>

          {/* Bastet e raundit, para secilit lojtar */}
          {Array.from({ length: table.max_seats }, (_, i) => {
            const seat = seats.find((s) => s.seat_no === ((i + offset) % table.max_seats) + 1)
            if (!seat || seat.bet_round <= 0) return null
            return (
              <div
                key={`bet-${seat.seat_no}`}
                className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 animate-pop items-center gap-1 whitespace-nowrap rounded-full bg-black/55 py-0.5 pl-1 pr-2 text-[11px] font-semibold tabular-nums text-white"
                style={seatPosition(i, table.max_seats, i === 0 ? 0.5 : 0.6)}
              >
                <CoinIcon className="h-3.5 w-3.5" />
                {fmt(seat.bet_round)}
              </div>
            )
          })}

          {/* Vendet */}
          {Array.from({ length: table.max_seats }, (_, i) => {
            const seatNo = ((i + offset) % table.max_seats) + 1
            const seat = seats.find((s) => s.seat_no === seatNo)
            const pos = seatPosition(i, table.max_seats)
            if (!seat) {
              return (
                <div key={seatNo} className="absolute -translate-x-1/2 -translate-y-1/2" style={pos}>
                  <button
                    disabled={!!mySeat || busy}
                    onClick={() => setConfirmSeat(seatNo)}
                    className="grid h-12 w-12 place-items-center rounded-full border border-dashed border-white/25 bg-ink-900/80 text-[10px] font-semibold uppercase tracking-wider text-white/60 transition enabled:hover:border-gold-400 enabled:hover:text-gold-300 disabled:opacity-40 md:h-14 md:w-14"
                  >
                    {mySeat ? 'Bosh' : 'Ulu'}
                  </button>
                </div>
              )
            }
            const me = seat.player_id === profile.id
            const won = resultShown ? seat.won : 0 // fitimi shfaqet pasi hapen kartat
            const isTurn = betting && table.turn_seat === seatNo
            const live = seat.in_hand && !seat.folded
            const faceUp = me && seat.in_hand ? state.my_cards : seat.shown_cards
            const out = seat.leaving || seat.sitting_out || (table.stage !== 'idle' && !live)
            const label = seat.leaving ? 'U largua' : seat.sitting_out ? 'Larg' : seat.last_action
            return (
              <div key={seatNo} className={`absolute -translate-x-1/2 -translate-y-1/2 ${isTurn ? 'z-20' : 'z-[5]'}`} style={pos}>
                <div className={`relative flex w-[76px] flex-col items-center md:w-24 ${out && !faceUp ? 'opacity-50' : ''}`}>
                  <div className="relative">
                    <Avatar
                      name={seat.username}
                      className={`h-12 w-12 text-lg md:h-14 md:w-14 ${isTurn ? 'animate-glow' : won > 0 ? '!ring-emerald-400' : me ? '!ring-gold-400' : ''}`}
                    />
                    {/* Kartat: të miat (ose në showdown) të hapura mbi avatar; të kundërshtarit mbrapsht */}
                    {faceUp ? (
                      <div className={`absolute bottom-1 left-1/2 flex -translate-x-1/2 gap-0.5 ${seat.folded ? 'opacity-45' : ''}`}>
                        <PlayingCard card={faceUp[0]} size={me ? 'lg' : 'md'} className="-rotate-3" />
                        <PlayingCard card={faceUp[1]} size={me ? 'lg' : 'md'} delay={90} className="rotate-3" />
                      </div>
                    ) : (
                      live && betting && (
                        <div className="absolute -bottom-1 -right-5 flex">
                          <PlayingCard card={null} size="sm" className="-rotate-6" />
                          <PlayingCard card={null} size="sm" delay={90} className="-ml-3.5 rotate-6" />
                        </div>
                      )
                    )}
                    <div className={`absolute top-0 flex flex-col gap-0.5 ${faceUp ? (me ? '-left-9 md:-left-11' : '-left-7 md:-left-9') : '-left-3'}`}>
                      {table.dealer_seat === seatNo && table.stage !== 'idle' && <Chip label="D" className="bg-white text-ink-950" />}
                      {table.sb_seat === seatNo && <Chip label="SB" className="bg-sky-500 text-white" />}
                      {table.bb_seat === seatNo && <Chip label="BB" className="bg-amber-500 text-ink-950" />}
                    </div>
                  </div>
                  <div className={`relative z-10 -mt-2 w-full overflow-hidden rounded-lg border bg-ink-900/95 px-1.5 py-1 text-center shadow-lg ${isTurn ? 'border-gold-400' : won > 0 ? 'border-emerald-400/70' : me ? 'border-gold-500/60' : 'border-ink-600'}`}>
                    <div className="truncate text-[11px] font-medium text-white">{seat.username}</div>
                    <div className="text-[11px] font-semibold tabular-nums text-gold-300">
                      {seat.all_in && live && !resultShown ? 'ALL-IN' : fmt(seat.stack - seat.won + won)}
                    </div>
                    {isTurn && (
                      <div
                        key={table.action_seq}
                        className="absolute bottom-0 left-0 h-[3px] bg-gold-400"
                        style={{ width: `${(remaining / TURN_MS) * 100}%`, animation: `shrink ${remaining}ms linear forwards` }}
                      />
                    )}
                  </div>
                  {won > 0 ? (
                    <div className={`absolute ${faceUp ? '-top-10 md:-top-14' : '-top-5'} z-20 animate-pop whitespace-nowrap rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-ink-950 shadow`}>
                      +{fmt(won)}
                    </div>
                  ) : (
                    label && !isTurn && (
                      <div className={`absolute ${faceUp ? '-top-10 md:-top-14' : '-top-5'} whitespace-nowrap rounded-full bg-ink-950/90 px-2 py-0.5 text-[10px] font-semibold text-white/85 ring-1 ring-white/10`}>
                        {label}
                      </div>
                    )
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </main>

      {/* Paneli i veprimeve */}
      <footer className="sticky bottom-0 z-30 border-t border-white/5 bg-ink-950/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto max-w-xl space-y-2.5">
          <Notice kind="error">{error}</Notice>
          {myTurn ? (
            <>
              {canRaise && minTo < maxTo && (
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      className="bet-slider flex-1"
                      min={minTo}
                      max={maxTo}
                      step={1}
                      value={raiseTo}
                      onChange={(e) => setRaiseTo(Number(e.target.value))}
                    />
                    <input
                      className="input !w-24 !px-2 !py-1.5 text-center tabular-nums"
                      inputMode="numeric"
                      value={raiseTo}
                      onChange={(e) => setRaiseTo(Number(e.target.value.replace(/\D/g, '')) || 0)}
                      onBlur={() => setRaiseTo(clamp(raiseTo))}
                    />
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {([['Min', minTo], ['½ Pot', table.current_bet + potNow / 2], ['Pot', table.current_bet + potNow], ['Max', maxTo]] as const).map(([name, v]) => (
                      <button
                        key={name}
                        onClick={() => setRaiseTo(clamp(v))}
                        className="rounded-lg border border-ink-600 bg-ink-800 py-1.5 text-xs font-semibold text-white/80 hover:border-gold-500/60"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <Button variant="danger" className="!py-3.5 !text-base" disabled={busy} onClick={() => act('fold')}>Fold</Button>
                {toCall > 0 ? (
                  <Button variant="ghost" className="!py-3.5 !text-base" disabled={busy} onClick={() => act('call')}>
                    {toCall >= mySeat!.stack ? `All-in ${fmt(mySeat!.stack)}` : `Call ${fmt(toCall)}`}
                  </Button>
                ) : (
                  <Button variant="ghost" className="!py-3.5 !text-base" disabled={busy} onClick={() => act('check')}>Check</Button>
                )}
                {canRaise ? (
                  <Button
                    className="!py-3.5 !text-base"
                    disabled={busy || raiseTo < minTo || raiseTo > maxTo}
                    onClick={() => (raiseTo >= maxTo ? act('allin') : act('raise', raiseTo))}
                  >
                    {raiseTo >= maxTo ? `All-in ${fmt(maxTo)}` : `${table.current_bet === 0 ? 'Bet' : 'Raise'} ${fmt(raiseTo)}`}
                  </Button>
                ) : (
                  <div />
                )}
              </div>
            </>
          ) : mySeat?.sitting_out ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-mist">Je shënuar “larg tavolinës”. Pas 5 minutash vendi lirohet.</span>
              <Button disabled={busy} onClick={() => run(() => rpc('sit_in'))}>Jam kthyer</Button>
            </div>
          ) : (
            <p className="py-2 text-center text-sm text-mist">
              {!mySeat
                ? 'Po shikon tavolinën. Kliko një vend bosh për t’u ulur.'
                : betting && turnSeat
                  ? mySeat.in_hand && !mySeat.folded
                    ? `Radha e ${turnSeat.username}…`
                    : mySeat.in_hand
                      ? 'Ke bërë Fold. Prit dorën tjetër.'
                      : 'Hyn në lojë në dorën tjetër.'
                  : table.stage === 'showdown'
                    ? 'Dora tjetër fillon pas pak…'
                    : 'Loja fillon sapo të ulen 2 lojtarë.'}
            </p>
          )}
        </div>
      </footer>

      {confirmSeat !== null && (
        <Modal title={`Ulu në vendin ${confirmSeat}`} onClose={() => !busy && setConfirmSeat(null)}>
          <div className="space-y-2 rounded-2xl bg-ink-900 p-4 text-sm">
            <div className="flex justify-between"><span className="text-mist">Buy-in</span><Coins value={table.buy_in} className="text-gold-300" /></div>
            <div className="flex justify-between"><span className="text-mist">Bilanci yt</span><Coins value={profile.coins} /></div>
            <div className="flex justify-between border-t border-white/5 pt-2">
              <span className="text-mist">Bilanci pas uljes</span>
              <Coins value={Math.max(profile.coins - table.buy_in, 0)} />
            </div>
          </div>
          {profile.coins < table.buy_in && (
            <p className="mt-3 text-sm text-red-300">Nuk ke Coins të mjaftueshme për këtë tavolinë.</p>
          )}
          <p className="mt-3 text-xs text-mist">Kur largohesh nga tavolina, Stack-u i mbetur kthehet në bilancin tënd.</p>
          <div className="mt-5 flex gap-3">
            <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => setConfirmSeat(null)}>Anulo</Button>
            <Button
              className="flex-1"
              disabled={busy || profile.coins < table.buy_in}
              onClick={() => run(() => rpc('join_table', { p_table_id: table.id, p_seat: confirmSeat }))}
            >
              {busy ? 'Duke u ulur…' : 'Konfirmo'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

