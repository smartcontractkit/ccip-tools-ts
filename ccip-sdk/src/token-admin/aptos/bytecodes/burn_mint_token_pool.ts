/**
 * BurnMintTokenPool Move package source files.
 *
 * Source: chainlink-aptos contracts/ccip/ccip_token_pools/burn_mint_token_pool
 * AptosFramework rev: 16beac69835f3a71564c96164a606a23f259099a
 * ChainlinkCCIP + MCMS: embedded as local dependencies
 *
 * For standard Aptos Fungible Asset tokens with BurnRef/MintRef.
 * Use managed_token_pool.ts for tokens deployed with the managed_token package.
 *
 * Vendored as source (not compiled bytecodes) because Aptos Move modules
 * must be compiled with the deployer's address at deploy time.
 *
 * Lazy-loaded via dynamic import() — same pattern as EVM BurnMintERC20 bytecode.
 */

/** Move.toml for the BurnMintTokenPool package. */
export const BURN_MINT_POOL_MOVE_TOML = `[package]
name = "BurnMintTokenPool"
version = "1.0.0"
authors = []

[addresses]
ccip = "_"
ccip_token_pool = "_"
burn_mint_token_pool = "_"
mcms = "_"
mcms_register_entrypoints = "_"
burn_mint_local_token = "_"

[dependencies]
AptosFramework = { git = "https://github.com/aptos-labs/aptos-core.git", rev = "16beac69835f3a71564c96164a606a23f259099a", subdir = "aptos-move/framework/aptos-framework" }
ChainlinkCCIP = { local = "../ccip" }
CCIPTokenPool = { local = "../token_pool" }
`

/** burn_mint_token_pool.move — pool logic (test functions stripped). */
export const BURN_MINT_TOKEN_POOL_MOVE = `module burn_mint_token_pool::burn_mint_token_pool {
    use std::account::{Self, SignerCapability};
    use std::error;
    use std::fungible_asset::{Self, FungibleAsset, Metadata, TransferRef};
    use std::primary_fungible_store;
    use std::object::{Self, Object, ObjectCore};
    use std::option::{Self, Option};
    use std::signer;
    use std::string::{Self, String};
    use std::fungible_asset::{BurnRef, MintRef};

    use ccip::token_admin_registry::{Self, ReleaseOrMintInputV1, LockOrBurnInputV1};
    use ccip_token_pool::ownable;
    use ccip_token_pool::rate_limiter;
    use ccip_token_pool::token_pool;

    use mcms::mcms_registry;
    use mcms::bcs_stream;

    const STORE_OBJECT_SEED: vector<u8> = b"CcipBurnMintTokenPool";

    struct BurnMintTokenPoolDeployment has key {
        store_signer_cap: SignerCapability,
        ownable_state: ownable::OwnableState,
        token_pool_state: token_pool::TokenPoolState
    }

    struct BurnMintTokenPoolState has key, store {
        store_signer_cap: SignerCapability,
        ownable_state: ownable::OwnableState,
        token_pool_state: token_pool::TokenPoolState,
        store_signer_address: address,
        burn_ref: Option<BurnRef>,
        mint_ref: Option<MintRef>
    }

    const E_NOT_PUBLISHER: u64 = 1;
    const E_ALREADY_INITIALIZED: u64 = 2;
    const E_INVALID_FUNGIBLE_ASSET: u64 = 3;
    const E_LOCAL_TOKEN_MISMATCH: u64 = 4;
    const E_INVALID_ARGUMENTS: u64 = 5;
    const E_UNKNOWN_FUNCTION: u64 = 6;
    const E_MINT_REF_NOT_SET: u64 = 7;
    const E_BURN_REF_NOT_SET: u64 = 8;

    // ================================================================
    // |                             Init                             |
    // ================================================================
    #[view]
    public fun type_and_version(): String {
        string::utf8(b"BurnMintTokenPool 1.6.0")
    }

    fun init_module(publisher: &signer) {
        // register the pool on deployment, because in the case of object code deployment,
        // this is the only time we have a signer ref to @ccip_burn_mint_pool.
        assert!(
            object::object_exists<Metadata>(@burn_mint_local_token),
            error::invalid_argument(E_INVALID_FUNGIBLE_ASSET)
        );
        let metadata = object::address_to_object<Metadata>(@burn_mint_local_token);

        // create an Account on the object for event handles.
        account::create_account_if_does_not_exist(@burn_mint_token_pool);

        // the name of this module. if incorrect, callbacks will fail to be registered and
        // register_pool will revert.
        let token_pool_module_name = b"burn_mint_token_pool";

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
            BurnMintTokenPoolDeployment {
                store_signer_cap,
                ownable_state: ownable::new(&store_signer, @burn_mint_token_pool),
                token_pool_state: token_pool::initialize(
                    &store_signer, @burn_mint_local_token, vector[]
                )
            }
        );
    }

    public fun initialize(
        caller: &signer, burn_ref: BurnRef, mint_ref: MintRef
    ) acquires BurnMintTokenPoolDeployment {
        assert_can_initialize(signer::address_of(caller));

        assert!(
            exists<BurnMintTokenPoolDeployment>(@burn_mint_token_pool),
            error::invalid_argument(E_ALREADY_INITIALIZED)
        );

        let metadata = object::address_to_object<Metadata>(@burn_mint_local_token);
        let burn_ref_metadata = fungible_asset::burn_ref_metadata(&burn_ref);
        let mint_ref_metadata = fungible_asset::mint_ref_metadata(&mint_ref);

        assert!(
            metadata == burn_ref_metadata && metadata == mint_ref_metadata,
            error::invalid_argument(E_LOCAL_TOKEN_MISMATCH)
        );

        let BurnMintTokenPoolDeployment {
            store_signer_cap,
            ownable_state,
            token_pool_state
        } = move_from<BurnMintTokenPoolDeployment>(@burn_mint_token_pool);

        let store_signer = account::create_signer_with_capability(&store_signer_cap);

        let pool = BurnMintTokenPoolState {
            ownable_state,
            store_signer_address: signer::address_of(&store_signer),
            store_signer_cap,
            token_pool_state,
            burn_ref: option::some(burn_ref),
            mint_ref: option::some(mint_ref)
        };

        move_to(&store_signer, pool);
    }

    public fun register_v2_callbacks(publisher: &signer) {
        assert!(
            signer::address_of(publisher) == @burn_mint_token_pool,
            error::permission_denied(E_NOT_PUBLISHER)
        );
        token_admin_registry::register_pool_v2(
            publisher,
            @burn_mint_local_token,
            lock_or_burn_v2,
            release_or_mint_v2
        );
    }

    // ================================================================
    // |                 Exposing token_pool functions                |
    // ================================================================
    #[view]
    public fun get_token(): address acquires BurnMintTokenPoolState {
        token_pool::get_token(&borrow_pool().token_pool_state)
    }

    #[view]
    public fun get_router(): address {
        token_pool::get_router()
    }

    #[view]
    public fun get_token_decimals(): u8 acquires BurnMintTokenPoolState {
        token_pool::get_token_decimals(&borrow_pool().token_pool_state)
    }

    #[view]
    public fun get_remote_pools(
        remote_chain_selector: u64
    ): vector<vector<u8>> acquires BurnMintTokenPoolState {
        token_pool::get_remote_pools(
            &borrow_pool().token_pool_state, remote_chain_selector
        )
    }

    #[view]
    public fun is_remote_pool(
        remote_chain_selector: u64, remote_pool_address: vector<u8>
    ): bool acquires BurnMintTokenPoolState {
        token_pool::is_remote_pool(
            &borrow_pool().token_pool_state,
            remote_chain_selector,
            remote_pool_address
        )
    }

    #[view]
    public fun get_remote_token(
        remote_chain_selector: u64
    ): vector<u8> acquires BurnMintTokenPoolState {
        let pool = borrow_pool();
        token_pool::get_remote_token(&pool.token_pool_state, remote_chain_selector)
    }

    public entry fun add_remote_pool(
        caller: &signer, remote_chain_selector: u64, remote_pool_address: vector<u8>
    ) acquires BurnMintTokenPoolState {
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
    ) acquires BurnMintTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::assert_only_owner(signer::address_of(caller), &pool.ownable_state);

        token_pool::remove_remote_pool(
            &mut pool.token_pool_state,
            remote_chain_selector,
            remote_pool_address
        );
    }

    #[view]
    public fun is_supported_chain(remote_chain_selector: u64): bool acquires BurnMintTokenPoolState {
        let pool = borrow_pool();
        token_pool::is_supported_chain(&pool.token_pool_state, remote_chain_selector)
    }

    #[view]
    public fun get_supported_chains(): vector<u64> acquires BurnMintTokenPoolState {
        let pool = borrow_pool();
        token_pool::get_supported_chains(&pool.token_pool_state)
    }

    public entry fun apply_chain_updates(
        caller: &signer,
        remote_chain_selectors_to_remove: vector<u64>,
        remote_chain_selectors_to_add: vector<u64>,
        remote_pool_addresses_to_add: vector<vector<vector<u8>>>,
        remote_token_addresses_to_add: vector<vector<u8>>
    ) acquires BurnMintTokenPoolState {
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
    public fun get_allowlist_enabled(): bool acquires BurnMintTokenPoolState {
        let pool = borrow_pool();
        token_pool::get_allowlist_enabled(&pool.token_pool_state)
    }

    public entry fun set_allowlist_enabled(
        caller: &signer, enabled: bool
    ) acquires BurnMintTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::assert_only_owner(signer::address_of(caller), &pool.ownable_state);
        token_pool::set_allowlist_enabled(&mut pool.token_pool_state, enabled);
    }

    #[view]
    public fun get_allowlist(): vector<address> acquires BurnMintTokenPoolState {
        let pool = borrow_pool();
        token_pool::get_allowlist(&pool.token_pool_state)
    }

    public entry fun apply_allowlist_updates(
        caller: &signer, removes: vector<address>, adds: vector<address>
    ) acquires BurnMintTokenPoolState {
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
    ) acquires BurnMintTokenPoolState {
        // retrieve the input for this lock or burn operation. if this function is invoked
        // outside of ccip::token_admin_registry, the transaction will abort.
        let input =
            token_admin_registry::get_lock_or_burn_input_v1(
                @burn_mint_token_pool, CallbackProof {}
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
        assert!(pool.burn_ref.is_some(), E_BURN_REF_NOT_SET);
        fungible_asset::burn(pool.burn_ref.borrow(), fa);

        // set the output for this lock or burn operation.
        token_admin_registry::set_lock_or_burn_output_v1(
            @burn_mint_token_pool,
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
    ): FungibleAsset acquires BurnMintTokenPoolState {
        // retrieve the input for this release or mint operation. if this function is invoked
        // outside of ccip::token_admin_registry, the transaction will abort.
        let input =
            token_admin_registry::get_release_or_mint_input_v1(
                @burn_mint_token_pool, CallbackProof {}
            );
        let pool = borrow_pool_mut();
        let local_amount =
            token_pool::calculate_release_or_mint_amount(&pool.token_pool_state, &input);

        token_pool::validate_release_or_mint(
            &mut pool.token_pool_state, &input, local_amount
        );

        // Mint the amount for release.
        assert!(pool.mint_ref.is_some(), E_MINT_REF_NOT_SET);
        let fa = fungible_asset::mint(pool.mint_ref.borrow(), local_amount);

        // set the output for this release or mint operation.
        token_admin_registry::set_release_or_mint_output_v1(
            @burn_mint_token_pool, CallbackProof {}, local_amount
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
    ): (vector<u8>, vector<u8>) acquires BurnMintTokenPoolState {
        let pool = borrow_pool_mut();
        let fa_amount = fungible_asset::amount(&fa);

        let dest_token_address =
            token_pool::validate_lock_or_burn(
                &mut pool.token_pool_state,
                &fa,
                &input,
                fa_amount
            );

        // Burn the token
        assert!(pool.burn_ref.is_some(), E_BURN_REF_NOT_SET);
        fungible_asset::burn(pool.burn_ref.borrow(), fa);

        // Emit event
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
    ): (FungibleAsset, u64) acquires BurnMintTokenPoolState {
        let pool = borrow_pool_mut();
        let local_amount =
            token_pool::calculate_release_or_mint_amount(&pool.token_pool_state, &input);

        token_pool::validate_release_or_mint(
            &mut pool.token_pool_state, &input, local_amount
        );

        // Mint the amount for release
        assert!(pool.mint_ref.is_some(), E_MINT_REF_NOT_SET);
        let fa = fungible_asset::mint(pool.mint_ref.borrow(), local_amount);

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
    ) acquires BurnMintTokenPoolState {
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
    ) acquires BurnMintTokenPoolState {
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
    ): rate_limiter::TokenBucket acquires BurnMintTokenPoolState {
        token_pool::get_current_inbound_rate_limiter_state(
            &borrow_pool().token_pool_state, remote_chain_selector
        )
    }

    #[view]
    public fun get_current_outbound_rate_limiter_state(
        remote_chain_selector: u64
    ): rate_limiter::TokenBucket acquires BurnMintTokenPoolState {
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
        account::create_resource_address(&@burn_mint_token_pool, STORE_OBJECT_SEED)
    }

    fun assert_can_initialize(caller_address: address) {
        if (caller_address == @burn_mint_token_pool) { return };

        if (object::is_object(@burn_mint_token_pool)) {
            let burn_mint_token_pool_object =
                object::address_to_object<ObjectCore>(@burn_mint_token_pool);
            if (caller_address == object::owner(burn_mint_token_pool_object)
                || caller_address == object::root_owner(burn_mint_token_pool_object)) {
                return
            };
        };

        abort error::permission_denied(E_NOT_PUBLISHER)
    }

    inline fun borrow_pool(): &BurnMintTokenPoolState {
        borrow_global<BurnMintTokenPoolState>(store_address())
    }

    inline fun borrow_pool_mut(): &mut BurnMintTokenPoolState {
        borrow_global_mut<BurnMintTokenPoolState>(store_address())
    }

    // ================================================================
    // |                       Expose ownable                         |
    // ================================================================
    #[view]
    public fun owner(): address acquires BurnMintTokenPoolState {
        ownable::owner(&borrow_pool().ownable_state)
    }

    #[view]
    public fun has_pending_transfer(): bool acquires BurnMintTokenPoolState {
        ownable::has_pending_transfer(&borrow_pool().ownable_state)
    }

    #[view]
    public fun pending_transfer_from(): Option<address> acquires BurnMintTokenPoolState {
        ownable::pending_transfer_from(&borrow_pool().ownable_state)
    }

    #[view]
    public fun pending_transfer_to(): Option<address> acquires BurnMintTokenPoolState {
        ownable::pending_transfer_to(&borrow_pool().ownable_state)
    }

    #[view]
    public fun pending_transfer_accepted(): Option<bool> acquires BurnMintTokenPoolState {
        ownable::pending_transfer_accepted(&borrow_pool().ownable_state)
    }

    public entry fun transfer_ownership(caller: &signer, to: address) acquires BurnMintTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::transfer_ownership(caller, &mut pool.ownable_state, to)
    }

    public entry fun accept_ownership(caller: &signer) acquires BurnMintTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::accept_ownership(caller, &mut pool.ownable_state)
    }

    public entry fun execute_ownership_transfer(
        caller: &signer, to: address
    ) acquires BurnMintTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::execute_ownership_transfer(caller, &mut pool.ownable_state, to)
    }

    // ================================================================
    // |                    Ref Migration                              |
    // ================================================================
    public fun migrate_mint_ref(caller: &signer): MintRef acquires BurnMintTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::assert_only_owner(signer::address_of(caller), &pool.ownable_state);
        assert!(pool.mint_ref.is_some(), E_MINT_REF_NOT_SET);

        pool.mint_ref.extract()
    }

    public fun migrate_burn_ref(caller: &signer): BurnRef acquires BurnMintTokenPoolState {
        let pool = borrow_pool_mut();
        ownable::assert_only_owner(signer::address_of(caller), &pool.ownable_state);
        assert!(pool.burn_ref.is_some(), E_BURN_REF_NOT_SET);

        pool.burn_ref.extract()
    }

    // ================================================================
    // |                      MCMS entrypoint                         |
    // ================================================================
    struct McmsCallback has drop {}

    public fun mcms_entrypoint<T: key>(
        _metadata: object::Object<T>
    ): option::Option<u128> acquires BurnMintTokenPoolState {
        let (caller, function, data) =
            mcms_registry::get_callback_params(@burn_mint_token_pool, McmsCallback {});

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
