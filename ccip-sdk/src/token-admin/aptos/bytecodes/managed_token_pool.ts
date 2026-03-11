/**
 * ManagedTokenPool Move package source files.
 *
 * Source: chainlink-aptos contracts/ccip/ccip_token_pools/managed_token_pool
 * AptosFramework rev: 16beac69835f3a71564c96164a606a23f259099a
 * ChainlinkCCIP + MCMS: embedded as local dependencies
 *
 * Vendored as source (not compiled bytecodes) because Aptos Move modules
 * must be compiled with the deployer's address at deploy time.
 *
 * Lazy-loaded via dynamic import() — same pattern as EVM BurnMintERC20 bytecode.
 */

/** Move.toml for the ManagedTokenPool package. */
export const POOL_MOVE_TOML = `[package]
name = "ManagedTokenPool"
version = "1.0.0"
authors = []

[addresses]
ccip = "_"
ccip_token_pool = "_"
managed_token_pool = "_"
mcms = "_"
mcms_register_entrypoints = "_"
managed_token = "_"

[dependencies]
AptosFramework = { git = "https://github.com/aptos-labs/aptos-core.git", rev = "16beac69835f3a71564c96164a606a23f259099a", subdir = "aptos-move/framework/aptos-framework" }
ChainlinkCCIP = { local = "../ccip" }
CCIPTokenPool = { local = "../token_pool" }
ManagedToken = { local = "../managed_token" }
`

/** sources/managed_token_pool.move */
export const MANAGED_TOKEN_POOL_MOVE = `module managed_token_pool::managed_token_pool {
    use std::account::{Self, SignerCapability};
    use std::error;
    use std::fungible_asset::{Self, FungibleAsset, Metadata, TransferRef};
    use std::primary_fungible_store;
    use std::object::{Self, Object};
    use std::option::{Self, Option};
    use std::signer;
    use std::string::{Self, String};

    use managed_token::managed_token;

    use ccip::token_admin_registry::{Self, LockOrBurnInputV1, ReleaseOrMintInputV1};
    use ccip_token_pool::ownable;
    use ccip_token_pool::rate_limiter;
    use ccip_token_pool::token_pool;

    use mcms::mcms_registry;
    use mcms::bcs_stream;

    const STORE_OBJECT_SEED: vector<u8> = b"CcipManagedTokenPool";

    struct ManagedTokenPoolState has key, store {
        store_signer_cap: SignerCapability,
        ownable_state: ownable::OwnableState,
        token_pool_state: token_pool::TokenPoolState,
        store_signer_address: address
    }

    const E_INVALID_ARGUMENTS: u64 = 1;
    const E_UNKNOWN_FUNCTION: u64 = 2;
    const E_NOT_PUBLISHER: u64 = 3;

    // ================================================================
    // |                             Init                             |
    // ================================================================
    #[view]
    public fun type_and_version(): String {
        string::utf8(b"ManagedTokenPool 1.6.0")
    }

    fun init_module(publisher: &signer) {
        // register the pool on deployment, because in the case of object code deployment,
        // this is the only time we have a signer ref to @ccip_managed_pool.

        // create an Account on the object for event handles.
        account::create_account_if_does_not_exist(@managed_token_pool);

        // the name of this module. if incorrect, callbacks will fail to be registered and
        // register_pool will revert.
        let token_pool_module_name = b"managed_token_pool";

        // Register the entrypoint with mcms
        if (@mcms_register_entrypoints == @0x1) {
            register_mcms_entrypoint(publisher, token_pool_module_name);
        };

        // Register V2 pool with closure-based callbacks
        register_v2_callbacks(publisher);

        // create a resource account to be the owner of the primary FungibleStore we will use.
        let (store_signer, store_signer_cap) =
            account::create_resource_account(publisher, STORE_OBJECT_SEED);

        let managed_token_address = managed_token::token_metadata();
        let metadata = object::address_to_object<Metadata>(managed_token_address);

        // make sure this is a valid fungible asset that is primary fungible store enabled,
        // ie. created with primary_fungible_store::create_primary_store_enabled_fungible_asset
        primary_fungible_store::ensure_primary_store_exists(
            signer::address_of(&store_signer), metadata
        );

        let store_signer = account::create_signer_with_capability(&store_signer_cap);

        let pool = ManagedTokenPoolState {
            ownable_state: ownable::new(&store_signer, @managed_token_pool),
            store_signer_address: signer::address_of(&store_signer),
            store_signer_cap,
            token_pool_state: token_pool::initialize(
                &store_signer, managed_token_address, vector[]
            )
        };

        move_to(&store_signer, pool);
    }

    public fun register_v2_callbacks(publisher: &signer) {
        assert!(
            signer::address_of(publisher) == @managed_token_pool,
            error::permission_denied(E_NOT_PUBLISHER)
        );
        let managed_token_address = managed_token::token_metadata();
        token_admin_registry::register_pool_v2(
            publisher,
            managed_token_address,
            lock_or_burn_v2,
            release_or_mint_v2
        );
    }

    // ================================================================
    // |                 Exposing token_pool functions                |
    // ================================================================
    #[view]
    public fun get_token(): address acquires ManagedTokenPoolState {
        token_pool::get_token(&borrow_pool().token_pool_state)
    }

    #[view]
    public fun get_router(): address {
        token_pool::get_router()
    }

    #[view]
    public fun get_token_decimals(): u8 acquires ManagedTokenPoolState {
        token_pool::get_token_decimals(&borrow_pool().token_pool_state)
    }

    #[view]
    public fun get_remote_pools(
        remote_chain_selector: u64
    ): vector<vector<u8>> acquires ManagedTokenPoolState {
        token_pool::get_remote_pools(
            &borrow_pool().token_pool_state, remote_chain_selector
        )
    }

    #[view]
    public fun is_remote_pool(
        remote_chain_selector: u64, remote_pool_address: vector<u8>
    ): bool acquires ManagedTokenPoolState {
        token_pool::is_remote_pool(
            &borrow_pool().token_pool_state,
            remote_chain_selector,
            remote_pool_address
        )
    }

    #[view]
    public fun get_remote_token(
        remote_chain_selector: u64
    ): vector<u8> acquires ManagedTokenPoolState {
        let pool = borrow_pool();
        token_pool::get_remote_token(&pool.token_pool_state, remote_chain_selector)
    }

    public entry fun add_remote_pool(
        caller: &signer, remote_chain_selector: u64, remote_pool_address: vector<u8>
    ) acquires ManagedTokenPoolState {
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
    ) acquires ManagedTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::assert_only_owner(signer::address_of(caller), &pool.ownable_state);

        token_pool::remove_remote_pool(
            &mut pool.token_pool_state,
            remote_chain_selector,
            remote_pool_address
        );
    }

    #[view]
    public fun is_supported_chain(remote_chain_selector: u64): bool acquires ManagedTokenPoolState {
        let pool = borrow_pool();
        token_pool::is_supported_chain(&pool.token_pool_state, remote_chain_selector)
    }

    #[view]
    public fun get_supported_chains(): vector<u64> acquires ManagedTokenPoolState {
        let pool = borrow_pool();
        token_pool::get_supported_chains(&pool.token_pool_state)
    }

    public entry fun apply_chain_updates(
        caller: &signer,
        remote_chain_selectors_to_remove: vector<u64>,
        remote_chain_selectors_to_add: vector<u64>,
        remote_pool_addresses_to_add: vector<vector<vector<u8>>>,
        remote_token_addresses_to_add: vector<vector<u8>>
    ) acquires ManagedTokenPoolState {
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
    public fun get_allowlist_enabled(): bool acquires ManagedTokenPoolState {
        let pool = borrow_pool();
        token_pool::get_allowlist_enabled(&pool.token_pool_state)
    }

    public entry fun set_allowlist_enabled(
        caller: &signer, enabled: bool
    ) acquires ManagedTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::assert_only_owner(signer::address_of(caller), &pool.ownable_state);
        token_pool::set_allowlist_enabled(&mut pool.token_pool_state, enabled);
    }

    #[view]
    public fun get_allowlist(): vector<address> acquires ManagedTokenPoolState {
        let pool = borrow_pool();
        token_pool::get_allowlist(&pool.token_pool_state)
    }

    public entry fun apply_allowlist_updates(
        caller: &signer, removes: vector<address>, adds: vector<address>
    ) acquires ManagedTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::assert_only_owner(signer::address_of(caller), &pool.ownable_state);
        token_pool::apply_allowlist_updates(&mut pool.token_pool_state, removes, adds);
    }

    // ================================================================
    // |                         Burn/Mint                            |
    // ================================================================

    // the callback proof type used as authentication to retrieve and set input and output arguments.
    struct CallbackProof has drop {}

    public fun lock_or_burn<T: key>(
        _store: Object<T>, fa: FungibleAsset, _transfer_ref: &TransferRef
    ) acquires ManagedTokenPoolState {
        // retrieve the input for this lock or burn operation. if this function is invoked
        // outside of ccip::token_admin_registry, the transaction will abort.
        let input =
            token_admin_registry::get_lock_or_burn_input_v1(
                @managed_token_pool, CallbackProof {}
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

        // Burn the funds
        let store =
            primary_fungible_store::ensure_primary_store_exists(
                pool.store_signer_address, fungible_asset::asset_metadata(&fa)
            );
        let signer = &account::create_signer_with_capability(&pool.store_signer_cap);
        fungible_asset::deposit(store, fa);
        managed_token::burn(signer, pool.store_signer_address, fa_amount);

        // set the output for this lock or burn operation.
        token_admin_registry::set_lock_or_burn_output_v1(
            @managed_token_pool,
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
    ): FungibleAsset acquires ManagedTokenPoolState {
        // retrieve the input for this release or mint operation. if this function is invoked
        // outside of ccip::token_admin_registry, the transaction will abort.
        let input =
            token_admin_registry::get_release_or_mint_input_v1(
                @managed_token_pool, CallbackProof {}
            );
        let pool = borrow_pool_mut();
        let local_amount =
            token_pool::calculate_release_or_mint_amount(&pool.token_pool_state, &input);

        token_pool::validate_release_or_mint(
            &mut pool.token_pool_state, &input, local_amount
        );

        // Mint the amount for release.
        let local_token = token_admin_registry::get_release_or_mint_local_token(&input);
        let metadata = object::address_to_object<Metadata>(local_token);
        let store =
            primary_fungible_store::ensure_primary_store_exists(
                pool.store_signer_address, metadata
            );
        let signer = &account::create_signer_with_capability(&pool.store_signer_cap);
        managed_token::mint(signer, pool.store_signer_address, local_amount);
        let fa = fungible_asset::withdraw(signer, store, local_amount);

        // set the output for this release or mint operation.
        token_admin_registry::set_release_or_mint_output_v1(
            @managed_token_pool, CallbackProof {}, local_amount
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
    fun lock_or_burn_v2(fa: FungibleAsset, input: LockOrBurnInputV1)
        : (vector<u8>, vector<u8>) {
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

        // Burn the funds
        let store =
            primary_fungible_store::ensure_primary_store_exists(
                pool.store_signer_address, fungible_asset::asset_metadata(&fa)
            );
        let signer = &account::create_signer_with_capability(&pool.store_signer_cap);
        fungible_asset::deposit(store, fa);
        managed_token::burn(signer, pool.store_signer_address, fa_amount);

        let remote_chain_selector =
            token_admin_registry::get_lock_or_burn_remote_chain_selector(&input);

        token_pool::emit_locked_or_burned(
            &mut pool.token_pool_state, fa_amount, remote_chain_selector
        );

        (dest_token_address, token_pool::encode_local_decimals(&pool.token_pool_state))
    }

    #[persistent]
    fun release_or_mint_v2(input: ReleaseOrMintInputV1): (FungibleAsset, u64) {
        let pool = borrow_pool_mut();
        let local_amount =
            token_pool::calculate_release_or_mint_amount(&pool.token_pool_state, &input);

        token_pool::validate_release_or_mint(
            &mut pool.token_pool_state, &input, local_amount
        );

        // Mint the amount for release.
        let local_token = token_admin_registry::get_release_or_mint_local_token(&input);
        let metadata = object::address_to_object<Metadata>(local_token);
        let store =
            primary_fungible_store::ensure_primary_store_exists(
                pool.store_signer_address, metadata
            );
        let signer = &account::create_signer_with_capability(&pool.store_signer_cap);
        managed_token::mint(signer, pool.store_signer_address, local_amount);

        // Calling into \`fungible_asset::withdraw\` works as managed token is not dispatchable
        let fa = fungible_asset::withdraw(signer, store, local_amount);
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
    ) acquires ManagedTokenPoolState {
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
    ) acquires ManagedTokenPoolState {
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
    ): rate_limiter::TokenBucket acquires ManagedTokenPoolState {
        token_pool::get_current_inbound_rate_limiter_state(
            &borrow_pool().token_pool_state, remote_chain_selector
        )
    }

    #[view]
    public fun get_current_outbound_rate_limiter_state(
        remote_chain_selector: u64
    ): rate_limiter::TokenBucket acquires ManagedTokenPoolState {
        token_pool::get_current_outbound_rate_limiter_state(
            &borrow_pool().token_pool_state, remote_chain_selector
        )
    }

    // ================================================================
    // |                      Storage helpers                         |
    // ================================================================
    #[view]
    public fun get_store_address(): address {
        store_address()
    }

    inline fun store_address(): address {
        account::create_resource_address(&@managed_token_pool, STORE_OBJECT_SEED)
    }

    inline fun borrow_pool(): &ManagedTokenPoolState {
        borrow_global<ManagedTokenPoolState>(store_address())
    }

    inline fun borrow_pool_mut(): &mut ManagedTokenPoolState {
        borrow_global_mut<ManagedTokenPoolState>(store_address())
    }

    // ================================================================
    // |                       Expose ownable                         |
    // ================================================================
    #[view]
    public fun owner(): address acquires ManagedTokenPoolState {
        ownable::owner(&borrow_pool().ownable_state)
    }

    #[view]
    public fun has_pending_transfer(): bool acquires ManagedTokenPoolState {
        ownable::has_pending_transfer(&borrow_pool().ownable_state)
    }

    #[view]
    public fun pending_transfer_from(): Option<address> acquires ManagedTokenPoolState {
        ownable::pending_transfer_from(&borrow_pool().ownable_state)
    }

    #[view]
    public fun pending_transfer_to(): Option<address> acquires ManagedTokenPoolState {
        ownable::pending_transfer_to(&borrow_pool().ownable_state)
    }

    #[view]
    public fun pending_transfer_accepted(): Option<bool> acquires ManagedTokenPoolState {
        ownable::pending_transfer_accepted(&borrow_pool().ownable_state)
    }

    public entry fun transfer_ownership(caller: &signer, to: address) acquires ManagedTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::transfer_ownership(caller, &mut pool.ownable_state, to)
    }

    public entry fun accept_ownership(caller: &signer) acquires ManagedTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::accept_ownership(caller, &mut pool.ownable_state)
    }

    public entry fun execute_ownership_transfer(
        caller: &signer, to: address
    ) acquires ManagedTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::execute_ownership_transfer(caller, &mut pool.ownable_state, to)
    }

    // ================================================================
    // |                      MCMS entrypoint                         |
    // ================================================================
    struct McmsCallback has drop {}

    public fun mcms_entrypoint<T: key>(
        _metadata: object::Object<T>
    ): option::Option<u128> acquires ManagedTokenPoolState {
        let (caller, function, data) =
            mcms_registry::get_callback_params(@managed_token_pool, McmsCallback {});

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

    // ================================================================
    // |                      Test functions                          |
    // ================================================================
    #[test_only]
    public entry fun test_init_module(owner: &signer) {
        init_module(owner);
    }

    #[test_only]
    /// Used for registering the pool with V2 closure-based callbacks.
    public fun create_callback_proof(): CallbackProof {
        CallbackProof {}
    }
}
`

/** Move.toml for the token_pool dependency package. */
export const TOKEN_POOL_MOVE_TOML = `[package]
name = "CCIPTokenPool"
version = "1.0.0"
authors = []

[addresses]
ccip = "_"
ccip_token_pool = "_"
mcms = "_"
mcms_register_entrypoints = "_"

[dependencies]
AptosFramework = { git = "https://github.com/aptos-labs/aptos-core.git", rev = "16beac69835f3a71564c96164a606a23f259099a", subdir = "aptos-move/framework/aptos-framework" }
ChainlinkCCIP = { local = "../ccip" }
`

/** token_pool/sources/token_pool.move */
export const TOKEN_POOL_MOVE = `module ccip_token_pool::token_pool {
    use std::account::{Self};
    use std::error;
    use std::event::{Self, EventHandle};
    use std::fungible_asset::{Self, FungibleAsset, Metadata};
    use std::object::{Self, Object};
    use std::smart_table::{Self, SmartTable};

    use ccip::address;
    use ccip::eth_abi;
    use ccip::token_admin_registry;
    use ccip::rmn_remote;
    use ccip::allowlist;

    use ccip_token_pool::rate_limiter;
    use ccip_token_pool::token_pool_rate_limiter;

    const MAX_U256: u256 =
        115792089237316195423570985008687907853269984665640564039457584007913129639935;
    const MAX_U64: u256 = 18446744073709551615;

    struct TokenPoolState has key, store {
        allowlist_state: allowlist::AllowlistState,
        fa_metadata: Object<Metadata>,
        remote_chain_configs: SmartTable<u64, RemoteChainConfig>,
        rate_limiter_config: token_pool_rate_limiter::RateLimitState,
        locked_events: EventHandle<LockedOrBurned>,
        released_events: EventHandle<ReleasedOrMinted>,
        remote_pool_added_events: EventHandle<RemotePoolAdded>,
        remote_pool_removed_events: EventHandle<RemotePoolRemoved>,
        chain_added_events: EventHandle<ChainAdded>,
        chain_removed_events: EventHandle<ChainRemoved>,
        liquidity_added_events: EventHandle<LiquidityAdded>,
        liquidity_removed_events: EventHandle<LiquidityRemoved>,
        rebalancer_set_events: EventHandle<RebalancerSet>
    }

    struct RemoteChainConfig has store, drop, copy {
        remote_token_address: vector<u8>,
        remote_pools: vector<vector<u8>>
    }

    #[event]
    struct LockedOrBurned has store, drop {
        remote_chain_selector: u64,
        local_token: address,
        amount: u64
    }

    #[event]
    struct ReleasedOrMinted has store, drop {
        remote_chain_selector: u64,
        local_token: address,
        recipient: address,
        amount: u64
    }

    #[event]
    struct AllowlistRemove has store, drop {
        sender: address
    }

    #[event]
    struct AllowlistAdd has store, drop {
        sender: address
    }

    #[event]
    struct RemotePoolAdded has store, drop {
        remote_chain_selector: u64,
        remote_pool_address: vector<u8>
    }

    #[event]
    struct RemotePoolRemoved has store, drop {
        remote_chain_selector: u64,
        remote_pool_address: vector<u8>
    }

    #[event]
    struct ChainAdded has store, drop {
        remote_chain_selector: u64,
        remote_token_address: vector<u8>
    }

    #[event]
    struct ChainRemoved has store, drop {
        remote_chain_selector: u64
    }

    #[event]
    struct LiquidityAdded has store, drop {
        local_token: address,
        provider: address,
        amount: u64
    }

    #[event]
    struct LiquidityRemoved has store, drop {
        local_token: address,
        provider: address,
        amount: u64
    }

    #[event]
    struct RebalancerSet has store, drop {
        old_rebalancer: address,
        new_rebalancer: address
    }

    const E_NOT_ALLOWED_CALLER: u64 = 1;
    const E_UNKNOWN_FUNGIBLE_ASSET: u64 = 2;
    const E_UNKNOWN_REMOTE_CHAIN_SELECTOR: u64 = 3;
    const E_ZERO_ADDRESS_NOT_ALLOWED: u64 = 4;
    const E_REMOTE_POOL_ALREADY_ADDED: u64 = 5;
    const E_UNKNOWN_REMOTE_POOL: u64 = 6;
    const E_REMOTE_CHAIN_TO_ADD_MISMATCH: u64 = 7;
    const E_REMOTE_CHAIN_ALREADY_EXISTS: u64 = 8;
    const E_INVALID_REMOTE_CHAIN_DECIMALS: u64 = 9;
    const E_INVALID_ENCODED_AMOUNT: u64 = 10;
    const E_DECIMAL_OVERFLOW: u64 = 11;
    const E_CURSED_CHAIN: u64 = 12;

    // ================================================================
    // |                    Initialize and state                      |
    // ================================================================

    /// This function should be called from the init_module function to ensure the events
    /// are created on the correct object.
    public fun initialize(
        event_account: &signer, local_token: address, allowlist: vector<address>
    ): TokenPoolState {
        let fa_metadata = object::address_to_object<Metadata>(local_token);

        TokenPoolState {
            allowlist_state: allowlist::new(event_account, allowlist),
            fa_metadata,
            remote_chain_configs: smart_table::new(),
            rate_limiter_config: token_pool_rate_limiter::new(event_account),
            locked_events: account::new_event_handle(event_account),
            released_events: account::new_event_handle(event_account),
            remote_pool_added_events: account::new_event_handle(event_account),
            remote_pool_removed_events: account::new_event_handle(event_account),
            chain_added_events: account::new_event_handle(event_account),
            chain_removed_events: account::new_event_handle(event_account),
            liquidity_added_events: account::new_event_handle(event_account),
            liquidity_removed_events: account::new_event_handle(event_account),
            rebalancer_set_events: account::new_event_handle(event_account)
        }
    }

    #[view]
    public fun get_router(): address {
        @ccip
    }

    public fun get_token(state: &TokenPoolState): address {
        object::object_address(&state.fa_metadata)
    }

    public fun get_token_decimals(state: &TokenPoolState): u8 {
        fungible_asset::decimals(state.fa_metadata)
    }

    public fun get_fa_metadata(state: &TokenPoolState): Object<Metadata> {
        state.fa_metadata
    }

    // ================================================================
    // |                        Remote Chains                         |
    // ================================================================
    public fun get_supported_chains(state: &TokenPoolState): vector<u64> {
        state.remote_chain_configs.keys()
    }

    public fun is_supported_chain(
        state: &TokenPoolState, remote_chain_selector: u64
    ): bool {
        state.remote_chain_configs.contains(remote_chain_selector)
    }

    public fun apply_chain_updates(
        state: &mut TokenPoolState,
        remote_chain_selectors_to_remove: vector<u64>,
        remote_chain_selectors_to_add: vector<u64>,
        remote_pool_addresses_to_add: vector<vector<vector<u8>>>,
        remote_token_addresses_to_add: vector<vector<u8>>
    ) {
        remote_chain_selectors_to_remove.for_each_ref(
            |remote_chain_selector| {
                let remote_chain_selector: u64 = *remote_chain_selector;
                assert!(
                    state.remote_chain_configs.contains(remote_chain_selector),
                    error::invalid_argument(E_UNKNOWN_REMOTE_CHAIN_SELECTOR)
                );
                state.remote_chain_configs.remove(remote_chain_selector);

                event::emit_event(
                    &mut state.chain_removed_events,
                    ChainRemoved { remote_chain_selector }
                );
            }
        );

        let add_len = remote_chain_selectors_to_add.length();
        assert!(
            add_len == remote_pool_addresses_to_add.length(),
            error::invalid_argument(E_REMOTE_CHAIN_TO_ADD_MISMATCH)
        );
        assert!(
            add_len == remote_token_addresses_to_add.length(),
            error::invalid_argument(E_REMOTE_CHAIN_TO_ADD_MISMATCH)
        );

        for (i in 0..add_len) {
            let remote_chain_selector = remote_chain_selectors_to_add[i];
            assert!(
                !state.remote_chain_configs.contains(remote_chain_selector),
                error::invalid_argument(E_REMOTE_CHAIN_ALREADY_EXISTS)
            );
            let remote_pool_addresses = remote_pool_addresses_to_add[i];
            let remote_token_address = remote_token_addresses_to_add[i];
            address::assert_non_zero_address_vector(&remote_token_address);

            let remote_chain_config = RemoteChainConfig {
                remote_token_address,
                remote_pools: vector[]
            };

            remote_pool_addresses.for_each(
                |remote_pool_address| {
                    let remote_pool_address: vector<u8> = remote_pool_address;
                    address::assert_non_zero_address_vector(&remote_pool_address);

                    let (found, _) =
                        remote_chain_config.remote_pools.index_of(&remote_pool_address);
                    assert!(
                        !found, error::invalid_argument(E_REMOTE_POOL_ALREADY_ADDED)
                    );

                    remote_chain_config.remote_pools.push_back(remote_pool_address);

                    event::emit_event(
                        &mut state.remote_pool_added_events,
                        RemotePoolAdded { remote_chain_selector, remote_pool_address }
                    );
                }
            );

            state.remote_chain_configs.add(remote_chain_selector, remote_chain_config);

            event::emit_event(
                &mut state.chain_added_events,
                ChainAdded { remote_chain_selector, remote_token_address }
            );
        };
    }

    // ================================================================
    // |                        Remote Pools                          |
    // ================================================================
    public fun get_remote_pools(
        state: &TokenPoolState, remote_chain_selector: u64
    ): vector<vector<u8>> {
        assert!(
            state.remote_chain_configs.contains(remote_chain_selector),
            error::invalid_argument(E_UNKNOWN_REMOTE_CHAIN_SELECTOR)
        );
        let remote_chain_config =
            state.remote_chain_configs.borrow(remote_chain_selector);
        remote_chain_config.remote_pools
    }

    public fun is_remote_pool(
        state: &TokenPoolState, remote_chain_selector: u64, remote_pool_address: vector<u8>
    ): bool {
        let remote_pools = get_remote_pools(state, remote_chain_selector);
        let (found, _) = remote_pools.index_of(&remote_pool_address);
        found
    }

    public fun get_remote_token(
        state: &TokenPoolState, remote_chain_selector: u64
    ): vector<u8> {
        assert!(
            state.remote_chain_configs.contains(remote_chain_selector),
            error::invalid_argument(E_UNKNOWN_REMOTE_CHAIN_SELECTOR)
        );
        let remote_chain_config =
            state.remote_chain_configs.borrow(remote_chain_selector);
        remote_chain_config.remote_token_address
    }

    public fun add_remote_pool(
        state: &mut TokenPoolState,
        remote_chain_selector: u64,
        remote_pool_address: vector<u8>
    ) {
        address::assert_non_zero_address_vector(&remote_pool_address);

        assert!(
            state.remote_chain_configs.contains(remote_chain_selector),
            error::invalid_argument(E_UNKNOWN_REMOTE_CHAIN_SELECTOR)
        );
        let remote_chain_config =
            state.remote_chain_configs.borrow_mut(remote_chain_selector);

        let (found, _) = remote_chain_config.remote_pools.index_of(&remote_pool_address);
        assert!(!found, error::invalid_argument(E_REMOTE_POOL_ALREADY_ADDED));

        remote_chain_config.remote_pools.push_back(remote_pool_address);

        event::emit_event(
            &mut state.remote_pool_added_events,
            RemotePoolAdded { remote_chain_selector, remote_pool_address }
        );
    }

    public fun remove_remote_pool(
        state: &mut TokenPoolState,
        remote_chain_selector: u64,
        remote_pool_address: vector<u8>
    ) {
        assert!(
            state.remote_chain_configs.contains(remote_chain_selector),
            error::invalid_argument(E_UNKNOWN_REMOTE_CHAIN_SELECTOR)
        );
        let remote_chain_config =
            state.remote_chain_configs.borrow_mut(remote_chain_selector);

        let (found, i) = remote_chain_config.remote_pools.index_of(&remote_pool_address);
        assert!(found, error::invalid_argument(E_UNKNOWN_REMOTE_POOL));

        // remove instead of swap_remove for readability, so the newest added pool is always at the end.
        remote_chain_config.remote_pools.remove(i);

        event::emit_event(
            &mut state.remote_pool_removed_events,
            RemotePoolRemoved { remote_chain_selector, remote_pool_address }
        );
    }

    // ================================================================
    // |                         Validation                           |
    // ================================================================

    // Returns the remote token as bytes
    public fun validate_lock_or_burn(
        state: &mut TokenPoolState,
        fa: &FungibleAsset,
        input: &token_admin_registry::LockOrBurnInputV1,
        local_amount: u64
    ): vector<u8> {
        // Validate the fungible asset
        let fa_metadata = fungible_asset::metadata_from_asset(fa);
        let configured_token = get_token(state);

        // make sure the caller is requesting this pool's fungible asset.
        assert!(
            configured_token == object::object_address(&fa_metadata),
            error::invalid_argument(E_UNKNOWN_FUNGIBLE_ASSET)
        );

        // Check RMN curse status
        let remote_chain_selector =
            token_admin_registry::get_lock_or_burn_remote_chain_selector(input);
        assert!(
            !rmn_remote::is_cursed_u128((remote_chain_selector as u128)),
            error::invalid_state(E_CURSED_CHAIN)
        );

        let sender = token_admin_registry::get_lock_or_burn_sender(input);
        // Allowlist check
        assert!(
            allowlist::is_allowed(&state.allowlist_state, sender),
            error::permission_denied(E_NOT_ALLOWED_CALLER)
        );

        if (!is_supported_chain(state, remote_chain_selector)) {
            abort error::invalid_argument(E_UNKNOWN_REMOTE_CHAIN_SELECTOR)
        };

        token_pool_rate_limiter::consume_outbound(
            &mut state.rate_limiter_config,
            remote_chain_selector,
            local_amount
        );

        get_remote_token(state, remote_chain_selector)
    }

    public fun validate_release_or_mint(
        state: &mut TokenPoolState,
        input: &token_admin_registry::ReleaseOrMintInputV1,
        local_amount: u64
    ) {
        // Validate the fungible asset
        let local_token = token_admin_registry::get_release_or_mint_local_token(input);
        let configured_token = get_token(state);

        // make sure the caller is requesting this pool's fungible asset.
        assert!(
            configured_token == local_token,
            error::invalid_argument(E_UNKNOWN_FUNGIBLE_ASSET)
        );

        // Check RMN curse status
        let remote_chain_selector =
            token_admin_registry::get_release_or_mint_remote_chain_selector(input);
        assert!(
            !rmn_remote::is_cursed_u128((remote_chain_selector as u128)),
            error::invalid_state(E_CURSED_CHAIN)
        );

        let source_pool_address =
            token_admin_registry::get_release_or_mint_source_pool_address(input);

        // This checks if the remote chain selector and the source pool are valid.
        assert!(
            is_remote_pool(state, remote_chain_selector, source_pool_address),
            error::invalid_argument(E_UNKNOWN_REMOTE_POOL)
        );

        token_pool_rate_limiter::consume_inbound(
            &mut state.rate_limiter_config,
            remote_chain_selector,
            local_amount
        );
    }

    // ================================================================
    // |                           Events                             |
    // ================================================================
    public fun emit_released_or_minted(
        state: &mut TokenPoolState,
        recipient: address,
        amount: u64,
        remote_chain_selector: u64
    ) {
        let local_token = object::object_address(&state.fa_metadata);

        event::emit_event(
            &mut state.released_events,
            ReleasedOrMinted {
                remote_chain_selector,
                local_token,
                recipient,
                amount
            }
        );
    }

    public fun emit_locked_or_burned(
        state: &mut TokenPoolState, amount: u64, remote_chain_selector: u64
    ) {
        let local_token = object::object_address(&state.fa_metadata);

        event::emit_event(
            &mut state.locked_events,
            LockedOrBurned { remote_chain_selector, local_token, amount }
        );
    }

    public fun emit_liquidity_added(
        state: &mut TokenPoolState, provider: address, amount: u64
    ) {
        let local_token = object::object_address(&state.fa_metadata);

        event::emit_event(
            &mut state.liquidity_added_events,
            LiquidityAdded { local_token, provider, amount }
        );
    }

    public fun emit_liquidity_removed(
        state: &mut TokenPoolState, provider: address, amount: u64
    ) {
        let local_token = object::object_address(&state.fa_metadata);

        event::emit_event(
            &mut state.liquidity_removed_events,
            LiquidityRemoved { local_token, provider, amount }
        );
    }

    public fun emit_rebalancer_set(
        state: &mut TokenPoolState, old_rebalancer: address, new_rebalancer: address
    ) {
        event::emit_event(
            &mut state.rebalancer_set_events,
            RebalancerSet { old_rebalancer, new_rebalancer }
        );
    }

    // ================================================================
    // |                          Decimals                            |
    // ================================================================
    public fun encode_local_decimals(state: &TokenPoolState): vector<u8> {
        let fa_decimals = fungible_asset::decimals(state.fa_metadata);
        let ret = vector[];
        eth_abi::encode_u8(&mut ret, fa_decimals);
        ret
    }

    #[view]
    public fun parse_remote_decimals(
        source_pool_data: vector<u8>, local_decimals: u8
    ): u8 {
        let data_len = source_pool_data.length();
        if (data_len == 0) {
            // Fallback to the local value.
            return local_decimals
        };

        assert!(data_len == 32, error::invalid_state(E_INVALID_REMOTE_CHAIN_DECIMALS));

        let remote_decimals = eth_abi::decode_u256_value(source_pool_data);
        assert!(
            remote_decimals <= 255,
            error::invalid_state(E_INVALID_REMOTE_CHAIN_DECIMALS)
        );

        remote_decimals as u8
    }

    #[view]
    public fun calculate_local_amount(
        remote_amount: u256, remote_decimals: u8, local_decimals: u8
    ): u64 {
        let local_amount =
            calculate_local_amount_internal(
                remote_amount, remote_decimals, local_decimals
            );
        assert!(local_amount <= MAX_U64, error::invalid_state(E_INVALID_ENCODED_AMOUNT));
        local_amount as u64
    }

    #[view]
    fun calculate_local_amount_internal(
        remote_amount: u256, remote_decimals: u8, local_decimals: u8
    ): u256 {
        if (remote_decimals == local_decimals) {
            return remote_amount
        } else if (remote_decimals > local_decimals) {
            let decimals_diff = remote_decimals - local_decimals;
            let current_amount = remote_amount;
            for (i in 0..decimals_diff) {
                current_amount /= 10;
            };
            return current_amount
        } else {
            let decimals_diff = local_decimals - remote_decimals;
            // This is a safety check to prevent overflow in the next calculation.
            // More than 77 would never fit in a uint256 and would cause an overflow. We also check if the resulting amount
            // would overflow.
            assert!(decimals_diff <= 77, error::invalid_state(E_DECIMAL_OVERFLOW));

            let multiplier: u256 = 1;
            let base: u256 = 10;
            for (i in 0..decimals_diff) {
                multiplier = multiplier * base;
            };

            assert!(
                remote_amount <= (MAX_U256 / multiplier),
                error::invalid_state(E_DECIMAL_OVERFLOW)
            );

            return remote_amount * multiplier
        }
    }

    public fun calculate_release_or_mint_amount(
        state: &TokenPoolState, input: &token_admin_registry::ReleaseOrMintInputV1
    ): u64 {
        let local_decimals = get_token_decimals(state);
        let source_amount =
            token_admin_registry::get_release_or_mint_source_amount(input);
        let source_pool_data =
            token_admin_registry::get_release_or_mint_source_pool_data(input);
        let remote_decimals = parse_remote_decimals(source_pool_data, local_decimals);
        let local_amount =
            calculate_local_amount(source_amount, remote_decimals, local_decimals);
        local_amount
    }

    // ================================================================
    // |                    Rate limit config                         |
    // ================================================================
    public fun set_chain_rate_limiter_config(
        state: &mut TokenPoolState,
        remote_chain_selector: u64,
        outbound_is_enabled: bool,
        outbound_capacity: u64,
        outbound_rate: u64,
        inbound_is_enabled: bool,
        inbound_capacity: u64,
        inbound_rate: u64
    ) {
        token_pool_rate_limiter::set_chain_rate_limiter_config(
            &mut state.rate_limiter_config,
            remote_chain_selector,
            outbound_is_enabled,
            outbound_capacity,
            outbound_rate,
            inbound_is_enabled,
            inbound_capacity,
            inbound_rate
        );
    }

    public fun get_current_inbound_rate_limiter_state(
        state: &TokenPoolState, remote_chain_selector: u64
    ): rate_limiter::TokenBucket {
        token_pool_rate_limiter::get_current_inbound_rate_limiter_state(
            &state.rate_limiter_config, remote_chain_selector
        )
    }

    public fun get_current_outbound_rate_limiter_state(
        state: &TokenPoolState, remote_chain_selector: u64
    ): rate_limiter::TokenBucket {
        token_pool_rate_limiter::get_current_outbound_rate_limiter_state(
            &state.rate_limiter_config, remote_chain_selector
        )
    }

    // ================================================================
    // |                          Allowlist                           |
    // ================================================================
    public fun get_allowlist_enabled(state: &TokenPoolState): bool {
        allowlist::get_allowlist_enabled(&state.allowlist_state)
    }

    public fun set_allowlist_enabled(
        state: &mut TokenPoolState, enabled: bool
    ) {
        allowlist::set_allowlist_enabled(&mut state.allowlist_state, enabled);
    }

    public fun get_allowlist(state: &TokenPoolState): vector<address> {
        allowlist::get_allowlist(&state.allowlist_state)
    }

    public fun apply_allowlist_updates(
        state: &mut TokenPoolState, removes: vector<address>, adds: vector<address>
    ) {
        allowlist::apply_allowlist_updates(&mut state.allowlist_state, removes, adds);
    }

    // ================================================================
    // |                          Test functions                       |
    // ================================================================
    #[test_only]
    public fun destroy_token_pool(state: TokenPoolState) {
        let TokenPoolState {
            allowlist_state,
            fa_metadata: _fa_metadata,
            remote_chain_configs,
            rate_limiter_config,
            locked_events,
            released_events,
            remote_pool_added_events,
            remote_pool_removed_events,
            chain_added_events,
            chain_removed_events,
            liquidity_added_events,
            liquidity_removed_events,
            rebalancer_set_events
        } = state;

        allowlist::destroy_allowlist(allowlist_state);
        remote_chain_configs.destroy();
        event::destroy_handle(locked_events);
        event::destroy_handle(released_events);
        event::destroy_handle(remote_pool_added_events);
        event::destroy_handle(remote_pool_removed_events);
        event::destroy_handle(chain_added_events);
        event::destroy_handle(chain_removed_events);
        event::destroy_handle(liquidity_added_events);
        event::destroy_handle(liquidity_removed_events);
        event::destroy_handle(rebalancer_set_events);

        token_pool_rate_limiter::destroy_rate_limiter(rate_limiter_config);
    }

    #[test_only]
    public fun get_locked_or_burned_events(state: &TokenPoolState): vector<LockedOrBurned> {
        event::emitted_events_by_handle<LockedOrBurned>(&state.locked_events)
    }

    #[test_only]
    public fun get_released_or_minted_events(state: &TokenPoolState)
        : vector<ReleasedOrMinted> {
        event::emitted_events_by_handle<ReleasedOrMinted>(&state.released_events)
    }
}
`

/** token_pool/sources/ownable.move */
export const TOKEN_POOL_OWNABLE_MOVE = `/// This module implements an Ownable component similar to Ownable2Step.sol for managing
/// object ownership.
///
/// Due to Aptos's security model requiring the original owner's signer for 0x1::object::transfer,
/// this implementation uses a 3-step ownership transfer flow:
///
/// 1. Initial owner calls transfer_ownership with the new owner's address
/// 2. Pending owner calls accept_ownership to confirm the transfer
/// 3. Initial owner calls execute_ownership_transfer to complete the transfer
///
/// The execute_ownership_transfer function requires a signer in order to perform the
/// object transfer, while other operations only require the caller address to maintain the
/// principle of least privilege.
///
/// Note that direct ownership transfers via 0x1::object::transfer are still possible.
/// This module handles such cases gracefully by reading the current owner directly
/// from the object.
module ccip_token_pool::ownable {
    use std::account;
    use std::error;
    use std::event::{Self, EventHandle};
    use std::object::{Self, Object, ObjectCore};
    use std::option::{Self, Option};
    use std::signer;

    struct OwnableState has store {
        target_object: Object<ObjectCore>,
        pending_transfer: Option<PendingTransfer>,
        ownership_transfer_requested_events: EventHandle<OwnershipTransferRequested>,
        ownership_transfer_accepted_events: EventHandle<OwnershipTransferAccepted>,
        ownership_transferred_events: EventHandle<OwnershipTransferred>
    }

    struct PendingTransfer has store, drop {
        from: address,
        to: address,
        accepted: bool
    }

    const E_MUST_BE_PROPOSED_OWNER: u64 = 1;
    const E_CANNOT_TRANSFER_TO_SELF: u64 = 2;
    const E_ONLY_CALLABLE_BY_OWNER: u64 = 3;
    const E_PROPOSED_OWNER_MISMATCH: u64 = 4;
    const E_OWNER_CHANGED: u64 = 5;
    const E_NO_PENDING_TRANSFER: u64 = 6;
    const E_TRANSFER_NOT_ACCEPTED: u64 = 7;
    const E_TRANSFER_ALREADY_ACCEPTED: u64 = 8;

    #[event]
    struct OwnershipTransferRequested has store, drop {
        from: address,
        to: address
    }

    #[event]
    struct OwnershipTransferAccepted has store, drop {
        from: address,
        to: address
    }

    #[event]
    struct OwnershipTransferred has store, drop {
        from: address,
        to: address
    }

    public fun new(event_account: &signer, object_address: address): OwnableState {
        let new_state = OwnableState {
            target_object: object::address_to_object<ObjectCore>(object_address),
            pending_transfer: option::none(),
            ownership_transfer_requested_events: account::new_event_handle(event_account),
            ownership_transfer_accepted_events: account::new_event_handle(event_account),
            ownership_transferred_events: account::new_event_handle(event_account)
        };

        new_state
    }

    public fun owner(state: &OwnableState): address {
        owner_internal(state)
    }

    public fun has_pending_transfer(state: &OwnableState): bool {
        state.pending_transfer.is_some()
    }

    public fun pending_transfer_from(state: &OwnableState): Option<address> {
        state.pending_transfer.map_ref(|pending_transfer| pending_transfer.from)
    }

    public fun pending_transfer_to(state: &OwnableState): Option<address> {
        state.pending_transfer.map_ref(|pending_transfer| pending_transfer.to)
    }

    public fun pending_transfer_accepted(state: &OwnableState): Option<bool> {
        state.pending_transfer.map_ref(|pending_transfer| pending_transfer.accepted)
    }

    inline fun owner_internal(state: &OwnableState): address {
        object::owner(state.target_object)
    }

    public fun transfer_ownership(
        caller: &signer, state: &mut OwnableState, to: address
    ) {
        let caller_address = signer::address_of(caller);
        assert_only_owner_internal(caller_address, state);
        assert!(caller_address != to, error::invalid_argument(E_CANNOT_TRANSFER_TO_SELF));

        state.pending_transfer = option::some(
            PendingTransfer { from: caller_address, to, accepted: false }
        );

        event::emit_event(
            &mut state.ownership_transfer_requested_events,
            OwnershipTransferRequested { from: caller_address, to }
        );
    }

    public fun accept_ownership(caller: &signer, state: &mut OwnableState) {
        let caller_address = signer::address_of(caller);
        assert!(
            state.pending_transfer.is_some(),
            error::permission_denied(E_NO_PENDING_TRANSFER)
        );

        let current_owner = owner_internal(state);
        let pending_transfer = state.pending_transfer.borrow_mut();

        // check that the owner has not changed from a direct call to 0x1::object::transfer,
        // in which case the transfer flow should be restarted.
        assert!(
            pending_transfer.from == current_owner,
            error::permission_denied(E_OWNER_CHANGED)
        );
        assert!(
            pending_transfer.to == caller_address,
            error::permission_denied(E_MUST_BE_PROPOSED_OWNER)
        );
        assert!(
            !pending_transfer.accepted,
            error::invalid_state(E_TRANSFER_ALREADY_ACCEPTED)
        );

        pending_transfer.accepted = true;

        event::emit_event(
            &mut state.ownership_transfer_accepted_events,
            OwnershipTransferAccepted { from: pending_transfer.from, to: caller_address }
        );
    }

    public fun execute_ownership_transfer(
        caller: &signer, state: &mut OwnableState, to: address
    ) {
        let caller_address = signer::address_of(caller);
        assert_only_owner_internal(caller_address, state);

        let current_owner = owner_internal(state);
        let pending_transfer = state.pending_transfer.extract();

        // check that the owner has not changed from a direct call to 0x1::object::transfer,
        // in which case the transfer flow should be restarted.
        assert!(
            pending_transfer.from == current_owner,
            error::permission_denied(E_OWNER_CHANGED)
        );
        assert!(
            pending_transfer.to == to,
            error::permission_denied(E_PROPOSED_OWNER_MISMATCH)
        );
        assert!(
            pending_transfer.accepted,
            error::invalid_state(E_TRANSFER_NOT_ACCEPTED)
        );

        object::transfer(caller, state.target_object, pending_transfer.to);
        state.pending_transfer = option::none();

        event::emit_event(
            &mut state.ownership_transferred_events,
            OwnershipTransferred { from: caller_address, to }
        );
    }

    public fun assert_only_owner(caller: address, state: &OwnableState) {
        assert_only_owner_internal(caller, state)
    }

    inline fun assert_only_owner_internal(
        caller: address, state: &OwnableState
    ) {
        assert!(
            caller == owner_internal(state),
            error::permission_denied(E_ONLY_CALLABLE_BY_OWNER)
        );
    }

    public fun destroy(state: OwnableState) {
        let OwnableState {
            target_object: _,
            pending_transfer: _,
            ownership_transfer_requested_events,
            ownership_transfer_accepted_events,
            ownership_transferred_events
        } = state;

        event::destroy_handle(ownership_transfer_requested_events);
        event::destroy_handle(ownership_transfer_accepted_events);
        event::destroy_handle(ownership_transferred_events);
    }

    #[test_only]
    public fun get_ownership_transfer_requested_events(
        state: &OwnableState
    ): &EventHandle<OwnershipTransferRequested> {
        &state.ownership_transfer_requested_events
    }

    #[test_only]
    public fun get_ownership_transfer_accepted_events(
        state: &OwnableState
    ): &EventHandle<OwnershipTransferAccepted> {
        &state.ownership_transfer_accepted_events
    }

    #[test_only]
    public fun get_ownership_transferred_events(
        state: &OwnableState
    ): &EventHandle<OwnershipTransferred> {
        &state.ownership_transferred_events
    }
}
`

/** token_pool/sources/rate_limiter.move */
export const RATE_LIMITER_MOVE = `module ccip_token_pool::rate_limiter {
    use std::error;
    use std::timestamp;

    struct TokenBucket has store, drop {
        tokens: u64,
        last_updated: u64,
        is_enabled: bool,
        capacity: u64,
        rate: u64
    }

    const E_TOKEN_MAX_CAPACITY_EXCEEDED: u64 = 1;
    const E_TOKEN_RATE_LIMIT_REACHED: u64 = 2;

    public fun new(is_enabled: bool, capacity: u64, rate: u64): TokenBucket {
        TokenBucket {
            tokens: 0,
            last_updated: timestamp::now_seconds(),
            is_enabled,
            capacity,
            rate
        }
    }

    public fun get_current_token_bucket_state(state: &TokenBucket): TokenBucket {
        TokenBucket {
            tokens: calculate_refill(
                state, timestamp::now_seconds() - state.last_updated
            ),
            last_updated: timestamp::now_seconds(),
            is_enabled: state.is_enabled,
            capacity: state.capacity,
            rate: state.rate
        }
    }

    public fun consume(bucket: &mut TokenBucket, requested_tokens: u64) {
        if (!bucket.is_enabled || requested_tokens == 0) { return };

        update_bucket(bucket);

        assert!(
            requested_tokens <= bucket.capacity,
            error::invalid_argument(E_TOKEN_MAX_CAPACITY_EXCEEDED)
        );

        assert!(
            requested_tokens <= bucket.tokens,
            error::invalid_argument(E_TOKEN_RATE_LIMIT_REACHED)
        );

        bucket.tokens -= requested_tokens;
    }

    /// We allow 0 rate and/or 0 capacity rate limits to effectively disable value transfer.
    public fun set_token_bucket_config(
        bucket: &mut TokenBucket, is_enabled: bool, capacity: u64, rate: u64
    ) {
        update_bucket(bucket);

        bucket.tokens = min(bucket.tokens, capacity);
        bucket.capacity = capacity;
        bucket.rate = rate;
        bucket.is_enabled = is_enabled;
    }

    inline fun update_bucket(bucket: &mut TokenBucket) {
        let time_now_seconds = timestamp::now_seconds();
        let time_diff = time_now_seconds - bucket.last_updated;

        if (time_diff > 0) {
            bucket.tokens = calculate_refill(bucket, time_diff);
            bucket.last_updated = time_now_seconds;
        };
    }

    inline fun calculate_refill(bucket: &TokenBucket, time_diff: u64): u64 {
        min(
            bucket.capacity, bucket.tokens + time_diff * bucket.rate
        )
    }

    inline fun min(a: u64, b: u64): u64 {
        if (a > b) b else a
    }
}
`

/** token_pool/sources/token_pool_rate_limiter.move */
export const TOKEN_POOL_RATE_LIMITER_MOVE = `module ccip_token_pool::token_pool_rate_limiter {
    use std::smart_table;
    use std::smart_table::SmartTable;
    use std::account;
    use std::error;
    use std::event;
    use std::event::EventHandle;

    use ccip_token_pool::rate_limiter;

    struct RateLimitState has store {
        outbound_rate_limiter_config: SmartTable<u64, rate_limiter::TokenBucket>,
        inbound_rate_limiter_config: SmartTable<u64, rate_limiter::TokenBucket>,
        tokens_consumed_events: EventHandle<TokensConsumed>,
        config_changed_events: EventHandle<ConfigChanged>
    }

    #[event]
    struct TokensConsumed has store, drop {
        remote_chain_selector: u64,
        tokens: u64
    }

    #[event]
    struct ConfigChanged has store, drop {
        remote_chain_selector: u64,
        outbound_is_enabled: bool,
        outbound_capacity: u64,
        outbound_rate: u64,
        inbound_is_enabled: bool,
        inbound_capacity: u64,
        inbound_rate: u64
    }

    const E_BUCKET_NOT_FOUND: u64 = 1;

    public fun new(event_account: &signer): RateLimitState {
        RateLimitState {
            outbound_rate_limiter_config: smart_table::new(),
            inbound_rate_limiter_config: smart_table::new(),
            tokens_consumed_events: account::new_event_handle(event_account),
            config_changed_events: account::new_event_handle(event_account)
        }
    }

    public fun consume_inbound(
        state: &mut RateLimitState, dest_chain_selector: u64, requested_tokens: u64
    ) {
        consume_from_bucket(
            &mut state.tokens_consumed_events,
            &mut state.inbound_rate_limiter_config,
            dest_chain_selector,
            requested_tokens
        );
    }

    public fun consume_outbound(
        state: &mut RateLimitState, dest_chain_selector: u64, requested_tokens: u64
    ) {
        consume_from_bucket(
            &mut state.tokens_consumed_events,
            &mut state.outbound_rate_limiter_config,
            dest_chain_selector,
            requested_tokens
        );
    }

    inline fun consume_from_bucket(
        tokens_consumed_events: &mut EventHandle<TokensConsumed>,
        rate_limiter: &mut SmartTable<u64, rate_limiter::TokenBucket>,
        dest_chain_selector: u64,
        requested_tokens: u64
    ) {
        assert!(
            rate_limiter.contains(dest_chain_selector),
            error::invalid_argument(E_BUCKET_NOT_FOUND)
        );

        let bucket = rate_limiter.borrow_mut(dest_chain_selector);
        rate_limiter::consume(bucket, requested_tokens);

        event::emit_event(
            tokens_consumed_events,
            TokensConsumed {
                remote_chain_selector: dest_chain_selector,
                tokens: requested_tokens
            }
        );
    }

    public fun set_chain_rate_limiter_config(
        state: &mut RateLimitState,
        remote_chain_selector: u64,
        outbound_is_enabled: bool,
        outbound_capacity: u64,
        outbound_rate: u64,
        inbound_is_enabled: bool,
        inbound_capacity: u64,
        inbound_rate: u64
    ) {
        let outbound_config =
            state.outbound_rate_limiter_config.borrow_mut_with_default(
                remote_chain_selector,
                rate_limiter::new(false, 0, 0)
            );
        rate_limiter::set_token_bucket_config(
            outbound_config,
            outbound_is_enabled,
            outbound_capacity,
            outbound_rate
        );

        let inbound_config =
            state.inbound_rate_limiter_config.borrow_mut_with_default(
                remote_chain_selector,
                rate_limiter::new(false, 0, 0)
            );
        rate_limiter::set_token_bucket_config(
            inbound_config,
            inbound_is_enabled,
            inbound_capacity,
            inbound_rate
        );

        event::emit_event(
            &mut state.config_changed_events,
            ConfigChanged {
                remote_chain_selector,
                outbound_is_enabled,
                outbound_capacity,
                outbound_rate,
                inbound_is_enabled,
                inbound_capacity,
                inbound_rate
            }
        );
    }

    public fun get_current_inbound_rate_limiter_state(
        state: &RateLimitState, remote_chain_selector: u64
    ): rate_limiter::TokenBucket {
        rate_limiter::get_current_token_bucket_state(
            state.inbound_rate_limiter_config.borrow(remote_chain_selector)
        )
    }

    public fun get_current_outbound_rate_limiter_state(
        state: &RateLimitState, remote_chain_selector: u64
    ): rate_limiter::TokenBucket {
        rate_limiter::get_current_token_bucket_state(
            state.outbound_rate_limiter_config.borrow(remote_chain_selector)
        )
    }

    public fun destroy_rate_limiter(state: RateLimitState) {
        let RateLimitState {
            outbound_rate_limiter_config,
            inbound_rate_limiter_config,
            tokens_consumed_events,
            config_changed_events
        } = state;

        outbound_rate_limiter_config.destroy();
        inbound_rate_limiter_config.destroy();
        event::destroy_handle(tokens_consumed_events);
        event::destroy_handle(config_changed_events);
    }
}
`
