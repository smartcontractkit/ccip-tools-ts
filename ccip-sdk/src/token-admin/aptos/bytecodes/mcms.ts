/**
 * ChainlinkManyChainMultisig (MCMS) Move sources — embedded from chainlink-aptos.
 *
 * These sources are compiled locally alongside pool packages so that
 * the compiled bytecode matches the on-chain modules exactly.
 *
 * @packageDocumentation
 */

/** Move.toml for ChainlinkManyChainMultisig. */
export const MCMS_MOVE_TOML = `[package]
name = "ChainlinkManyChainMultisig"
version = "1.0.0"
upgrade_policy = "compatible"

[addresses]
mcms = "_"
mcms_owner = "_"

[dependencies]
AptosFramework = { git = "https://github.com/aptos-labs/aptos-core.git", rev = "16beac69835f3a71564c96164a606a23f259099a", subdir = "aptos-move/framework/aptos-framework" }
`

/** sources/mcms_account.move */
export const MCMS_MCMS_ACCOUNT_MOVE = `/// This module manages the ownership of the MCMS package.
module mcms::mcms_account {
    use std::account::{Self, SignerCapability};
    use std::error;
    use std::event;
    use std::resource_account;
    use std::signer;

    friend mcms::mcms;
    friend mcms::mcms_deployer;
    friend mcms::mcms_registry;

    struct AccountState has key, store {
        signer_cap: SignerCapability,
        owner: address,
        pending_owner: address
    }

    #[event]
    struct OwnershipTransferRequested has store, drop {
        from: address,
        to: address
    }

    #[event]
    struct OwnershipTransferred has store, drop {
        from: address,
        to: address
    }

    const E_CANNOT_TRANSFER_TO_SELF: u64 = 1;
    const E_MUST_BE_PROPOSED_OWNER: u64 = 2;
    const E_UNAUTHORIZED: u64 = 3;

    fun init_module(publisher: &signer) {
        let signer_cap =
            resource_account::retrieve_resource_account_cap(publisher, @mcms_owner);
        init_module_internal(publisher, signer_cap);
    }

    inline fun init_module_internal(
        publisher: &signer, signer_cap: SignerCapability
    ) {
        move_to(
            publisher,
            AccountState {
                signer_cap,
                owner: @mcms_owner,
                pending_owner: @0x0
            }
        );
    }

    /// Transfers ownership to the specified address.
    public entry fun transfer_ownership(caller: &signer, to: address) acquires AccountState {
        let state = borrow_state_mut();

        assert_is_owner_internal(state, caller);

        assert!(
            signer::address_of(caller) != to,
            error::invalid_argument(E_CANNOT_TRANSFER_TO_SELF)
        );

        state.pending_owner = to;

        event::emit(OwnershipTransferRequested { from: state.owner, to });
    }

    /// Transfers ownership back to the \`@mcms\` address.
    public entry fun transfer_ownership_to_self(caller: &signer) acquires AccountState {
        transfer_ownership(caller, @mcms);
    }

    /// Accepts ownership transfer. Can only be called by the pending owner.
    public entry fun accept_ownership(caller: &signer) acquires AccountState {
        let state = borrow_state_mut();

        let caller_address = signer::address_of(caller);
        assert!(
            caller_address == state.pending_owner,
            error::permission_denied(E_MUST_BE_PROPOSED_OWNER)
        );

        let previous_owner = state.owner;
        state.owner = caller_address;
        state.pending_owner = @0x0;

        event::emit(OwnershipTransferred { from: previous_owner, to: state.owner });
    }

    #[view]
    /// Returns the current owner.
    public fun owner(): address acquires AccountState {
        borrow_state().owner
    }

    #[view]
    /// Returns \`true\` if the module is self-owned (owned by \`@mcms\`).
    public fun is_self_owned(): bool acquires AccountState {
        owner() == @mcms
    }

    public(friend) fun get_signer(): signer acquires AccountState {
        account::create_signer_with_capability(&borrow_state().signer_cap)
    }

    public(friend) fun assert_is_owner(caller: &signer) acquires AccountState {
        assert_is_owner_internal(borrow_state(), caller);
    }

    inline fun assert_is_owner_internal(
        state: &AccountState, caller: &signer
    ) {
        assert!(
            state.owner == signer::address_of(caller),
            error::permission_denied(E_UNAUTHORIZED)
        );
    }

    inline fun borrow_state(): &AccountState {
        borrow_global<AccountState>(@mcms)
    }

    inline fun borrow_state_mut(): &mut AccountState {
        borrow_global_mut<AccountState>(@mcms)
    }

    #[test_only]
    public fun init_module_for_testing(publisher: &signer) {
        let test_signer_cap = account::create_test_signer_cap(@mcms);
        init_module_internal(publisher, test_signer_cap);
    }
}
`

/** sources/mcms_deployer.move */
export const MCMS_MCMS_DEPLOYER_MOVE = `/// This module is a modified version of Aptos' large_packages package, providing functions for publishing and upgrading
/// MCMS-owned modules of arbitrary sizes via object code deployment.
module mcms::mcms_deployer {
    use std::code::PackageRegistry;
    use std::error;
    use std::smart_table::{Self, SmartTable};
    use std::object;
    use std::object_code_deployment;

    use mcms::mcms_account;
    use mcms::mcms_registry;

    const E_CODE_MISMATCH: u64 = 1;

    struct StagingArea has key {
        metadata_serialized: vector<u8>,
        code: SmartTable<u64, vector<u8>>,
        last_module_idx: u64
    }

    /// Stages a chunk of code in the StagingArea.
    /// This function allows for incremental building of a large package.
    public entry fun stage_code_chunk(
        caller: &signer,
        metadata_chunk: vector<u8>,
        code_indices: vector<u16>,
        code_chunks: vector<vector<u8>>
    ) acquires StagingArea {
        mcms_account::assert_is_owner(caller);

        stage_code_chunk_internal(metadata_chunk, code_indices, code_chunks);
    }

    /// Stages a code chunk and immediately publishes it to a new object.
    public entry fun stage_code_chunk_and_publish_to_object(
        caller: &signer,
        metadata_chunk: vector<u8>,
        code_indices: vector<u16>,
        code_chunks: vector<vector<u8>>,
        new_owner_seed: vector<u8>
    ) acquires StagingArea {
        mcms_account::assert_is_owner(caller);

        let staging_area =
            stage_code_chunk_internal(metadata_chunk, code_indices, code_chunks);
        let code = assemble_module_code(staging_area);

        let owner_signer =
            &mcms_registry::create_owner_for_new_code_object(new_owner_seed);

        object_code_deployment::publish(
            owner_signer, staging_area.metadata_serialized, code
        );

        cleanup_staging_area_internal();
    }

    /// Stages a code chunk and immediately upgrades an existing code object.
    public entry fun stage_code_chunk_and_upgrade_object_code(
        caller: &signer,
        metadata_chunk: vector<u8>,
        code_indices: vector<u16>,
        code_chunks: vector<vector<u8>>,
        code_object_address: address
    ) acquires StagingArea {
        mcms_account::assert_is_owner(caller);

        let staging_area =
            stage_code_chunk_internal(metadata_chunk, code_indices, code_chunks);
        let code = assemble_module_code(staging_area);

        let owner_signer =
            &mcms_registry::get_signer_for_code_object_upgrade(code_object_address);

        object_code_deployment::upgrade(
            owner_signer,
            staging_area.metadata_serialized,
            code,
            object::address_to_object<PackageRegistry>(code_object_address)
        );

        cleanup_staging_area_internal();
    }

    /// Cleans up the staging area, removing any staged code chunks.
    /// This function can be called to reset the staging area without publishing or upgrading.
    public entry fun cleanup_staging_area(caller: &signer) acquires StagingArea {
        mcms_account::assert_is_owner(caller);

        cleanup_staging_area_internal();
    }

    inline fun stage_code_chunk_internal(
        metadata_chunk: vector<u8>,
        code_indices: vector<u16>,
        code_chunks: vector<vector<u8>>
    ): &mut StagingArea {
        assert!(
            code_indices.length() == code_chunks.length(),
            error::invalid_argument(E_CODE_MISMATCH)
        );

        if (!exists<StagingArea>(@mcms)) {
            move_to(
                &mcms_account::get_signer(),
                StagingArea {
                    metadata_serialized: vector[],
                    code: smart_table::new(),
                    last_module_idx: 0
                }
            );
        };

        let staging_area = borrow_global_mut<StagingArea>(@mcms);

        if (!metadata_chunk.is_empty()) {
            staging_area.metadata_serialized.append(metadata_chunk);
        };

        for (i in 0..code_chunks.length()) {
            let inner_code = code_chunks[i];
            let idx = (code_indices[i] as u64);

            if (staging_area.code.contains(idx)) {
                staging_area.code.borrow_mut(idx).append(inner_code);
            } else {
                staging_area.code.add(idx, inner_code);
                if (idx > staging_area.last_module_idx) {
                    staging_area.last_module_idx = idx;
                }
            };
        };

        staging_area
    }

    inline fun assemble_module_code(staging_area: &mut StagingArea): vector<vector<u8>> {
        let last_module_idx = staging_area.last_module_idx;
        let code = vector[];
        for (i in 0..(last_module_idx + 1)) {
            code.push_back(*staging_area.code.borrow(i));
        };
        code
    }

    inline fun cleanup_staging_area_internal() {
        let StagingArea { metadata_serialized: _, code, last_module_idx: _ } =
            move_from<StagingArea>(@mcms);
        code.destroy();
    }
}
`

/** sources/mcms_executor.move */
export const MCMS_MCMS_EXECUTOR_MOVE = `/// This module helps to stage large mcms::execute invocations, that cannot be done in a single
/// transaction due to the transaction size limit.
module mcms::mcms_executor {
    use std::signer;
    use std::string::String;

    use mcms::mcms;

    struct PendingExecute has key, store {
        data: vector<u8>,
        proofs: vector<vector<u8>>
    }

    public entry fun stage_data(
        caller: &signer, data_chunk: vector<u8>, partial_proofs: vector<vector<u8>>
    ) acquires PendingExecute {
        let caller_address = signer::address_of(caller);
        if (!exists<PendingExecute>(caller_address)) {
            move_to(
                caller,
                PendingExecute { data: vector[], proofs: vector[] }
            );
        };
        let pending_execute = borrow_global_mut<PendingExecute>(caller_address);
        if (!data_chunk.is_empty()) {
            pending_execute.data.append(data_chunk);
        };
        if (!partial_proofs.is_empty()) {
            pending_execute.proofs.append(partial_proofs);
        };
    }

    public entry fun stage_data_and_execute(
        caller: &signer,
        role: u8,
        chain_id: u256,
        multisig: address,
        nonce: u64,
        to: address,
        module_name: String,
        function: String,
        data_chunk: vector<u8>,
        partial_proofs: vector<vector<u8>>
    ) acquires PendingExecute {
        if (!exists<PendingExecute>(signer::address_of(caller))) {
            move_to(
                caller,
                PendingExecute { data: vector[], proofs: vector[] }
            );
        };
        let PendingExecute { data, proofs } =
            move_from<PendingExecute>(signer::address_of(caller));
        if (!data_chunk.is_empty()) {
            data.append(data_chunk);
        };
        if (!partial_proofs.is_empty()) {
            proofs.append(partial_proofs);
        };
        mcms::execute(
            role,
            chain_id,
            multisig,
            nonce,
            to,
            module_name,
            function,
            data,
            proofs
        );
    }

    public entry fun clear_staged_data(caller: &signer) acquires PendingExecute {
        let PendingExecute { data: _, proofs: _ } =
            move_from<PendingExecute>(signer::address_of(caller));
    }
}
`

/** sources/mcms_registry.move */
export const MCMS_MCMS_REGISTRY_MOVE = `/// This module handles registration and management of code object owners and callbacks.
module mcms::mcms_registry {
    use std::account::{Self, SignerCapability};
    use std::bcs;
    use std::code::PackageRegistry;
    use std::dispatchable_fungible_asset;
    use std::error;
    use std::event;
    use std::fungible_asset::{Self, Metadata};
    use std::function_info::{Self, FunctionInfo};
    use std::object::{Self, ExtendRef, Object};
    use std::option;
    use std::signer;
    use std::big_ordered_map::{Self, BigOrderedMap};
    use std::string::{Self, String};
    use std::type_info::{Self, TypeInfo};

    use mcms::mcms_account;

    friend mcms::mcms;
    friend mcms::mcms_deployer;

    const EXISTING_OBJECT_REGISTRATION_SEED: vector<u8> = b"CHAINLINK_MCMS_EXISTING_OBJECT_REGISTRATION";
    const NEW_OBJECT_REGISTRATION_SEED: vector<u8> = b"CHAINLINK_MCMS_NEW_OBJECT_REGISTRATION";
    const DISPATCH_OBJECT_SEED: vector<u8> = b"CHAINLINK_MCMS_DISPATCH_OBJECT";

    // https://github.com/aptos-labs/aptos-core/blob/7fc73792e9db11462c9a42038c4a9eb41cc00192/aptos-move/framework/aptos-framework/sources/object_code_deployment.move#L53
    const OBJECT_CODE_DEPLOYMENT_DOMAIN_SEPARATOR: vector<u8> = b"aptos_framework::object_code_deployment";

    struct RegistryState has key {
        // preregistered code object and/or registered callback address -> owner/signer address
        registered_addresses: BigOrderedMap<address, address>
    }

    struct OwnerRegistration has key {
        owner_seed: vector<u8>,
        owner_cap: SignerCapability,
        is_preregistered: bool,

        // module name -> registered module
        callback_modules: BigOrderedMap<vector<u8>, RegisteredModule>
    }

    struct OwnerTransfers has key {
        // object address -> pending transfer
        pending_transfers: BigOrderedMap<address, PendingCodeObjectTransfer>
    }

    struct RegisteredModule has store, drop {
        callback_function_info: FunctionInfo,
        proof_type_info: TypeInfo,
        dispatch_metadata: Object<Metadata>,
        dispatch_extend_ref: ExtendRef
    }

    struct PendingCodeObjectTransfer has store, drop {
        to: address,
        accepted: bool
    }

    struct ExecutingCallbackParams has key {
        expected_type_info: TypeInfo,
        function: String,
        data: vector<u8>
    }

    #[event]
    struct EntrypointRegistered has store, drop {
        owner_address: address,
        account_address: address,
        module_name: String
    }

    #[event]
    struct CodeObjectTransferRequested has store, drop {
        object_address: address,
        mcms_owner_address: address,
        new_owner_address: address
    }

    #[event]
    struct CodeObjectTransferAccepted has store, drop {
        object_address: address,
        mcms_owner_address: address,
        new_owner_address: address
    }

    #[event]
    struct CodeObjectTransferred has store, drop {
        object_address: address,
        mcms_owner_address: address,
        new_owner_address: address
    }

    #[event]
    struct OwnerCreatedForPreexistingObject has store, drop {
        owner_address: address,
        object_address: address
    }

    #[event]
    struct OwnerCreatedForNewObject has store, drop {
        owner_address: address,
        expected_object_address: address
    }

    #[event]
    struct OwnerCreatedForEntrypoint has store, drop {
        owner_address: address,
        account_or_object_address: address
    }

    const E_CALLBACK_PARAMS_ALREADY_EXISTS: u64 = 1;
    const E_MISSING_CALLBACK_PARAMS: u64 = 2;
    const E_WRONG_PROOF_TYPE: u64 = 3;
    const E_CALLBACK_PARAMS_NOT_CONSUMED: u64 = 4;
    const E_PROOF_NOT_AT_ACCOUNT_ADDRESS: u64 = 5;
    const E_PROOF_NOT_IN_MODULE: u64 = 6;
    const E_MODULE_ALREADY_REGISTERED: u64 = 7;
    const E_EMPTY_MODULE_NAME: u64 = 8;
    const E_MODULE_NAME_TOO_LONG: u64 = 9;
    const E_ADDRESS_NOT_REGISTERED: u64 = 10;
    const E_INVALID_CODE_OBJECT: u64 = 11;
    const E_OWNER_ALREADY_REGISTERED: u64 = 12;
    const E_NOT_CODE_OBJECT_OWNER: u64 = 13;
    const E_UNGATED_TRANSFER_DISABLED: u64 = 14;
    const E_NO_PENDING_TRANSFER: u64 = 15;
    const E_TRANSFER_ALREADY_ACCEPTED: u64 = 16;
    const E_NEW_OWNER_MISMATCH: u64 = 17;
    const E_TRANSFER_NOT_ACCEPTED: u64 = 18;
    const E_NOT_PROPOSED_OWNER: u64 = 19;
    const E_MODULE_NOT_REGISTERED: u64 = 20;

    fun init_module(publisher: &signer) {
        move_to(
            publisher,
            RegistryState {
                registered_addresses: big_ordered_map::new_with_config(0, 0, false)
            }
        );
    }

    #[view]
    /// Returns the resource address for a new code object owner using the provided seed.
    public fun get_new_code_object_owner_address(
        new_owner_seed: vector<u8>
    ): address {
        let owner_seed = NEW_OBJECT_REGISTRATION_SEED;
        owner_seed.append(new_owner_seed);
        account::create_resource_address(&@mcms, owner_seed)
    }

    #[view]
    /// Computes and returns the new code object's address using the new_owner_seed.
    public fun get_new_code_object_address(new_owner_seed: vector<u8>): address {
        let object_owner_address = get_new_code_object_owner_address(new_owner_seed);
        let object_code_deployment_seed =
            bcs::to_bytes(&OBJECT_CODE_DEPLOYMENT_DOMAIN_SEPARATOR);
        object_code_deployment_seed.append(bcs::to_bytes(&1u64));
        object::create_object_address(
            &object_owner_address, object_code_deployment_seed
        )
    }

    #[view]
    /// Derives the resource address for an preexisting code object's owner using the given object_address.
    public fun get_preexisting_code_object_owner_address(
        object_address: address
    ): address {
        let owner_seed = EXISTING_OBJECT_REGISTRATION_SEED;
        owner_seed.append(bcs::to_bytes(&object_address));
        account::create_resource_address(&@mcms, owner_seed)
    }

    #[view]
    /// Returns the registered owner address for a given account address. The account address
    /// can be either a code object address or a callback address.
    /// Aborts if the address is not registered.
    public fun get_registered_owner_address(
        account_address: address
    ): address acquires RegistryState {
        let state = borrow_state();
        assert!(
            state.registered_addresses.contains(&account_address),
            error::invalid_argument(E_ADDRESS_NOT_REGISTERED)
        );
        *state.registered_addresses.borrow(&account_address)
    }

    #[view]
    /// Returns true if the given address is a code object and is owned by MCMS.
    /// Aborts if the address is not a valid code object.
    public fun is_owned_code_object(object_address: address): bool acquires RegistryState {
        assert!(
            object::object_exists<PackageRegistry>(object_address),
            error::invalid_argument(E_INVALID_CODE_OBJECT)
        );
        let code_object = object::address_to_object<PackageRegistry>(object_address);

        let owner_address = get_registered_owner_address(object_address);
        object::owner(code_object) == owner_address
    }

    /// Imports a code object (ie. managed by 0x1::code_object_deployment) that was not deployed
    /// using mcms_deployer, and has not registered for a callback, to be owned by MCMS.
    /// If either of these conditions has already occurred, then an object owner was already
    /// created and there is no need to call this function - however, the below flow can still
    /// be followed to transfer ownership to MCMS, omitting the final step.
    ///
    /// Ownership transfer flow:
    /// - if it was deployed using mcms_deployer, call get_new_code_object_owner_address() with
    ///   the same new_owner_seed used when publishing to get the MCMS object owner address.
    /// - otherwise, call get_preexisting_code_object_owner_address() to get the MCMS object owner
    ///   address.
    /// - call 0x1::object::transfer, transfering ownership to the MCMS object owner address.
    /// - call create_owner_for_preexisting_code_object() with the object address.
    ///
    /// After these steps, MCMS will be the code object owner, and will be able to deploy and upgrade
    /// the code object using proposals with mcms_deployer ops.
    public entry fun create_owner_for_preexisting_code_object(
        caller: &signer, object_address: address
    ) acquires RegistryState {
        mcms_account::assert_is_owner(caller);
        assert!(
            object::object_exists<PackageRegistry>(object_address),
            error::invalid_argument(E_INVALID_CODE_OBJECT)
        );

        let state = borrow_state_mut();
        let owner_signer =
            &create_owner_for_preexisting_code_object_internal(state, object_address);

        event::emit(
            OwnerCreatedForPreexistingObject {
                owner_address: signer::address_of(owner_signer),
                object_address
            }
        );
    }

    /// Transfers ownership of a code object to a new owner. Note that this does not unregister
    /// the entrypoint or remove the previous owner from the registry.
    ///
    /// Due to Aptos's security model requiring the original owner's signer for 0x1::object::transfer,
    /// we use the same 3-step ownership transfer flow as our ownable.move implementation:
    ///
    /// 1. MCMS owner calls transfer_code_object with the new owner's address
    /// 2. Pending owner calls accept_code_object to confirm the transfer
    /// 3. MCMS owner calls execute_code_object_transfer to complete the transfer
    public entry fun transfer_code_object(
        caller: &signer, object_address: address, new_owner_address: address
    ) acquires RegistryState, OwnerRegistration, OwnerTransfers {
        mcms_account::assert_is_owner(caller);

        assert!(
            object::object_exists<PackageRegistry>(object_address),
            error::invalid_argument(E_INVALID_CODE_OBJECT)
        );

        let code_object = object::address_to_object<PackageRegistry>(object_address);

        // this could occur if the code object was pre-existing and the original creator kept the TransferRef,
        // transferred the object to MCMS by generating a LinearTransferRef.
        assert!(
            object::ungated_transfer_allowed(code_object),
            error::permission_denied(E_UNGATED_TRANSFER_DISABLED)
        );

        let state = borrow_state();
        assert!(
            state.registered_addresses.contains(&object_address),
            error::invalid_argument(E_ADDRESS_NOT_REGISTERED)
        );

        let owner_address = *state.registered_addresses.borrow(&object_address);
        // this could occur if the code object has already been transferred away either through this process
        // or through a TransferRef if the object was pre-existing.
        assert!(
            object::owner(code_object) == owner_address,
            error::invalid_state(E_NOT_CODE_OBJECT_OWNER)
        );

        if (!exists<OwnerTransfers>(owner_address)) {
            let owner_registration = borrow_owner_registration(owner_address);
            let owner_signer =
                &account::create_signer_with_capability(&owner_registration.owner_cap);
            move_to(
                owner_signer,
                OwnerTransfers {
                    pending_transfers: big_ordered_map::new_with_config(0, 0, false)
                }
            );
        };

        let pending_transfers = borrow_global_mut<OwnerTransfers>(owner_address);

        // override any pending transfers if a new transfer has been requested.
        pending_transfers.pending_transfers.upsert(
            object_address,
            PendingCodeObjectTransfer { to: new_owner_address, accepted: false }
        );

        event::emit(
            CodeObjectTransferRequested {
                object_address,
                mcms_owner_address: owner_address,
                new_owner_address
            }
        );
    }

    public entry fun accept_code_object(
        caller: &signer, object_address: address
    ) acquires RegistryState, OwnerTransfers {
        assert!(
            object::object_exists<PackageRegistry>(object_address),
            error::invalid_argument(E_INVALID_CODE_OBJECT)
        );

        let code_object = object::address_to_object<PackageRegistry>(object_address);

        let state = borrow_state();
        assert!(
            state.registered_addresses.contains(&object_address),
            error::invalid_argument(E_ADDRESS_NOT_REGISTERED)
        );

        let owner_address = *state.registered_addresses.borrow(&object_address);
        // these conditions could occur if the code object was pre-existing and the owner transferred object ownership or disabled
        // ungated transfers using the TransferRef after this transfer process was initiated.
        assert!(
            object::owner(code_object) == owner_address,
            error::invalid_state(E_NOT_CODE_OBJECT_OWNER)
        );
        assert!(
            object::ungated_transfer_allowed(code_object),
            error::permission_denied(E_UNGATED_TRANSFER_DISABLED)
        );

        assert!(
            exists<OwnerTransfers>(owner_address),
            error::invalid_state(E_NO_PENDING_TRANSFER)
        );
        let pending_transfers = borrow_global_mut<OwnerTransfers>(owner_address);

        assert!(
            pending_transfers.pending_transfers.contains(&object_address),
            error::invalid_state(E_NO_PENDING_TRANSFER)
        );

        let pending_transfer =
            pending_transfers.pending_transfers.borrow_mut(&object_address);
        assert!(
            pending_transfer.to == signer::address_of(caller),
            error::permission_denied(E_NOT_PROPOSED_OWNER)
        );
        assert!(
            !pending_transfer.accepted,
            error::invalid_state(E_TRANSFER_ALREADY_ACCEPTED)
        );

        pending_transfer.accepted = true;

        event::emit(
            CodeObjectTransferAccepted {
                object_address,
                mcms_owner_address: owner_address,
                new_owner_address: pending_transfer.to
            }
        );
    }

    public entry fun execute_code_object_transfer(
        caller: &signer, object_address: address, new_owner_address: address
    ) acquires RegistryState, OwnerRegistration, OwnerTransfers {
        mcms_account::assert_is_owner(caller);

        assert!(
            object::object_exists<PackageRegistry>(object_address),
            error::invalid_argument(E_INVALID_CODE_OBJECT)
        );

        let code_object = object::address_to_object<PackageRegistry>(object_address);

        let state = borrow_state();
        assert!(
            state.registered_addresses.contains(&object_address),
            error::invalid_argument(E_ADDRESS_NOT_REGISTERED)
        );

        let owner_address = *state.registered_addresses.borrow(&object_address);
        // these conditions could occur if the code object was pre-existing and the owner transferred object ownership or disabled
        // ungated transfers using the TransferRef after this transfer process was initiated.
        assert!(
            object::owner(code_object) == owner_address,
            error::invalid_state(E_NOT_CODE_OBJECT_OWNER)
        );
        assert!(
            object::ungated_transfer_allowed(code_object),
            error::permission_denied(E_UNGATED_TRANSFER_DISABLED)
        );

        assert!(
            exists<OwnerTransfers>(owner_address),
            error::invalid_state(E_NO_PENDING_TRANSFER)
        );
        let pending_transfers = borrow_global_mut<OwnerTransfers>(owner_address);

        assert!(
            pending_transfers.pending_transfers.contains(&object_address),
            error::invalid_state(E_NO_PENDING_TRANSFER)
        );
        let pending_transfer =
            pending_transfers.pending_transfers.borrow_mut(&object_address);
        assert!(
            pending_transfer.to == new_owner_address,
            error::invalid_state(E_NEW_OWNER_MISMATCH)
        );
        assert!(
            pending_transfer.accepted,
            error::invalid_state(E_TRANSFER_NOT_ACCEPTED)
        );

        let owner_registration = borrow_owner_registration(owner_address);
        let owner_signer =
            &account::create_signer_with_capability(&owner_registration.owner_cap);

        object::transfer(owner_signer, code_object, new_owner_address);

        event::emit(
            CodeObjectTransferred {
                object_address,
                mcms_owner_address: owner_address,
                new_owner_address
            }
        );

        pending_transfers.pending_transfers.remove(&object_address);
        if (pending_transfers.pending_transfers.is_empty()) {
            let OwnerTransfers { pending_transfers } =
                move_from<OwnerTransfers>(owner_address);
            pending_transfers.destroy_empty();
        }
    }

    public(friend) fun create_owner_for_new_code_object(
        new_owner_seed: vector<u8>
    ): signer acquires RegistryState {
        let owner_seed = NEW_OBJECT_REGISTRATION_SEED;
        owner_seed.append(new_owner_seed);
        let new_code_object_address = get_new_code_object_address(new_owner_seed);
        let owner_signer =
            create_owner_internal(
                borrow_state_mut(),
                owner_seed,
                new_code_object_address,
                true
            );

        event::emit(
            OwnerCreatedForNewObject {
                owner_address: signer::address_of(&owner_signer),
                expected_object_address: new_code_object_address
            }
        );

        owner_signer
    }

    public(friend) fun get_signer_for_code_object_upgrade(
        object_address: address
    ): signer acquires RegistryState, OwnerRegistration {
        assert!(
            object::object_exists<PackageRegistry>(object_address),
            error::invalid_argument(E_INVALID_CODE_OBJECT)
        );

        let state = borrow_state();
        assert!(
            state.registered_addresses.contains(&object_address),
            error::invalid_argument(E_ADDRESS_NOT_REGISTERED)
        );
        let owner_address = *state.registered_addresses.borrow(&object_address);

        let owner_registration = borrow_owner_registration(owner_address);
        account::create_signer_with_capability(&owner_registration.owner_cap)
    }

    inline fun create_owner_for_preexisting_code_object_internal(
        state: &mut RegistryState, object_address: address
    ): signer {
        let owner_seed = EXISTING_OBJECT_REGISTRATION_SEED;
        owner_seed.append(bcs::to_bytes(&object_address));
        create_owner_internal(state, owner_seed, object_address, false)
    }

    inline fun create_owner_internal(
        state: &mut RegistryState,
        owner_seed: vector<u8>,
        code_object_address: address,
        is_preregistered: bool
    ): signer {
        let mcms_signer = &mcms_account::get_signer();

        let owner_address = account::create_resource_address(&@mcms, owner_seed);
        assert!(
            !exists<OwnerRegistration>(owner_address),
            error::invalid_state(E_OWNER_ALREADY_REGISTERED)
        );

        let (owner_signer, owner_cap) =
            account::create_resource_account(mcms_signer, owner_seed);
        move_to(
            &owner_signer,
            OwnerRegistration {
                owner_seed,
                owner_cap,
                is_preregistered,
                callback_modules: big_ordered_map::new_with_config(0, 0, false)
            }
        );

        state.registered_addresses.add(
            code_object_address, signer::address_of(&owner_signer)
        );
        owner_signer
    }

    /// Registers a callback to mcms_entrypoint to enable dynamic dispatch.
    public fun register_entrypoint<T: drop>(
        account: &signer, module_name: String, _proof: T
    ): address acquires RegistryState, OwnerRegistration {
        let account_address = signer::address_of(account);
        let account_address_bytes = bcs::to_bytes(&account_address);

        let module_name_bytes = *module_name.bytes();
        let module_name_len = module_name_bytes.length();
        assert!(module_name_len > 0, error::invalid_argument(E_EMPTY_MODULE_NAME));
        assert!(module_name_len <= 64, error::invalid_argument(E_MODULE_NAME_TOO_LONG));

        let state = borrow_state_mut();

        let owner_address =
            if (!state.registered_addresses.contains(&account_address)) {
                let owner_signer =
                    create_owner_for_preexisting_code_object_internal(
                        state, account_address
                    );

                let owner_address = signer::address_of(&owner_signer);

                event::emit(
                    OwnerCreatedForEntrypoint {
                        owner_address,
                        account_or_object_address: account_address
                    }
                );

                owner_address
            } else {
                *state.registered_addresses.borrow(&account_address)
            };

        let registration = borrow_owner_registration_mut(owner_address);

        assert!(
            !registration.callback_modules.contains(&module_name_bytes),
            error::invalid_argument(E_MODULE_ALREADY_REGISTERED)
        );

        let proof_type_info = type_info::type_of<T>();

        assert!(
            proof_type_info.account_address() == account_address,
            error::invalid_argument(E_PROOF_NOT_AT_ACCOUNT_ADDRESS)
        );

        let owner_signer =
            account::create_signer_with_capability(&registration.owner_cap);

        let object_seed = DISPATCH_OBJECT_SEED;
        object_seed.append(account_address_bytes);
        object_seed.append(module_name_bytes);

        let dispatch_constructor_ref =
            object::create_named_object(&owner_signer, object_seed);
        let dispatch_extend_ref = object::generate_extend_ref(&dispatch_constructor_ref);
        let dispatch_metadata =
            fungible_asset::add_fungibility(
                &dispatch_constructor_ref,
                option::none(),
                string::utf8(b"mcms"),
                string::utf8(b"mcms"),
                0,
                string::utf8(b""),
                string::utf8(b"")
            );

        let callback_function_info =
            function_info::new_function_info(
                account,
                string::utf8(proof_type_info.module_name()),
                string::utf8(b"mcms_entrypoint")
            );

        dispatchable_fungible_asset::register_derive_supply_dispatch_function(
            &dispatch_constructor_ref, option::some(callback_function_info)
        );

        let registered_module = RegisteredModule {
            callback_function_info,
            proof_type_info,
            dispatch_metadata,
            dispatch_extend_ref
        };

        registration.callback_modules.add(module_name_bytes, registered_module);

        event::emit(EntrypointRegistered { owner_address, account_address, module_name });

        owner_address
    }

    public(friend) fun start_dispatch(
        callback_address: address,
        callback_module_name: String,
        callback_function: String,
        data: vector<u8>
    ): Object<Metadata> acquires RegistryState, OwnerRegistration {
        let state = borrow_state();

        assert!(
            state.registered_addresses.contains(&callback_address),
            error::invalid_argument(E_ADDRESS_NOT_REGISTERED)
        );

        let owner_address = *state.registered_addresses.borrow(&callback_address);
        assert!(
            !exists<ExecutingCallbackParams>(owner_address),
            error::invalid_state(E_CALLBACK_PARAMS_ALREADY_EXISTS)
        );

        let registration = borrow_owner_registration(owner_address);

        let callback_module_name_bytes = *callback_module_name.bytes();
        assert!(
            registration.callback_modules.contains(&callback_module_name_bytes),
            error::invalid_state(E_MODULE_NOT_REGISTERED)
        );

        let registered_module =
            registration.callback_modules.borrow(&callback_module_name_bytes);

        let owner_signer =
            account::create_signer_with_capability(&registration.owner_cap);

        move_to(
            &owner_signer,
            ExecutingCallbackParams {
                expected_type_info: registered_module.proof_type_info,
                function: callback_function,
                data
            }
        );

        registered_module.dispatch_metadata
    }

    public(friend) fun finish_dispatch(callback_address: address) acquires RegistryState {
        let state = borrow_state();

        assert!(
            state.registered_addresses.contains(&callback_address),
            error::invalid_state(E_ADDRESS_NOT_REGISTERED)
        );

        let owner_address = *state.registered_addresses.borrow(&callback_address);
        assert!(
            !exists<ExecutingCallbackParams>(owner_address),
            error::invalid_argument(E_CALLBACK_PARAMS_NOT_CONSUMED)
        );
    }

    public fun get_callback_params<T: drop>(
        callback_address: address, _proof: T
    ): (signer, String, vector<u8>) acquires RegistryState, OwnerRegistration, ExecutingCallbackParams {
        let state = borrow_state();

        assert!(
            state.registered_addresses.contains(&callback_address),
            error::invalid_argument(E_ADDRESS_NOT_REGISTERED)
        );

        let owner_address = *state.registered_addresses.borrow(&callback_address);
        assert!(
            exists<ExecutingCallbackParams>(owner_address),
            error::invalid_state(E_MISSING_CALLBACK_PARAMS)
        );

        let ExecutingCallbackParams { expected_type_info, function, data } =
            move_from<ExecutingCallbackParams>(owner_address);

        let proof_type_info = type_info::type_of<T>();
        assert!(
            expected_type_info == proof_type_info,
            error::invalid_argument(E_WRONG_PROOF_TYPE)
        );

        let registration = borrow_owner_registration(owner_address);
        let owner_signer =
            account::create_signer_with_capability(&registration.owner_cap);

        (owner_signer, function, data)
    }

    inline fun borrow_state(): &RegistryState {
        borrow_global<RegistryState>(@mcms)
    }

    inline fun borrow_state_mut(): &mut RegistryState {
        borrow_global_mut<RegistryState>(@mcms)
    }

    inline fun borrow_owner_registration(account_address: address): &OwnerRegistration {
        assert!(
            exists<OwnerRegistration>(account_address),
            error::invalid_argument(E_ADDRESS_NOT_REGISTERED)
        );
        borrow_global<OwnerRegistration>(account_address)
    }

    inline fun borrow_owner_registration_mut(account_address: address)
        : &mut OwnerRegistration {
        assert!(
            exists<OwnerRegistration>(account_address),
            error::invalid_argument(E_ADDRESS_NOT_REGISTERED)
        );
        borrow_global_mut<OwnerRegistration>(account_address)
    }

    #[test_only]
    public fun init_module_for_testing(publisher: &signer) {
        init_module(publisher);
    }

    #[test_only]
    public fun test_start_dispatch(
        callback_address: address,
        callback_module_name: String,
        callback_function: String,
        data: vector<u8>
    ): Object<Metadata> acquires RegistryState, OwnerRegistration {
        start_dispatch(
            callback_address,
            callback_module_name,
            callback_function,
            data
        )
    }

    #[test_only]
    public fun test_finish_dispatch(callback_address: address) acquires RegistryState {
        finish_dispatch(callback_address)
    }

    #[test_only]
    public fun move_from_owner_transfers(owner_address: address) acquires OwnerTransfers {
        let OwnerTransfers { pending_transfers } =
            move_from<OwnerTransfers>(owner_address);
        pending_transfers.destroy({ |_dv| {} });
    }
}
`

/** sources/mcms.move */
export const MCMS_MCMS_MOVE = `/// This module is the Aptos implementation of Chainlink's MultiChainMultiSig contract.
module mcms::mcms {
    use std::aptos_hash::keccak256;
    use std::bcs;
    use std::event;
    use std::signer;
    use std::simple_map::{Self, SimpleMap};
    use std::string::{String};
    use aptos_std::smart_table::{Self, SmartTable};
    use aptos_std::smart_vector::{Self, SmartVector};
    use aptos_framework::chain_id;
    use aptos_framework::object::{Self, ExtendRef, Object};
    use aptos_framework::timestamp;
    use aptos_std::secp256k1;
    use mcms::bcs_stream::{Self, BCSStream};
    use mcms::mcms_account;
    use mcms::mcms_deployer;
    use mcms::mcms_registry;
    use mcms::params::{Self};

    const BYPASSER_ROLE: u8 = 0;
    const CANCELLER_ROLE: u8 = 1;
    const PROPOSER_ROLE: u8 = 2;
    const TIMELOCK_ROLE: u8 = 3;
    const MAX_ROLE: u8 = 4;

    const NUM_GROUPS: u64 = 32;
    const MAX_NUM_SIGNERS: u64 = 200;

    // equivalent to initializing empty uint8[NUM_GROUPS] in Solidity
    const VEC_NUM_GROUPS: vector<u8> = vector[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    // keccak256("MANY_CHAIN_MULTI_SIG_DOMAIN_SEPARATOR_METADATA_APTOS")
    const MANY_CHAIN_MULTI_SIG_DOMAIN_SEPARATOR_METADATA: vector<u8> = x"a71d47b6c00b64ee21af96a1d424cb2dcbbed12becdcd3b4e6c7fc4c2f80a697";

    // keccak256("MANY_CHAIN_MULTI_SIG_DOMAIN_SEPARATOR_OP_APTOS")
    const MANY_CHAIN_MULTI_SIG_DOMAIN_SEPARATOR_OP: vector<u8> = x"e5a6d1256b00d7ec22512b6b60a3f4d75c559745d2dbf309f77b8b756caabe14";

    /// Special timestamp value indicating an operation is done
    const DONE_TIMESTAMP: u64 = 1;

    const ZERO_HASH: vector<u8> = vector[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    #[resource_group_member(group = aptos_framework::object::ObjectGroup)]
    struct MultisigState has key {
        bypasser: Object<Multisig>,
        canceller: Object<Multisig>,
        proposer: Object<Multisig>
    }

    #[resource_group_member(group = aptos_framework::object::ObjectGroup)]
    struct Multisig has key {
        extend_ref: ExtendRef,

        /// signers is used to easily validate the existence of the signer by its address. We still
        /// have signers stored in config in order to easily deactivate them when a new config is set.
        signers: SimpleMap<vector<u8>, Signer>,
        config: Config,

        /// Remember signed hashes that this contract has seen. Each signed hash can only be set once.
        seen_signed_hashes: SimpleMap<vector<u8>, bool>,
        expiring_root_and_op_count: ExpiringRootAndOpCount,
        root_metadata: RootMetadata
    }

    struct Op has copy, drop {
        role: u8,
        chain_id: u256,
        multisig: address,
        nonce: u64,
        to: address,
        module_name: String,
        function_name: String,
        data: vector<u8>
    }

    struct RootMetadata has copy, drop, store {
        role: u8,
        chain_id: u256,
        multisig: address,
        pre_op_count: u64,
        post_op_count: u64,
        override_previous_root: bool
    }

    struct Signer has store, copy, drop {
        addr: vector<u8>,
        index: u8, // index of signer in config.signers
        group: u8 // 0 <= group < NUM_GROUPS. Each signer can only be in one group.
    }

    struct Config has store, copy, drop {
        signers: vector<Signer>,

        // group_quorums[i] stores the quorum for the i-th signer group. Any group with
        // group_quorums[i] = 0 is considered disabled. The i-th group is successful if
        // it is enabled and at least group_quorums[i] of its children are successful.
        group_quorums: vector<u8>,

        // group_parents[i] stores the parent group of the i-th signer group. We ensure that the
        // groups form a tree structure (where the root/0-th signer group points to itself as
        // parent) by enforcing
        // - (i != 0) implies (group_parents[i] < i)
        // - group_parents[0] == 0
        group_parents: vector<u8>
    }

    struct ExpiringRootAndOpCount has store, drop {
        root: vector<u8>,
        valid_until: u64,
        op_count: u64
    }

    #[event]
    struct MultisigStateInitialized has drop, store {
        bypasser: Object<Multisig>,
        canceller: Object<Multisig>,
        proposer: Object<Multisig>
    }

    #[event]
    struct ConfigSet has drop, store {
        role: u8,
        config: Config,
        is_root_cleared: bool
    }

    #[event]
    struct NewRoot has drop, store {
        role: u8,
        root: vector<u8>,
        valid_until: u64,
        metadata: RootMetadata
    }

    #[event]
    struct OpExecuted has drop, store {
        role: u8,
        chain_id: u256,
        multisig: address,
        nonce: u64,
        to: address,
        module_name: String,
        function_name: String,
        data: vector<u8>
    }

    const E_ALREADY_SEEN_HASH: u64 = 1;
    const E_POST_OP_COUNT_REACHED: u64 = 2;
    const E_WRONG_CHAIN_ID: u64 = 3;
    const E_WRONG_MULTISIG: u64 = 4;
    const E_ROOT_EXPIRED: u64 = 5;
    const E_WRONG_NONCE: u64 = 6;
    const E_VALID_UNTIL_EXPIRED: u64 = 7;
    const E_INVALID_SIGNER: u64 = 8;
    const E_MISSING_CONFIG: u64 = 9;
    const E_INSUFFICIENT_SIGNERS: u64 = 10;
    const E_PROOF_CANNOT_BE_VERIFIED: u64 = 11;
    const E_PENDING_OPS: u64 = 12;
    const E_WRONG_PRE_OP_COUNT: u64 = 13;
    const E_WRONG_POST_OP_COUNT: u64 = 14;
    const E_INVALID_NUM_SIGNERS: u64 = 15;
    const E_SIGNER_GROUPS_LEN_MISMATCH: u64 = 16;
    const E_INVALID_GROUP_QUORUM_LEN: u64 = 17;
    const E_INVALID_GROUP_PARENTS_LEN: u64 = 18;
    const E_OUT_OF_BOUNDS_GROUP: u64 = 19;
    const E_GROUP_TREE_NOT_WELL_FORMED: u64 = 20;
    const E_SIGNER_IN_DISABLED_GROUP: u64 = 21;
    const E_OUT_OF_BOUNDS_GROUP_QUORUM: u64 = 22;
    const E_SIGNER_ADDR_MUST_BE_INCREASING: u64 = 23;
    const E_INVALID_SIGNER_ADDR_LEN: u64 = 24;
    const E_UNKNOWN_MCMS_MODULE_FUNCTION: u64 = 25;
    const E_UNKNOWN_FRAMEWORK_MODULE_FUNCTION: u64 = 26;
    const E_UNKNOWN_FRAMEWORK_MODULE: u64 = 27;
    const E_SELF_CALL_ROLE_MISMATCH: u64 = 28;
    const E_NOT_BYPASSER_ROLE: u64 = 29;
    const E_INVALID_ROLE: u64 = 30;
    const E_NOT_AUTHORIZED_ROLE: u64 = 31;
    const E_NOT_AUTHORIZED: u64 = 32;
    const E_OPERATION_ALREADY_SCHEDULED: u64 = 33;
    const E_INSUFFICIENT_DELAY: u64 = 34;
    const E_OPERATION_NOT_READY: u64 = 35;
    const E_MISSING_DEPENDENCY: u64 = 36;
    const E_OPERATION_CANNOT_BE_CANCELLED: u64 = 37;
    const E_FUNCTION_BLOCKED: u64 = 38;
    const E_INVALID_INDEX: u64 = 39;
    const E_UNKNOWN_MCMS_ACCOUNT_MODULE_FUNCTION: u64 = 40;
    const E_UNKNOWN_MCMS_DEPLOYER_MODULE_FUNCTION: u64 = 41;
    const E_UNKNOWN_MCMS_REGISTRY_MODULE_FUNCTION: u64 = 42;
    const E_INVALID_PARAMETERS: u64 = 43;
    const E_INVALID_SIGNATURE_LEN: u64 = 44;
    const E_INVALID_V_SIGNATURE: u64 = 45;
    const E_FAILED_ECDSA_RECOVER: u64 = 46;
    const E_INVALID_MODULE_NAME: u64 = 47;
    const E_UNKNOWN_MCMS_TIMELOCK_FUNCTION: u64 = 48;
    const E_INVALID_ROOT_LEN: u64 = 49;
    const E_NOT_CANCELLER_ROLE: u64 = 50;
    const E_NOT_TIMELOCK_ROLE: u64 = 51;
    const E_UNKNOWN_MCMS_MODULE: u64 = 52;

    fun init_module(publisher: &signer) {
        let bypasser = create_multisig(publisher, BYPASSER_ROLE);
        let canceller = create_multisig(publisher, CANCELLER_ROLE);
        let proposer = create_multisig(publisher, PROPOSER_ROLE);

        move_to(
            publisher,
            MultisigState { bypasser, canceller, proposer }
        );

        event::emit(MultisigStateInitialized { bypasser, canceller, proposer });

        move_to(
            publisher,
            Timelock {
                min_delay: 0,
                timestamps: smart_table::new(),
                blocked_functions: smart_vector::new()
            }
        );

        event::emit(TimelockInitialized { min_delay: 0 });
    }

    inline fun create_multisig(publisher: &signer, role: u8): Object<Multisig> {
        let constructor_ref = &object::create_object(signer::address_of(publisher));
        let object_signer = object::generate_signer(constructor_ref);
        let extend_ref = object::generate_extend_ref(constructor_ref);

        move_to(
            &object_signer,
            Multisig {
                extend_ref,
                signers: simple_map::new(),
                config: Config {
                    signers: vector[],
                    group_quorums: VEC_NUM_GROUPS,
                    group_parents: VEC_NUM_GROUPS
                },
                seen_signed_hashes: simple_map::new(),
                expiring_root_and_op_count: ExpiringRootAndOpCount {
                    root: vector[],
                    valid_until: 0,
                    op_count: 0
                },
                root_metadata: RootMetadata {
                    role,
                    chain_id: 0,
                    multisig: signer::address_of(&object_signer),
                    pre_op_count: 0,
                    post_op_count: 0,
                    override_previous_root: false
                }
            }
        );

        object::object_from_constructor_ref(constructor_ref)
    }

    /// @notice set_root Sets a new expiring root.
    ///
    /// @param root is the new expiring root.
    /// @param valid_until is the time by which root is valid
    /// @param chain_id is the chain id of the chain on which the root is valid
    /// @param multisig is the address of the multisig to set the root for
    /// @param pre_op_count is the number of operations that have been executed before this root was set
    /// @param post_op_count is the number of operations that have been executed after this root was set
    /// @param override_previous_root is a boolean that indicates whether to override the previous root
    /// @param metadata_proof is the MerkleProof of inclusion of the metadata in the Merkle tree.
    /// @param signatures the ECDSA signatures on (root, valid_until).
    ///
    /// @dev the message (root, valid_until) should be signed by a sufficient set of signers.
    /// This signature authenticates also the metadata.
    ///
    /// @dev this method can be executed by anyone who has the root and valid signatures.
    /// as we validate the correctness of signatures, this imposes no risk.
    public entry fun set_root(
        role: u8,
        root: vector<u8>,
        valid_until: u64,
        chain_id: u256,
        multisig_addr: address,
        pre_op_count: u64,
        post_op_count: u64,
        override_previous_root: bool,
        metadata_proof: vector<vector<u8>>,
        signatures: vector<vector<u8>>
    ) acquires Multisig, MultisigState {
        assert!(is_valid_role(role), E_INVALID_ROLE);

        let metadata = RootMetadata {
            role,
            chain_id,
            multisig: multisig_addr,
            pre_op_count,
            post_op_count,
            override_previous_root
        };

        let signed_hash = compute_eth_message_hash(root, valid_until);

        // Validate that \`multisig\` is a registered multisig for \`role\`.
        let multisig = borrow_multisig_mut(multisig_object(role));

        assert!(
            !multisig.seen_signed_hashes.contains_key(&signed_hash),
            E_ALREADY_SEEN_HASH
        );
        assert!(timestamp::now_seconds() <= valid_until, E_VALID_UNTIL_EXPIRED);
        assert!(metadata.chain_id == (chain_id::get() as u256), E_WRONG_CHAIN_ID);
        assert!(metadata.multisig == @mcms, E_WRONG_MULTISIG);

        let op_count = multisig.expiring_root_and_op_count.op_count;
        assert!(
            override_previous_root || op_count == multisig.root_metadata.post_op_count,
            E_PENDING_OPS
        );

        assert!(op_count == metadata.pre_op_count, E_WRONG_PRE_OP_COUNT);
        assert!(metadata.pre_op_count <= metadata.post_op_count, E_WRONG_POST_OP_COUNT);

        let metadata_leaf_hash = hash_metadata_leaf(metadata);
        assert!(
            verify_merkle_proof(metadata_proof, root, metadata_leaf_hash),
            E_PROOF_CANNOT_BE_VERIFIED
        );

        let prev_address = vector[];
        let group_vote_counts: vector<u8> = vector[];
        params::right_pad_vec(&mut group_vote_counts, NUM_GROUPS);

        let signatures_len = signatures.length();
        for (i in 0..signatures_len) {
            let signature = signatures[i];
            let signer_addr = ecdsa_recover_evm_addr(signed_hash, signature);
            // the off-chain system is required to sort the signatures by the
            // signer address in an increasing order
            if (i > 0) {
                assert!(
                    params::vector_u8_gt(&signer_addr, &prev_address),
                    E_SIGNER_ADDR_MUST_BE_INCREASING
                );
            };
            prev_address = signer_addr;

            assert!(multisig.signers.contains_key(&signer_addr), E_INVALID_SIGNER);
            let signer = *multisig.signers.borrow(&signer_addr);

            // check group quorums
            let group: u8 = signer.group;
            while (true) {
                let group_vote_count = group_vote_counts.borrow_mut((group as u64));
                *group_vote_count += 1;

                let quorum = multisig.config.group_quorums.borrow((group as u64));
                if (*group_vote_count != *quorum) {
                    // bail out unless we just hit the quorum. we only hit each quorum once,
                    // so we never move on to the parent of a group more than once.
                    break
                };

                if (group == 0) {
                    // root group reached
                    break
                };

                // group quorum reached, restart loop and check parent group
                group = multisig.config.group_parents[(group as u64)];
            };
        };

        // the group at the root of the tree (with index 0) determines whether the vote passed,
        // we cannot proceed if it isn't configured with a valid (non-zero) quorum
        let root_group_quorum = multisig.config.group_quorums[0];
        assert!(root_group_quorum != 0, E_MISSING_CONFIG);

        // check root group reached quorum
        let root_group_vote_count = group_vote_counts[0];
        assert!(root_group_vote_count >= root_group_quorum, E_INSUFFICIENT_SIGNERS);

        multisig.seen_signed_hashes.add(signed_hash, true);
        multisig.expiring_root_and_op_count = ExpiringRootAndOpCount {
            root,
            valid_until,
            op_count: metadata.pre_op_count
        };
        multisig.root_metadata = metadata;

        event::emit(
            NewRoot {
                role,
                root,
                valid_until,
                metadata: RootMetadata {
                    role,
                    chain_id,
                    multisig: multisig_addr,
                    pre_op_count: metadata.pre_op_count,
                    post_op_count: metadata.post_op_count,
                    override_previous_root: metadata.override_previous_root
                }
            }
        );
    }

    inline fun ecdsa_recover_evm_addr(
        eth_signed_message_hash: vector<u8>, signature: vector<u8>
    ): vector<u8> {
        // ensure signature has correct length - (r,s,v) concatenated = 65 bytes
        assert!(signature.length() == 65, E_INVALID_SIGNATURE_LEN);
        // extract v from signature
        let v = signature.pop_back();
        // convert 64 byte signature into ECDSASignature struct
        let sig = secp256k1::ecdsa_signature_from_bytes(signature);
        // Aptos uses the rust libsecp256k1 parse() under the hood which has a different numbering scheme
        // see: https://docs.rs/libsecp256k1/latest/libsecp256k1/struct.RecoveryId.html#method.parse_rpc
        assert!(v >= 27 && v < 27 + 4, E_INVALID_V_SIGNATURE);
        let v = v - 27;

        // retrieve signer public key
        let public_key = secp256k1::ecdsa_recover(eth_signed_message_hash, v, &sig);
        assert!(public_key.is_some(), E_FAILED_ECDSA_RECOVER);

        // return last 20 bytes of hashed public key as the recovered ethereum address
        let public_key_bytes =
            secp256k1::ecdsa_raw_public_key_to_bytes(&public_key.extract());
        keccak256(public_key_bytes).trim(12) // trims publicKeyBytes to 12 bytes, returns trimmed last 20 bytes
    }

    /// Execute an operation after verifying its inclusion in the merkle tree
    public entry fun execute(
        role: u8,
        chain_id: u256,
        multisig_addr: address,
        nonce: u64,
        to: address,
        module_name: String,
        function_name: String,
        data: vector<u8>,
        proof: vector<vector<u8>>
    ) acquires Multisig, MultisigState, Timelock {
        assert!(is_valid_role(role), E_INVALID_ROLE);

        let op = Op {
            role,
            chain_id,
            multisig: multisig_addr,
            nonce,
            to,
            module_name,
            function_name,
            data
        };
        let multisig = borrow_multisig_mut(multisig_object(role));

        assert!(
            multisig.root_metadata.post_op_count
                > multisig.expiring_root_and_op_count.op_count,
            E_POST_OP_COUNT_REACHED
        );
        assert!(chain_id == (chain_id::get() as u256), E_WRONG_CHAIN_ID);
        assert!(
            timestamp::now_seconds() <= multisig.expiring_root_and_op_count.valid_until,
            E_ROOT_EXPIRED
        );
        assert!(op.multisig == @mcms, E_WRONG_MULTISIG);
        assert!(nonce == multisig.expiring_root_and_op_count.op_count, E_WRONG_NONCE);

        // computes keccak256(abi.encode(MANY_CHAIN_MULTI_SIG_DOMAIN_SEPARATOR_OP, op))
        let hashed_leaf = hash_op_leaf(MANY_CHAIN_MULTI_SIG_DOMAIN_SEPARATOR_OP, op);
        assert!(
            verify_merkle_proof(
                proof, multisig.expiring_root_and_op_count.root, hashed_leaf
            ),
            E_PROOF_CANNOT_BE_VERIFIED
        );

        multisig.expiring_root_and_op_count.op_count += 1;

        // Only allow dispatching to timelock functions
        assert!(
            op.to == @mcms && *op.module_name.bytes() == b"mcms",
            E_INVALID_MODULE_NAME
        );

        dispatch_to_timelock(role, op.function_name, op.data);

        event::emit(
            OpExecuted {
                role,
                chain_id,
                multisig: multisig_addr,
                nonce,
                to,
                module_name,
                function_name,
                data
            }
        );
    }

    /// Only callable from \`execute\`, the role that was validated is passed down to the timelock functions
    inline fun dispatch_to_timelock(
        role: u8, function_name: String, data: vector<u8>
    ) {
        let function_name_bytes = *function_name.bytes();
        let stream = bcs_stream::new(data);

        if (function_name_bytes == b"timelock_schedule_batch") {
            dispatch_timelock_schedule_batch(role, &mut stream)
        } else if (function_name_bytes == b"timelock_bypasser_execute_batch") {
            dispatch_timelock_bypasser_execute_batch(role, &mut stream)
        } else if (function_name_bytes == b"timelock_execute_batch") {
            dispatch_timelock_execute_batch(&mut stream)
        } else if (function_name_bytes == b"timelock_cancel") {
            dispatch_timelock_cancel(role, &mut stream)
        } else if (function_name_bytes == b"timelock_update_min_delay") {
            dispatch_timelock_update_min_delay(role, &mut stream)
        } else if (function_name_bytes == b"timelock_block_function") {
            dispatch_timelock_block_function(role, &mut stream)
        } else if (function_name_bytes == b"timelock_unblock_function") {
            dispatch_timelock_unblock_function(role, &mut stream)
        } else {
            abort E_UNKNOWN_MCMS_TIMELOCK_FUNCTION
        }
    }

    /// \`dispatch_timelock_\` functions should only be called from dispatch functions
    inline fun dispatch_timelock_schedule_batch(
        role: u8, stream: &mut BCSStream
    ) {
        assert!(
            role == PROPOSER_ROLE || role == TIMELOCK_ROLE, E_NOT_AUTHORIZED_ROLE
        );

        let targets =
            bcs_stream::deserialize_vector(
                stream, |stream| bcs_stream::deserialize_address(stream)
            );
        let module_names =
            bcs_stream::deserialize_vector(
                stream, |stream| bcs_stream::deserialize_string(stream)
            );
        let function_names =
            bcs_stream::deserialize_vector(
                stream, |stream| bcs_stream::deserialize_string(stream)
            );
        let datas =
            bcs_stream::deserialize_vector(
                stream, |stream| bcs_stream::deserialize_vector_u8(stream)
            );
        let predecessor = bcs_stream::deserialize_vector_u8(stream);
        let salt = bcs_stream::deserialize_vector_u8(stream);
        let delay = bcs_stream::deserialize_u64(stream);
        bcs_stream::assert_is_consumed(stream);

        timelock_schedule_batch(
            targets,
            module_names,
            function_names,
            datas,
            predecessor,
            salt,
            delay
        )
    }

    inline fun dispatch_timelock_bypasser_execute_batch(
        role: u8, stream: &mut BCSStream
    ) {
        assert!(
            role == BYPASSER_ROLE || role == TIMELOCK_ROLE, E_NOT_AUTHORIZED_ROLE
        );

        let targets =
            bcs_stream::deserialize_vector(
                stream, |stream| bcs_stream::deserialize_address(stream)
            );
        let module_names =
            bcs_stream::deserialize_vector(
                stream, |stream| bcs_stream::deserialize_string(stream)
            );
        let function_names =
            bcs_stream::deserialize_vector(
                stream, |stream| bcs_stream::deserialize_string(stream)
            );
        let datas =
            bcs_stream::deserialize_vector(
                stream, |stream| bcs_stream::deserialize_vector_u8(stream)
            );
        bcs_stream::assert_is_consumed(stream);

        timelock_bypasser_execute_batch(targets, module_names, function_names, datas)
    }

    inline fun dispatch_timelock_execute_batch(stream: &mut BCSStream) {
        let targets =
            bcs_stream::deserialize_vector(
                stream, |stream| bcs_stream::deserialize_address(stream)
            );
        let module_names =
            bcs_stream::deserialize_vector(
                stream, |stream| bcs_stream::deserialize_string(stream)
            );
        let function_names =
            bcs_stream::deserialize_vector(
                stream, |stream| bcs_stream::deserialize_string(stream)
            );
        let datas =
            bcs_stream::deserialize_vector(
                stream, |stream| bcs_stream::deserialize_vector_u8(stream)
            );
        let predecessor = bcs_stream::deserialize_vector_u8(stream);
        let salt = bcs_stream::deserialize_vector_u8(stream);
        bcs_stream::assert_is_consumed(stream);

        timelock_execute_batch(
            targets,
            module_names,
            function_names,
            datas,
            predecessor,
            salt
        )
    }

    inline fun dispatch_timelock_cancel(role: u8, stream: &mut BCSStream) {
        assert!(
            role == CANCELLER_ROLE || role == TIMELOCK_ROLE, E_NOT_AUTHORIZED_ROLE
        );

        let id = bcs_stream::deserialize_vector_u8(stream);
        bcs_stream::assert_is_consumed(stream);

        timelock_cancel(id)
    }

    inline fun dispatch_timelock_update_min_delay(
        role: u8, stream: &mut BCSStream
    ) {
        assert!(role == TIMELOCK_ROLE, E_NOT_TIMELOCK_ROLE);

        let new_min_delay = bcs_stream::deserialize_u64(stream);
        bcs_stream::assert_is_consumed(stream);

        timelock_update_min_delay(new_min_delay)
    }

    inline fun dispatch_timelock_block_function(
        role: u8, stream: &mut BCSStream
    ) {
        assert!(role == TIMELOCK_ROLE, E_NOT_TIMELOCK_ROLE);

        let target = bcs_stream::deserialize_address(stream);
        let module_name = bcs_stream::deserialize_string(stream);
        let function_name = bcs_stream::deserialize_string(stream);
        bcs_stream::assert_is_consumed(stream);

        timelock_block_function(target, module_name, function_name)
    }

    inline fun dispatch_timelock_unblock_function(
        role: u8, stream: &mut BCSStream
    ) {
        assert!(role == TIMELOCK_ROLE, E_NOT_TIMELOCK_ROLE);

        let target = bcs_stream::deserialize_address(stream);
        let module_name = bcs_stream::deserialize_string(stream);
        let function_name = bcs_stream::deserialize_string(stream);
        bcs_stream::assert_is_consumed(stream);

        timelock_unblock_function(target, module_name, function_name)
    }

    /// Updates the multisig configuration, including signer addresses and group settings.
    public entry fun set_config(
        caller: &signer,
        role: u8,
        signer_addresses: vector<vector<u8>>,
        signer_groups: vector<u8>,
        group_quorums: vector<u8>,
        group_parents: vector<u8>,
        clear_root: bool
    ) acquires Multisig, MultisigState {
        mcms_account::assert_is_owner(caller);

        assert!(
            signer_addresses.length() != 0
                && signer_addresses.length() <= MAX_NUM_SIGNERS,
            E_INVALID_NUM_SIGNERS
        );
        assert!(
            signer_addresses.length() == signer_groups.length(),
            E_SIGNER_GROUPS_LEN_MISMATCH
        );
        assert!(group_quorums.length() == NUM_GROUPS, E_INVALID_GROUP_QUORUM_LEN);
        assert!(group_parents.length() == NUM_GROUPS, E_INVALID_GROUP_PARENTS_LEN);

        // validate group structure
        // counts number of children of each group
        let group_children_counts = vector[];
        params::right_pad_vec(&mut group_children_counts, NUM_GROUPS);
        // first, we count the signers as children
        signer_groups.for_each_ref(
            |group| {
                let group: u64 = *group as u64;
                assert!(group < NUM_GROUPS, E_OUT_OF_BOUNDS_GROUP);
                let count = group_children_counts.borrow_mut(group);
                *count += 1;
            }
        );

        // second, we iterate backwards so as to check each group and propagate counts from
        // child group to parent groups up the tree to the root
        for (j in 0..NUM_GROUPS) {
            let i = NUM_GROUPS - j - 1;
            // ensure we have a well-formed group tree:
            // - the root should have itself as parent
            // - all other groups should have a parent group with a lower index
            let group_parent = group_parents[i] as u64;
            assert!(
                i == 0 || group_parent < i, E_GROUP_TREE_NOT_WELL_FORMED
            );
            assert!(
                i != 0 || group_parent == 0, E_GROUP_TREE_NOT_WELL_FORMED
            );

            let group_quorum = group_quorums[i];
            let disabled = group_quorum == 0;
            let group_children_count = group_children_counts[i];
            if (disabled) {
                // if group is disabled, ensure it has no children
                assert!(group_children_count == 0, E_SIGNER_IN_DISABLED_GROUP);
            } else {
                // if group is enabled, ensure group quorum can be met
                assert!(
                    group_children_count >= group_quorum, E_OUT_OF_BOUNDS_GROUP_QUORUM
                );

                // propagate children counts to parent group
                let count = group_children_counts.borrow_mut(group_parent);
                *count += 1;
            };
        };

        let multisig = borrow_multisig_mut(multisig_object(role));

        // remove old signer addresses
        multisig.signers = simple_map::new();
        multisig.config.signers = vector[];

        // save group quorums and parents to timelock
        multisig.config.group_quorums = group_quorums;
        multisig.config.group_parents = group_parents;

        // check signer addresses are in increasing order and save signers to timelock
        // evm zero address (20 bytes of 0) is the smallest address possible
        let prev_signer_addr = vector[];
        for (i in 0..signer_addresses.length()) {
            let signer_addr = signer_addresses[i];
            assert!(signer_addr.length() == 20, E_INVALID_SIGNER_ADDR_LEN);

            if (i > 0) {
                assert!(
                    params::vector_u8_gt(&signer_addr, &prev_signer_addr),
                    E_SIGNER_ADDR_MUST_BE_INCREASING
                );
            };

            let signer = Signer {
                addr: signer_addr,
                index: (i as u8),
                group: signer_groups[i]
            };
            multisig.signers.add(signer_addr, signer);
            multisig.config.signers.push_back(signer);
            prev_signer_addr = signer_addr;
        };

        if (clear_root) {
            // clearRoot is equivalent to overriding with a completely empty root
            let op_count = multisig.expiring_root_and_op_count.op_count;
            multisig.expiring_root_and_op_count = ExpiringRootAndOpCount {
                root: vector[],
                valid_until: 0,
                op_count
            };
            multisig.root_metadata = RootMetadata {
                role,
                chain_id: (chain_id::get() as u256),
                multisig: @mcms,
                pre_op_count: op_count,
                post_op_count: op_count,
                override_previous_root: true
            };
        };

        event::emit(ConfigSet {
            role,
            config: multisig.config,
            is_root_cleared: clear_root
        });
    }

    public fun verify_merkle_proof(
        proof: vector<vector<u8>>, root: vector<u8>, leaf: vector<u8>
    ): bool {
        let computed_hash = leaf;
        proof.for_each_ref(
            |proof_element| {
                let (left, right) =
                    if (params::vector_u8_gt(&computed_hash, proof_element)) {
                        (*proof_element, computed_hash)
                    } else {
                        (computed_hash, *proof_element)
                    };
                let hash_input: vector<u8> = left;
                hash_input.append(right);
                computed_hash = keccak256(hash_input);
            }
        );
        computed_hash == root
    }

    public fun compute_eth_message_hash(
        root: vector<u8>, valid_until: u64
    ): vector<u8> {
        // abi.encode(root (bytes32), valid_until)
        let valid_until_bytes = params::encode_uint(valid_until, 32);
        assert!(root.length() == 32, E_INVALID_ROOT_LEN); // root should be 32 bytes
        let abi_encoded_params = &mut root;
        abi_encoded_params.append(valid_until_bytes);

        // keccak256(abi_encoded_params)
        let hashed_encoded_params = keccak256(*abi_encoded_params);

        // ECDSA.toEthSignedMessageHash()
        let eth_msg_prefix = b"\\x19Ethereum Signed Message:\\n32";
        let hash = &mut eth_msg_prefix;
        hash.append(hashed_encoded_params);
        keccak256(*hash)
    }

    public fun hash_op_leaf(domain_separator: vector<u8>, op: Op): vector<u8> {
        let packed = vector[];
        packed.append(domain_separator);
        packed.append(bcs::to_bytes(&op.role));
        packed.append(bcs::to_bytes(&op.chain_id));
        packed.append(bcs::to_bytes(&op.multisig));
        packed.append(bcs::to_bytes(&op.nonce));
        packed.append(bcs::to_bytes(&op.to));
        packed.append(bcs::to_bytes(&op.module_name));
        packed.append(bcs::to_bytes(&op.function_name));
        packed.append(bcs::to_bytes(&op.data));
        keccak256(packed)
    }

    #[view]
    public fun seen_signed_hashes(
        multisig: Object<Multisig>
    ): SimpleMap<vector<u8>, bool> acquires Multisig {
        borrow_multisig(multisig).seen_signed_hashes
    }

    #[view]
    /// Returns the current Merkle root along with its expiration timestamp and op count.
    public fun expiring_root_and_op_count(
        multisig: Object<Multisig>
    ): (vector<u8>, u64, u64) acquires Multisig {
        let multisig = borrow_multisig(multisig);
        (
            multisig.expiring_root_and_op_count.root,
            multisig.expiring_root_and_op_count.valid_until,
            multisig.expiring_root_and_op_count.op_count
        )
    }

    #[view]
    public fun root_metadata(multisig: Object<Multisig>): RootMetadata acquires Multisig {
        borrow_multisig(multisig).root_metadata
    }

    #[view]
    public fun get_root_metadata(role: u8): RootMetadata acquires MultisigState, Multisig {
        let multisig = multisig_object(role);
        borrow_multisig(multisig).root_metadata
    }

    #[view]
    public fun get_op_count(role: u8): u64 acquires MultisigState, Multisig {
        let multisig = multisig_object(role);
        borrow_multisig(multisig).expiring_root_and_op_count.op_count
    }

    #[view]
    public fun get_root(role: u8): (vector<u8>, u64) acquires MultisigState, Multisig {
        let multisig = borrow_multisig(multisig_object(role));
        (
            multisig.expiring_root_and_op_count.root,
            multisig.expiring_root_and_op_count.valid_until
        )
    }

    #[view]
    public fun get_config(role: u8): Config acquires MultisigState, Multisig {
        let multisig = multisig_object(role);
        borrow_multisig(multisig).config
    }

    #[view]
    public fun signers(multisig: Object<Multisig>): SimpleMap<vector<u8>, Signer> acquires Multisig {
        borrow_multisig(multisig).signers
    }

    #[view]
    /// Returns the registered multisig objects for the given role.
    public fun multisig_object(role: u8): Object<Multisig> acquires MultisigState {
        let state = borrow();
        if (role == BYPASSER_ROLE) {
            state.bypasser
        } else if (role == CANCELLER_ROLE) {
            state.canceller
        } else if (role == PROPOSER_ROLE) {
            state.proposer
        } else {
            abort E_INVALID_ROLE
        }
    }

    #[view]
    public fun num_groups(): u64 {
        NUM_GROUPS
    }

    #[view]
    public fun max_num_signers(): u64 {
        MAX_NUM_SIGNERS
    }

    #[view]
    public fun bypasser_role(): u8 {
        BYPASSER_ROLE
    }

    #[view]
    public fun canceller_role(): u8 {
        CANCELLER_ROLE
    }

    #[view]
    public fun proposer_role(): u8 {
        PROPOSER_ROLE
    }

    #[view]
    public fun timelock_role(): u8 {
        TIMELOCK_ROLE
    }

    #[view]
    public fun is_valid_role(role: u8): bool {
        role < MAX_ROLE
    }

    #[view]
    public fun zero_hash(): vector<u8> {
        ZERO_HASH
    }

    fun hash_metadata_leaf(metadata: RootMetadata): vector<u8> {
        let packed = vector[];
        packed.append(MANY_CHAIN_MULTI_SIG_DOMAIN_SEPARATOR_METADATA);
        packed.append(bcs::to_bytes(&metadata.role));
        packed.append(bcs::to_bytes(&metadata.chain_id));
        packed.append(bcs::to_bytes(&metadata.multisig));
        packed.append(bcs::to_bytes(&metadata.pre_op_count));
        packed.append(bcs::to_bytes(&metadata.post_op_count));
        packed.append(bcs::to_bytes(&metadata.override_previous_root));
        keccak256(packed)
    }

    inline fun borrow_multisig(obj: Object<Multisig>): &Multisig acquires Multisig {
        borrow_global<Multisig>(object::object_address(&obj))
    }

    inline fun borrow_multisig_mut(multisig: Object<Multisig>): &mut Multisig acquires Multisig {
        borrow_global_mut<Multisig>(object::object_address(&multisig))
    }

    inline fun borrow(): &MultisigState acquires MultisigState {
        borrow_global<MultisigState>(@mcms)
    }

    inline fun borrow_mut(): &mut MultisigState acquires MultisigState {
        borrow_global_mut<MultisigState>(@mcms)
    }

    public fun role(root_metadata: RootMetadata): u8 {
        root_metadata.role
    }

    public fun chain_id(root_metadata: RootMetadata): u256 {
        root_metadata.chain_id
    }

    public fun root_metadata_multisig(root_metadata: RootMetadata): address {
        root_metadata.multisig
    }

    public fun pre_op_count(root_metadata: RootMetadata): u64 {
        root_metadata.pre_op_count
    }

    public fun post_op_count(root_metadata: RootMetadata): u64 {
        root_metadata.post_op_count
    }

    public fun override_previous_root(root_metadata: RootMetadata): bool {
        root_metadata.override_previous_root
    }

    public fun config_signers(config: &Config): vector<Signer> {
        config.signers
    }

    public fun config_group_quorums(config: &Config): vector<u8> {
        config.group_quorums
    }

    public fun config_group_parents(config: &Config): vector<u8> {
        config.group_parents
    }

    // =======================================================================================
    // |                                 Timelock Implementation                              |
    // =======================================================================================
    #[resource_group_member(group = aptos_framework::object::ObjectGroup)]
    struct Timelock has key {
        min_delay: u64,
        /// hashed batch of hashed calls -> timestamp
        timestamps: SmartTable<vector<u8>, u64>,
        /// blocked functions
        blocked_functions: SmartVector<Function>
    }

    struct Call has copy, drop, store {
        function: Function,
        data: vector<u8>
    }

    struct Function has copy, drop, store {
        target: address,
        module_name: String,
        function_name: String
    }

    #[event]
    struct TimelockInitialized has drop, store {
        min_delay: u64
    }

    #[event]
    struct BypasserCallExecuted has drop, store {
        index: u64,
        target: address,
        module_name: String,
        function_name: String,
        data: vector<u8>
    }

    #[event]
    struct Cancelled has drop, store {
        id: vector<u8>
    }

    #[event]
    struct CallScheduled has drop, store {
        id: vector<u8>,
        index: u64,
        target: address,
        module_name: String,
        function_name: String,
        data: vector<u8>,
        predecessor: vector<u8>,
        salt: vector<u8>,
        delay: u64
    }

    #[event]
    struct CallExecuted has drop, store {
        id: vector<u8>,
        index: u64,
        target: address,
        module_name: String,
        function_name: String,
        data: vector<u8>
    }

    #[event]
    struct UpdateMinDelay has drop, store {
        old_min_delay: u64,
        new_min_delay: u64
    }

    #[event]
    struct FunctionBlocked has drop, store {
        target: address,
        module_name: String,
        function_name: String
    }

    #[event]
    struct FunctionUnblocked has drop, store {
        target: address,
        module_name: String,
        function_name: String
    }

    /// Schedule a batch of calls to be executed after a delay.
    /// This function can only be called by PROPOSER or ADMIN role.
    inline fun timelock_schedule_batch(
        targets: vector<address>,
        module_names: vector<String>,
        function_names: vector<String>,
        datas: vector<vector<u8>>,
        predecessor: vector<u8>,
        salt: vector<u8>,
        delay: u64
    ) {
        let calls = create_calls(targets, module_names, function_names, datas);
        let id = hash_operation_batch(calls, predecessor, salt);
        let timelock = borrow_mut_timelock();

        timelock_schedule(timelock, id, delay);

        for (i in 0..calls.length()) {
            assert_not_blocked(timelock, &calls[i].function);
            event::emit(
                CallScheduled {
                    id,
                    index: i,
                    target: calls[i].function.target,
                    module_name: calls[i].function.module_name,
                    function_name: calls[i].function.function_name,
                    data: calls[i].data,
                    predecessor,
                    salt,
                    delay
                }
            );
        };
    }

    inline fun timelock_schedule(
        timelock: &mut Timelock, id: vector<u8>, delay: u64
    ) {
        assert!(
            !timelock_is_operation_internal(timelock, id),
            E_OPERATION_ALREADY_SCHEDULED
        );
        assert!(delay >= timelock.min_delay, E_INSUFFICIENT_DELAY);

        let timestamp = timestamp::now_seconds() + delay;
        timelock.timestamps.add(id, timestamp);

    }

    inline fun timelock_before_call(
        id: vector<u8>, predecessor: vector<u8>
    ) {
        assert!(timelock_is_operation_ready(id), E_OPERATION_NOT_READY);
        assert!(
            predecessor == ZERO_HASH || timelock_is_operation_done(predecessor),
            E_MISSING_DEPENDENCY
        );
    }

    inline fun timelock_after_call(id: vector<u8>) {
        assert!(timelock_is_operation_ready(id), E_OPERATION_NOT_READY);
        *borrow_mut_timelock().timestamps.borrow_mut(id) = DONE_TIMESTAMP;
    }

    /// Anyone can call this as it checks if the operation was scheduled by a bypasser or proposer.
    public entry fun timelock_execute_batch(
        targets: vector<address>,
        module_names: vector<String>,
        function_names: vector<String>,
        datas: vector<vector<u8>>,
        predecessor: vector<u8>,
        salt: vector<u8>
    ) acquires Multisig, MultisigState, Timelock {
        let calls = create_calls(targets, module_names, function_names, datas);
        let id = hash_operation_batch(calls, predecessor, salt);

        timelock_before_call(id, predecessor);

        for (i in 0..calls.length()) {
            let function = calls[i].function;
            let target = function.target;
            let module_name = function.module_name;
            let function_name = function.function_name;
            let data = calls[i].data;

            timelock_dispatch(target, module_name, function_name, data);

            event::emit(
                CallExecuted {
                    id,
                    index: i,
                    target,
                    module_name,
                    function_name,
                    data
                }
            );
        };

        timelock_after_call(id);
    }

    fun timelock_bypasser_execute_batch(
        targets: vector<address>,
        module_names: vector<String>,
        function_names: vector<String>,
        datas: vector<vector<u8>>
    ) acquires Multisig, MultisigState, Timelock {
        let len = targets.length();
        assert!(
            len == module_names.length()
                && len == function_names.length()
                && len == datas.length(),
            E_INVALID_PARAMETERS
        );

        for (i in 0..len) {
            let target = targets[i];
            let module_name = module_names[i];
            let function_name = function_names[i];
            let data = datas[i];

            timelock_dispatch(target, module_name, function_name, data);

            event::emit(
                BypasserCallExecuted { index: i, target, module_name, function_name, data }
            );
        };
    }

    /// If we reach here, we know that the call was scheduled and is ready to be executed.
    /// Only callable from \`timelock_execute_batch\` or \`timelock_bypasser_execute_batch\`
    inline fun timelock_dispatch(
        target: address,
        module_name: String,
        function_name: String,
        data: vector<u8>
    ) {
        let module_name_bytes = *module_name.bytes();
        let function_name_bytes = *function_name.bytes();

        if (target == @mcms) {
            if (module_name_bytes == b"mcms") {
                // dispatch to the mcms module's functions for setting config, scheduling, executing, and canceling operations.
                timelock_dispatch_to_self(function_name, data);
            } else if (module_name_bytes == b"mcms_account") {
                // dispatch to the account module's functions for ownership transfers.
                timelock_dispatch_to_account(function_name_bytes, data);
            } else if (module_name_bytes == b"mcms_deployer") {
                // dispatch to the deployer module's functions for deploying and upgrading contracts.
                timelock_dispatch_to_deployer(function_name_bytes, data);
            } else if (module_name_bytes == b"mcms_registry") {
                // dispatch to the registry module's functions for code object management.
                timelock_dispatch_to_registry(function_name_bytes, data);
            } else {
                abort E_UNKNOWN_MCMS_MODULE;
            }
        } else {
            // If role is present, it must be a bypasser (calling from \`execute\`).
            let object_meta =
                mcms_registry::start_dispatch(target, module_name, function_name, data);
            aptos_framework::dispatchable_fungible_asset::derived_supply(object_meta);
            mcms_registry::finish_dispatch(target);
        }
    }

    inline fun timelock_dispatch_to_self(
        function_name: String, data: vector<u8>
    ) {
        let stream = bcs_stream::new(data);
        let fn_bytes = *function_name.bytes();
        let prefix = b"timelock";

        if (fn_bytes.length() >= prefix.length()
            && fn_bytes.slice(0, prefix.length()) == prefix) {
            // Pass \`TIMELOCK_ROLE\` as the function call has already been validated
            dispatch_to_timelock(TIMELOCK_ROLE, function_name, data);
        } else if (fn_bytes == b"set_config") {
            let role_param = bcs_stream::deserialize_u8(&mut stream);
            let signer_addresses =
                bcs_stream::deserialize_vector(
                    &mut stream,
                    |stream| { bcs_stream::deserialize_vector_u8(stream) }
                );
            let signer_groups = bcs_stream::deserialize_vector_u8(&mut stream);
            let group_quorums = bcs_stream::deserialize_vector_u8(&mut stream);
            let group_parents = bcs_stream::deserialize_vector_u8(&mut stream);
            let clear_root = bcs_stream::deserialize_bool(&mut stream);
            bcs_stream::assert_is_consumed(&stream);

            set_config(
                &mcms_account::get_signer(), // Must get MCMS signer for \`set_config\`
                role_param,
                signer_addresses,
                signer_groups,
                group_quorums,
                group_parents,
                clear_root
            );
        } else {
            abort E_UNKNOWN_MCMS_MODULE_FUNCTION
        }
    }

    inline fun timelock_dispatch_to_account(
        function_name_bytes: vector<u8>, data: vector<u8>
    ) {
        let stream = bcs_stream::new(data);
        let self_signer = &mcms_account::get_signer();

        if (function_name_bytes == b"transfer_ownership") {
            let target = bcs_stream::deserialize_address(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            mcms_account::transfer_ownership(self_signer, target);
        } else if (function_name_bytes == b"accept_ownership") {
            bcs_stream::assert_is_consumed(&stream);
            mcms_account::accept_ownership(self_signer);
        } else {
            abort E_UNKNOWN_MCMS_ACCOUNT_MODULE_FUNCTION;
        }
    }

    inline fun timelock_dispatch_to_deployer(
        function_name_bytes: vector<u8>, data: vector<u8>
    ) {
        let self_signer = &mcms_account::get_signer();
        let stream = bcs_stream::new(data);

        if (function_name_bytes == b"stage_code_chunk") {
            let metadata_chunk = bcs_stream::deserialize_vector_u8(&mut stream);
            let code_indices =
                bcs_stream::deserialize_vector(
                    &mut stream,
                    |stream| { bcs_stream::deserialize_u16(stream) }
                );
            let code_chunks =
                bcs_stream::deserialize_vector(
                    &mut stream,
                    |stream| { bcs_stream::deserialize_vector_u8(stream) }
                );
            bcs_stream::assert_is_consumed(&stream);

            mcms_deployer::stage_code_chunk(
                self_signer,
                metadata_chunk,
                code_indices,
                code_chunks
            );
        } else if (function_name_bytes == b"stage_code_chunk_and_publish_to_object") {
            let metadata_chunk = bcs_stream::deserialize_vector_u8(&mut stream);
            let code_indices =
                bcs_stream::deserialize_vector(
                    &mut stream,
                    |stream| { bcs_stream::deserialize_u16(stream) }
                );
            let code_chunks =
                bcs_stream::deserialize_vector(
                    &mut stream,
                    |stream| { bcs_stream::deserialize_vector_u8(stream) }
                );
            let new_owner_seed = bcs_stream::deserialize_vector_u8(&mut stream);
            bcs_stream::assert_is_consumed(&stream);

            mcms_deployer::stage_code_chunk_and_publish_to_object(
                self_signer,
                metadata_chunk,
                code_indices,
                code_chunks,
                new_owner_seed
            );
        } else if (function_name_bytes == b"stage_code_chunk_and_upgrade_object_code") {
            let metadata_chunk = bcs_stream::deserialize_vector_u8(&mut stream);
            let code_indices =
                bcs_stream::deserialize_vector(
                    &mut stream,
                    |stream| { bcs_stream::deserialize_u16(stream) }
                );
            let code_chunks =
                bcs_stream::deserialize_vector(
                    &mut stream,
                    |stream| { bcs_stream::deserialize_vector_u8(stream) }
                );
            let code_object_address = bcs_stream::deserialize_address(&mut stream);
            bcs_stream::assert_is_consumed(&stream);

            mcms_deployer::stage_code_chunk_and_upgrade_object_code(
                self_signer,
                metadata_chunk,
                code_indices,
                code_chunks,
                code_object_address
            );
        } else if (function_name_bytes == b"cleanup_staging_area") {
            bcs_stream::assert_is_consumed(&stream);
            mcms_deployer::cleanup_staging_area(self_signer);
        } else {
            abort E_UNKNOWN_MCMS_DEPLOYER_MODULE_FUNCTION;
        }
    }

    inline fun timelock_dispatch_to_registry(
        function_name_bytes: vector<u8>, data: vector<u8>
    ) {
        let stream = bcs_stream::new(data);
        let self_signer = &mcms_account::get_signer();

        if (function_name_bytes == b"create_owner_for_preexisting_code_object") {
            let object_address = bcs_stream::deserialize_address(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            mcms_registry::create_owner_for_preexisting_code_object(
                self_signer, object_address
            );
        } else if (function_name_bytes == b"transfer_code_object") {
            let object_address = bcs_stream::deserialize_address(&mut stream);
            let new_owner_address = bcs_stream::deserialize_address(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            mcms_registry::transfer_code_object(
                self_signer, object_address, new_owner_address
            );
        } else if (function_name_bytes == b"execute_code_object_transfer") {
            let object_address = bcs_stream::deserialize_address(&mut stream);
            let new_owner_address = bcs_stream::deserialize_address(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            mcms_registry::execute_code_object_transfer(
                self_signer, object_address, new_owner_address
            );
        } else {
            abort E_UNKNOWN_MCMS_REGISTRY_MODULE_FUNCTION;
        }
    }

    inline fun timelock_cancel(id: vector<u8>) {
        assert!(timelock_is_operation_pending(id), E_OPERATION_CANNOT_BE_CANCELLED);

        borrow_mut_timelock().timestamps.remove(id);
        event::emit(Cancelled { id });
    }

    inline fun timelock_update_min_delay(new_min_delay: u64) {
        let timelock = borrow_mut_timelock();
        let old_min_delay = timelock.min_delay;
        timelock.min_delay = new_min_delay;

        event::emit(UpdateMinDelay { old_min_delay, new_min_delay });
    }

    inline fun timelock_block_function(
        target: address, module_name: String, function_name: String
    ) {
        let already_blocked = false;
        let new_function = Function { target, module_name, function_name };
        let timelock = borrow_mut_timelock();

        for (i in 0..timelock.blocked_functions.length()) {
            let blocked_function = timelock.blocked_functions.borrow(i);
            if (equals(&new_function, blocked_function)) {
                already_blocked = true;
                break
            };
        };

        if (!already_blocked) {
            timelock.blocked_functions.push_back(new_function);
            event::emit(FunctionBlocked { target, module_name, function_name });
        };
    }

    inline fun timelock_unblock_function(
        target: address, module_name: String, function_name: String
    ) {
        let function_to_unblock = Function { target, module_name, function_name };
        let timelock = borrow_mut_timelock();

        for (i in 0..timelock.blocked_functions.length()) {
            let blocked_function = timelock.blocked_functions.borrow(i);
            if (equals(&function_to_unblock, blocked_function)) {
                timelock.blocked_functions.swap_remove(i);
                event::emit(FunctionUnblocked { target, module_name, function_name });
                break
            };
        };
    }

    inline fun assert_not_blocked(
        timelock: &Timelock, function: &Function
    ) {
        for (i in 0..timelock.blocked_functions.length()) {
            let blocked_function = timelock.blocked_functions.borrow(i);
            if (equals(function, blocked_function)) {
                abort E_FUNCTION_BLOCKED;
            };
        };
    }

    #[view]
    public fun timelock_get_blocked_function(index: u64): Function acquires Timelock {
        let timelock = borrow_timelock();
        assert!(index < timelock.blocked_functions.length(), E_INVALID_INDEX);
        *timelock.blocked_functions.borrow(index)
    }

    #[view]
    public fun timelock_is_operation(id: vector<u8>): bool acquires Timelock {
        timelock_is_operation_internal(borrow_timelock(), id)
    }

    inline fun timelock_is_operation_internal(
        timelock: &Timelock, id: vector<u8>
    ): bool {
        timelock.timestamps.contains(id) && *timelock.timestamps.borrow(id) > 0
    }

    #[view]
    public fun timelock_is_operation_pending(id: vector<u8>): bool acquires Timelock {
        let timelock = borrow_timelock();
        timelock.timestamps.contains(id)
            && *timelock.timestamps.borrow(id) > DONE_TIMESTAMP
    }

    #[view]
    public fun timelock_is_operation_ready(id: vector<u8>): bool acquires Timelock {
        let timelock = borrow_timelock();
        if (!timelock.timestamps.contains(id)) {
            return false
        };

        let timestamp_value = *timelock.timestamps.borrow(id);
        timestamp_value > DONE_TIMESTAMP && timestamp_value <= timestamp::now_seconds()
    }

    #[view]
    public fun timelock_is_operation_done(id: vector<u8>): bool acquires Timelock {
        let timelock = borrow_timelock();
        timelock.timestamps.contains(id)
            && *timelock.timestamps.borrow(id) == DONE_TIMESTAMP
    }

    #[view]
    public fun timelock_get_timestamp(id: vector<u8>): u64 acquires Timelock {
        let timelock = borrow_timelock();
        if (timelock.timestamps.contains(id)) {
            *timelock.timestamps.borrow(id)
        } else { 0 }
    }

    #[view]
    public fun timelock_min_delay(): u64 acquires Timelock {
        borrow_timelock().min_delay
    }

    #[view]
    public fun timelock_get_blocked_functions(): vector<Function> acquires Timelock {
        let timelock = borrow_timelock();
        let blocked_functions = vector[];
        for (i in 0..timelock.blocked_functions.length()) {
            blocked_functions.push_back(*timelock.blocked_functions.borrow(i));
        };
        blocked_functions
    }

    #[view]
    public fun timelock_get_blocked_functions_count(): u64 acquires Timelock {
        borrow_timelock().blocked_functions.length()
    }

    public fun create_calls(
        targets: vector<address>,
        module_names: vector<String>,
        function_names: vector<String>,
        datas: vector<vector<u8>>
    ): vector<Call> {
        let len = targets.length();
        assert!(
            len == module_names.length()
                && len == function_names.length()
                && len == datas.length(),
            E_INVALID_PARAMETERS
        );

        let calls = vector[];
        for (i in 0..len) {
            let target = targets[i];
            let module_name = module_names[i];
            let function_name = function_names[i];
            let data = datas[i];
            let function = Function { target, module_name, function_name };
            let call = Call { function, data };
            calls.push_back(call);
        };

        calls
    }

    public fun hash_operation_batch(
        calls: vector<Call>, predecessor: vector<u8>, salt: vector<u8>
    ): vector<u8> {
        let packed = vector[];
        packed.append(bcs::to_bytes(&calls));
        packed.append(predecessor);
        packed.append(salt);
        keccak256(packed)
    }

    fun equals(fn1: &Function, fn2: &Function): bool {
        fn1.target == fn2.target
            && fn1.module_name.bytes() == fn2.module_name.bytes()
            && fn1.function_name.bytes() == fn2.function_name.bytes()
    }

    inline fun borrow_timelock(): &Timelock acquires Timelock {
        borrow_global<Timelock>(@mcms)
    }

    inline fun borrow_mut_timelock(): &mut Timelock acquires Timelock {
        borrow_global_mut<Timelock>(@mcms)
    }

    public fun signer_view(signer_: &Signer): (vector<u8>, u8, u8) {
        (signer_.addr, signer_.index, signer_.group)
    }

    public fun function_name(function: Function): String {
        function.function_name
    }

    public fun module_name(function: Function): String {
        function.module_name
    }

    public fun target(function: Function): address {
        function.target
    }

    public fun data(call: Call): vector<u8> {
        call.data
    }

    // ======================= TEST ONLY FUNCTIONS ======================= //
    #[test_only]
    public fun init_module_for_testing(publisher: &signer) {
        init_module(publisher);
    }

    #[test_only]
    public fun test_hash_metadata_leaf(
        role: u8,
        chain_id: u256,
        multisig: address,
        pre_op_count: u64,
        post_op_count: u64,
        override_previous_root: bool
    ): vector<u8> {
        let metadata = RootMetadata {
            role,
            chain_id,
            multisig,
            pre_op_count,
            post_op_count,
            override_previous_root
        };
        hash_metadata_leaf(metadata)
    }

    #[test_only]
    public fun test_set_expiring_root_and_op_count(
        multisig: Object<Multisig>,
        root: vector<u8>,
        valid_until: u64,
        op_count: u64
    ) acquires Multisig {
        let multisig = borrow_multisig_mut(multisig);
        multisig.expiring_root_and_op_count.root = root;
        multisig.expiring_root_and_op_count.valid_until = valid_until;
        multisig.expiring_root_and_op_count.op_count = op_count;
    }

    #[test_only]
    public fun test_set_root_metadata(
        multisig: Object<Multisig>,
        role: u8,
        chain_id: u256,
        multisig_addr: address,
        pre_op_count: u64,
        post_op_count: u64,
        override_previous_root: bool
    ) acquires Multisig {
        let multisig = borrow_multisig_mut(multisig);
        multisig.root_metadata.role = role;
        multisig.root_metadata.chain_id = chain_id;
        multisig.root_metadata.multisig = multisig_addr;
        multisig.root_metadata.pre_op_count = pre_op_count;
        multisig.root_metadata.post_op_count = post_op_count;
        multisig.root_metadata.override_previous_root = override_previous_root;
    }

    #[test_only]
    public fun test_ecdsa_recover_evm_addr(
        eth_signed_message_hash: vector<u8>, signature: vector<u8>
    ): vector<u8> {
        ecdsa_recover_evm_addr(eth_signed_message_hash, signature)
    }

    #[test_only]
    public fun test_timelock_schedule_batch(
        targets: vector<address>,
        module_names: vector<String>,
        function_names: vector<String>,
        datas: vector<vector<u8>>,
        predecessor: vector<u8>,
        salt: vector<u8>,
        delay: u64
    ) acquires Timelock {
        timelock_schedule_batch(
            targets,
            module_names,
            function_names,
            datas,
            predecessor,
            salt,
            delay
        );
    }

    #[test_only]
    public fun test_timelock_update_min_delay(delay: u64) acquires Timelock {
        timelock_update_min_delay(delay);
    }

    #[test_only]
    public fun test_timelock_cancel(id: vector<u8>) acquires Timelock {
        timelock_cancel(id);
    }

    #[test_only]
    public fun test_timelock_bypasser_execute_batch(
        targets: vector<address>,
        module_names: vector<String>,
        function_names: vector<String>,
        datas: vector<vector<u8>>
    ) acquires Multisig, MultisigState, Timelock {
        timelock_bypasser_execute_batch(targets, module_names, function_names, datas);
    }

    #[test_only]
    public fun test_timelock_block_function(
        target: address, module_name: String, function_name: String
    ) acquires Timelock {
        timelock_block_function(target, module_name, function_name);
    }

    #[test_only]
    public fun test_timelock_unblock_function(
        target: address, module_name: String, function_name: String
    ) acquires Timelock {
        timelock_unblock_function(target, module_name, function_name);
    }

    #[test_only]
    public fun create_op(
        role: u8,
        chain_id: u256,
        multisig: address,
        nonce: u64,
        to: address,
        module_name: String,
        function_name: String,
        data: vector<u8>
    ): Op {
        Op {
            role,
            chain_id,
            multisig,
            nonce,
            to,
            module_name,
            function_name,
            data
        }
    }

    #[test_only]
    public fun test_timelock_dispatch(
        target: address,
        module_name: String,
        function_name: String,
        data: vector<u8>
    ) acquires Multisig, MultisigState, Timelock {
        timelock_dispatch(target, module_name, function_name, data)
    }
}
`

/** sources/utils/bcs_stream.move */
export const MCMS_UTILS_BCS_STREAM_MOVE = `/// Copied and modified from: https://github.com/aptos-labs/aptos-core/blob/9baf39b6fba7812f09238c91973f61fd0955057c/aptos-move/move-examples/bcs-stream/sources/stream.move
///
/// This module enables the deserialization of BCS-formatted byte arrays into Move primitive types.
/// Deserialization Strategies:
/// - Per-Byte Deserialization: Employed for most types to ensure lower gas consumption, this method processes each byte
///   individually to match the length and type requirements of target Move types.
/// - Exception: For the \`deserialize_address\` function, the function-based approach from \`aptos_std::from_bcs\` is used
///   due to type constraints, even though it is generally more gas-intensive.
/// - This can be optimized further by introducing native vector slices.
/// Application:
/// - This deserializer is particularly valuable for processing BCS serialized data within Move modules,
///   especially useful for systems requiring cross-chain message interpretation or off-chain data verification.
module mcms::bcs_stream {
    use std::error;
    use std::vector;
    use std::option::{Self, Option};
    use std::string::{Self, String};

    use aptos_std::from_bcs;

    /// The data does not fit the expected format.
    const E_MALFORMED_DATA: u64 = 1;
    /// There are not enough bytes to deserialize for the given type.
    const E_OUT_OF_BYTES: u64 = 2;
    /// The stream has not been consumed.
    const E_NOT_CONSUMED: u64 = 3;

    struct BCSStream has drop {
        /// Byte buffer containing the serialized data.
        data: vector<u8>,
        /// Cursor indicating the current position in the byte buffer.
        cur: u64
    }

    /// Constructs a new BCSStream instance from the provided byte array.
    public fun new(data: vector<u8>): BCSStream {
        BCSStream { data, cur: 0 }
    }

    /// Asserts that the stream has been fully consumed.
    public fun assert_is_consumed(stream: &BCSStream) {
        assert!(stream.cur == stream.data.length(), error::invalid_state(E_NOT_CONSUMED));
    }

    /// Deserializes a ULEB128-encoded integer from the stream.
    /// In the BCS format, lengths of vectors are represented using ULEB128 encoding.
    public fun deserialize_uleb128(stream: &mut BCSStream): u64 {
        let res = 0;
        let shift = 0;

        while (stream.cur < stream.data.length()) {
            let byte = stream.data[stream.cur];
            stream.cur += 1;

            let val = ((byte & 0x7f) as u64);
            if (((val << shift) >> shift) != val) {
                abort error::invalid_argument(E_MALFORMED_DATA)
            };
            res |=(val << shift);

            if ((byte & 0x80) == 0) {
                if (shift > 0 && val == 0) {
                    abort error::invalid_argument(E_MALFORMED_DATA)
                };
                return res
            };

            shift += 7;
            if (shift > 64) {
                abort error::invalid_argument(E_MALFORMED_DATA)
            };
        };

        abort error::out_of_range(E_OUT_OF_BYTES)
    }

    /// Deserializes a \`bool\` value from the stream.
    public fun deserialize_bool(stream: &mut BCSStream): bool {
        assert!(stream.cur < stream.data.length(), error::out_of_range(E_OUT_OF_BYTES));
        let byte = stream.data[stream.cur];
        stream.cur += 1;
        if (byte == 0) { false }
        else if (byte == 1) { true }
        else {
            abort error::invalid_argument(E_MALFORMED_DATA)
        }
    }

    /// Deserializes an \`address\` value from the stream.
    /// 32-byte \`address\` values are serialized using little-endian byte order.
    /// This function utilizes the \`to_address\` function from the \`aptos_std::from_bcs\` module,
    /// because the Move type system does not permit per-byte referencing of addresses.
    public fun deserialize_address(stream: &mut BCSStream): address {
        let data = &stream.data;
        let cur = stream.cur;

        assert!(
            cur + 32 <= data.length(), error::out_of_range(E_OUT_OF_BYTES)
        );
        let res = from_bcs::to_address(data.slice(cur, cur + 32));

        stream.cur = cur + 32;
        res
    }

    /// Deserializes a \`u8\` value from the stream.
    /// 1-byte \`u8\` values are serialized using little-endian byte order.
    public fun deserialize_u8(stream: &mut BCSStream): u8 {
        let data = &stream.data;
        let cur = stream.cur;

        assert!(cur < data.length(), error::out_of_range(E_OUT_OF_BYTES));

        let res = data[cur];

        stream.cur = cur + 1;
        res
    }

    /// Deserializes a \`u16\` value from the stream.
    /// 2-byte \`u16\` values are serialized using little-endian byte order.
    public fun deserialize_u16(stream: &mut BCSStream): u16 {
        let data = &stream.data;
        let cur = stream.cur;

        assert!(
            cur + 2 <= data.length(), error::out_of_range(E_OUT_OF_BYTES)
        );
        let res = (data[cur] as u16) | ((data[cur + 1] as u16) << 8);

        stream.cur += 2;
        res
    }

    /// Deserializes a \`u32\` value from the stream.
    /// 4-byte \`u32\` values are serialized using little-endian byte order.
    public fun deserialize_u32(stream: &mut BCSStream): u32 {
        let data = &stream.data;
        let cur = stream.cur;

        assert!(
            cur + 4 <= data.length(), error::out_of_range(E_OUT_OF_BYTES)
        );
        let res =
            (data[cur] as u32) | ((data[cur + 1] as u32) << 8) | ((data[cur + 2] as u32)
                << 16) | ((data[cur + 3] as u32) << 24);

        stream.cur += 4;
        res
    }

    /// Deserializes a \`u64\` value from the stream.
    /// 8-byte \`u64\` values are serialized using little-endian byte order.
    public fun deserialize_u64(stream: &mut BCSStream): u64 {
        let data = &stream.data;
        let cur = stream.cur;

        assert!(
            cur + 8 <= data.length(), error::out_of_range(E_OUT_OF_BYTES)
        );
        let res =
            (data[cur] as u64) | ((data[cur + 1] as u64) << 8) | ((data[cur + 2] as u64)
                << 16) | ((data[cur + 3] as u64) << 24) | ((data[cur + 4] as u64) << 32)
                | ((data[cur + 5] as u64) << 40) | ((data[cur + 6] as u64) << 48)
                | ((data[cur + 7] as u64) << 56);

        stream.cur += 8;
        res
    }

    /// Deserializes a \`u128\` value from the stream.
    /// 16-byte \`u128\` values are serialized using little-endian byte order.
    public fun deserialize_u128(stream: &mut BCSStream): u128 {
        let data = &stream.data;
        let cur = stream.cur;

        assert!(
            cur + 16 <= data.length(), error::out_of_range(E_OUT_OF_BYTES)
        );
        let res =
            (data[cur] as u128) | ((data[cur + 1] as u128) << 8)
                | ((data[cur + 2] as u128) << 16) | ((data[cur + 3] as u128) << 24)
                | ((data[cur + 4] as u128) << 32) | ((data[cur + 5] as u128) << 40)
                | ((data[cur + 6] as u128) << 48) | ((data[cur + 7] as u128) << 56)
                | ((data[cur + 8] as u128) << 64) | ((data[cur + 9] as u128) << 72)
                | ((data[cur + 10] as u128) << 80) | ((data[cur + 11] as u128) << 88)
                | ((data[cur + 12] as u128) << 96) | ((data[cur + 13] as u128) << 104)
                | ((data[cur + 14] as u128) << 112) | ((data[cur + 15] as u128) << 120);

        stream.cur += 16;
        res
    }

    /// Deserializes a \`u256\` value from the stream.
    /// 32-byte \`u256\` values are serialized using little-endian byte order.
    public fun deserialize_u256(stream: &mut BCSStream): u256 {
        let data = &stream.data;
        let cur = stream.cur;

        assert!(
            cur + 32 <= data.length(), error::out_of_range(E_OUT_OF_BYTES)
        );
        let res =
            (data[cur] as u256) | ((data[cur + 1] as u256) << 8)
                | ((data[cur + 2] as u256) << 16) | ((data[cur + 3] as u256) << 24)
                | ((data[cur + 4] as u256) << 32) | ((data[cur + 5] as u256) << 40)
                | ((data[cur + 6] as u256) << 48) | ((data[cur + 7] as u256) << 56)
                | ((data[cur + 8] as u256) << 64) | ((data[cur + 9] as u256) << 72)
                | ((data[cur + 10] as u256) << 80) | ((data[cur + 11] as u256) << 88)
                | ((data[cur + 12] as u256) << 96) | ((data[cur + 13] as u256) << 104)
                | ((data[cur + 14] as u256) << 112) | ((data[cur + 15] as u256) << 120)
                | ((data[cur + 16] as u256) << 128) | ((data[cur + 17] as u256) << 136)
                | ((data[cur + 18] as u256) << 144) | ((data[cur + 19] as u256) << 152)
                | ((data[cur + 20] as u256) << 160) | ((data[cur + 21] as u256) << 168)
                | ((data[cur + 22] as u256) << 176) | ((data[cur + 23] as u256) << 184)
                | ((data[cur + 24] as u256) << 192) | ((data[cur + 25] as u256) << 200)
                | ((data[cur + 26] as u256) << 208) | ((data[cur + 27] as u256) << 216)
                | ((data[cur + 28] as u256) << 224) | ((data[cur + 29] as u256) << 232)
                | ((data[cur + 30] as u256) << 240) | ((data[cur + 31] as u256) << 248);

        stream.cur += 32;
        res
    }

    /// Deserializes a \`u256\` value from the stream.
    public entry fun deserialize_u256_entry(data: vector<u8>, cursor: u64) {
        let stream = BCSStream { data, cur: cursor };
        deserialize_u256(&mut stream);
    }

    /// Deserializes an array of BCS deserializable elements from the stream.
    /// First, reads the length of the vector, which is in uleb128 format.
    /// After determining the length, it then reads the contents of the vector.
    /// The \`elem_deserializer\` lambda expression is used sequentially to deserialize each element of the vector.
    public inline fun deserialize_vector<E>(
        stream: &mut BCSStream, elem_deserializer: |&mut BCSStream| E
    ): vector<E> {
        let len = deserialize_uleb128(stream);
        let v = vector::empty();

        for (i in 0..len) {
            v.push_back(elem_deserializer(stream));
        };

        v
    }

    public fun deserialize_vector_u8(stream: &mut BCSStream): vector<u8> {
        let len = deserialize_uleb128(stream);
        let data = &mut stream.data;
        let cur = stream.cur;

        assert!(
            cur + len <= data.length(), error::out_of_range(E_OUT_OF_BYTES)
        );

        // AIP-105 introduces vector::move_range to efficiently move a range of elements from one vector to another.
        let res = data.trim(cur);
        stream.data = res.trim(len);
        stream.cur = 0;

        res
    }

    public fun deserialize_fixed_vector_u8(
        stream: &mut BCSStream, len: u64
    ): vector<u8> {
        let data = &mut stream.data;
        let cur = stream.cur;

        assert!(
            cur + len <= data.length(), error::out_of_range(E_OUT_OF_BYTES)
        );

        // AIP-105 introduces vector::move_range to efficiently move a range of elements from one vector to another.
        let res = data.trim(cur);
        stream.data = res.trim(len);
        stream.cur = 0;

        res
    }

    /// Deserializes utf-8 \`String\` from the stream.
    /// First, reads the length of the String, which is in uleb128 format.
    /// After determining the length, it then reads the contents of the String.
    public fun deserialize_string(stream: &mut BCSStream): String {
        let len = deserialize_uleb128(stream);
        let data = &mut stream.data;
        let cur = stream.cur;

        assert!(
            cur + len <= data.length(), error::out_of_range(E_OUT_OF_BYTES)
        );

        // AIP-105 introduces vector::move_range to efficiently move a range of elements from one vector to another.
        let res = data.trim(cur);
        stream.data = res.trim(len);
        stream.cur = 0;

        string::utf8(res)
    }

    /// Deserializes \`Option\` from the stream.
    /// First, reads a single byte representing the presence (0x01) or absence (0x00) of data.
    /// After determining the presence of data, it then reads the actual data if present.
    /// The \`elem_deserializer\` lambda expression is used to deserialize the element contained within the \`Option\`.
    public inline fun deserialize_option<E>(
        stream: &mut BCSStream, elem_deserializer: |&mut BCSStream| E
    ): Option<E> {
        let is_data = deserialize_bool(stream);
        if (is_data) {
            option::some(elem_deserializer(stream))
        } else {
            option::none()
        }
    }
}
`

/** sources/utils/params.move */
export const MCMS_UTILS_PARAMS_MOVE = `module mcms::params {
    use std::bcs;

    const E_CMP_VECTORS_DIFF_LEN: u64 = 1;
    const E_INPUT_TOO_LARGE_FOR_NUM_BYTES: u64 = 2;

    public inline fun encode_uint<T: drop>(input: T, num_bytes: u64): vector<u8> {
        let bcs_bytes = bcs::to_bytes(&input);

        let len = bcs_bytes.length();
        assert!(len <= num_bytes, E_INPUT_TOO_LARGE_FOR_NUM_BYTES);

        if (len < num_bytes) {
            let bytes_to_pad = num_bytes - len;
            for (i in 0..bytes_to_pad) {
                bcs_bytes.push_back(0);
            };
        };

        // little endian to big endian
        bcs_bytes.reverse();

        bcs_bytes
    }

    public inline fun right_pad_vec(v: &mut vector<u8>, num_bytes: u64) {
        let len = v.length();
        if (len < num_bytes) {
            let bytes_to_pad = num_bytes - len;
            for (i in 0..bytes_to_pad) {
                v.push_back(0);
            };
        };
    }

    /// compares two vectors of equal length, returns true if a > b, false otherwise.
    public fun vector_u8_gt(a: &vector<u8>, b: &vector<u8>): bool {
        let len = a.length();
        assert!(len == b.length(), E_CMP_VECTORS_DIFF_LEN);

        if (len == 0) {
            return false
        };

        // compare each byte until not equal
        for (i in 0..len) {
            let byte_a = a[i];
            let byte_b = b[i];
            if (byte_a > byte_b) {
                return true
            } else if (byte_a < byte_b) {
                return false
            };
        };

        // vectors are equal, a == b
        false
    }
}
`
