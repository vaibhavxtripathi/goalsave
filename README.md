# GoalSave

Lock XLM into a time-bound savings vault on the Stellar blockchain. Set a goal name, deposit amount, savings target, and unlock date. The contract enforces discipline — withdraw early and pay a 10% penalty. Wait until maturity and claim everything back.

## Live Links

| | |
|---|---|
| **Frontend** | `https://goalsave.vercel.app` |
| **GitHub** | `https://github.com/YOUR_USERNAME/goalsave` |
| **Contract** | `https://stellar.expert/explorer/testnet/contract/CONTRACT_ID` |
| **Proof TX** | `https://stellar.expert/explorer/testnet/tx/TX_HASH` |

## How It Works

1. **Create** a vault — name your goal, deposit XLM, set a target and unlock date
2. **Top up** the vault any time before maturity
3. **Wait** until the unlock ledger passes
4. **Withdraw** the full amount — or break early and lose 10%

## Contract Functions

```rust
create_vault(owner, goal_name, amount, target_amount, unlock_ledger, xlm_token) -> u64
deposit(owner, vault_id, amount, xlm_token)
withdraw(owner, vault_id, xlm_token)        // only after unlock_ledger
break_vault(owner, vault_id, xlm_token)     // 10% penalty, anytime before unlock
get_vault(vault_id) -> Vault
get_owner_vaults(owner) -> Vec<u64>
```

## Stack

| Layer | Tech |
|---|---|
| Contract | Rust + Soroban SDK v22 |
| Network | Stellar Testnet |
| Frontend | React 18 + Vite |
| Wallet | Freighter v1.7.1 |
| Hosting | Vercel |

## Run Locally

```bash
chmod +x scripts/deploy.sh && ./scripts/deploy.sh
cd frontend && npm install && npm run dev
```
