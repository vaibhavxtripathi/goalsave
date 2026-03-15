import { useState, useEffect, useRef } from 'react'
import {
  connectWallet, createVault, depositToVault,
  withdrawVault, breakVault,
  getVault, getOwnerVaults, getCurrentLedger,
  getVaultCount, ledgersToDays, CONTRACT_ID,
} from './lib/stellar'

const xlm = (s) => (Number(s) / 10_000_000).toFixed(2)
const short = (a) => a ? `${a.toString().slice(0, 4)}…${a.toString().slice(-4)}` : ''

// ── Days countdown ring ────────────────────────────────────────────────────
function CountdownRing({ daysLeft, daysTotal, size = 120 }) {
  const r = (size / 2) - 10
  const circ = 2 * Math.PI * r
  const pct = daysTotal > 0 ? Math.max(0, Math.min(1, daysLeft / daysTotal)) : 0
  const dash = pct * circ

  return (
    <svg width={size} height={size} className="ring-svg">
      <circle cx={size / 2} cy={size / 2} r={r}
        className="ring-track" strokeWidth="8" fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r}
        className="ring-fill" strokeWidth="8" fill="none"
        strokeDasharray={`${dash} ${circ}`}
        strokeDashoffset={circ * 0.25}
        style={{ transition: 'stroke-dasharray 0.8s ease' }}
      />
      <text x="50%" y="46%" textAnchor="middle" className="ring-num">{daysLeft}</text>
      <text x="50%" y="64%" textAnchor="middle" className="ring-label">days left</text>
    </svg>
  )
}

// ── Progress bar ───────────────────────────────────────────────────────────
function ProgressBar({ current, target }) {
  const pct = target > 0 ? Math.min(100, (Number(current) / Number(target)) * 100) : 0
  return (
    <div className="prog-wrap">
      <div className="prog-bar">
        <div className="prog-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="prog-labels">
        <span className="prog-cur">{xlm(current)} XLM saved</span>
        <span className="prog-pct">{pct.toFixed(0)}%</span>
        <span className="prog-tgt">goal: {xlm(target)} XLM</span>
      </div>
    </div>
  )
}

// ── Vault card ─────────────────────────────────────────────────────────────
function VaultCard({ vault, currentLedger, wallet, onAction }) {
  const [showDeposit, setShowDeposit] = useState(false)
  const [showBreak, setShowBreak]     = useState(false)
  const [depositAmt, setDepositAmt]   = useState('1')
  const [busy, setBusy] = useState(false)

  const ledgersLeft = Math.max(0, Number(vault.unlock_ledger) - currentLedger)
  const daysLeft    = ledgersToDays(ledgersLeft)
  const daysTotal   = ledgersToDays(
    Math.max(0, Number(vault.unlock_ledger) - Number(vault.created_ledger))
  )
  const matured  = currentLedger >= Number(vault.unlock_ledger)
  const isOwner  = wallet && vault.owner?.toString() === wallet
  const isLocked = vault.status === 'Locked'

  const statusLabel = {
    Locked:    matured ? 'MATURED ✓' : 'LOCKED',
    Withdrawn: 'WITHDRAWN',
    Broken:    'BROKEN',
  }[vault.status] || vault.status

  const handle = async (fn, msg) => {
    setBusy(true)
    try {
      const hash = await fn()
      onAction({ ok: true, msg, hash })
      setShowDeposit(false)
      setShowBreak(false)
    } catch (e) { onAction({ ok: false, msg: e.message }) }
    finally { setBusy(false) }
  }

  return (
    <div className={`vault-card ${vault.status === 'Broken' ? 'card-broken' : ''} ${matured && isLocked ? 'card-matured' : ''}`}>
      {/* Top row */}
      <div className="vc-top">
        <div className="vc-info">
          <div className="vc-id">VAULT #{vault.id?.toString()}</div>
          <div className="vc-name">{vault.goal_name}</div>
          <div className={`vc-status status-${vault.status?.toLowerCase()}`}>{statusLabel}</div>
        </div>
        {isLocked && !matured && (
          <CountdownRing daysLeft={daysLeft} daysTotal={daysTotal} />
        )}
        {matured && isLocked && (
          <div className="matured-badge">
            <span className="matured-icon">🎯</span>
            <span>READY</span>
          </div>
        )}
      </div>

      {/* Progress */}
      <ProgressBar current={vault.amount} target={vault.target_amount} />

      {/* Meta row */}
      <div className="vc-meta">
        <div className="vc-meta-item">
          <span className="vm-label">LOCKED</span>
          <span className="vm-val">{xlm(vault.amount)} XLM</span>
        </div>
        <div className="vc-meta-item">
          <span className="vm-label">UNLOCK LEDGER</span>
          <span className="vm-val mono">{vault.unlock_ledger?.toString()}</span>
        </div>
        {vault.penalty_paid > 0 && (
          <div className="vc-meta-item">
            <span className="vm-label">PENALTY PAID</span>
            <span className="vm-val penalty">{xlm(vault.penalty_paid)} XLM</span>
          </div>
        )}
      </div>

      {/* Actions */}
      {isOwner && isLocked && (
        <div className="vc-actions">
          {/* Deposit more */}
          {!matured && (
            <button className="btn-dep" onClick={() => { setShowDeposit(d => !d); setShowBreak(false) }}>
              + ADD FUNDS
            </button>
          )}

          {/* Withdraw if matured */}
          {matured && (
            <button className="btn-withdraw" disabled={busy}
              onClick={() => handle(() => withdrawVault(wallet, vault.id), 'Withdrawn successfully!')}>
              {busy ? 'SIGNING…' : 'WITHDRAW ALL'}
            </button>
          )}

          {/* Break early */}
          {!matured && (
            <button className="btn-break" onClick={() => { setShowBreak(b => !b); setShowDeposit(false) }}>
              BREAK EARLY
            </button>
          )}

          {/* Deposit panel */}
          {showDeposit && (
            <div className="action-panel">
              <div className="ap-label">Add XLM to this vault</div>
              <div className="ap-row">
                <input
                  type="number" min="0.1" step="0.1"
                  value={depositAmt}
                  onChange={e => setDepositAmt(e.target.value)}
                  className="ap-input"
                  disabled={busy}
                />
                <span className="ap-unit">XLM</span>
                <button className="btn-confirm-dep" disabled={busy}
                  onClick={() => handle(() => depositToVault(wallet, vault.id, parseFloat(depositAmt)), 'Deposit confirmed!')}>
                  {busy ? '…' : 'DEPOSIT'}
                </button>
              </div>
            </div>
          )}

          {/* Break early confirmation */}
          {showBreak && (
            <div className="action-panel action-panel-warn">
              <div className="ap-label warn-label">
                ⚠ Breaking early costs <strong>10% penalty</strong>.<br />
                You'll receive <strong>{(Number(vault.amount) * 0.9 / 10_000_000).toFixed(4)} XLM</strong> back.
              </div>
              <div className="ap-row">
                <button className="btn-break-confirm" disabled={busy}
                  onClick={() => handle(() => breakVault(wallet, vault.id), 'Vault broken — 10% penalty applied')}>
                  {busy ? 'SIGNING…' : 'CONFIRM BREAK'}
                </button>
                <button className="btn-break-cancel" onClick={() => setShowBreak(false)}>CANCEL</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Create vault form ──────────────────────────────────────────────────────
function CreateForm({ wallet, currentLedger, onCreated }) {
  const [goalName, setGoalName] = useState('')
  const [amount,   setAmount]   = useState('5')
  const [target,   setTarget]   = useState('100')
  const [days,     setDays]     = useState('30')
  const [busy, setBusy]  = useState(false)
  const [err,  setErr]   = useState('')

  // Approx ledgers from days
  const unlockLedger = currentLedger + Math.ceil(parseFloat(days || 1) * 86400 / 5)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!wallet) return
    setBusy(true); setErr('')
    try {
      const hash = await createVault(
        wallet, goalName,
        parseFloat(amount), parseFloat(target),
        unlockLedger
      )
      onCreated(hash)
      setGoalName(''); setAmount('5'); setTarget('100'); setDays('30')
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  const penalty = (parseFloat(amount || 0) * 0.1).toFixed(2)

  return (
    <form className="create-form" onSubmit={handleSubmit}>
      <div className="cf-title">NEW SAVINGS VAULT</div>

      <div className="cf-grid">
        <div className="cf-field cf-full">
          <label>WHAT ARE YOU SAVING FOR?</label>
          <input
            value={goalName}
            onChange={e => setGoalName(e.target.value)}
            placeholder="e.g. MacBook Pro, Emergency Fund, Trip to Japan…"
            maxLength={60}
            required disabled={!wallet || busy}
          />
        </div>

        <div className="cf-field">
          <label>INITIAL DEPOSIT (XLM)</label>
          <input type="number" min="0.1" step="0.1"
            value={amount} onChange={e => setAmount(e.target.value)}
            required disabled={!wallet || busy} />
        </div>

        <div className="cf-field">
          <label>SAVINGS TARGET (XLM)</label>
          <input type="number" min="0.1" step="0.1"
            value={target} onChange={e => setTarget(e.target.value)}
            required disabled={!wallet || busy} />
        </div>

        <div className="cf-field cf-full">
          <label>LOCK FOR (DAYS)</label>
          <input type="number" min="1" max="3650" step="1"
            value={days} onChange={e => setDays(e.target.value)}
            required disabled={!wallet || busy} />
          <span className="cf-hint">
            Unlocks at ledger ~{unlockLedger.toLocaleString()} · Early exit costs 10% ({penalty} XLM)
          </span>
        </div>
      </div>

      {/* Visual summary card */}
      <div className="cf-preview">
        <div className="cfp-row">
          <span>Locking</span><span className="cfp-val">{amount} XLM</span>
        </div>
        <div className="cfp-row">
          <span>Goal</span><span className="cfp-val">{target} XLM</span>
        </div>
        <div className="cfp-row">
          <span>Unlocks in</span><span className="cfp-val">{days} days</span>
        </div>
        <div className="cfp-row cfp-warn">
          <span>Early exit penalty</span><span className="cfp-val">{penalty} XLM (10%)</span>
        </div>
      </div>

      {err && <p className="cf-err">{err}</p>}

      <button type="submit" className="btn-create" disabled={!wallet || busy || !goalName}>
        {!wallet ? 'CONNECT WALLET FIRST' : busy ? 'LOCKING FUNDS…' : 'LOCK FUNDS ON STELLAR'}
      </button>
    </form>
  )
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [wallet,       setWallet]       = useState(null)
  const [tab,          setTab]          = useState('vaults')
  const [vaults,       setVaults]       = useState([])
  const [vaultCount,   setVaultCount]   = useState(0)
  const [currentLedger,setCurrentLedger]= useState(0)
  const [loading,      setLoading]      = useState(false)
  const [toast,        setToast]        = useState(null)

  useEffect(() => {
    getVaultCount().then(setVaultCount)
    getCurrentLedger().then(setCurrentLedger)
  }, [])

  const loadVaults = async (addr) => {
    setLoading(true)
    try {
      const ids = await getOwnerVaults(addr)
      const loaded = await Promise.allSettled(ids.map(id => getVault(id)))
      setVaults(loaded.filter(r => r.status === 'fulfilled').map(r => r.value).reverse())
    } catch {}
    setLoading(false)
  }

  const handleConnect = async () => {
    try {
      const addr = await connectWallet()
      setWallet(addr)
      loadVaults(addr)
    } catch (e) { showToast(false, e.message) }
  }

  const showToast = (ok, msg, hash) => {
    setToast({ ok, msg, hash })
    setTimeout(() => setToast(null), 6000)
    if (ok && wallet) {
      getCurrentLedger().then(setCurrentLedger)
      loadVaults(wallet)
    }
  }

  const handleAction = ({ ok, msg, hash }) => showToast(ok, msg, hash)
  const handleCreated = (hash) => {
    showToast(true, 'Vault created — funds locked on-chain!', hash)
    setTab('vaults')
  }

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="header">
        <div className="header-brand">
          <div className="logo">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect x="4" y="10" width="24" height="18" rx="3" stroke="currentColor" strokeWidth="2" fill="none"/>
              <path d="M10 10V8a6 6 0 0 1 12 0v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <circle cx="16" cy="19" r="3" fill="currentColor"/>
              <line x1="16" y1="22" x2="16" y2="25" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <div className="brand-name">GoalSave</div>
            <div className="brand-tag">On-chain savings vaults</div>
          </div>
        </div>

        <nav className="header-nav">
          <button className={`nav-btn ${tab === 'vaults' ? 'nav-active' : ''}`} onClick={() => setTab('vaults')}>
            MY VAULTS
          </button>
          <button className={`nav-btn ${tab === 'create' ? 'nav-active' : ''}`} onClick={() => setTab('create')}>
            + NEW VAULT
          </button>
        </nav>

        <div className="header-right">
          {wallet
            ? <div className="wallet-pill"><span className="wdot" />{short(wallet)}</div>
            : <button className="btn-connect" onClick={handleConnect}>CONNECT WALLET</button>
          }
        </div>
      </header>

      {/* ── Stats strip ── */}
      <div className="stats-strip">
        <div className="strip-stat">
          <span className="ss-n">{vaultCount}</span>
          <span className="ss-l">VAULTS CREATED</span>
        </div>
        <div className="strip-div" />
        <div className="strip-stat">
          <span className="ss-n">{currentLedger.toLocaleString()}</span>
          <span className="ss-l">CURRENT LEDGER</span>
        </div>
        <div className="strip-div" />
        <div className="strip-stat">
          <span className="ss-n">10%</span>
          <span className="ss-l">EARLY EXIT FEE</span>
        </div>
        <div className="strip-div" />
        <a
          className="strip-stat strip-link"
          href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`}
          target="_blank" rel="noreferrer"
        >
          <span className="ss-n">↗</span>
          <span className="ss-l">VIEW CONTRACT</span>
        </a>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div className={`toast ${toast.ok ? 'toast-ok' : 'toast-err'}`}>
          <span>{toast.msg}</span>
          {toast.hash && (
            <a href={`https://stellar.expert/explorer/testnet/tx/${toast.hash}`}
              target="_blank" rel="noreferrer" className="toast-link">VIEW TX ↗</a>
          )}
        </div>
      )}

      {/* ── Body ── */}
      <main className="body">
        {tab === 'create' && (
          <div className="page-wrap">
            <CreateForm wallet={wallet} currentLedger={currentLedger} onCreated={handleCreated} />
          </div>
        )}

        {tab === 'vaults' && (
          <div className="page-wrap">
            {!wallet ? (
              <div className="empty-state">
                <div className="empty-icon">🔒</div>
                <div className="empty-title">Connect your wallet to see your vaults</div>
                <p className="empty-sub">Your savings goals live on the Stellar blockchain — connect Freighter to access them.</p>
                <button className="btn-connect-lg" onClick={handleConnect}>Connect Freighter Wallet</button>
              </div>
            ) : loading ? (
              <div className="vault-grid">
                {[1,2,3].map(i => <div key={i} className="vault-skeleton" />)}
              </div>
            ) : vaults.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🎯</div>
                <div className="empty-title">No vaults yet</div>
                <p className="empty-sub">Create your first savings vault to start building financial discipline on-chain.</p>
                <button className="btn-connect-lg" onClick={() => setTab('create')}>Create First Vault</button>
              </div>
            ) : (
              <div className="vault-grid">
                {vaults.map(v => (
                  <VaultCard
                    key={v.id?.toString()}
                    vault={v}
                    currentLedger={currentLedger}
                    wallet={wallet}
                    onAction={handleAction}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="footer">
        <span>GoalSave · Stellar Testnet · Soroban Smart Contracts</span>
        <a href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`}
          target="_blank" rel="noreferrer">
          {CONTRACT_ID ? CONTRACT_ID.slice(0, 12) + '…' : 'deploy first'}
        </a>
      </footer>
    </div>
  )
}
