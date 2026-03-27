import * as StellarSdk from '@stellar/stellar-sdk'
import { isConnected, getPublicKey, signTransaction } from '@stellar/freighter-api'

const CONTRACT_ID = (import.meta.env.VITE_CONTRACT_ID || '').trim()
const XLM_TOKEN   = (import.meta.env.VITE_XLM_TOKEN || '').trim()
const NET         = (import.meta.env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015').trim()
const RPC_URL     = (import.meta.env.VITE_SOROBAN_RPC_URL    || 'https://soroban-testnet.stellar.org').trim()
const DUMMY       = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN'

export const rpc = new StellarSdk.rpc.Server(RPC_URL)

// ── Wallet ─────────────────────────────────────────────────────────────────
export async function connectWallet() {
  if (!(await isConnected())) throw new Error('Freighter not installed.')
  return await getPublicKey()
}

// ── Core TX builder ────────────────────────────────────────────────────────
async function sendTx(publicKey, op) {
  const account = await rpc.getAccount(publicKey)
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NET,
  })
    .addOperation(op)
    .setTimeout(60)
    .build()

  const sim = await rpc.simulateTransaction(tx)
  if (StellarSdk.rpc.Api.isSimulationError(sim)) throw new Error(sim.error)

  const prepared = StellarSdk.rpc.assembleTransaction(tx, sim).build()
  const signedXdr = await signTransaction(prepared.toXDR(), { networkPassphrase: NET, network: 'TESTNET' })
  const signed = StellarSdk.TransactionBuilder.fromXDR(signedXdr, NET)
  const sent = await rpc.sendTransaction(signed)

  return await pollTx(sent.hash)
}

async function pollTx(hash) {
  for (let i = 0; i < 30; i++) {
    const r = await rpc.getTransaction(hash)
    if (r.status === 'SUCCESS') return hash
    if (r.status === 'FAILED')  throw new Error('Transaction failed on-chain')
    await new Promise(res => setTimeout(res, 2000))
  }
  throw new Error('Transaction timed out')
}

// ── Read-only sim helper ───────────────────────────────────────────────────
async function readContract(op) {
  const dummy = new StellarSdk.Account(DUMMY, '0')
  const tx = new StellarSdk.TransactionBuilder(dummy, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NET,
  }).addOperation(op).setTimeout(30).build()

  const sim = await rpc.simulateTransaction(tx)
  return StellarSdk.scValToNative(sim.result.retval)
}

// ── Approve XLM allowance ──────────────────────────────────────────────────
async function approveXlm(publicKey, stroops) {
  const xlm = new StellarSdk.Contract(XLM_TOKEN)
  return sendTx(publicKey, xlm.call(
    'approve',
    StellarSdk.Address.fromString(publicKey).toScVal(),
    StellarSdk.Address.fromString(CONTRACT_ID).toScVal(),
    new StellarSdk.XdrLargeInt('i128', BigInt(stroops)).toI128(),
    StellarSdk.xdr.ScVal.scvU32(3_110_400),
  ))
}

// ── Create vault ───────────────────────────────────────────────────────────
export async function createVault(owner, goalName, amountXlm, targetXlm, unlockLedger) {
  const amountStroops = Math.ceil(amountXlm * 10_000_000)
  const targetStroops = Math.ceil(targetXlm * 10_000_000)

  await approveXlm(owner, amountStroops)

  const tc = new StellarSdk.Contract(CONTRACT_ID)
  const hash = await sendTx(owner, tc.call(
    'create_vault',
    StellarSdk.Address.fromString(owner).toScVal(),
    StellarSdk.xdr.ScVal.scvString(goalName),
    new StellarSdk.XdrLargeInt('i128', BigInt(amountStroops)).toI128(),
    new StellarSdk.XdrLargeInt('i128', BigInt(targetStroops)).toI128(),
    StellarSdk.xdr.ScVal.scvU32(unlockLedger),
    StellarSdk.Address.fromString(XLM_TOKEN).toScVal(),
  ))
  return hash
}

// ── Deposit into vault ─────────────────────────────────────────────────────
export async function depositToVault(owner, vaultId, amountXlm) {
  const stroops = Math.ceil(amountXlm * 10_000_000)
  await approveXlm(owner, stroops)

  const tc = new StellarSdk.Contract(CONTRACT_ID)
  return sendTx(owner, tc.call(
    'deposit',
    StellarSdk.Address.fromString(owner).toScVal(),
    StellarSdk.xdr.ScVal.scvU64(new StellarSdk.xdr.Uint64(BigInt(vaultId))),
    new StellarSdk.XdrLargeInt('i128', BigInt(stroops)).toI128(),
    StellarSdk.Address.fromString(XLM_TOKEN).toScVal(),
  ))
}

// ── Withdraw (matured) ─────────────────────────────────────────────────────
export async function withdrawVault(owner, vaultId) {
  const tc = new StellarSdk.Contract(CONTRACT_ID)
  return sendTx(owner, tc.call(
    'withdraw',
    StellarSdk.Address.fromString(owner).toScVal(),
    StellarSdk.xdr.ScVal.scvU64(new StellarSdk.xdr.Uint64(BigInt(vaultId))),
    StellarSdk.Address.fromString(XLM_TOKEN).toScVal(),
  ))
}

// ── Break vault early ──────────────────────────────────────────────────────
export async function breakVault(owner, vaultId) {
  const tc = new StellarSdk.Contract(CONTRACT_ID)
  return sendTx(owner, tc.call(
    'break_vault',
    StellarSdk.Address.fromString(owner).toScVal(),
    StellarSdk.xdr.ScVal.scvU64(new StellarSdk.xdr.Uint64(BigInt(vaultId))),
    StellarSdk.Address.fromString(XLM_TOKEN).toScVal(),
  ))
}

// ── Reads ──────────────────────────────────────────────────────────────────
export async function getVault(vaultId) {
  const tc = new StellarSdk.Contract(CONTRACT_ID)
  return readContract(tc.call(
    'get_vault',
    StellarSdk.xdr.ScVal.scvU64(new StellarSdk.xdr.Uint64(BigInt(vaultId)))
  ))
}

export async function getOwnerVaults(owner) {
  const tc = new StellarSdk.Contract(CONTRACT_ID)
  try {
    const ids = await readContract(tc.call(
      'get_owner_vaults',
      StellarSdk.Address.fromString(owner).toScVal(),
    ))
    return Array.isArray(ids) ? ids.map(Number) : []
  } catch { return [] }
}

export async function getCurrentLedger() {
  const tc = new StellarSdk.Contract(CONTRACT_ID)
  try {
    const n = await readContract(tc.call('ledger_to_unlock'))
    return Number(n)
  } catch { return 0 }
}

export async function getVaultCount() {
  const tc = new StellarSdk.Contract(CONTRACT_ID)
  try {
    const n = await readContract(tc.call('count'))
    return Number(n)
  } catch { return 0 }
}

// ── Helpers ────────────────────────────────────────────────────────────────
// Convert ledgers-remaining to approximate days (5s per ledger)
export function ledgersToDays(ledgers) {
  return Math.max(0, Math.round((ledgers * 5) / 86400))
}

export { CONTRACT_ID }


