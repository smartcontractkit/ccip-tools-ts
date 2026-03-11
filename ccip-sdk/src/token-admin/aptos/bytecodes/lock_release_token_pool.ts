/**
 * LockReleaseTokenPool Move package source files.
 *
 * Source: chainlink-aptos contracts/ccip/ccip_token_pools/lock_release_token_pool
 * AptosFramework rev: 16beac69835f3a71564c96164a606a23f259099a
 * ChainlinkCCIP + MCMS: embedded as local dependencies
 *
 * For standard Aptos Fungible Asset tokens using lock/release (custody-based) mechanism.
 * Tokens are locked in the pool on outbound and released on inbound.
 *
 * Vendored as source (not compiled bytecodes) because Aptos Move modules
 * must be compiled with the deployer's address at deploy time.
 *
 * Lazy-loaded via dynamic import() — same pattern as EVM BurnMintERC20 bytecode.
 */

export const LOCK_RELEASE_POOL_MOVE_TOML = `[package]
name = "LockReleaseTokenPool"
version = "1.0.0"
authors = []

[addresses]
ccip = "_"
ccip_token_pool = "_"
lock_release_token_pool = "_"
mcms = "_"
mcms_register_entrypoints = "_"
lock_release_local_token = "_"

[dependencies]
AptosFramework = { git = "https://github.com/aptos-labs/aptos-core.git", rev = "16beac69835f3a71564c96164a606a23f259099a", subdir = "aptos-move/framework/aptos-framework" }
ChainlinkCCIP = { local = "../ccip" }
CCIPTokenPool = { local = "../token_pool" }
`

export const LOCK_RELEASE_TOKEN_POOL_MOVE = `module lock_release_token_pool::lock_release_token_pool {
    use std::account::{Self, SignerCapability};
    use std::error;
    use std::fungible_asset::{
        Self,
        FungibleAsset,
        Metadata,
        TransferRef,
        FungibleStore
    };
    use std::dispatchable_fungible_asset;
    use std::primary_fungible_store;
    use std::object::{Self, Object, ObjectCore};
    use std::option::{Self, Option};
    use std::signer;
    use std::string::{Self, String};

    use ccip::token_admin_registry::{Self, LockOrBurnInputV1, ReleaseOrMintInputV1};
    use ccip_token_pool::ownable;
    use ccip_token_pool::rate_limiter;
    use ccip_token_pool::token_pool;

    use mcms::mcms_registry;
    use mcms::bcs_stream;

    const STORE_OBJECT_SEED: vector<u8> = b"CcipLockReleaseTokenPool";

    struct LockReleaseTokenPoolDeployment has key {
        store_signer_cap: SignerCapability,
        ownable_state: ownable::OwnableState,
        token_pool_state: token_pool::TokenPoolState
    }

    struct LockReleaseTokenPoolState has key, store {
        store_signer_cap: SignerCapability,
        ownable_state: ownable::OwnableState,
        token_pool_state: token_pool::TokenPoolState,
        store_signer_address: address,
        transfer_ref: Option<TransferRef>,
        rebalancer: address
    }

    const E_NOT_PUBLISHER: u64 = 1;
    const E_ALREADY_INITIALIZED: u64 = 2;
    const E_INVALID_FUNGIBLE_ASSET: u64 = 3;
    const E_INVALID_ARGUMENTS: u64 = 4;
    const E_UNKNOWN_FUNCTION: u64 = 5;
    const E_LOCAL_TOKEN_MISMATCH: u64 = 6;
    const E_DISPATCHABLE_TOKEN_WITHOUT_TRANSFER_REF: u64 = 7;
    const E_UNAUTHORIZED: u64 = 8;
    const E_INSUFFICIENT_LIQUIDITY: u64 = 9;
    const E_TRANSFER_REF_NOT_SET: u64 = 10;

    // ================================================================
    // |                             Init                             |
    // ================================================================
    #[view]
    public fun type_and_version(): String {
        string::utf8(b"LockReleaseTokenPool 1.6.0")
    }

    fun init_module(publisher: &signer) {
        // register the pool on deployment, because in the case of object code deployment,
        // this is the only time we have a signer ref to @ccip_lock_release_pool.
        assert!(
            object::object_exists<Metadata>(@lock_release_local_token),
            error::invalid_argument(E_INVALID_FUNGIBLE_ASSET)
        );
        let metadata = object::address_to_object<Metadata>(@lock_release_local_token);

        // create an Account on the object for event handles.
        account::create_account_if_does_not_exist(@lock_release_token_pool);

        // the name of this module. if incorrect, callbacks will fail to be registered and
        // register_pool will revert.
        let token_pool_module_name = b"lock_release_token_pool";

        // Register the entrypoint with mcms
        if (@mcms_register_entrypoints == @0x1) {
            register_mcms_entrypoint(publisher, token_pool_module_name);
        };

        // Register V2 pool with closure-based callbacks
        register_v2_callbacks(publisher);

        // create a resource account to be the owner of the primary FungibleStore we will use.
        let (store_signer, store_signer_cap) =
            account::create_resource_account(publisher, STORE_OBJECT_SEED);

        // make sure this is a valid fungible asset that is primary fungible store enabled,
        // ie. created with primary_fungible_store::create_primary_store_enabled_fungible_asset
        primary_fungible_store::ensure_primary_store_exists(
            signer::address_of(&store_signer), metadata
        );

        move_to(
            publisher,
            LockReleaseTokenPoolDeployment {
                store_signer_cap,
                ownable_state: ownable::new(&store_signer, @lock_release_token_pool),
                token_pool_state: token_pool::initialize(
                    &store_signer, @lock_release_local_token, vector[]
                )
            }
        );
    }

    /// Tokens that have dynamic dispatch enabled must provide a \`TransferRef\`
    /// Tokens that do not have dynamic dispatch enabled can provide \`option::none()\`
    /// You can still provide a transfer ref for tokens that don't have dynamic dispatch enabled
    /// if you choose to do so.
    public fun initialize(
        caller: &signer, transfer_ref: Option<TransferRef>, rebalancer: address
    ) acquires LockReleaseTokenPoolDeployment {
        assert_can_initialize(signer::address_of(caller));

        assert!(
            exists<LockReleaseTokenPoolDeployment>(@lock_release_token_pool),
            error::invalid_argument(E_ALREADY_INITIALIZED)
        );

        let LockReleaseTokenPoolDeployment {
            store_signer_cap,
            ownable_state,
            token_pool_state
        } = move_from<LockReleaseTokenPoolDeployment>(@lock_release_token_pool);

        let store_signer = account::create_signer_with_capability(&store_signer_cap);
        let store_signer_address = signer::address_of(&store_signer);

        // If transfer ref is not provided, tokens with dynamic dispatch on deposit and withdraw
        // are not allowed for this pool
        if (transfer_ref.is_none()) {
            let store =
                primary_fungible_store::primary_store(
                    store_signer_address,
                    token_pool::get_fa_metadata(&token_pool_state)
                );
            assert!(
                fungible_asset::deposit_dispatch_function(store).is_none()
                    && fungible_asset::withdraw_dispatch_function(store).is_none(),
                E_DISPATCHABLE_TOKEN_WITHOUT_TRANSFER_REF
            );
        } else {
            let metadata = object::address_to_object<Metadata>(@lock_release_local_token);
            let transfer_ref_metadata =
                fungible_asset::transfer_ref_metadata(transfer_ref.borrow());
            assert!(metadata == transfer_ref_metadata, E_LOCAL_TOKEN_MISMATCH);
        };

        let pool = LockReleaseTokenPoolState {
            store_signer_cap,
            ownable_state,
            token_pool_state,
            store_signer_address,
            transfer_ref,
            rebalancer
        };
        move_to(&store_signer, pool);
    }

    public fun register_v2_callbacks(publisher: &signer) {
        assert!(
            signer::address_of(publisher) == @lock_release_token_pool,
            error::permission_denied(E_NOT_PUBLISHER)
        );
        token_admin_registry::register_pool_v2(
            publisher,
            @lock_release_local_token,
            lock_or_burn_v2,
            release_or_mint_v2
        );
    }

    // ================================================================
    // |                 Exposing token_pool functions                |
    // ================================================================
    #[view]
    public fun get_token(): address acquires LockReleaseTokenPoolState {
        token_pool::get_token(&borrow_pool().token_pool_state)
    }

    #[view]
    public fun get_router(): address {
        token_pool::get_router()
    }

    #[view]
    public fun get_token_decimals(): u8 acquires LockReleaseTokenPoolState {
        token_pool::get_token_decimals(&borrow_pool().token_pool_state)
    }

    #[view]
    public fun get_remote_pools(
        remote_chain_selector: u64
    ): vector<vector<u8>> acquires LockReleaseTokenPoolState {
        token_pool::get_remote_pools(
            &borrow_pool().token_pool_state, remote_chain_selector
        )
    }

    #[view]
    public fun is_remote_pool(
        remote_chain_selector: u64, remote_pool_address: vector<u8>
    ): bool acquires LockReleaseTokenPoolState {
        token_pool::is_remote_pool(
            &borrow_pool().token_pool_state,
            remote_chain_selector,
            remote_pool_address
        )
    }

    #[view]
    public fun get_remote_token(
        remote_chain_selector: u64
    ): vector<u8> acquires LockReleaseTokenPoolState {
        let pool = borrow_pool();
        token_pool::get_remote_token(&pool.token_pool_state, remote_chain_selector)
    }

    public entry fun add_remote_pool(
        caller: &signer, remote_chain_selector: u64, remote_pool_address: vector<u8>
    ) acquires LockReleaseTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::assert_only_owner(signer::address_of(caller), &pool.ownable_state);

        token_pool::add_remote_pool(
            &mut pool.token_pool_state,
            remote_chain_selector,
            remote_pool_address
        );
    }

    public entry fun remove_remote_pool(
        caller: &signer, remote_chain_selector: u64, remote_pool_address: vector<u8>
    ) acquires LockReleaseTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::assert_only_owner(signer::address_of(caller), &pool.ownable_state);

        token_pool::remove_remote_pool(
            &mut pool.token_pool_state,
            remote_chain_selector,
            remote_pool_address
        );
    }

    inline fun has_transfer_ref(pool: &LockReleaseTokenPoolState): bool {
        pool.transfer_ref.is_some()
    }

    #[view]
    public fun pool_primary_store(): Object<FungibleStore> acquires LockReleaseTokenPoolState {
        let pool = borrow_pool();
        primary_fungible_store::primary_store(
            pool.store_signer_address,
            token_pool::get_fa_metadata(&pool.token_pool_state)
        )
    }

    inline fun pool_primary_store_inlined(
        pool: &LockReleaseTokenPoolState
    ): Object<FungibleStore> {
        primary_fungible_store::primary_store(
            pool.store_signer_address,
            token_pool::get_fa_metadata(&pool.token_pool_state)
        )
    }

    #[view]
    public fun balance(): u64 acquires LockReleaseTokenPoolState {
        fungible_asset::balance(pool_primary_store())
    }

    #[view]
    public fun derived_balance(): u64 acquires LockReleaseTokenPoolState {
        dispatchable_fungible_asset::derived_balance(pool_primary_store())
    }

    #[view]
    public fun is_supported_chain(
        remote_chain_selector: u64
    ): bool acquires LockReleaseTokenPoolState {
        let pool = borrow_pool();
        token_pool::is_supported_chain(&pool.token_pool_state, remote_chain_selector)
    }

    #[view]
    public fun get_supported_chains(): vector<u64> acquires LockReleaseTokenPoolState {
        let pool = borrow_pool();
        token_pool::get_supported_chains(&pool.token_pool_state)
    }

    public entry fun apply_chain_updates(
        caller: &signer,
        remote_chain_selectors_to_remove: vector<u64>,
        remote_chain_selectors_to_add: vector<u64>,
        remote_pool_addresses_to_add: vector<vector<vector<u8>>>,
        remote_token_addresses_to_add: vector<vector<u8>>
    ) acquires LockReleaseTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::assert_only_owner(signer::address_of(caller), &pool.ownable_state);

        token_pool::apply_chain_updates(
            &mut pool.token_pool_state,
            remote_chain_selectors_to_remove,
            remote_chain_selectors_to_add,
            remote_pool_addresses_to_add,
            remote_token_addresses_to_add
        );
    }

    #[view]
    public fun get_allowlist_enabled(): bool acquires LockReleaseTokenPoolState {
        let pool = borrow_pool();
        token_pool::get_allowlist_enabled(&pool.token_pool_state)
    }

    public entry fun set_allowlist_enabled(
        caller: &signer, enabled: bool
    ) acquires LockReleaseTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::assert_only_owner(signer::address_of(caller), &pool.ownable_state);
        token_pool::set_allowlist_enabled(&mut pool.token_pool_state, enabled);
    }

    #[view]
    public fun get_allowlist(): vector<address> acquires LockReleaseTokenPoolState {
        let pool = borrow_pool();
        token_pool::get_allowlist(&pool.token_pool_state)
    }

    public entry fun apply_allowlist_updates(
        caller: &signer, removes: vector<address>, adds: vector<address>
    ) acquires LockReleaseTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::assert_only_owner(signer::address_of(caller), &pool.ownable_state);
        token_pool::apply_allowlist_updates(&mut pool.token_pool_state, removes, adds);
    }

    // ================================================================
    // |                       Lock/Release                           |
    // ================================================================

    // the callback proof type used as authentication to retrieve and set input and output arguments.
    struct CallbackProof has drop {}

    public fun lock_or_burn<T: key>(
        _store: Object<T>, fa: FungibleAsset, _transfer_ref: &TransferRef
    ) acquires LockReleaseTokenPoolState {
        // retrieve the input for this lock or burn operation. if this function is invoked
        // outside of ccip::token_admin_registry, the transaction will abort.
        let input =
            token_admin_registry::get_lock_or_burn_input_v1(
                @lock_release_token_pool, CallbackProof {}
            );

        let pool = borrow_pool_mut();
        let fa_amount = fungible_asset::amount(&fa);

        // This method validates various aspects of the lock or burn operation. If any of the
        // validations fail, the transaction will abort.
        let dest_token_address =
            token_pool::validate_lock_or_burn(
                &mut pool.token_pool_state,
                &fa,
                &input,
                fa_amount
            );

        // Construct lock_or_burn output before we lose access to fa
        let dest_pool_data = token_pool::encode_local_decimals(&pool.token_pool_state);
        let metadata = token_pool::get_fa_metadata(&pool.token_pool_state);
        let store =
            primary_fungible_store::primary_store(pool.store_signer_address, metadata);

        // Lock the funds in the pool
        if (has_transfer_ref(pool)) {
            let transfer_ref = pool.transfer_ref.borrow();
            fungible_asset::deposit_with_ref(transfer_ref, store, fa);
        } else {
            fungible_asset::deposit(store, fa);
        };

        // set the output for this lock or burn operation.
        token_admin_registry::set_lock_or_burn_output_v1(
            @lock_release_token_pool,
            CallbackProof {},
            dest_token_address,
            dest_pool_data
        );

        let remote_chain_selector =
            token_admin_registry::get_lock_or_burn_remote_chain_selector(&input);

        token_pool::emit_locked_or_burned(
            &mut pool.token_pool_state, fa_amount, remote_chain_selector
        );
    }

    public fun release_or_mint<T: key>(
        _store: Object<T>, _amount: u64, _transfer_ref: &TransferRef
    ): FungibleAsset acquires LockReleaseTokenPoolState {
        // retrieve the input for this release or mint operation. if this function is invoked
        // outside of ccip::token_admin_registry, the transaction will abort.
        let input =
            token_admin_registry::get_release_or_mint_input_v1(
                @lock_release_token_pool, CallbackProof {}
            );
        let pool = borrow_pool_mut();
        let local_amount =
            token_pool::calculate_release_or_mint_amount(&pool.token_pool_state, &input);

        token_pool::validate_release_or_mint(
            &mut pool.token_pool_state, &input, local_amount
        );

        let store_signer = account::create_signer_with_capability(&pool.store_signer_cap);
        let metadata = token_pool::get_fa_metadata(&pool.token_pool_state);
        let store =
            primary_fungible_store::primary_store(pool.store_signer_address, metadata);

        // Withdraw the amount from the store for release. this will revert if the store has insufficient balance.
        let fa =
            if (has_transfer_ref(pool)) {
                let transfer_ref = pool.transfer_ref.borrow();
                fungible_asset::withdraw_with_ref(transfer_ref, store, local_amount)
            } else {
                fungible_asset::withdraw(&store_signer, store, local_amount)
            };

        // set the output for this release or mint operation.
        token_admin_registry::set_release_or_mint_output_v1(
            @lock_release_token_pool, CallbackProof {}, local_amount
        );

        let recipient = token_admin_registry::get_release_or_mint_receiver(&input);
        let remote_chain_selector =
            token_admin_registry::get_release_or_mint_remote_chain_selector(&input);

        token_pool::emit_released_or_minted(
            &mut pool.token_pool_state,
            recipient,
            local_amount,
            remote_chain_selector
        );

        // return the withdrawn fungible asset.
        fa
    }

    #[persistent]
    fun lock_or_burn_v2(
        fa: FungibleAsset, input: LockOrBurnInputV1
    ): (vector<u8>, vector<u8>) acquires LockReleaseTokenPoolState {
        let pool = borrow_pool_mut();
        let fa_amount = fungible_asset::amount(&fa);

        let dest_token_address =
            token_pool::validate_lock_or_burn(
                &mut pool.token_pool_state,
                &fa,
                &input,
                fa_amount
            );

        // Lock the funds in the pool
        primary_fungible_store::deposit(pool.store_signer_address, fa);

        let remote_chain_selector =
            token_admin_registry::get_lock_or_burn_remote_chain_selector(&input);

        token_pool::emit_locked_or_burned(
            &mut pool.token_pool_state, fa_amount, remote_chain_selector
        );

        (dest_token_address, token_pool::encode_local_decimals(&pool.token_pool_state))
    }

    #[persistent]
    fun release_or_mint_v2(
        input: ReleaseOrMintInputV1
    ): (FungibleAsset, u64) acquires LockReleaseTokenPoolState {
        let pool = borrow_pool_mut();
        let local_amount =
            token_pool::calculate_release_or_mint_amount(&pool.token_pool_state, &input);

        token_pool::validate_release_or_mint(
            &mut pool.token_pool_state, &input, local_amount
        );

        let store_signer = account::create_signer_with_capability(&pool.store_signer_cap);
        let metadata = token_pool::get_fa_metadata(&pool.token_pool_state);

        // Withdraw the amount from the store for release
        let fa = primary_fungible_store::withdraw(&store_signer, metadata, local_amount);

        let recipient = token_admin_registry::get_release_or_mint_receiver(&input);
        let remote_chain_selector =
            token_admin_registry::get_release_or_mint_remote_chain_selector(&input);

        token_pool::emit_released_or_minted(
            &mut pool.token_pool_state,
            recipient,
            local_amount,
            remote_chain_selector
        );

        (fa, local_amount)
    }

    // ================================================================
    // |                    Rate limit config                         |
    // ================================================================
    public entry fun set_chain_rate_limiter_configs(
        caller: &signer,
        remote_chain_selectors: vector<u64>,
        outbound_is_enableds: vector<bool>,
        outbound_capacities: vector<u64>,
        outbound_rates: vector<u64>,
        inbound_is_enableds: vector<bool>,
        inbound_capacities: vector<u64>,
        inbound_rates: vector<u64>
    ) acquires LockReleaseTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::assert_only_owner(signer::address_of(caller), &pool.ownable_state);

        let number_of_chains = remote_chain_selectors.length();

        assert!(
            number_of_chains == outbound_is_enableds.length()
                && number_of_chains == outbound_capacities.length()
                && number_of_chains == outbound_rates.length()
                && number_of_chains == inbound_is_enableds.length()
                && number_of_chains == inbound_capacities.length()
                && number_of_chains == inbound_rates.length(),
            error::invalid_argument(E_INVALID_ARGUMENTS)
        );

        for (i in 0..number_of_chains) {
            token_pool::set_chain_rate_limiter_config(
                &mut pool.token_pool_state,
                remote_chain_selectors[i],
                outbound_is_enableds[i],
                outbound_capacities[i],
                outbound_rates[i],
                inbound_is_enableds[i],
                inbound_capacities[i],
                inbound_rates[i]
            );
        };
    }

    public entry fun set_chain_rate_limiter_config(
        caller: &signer,
        remote_chain_selector: u64,
        outbound_is_enabled: bool,
        outbound_capacity: u64,
        outbound_rate: u64,
        inbound_is_enabled: bool,
        inbound_capacity: u64,
        inbound_rate: u64
    ) acquires LockReleaseTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::assert_only_owner(signer::address_of(caller), &pool.ownable_state);

        token_pool::set_chain_rate_limiter_config(
            &mut pool.token_pool_state,
            remote_chain_selector,
            outbound_is_enabled,
            outbound_capacity,
            outbound_rate,
            inbound_is_enabled,
            inbound_capacity,
            inbound_rate
        );
    }

    #[view]
    public fun get_current_inbound_rate_limiter_state(
        remote_chain_selector: u64
    ): rate_limiter::TokenBucket acquires LockReleaseTokenPoolState {
        token_pool::get_current_inbound_rate_limiter_state(
            &borrow_pool().token_pool_state, remote_chain_selector
        )
    }

    #[view]
    public fun get_current_outbound_rate_limiter_state(
        remote_chain_selector: u64
    ): rate_limiter::TokenBucket acquires LockReleaseTokenPoolState {
        token_pool::get_current_outbound_rate_limiter_state(
            &borrow_pool().token_pool_state, remote_chain_selector
        )
    }

    // ================================================================
    // |                    Liquidity Management                      |
    // ================================================================

    /// @notice Adds liquidity to the pool. The tokens should be sent before calling this function
    /// @param amount The amount of liquidity to add
    public entry fun provide_liquidity(
        caller: &signer, amount: u64
    ) acquires LockReleaseTokenPoolState {
        let pool = borrow_pool_mut();
        let caller_address = assert_is_rebalancer(caller, pool);

        let (caller_store, pool_store) = get_caller_and_pool_stores(
            caller_address, pool
        );

        transfer_tokens(pool, caller, caller_store, pool_store, amount);

        token_pool::emit_liquidity_added(
            &mut pool.token_pool_state, caller_address, amount
        );
    }

    /// @notice Removes liquidity from the pool
    /// @param amount The amount of liquidity to remove
    public entry fun withdraw_liquidity(
        caller: &signer, amount: u64
    ) acquires LockReleaseTokenPoolState {
        let pool = borrow_pool_mut();
        let caller_address = assert_is_rebalancer(caller, pool);

        let (caller_store, pool_store) = get_caller_and_pool_stores(
            caller_address, pool
        );
        assert!(fungible_asset::balance(pool_store) >= amount, E_INSUFFICIENT_LIQUIDITY);

        let store_signer = account::create_signer_with_capability(&pool.store_signer_cap);

        transfer_tokens(
            pool,
            &store_signer,
            pool_store,
            caller_store,
            amount
        );

        token_pool::emit_liquidity_removed(
            &mut pool.token_pool_state, caller_address, amount
        );
    }

    inline fun assert_is_rebalancer(
        caller: &signer, pool: &LockReleaseTokenPoolState
    ): address {
        let caller_address = signer::address_of(caller);
        assert!(caller_address == pool.rebalancer, E_UNAUTHORIZED);
        caller_address
    }

    inline fun get_caller_and_pool_stores(
        caller_address: address, pool: &LockReleaseTokenPoolState
    ): (Object<FungibleStore>, Object<FungibleStore>) {
        let metadata = token_pool::get_fa_metadata(&pool.token_pool_state);
        let caller_store =
            primary_fungible_store::ensure_primary_store_exists(
                caller_address, metadata
            );
        let pool_store = pool_primary_store_inlined(pool);
        (caller_store, pool_store)
    }

    inline fun transfer_tokens(
        pool: &LockReleaseTokenPoolState,
        from: &signer,
        from_store: Object<FungibleStore>,
        to_store: Object<FungibleStore>,
        amount: u64
    ) {
        if (has_transfer_ref(pool)) {
            let transfer_ref = pool.transfer_ref.borrow();
            fungible_asset::transfer_with_ref(transfer_ref, from_store, to_store, amount);
        } else {
            fungible_asset::transfer(from, from_store, to_store, amount);
        };
    }

    public entry fun set_rebalancer(
        caller: &signer, rebalancer: address
    ) acquires LockReleaseTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::assert_only_owner(signer::address_of(caller), &pool.ownable_state);

        let old_rebalancer = pool.rebalancer;
        pool.rebalancer = rebalancer;

        token_pool::emit_rebalancer_set(
            &mut pool.token_pool_state, old_rebalancer, rebalancer
        );
    }

    #[view]
    public fun get_rebalancer(): address acquires LockReleaseTokenPoolState {
        borrow_pool().rebalancer
    }

    // ================================================================
    // |                    Ref Migration                              |
    // ================================================================
    public fun migrate_transfer_ref(caller: &signer): TransferRef acquires LockReleaseTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::assert_only_owner(signer::address_of(caller), &pool.ownable_state);
        assert!(pool.transfer_ref.is_some(), E_TRANSFER_REF_NOT_SET);

        pool.transfer_ref.extract()
    }

    // ================================================================
    // |                      Storage helpers                         |
    // ================================================================
    #[view]
    public fun get_store_address(): address {
        store_address()
    }

    inline fun store_address(): address {
        account::create_resource_address(&@lock_release_token_pool, STORE_OBJECT_SEED)
    }

    fun assert_can_initialize(caller_address: address) {
        if (caller_address == @lock_release_token_pool) { return };

        if (object::is_object(@lock_release_token_pool)) {
            let ccip_lock_release_pool_object =
                object::address_to_object<ObjectCore>(@lock_release_token_pool);
            if (caller_address == object::owner(ccip_lock_release_pool_object)
                || caller_address == object::root_owner(ccip_lock_release_pool_object)) {
                return
            };
        };

        abort error::permission_denied(E_NOT_PUBLISHER)
    }

    inline fun borrow_pool(): &LockReleaseTokenPoolState {
        borrow_global<LockReleaseTokenPoolState>(store_address())
    }

    inline fun borrow_pool_mut(): &mut LockReleaseTokenPoolState {
        borrow_global_mut<LockReleaseTokenPoolState>(store_address())
    }

    // ================================================================
    // |                       Expose ownable                         |
    // ================================================================
    #[view]
    public fun owner(): address acquires LockReleaseTokenPoolState {
        ownable::owner(&borrow_pool().ownable_state)
    }

    #[view]
    public fun has_pending_transfer(): bool acquires LockReleaseTokenPoolState {
        ownable::has_pending_transfer(&borrow_pool().ownable_state)
    }

    #[view]
    public fun pending_transfer_from(): Option<address> acquires LockReleaseTokenPoolState {
        ownable::pending_transfer_from(&borrow_pool().ownable_state)
    }

    #[view]
    public fun pending_transfer_to(): Option<address> acquires LockReleaseTokenPoolState {
        ownable::pending_transfer_to(&borrow_pool().ownable_state)
    }

    #[view]
    public fun pending_transfer_accepted(): Option<bool> acquires LockReleaseTokenPoolState {
        ownable::pending_transfer_accepted(&borrow_pool().ownable_state)
    }

    public entry fun transfer_ownership(
        caller: &signer, to: address
    ) acquires LockReleaseTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::transfer_ownership(caller, &mut pool.ownable_state, to)
    }

    public entry fun accept_ownership(caller: &signer) acquires LockReleaseTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::accept_ownership(caller, &mut pool.ownable_state)
    }

    public entry fun execute_ownership_transfer(
        caller: &signer, to: address
    ) acquires LockReleaseTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::execute_ownership_transfer(caller, &mut pool.ownable_state, to)
    }

    // ================================================================
    // |                      MCMS entrypoint                         |
    // ================================================================
    struct McmsCallback has drop {}

    public fun mcms_entrypoint<T: key>(
        _metadata: object::Object<T>
    ): option::Option<u128> acquires LockReleaseTokenPoolState {
        let (caller, function, data) =
            mcms_registry::get_callback_params(@lock_release_token_pool, McmsCallback {});

        let function_bytes = *function.bytes();
        let stream = bcs_stream::new(data);

        if (function_bytes == b"add_remote_pool") {
            let remote_chain_selector = bcs_stream::deserialize_u64(&mut stream);
            let remote_pool_address = bcs_stream::deserialize_vector_u8(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            add_remote_pool(&caller, remote_chain_selector, remote_pool_address);
        } else if (function_bytes == b"remove_remote_pool") {
            let remote_chain_selector = bcs_stream::deserialize_u64(&mut stream);
            let remote_pool_address = bcs_stream::deserialize_vector_u8(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            remove_remote_pool(&caller, remote_chain_selector, remote_pool_address);
        } else if (function_bytes == b"apply_chain_updates") {
            let remote_chain_selectors_to_remove =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_u64(stream)
                );
            let remote_chain_selectors_to_add =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_u64(stream)
                );
            let remote_pool_addresses_to_add =
                bcs_stream::deserialize_vector(
                    &mut stream,
                    |stream| bcs_stream::deserialize_vector(
                        stream, |stream| bcs_stream::deserialize_vector_u8(stream)
                    )
                );
            let remote_token_addresses_to_add =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_vector_u8(stream)
                );
            bcs_stream::assert_is_consumed(&stream);
            apply_chain_updates(
                &caller,
                remote_chain_selectors_to_remove,
                remote_chain_selectors_to_add,
                remote_pool_addresses_to_add,
                remote_token_addresses_to_add
            );
        } else if (function_bytes == b"set_allowlist_enabled") {
            let enabled = bcs_stream::deserialize_bool(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            set_allowlist_enabled(&caller, enabled);
        } else if (function_bytes == b"apply_allowlist_updates") {
            let removes =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_address(stream)
                );
            let adds =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_address(stream)
                );
            bcs_stream::assert_is_consumed(&stream);
            apply_allowlist_updates(&caller, removes, adds);
        } else if (function_bytes == b"set_chain_rate_limiter_configs") {
            let remote_chain_selectors =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_u64(stream)
                );
            let outbound_is_enableds =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_bool(stream)
                );
            let outbound_capacities =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_u64(stream)
                );
            let outbound_rates =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_u64(stream)
                );
            let inbound_is_enableds =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_bool(stream)
                );
            let inbound_capacities =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_u64(stream)
                );
            let inbound_rates =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_u64(stream)
                );
            bcs_stream::assert_is_consumed(&stream);
            set_chain_rate_limiter_configs(
                &caller,
                remote_chain_selectors,
                outbound_is_enableds,
                outbound_capacities,
                outbound_rates,
                inbound_is_enableds,
                inbound_capacities,
                inbound_rates
            );
        } else if (function_bytes == b"set_chain_rate_limiter_config") {
            let remote_chain_selector = bcs_stream::deserialize_u64(&mut stream);
            let outbound_is_enabled = bcs_stream::deserialize_bool(&mut stream);
            let outbound_capacity = bcs_stream::deserialize_u64(&mut stream);
            let outbound_rate = bcs_stream::deserialize_u64(&mut stream);
            let inbound_is_enabled = bcs_stream::deserialize_bool(&mut stream);
            let inbound_capacity = bcs_stream::deserialize_u64(&mut stream);
            let inbound_rate = bcs_stream::deserialize_u64(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            set_chain_rate_limiter_config(
                &caller,
                remote_chain_selector,
                outbound_is_enabled,
                outbound_capacity,
                outbound_rate,
                inbound_is_enabled,
                inbound_capacity,
                inbound_rate
            );
        } else if (function_bytes == b"transfer_ownership") {
            let to = bcs_stream::deserialize_address(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            transfer_ownership(&caller, to);
        } else if (function_bytes == b"accept_ownership") {
            bcs_stream::assert_is_consumed(&stream);
            accept_ownership(&caller);
        } else if (function_bytes == b"execute_ownership_transfer") {
            let to = bcs_stream::deserialize_address(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            execute_ownership_transfer(&caller, to)
        } else if (function_bytes == b"set_rebalancer") {
            let rebalancer = bcs_stream::deserialize_address(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            set_rebalancer(&caller, rebalancer);
        } else if (function_bytes == b"provide_liquidity") {
            let amount = bcs_stream::deserialize_u64(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            provide_liquidity(&caller, amount);
        } else if (function_bytes == b"withdraw_liquidity") {
            let amount = bcs_stream::deserialize_u64(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            withdraw_liquidity(&caller, amount);
        } else {
            abort error::invalid_argument(E_UNKNOWN_FUNCTION)
        };

        option::none()
    }

    /// Callable during upgrades
    public(friend) fun register_mcms_entrypoint(
        publisher: &signer, module_name: vector<u8>
    ) {
        mcms_registry::register_entrypoint(
            publisher, string::utf8(module_name), McmsCallback {}
        );
    }
}
`
