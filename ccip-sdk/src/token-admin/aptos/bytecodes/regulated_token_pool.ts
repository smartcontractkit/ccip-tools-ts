/**
 * RegulatedTokenPool Move package source files.
 *
 * Source: chainlink-aptos contracts/ccip/ccip_token_pools/regulated_token_pool
 *         + contracts/regulated_token
 * AptosFramework rev: 16beac69835f3a71564c96164a606a23f259099a
 * ChainlinkCCIP + MCMS: embedded as local dependencies
 *
 * For regulated tokens with pause/freeze/role-based access control.
 * The regulated_token package provides dynamic dispatch deposit/withdraw
 * functions that enforce compliance controls.
 *
 * Vendored as source (not compiled bytecodes) because Aptos Move modules
 * must be compiled with the deployer's address at deploy time.
 *
 * Lazy-loaded via dynamic import() — same pattern as EVM BurnMintERC20 bytecode.
 */

export const REGULATED_POOL_MOVE_TOML = `[package]
name = "RegulatedTokenPool"
version = "1.0.0"
authors = []

[addresses]
ccip = "_"
ccip_token_pool = "_"
regulated_token_pool = "_"
mcms = "_"
mcms_register_entrypoints = "_"
regulated_token = "_"
admin = "_"

[dependencies]
AptosFramework = { git = "https://github.com/aptos-labs/aptos-core.git", rev = "16beac69835f3a71564c96164a606a23f259099a", subdir = "aptos-move/framework/aptos-framework" }
ChainlinkCCIP = { local = "../ccip" }
CCIPTokenPool = { local = "../token_pool" }
RegulatedToken = { local = "../regulated_token" }
`

export const REGULATED_TOKEN_POOL_MOVE = `module regulated_token_pool::regulated_token_pool {
    use std::account::{Self, SignerCapability};
    use std::error;
    use std::fungible_asset::{Self, FungibleAsset, Metadata, TransferRef};
    use std::primary_fungible_store;
    use std::object::{Self, Object};
    use std::option::{Self, Option};
    use std::signer;
    use std::string::{Self, String};

    use regulated_token::regulated_token::{Self};

    use ccip::token_admin_registry::{Self, LockOrBurnInputV1, ReleaseOrMintInputV1};
    use ccip_token_pool::ownable;
    use ccip_token_pool::rate_limiter;
    use ccip_token_pool::token_pool;

    use mcms::mcms_registry;
    use mcms::bcs_stream;

    const STORE_OBJECT_SEED: vector<u8> = b"CcipRegulatedTokenPool";

    struct RegulatedTokenPoolState has key, store {
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
        string::utf8(b"RegulatedTokenPool 1.6.0")
    }

    fun init_module(publisher: &signer) {
        // register the pool on deployment, because in the case of object code deployment,
        // this is the only time we have a signer ref to @regulated_token_pool.

        // create an Account on the object for event handles.
        account::create_account_if_does_not_exist(@regulated_token_pool);

        // the name of this module. if incorrect, callbacks will fail to be registered and
        // register_pool will revert.
        let token_pool_module_name = b"regulated_token_pool";

        // Register the entrypoint with mcms
        if (@mcms_register_entrypoints == @0x1) {
            register_mcms_entrypoint(publisher, token_pool_module_name);
        };

        // Register V2 pool with closure-based callbacks
        register_v2_callbacks(publisher);

        // create a resource account to be the owner of the primary FungibleStore we will use.
        let (store_signer, store_signer_cap) =
            account::create_resource_account(publisher, STORE_OBJECT_SEED);

        let regulated_token_address = regulated_token::token_address();
        let metadata = object::address_to_object<Metadata>(regulated_token_address);

        // make sure this is a valid fungible asset that is primary fungible store enabled,
        // ie. created with primary_fungible_store::create_primary_store_enabled_fungible_asset
        primary_fungible_store::ensure_primary_store_exists(
            signer::address_of(&store_signer), metadata
        );

        let pool = RegulatedTokenPoolState {
            ownable_state: ownable::new(&store_signer, @regulated_token_pool),
            store_signer_address: signer::address_of(&store_signer),
            store_signer_cap,
            token_pool_state: token_pool::initialize(
                &store_signer, regulated_token_address, vector[]
            )
        };

        move_to(&store_signer, pool);
    }

    public fun register_v2_callbacks(publisher: &signer) {
        assert!(
            signer::address_of(publisher) == @regulated_token_pool,
            error::permission_denied(E_NOT_PUBLISHER)
        );
        let regulated_token_address = regulated_token::token_address();
        token_admin_registry::register_pool_v2(
            publisher,
            regulated_token_address,
            lock_or_burn_v2,
            release_or_mint_v2
        );
    }

    // ================================================================
    // |                 Exposing token_pool functions                |
    // ================================================================
    #[view]
    public fun get_token(): address acquires RegulatedTokenPoolState {
        token_pool::get_token(&borrow_pool().token_pool_state)
    }

    #[view]
    public fun get_router(): address {
        token_pool::get_router()
    }

    #[view]
    public fun get_token_decimals(): u8 acquires RegulatedTokenPoolState {
        token_pool::get_token_decimals(&borrow_pool().token_pool_state)
    }

    #[view]
    public fun get_remote_pools(
        remote_chain_selector: u64
    ): vector<vector<u8>> acquires RegulatedTokenPoolState {
        token_pool::get_remote_pools(
            &borrow_pool().token_pool_state, remote_chain_selector
        )
    }

    #[view]
    public fun is_remote_pool(
        remote_chain_selector: u64, remote_pool_address: vector<u8>
    ): bool acquires RegulatedTokenPoolState {
        token_pool::is_remote_pool(
            &borrow_pool().token_pool_state,
            remote_chain_selector,
            remote_pool_address
        )
    }

    #[view]
    public fun get_remote_token(
        remote_chain_selector: u64
    ): vector<u8> acquires RegulatedTokenPoolState {
        let pool = borrow_pool();
        token_pool::get_remote_token(&pool.token_pool_state, remote_chain_selector)
    }

    public entry fun add_remote_pool(
        caller: &signer, remote_chain_selector: u64, remote_pool_address: vector<u8>
    ) acquires RegulatedTokenPoolState {
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
    ) acquires RegulatedTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::assert_only_owner(signer::address_of(caller), &pool.ownable_state);

        token_pool::remove_remote_pool(
            &mut pool.token_pool_state,
            remote_chain_selector,
            remote_pool_address
        );
    }

    #[view]
    public fun is_supported_chain(remote_chain_selector: u64): bool acquires RegulatedTokenPoolState {
        let pool = borrow_pool();
        token_pool::is_supported_chain(&pool.token_pool_state, remote_chain_selector)
    }

    #[view]
    public fun get_supported_chains(): vector<u64> acquires RegulatedTokenPoolState {
        let pool = borrow_pool();
        token_pool::get_supported_chains(&pool.token_pool_state)
    }

    public entry fun apply_chain_updates(
        caller: &signer,
        remote_chain_selectors_to_remove: vector<u64>,
        remote_chain_selectors_to_add: vector<u64>,
        remote_pool_addresses_to_add: vector<vector<vector<u8>>>,
        remote_token_addresses_to_add: vector<vector<u8>>
    ) acquires RegulatedTokenPoolState {
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
    public fun get_allowlist_enabled(): bool acquires RegulatedTokenPoolState {
        let pool = borrow_pool();
        token_pool::get_allowlist_enabled(&pool.token_pool_state)
    }

    public entry fun set_allowlist_enabled(
        caller: &signer, enabled: bool
    ) acquires RegulatedTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::assert_only_owner(signer::address_of(caller), &pool.ownable_state);
        token_pool::set_allowlist_enabled(&mut pool.token_pool_state, enabled);
    }

    #[view]
    public fun get_allowlist(): vector<address> acquires RegulatedTokenPoolState {
        let pool = borrow_pool();
        token_pool::get_allowlist(&pool.token_pool_state)
    }

    public entry fun apply_allowlist_updates(
        caller: &signer, removes: vector<address>, adds: vector<address>
    ) acquires RegulatedTokenPoolState {
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
    ) acquires RegulatedTokenPoolState {
        // retrieve the input for this lock or burn operation. if this function is invoked
        // outside of ccip::token_admin_registry, the transaction will abort.
        let input =
            token_admin_registry::get_lock_or_burn_input_v1(
                @regulated_token_pool, CallbackProof {}
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

        // Burn the funds using regulated token's bridge burn function
        // The pool store signer must have BRIDGE_MINTER_OR_BURNER role
        let pool_signer = &account::create_signer_with_capability(&pool.store_signer_cap);
        let sender = token_admin_registry::get_lock_or_burn_sender(&input);
        regulated_token::bridge_burn(pool_signer, sender, fa);

        // set the output for this lock or burn operation.
        token_admin_registry::set_lock_or_burn_output_v1(
            @regulated_token_pool,
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
    ): FungibleAsset acquires RegulatedTokenPoolState {
        // retrieve the input for this release or mint operation. if this function is invoked
        // outside of ccip::token_admin_registry, the transaction will abort.
        let input =
            token_admin_registry::get_release_or_mint_input_v1(
                @regulated_token_pool, CallbackProof {}
            );
        let pool = borrow_pool_mut();
        let local_amount =
            token_pool::calculate_release_or_mint_amount(&pool.token_pool_state, &input);

        token_pool::validate_release_or_mint(
            &mut pool.token_pool_state, &input, local_amount
        );

        // Mint the amount for release using regulated token's bridge mint function
        // The pool store signer must have BRIDGE_MINTER_OR_BURNER role
        let pool_signer = &account::create_signer_with_capability(&pool.store_signer_cap);
        let receiver = token_admin_registry::get_release_or_mint_receiver(&input);
        let fa = regulated_token::bridge_mint(pool_signer, receiver, local_amount);

        // set the output for this release or mint operation.
        token_admin_registry::set_release_or_mint_output_v1(
            @regulated_token_pool, CallbackProof {}, local_amount
        );

        let remote_chain_selector =
            token_admin_registry::get_release_or_mint_remote_chain_selector(&input);

        token_pool::emit_released_or_minted(
            &mut pool.token_pool_state,
            receiver,
            local_amount,
            remote_chain_selector
        );

        // return the withdrawn fungible asset.
        fa
    }

    #[persistent]
    fun lock_or_burn_v2(
        fa: FungibleAsset, input: LockOrBurnInputV1
    ): (vector<u8>, vector<u8>) acquires RegulatedTokenPoolState {
        let pool = borrow_pool_mut();
        let fa_amount = fungible_asset::amount(&fa);

        let dest_token_address =
            token_pool::validate_lock_or_burn(
                &mut pool.token_pool_state,
                &fa,
                &input,
                fa_amount
            );

        let pool_signer = &account::create_signer_with_capability(&pool.store_signer_cap);
        let sender = token_admin_registry::get_lock_or_burn_sender(&input);
        regulated_token::bridge_burn(pool_signer, sender, fa);

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
    ): (FungibleAsset, u64) acquires RegulatedTokenPoolState {
        let pool = borrow_pool_mut();
        let local_amount =
            token_pool::calculate_release_or_mint_amount(&pool.token_pool_state, &input);

        token_pool::validate_release_or_mint(
            &mut pool.token_pool_state, &input, local_amount
        );

        // Mint the amount for release using regulated token's bridge mint function
        let pool_signer = &account::create_signer_with_capability(&pool.store_signer_cap);
        let receiver = token_admin_registry::get_release_or_mint_receiver(&input);
        let fa = regulated_token::bridge_mint(pool_signer, receiver, local_amount);

        let remote_chain_selector =
            token_admin_registry::get_release_or_mint_remote_chain_selector(&input);

        token_pool::emit_released_or_minted(
            &mut pool.token_pool_state,
            receiver,
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
    ) acquires RegulatedTokenPoolState {
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
    ) acquires RegulatedTokenPoolState {
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
    ): rate_limiter::TokenBucket acquires RegulatedTokenPoolState {
        token_pool::get_current_inbound_rate_limiter_state(
            &borrow_pool().token_pool_state, remote_chain_selector
        )
    }

    #[view]
    public fun get_current_outbound_rate_limiter_state(
        remote_chain_selector: u64
    ): rate_limiter::TokenBucket acquires RegulatedTokenPoolState {
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
        account::create_resource_address(&@regulated_token_pool, STORE_OBJECT_SEED)
    }

    inline fun borrow_pool(): &RegulatedTokenPoolState {
        borrow_global<RegulatedTokenPoolState>(store_address())
    }

    inline fun borrow_pool_mut(): &mut RegulatedTokenPoolState {
        borrow_global_mut<RegulatedTokenPoolState>(store_address())
    }

    // ================================================================
    // |                       Expose ownable                         |
    // ================================================================
    #[view]
    public fun owner(): address acquires RegulatedTokenPoolState {
        ownable::owner(&borrow_pool().ownable_state)
    }

    #[view]
    public fun has_pending_transfer(): bool acquires RegulatedTokenPoolState {
        ownable::has_pending_transfer(&borrow_pool().ownable_state)
    }

    #[view]
    public fun pending_transfer_from(): Option<address> acquires RegulatedTokenPoolState {
        ownable::pending_transfer_from(&borrow_pool().ownable_state)
    }

    #[view]
    public fun pending_transfer_to(): Option<address> acquires RegulatedTokenPoolState {
        ownable::pending_transfer_to(&borrow_pool().ownable_state)
    }

    #[view]
    public fun pending_transfer_accepted(): Option<bool> acquires RegulatedTokenPoolState {
        ownable::pending_transfer_accepted(&borrow_pool().ownable_state)
    }

    public entry fun transfer_ownership(caller: &signer, to: address) acquires RegulatedTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::transfer_ownership(caller, &mut pool.ownable_state, to)
    }

    public entry fun accept_ownership(caller: &signer) acquires RegulatedTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::accept_ownership(caller, &mut pool.ownable_state)
    }

    public entry fun execute_ownership_transfer(
        caller: &signer, to: address
    ) acquires RegulatedTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::execute_ownership_transfer(caller, &mut pool.ownable_state, to)
    }

    // ================================================================
    // |                      MCMS entrypoint                         |
    // ================================================================
    struct McmsCallback has drop {}

    public fun mcms_entrypoint<T: key>(
        _metadata: object::Object<T>
    ): option::Option<u128> acquires RegulatedTokenPoolState {
        let (caller, function, data) =
            mcms_registry::get_callback_params(@regulated_token_pool, McmsCallback {});

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
}
`

export const REGULATED_TOKEN_MOVE_TOML = `[package]
name = "RegulatedToken"
version = "1.0.0"
authors = []

[addresses]
regulated_token = "_"
admin = "_"

[dependencies]
AptosFramework = { git = "https://github.com/aptos-labs/aptos-core.git", rev = "16beac69835f3a71564c96164a606a23f259099a", subdir = "aptos-move/framework/aptos-framework" }
`

// prettier-ignore
export const REGULATED_TOKEN_MOVE = "module regulated_token::regulated_token {\n    use std::event;\n    use std::fungible_asset::{\n        Self,\n        BurnRef,\n        FungibleAsset,\n        Metadata,\n        MintRef,\n        TransferRef,\n        RawBalanceRef,\n        RawSupplyRef,\n        MutateMetadataRef\n    };\n    use std::object::{\n        Self,\n        ExtendRef,\n        Object,\n        TransferRef as ObjectTransferRef\n    };\n    use std::option::{Self, Option};\n    use std::primary_fungible_store;\n    use std::account;\n    use std::signer;\n    use std::string::{Self, String};\n    use std::dispatchable_fungible_asset;\n    use std::function_info;\n    use std::big_ordered_map::{Self, BigOrderedMap};\n\n    use regulated_token::access_control::{Self};\n    use regulated_token::ownable::{Self, OwnableState};\n\n    const TOKEN_STATE_SEED: vector<u8> = b\"regulated_token::regulated_token::token_state\";\n\n    const PAUSER_ROLE: u8 = 0;\n    const UNPAUSER_ROLE: u8 = 1;\n    const FREEZER_ROLE: u8 = 2;\n    const UNFREEZER_ROLE: u8 = 3;\n    const MINTER_ROLE: u8 = 4;\n    const BURNER_ROLE: u8 = 5;\n    const BRIDGE_MINTER_OR_BURNER_ROLE: u8 = 6;\n    const RECOVERY_ROLE: u8 = 7;\n\n    enum Role has copy, drop, store {\n        PAUSER_ROLE,\n        UNPAUSER_ROLE,\n        FREEZER_ROLE,\n        UNFREEZER_ROLE,\n        MINTER_ROLE,\n        BURNER_ROLE,\n        BRIDGE_MINTER_OR_BURNER_ROLE,\n        RECOVERY_ROLE\n    }\n\n    #[resource_group_member(group = aptos_framework::object::ObjectGroup)]\n    struct TokenStateDeployment has key {\n        extend_ref: ExtendRef,\n        transfer_ref: ObjectTransferRef,\n        paused: bool,\n        frozen_accounts: BigOrderedMap<address, bool>,\n        ownable_state: OwnableState\n    }\n\n    #[resource_group_member(group = aptos_framework::object::ObjectGroup)]\n    struct TokenState has key {\n        extend_ref: ExtendRef,\n        transfer_ref: ObjectTransferRef,\n        paused: bool,\n        frozen_accounts: BigOrderedMap<address, bool>,\n        ownable_state: OwnableState,\n        token: Object<Metadata>\n    }\n\n    #[resource_group_member(group = aptos_framework::object::ObjectGroup)]\n    struct TokenMetadataRefs has key {\n        extend_ref: ExtendRef,\n        mint_ref: MintRef,\n        burn_ref: BurnRef,\n        transfer_ref: TransferRef,\n        raw_balance_ref: RawBalanceRef,\n        raw_supply_ref: RawSupplyRef,\n        mutate_metadata_ref: MutateMetadataRef\n    }\n\n    #[event]\n    struct InitializeToken has drop, store {\n        publisher: address,\n        token: Object<Metadata>,\n        max_supply: Option<u128>,\n        decimals: u8,\n        icon: String,\n        project: String\n    }\n\n    #[event]\n    struct NativeMint has drop, store {\n        minter: address,\n        to: address,\n        amount: u64\n    }\n\n    #[event]\n    struct BridgeMint has drop, store {\n        minter: address,\n        to: address,\n        amount: u64\n    }\n\n    #[event]\n    struct NativeBurn has drop, store {\n        burner: address,\n        from: address,\n        amount: u64\n    }\n\n    #[event]\n    struct BridgeBurn has drop, store {\n        burner: address,\n        from: address,\n        amount: u64\n    }\n\n    #[event]\n    struct MinterAdded<R> has drop, store {\n        admin: address,\n        minter: address,\n        role: R,\n        operation_type: u8\n    }\n\n    #[event]\n    struct Paused has drop, store {\n        pauser: address\n    }\n\n    #[event]\n    struct Unpaused has drop, store {\n        unpauser: address\n    }\n\n    #[event]\n    struct AccountFrozen has drop, store {\n        freezer: address,\n        account: address\n    }\n\n    #[event]\n    struct AccountUnfrozen has drop, store {\n        unfreezer: address,\n        account: address\n    }\n\n    #[event]\n    struct TokensRecovered has drop, store {\n        caller: address,\n        token_metadata: Object<Metadata>,\n        from: address,\n        to: address,\n        amount: u64\n    }\n\n    /// The caller is not the signer of this contract\n    const E_NOT_PUBLISHER: u64 = 1;\n    /// TokenState has not been initialized yet\n    const E_TOKEN_NOT_INITIALIZED: u64 = 2;\n    /// Caller must have either BURNER_ROLE or BRIDGE_MINTER_OR_BURNER_ROLE\n    const E_ONLY_BURNER_OR_BRIDGE: u64 = 3;\n    /// Caller must have either MINTER_ROLE or BRIDGE_MINTER_OR_BURNER_ROLE\n    const E_ONLY_MINTER_OR_BRIDGE: u64 = 4;\n    /// Invalid fungible asset for transfer ref\n    const E_INVALID_ASSET: u64 = 5;\n    /// Zero address (0x0) is not allowed\n    const E_ZERO_ADDRESS_NOT_ALLOWED: u64 = 6;\n    /// Cannot transfer tokens to the regulated token contract address\n    const E_CANNOT_TRANSFER_TO_REGULATED_TOKEN: u64 = 7;\n    /// Contract is paused\n    const E_PAUSED: u64 = 8;\n    /// Account is frozen and cannot perform token operations\n    const E_ACCOUNT_FROZEN: u64 = 9;\n    /// Contract is already paused\n    const E_ALREADY_PAUSED: u64 = 14;\n    /// Contract is not paused\n    const E_NOT_PAUSED: u64 = 15;\n    /// Invalid role number provided\n    const E_INVALID_ROLE_NUMBER: u64 = 10;\n    /// Invalid fungible store provided for token metadata\n    const E_INVALID_STORE: u64 = 11;\n    /// Fungible store does not exist for this account\n    const E_STORE_DOES_NOT_EXIST: u64 = 12;\n    /// TokenState deployment has already been initialized\n    const E_TOKEN_STATE_DEPLOYMENT_ALREADY_INITIALIZED: u64 = 13;\n    /// Account msut be frozen for recovery\n    const E_ACCOUNT_MUST_BE_FROZEN_FOR_RECOVERY: u64 = 14;\n\n    #[view]\n    public fun type_and_version(): String {\n        string::utf8(b\"RegulatedToken 1.0.0\")\n    }\n\n    #[view]\n    public fun token_state_address(): address {\n        token_state_address_internal()\n    }\n\n    #[view]\n    public fun token_state_object(): Object<TokenState> {\n        token_state_object_internal()\n    }\n\n    #[view]\n    public fun admin(): address {\n        access_control::admin<TokenState, Role>(token_state_object_internal())\n    }\n\n    #[view]\n    public fun pending_admin(): address {\n        access_control::pending_admin<TokenState, Role>(token_state_object_internal())\n    }\n\n    inline fun token_state_object_internal(): Object<TokenState> {\n        let token_state_address = token_state_address_internal();\n        assert!(exists<TokenState>(token_state_address), E_TOKEN_NOT_INITIALIZED);\n        object::address_to_object(token_state_address)\n    }\n\n    inline fun token_state_address_internal(): address {\n        object::create_object_address(&@regulated_token, TOKEN_STATE_SEED)\n    }\n\n    #[view]\n    public fun token_address(): address acquires TokenState {\n        object::object_address(&token_metadata_internal())\n    }\n\n    #[view]\n    public fun token_metadata(): Object<Metadata> acquires TokenState {\n        token_metadata_internal()\n    }\n\n    inline fun token_metadata_from_state_obj(\n        state_obj: Object<TokenState>\n    ): Object<Metadata> {\n        TokenState[object::object_address(&state_obj)].token\n    }\n\n    inline fun token_metadata_internal(): Object<Metadata> {\n        let state_address = token_state_address_internal();\n        assert!(exists<TokenState>(state_address), E_TOKEN_NOT_INITIALIZED);\n        TokenState[state_address].token\n    }\n\n    #[view]\n    public fun is_paused(): bool acquires TokenState {\n        TokenState[token_state_address_internal()].paused\n    }\n\n    #[view]\n    public fun get_role_members(role_number: u8): vector<address> {\n        let role = get_role(role_number);\n        access_control::get_role_members(token_state_object_internal(), role)\n    }\n\n    #[view]\n    public fun get_role_member_count(role_number: u8): u64 {\n        let role = get_role(role_number);\n        access_control::get_role_member_count(token_state_object_internal(), role)\n    }\n\n    #[view]\n    public fun get_role_member(role_number: u8, index: u64): address {\n        let role = get_role(role_number);\n        access_control::get_role_member(token_state_object_internal(), role, index)\n    }\n\n    #[view]\n    public fun get_admin(): address {\n        access_control::admin<TokenState, Role>(token_state_object_internal())\n    }\n\n    #[view]\n    public fun get_minters(): vector<address> {\n        access_control::get_role_members(token_state_object_internal(), minter_role())\n    }\n\n    #[view]\n    public fun get_bridge_minters_or_burners(): vector<address> {\n        access_control::get_role_members(\n            token_state_object_internal(), bridge_minter_or_burner_role()\n        )\n    }\n\n    #[view]\n    public fun get_burners(): vector<address> {\n        access_control::get_role_members(token_state_object_internal(), burner_role())\n    }\n\n    #[view]\n    public fun get_freezers(): vector<address> {\n        access_control::get_role_members(token_state_object_internal(), freezer_role())\n    }\n\n    #[view]\n    public fun get_unfreezers(): vector<address> {\n        access_control::get_role_members(\n            token_state_object_internal(), unfreezer_role()\n        )\n    }\n\n    #[view]\n    public fun get_pausers(): vector<address> {\n        access_control::get_role_members(token_state_object_internal(), pauser_role())\n    }\n\n    #[view]\n    public fun get_unpausers(): vector<address> {\n        access_control::get_role_members(\n            token_state_object_internal(), unpauser_role()\n        )\n    }\n\n    #[view]\n    public fun get_recovery_managers(): vector<address> {\n        access_control::get_role_members(\n            token_state_object_internal(), recovery_role()\n        )\n    }\n\n    #[view]\n    public fun get_pending_admin(): address {\n        access_control::pending_admin<TokenState, Role>(token_state_object_internal())\n    }\n\n    #[view]\n    public fun is_frozen(account: address): bool acquires TokenState {\n        TokenState[token_state_address_internal()].frozen_accounts.contains(&account)\n    }\n\n    #[view]\n    /// Get frozen accounts paginated using a start key and limit.\n    /// Caller should call this on a certain block to ensure you the same state for every call.\n    ///\n    /// This function retrieves a batch of frozen account addresses from the registry, starting from\n    /// the account address that comes after the provided start_key.\n    ///\n    /// @param start_key - Address to start pagination from (returns accounts AFTER this address)\n    /// @param max_count - Maximum number of accounts to return\n    ///\n    /// @return:\n    ///   - vector<address>: List of frozen account addresses (up to max_count)\n    ///   - address: Next key to use for pagination (pass this as start_key in next call)\n    ///   - bool: Whether there are more accounts after this batch\n    public fun get_all_frozen_accounts(\n        start_key: address, max_count: u64\n    ): (vector<address>, address, bool) acquires TokenState {\n        let frozen_accounts = &TokenState[token_state_address_internal()].frozen_accounts;\n        let result = vector[];\n\n        let current_key_opt = frozen_accounts.next_key(&start_key);\n        if (max_count == 0 || current_key_opt.is_none()) {\n            return (result, start_key, current_key_opt.is_some())\n        };\n\n        let current_key = *current_key_opt.borrow();\n\n        result.push_back(current_key);\n\n        for (_i in 1..max_count) {\n            let next_key_opt = frozen_accounts.next_key(&current_key);\n            if (next_key_opt.is_none()) {\n                return (result, current_key, false)\n            };\n\n            current_key = *next_key_opt.borrow();\n            result.push_back(current_key);\n        };\n\n        // Check if there are more accounts after the last key\n        let has_more = frozen_accounts.next_key(&current_key).is_some();\n        (result, current_key, has_more)\n    }\n\n    #[view]\n    public fun has_role(account: address, role: u8): bool {\n        access_control::has_role(token_state_object_internal(), account, get_role(role))\n    }\n\n    public fun deposit<T: key>(\n        store: Object<T>, fa: FungibleAsset, transfer_ref: &TransferRef\n    ) acquires TokenState {\n        let state_obj = token_state_object_internal();\n        let token_metadata = token_metadata_from_state_obj(state_obj);\n        let token_state = &TokenState[object::object_address(&state_obj)];\n\n        assert_not_paused(token_state);\n        assert_not_frozen(object::owner(store), token_state);\n        assert_correct_asset(transfer_ref, token_metadata, store);\n\n        fungible_asset::deposit_with_ref(transfer_ref, store, fa);\n    }\n\n    public fun withdraw<T: key>(\n        store: Object<T>, amount: u64, transfer_ref: &TransferRef\n    ): FungibleAsset acquires TokenState {\n        let state_obj = token_state_object_internal();\n        let token_metadata = token_metadata_from_state_obj(state_obj);\n        let token_state = &TokenState[object::object_address(&state_obj)];\n\n        assert_not_paused(token_state);\n        assert_not_frozen(object::owner(store), token_state);\n        assert_correct_asset(transfer_ref, token_metadata, store);\n\n        fungible_asset::withdraw_with_ref(transfer_ref, store, amount)\n    }\n\n    /// `publisher` is the code object, deployed through object_code_deployment\n    fun init_module(publisher: &signer) {\n        assert!(object::is_object(@regulated_token), E_NOT_PUBLISHER);\n\n        // Create object owned by code object\n        let constructor_ref = &object::create_named_object(publisher, TOKEN_STATE_SEED);\n        let token_state_signer = &object::generate_signer(constructor_ref);\n\n        // Create an Account on the object for event handles.\n        account::create_account_if_does_not_exist(signer::address_of(token_state_signer));\n\n        move_to(\n            token_state_signer,\n            TokenStateDeployment {\n                extend_ref: object::generate_extend_ref(constructor_ref),\n                transfer_ref: object::generate_transfer_ref(constructor_ref),\n                paused: false,\n                frozen_accounts: big_ordered_map::new_with_config(0, 0, false),\n                ownable_state: ownable::new(token_state_signer, @regulated_token)\n            }\n        );\n\n        // Initialize the access control module with `@admin` as the admin\n        access_control::init<Role>(constructor_ref, @admin);\n    }\n\n    /// Only owner of this code object can initialize a token once\n    public entry fun initialize(\n        publisher: &signer,\n        max_supply: Option<u128>,\n        name: String,\n        symbol: String,\n        decimals: u8,\n        icon: String,\n        project: String\n    ) acquires TokenStateDeployment {\n        let publisher_addr = signer::address_of(publisher);\n        let token_state_address = token_state_address_internal();\n\n        assert!(\n            exists<TokenStateDeployment>(token_state_address),\n            E_TOKEN_STATE_DEPLOYMENT_ALREADY_INITIALIZED\n        );\n\n        let TokenStateDeployment {\n            extend_ref,\n            transfer_ref,\n            paused,\n            frozen_accounts,\n            ownable_state\n        } = move_from<TokenStateDeployment>(token_state_address);\n\n        ownable::assert_only_owner(publisher_addr, &ownable_state);\n\n        let token_state_signer = &object::generate_signer_for_extending(&extend_ref);\n\n        // Code object owns token state, which owns the fungible asset\n        // Code object => token state => fungible asset\n        let constructor_ref =\n            &object::create_named_object(token_state_signer, *symbol.bytes());\n        primary_fungible_store::create_primary_store_enabled_fungible_asset(\n            constructor_ref,\n            max_supply,\n            name,\n            symbol,\n            decimals,\n            icon,\n            project\n        );\n\n        fungible_asset::set_untransferable(constructor_ref);\n\n        move_to(\n            &object::generate_signer(constructor_ref),\n            TokenMetadataRefs {\n                extend_ref: object::generate_extend_ref(constructor_ref),\n                mint_ref: fungible_asset::generate_mint_ref(constructor_ref),\n                burn_ref: fungible_asset::generate_burn_ref(constructor_ref),\n                transfer_ref: fungible_asset::generate_transfer_ref(constructor_ref),\n                raw_balance_ref: fungible_asset::generate_raw_balance_ref(constructor_ref),\n                raw_supply_ref: fungible_asset::generate_raw_supply_ref(constructor_ref),\n                mutate_metadata_ref: fungible_asset::generate_mutate_metadata_ref(\n                    constructor_ref\n                )\n            }\n        );\n\n        // Set up dynamic dispatch functions\n        let deposit =\n            function_info::new_function_info_from_address(\n                @regulated_token,\n                string::utf8(b\"regulated_token\"),\n                string::utf8(b\"deposit\")\n            );\n        let withdraw =\n            function_info::new_function_info_from_address(\n                @regulated_token,\n                string::utf8(b\"regulated_token\"),\n                string::utf8(b\"withdraw\")\n            );\n        dispatchable_fungible_asset::register_dispatch_functions(\n            constructor_ref,\n            option::some(withdraw),\n            option::some(deposit),\n            option::none()\n        );\n\n        let token = object::object_from_constructor_ref(constructor_ref);\n        event::emit(\n            InitializeToken {\n                publisher: publisher_addr,\n                token,\n                max_supply,\n                decimals,\n                icon,\n                project\n            }\n        );\n\n        move_to(\n            token_state_signer,\n            TokenState {\n                extend_ref,\n                transfer_ref,\n                paused,\n                frozen_accounts,\n                ownable_state,\n                token\n            }\n        );\n    }\n\n    public entry fun mint(\n        caller: &signer, to: address, amount: u64\n    ) acquires TokenMetadataRefs, TokenState {\n        let state_obj = token_state_object_internal();\n        let token_state = &TokenState[object::object_address(&state_obj)];\n\n        assert_not_paused(token_state);\n        assert_not_frozen(to, token_state);\n\n        let minter = signer::address_of(caller);\n        let is_bridge_minter =\n            access_control::has_role(state_obj, minter, bridge_minter_or_burner_role());\n        let is_native_minter = access_control::has_role(state_obj, minter, minter_role());\n\n        assert!(is_bridge_minter || is_native_minter, E_ONLY_MINTER_OR_BRIDGE);\n\n        primary_fungible_store::mint(&borrow_token_metadata_refs().mint_ref, to, amount);\n\n        if (is_bridge_minter) {\n            event::emit(BridgeMint { minter, to, amount });\n        } else {\n            event::emit(NativeMint { minter, to, amount });\n        };\n    }\n\n    public entry fun burn(\n        caller: &signer, from: address, amount: u64\n    ) acquires TokenMetadataRefs, TokenState {\n        let state_obj = token_state_object_internal();\n        let token_state = &TokenState[object::object_address(&state_obj)];\n\n        assert_not_paused(token_state);\n        assert_not_frozen(from, token_state);\n\n        let burner = signer::address_of(caller);\n        let (is_bridge_burner, _) = assert_burner_and_get_type(burner, state_obj);\n\n        primary_fungible_store::burn(\n            &borrow_token_metadata_refs().burn_ref, from, amount\n        );\n\n        if (is_bridge_burner) {\n            event::emit(BridgeBurn { burner, from, amount });\n        } else {\n            event::emit(NativeBurn { burner, from, amount });\n        }\n    }\n\n    /// Bridge-specific function to mint tokens directly as `FungibleAsset`.\n    /// Required because this token has dynamic dispatch enabled\n    /// as minting to pool and calling `fungible_asset::withdraw()` reverts.\n    /// Only callable by accounts with BRIDGE_MINTER_OR_BURNER_ROLE.\n    public fun bridge_mint(\n        caller: &signer, to: address, amount: u64\n    ): FungibleAsset acquires TokenMetadataRefs, TokenState {\n        let state_obj = token_state_object_internal();\n        let token_state = &TokenState[object::object_address(&state_obj)];\n\n        assert_not_paused(token_state);\n        assert_bridge_minter_or_burner(caller, state_obj);\n        assert_not_frozen(to, token_state);\n\n        let fa = fungible_asset::mint(&borrow_token_metadata_refs().mint_ref, amount);\n\n        event::emit(BridgeMint { minter: signer::address_of(caller), to, amount });\n\n        fa\n    }\n\n    /// Bridge-specific function to burn `FungibleAsset` directly.\n    /// Required because this token has dynamic dispatch enabled\n    /// as depositing to pool and calling `fungible_asset::deposit()` reverts.\n    /// Only callable by accounts with BRIDGE_MINTER_OR_BURNER_ROLE.\n    public fun bridge_burn(\n        caller: &signer, from: address, fa: FungibleAsset\n    ) acquires TokenMetadataRefs, TokenState {\n        let state_obj = token_state_object_internal();\n        let token_state = &TokenState[object::object_address(&state_obj)];\n\n        assert_not_paused(token_state);\n        assert_bridge_minter_or_burner(caller, state_obj);\n        assert_not_frozen(from, token_state);\n\n        let amount = fungible_asset::amount(&fa);\n        fungible_asset::burn(&borrow_token_metadata_refs().burn_ref, fa);\n\n        event::emit(BridgeBurn { burner: signer::address_of(caller), from, amount });\n    }\n\n    fun freeze_account_internal(\n        caller_addr: address,\n        account: address,\n        transfer_ref: &TransferRef,\n        token_state: &mut TokenState\n    ) {\n        // Ensure the account is frozen at the primary store level\n        primary_fungible_store::set_frozen_flag(transfer_ref, account, true);\n\n        if (!token_state.frozen_accounts.contains(&account)) {\n            token_state.frozen_accounts.add(account, true);\n        };\n\n        event::emit(AccountFrozen { freezer: caller_addr, account });\n    }\n\n    fun unfreeze_account_internal(\n        caller_addr: address,\n        account: address,\n        transfer_ref: &TransferRef,\n        token_state: &mut TokenState\n    ) {\n        // Ensure the account is unfrozen at the primary store level\n        primary_fungible_store::set_frozen_flag(transfer_ref, account, false);\n\n        if (token_state.frozen_accounts.contains(&account)) {\n            token_state.frozen_accounts.remove(&account);\n        };\n\n        event::emit(AccountUnfrozen { unfreezer: caller_addr, account });\n    }\n\n    fun burn_frozen_funds_internal(\n        burner: address,\n        account: address,\n        burn_ref: &BurnRef,\n        token_metadata: Object<Metadata>,\n        is_frozen: bool,\n        is_bridge_burner: bool\n    ) {\n        if (is_frozen) {\n            let balance = primary_fungible_store::balance(account, token_metadata);\n            if (balance > 0) {\n                primary_fungible_store::burn(burn_ref, account, balance);\n                if (is_bridge_burner) {\n                    event::emit(BridgeBurn { burner, from: account, amount: balance });\n                } else {\n                    event::emit(NativeBurn { burner, from: account, amount: balance });\n                };\n            };\n        };\n    }\n\n    fun recover_frozen_funds_internal(\n        caller: address,\n        from: address,\n        to: address,\n        transfer_ref: &TransferRef,\n        token_state: &TokenState\n    ) {\n        assert!(\n            token_state.frozen_accounts.contains(&from),\n            E_ACCOUNT_MUST_BE_FROZEN_FOR_RECOVERY\n        );\n\n        let balance = primary_fungible_store::balance(from, token_state.token);\n        if (balance > 0) {\n            primary_fungible_store::transfer_with_ref(transfer_ref, from, to, balance);\n            event::emit(\n                TokensRecovered {\n                    caller,\n                    token_metadata: token_state.token,\n                    from,\n                    to,\n                    amount: balance\n                }\n            );\n        };\n    }\n\n    /// Periphery function to apply roles to accounts\n    public entry fun grant_role(\n        caller: &signer, role_number: u8, account: address\n    ) {\n        let role = get_role(role_number);\n\n        access_control::grant_role(\n            caller,\n            token_state_object_internal(),\n            role,\n            account\n        );\n\n        if (role == minter_role() || role == bridge_minter_or_burner_role()) {\n            event::emit(\n                MinterAdded {\n                    admin: signer::address_of(caller),\n                    minter: account,\n                    role,\n                    operation_type: role_number\n                }\n            );\n        }\n    }\n\n    public entry fun revoke_role(\n        caller: &signer, role_number: u8, account: address\n    ) {\n        let role = get_role(role_number);\n        access_control::revoke_role(\n            caller,\n            token_state_object_internal(),\n            role,\n            account\n        );\n    }\n\n    public entry fun freeze_accounts(\n        caller: &signer, accounts: vector<address>\n    ) acquires TokenMetadataRefs, TokenState {\n        let state_obj = token_state_object_internal();\n        assert_freezer(caller, state_obj);\n\n        let caller_addr = signer::address_of(caller);\n        let transfer_ref = &borrow_token_metadata_refs().transfer_ref;\n        for (i in 0..accounts.length()) {\n            freeze_account_internal(\n                caller_addr,\n                accounts[i],\n                transfer_ref,\n                &mut TokenState[object::object_address(&state_obj)]\n            );\n        };\n    }\n\n    public entry fun freeze_account(\n        caller: &signer, account: address\n    ) acquires TokenMetadataRefs, TokenState {\n        let state_obj = token_state_object_internal();\n        assert_freezer(caller, state_obj);\n\n        let transfer_ref = &borrow_token_metadata_refs().transfer_ref;\n        freeze_account_internal(\n            signer::address_of(caller),\n            account,\n            transfer_ref,\n            &mut TokenState[object::object_address(&state_obj)]\n        );\n    }\n\n    public entry fun unfreeze_accounts(\n        caller: &signer, accounts: vector<address>\n    ) acquires TokenMetadataRefs, TokenState {\n        let state_obj = token_state_object_internal();\n        assert_unfreezer(caller, state_obj);\n\n        let caller_addr = signer::address_of(caller);\n        let transfer_ref = &borrow_token_metadata_refs().transfer_ref;\n        for (i in 0..accounts.length()) {\n            unfreeze_account_internal(\n                caller_addr,\n                accounts[i],\n                transfer_ref,\n                &mut TokenState[object::object_address(&state_obj)]\n            );\n        };\n    }\n\n    public entry fun unfreeze_account(\n        caller: &signer, account: address\n    ) acquires TokenMetadataRefs, TokenState {\n        let state_obj = token_state_object_internal();\n        assert_unfreezer(caller, state_obj);\n\n        let transfer_ref = &borrow_token_metadata_refs().transfer_ref;\n        unfreeze_account_internal(\n            signer::address_of(caller),\n            account,\n            transfer_ref,\n            &mut TokenState[object::object_address(&state_obj)]\n        );\n    }\n\n    /// Batch revoke and grant roles by role number\n    /// `batch_revoke_role` and `batch_grant_role` assert that the caller is the admin\n    public entry fun apply_role_updates(\n        caller: &signer,\n        role_number: u8,\n        addresses_to_remove: vector<address>,\n        addresses_to_add: vector<address>\n    ) {\n        let role = get_role(role_number);\n        let state_obj = token_state_object_internal();\n\n        if (addresses_to_remove.length() > 0) {\n            access_control::batch_revoke_role(\n                caller,\n                state_obj,\n                role,\n                addresses_to_remove\n            );\n        };\n\n        if (addresses_to_add.length() > 0) {\n            access_control::batch_grant_role(caller, state_obj, role, addresses_to_add);\n        };\n    }\n\n    public entry fun pause(caller: &signer) acquires TokenState {\n        let state_obj = token_state_object_internal();\n        assert_pauser(caller, state_obj);\n\n        let state = &mut TokenState[object::object_address(&state_obj)];\n        assert!(!state.paused, E_ALREADY_PAUSED);\n\n        state.paused = true;\n        event::emit(Paused { pauser: signer::address_of(caller) });\n    }\n\n    public entry fun unpause(caller: &signer) acquires TokenState {\n        let state_obj = token_state_object_internal();\n        assert_unpauser(caller, state_obj);\n\n        let state = &mut TokenState[object::object_address(&state_obj)];\n        assert!(state.paused, E_NOT_PAUSED);\n\n        state.paused = false;\n        event::emit(Unpaused { unpauser: signer::address_of(caller) });\n    }\n\n    /// Validates and sets up burn frozen funds operation.\n    inline fun validate_burn_frozen_funds(\n        caller: &signer\n    ): (\n        address, &BurnRef, Object<Metadata>, &TokenState, bool\n    ) {\n        let state_obj = token_state_object_internal();\n        let token_state = &TokenState[object::object_address(&state_obj)];\n        assert_not_paused(token_state);\n\n        let burner = signer::address_of(caller);\n        let (is_bridge_burner, _) = assert_burner_and_get_type(burner, state_obj);\n        let token_metadata = token_metadata_from_state_obj(state_obj);\n        let burn_ref = &borrow_token_metadata_refs().burn_ref;\n\n        (\n            burner, burn_ref, token_metadata, token_state, is_bridge_burner\n        )\n    }\n\n    public entry fun batch_burn_frozen_funds(\n        caller: &signer, accounts: vector<address>\n    ) acquires TokenMetadataRefs, TokenState {\n        let (\n            burner, burn_ref, token_metadata, token_state, is_bridge_burner\n        ) = validate_burn_frozen_funds(caller);\n\n        for (i in 0..accounts.length()) {\n            burn_frozen_funds_internal(\n                burner,\n                accounts[i],\n                burn_ref,\n                token_metadata,\n                token_state.frozen_accounts.contains(&accounts[i]),\n                is_bridge_burner\n            );\n        };\n    }\n\n    public entry fun burn_frozen_funds(\n        caller: &signer, from: address\n    ) acquires TokenMetadataRefs, TokenState {\n        let (\n            burner, burn_ref, token_metadata, token_state, is_bridge_burner\n        ) = validate_burn_frozen_funds(caller);\n\n        burn_frozen_funds_internal(\n            burner,\n            from,\n            burn_ref,\n            token_metadata,\n            token_state.frozen_accounts.contains(&from),\n            is_bridge_burner\n        );\n    }\n\n    /// Recovers funds from frozen accounts by transferring them to a specified account.\n    /// Only callable by accounts with RECOVERY_ROLE.\n    public entry fun recover_frozen_funds(\n        caller: &signer, from: address, to: address\n    ) acquires TokenMetadataRefs, TokenState {\n        let (transfer_ref, token_state) = validate_recovery_procedure(caller, to);\n        recover_frozen_funds_internal(\n            signer::address_of(caller),\n            from,\n            to,\n            transfer_ref,\n            token_state\n        );\n    }\n\n    /// Batch version of recover_frozen_funds for processing multiple frozen accounts.\n    /// Only callable by accounts with RECOVERY_ROLE.\n    public entry fun batch_recover_frozen_funds(\n        caller: &signer, accounts: vector<address>, to: address\n    ) acquires TokenMetadataRefs, TokenState {\n        let caller_addr = signer::address_of(caller);\n        let (transfer_ref, token_state) = validate_recovery_procedure(caller, to);\n\n        for (i in 0..accounts.length()) {\n            recover_frozen_funds_internal(\n                caller_addr,\n                accounts[i],\n                to,\n                transfer_ref,\n                token_state\n            );\n        };\n    }\n\n    inline fun assert_valid_recovery_recipient(\n        to: address, token_state: &TokenState\n    ) {\n        assert!(to != @0x0, E_ZERO_ADDRESS_NOT_ALLOWED);\n        assert!(\n            to != @regulated_token && to != token_state_address_internal(),\n            E_CANNOT_TRANSFER_TO_REGULATED_TOKEN\n        );\n        assert_not_frozen(to, token_state);\n    }\n\n    inline fun validate_recovery_procedure(caller: &signer, to: address)\n        : (&TransferRef, &TokenState) {\n        let state_obj = token_state_object_internal();\n        let token_state = &TokenState[object::object_address(&state_obj)];\n\n        assert_not_paused(token_state);\n        assert_recovery_role(caller, state_obj);\n        assert_valid_recovery_recipient(to, token_state);\n\n        (&borrow_token_metadata_refs().transfer_ref, token_state)\n    }\n\n    public entry fun transfer_admin(caller: &signer, new_admin: address) {\n        access_control::transfer_admin<TokenState, Role>(\n            caller, token_state_object_internal(), new_admin\n        );\n    }\n\n    public entry fun accept_admin(caller: &signer) {\n        access_control::accept_admin<TokenState, Role>(\n            caller, token_state_object_internal()\n        );\n    }\n\n    /// Helper function to recover tokens from a specific address\n    fun recover_tokens_from_address(\n        caller_addr: address,\n        from: address,\n        to: address,\n        transfer_ref: &TransferRef\n    ) {\n        let token_metadata = fungible_asset::transfer_ref_metadata(transfer_ref);\n        let balance = primary_fungible_store::balance(from, token_metadata);\n        if (balance > 0) {\n            primary_fungible_store::transfer_with_ref(transfer_ref, from, to, balance);\n            event::emit(\n                TokensRecovered {\n                    caller: caller_addr,\n                    token_metadata,\n                    from,\n                    to,\n                    amount: balance\n                }\n            );\n        }\n    }\n\n    /// In case regulated tokens get stuck in the contract or token state, this function can be used to recover them\n    /// This function can only be called by the recovery role\n    public entry fun recover_tokens(\n        caller: &signer, to: address\n    ) acquires TokenMetadataRefs, TokenState {\n        let (transfer_ref, _token_state) = validate_recovery_procedure(caller, to);\n        let caller_addr = signer::address_of(caller);\n\n        // Recover regulated tokens sent to contract\n        recover_tokens_from_address(\n            caller_addr,\n            @regulated_token,\n            to,\n            transfer_ref\n        );\n\n        // Recover regulated tokens sent to token state address\n        recover_tokens_from_address(\n            caller_addr,\n            token_state_address_internal(),\n            to,\n            transfer_ref\n        );\n    }\n\n    fun assert_not_paused(token_state: &TokenState) {\n        assert!(!token_state.paused, E_PAUSED);\n    }\n\n    inline fun assert_pauser(\n        caller: &signer, state_obj: Object<TokenState>\n    ) {\n        access_control::assert_role(\n            state_obj, signer::address_of(caller), pauser_role()\n        );\n    }\n\n    inline fun assert_unpauser(\n        caller: &signer, state_obj: Object<TokenState>\n    ) {\n        access_control::assert_role(\n            state_obj, signer::address_of(caller), unpauser_role()\n        );\n    }\n\n    inline fun assert_freezer(\n        caller: &signer, state_obj: Object<TokenState>\n    ) {\n        access_control::assert_role(\n            state_obj, signer::address_of(caller), freezer_role()\n        );\n    }\n\n    inline fun assert_unfreezer(\n        caller: &signer, state_obj: Object<TokenState>\n    ) {\n        access_control::assert_role(\n            state_obj, signer::address_of(caller), unfreezer_role()\n        );\n    }\n\n    inline fun assert_recovery_role(\n        caller: &signer, state_obj: Object<TokenState>\n    ) {\n        access_control::assert_role(\n            state_obj, signer::address_of(caller), recovery_role()\n        );\n    }\n\n    fun assert_bridge_minter_or_burner(\n        caller: &signer, state_obj: Object<TokenState>\n    ) {\n        access_control::assert_role(\n            state_obj,\n            signer::address_of(caller),\n            bridge_minter_or_burner_role()\n        );\n    }\n\n    inline fun assert_burner_and_get_type(\n        burner: address, state_obj: Object<TokenState>\n    ): (bool, bool) {\n        let is_bridge_burner =\n            access_control::has_role(state_obj, burner, bridge_minter_or_burner_role());\n        let is_native_burner = access_control::has_role(state_obj, burner, burner_role());\n\n        assert!(is_bridge_burner || is_native_burner, E_ONLY_BURNER_OR_BRIDGE);\n\n        (is_bridge_burner, is_native_burner)\n    }\n\n    fun assert_not_frozen(account: address, token_state: &TokenState) {\n        assert!(!token_state.frozen_accounts.contains(&account), E_ACCOUNT_FROZEN);\n    }\n\n    fun assert_correct_asset<T: key>(\n        transfer_ref: &TransferRef, token_metadata: Object<Metadata>, store: Object<T>\n    ) {\n        assert!(\n            fungible_asset::transfer_ref_metadata(transfer_ref) == token_metadata,\n            E_INVALID_ASSET\n        );\n        assert!(fungible_asset::store_metadata(store) == token_metadata, E_INVALID_STORE);\n    }\n\n    fun get_role(role_number: u8): Role {\n        if (role_number == PAUSER_ROLE) {\n            pauser_role()\n        } else if (role_number == UNPAUSER_ROLE) {\n            unpauser_role()\n        } else if (role_number == FREEZER_ROLE) {\n            freezer_role()\n        } else if (role_number == UNFREEZER_ROLE) {\n            unfreezer_role()\n        } else if (role_number == MINTER_ROLE) {\n            minter_role()\n        } else if (role_number == BURNER_ROLE) {\n            burner_role()\n        } else if (role_number == BRIDGE_MINTER_OR_BURNER_ROLE) {\n            bridge_minter_or_burner_role()\n        } else if (role_number == RECOVERY_ROLE) {\n            recovery_role()\n        } else {\n            abort E_INVALID_ROLE_NUMBER\n        }\n    }\n\n    inline fun borrow_token_metadata_refs(): &TokenMetadataRefs {\n        let token_metadata = token_metadata_internal();\n        &TokenMetadataRefs[object::object_address(&token_metadata)]\n    }\n\n    public fun pauser_role(): Role {\n        Role::PAUSER_ROLE\n    }\n\n    public fun unpauser_role(): Role {\n        Role::UNPAUSER_ROLE\n    }\n\n    public fun freezer_role(): Role {\n        Role::FREEZER_ROLE\n    }\n\n    public fun unfreezer_role(): Role {\n        Role::UNFREEZER_ROLE\n    }\n\n    public fun minter_role(): Role {\n        Role::MINTER_ROLE\n    }\n\n    public fun burner_role(): Role {\n        Role::BURNER_ROLE\n    }\n\n    public fun bridge_minter_or_burner_role(): Role {\n        Role::BRIDGE_MINTER_OR_BURNER_ROLE\n    }\n\n    public fun recovery_role(): Role {\n        Role::RECOVERY_ROLE\n    }\n\n    // ====================== Ownable Functions ======================\n    #[view]\n    public fun owner(): address acquires TokenState {\n        ownable::owner(&TokenState[token_state_address_internal()].ownable_state)\n    }\n\n    #[view]\n    public fun has_pending_transfer(): bool acquires TokenState {\n        ownable::has_pending_transfer(\n            &TokenState[token_state_address_internal()].ownable_state\n        )\n    }\n\n    #[view]\n    public fun pending_transfer_from(): Option<address> acquires TokenState {\n        ownable::pending_transfer_from(\n            &TokenState[token_state_address_internal()].ownable_state\n        )\n    }\n\n    #[view]\n    public fun pending_transfer_to(): Option<address> acquires TokenState {\n        ownable::pending_transfer_to(\n            &TokenState[token_state_address_internal()].ownable_state\n        )\n    }\n\n    #[view]\n    public fun pending_transfer_accepted(): Option<bool> acquires TokenState {\n        ownable::pending_transfer_accepted(\n            &TokenState[token_state_address_internal()].ownable_state\n        )\n    }\n\n    public entry fun transfer_ownership(caller: &signer, to: address) acquires TokenState {\n        let state = &mut TokenState[token_state_address_internal()];\n        ownable::transfer_ownership(caller, &mut state.ownable_state, to)\n    }\n\n    public entry fun accept_ownership(caller: &signer) acquires TokenState {\n        let state = &mut TokenState[token_state_address_internal()];\n        ownable::accept_ownership(caller, &mut state.ownable_state)\n    }\n\n    public entry fun execute_ownership_transfer(\n        caller: &signer, to: address\n    ) acquires TokenState {\n        let state = &mut TokenState[token_state_address_internal()];\n        ownable::execute_ownership_transfer(caller, &mut state.ownable_state, to)\n    }\n}\n";

export const REGULATED_ACCESS_CONTROL_MOVE = `module regulated_token::access_control {
    use std::event;
    use std::ordered_map::{Self, OrderedMap};
    use std::object::{Self, Object};
    use std::signer;
    use std::object::ConstructorRef;

    #[resource_group_member(group = aptos_framework::object::ObjectGroup)]
    struct AccessControlState<Role: copy + drop + store> has key, store {
        /// Mapping from role to list of addresses that have the role
        roles: OrderedMap<Role, vector<address>>,
        /// The admin address who can manage all roles
        admin: address,
        /// Pending admin for two-step admin transfer
        pending_admin: address
    }

    #[event]
    struct RoleGranted<Role: copy + drop + store> has drop, store {
        role: Role,
        account: address,
        sender: address
    }

    #[event]
    struct RoleRevoked<Role: copy + drop + store> has drop, store {
        role: Role,
        account: address,
        sender: address
    }

    #[event]
    struct TransferAdmin has drop, store {
        admin: address,
        pending_admin: address
    }

    #[event]
    struct AcceptAdmin has drop, store {
        old_admin: address,
        new_admin: address
    }

    /// Role state not initialized
    const E_ROLE_STATE_NOT_INITIALIZED: u64 = 1;
    /// Caller does not have the required role
    const E_MISSING_ROLE: u64 = 2;
    /// Caller is not the admin
    const E_NOT_ADMIN: u64 = 3;
    /// Cannot transfer admin to same address
    const E_SAME_ADMIN: u64 = 4;
    /// Index out of bounds
    const E_INDEX_OUT_OF_BOUNDS: u64 = 5;

    public fun init<Role: copy + drop + store>(
        constructor_ref: &ConstructorRef, admin: address
    ) {
        let obj_signer = object::generate_signer(constructor_ref);
        move_to(
            &obj_signer,
            AccessControlState<Role> {
                admin,
                pending_admin: @0x0,
                roles: ordered_map::new()
            }
        );
    }

    #[view]
    public fun has_role<T: key, Role: copy + drop + store>(
        state_obj: Object<T>, account: address, role: Role
    ): bool acquires AccessControlState {
        let roles = &borrow<T, Role>(state_obj).roles;
        roles.contains(&role) && roles.borrow(&role).contains(&account)
    }

    #[view]
    public fun get_role_members<T: key, Role: copy + drop + store>(
        state_obj: Object<T>, role: Role
    ): vector<address> acquires AccessControlState {
        let state = borrow(state_obj);
        if (state.roles.contains(&role)) {
            *state.roles.borrow(&role)
        } else {
            vector[]
        }
    }

    #[view]
    public fun get_role_member_count<T: key, Role: copy + drop + store>(
        state_obj: Object<T>, role: Role
    ): u64 acquires AccessControlState {
        let roles = &borrow<T, Role>(state_obj).roles;
        if (roles.contains(&role)) {
            roles.borrow(&role).length()
        } else { 0 }
    }

    #[view]
    public fun get_role_member<T: key, Role: copy + drop + store>(
        state_obj: Object<T>, role: Role, index: u64
    ): address acquires AccessControlState {
        let roles = &borrow<T, Role>(state_obj).roles;
        assert!(roles.contains(&role), E_MISSING_ROLE);

        let addresses = roles.borrow(&role);
        assert!(index < addresses.length(), E_INDEX_OUT_OF_BOUNDS);
        addresses[index]
    }

    #[view]
    public fun admin<T: key, Role: copy + drop + store>(
        state_obj: Object<T>
    ): address acquires AccessControlState {
        borrow<T, Role>(state_obj).admin
    }

    #[view]
    public fun pending_admin<T: key, Role: copy + drop + store>(
        state_obj: Object<T>
    ): address acquires AccessControlState {
        borrow<T, Role>(state_obj).pending_admin
    }

    public entry fun batch_grant_role<T: key, Role: copy + drop + store>(
        caller: &signer,
        state_obj: Object<T>,
        role: Role,
        accounts: vector<address>
    ) acquires AccessControlState {
        if (accounts.length() == 0) return;

        let state = authorized_borrow_mut<T, Role>(caller, state_obj);
        let sender = signer::address_of(caller);

        for (i in 0..accounts.length()) {
            grant_role_internal(state, role, accounts[i], sender);
        };
    }

    public entry fun grant_role<T: key, Role: copy + drop + store>(
        caller: &signer, state_obj: Object<T>, role: Role, account: address
    ) acquires AccessControlState {
        let state = authorized_borrow_mut<T, Role>(caller, state_obj);
        let sender = signer::address_of(caller);

        grant_role_internal(state, role, account, sender);
    }

    fun grant_role_internal<Role: copy + drop + store>(
        state: &mut AccessControlState<Role>,
        role: Role,
        account: address,
        sender: address
    ) {
        if (state.roles.contains(&role)) {
            let addresses = state.roles.borrow_mut(&role);
            if (!addresses.contains(&account)) {
                addresses.push_back(account);
                event::emit(RoleGranted { role, account, sender });
            }
        } else {
            state.roles.add(role, vector[account]);
            event::emit(RoleGranted { role, account, sender });
        }
    }

    public entry fun batch_revoke_role<T: key, Role: copy + drop + store>(
        caller: &signer,
        state_obj: Object<T>,
        role: Role,
        accounts: vector<address>
    ) acquires AccessControlState {
        if (accounts.length() == 0) return;

        let state = authorized_borrow_mut<T, Role>(caller, state_obj);
        let sender = signer::address_of(caller);

        for (i in 0..accounts.length()) {
            revoke_role_internal(state, role, accounts[i], sender);
        };
    }

    public entry fun revoke_role<T: key, Role: copy + drop + store>(
        caller: &signer, state_obj: Object<T>, role: Role, account: address
    ) acquires AccessControlState {
        let state = authorized_borrow_mut<T, Role>(caller, state_obj);
        let sender = signer::address_of(caller);

        revoke_role_internal(state, role, account, sender);
    }

    fun revoke_role_internal<Role: copy + drop + store>(
        state: &mut AccessControlState<Role>,
        role: Role,
        account: address,
        sender: address
    ) {
        if (state.roles.contains(&role)) {
            let addresses = state.roles.borrow_mut(&role);
            let (found, index) = addresses.index_of(&account);
            if (found) {
                addresses.remove(index);
                event::emit(RoleRevoked { role, account, sender });
            }
        }
    }

    public entry fun renounce_role<T: key, Role: copy + drop + store>(
        caller: &signer, state_obj: Object<T>, role: Role
    ) acquires AccessControlState {
        let state = borrow_mut<T, Role>(state_obj);
        let caller_addr = signer::address_of(caller);

        if (state.roles.contains(&role)) {
            let addresses = state.roles.borrow_mut(&role);
            let (found, index) = addresses.index_of(&caller_addr);
            if (found) {
                addresses.remove(index);
                event::emit(RoleRevoked { role, account: caller_addr, sender: caller_addr });
            };
        };
    }

    public fun assert_role<T: key, Role: copy + drop + store>(
        state_obj: Object<T>, caller: address, role: Role
    ) acquires AccessControlState {
        assert!(
            has_role(state_obj, caller, role),
            E_MISSING_ROLE
        );
    }

    public entry fun transfer_admin<T: key, Role: copy + drop + store>(
        admin: &signer, state_obj: Object<T>, new_admin: address
    ) acquires AccessControlState {
        let state = authorized_borrow_mut<T, Role>(admin, state_obj);
        assert!(signer::address_of(admin) != new_admin, E_SAME_ADMIN);

        state.pending_admin = new_admin;

        event::emit(TransferAdmin { admin: state.admin, pending_admin: new_admin });
    }

    public entry fun accept_admin<T: key, Role: copy + drop + store>(
        pending_admin: &signer, state_obj: Object<T>
    ) acquires AccessControlState {
        let state = borrow_mut<T, Role>(state_obj);
        let pending_admin_addr = signer::address_of(pending_admin);

        assert!(pending_admin_addr == state.pending_admin, E_NOT_ADMIN);

        let old_admin = state.admin;
        state.admin = state.pending_admin;
        state.pending_admin = @0x0;

        event::emit(AcceptAdmin { old_admin, new_admin: state.admin });
    }

    inline fun authorized_borrow_mut<T: key, Role: copy + drop + store>(
        caller: &signer, state_obj: Object<T>
    ): &mut AccessControlState<Role> {
        let state = borrow_mut<T, Role>(state_obj);
        assert!(state.admin == signer::address_of(caller), E_NOT_ADMIN);
        state
    }

    inline fun borrow_mut<T: key, Role: copy + drop + store>(
        state_obj: Object<T>
    ): &mut AccessControlState<Role> {
        let obj_addr = assert_exists<T, Role>(state_obj);
        &mut AccessControlState<Role>[obj_addr]
    }

    inline fun borrow<T: key, Role: copy + drop + store>(state_obj: Object<T>)
        : &AccessControlState<Role> {
        let obj_addr = assert_exists<T, Role>(state_obj);
        &AccessControlState<Role>[obj_addr]
    }

    inline fun assert_exists<T: key, Role: copy + drop + store>(
        state_obj: Object<T>
    ): address {
        let obj_addr = object::object_address(&state_obj);
        assert!(
            exists<AccessControlState<Role>>(obj_addr),
            E_ROLE_STATE_NOT_INITIALIZED
        );
        obj_addr
    }
}
`

export const REGULATED_OWNABLE_MOVE = `/// This module implements an Ownable component similar to Ownable2Step.sol for managing
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
module regulated_token::ownable {
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
}
`
