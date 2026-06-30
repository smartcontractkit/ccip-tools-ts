/**
 * ManagedToken Move package source files.
 *
 * Source: chainlink-aptos contracts/managed_token
 * AptosFramework rev: 16beac69835f3a71564c96164a606a23f259099a
 *
 * Vendored as source (not compiled bytecodes) because Aptos Move modules
 * must be compiled with the deployer's address at deploy time.
 *
 * Lazy-loaded via dynamic import() — same pattern as EVM BurnMintERC20 bytecode.
 */

/** Move.toml package manifest. */
export const MOVE_TOML = `[package]
name = "ManagedToken"
version = "1.0.0"
authors = []

[addresses]
managed_token = "_"

[dev-addresses]
# Calculated with object::create_named_object()
managed_token = "0x121dfbc38157d675d96eef0bcc54e70e9801714138ce54028b5655459c6376ee"

[dependencies]
AptosFramework = { git = "https://github.com/aptos-labs/aptos-core.git", rev = "16beac69835f3a71564c96164a606a23f259099a", subdir = "aptos-move/framework/aptos-framework" }

[dev-dependencies]
`

/** sources/allowlist.move */
export const ALLOWLIST_MOVE = `module managed_token::allowlist {
    use std::account;
    use std::event::{Self, EventHandle};
    use std::error;
    use std::string::{Self, String};

    struct AllowlistState has store {
        allowlist_name: String,
        allowlist_enabled: bool,
        allowlist: vector<address>,
        allowlist_add_events: EventHandle<AllowlistAdd>,
        allowlist_remove_events: EventHandle<AllowlistRemove>
    }

    #[event]
    struct AllowlistRemove has store, drop {
        allowlist_name: String,
        sender: address
    }

    #[event]
    struct AllowlistAdd has store, drop {
        allowlist_name: String,
        sender: address
    }

    const E_ALLOWLIST_NOT_ENABLED: u64 = 1;

    public fun new(event_account: &signer, allowlist: vector<address>): AllowlistState {
        new_with_name(event_account, allowlist, string::utf8(b"default"))
    }

    public fun new_with_name(
        event_account: &signer, allowlist: vector<address>, allowlist_name: String
    ): AllowlistState {
        AllowlistState {
            allowlist_name,
            allowlist_enabled: !allowlist.is_empty(),
            allowlist,
            allowlist_add_events: account::new_event_handle(event_account),
            allowlist_remove_events: account::new_event_handle(event_account)
        }
    }

    public fun get_allowlist_enabled(state: &AllowlistState): bool {
        state.allowlist_enabled
    }

    public fun set_allowlist_enabled(
        state: &mut AllowlistState, enabled: bool
    ) {
        state.allowlist_enabled = enabled;
    }

    public fun get_allowlist(state: &AllowlistState): vector<address> {
        state.allowlist
    }

    public fun is_allowed(state: &AllowlistState, sender: address): bool {
        if (!state.allowlist_enabled) {
            return true
        };

        state.allowlist.contains(&sender)
    }

    public fun apply_allowlist_updates(
        state: &mut AllowlistState, removes: vector<address>, adds: vector<address>
    ) {
        removes.for_each_ref(
            |remove_address| {
                let (found, i) = state.allowlist.index_of(remove_address);
                if (found) {
                    state.allowlist.swap_remove(i);
                    event::emit_event(
                        &mut state.allowlist_remove_events,
                        AllowlistRemove {
                            allowlist_name: state.allowlist_name,
                            sender: *remove_address
                        }
                    );
                }
            }
        );

        if (!adds.is_empty()) {
            assert!(
                state.allowlist_enabled,
                error::invalid_state(E_ALLOWLIST_NOT_ENABLED)
            );

            adds.for_each_ref(
                |add_address| {
                    let add_address: address = *add_address;
                    let (found, _) = state.allowlist.index_of(&add_address);
                    if (add_address != @0x0 && !found) {
                        state.allowlist.push_back(add_address);
                        event::emit_event(
                            &mut state.allowlist_add_events,
                            AllowlistAdd {
                                allowlist_name: state.allowlist_name,
                                sender: add_address
                            }
                        );
                    }
                }
            );
        }
    }

    public fun destroy_allowlist(state: AllowlistState) {
        let AllowlistState {
            allowlist_name: _,
            allowlist_enabled: _,
            allowlist: _,
            allowlist_add_events: add_events,
            allowlist_remove_events: remove_events
        } = state;

        event::destroy_handle(add_events);
        event::destroy_handle(remove_events);
    }

    #[test_only]
    public fun new_add_event(add: address): AllowlistAdd {
        AllowlistAdd { sender: add, allowlist_name: string::utf8(b"default") }
    }

    #[test_only]
    public fun new_remove_event(remove: address): AllowlistRemove {
        AllowlistRemove { sender: remove, allowlist_name: string::utf8(b"default") }
    }

    #[test_only]
    public fun get_allowlist_add_events(state: &AllowlistState): &EventHandle<AllowlistAdd> {
        &state.allowlist_add_events
    }

    #[test_only]
    public fun get_allowlist_remove_events(state: &AllowlistState):
        &EventHandle<AllowlistRemove> {
        &state.allowlist_remove_events
    }
}

#[test_only]
module managed_token::allowlist_test {
    use std::account;
    use std::event;
    use std::signer;
    use std::vector;

    use managed_token::allowlist::{Self, AllowlistAdd, AllowlistRemove};

    #[test(owner = @0x0)]
    fun init_empty_is_empty_and_disabled(owner: &signer) {
        let state = set_up_test(owner, vector::empty());

        assert!(!allowlist::get_allowlist_enabled(&state));
        assert!(allowlist::get_allowlist(&state).is_empty());

        // Any address is allowed when the allowlist is disabled
        assert!(allowlist::is_allowed(&state, @0x1111111111111));

        allowlist::destroy_allowlist(state);
    }

    #[test(owner = @0x0)]
    fun init_non_empty_is_non_empty_and_enabled(owner: &signer) {
        let init_allowlist = vector[@0x1, @0x2];

        let state = set_up_test(owner, init_allowlist);

        assert!(allowlist::get_allowlist_enabled(&state));
        assert!(allowlist::get_allowlist(&state).length() == 2);

        // The given addresses are allowed
        assert!(allowlist::is_allowed(&state, init_allowlist[0]));
        assert!(allowlist::is_allowed(&state, init_allowlist[1]));

        // Other addresses are not allowed
        assert!(!allowlist::is_allowed(&state, @0x3));

        allowlist::destroy_allowlist(state);
    }

    #[test(owner = @0x0)]
    #[expected_failure(abort_code = 0x30001, location = allowlist)]
    fun cannot_add_to_disabled_allowlist(owner: &signer) {
        let state = set_up_test(owner, vector::empty());

        let adds = vector[@0x1];

        allowlist::apply_allowlist_updates(&mut state, vector::empty(), adds);

        allowlist::destroy_allowlist(state);
    }

    #[test(owner = @0x0)]
    fun apply_allowlist_updates_mutates_state(owner: &signer) {
        let state = set_up_test(owner, vector::empty());
        allowlist::set_allowlist_enabled(&mut state, true);

        assert!(allowlist::get_allowlist(&state).is_empty());

        allowlist::apply_allowlist_updates(&mut state, vector::empty(), vector::empty());

        assert!(allowlist::get_allowlist(&state).is_empty());

        let adds = vector[@0x1, @0x2];

        allowlist::apply_allowlist_updates(&mut state, vector::empty(), adds);

        assert_add_events_emitted(adds, &state);

        let removes = vector[@0x1];

        allowlist::apply_allowlist_updates(&mut state, removes, vector::empty());

        assert_remove_events_emitted(removes, &state);

        assert!(allowlist::get_allowlist(&state).length() == 1);
        assert!(allowlist::is_allowed(&state, @0x2));
        assert!(!allowlist::is_allowed(&state, @0x1));

        allowlist::destroy_allowlist(state);
    }

    #[test(owner = @0x0)]
    fun apply_allowlist_updates_removes_before_adds(owner: &signer) {
        let account_to_allow = @0x1;
        let state = set_up_test(owner, vector::empty());
        allowlist::set_allowlist_enabled(&mut state, true);

        let adds_and_removes = vector[account_to_allow];

        allowlist::apply_allowlist_updates(&mut state, vector::empty(), adds_and_removes);

        assert!(allowlist::get_allowlist(&state).length() == 1);
        assert!(allowlist::is_allowed(&state, account_to_allow));

        allowlist::apply_allowlist_updates(&mut state, adds_and_removes, adds_and_removes);

        // Since removes happen before adds, the account should still be allowed
        assert!(allowlist::is_allowed(&state, account_to_allow));

        assert_remove_events_emitted(adds_and_removes, &state);
        // Events don't get purged after calling event::emitted_events so we'll have
        // both the first and the second add event in the emitted events
        adds_and_removes.push_back(account_to_allow);
        assert_add_events_emitted(adds_and_removes, &state);

        allowlist::destroy_allowlist(state);
    }

    inline fun assert_add_events_emitted(
        added_addresses: vector<address>, state: &allowlist::AllowlistState
    ) {
        let expected =
            added_addresses.map::<address, AllowlistAdd> (|add| allowlist::new_add_event(add));
        let got =
            event::emitted_events_by_handle<AllowlistAdd>(
                allowlist::get_allowlist_add_events(state)
            );
        let number_of_adds = expected.length();

        // Assert that exactly one event was emitted for each add
        assert!(got.length() == number_of_adds);

        // Assert that the emitted events match the expected events
        for (i in 0..number_of_adds) {
            assert!(expected.borrow(i) == got.borrow(i));
        }
    }

    inline fun assert_remove_events_emitted(
        added_addresses: vector<address>, state: &allowlist::AllowlistState
    ) {
        let expected =
            added_addresses.map::<address, AllowlistRemove> (|add| allowlist::new_remove_event(
                add
            ));
        let got =
            event::emitted_events_by_handle<AllowlistRemove>(
                allowlist::get_allowlist_remove_events(state)
            );
        let number_of_adds = expected.length();

        // Assert that exactly one event was emitted for each add
        assert!(got.length() == number_of_adds);

        // Assert that the emitted events match the expected events
        for (i in 0..number_of_adds) {
            assert!(expected.borrow(i) == got.borrow(i));
        }
    }

    inline fun set_up_test(owner: &signer, allowlist: vector<address>):
        allowlist::AllowlistState {
        account::create_account_for_test(signer::address_of(owner));

        allowlist::new(owner, allowlist)
    }
}
`

/** sources/ownable.move */
export const OWNABLE_MOVE = `/// This module implements an Ownable component similar to Ownable2Step.sol for managing
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
module managed_token::ownable {
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

    public fun accept_ownership(
        caller: &signer, state: &mut OwnableState
    ) {
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
            pending_transfer.accepted, error::invalid_state(E_TRANSFER_NOT_ACCEPTED)
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

/** sources/managed_token.move */
export const MANAGED_TOKEN_MOVE = `module managed_token::managed_token {
    use std::account;
    use std::event::{Self, EventHandle};
    use std::fungible_asset::{Self, BurnRef, Metadata, MintRef, TransferRef};
    use std::object::{Self, ExtendRef, Object, TransferRef as ObjectTransferRef};
    use std::option::{Option};
    use std::primary_fungible_store;
    use std::signer;
    use std::string::{Self, String};

    use managed_token::allowlist::{Self, AllowlistState};
    use managed_token::ownable::{Self, OwnableState};

    const TOKEN_STATE_SEED: vector<u8> = b"managed_token::managed_token::token_state";

    struct TokenStateDeployment has key {
        extend_ref: ExtendRef,
        transfer_ref: ObjectTransferRef,
        ownable_state: OwnableState,
        allowed_minters: AllowlistState,
        allowed_burners: AllowlistState,
        initialize_events: EventHandle<Initialize>,
        mint_events: EventHandle<Mint>,
        burn_events: EventHandle<Burn>
    }

    #[resource_group_member(group = aptos_framework::object::ObjectGroup)]
    struct TokenState has key {
        extend_ref: ExtendRef,
        transfer_ref: ObjectTransferRef,
        ownable_state: OwnableState,
        allowed_minters: AllowlistState,
        allowed_burners: AllowlistState,
        token: Object<Metadata>,
        initialize_events: EventHandle<Initialize>,
        mint_events: EventHandle<Mint>,
        burn_events: EventHandle<Burn>
    }

    #[resource_group_member(group = aptos_framework::object::ObjectGroup)]
    struct TokenMetadataRefs has key {
        extend_ref: ExtendRef,
        mint_ref: MintRef,
        burn_ref: BurnRef,
        transfer_ref: TransferRef
    }

    #[event]
    struct Initialize has drop, store {
        publisher: address,
        token: Object<Metadata>,
        max_supply: Option<u128>,
        decimals: u8,
        icon: String,
        project: String
    }

    #[event]
    struct Mint has drop, store {
        minter: address,
        to: address,
        amount: u64
    }

    #[event]
    struct Burn has drop, store {
        burner: address,
        from: address,
        amount: u64
    }

    const E_NOT_PUBLISHER: u64 = 1;
    const E_NOT_ALLOWED_MINTER: u64 = 2;
    const E_NOT_ALLOWED_BURNER: u64 = 3;
    const E_TOKEN_NOT_INITIALIZED: u64 = 4;
    const E_TOKEN_ALREADY_INITIALIZED: u64 = 5;
    const E_TOKEN_STATE_DEPLOYMENT_ALREADY_INITIALIZED: u64 = 6;

    #[view]
    public fun type_and_version(): String {
        string::utf8(b"ManagedToken 1.0.0")
    }

    #[view]
    public fun token_state_address(): address {
        token_state_address_internal()
    }

    inline fun token_state_address_internal(): address {
        object::create_object_address(&@managed_token, TOKEN_STATE_SEED)
    }

    #[view]
    public fun token_metadata(): address acquires TokenState {
        assert!(
            exists<TokenState>(token_state_address_internal()),
            E_TOKEN_NOT_INITIALIZED
        );
        token_metadata_internal(&TokenState[token_state_address_internal()])
    }

    inline fun token_metadata_internal(state: &TokenState): address {
        object::object_address(&state.token)
    }

    #[view]
    public fun get_allowed_minters(): vector<address> acquires TokenState {
        allowlist::get_allowlist(
            &TokenState[token_state_address_internal()].allowed_minters
        )
    }

    #[view]
    public fun get_allowed_burners(): vector<address> acquires TokenState {
        allowlist::get_allowlist(
            &TokenState[token_state_address_internal()].allowed_burners
        )
    }

    #[view]
    public fun is_minter_allowed(minter: address): bool acquires TokenState {
        allowlist::is_allowed(
            &TokenState[token_state_address_internal()].allowed_minters,
            minter
        )
    }

    #[view]
    public fun is_burner_allowed(burner: address): bool acquires TokenState {
        allowlist::is_allowed(
            &TokenState[token_state_address_internal()].allowed_burners,
            burner
        )
    }

    /// \`publisher\` is the code object, deployed through object_code_deployment
    fun init_module(publisher: &signer) {
        assert!(object::is_object(@managed_token), E_NOT_PUBLISHER);

        // Create object owned by code object
        let constructor_ref = &object::create_named_object(publisher, TOKEN_STATE_SEED);
        let extend_ref = object::generate_extend_ref(constructor_ref);
        let token_state_signer = &object::generate_signer(constructor_ref);

        // create an Account on the object for event handles.
        account::create_account_if_does_not_exist(signer::address_of(token_state_signer));

        let allowed_minters =
            allowlist::new_with_name(
                token_state_signer, vector[], string::utf8(b"minters")
            );
        allowlist::set_allowlist_enabled(&mut allowed_minters, true);

        let allowed_burners =
            allowlist::new_with_name(
                token_state_signer, vector[], string::utf8(b"burners")
            );
        allowlist::set_allowlist_enabled(&mut allowed_burners, true);

        move_to(
            token_state_signer,
            TokenStateDeployment {
                extend_ref,
                transfer_ref: object::generate_transfer_ref(constructor_ref),
                ownable_state: ownable::new(token_state_signer, @managed_token),
                allowed_minters,
                allowed_burners,
                initialize_events: account::new_event_handle(token_state_signer),
                mint_events: account::new_event_handle(token_state_signer),
                burn_events: account::new_event_handle(token_state_signer)
            }
        );
    }

    // ================================================================
    // |                      Only Owner Functions                     |
    // ================================================================

    /// Only owner of this code object can initialize a token once
    public entry fun initialize(
        publisher: &signer,
        max_supply: Option<u128>,
        name: String,
        symbol: String,
        decimals: u8,
        icon: String,
        project: String
    ) acquires TokenStateDeployment {
        let publisher_addr = signer::address_of(publisher);
        let token_state_address = token_state_address_internal();

        assert!(
            exists<TokenStateDeployment>(token_state_address),
            E_TOKEN_STATE_DEPLOYMENT_ALREADY_INITIALIZED
        );

        let TokenStateDeployment {
            extend_ref,
            transfer_ref,
            ownable_state,
            allowed_minters,
            allowed_burners,
            initialize_events,
            mint_events,
            burn_events
        } = move_from<TokenStateDeployment>(token_state_address);

        assert_only_owner(signer::address_of(publisher), &ownable_state);

        let token_state_signer = &object::generate_signer_for_extending(&extend_ref);

        // Code object owns token state, which owns the fungible asset
        // Code object => token state => fungible asset
        let constructor_ref =
            &object::create_named_object(token_state_signer, *symbol.bytes());
        primary_fungible_store::create_primary_store_enabled_fungible_asset(
            constructor_ref,
            max_supply,
            name,
            symbol,
            decimals,
            icon,
            project
        );

        let metadata_object_signer = &object::generate_signer(constructor_ref);
        move_to(
            metadata_object_signer,
            TokenMetadataRefs {
                extend_ref: object::generate_extend_ref(constructor_ref),
                mint_ref: fungible_asset::generate_mint_ref(constructor_ref),
                burn_ref: fungible_asset::generate_burn_ref(constructor_ref),
                transfer_ref: fungible_asset::generate_transfer_ref(constructor_ref)
            }
        );

        let token = object::object_from_constructor_ref(constructor_ref);

        event::emit_event(
            &mut initialize_events,
            Initialize {
                publisher: publisher_addr,
                token,
                max_supply,
                decimals,
                icon,
                project
            }
        );

        move_to(
            token_state_signer,
            TokenState {
                extend_ref,
                transfer_ref,
                ownable_state,
                allowed_minters,
                allowed_burners,
                token,
                initialize_events,
                mint_events,
                burn_events
            }
        );
    }

    public entry fun apply_allowed_minter_updates(
        caller: &signer,
        minters_to_remove: vector<address>,
        minters_to_add: vector<address>
    ) acquires TokenState {
        let token_state = &mut TokenState[token_state_address_internal()];
        assert_only_owner(signer::address_of(caller), &token_state.ownable_state);

        allowlist::apply_allowlist_updates(
            &mut token_state.allowed_minters,
            minters_to_remove,
            minters_to_add
        );
    }

    public entry fun apply_allowed_burner_updates(
        caller: &signer,
        burners_to_remove: vector<address>,
        burners_to_add: vector<address>
    ) acquires TokenState {
        let token_state = &mut TokenState[token_state_address_internal()];
        assert_only_owner(signer::address_of(caller), &token_state.ownable_state);

        allowlist::apply_allowlist_updates(
            &mut token_state.allowed_burners,
            burners_to_remove,
            burners_to_add
        );
    }

    // ================================================================
    // |                      Mint/Burn Functions                      |
    // ================================================================

    public entry fun mint(
        minter: &signer, to: address, amount: u64
    ) acquires TokenMetadataRefs, TokenState {
        let minter_addr = signer::address_of(minter);
        let state = &mut TokenState[token_state_address_internal()];
        assert_is_allowed_minter(minter_addr, state);

        if (amount == 0) { return };

        primary_fungible_store::mint(
            &borrow_token_metadata_refs(state).mint_ref, to, amount
        );

        event::emit_event(
            &mut state.mint_events,
            Mint { minter: minter_addr, to, amount }
        );
    }

    public entry fun burn(
        burner: &signer, from: address, amount: u64
    ) acquires TokenMetadataRefs, TokenState {
        let burner_addr = signer::address_of(burner);
        let state = &mut TokenState[token_state_address_internal()];
        assert_is_allowed_burner(burner_addr, state);

        if (amount == 0) { return };

        primary_fungible_store::burn(
            &borrow_token_metadata_refs(state).burn_ref, from, amount
        );

        event::emit_event(
            &mut state.burn_events,
            Burn { burner: burner_addr, from, amount }
        );
    }

    inline fun assert_is_allowed_minter(
        caller: address, state: &TokenState
    ) {
        assert!(
            caller == owner_internal(state)
                || allowlist::is_allowed(&state.allowed_minters, caller),
            E_NOT_ALLOWED_MINTER
        );
    }

    inline fun assert_is_allowed_burner(
        caller: address, state: &TokenState
    ) {
        assert!(
            caller == owner_internal(state)
                || allowlist::is_allowed(&state.allowed_burners, caller),
            E_NOT_ALLOWED_BURNER
        );
    }

    inline fun borrow_token_metadata_refs(state: &TokenState): &TokenMetadataRefs {
        &TokenMetadataRefs[token_metadata_internal(state)]
    }

    // ================================================================
    // |                      Ownable State                           |
    // ================================================================

    #[view]
    public fun owner(): address acquires TokenState {
        owner_internal(&TokenState[token_state_address_internal()])
    }

    #[view]
    public fun has_pending_transfer(): bool acquires TokenState {
        ownable::has_pending_transfer(
            &TokenState[token_state_address_internal()].ownable_state
        )
    }

    #[view]
    public fun pending_transfer_from(): Option<address> acquires TokenState {
        ownable::pending_transfer_from(
            &TokenState[token_state_address_internal()].ownable_state
        )
    }

    #[view]
    public fun pending_transfer_to(): Option<address> acquires TokenState {
        ownable::pending_transfer_to(
            &TokenState[token_state_address_internal()].ownable_state
        )
    }

    #[view]
    public fun pending_transfer_accepted(): Option<bool> acquires TokenState {
        ownable::pending_transfer_accepted(
            &TokenState[token_state_address_internal()].ownable_state
        )
    }

    inline fun owner_internal(state: &TokenState): address {
        ownable::owner(&state.ownable_state)
    }

    fun assert_only_owner(caller: address, ownable_state: &OwnableState) {
        ownable::assert_only_owner(caller, ownable_state)
    }

    /// ownable::transfer_ownership checks if the caller is the owner
    /// So we only extract the ownable state from the token state
    public entry fun transfer_ownership(caller: &signer, to: address) acquires TokenState {
        ownable::transfer_ownership(
            caller,
            &mut TokenState[token_state_address_internal()].ownable_state,
            to
        )
    }

    /// Anyone can call this as \`ownable::accept_ownership\` verifies
    /// that the caller is the pending owner
    public entry fun accept_ownership(caller: &signer) acquires TokenState {
        ownable::accept_ownership(
            caller,
            &mut TokenState[token_state_address_internal()].ownable_state
        )
    }

    /// ownable::execute_ownership_transfer checks if the caller is the owner
    /// So we only extract the ownable state from the token state
    public entry fun execute_ownership_transfer(
        caller: &signer, to: address
    ) acquires TokenState {
        ownable::execute_ownership_transfer(
            caller,
            &mut TokenState[token_state_address_internal()].ownable_state,
            to
        )
    }

    #[test_only]
    public fun init_module_for_testing(publisher: &signer) {
        init_module(publisher);
    }
}
`
