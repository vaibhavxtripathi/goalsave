#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Env, String, token,
};

// ── Constants ──────────────────────────────────────────────────────────────
// Early withdrawal penalty: 10% burned (sent to a burn address)
const PENALTY_BPS: i128 = 1000; // 10% in basis points
const BPS_DENOM:   i128 = 10_000;

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum VaultStatus {
    Locked,
    Unlocked,   // matured — ready to withdraw
    Withdrawn,  // funds claimed
    Broken,     // early withdrawal, penalty applied
}

#[contracttype]
#[derive(Clone)]
pub struct Vault {
    pub id: u64,
    pub owner: Address,
    pub goal_name: String,
    pub amount: i128,           // current amount in stroops
    pub target_amount: i128,    // savings target
    pub unlock_ledger: u32,     // ledger at which vault matures
    pub created_ledger: u32,
    pub status: VaultStatus,
    pub penalty_paid: i128,     // how much was lost on early exit
}

#[contracttype]
pub enum DataKey {
    Vault(u64),
    OwnerVaults(Address),
    Count,
}

#[contract]
pub struct GoalSaveContract;

#[contractimpl]
impl GoalSaveContract {
    /// Create a vault and lock XLM until `unlock_ledger`
    pub fn create_vault(
        env: Env,
        owner: Address,
        goal_name: String,
        amount: i128,
        target_amount: i128,
        unlock_ledger: u32,
        xlm_token: Address,
    ) -> u64 {
        owner.require_auth();
        assert!(amount > 0, "Amount must be positive");
        assert!(target_amount > 0, "Target must be positive");
        assert!(goal_name.len() <= 60, "Goal name too long");
        assert!(
            unlock_ledger > env.ledger().sequence(),
            "Unlock ledger must be in the future"
        );

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&owner, &env.current_contract_address(), &amount);

        let count: u64 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
        let id = count + 1;

        let vault = Vault {
            id,
            owner: owner.clone(),
            goal_name,
            amount,
            target_amount,
            unlock_ledger,
            created_ledger: env.ledger().sequence(),
            status: VaultStatus::Locked,
            penalty_paid: 0,
        };

        env.storage().persistent().set(&DataKey::Vault(id), &vault);
        env.storage().instance().set(&DataKey::Count, &id);

        // Track owner's vault IDs
        let mut owner_vaults: soroban_sdk::Vec<u64> = env
            .storage().persistent()
            .get(&DataKey::OwnerVaults(owner.clone()))
            .unwrap_or(soroban_sdk::Vec::new(&env));
        owner_vaults.push_back(id);
        env.storage().persistent().set(&DataKey::OwnerVaults(owner), &owner_vaults);

        env.events().publish((symbol_short!("created"),), (id, amount, unlock_ledger));
        id
    }

    /// Top up an existing locked vault
    pub fn deposit(
        env: Env,
        owner: Address,
        vault_id: u64,
        amount: i128,
        xlm_token: Address,
    ) {
        owner.require_auth();
        assert!(amount > 0, "Amount must be positive");

        let mut vault: Vault = env.storage().persistent()
            .get(&DataKey::Vault(vault_id)).expect("Vault not found");

        assert!(vault.owner == owner, "Not your vault");
        assert!(vault.status == VaultStatus::Locked, "Vault is not locked");

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&owner, &env.current_contract_address(), &amount);

        vault.amount += amount;
        env.storage().persistent().set(&DataKey::Vault(vault_id), &vault);
        env.events().publish((symbol_short!("deposit"),), (vault_id, amount));
    }

    /// Withdraw after maturity — full amount returned
    pub fn withdraw(
        env: Env,
        owner: Address,
        vault_id: u64,
        xlm_token: Address,
    ) {
        owner.require_auth();

        let mut vault: Vault = env.storage().persistent()
            .get(&DataKey::Vault(vault_id)).expect("Vault not found");

        assert!(vault.owner == owner, "Not your vault");
        assert!(vault.status == VaultStatus::Locked, "Vault already withdrawn");
        assert!(
            env.ledger().sequence() >= vault.unlock_ledger,
            "Vault still locked — too early"
        );

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&env.current_contract_address(), &owner, &vault.amount);

        vault.status = VaultStatus::Withdrawn;
        env.storage().persistent().set(&DataKey::Vault(vault_id), &vault);
        env.events().publish((symbol_short!("withdrawn"),), (vault_id, vault.amount));
    }

    /// Break vault early — 10% penalty applied, remainder returned
    pub fn break_vault(
        env: Env,
        owner: Address,
        vault_id: u64,
        xlm_token: Address,
    ) {
        owner.require_auth();

        let mut vault: Vault = env.storage().persistent()
            .get(&DataKey::Vault(vault_id)).expect("Vault not found");

        assert!(vault.owner == owner, "Not your vault");
        assert!(vault.status == VaultStatus::Locked, "Vault already closed");
        assert!(
            env.ledger().sequence() < vault.unlock_ledger,
            "Vault already matured — use withdraw()"
        );

        let penalty = (vault.amount * PENALTY_BPS) / BPS_DENOM;
        let payout  = vault.amount - penalty;

        let token_client = token::Client::new(&env, &xlm_token);
        // Return remainder to owner (penalty stays in contract as protocol fee)
        token_client.transfer(&env.current_contract_address(), &owner, &payout);

        vault.status       = VaultStatus::Broken;
        vault.penalty_paid = penalty;
        vault.amount       = payout;
        env.storage().persistent().set(&DataKey::Vault(vault_id), &vault);
        env.events().publish((symbol_short!("broken"),), (vault_id, payout, penalty));
    }

    // ── Read ────────────────────────────────────────────────────────────────
    pub fn get_vault(env: Env, vault_id: u64) -> Vault {
        env.storage().persistent()
            .get(&DataKey::Vault(vault_id)).expect("Vault not found")
    }

    pub fn get_owner_vaults(env: Env, owner: Address) -> soroban_sdk::Vec<u64> {
        env.storage().persistent()
            .get(&DataKey::OwnerVaults(owner))
            .unwrap_or(soroban_sdk::Vec::new(&env))
    }

    pub fn count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Count).unwrap_or(0)
    }

    pub fn ledger_to_unlock(env: Env) -> u32 {
        env.ledger().sequence()
    }
}
