// Elementet e përbashkëta vizuale: logo, butona, Coins, avatar, modal, shiriti i sipërm.
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { fmt, supabase, type Profile } from './supabase'

export function Logo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const lg = size === 'lg'
  return (
    <div className="flex items-center gap-2.5 select-none">
      <div
        className={`${lg ? 'h-14 w-14 rounded-2xl' : 'h-9 w-9 rounded-xl'} grid place-items-center bg-gradient-to-br from-gold-300 to-gold-600 shadow-lg shadow-gold-600/20`}
      >
        <svg viewBox="0 0 24 24" className={lg ? 'h-8 w-8' : 'h-5 w-5'} fill="#0b0f15">
          <path d="M12 2.5c3.2 4 7.5 5.8 7.5 10a4.2 4.2 0 0 1-6.6 3.4l.9 5.6h-3.6l.9-5.6a4.2 4.2 0 0 1-6.6-3.4c0-4.2 4.3-6 7.5-10z" />
        </svg>
      </div>
      <span className={`font-display font-extrabold tracking-[0.18em] text-white ${lg ? 'text-3xl' : 'text-lg'}`}>
        POKER
      </span>
    </div>
  )
}

export function CoinIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className}>
      <circle cx="10" cy="10" r="9" fill="#d0a74a" />
      <circle cx="10" cy="10" r="6.2" fill="none" stroke="#7a5c1c" strokeWidth="1.2" strokeDasharray="2.2 1.6" />
      <circle cx="10" cy="10" r="3" fill="#f0d589" />
    </svg>
  )
}

export function Coins({ value, className = '' }: { value: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold tabular-nums ${className}`}>
      <CoinIcon />
      {fmt(value)}
    </span>
  )
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'gold' | 'ghost' | 'danger' }

export function Button({ variant = 'gold', className = '', ...props }: BtnProps) {
  const styles = {
    gold: 'bg-gradient-to-b from-gold-300 to-gold-500 text-ink-950 hover:brightness-110 shadow-lg shadow-gold-600/20',
    ghost: 'border border-ink-600 bg-ink-800 text-white hover:border-ink-500 hover:bg-ink-700',
    danger: 'border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20',
  }[variant]
  return (
    <button
      {...props}
      className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 ${styles} ${className}`}
    />
  )
}

const avatarColors = ['#b4552d', '#2d6cb4', '#7a3fb0', '#2d9c8f', '#b03f6b', '#5a7d2a', '#b08a2d', '#4a55c2']

export function Avatar({ name, className = 'h-12 w-12 text-lg' }: { name: string; className?: string }) {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const color = avatarColors[hash % avatarColors.length]
  return (
    <div
      className={`grid shrink-0 place-items-center rounded-full font-display font-bold uppercase text-white ring-2 ring-black/40 ${className}`}
      style={{ background: `radial-gradient(circle at 30% 25%, ${color}, #0b0f15 130%)` }}
    >
      {name.slice(0, 1)}
    </div>
  )
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-black/70 backdrop-blur-sm sm:place-items-center"
      onClick={onClose}
    >
      <div
        className="w-full animate-rise rounded-t-3xl border border-ink-600 bg-ink-800 p-6 shadow-2xl sm:max-w-md sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 font-display text-xl font-bold text-white">{title}</h3>
        {children}
      </div>
    </div>
  )
}

export function Notice({ kind, children }: { kind: 'error' | 'ok'; children: ReactNode }) {
  if (!children) return null
  return (
    <div
      className={`animate-pop rounded-xl border px-4 py-3 text-sm ${
        kind === 'error'
          ? 'border-red-500/30 bg-red-500/10 text-red-200'
          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
      }`}
    >
      {children}
    </div>
  )
}

/** Shiriti i sipërm i lojtarit: logo, username, bilanci, Logout. */
export function TopBar({ profile }: { profile: Profile }) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-ink-950/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <a href="#/"><Logo /></a>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2.5 rounded-full border border-ink-600 bg-ink-800 py-1 pl-1 pr-3.5">
            <Avatar name={profile.username} className="h-8 w-8 text-sm" />
            <div className="leading-tight">
              <div className="max-w-24 truncate text-xs text-mist sm:max-w-40">{profile.username}</div>
              <Coins value={profile.coins} className="text-sm text-gold-300" />
            </div>
          </div>
          <Button variant="ghost" className="!px-3" onClick={() => supabase.auth.signOut()}>
            Logout
          </Button>
        </div>
      </div>
    </header>
  )
}
