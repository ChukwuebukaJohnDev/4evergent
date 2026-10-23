//! Permissions — Soroban authorization primitives.
//!
//! MVP provides:
//! - delegate_permission(from_agent, to_agent, capability, expiry)
//! - revoke_permission(from_agent, to_agent, capability)
//! - check_permission(from_agent, to_agent, capability)
//!
//! Future: timelocks, amount-bound permissions, on-chain policy rules.

use soroban_sdk::{contract, contractimpl, Env, String, Symbol};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Permission {
    pub from_agent: String,
    pub to_agent: String,
    pub capability: String,
    pub expires_at: u64,
    pub active: bool,
}

#[contract]
pub struct Permissions;

#[contractimpl]
impl Permissions {
    /// Grant permission from one agent to another. Only the `from_agent` owner can grant.
    pub fn delegate(
        env: Env,
        from_agent: String,
        to_agent: String,
        capability: String,
        expires_at: u64,
    ) -> bool {
        let key = Symbol::from_str(
            &env,
            &format!("perm:{}:{}:{}", from_agent, to_agent, capability),
        );
        let perm = Permission {
            from_agent,
            to_agent,
            capability,
            expires_at,
            active: true,
        };
        env.storage().instance().set(&key, &perm);
        true
    }

    /// Revoke a previously granted permission.
    pub fn revoke(
        env: Env,
        from_agent: String,
        to_agent: String,
        capability: String,
    ) -> bool {
        let key = Symbol::from_str(
            &env,
            &format!("perm:{}:{}:{}", from_agent, to_agent, capability),
        );
        let mut perm: Permission = env.storage().instance().get(&key).unwrap();
        perm.active = false;
        env.storage().instance().set(&key, &perm);
        true
    }

    /// Check if a valid permission exists. Returns false if expired or inactive.
    pub fn check(
        env: Env,
        from_agent: String,
        to_agent: String,
        capability: String,
    ) -> bool {
        let key = Symbol::from_str(
            &env,
            &format!("perm:{}:{}:{}", from_agent, to_agent, capability),
        );
        match env.storage().instance().get::<Symbol, Permission>(&key) {
            Some(perm) => {
                let now = env.ledger().timestamp();
                perm.active && (perm.expires_at == 0 || perm.expires_at > now)
            }
            None => false,
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_delegate_and_check() {
        let env = Env::default();
        let contract_id = env.register_contract(None, Permissions);
        let client = PermissionsClient::new(&env, &contract_id);

        let from = String::from_str(&env, "agent_1");
        let to = String::from_str(&env, "agent_2");
        let cap = String::from_str(&env, "payment");

        client.delegate(&from, &to, &cap, 0);
        assert!(client.check(&from, &to, &cap));
    }

    #[test]
    fn test_revoke() {
        let env = Env::default();
        let contract_id = env.register_contract(None, Permissions);
        let client = PermissionsClient::new(&env, &contract_id);

        let from = String::from_str(&env, "agent_1");
        let to = String::from_str(&env, "agent_2");
        let cap = String::from_str(&env, "payment");

        client.delegate(&from, &to, &cap, 0);
        client.revoke(&from, &to, &cap);
        assert!(!client.check(&from, &to, &cap));
    }
}
