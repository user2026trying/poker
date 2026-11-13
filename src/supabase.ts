// Lidhja me Supabase + tipet e të dhënave + funksione të vogla ndihmëse.
import { useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

/** false nëse skedari .env mungon, është bosh ose URL-ja nuk është e saktë */
export const isConfigured = Boolean(key && url && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url))

export const supabase = createClient(isConfigured ? url! : 'http://localhost', key || 'missing')

export type Profile = {
  id: string
  username: string
  role: 'player' | 'head_office'
  coins: number
  is_active: boolean
  last_seen_at: string | null
}

export type PokerTable = {
  id: string
  name: string
  max_seats: 2 | 6 | 9
  small_blind: number
  big_blind: number
  buy_in: number
  rake_percent: number
  rake_cap: number
  status: 'waiting' | 'playing'
  sort_order: number
  // Faza 2: gjendja e dorës
  hand_no: number
  stage: 'idle' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'
  dealer_seat: number | null
  sb_seat: number | null
  bb_seat: number | null
  board: number[]
  pot: number
  current_bet: number
  min_raise: number
  turn_seat: number | null
  turn_deadline: string | null
  action_seq: number
  next_hand_at: string | null
  last_result: { pot: number; rake: number; showdown: boolean } | null
}

export type Seat = {
  table_id: string
  seat_no: number
  player_id: string
  username: string
  stack: number
  in_hand: boolean
  bet_round: number
  bet_total: number
  folded: boolean
  all_in: boolean
  acted: boolean
  last_action: string | null
  shown_cards: number[] | null
  hand_name: string | null
  won: number
  sitting_out: boolean
  leaving: boolean
}

/** Përgjigjja e funksionit table_state: gjendja publike + vetëm kartat e mia. */
export type TableState = {
  now: string
  table: PokerTable | null
  seats: Seat[]
  my_cards: number[] | null
}

export type CoinTx = {
  id: number
  player_id: string
  amount: number
  balance_after: number
  kind: string
  note: string | null
  created_at: string
}

/** Lojtarët nuk kanë email; brenda sistemit username kthehet në një adresë teknike. */
export const usernameToEmail = (username: string) => `${username.trim().toLowerCase()}@poker.local`

/** 12500 -> "12,500" */
export const fmt = (n: number) => Number(n).toLocaleString('en-US')

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Ndodhi një gabim. Provo përsëri.')

/** Thërret një funksion të serverit (databazës). Hedh gabim me mesazhin e serverit. */
export async function rpc<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data as T
}

/**
 * Real-time: sa herë ndryshon njëra nga tabelat e dhëna, thirret `reload`.
 * Si rezervë (p.sh. pas shkëputjes së internetit) rifreskon edhe çdo 20 sekonda
 * dhe kur përdoruesi kthehet te faqja.
 */
export function useLive(tables: string[], reload: () => void) {
  const fn = useRef(reload)
  fn.current = reload
  const list = tables.join(',')
  useEffect(() => {
    // Disa ndryshime vijnë njëkohësisht (p.sh. pas një basti): rifreskojmë vetëm një herë.
    let pending: ReturnType<typeof setTimeout> | undefined
    const run = () => {
      clearTimeout(pending)
      pending = setTimeout(() => fn.current(), 60)
    }
    fn.current()
    const channel = supabase.channel(`live-${list}-${Math.random().toString(36).slice(2)}`)
    for (const table of list.split(',')) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, run)
    }
    channel.subscribe()
    const timer = setInterval(run, 20000)
    const onVisible = () => document.visibilityState === 'visible' && run()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', run)
    return () => {
      supabase.removeChannel(channel)
      clearTimeout(pending)
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', run)
    }
  }, [list])
}
