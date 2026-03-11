/**
 * ChainlinkCCIP Move sources — embedded from chainlink-aptos.
 *
 * These sources are compiled locally alongside pool packages so that
 * the compiled bytecode matches the on-chain modules exactly.
 *
 * @packageDocumentation
 */

/** Move.toml for ChainlinkCCIP — uses local path for MCMS dependency. */
export const CCIP_MOVE_TOML = `[package]
name = "ChainlinkCCIP"
version = "1.0.0"
upgrade_policy = "compatible"

[addresses]
ccip = "_"
mcms = "_"
mcms_owner = "0x0"
mcms_register_entrypoints = "_"

[dependencies]
AptosFramework = { git = "https://github.com/aptos-labs/aptos-core.git", rev = "16beac69835f3a71564c96164a606a23f259099a", subdir = "aptos-move/framework/aptos-framework" }
ChainlinkManyChainMultisig = { local = "../mcms" }
`

/** sources/allowlist.move */
export const CCIP_ALLOWLIST_MOVE = `module ccip::allowlist {
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
        removed_address: address
    }

    #[event]
    struct AllowlistAdd has store, drop {
        allowlist_name: String,
        added_address: address
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
            |removed_address| {
                let removed_address: address = *removed_address;
                let (found, i) = state.allowlist.index_of(&removed_address);
                if (found) {
                    state.allowlist.swap_remove(i);
                    event::emit_event(
                        &mut state.allowlist_remove_events,
                        AllowlistRemove {
                            allowlist_name: state.allowlist_name,
                            removed_address
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
                |added_address| {
                    let added_address: address = *added_address;
                    if (added_address != @0x0
                        && !state.allowlist.contains(&added_address)) {
                        state.allowlist.push_back(added_address);
                        event::emit_event(
                            &mut state.allowlist_add_events,
                            AllowlistAdd {
                                allowlist_name: state.allowlist_name,
                                added_address
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
        AllowlistAdd {
            added_address: add,
            allowlist_name: string::utf8(b"default")
        }
    }

    #[test_only]
    public fun new_remove_event(remove: address): AllowlistRemove {
        AllowlistRemove {
            removed_address: remove,
            allowlist_name: string::utf8(b"default")
        }
    }

    #[test_only]
    public fun get_allowlist_add_events(state: &AllowlistState): &EventHandle<AllowlistAdd> {
        &state.allowlist_add_events
    }

    #[test_only]
    public fun get_allowlist_remove_events(state: &AllowlistState)
        : &EventHandle<AllowlistRemove> {
        &state.allowlist_remove_events
    }
}

#[test_only]
module ccip::allowlist_test {
    use std::account;
    use std::event;
    use std::signer;
    use std::vector;

    use ccip::allowlist::{Self, AllowlistAdd, AllowlistRemove};

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
            added_addresses.map::<address, AllowlistAdd> (
                |add| allowlist::new_add_event(add)
            );
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
            added_addresses.map::<address, AllowlistRemove> (
                |add| allowlist::new_remove_event(add)
            );
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

    inline fun set_up_test(owner: &signer, allowlist: vector<address>)
        : allowlist::AllowlistState {
        account::create_account_for_test(signer::address_of(owner));

        allowlist::new(owner, allowlist)
    }
}
`

/** sources/auth.move */
export const CCIP_AUTH_MOVE = `module ccip::auth {
    use std::error;
    use std::object;
    use std::option::{Self, Option};
    use std::signer;
    use std::string;

    use ccip::allowlist;
    use ccip::ownable;
    use ccip::state_object;

    use mcms::bcs_stream;
    use mcms::mcms_registry;

    struct AuthState has key {
        ownable_state: ownable::OwnableState,
        allowed_onramps: allowlist::AllowlistState,
        allowed_offramps: allowlist::AllowlistState
    }

    const E_UNKNOWN_FUNCTION: u64 = 1;
    const E_NOT_ALLOWED_ONRAMP: u64 = 2;
    const E_NOT_ALLOWED_OFFRAMP: u64 = 3;
    const E_NOT_OWNER_OR_CCIP: u64 = 4;

    fun init_module(publisher: &signer) {
        let state_object_signer = &state_object::object_signer();

        let allowed_onramps =
            allowlist::new_with_name(
                state_object_signer, vector[], string::utf8(b"onramps")
            );
        allowlist::set_allowlist_enabled(&mut allowed_onramps, true);

        let allowed_offramps =
            allowlist::new_with_name(
                state_object_signer, vector[], string::utf8(b"offramps")
            );
        allowlist::set_allowlist_enabled(&mut allowed_offramps, true);

        move_to(
            state_object_signer,
            AuthState {
                ownable_state: ownable::new(state_object_signer, @ccip),
                allowed_onramps,
                allowed_offramps
            }
        );

        // Register the entrypoint with mcms
        if (@mcms_register_entrypoints == @0x1) {
            register_mcms_entrypoint(publisher);
        };
    }

    #[view]
    public fun get_allowed_onramps(): vector<address> acquires AuthState {
        allowlist::get_allowlist(&borrow_state().allowed_onramps)
    }

    #[view]
    public fun get_allowed_offramps(): vector<address> acquires AuthState {
        allowlist::get_allowlist(&borrow_state().allowed_offramps)
    }

    #[view]
    public fun is_onramp_allowed(onramp_address: address): bool acquires AuthState {
        allowlist::is_allowed(&borrow_state().allowed_onramps, onramp_address)
    }

    #[view]
    public fun is_offramp_allowed(offramp_address: address): bool acquires AuthState {
        allowlist::is_allowed(&borrow_state().allowed_offramps, offramp_address)
    }

    public entry fun apply_allowed_onramp_updates(
        caller: &signer, onramps_to_remove: vector<address>, onramps_to_add: vector<address>
    ) acquires AuthState {
        let state = borrow_state_mut();

        assert_is_owner_or_ccip(signer::address_of(caller), &state.ownable_state);

        allowlist::apply_allowlist_updates(
            &mut state.allowed_onramps, onramps_to_remove, onramps_to_add
        );
    }

    public entry fun apply_allowed_offramp_updates(
        caller: &signer,
        offramps_to_remove: vector<address>,
        offramps_to_add: vector<address>
    ) acquires AuthState {
        let state = borrow_state_mut();

        assert_is_owner_or_ccip(signer::address_of(caller), &state.ownable_state);

        allowlist::apply_allowlist_updates(
            &mut state.allowed_offramps, offramps_to_remove, offramps_to_add
        );
    }

    inline fun borrow_state(): &AuthState {
        borrow_global<AuthState>(state_object::object_address())
    }

    inline fun borrow_state_mut(): &mut AuthState {
        borrow_global_mut<AuthState>(state_object::object_address())
    }

    inline fun assert_is_owner_or_ccip(
        caller: address, ownable_state: &ownable::OwnableState
    ) {
        assert!(
            caller == @ccip || caller == ownable::owner(ownable_state),
            error::permission_denied(E_NOT_OWNER_OR_CCIP)
        );
    }

    public fun assert_is_allowed_onramp(caller: address) acquires AuthState {
        assert!(
            allowlist::is_allowed(&borrow_state().allowed_onramps, caller),
            error::permission_denied(E_NOT_ALLOWED_ONRAMP)
        );
    }

    public fun assert_is_allowed_offramp(caller: address) acquires AuthState {
        assert!(
            allowlist::is_allowed(&borrow_state().allowed_offramps, caller),
            error::permission_denied(E_NOT_ALLOWED_OFFRAMP)
        );
    }

    // ================================================================
    // |                          Ownable                             |
    // ================================================================
    #[view]
    public fun owner(): address acquires AuthState {
        ownable::owner(&borrow_state().ownable_state)
    }

    #[view]
    public fun has_pending_transfer(): bool acquires AuthState {
        ownable::has_pending_transfer(&borrow_state().ownable_state)
    }

    #[view]
    public fun pending_transfer_from(): Option<address> acquires AuthState {
        ownable::pending_transfer_from(&borrow_state().ownable_state)
    }

    #[view]
    public fun pending_transfer_to(): Option<address> acquires AuthState {
        ownable::pending_transfer_to(&borrow_state().ownable_state)
    }

    #[view]
    public fun pending_transfer_accepted(): Option<bool> acquires AuthState {
        ownable::pending_transfer_accepted(&borrow_state().ownable_state)
    }

    public fun assert_only_owner(caller: address) acquires AuthState {
        ownable::assert_only_owner(caller, &borrow_state().ownable_state)
    }

    public entry fun transfer_ownership(caller: &signer, to: address) acquires AuthState {
        let state = borrow_state_mut();
        ownable::transfer_ownership(caller, &mut state.ownable_state, to)
    }

    public entry fun accept_ownership(caller: &signer) acquires AuthState {
        let state = borrow_state_mut();
        ownable::accept_ownership(caller, &mut state.ownable_state)
    }

    public entry fun execute_ownership_transfer(
        caller: &signer, to: address
    ) acquires AuthState {
        let state = borrow_state_mut();
        ownable::execute_ownership_transfer(caller, &mut state.ownable_state, to)
    }

    // ================================================================
    // |                      MCMS Entrypoint                         |
    // ================================================================
    struct McmsCallback has drop {}

    public fun mcms_entrypoint<T: key>(
        _metadata: object::Object<T>
    ): option::Option<u128> acquires AuthState {
        let (caller, function, data) =
            mcms_registry::get_callback_params(@ccip, McmsCallback {});

        let function_bytes = *function.bytes();
        let stream = bcs_stream::new(data);

        if (function_bytes == b"apply_allowed_onramp_updates") {
            let onramps_to_remove =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_address(stream)
                );
            let onramps_to_add =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_address(stream)
                );
            bcs_stream::assert_is_consumed(&stream);
            apply_allowed_onramp_updates(&caller, onramps_to_remove, onramps_to_add)
        } else if (function_bytes == b"apply_allowed_offramp_updates") {
            let offramps_to_remove =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_address(stream)
                );
            let offramps_to_add =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_address(stream)
                );
            bcs_stream::assert_is_consumed(&stream);
            apply_allowed_offramp_updates(&caller, offramps_to_remove, offramps_to_add)
        } else if (function_bytes == b"transfer_ownership") {
            let to = bcs_stream::deserialize_address(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            transfer_ownership(&caller, to)
        } else if (function_bytes == b"accept_ownership") {
            bcs_stream::assert_is_consumed(&stream);
            accept_ownership(&caller)
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
    public(friend) fun register_mcms_entrypoint(publisher: &signer) {
        mcms_registry::register_entrypoint(
            publisher, string::utf8(b"auth"), McmsCallback {}
        );
    }

    // ========================== TEST ONLY ==========================
    #[test_only]
    public fun test_init_module(publisher: &signer) {
        init_module(publisher);
    }

    #[test_only]
    public fun test_register_mcms_entrypoint(publisher: &signer) {
        mcms_registry::register_entrypoint(
            publisher, string::utf8(b"auth"), McmsCallback {}
        );
    }
}
`

/** sources/client.move */
export const CCIP_CLIENT_MOVE = `/// This module defines messages for end users to interact with Aptos CCIP.
module ccip::client {
    use std::bcs;

    const GENERIC_EXTRA_ARGS_V2_TAG: vector<u8> = x"181dcf10";
    const SVM_EXTRA_ARGS_V1_TAG: vector<u8> = x"1f3b3aba";

    const E_INVALID_SVM_TOKEN_RECEIVER_LENGTH: u64 = 1;
    const E_INVALID_SVM_ACCOUNT_LENGTH: u64 = 2;

    #[view]
    public fun generic_extra_args_v2_tag(): vector<u8> {
        GENERIC_EXTRA_ARGS_V2_TAG
    }

    #[view]
    public fun svm_extra_args_v1_tag(): vector<u8> {
        SVM_EXTRA_ARGS_V1_TAG
    }

    #[view]
    public fun encode_generic_extra_args_v2(
        gas_limit: u256, allow_out_of_order_execution: bool
    ): vector<u8> {
        let extra_args = vector[];
        extra_args.append(GENERIC_EXTRA_ARGS_V2_TAG);
        extra_args.append(bcs::to_bytes(&gas_limit));
        extra_args.append(bcs::to_bytes(&allow_out_of_order_execution));
        extra_args
    }

    #[view]
    public fun encode_svm_extra_args_v1(
        compute_units: u32,
        account_is_writable_bitmap: u64,
        allow_out_of_order_execution: bool,
        token_receiver: vector<u8>,
        accounts: vector<vector<u8>>
    ): vector<u8> {
        let extra_args = vector[];
        extra_args.append(SVM_EXTRA_ARGS_V1_TAG);
        extra_args.append(bcs::to_bytes(&compute_units));
        extra_args.append(bcs::to_bytes(&account_is_writable_bitmap));
        extra_args.append(bcs::to_bytes(&allow_out_of_order_execution));

        assert!(token_receiver.length() == 32, E_INVALID_SVM_TOKEN_RECEIVER_LENGTH);
        accounts.for_each_ref(
            |account| {
                assert!(account.length() == 32, E_INVALID_SVM_ACCOUNT_LENGTH);
            }
        );

        extra_args.append(bcs::to_bytes(&token_receiver));
        extra_args.append(bcs::to_bytes(&accounts));
        extra_args
    }

    struct Any2AptosMessage has store, drop, copy {
        message_id: vector<u8>,
        source_chain_selector: u64,
        sender: vector<u8>,
        data: vector<u8>,
        dest_token_amounts: vector<Any2AptosTokenAmount>
    }

    struct Any2AptosTokenAmount has store, drop, copy {
        token: address,
        amount: u64
    }

    public fun new_any2aptos_message(
        message_id: vector<u8>,
        source_chain_selector: u64,
        sender: vector<u8>,
        data: vector<u8>,
        dest_token_amounts: vector<Any2AptosTokenAmount>
    ): Any2AptosMessage {
        Any2AptosMessage {
            message_id,
            source_chain_selector,
            sender,
            data,
            dest_token_amounts
        }
    }

    public fun new_dest_token_amounts(
        token_addresses: vector<address>, token_amounts: vector<u64>
    ): vector<Any2AptosTokenAmount> {
        token_addresses.zip_map_ref(
            &token_amounts,
            |token_address, token_amount| {
                Any2AptosTokenAmount { token: *token_address, amount: *token_amount }
            }
        )
    }

    // Any2AptosMessage accessors
    public fun get_message_id(input: &Any2AptosMessage): vector<u8> {
        input.message_id
    }

    public fun get_source_chain_selector(input: &Any2AptosMessage): u64 {
        input.source_chain_selector
    }

    public fun get_sender(input: &Any2AptosMessage): vector<u8> {
        input.sender
    }

    public fun get_data(input: &Any2AptosMessage): vector<u8> {
        input.data
    }

    public fun get_dest_token_amounts(input: &Any2AptosMessage)
        : vector<Any2AptosTokenAmount> {
        input.dest_token_amounts
    }

    // Any2AptosTokenAmount accessors
    public fun get_token(input: &Any2AptosTokenAmount): address {
        input.token
    }

    public fun get_amount(input: &Any2AptosTokenAmount): u64 {
        input.amount
    }
}
`

/** sources/eth_abi.move */
export const CCIP_ETH_ABI_MOVE = `// module to do the equivalent packing as ethereum's abi.encode and abi.encodePacked
module ccip::eth_abi {
    use std::bcs;
    use std::error;
    use std::from_bcs;
    use std::vector;

    const ENCODED_BOOL_FALSE: vector<u8> = vector[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const ENCODED_BOOL_TRUE: vector<u8> = vector[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];

    const E_OUT_OF_BYTES: u64 = 1;
    const E_INVALID_ADDRESS: u64 = 2;
    const E_INVALID_BOOL: u64 = 3;
    const E_INVALID_SELECTOR: u64 = 4;
    const E_INVALID_U256_LENGTH: u64 = 5;
    const E_INTEGER_OVERFLOW: u64 = 6;
    const E_INVALID_BYTES32_LENGTH: u64 = 7;

    public inline fun encode_address(out: &mut vector<u8>, value: address) {
        out.append(bcs::to_bytes(&value))
    }

    public inline fun encode_u8(out: &mut vector<u8>, value: u8) {
        encode_u256(out, value as u256);
    }

    public inline fun encode_u32(out: &mut vector<u8>, value: u32) {
        encode_u256(out, value as u256)
    }

    public inline fun encode_u64(out: &mut vector<u8>, value: u64) {
        encode_u256(out, value as u256)
    }

    public inline fun encode_u256(out: &mut vector<u8>, value: u256) {
        let value_bytes = bcs::to_bytes(&value);
        // little endian to big endian
        value_bytes.reverse();
        out.append(value_bytes)
    }

    public fun encode_bool(out: &mut vector<u8>, value: bool) {
        out.append(if (value) ENCODED_BOOL_TRUE else ENCODED_BOOL_FALSE)
    }

    /// For numeric types (address, uint, int) - left padded with zeros
    public inline fun encode_left_padded_bytes32(
        out: &mut vector<u8>, value: vector<u8>
    ) {
        assert!(value.length() <= 32, error::invalid_argument(E_INVALID_U256_LENGTH));

        let padding_len = 32 - value.length();
        for (i in 0..padding_len) {
            out.push_back(0);
        };
        out.append(value);
    }

    /// For byte array types (bytes32, bytes4, etc.) - right padded with zeros
    public inline fun encode_right_padded_bytes32(
        out: &mut vector<u8>, value: vector<u8>
    ) {
        assert!(value.length() <= 32, E_INVALID_BYTES32_LENGTH);

        out.append(value);
        let padding_len = 32 - value.length();
        for (i in 0..padding_len) {
            out.push_back(0);
        };
    }

    public inline fun encode_bytes(out: &mut vector<u8>, value: vector<u8>) {
        encode_u256(out, (value.length() as u256));

        out.append(value);
        if (value.length() % 32 != 0) {
            let padding_len = 32 - (value.length() % 32);
            for (i in 0..padding_len) {
                out.push_back(0);
            }
        }
    }

    public fun encode_selector(out: &mut vector<u8>, value: vector<u8>) {
        assert!(value.length() == 4, error::invalid_argument(E_INVALID_SELECTOR));
        out.append(value);
    }

    public inline fun encode_packed_address(
        out: &mut vector<u8>, value: address
    ) {
        out.append(bcs::to_bytes(&value))
    }

    public inline fun encode_packed_bytes(
        out: &mut vector<u8>, value: vector<u8>
    ) {
        out.append(value)
    }

    public inline fun encode_packed_bytes32(
        out: &mut vector<u8>, value: vector<u8>
    ) {
        assert!(value.length() <= 32, E_INVALID_BYTES32_LENGTH);

        out.append(value);
        let padding_len = 32 - value.length();
        for (i in 0..padding_len) {
            out.push_back(0);
        };
    }

    public inline fun encode_packed_u8(out: &mut vector<u8>, value: u8) {
        out.push_back(value)
    }

    public inline fun encode_packed_u32(out: &mut vector<u8>, value: u32) {
        let value_bytes = bcs::to_bytes(&value);
        // little endian to big endian
        value_bytes.reverse();
        out.append(value_bytes)
    }

    public inline fun encode_packed_u64(out: &mut vector<u8>, value: u64) {
        let value_bytes = bcs::to_bytes(&value);
        // little endian to big endian
        value_bytes.reverse();
        out.append(value_bytes)
    }

    public inline fun encode_packed_u256(out: &mut vector<u8>, value: u256) {
        let value_bytes = bcs::to_bytes(&value);
        // little endian to big endian
        value_bytes.reverse();
        out.append(value_bytes)
    }

    struct ABIStream has drop {
        data: vector<u8>,
        cur: u64
    }

    public fun new_stream(data: vector<u8>): ABIStream {
        ABIStream { data, cur: 0 }
    }

    public fun decode_address(stream: &mut ABIStream): address {
        let data = &stream.data;
        let cur = stream.cur;

        assert!(
            cur + 32 <= data.length(), error::out_of_range(E_OUT_OF_BYTES)
        );

        // Verify first 12 bytes are zero
        for (i in 0..12) {
            assert!(
                data[cur + i] == 0, error::invalid_argument(E_INVALID_ADDRESS)
            );
        };

        // Extract last 20 bytes for address
        let addr_bytes = data.slice(cur + 12, cur + 32);
        stream.cur = cur + 32;

        from_bcs::to_address(addr_bytes)
    }

    public fun decode_u256(stream: &mut ABIStream): u256 {
        let data = &stream.data;
        let cur = stream.cur;

        assert!(
            cur + 32 <= data.length(), error::out_of_range(E_OUT_OF_BYTES)
        );

        let value_bytes = data.slice(cur, cur + 32);
        // Convert from big endian to little endian
        value_bytes.reverse();

        stream.cur = cur + 32;
        from_bcs::to_u256(value_bytes)
    }

    public fun decode_u8(stream: &mut ABIStream): u8 {
        let value = decode_u256(stream);
        assert!(value <= 0xFF, error::invalid_argument(E_INTEGER_OVERFLOW));
        (value as u8)
    }

    public fun decode_u32(stream: &mut ABIStream): u32 {
        let value = decode_u256(stream);
        assert!(value <= 0xFFFFFFFF, error::invalid_argument(E_INTEGER_OVERFLOW));
        (value as u32)
    }

    public fun decode_u64(stream: &mut ABIStream): u64 {
        let value = decode_u256(stream);
        assert!(value <= 0xFFFFFFFFFFFFFFFF, error::invalid_argument(E_INTEGER_OVERFLOW));
        (value as u64)
    }

    public fun decode_bool(stream: &mut ABIStream): bool {
        let data = &stream.data;
        let cur = stream.cur;

        assert!(
            cur + 32 <= data.length(), error::out_of_range(E_OUT_OF_BYTES)
        );

        let value = data.slice(cur, cur + 32);
        stream.cur = cur + 32;

        if (value == ENCODED_BOOL_FALSE) { false }
        else if (value == ENCODED_BOOL_TRUE) { true }
        else {
            abort error::invalid_argument(E_INVALID_BOOL)
        }
    }

    public fun decode_bytes32(stream: &mut ABIStream): vector<u8> {
        let data = &stream.data;
        let cur = stream.cur;

        assert!(
            cur + 32 <= data.length(), error::out_of_range(E_OUT_OF_BYTES)
        );

        let bytes = data.slice(cur, cur + 32);
        stream.cur = cur + 32;
        bytes
    }

    public fun decode_bytes(stream: &mut ABIStream): vector<u8> {
        // First read length as u256
        let length = (decode_u256(stream) as u64);

        let padding_len = if (length % 32 == 0) { 0 }
        else {
            32 - (length % 32)
        };

        let data = &stream.data;
        let cur = stream.cur;

        assert!(
            cur + length + padding_len <= data.length(),
            error::out_of_range(E_OUT_OF_BYTES)
        );

        let bytes = data.slice(cur, cur + length);

        // Skip padding bytes
        stream.cur = cur + length + padding_len;

        bytes
    }

    public inline fun decode_vector<E>(
        stream: &mut ABIStream, elem_decoder: |&mut ABIStream| E
    ): vector<E> {
        let len = decode_u256(stream);
        let v = vector::empty();

        for (i in 0..len) {
            v.push_back(elem_decoder(stream));
        };

        v
    }

    public fun decode_u256_value(value_bytes: vector<u8>): u256 {
        assert!(
            value_bytes.length() == 32,
            error::invalid_argument(E_INVALID_U256_LENGTH)
        );
        value_bytes.reverse();
        from_bcs::to_u256(value_bytes)
    }
}
`

/** sources/fee_quoter.move */
export const CCIP_FEE_QUOTER_MOVE = `/// This module is responsible for storage and retrieval of fee token and token transfer
/// information and pricing.
module ccip::fee_quoter {
    use std::account;
    use std::bcs;
    use std::error;
    use std::event::{Self, EventHandle};
    use std::fungible_asset::Metadata;
    use std::object;
    use std::option;
    use std::signer;
    use std::string::{Self, String};
    use std::smart_table::{Self, SmartTable};
    use std::timestamp;

    use ccip::auth;
    use ccip::client;
    use ccip::eth_abi;
    use ccip::state_object;

    use mcms::bcs_stream;
    use mcms::mcms_registry;

    const CHAIN_FAMILY_SELECTOR_EVM: vector<u8> = x"2812d52c";
    const CHAIN_FAMILY_SELECTOR_SVM: vector<u8> = x"1e10bdc4";
    const CHAIN_FAMILY_SELECTOR_APTOS: vector<u8> = x"ac77ffec";
    const CHAIN_FAMILY_SELECTOR_SUI: vector<u8> = x"c4e05953";

    /// @dev We disallow the first 1024 addresses to avoid calling into a range known for hosting precompiles. Calling
    /// into precompiles probably won't cause any issues, but to be safe we can disallow this range. It is extremely
    /// unlikely that anyone would ever be able to generate an address in this range. There is no official range of
    /// precompiles, but EIP-7587 proposes to reserve the range 0x100 to 0x1ff. Our range is more conservative, even
    /// though it might not be exhaustive for all chains, which is OK. We also disallow the zero address, which is a
    /// common practice.
    const EVM_PRECOMPILE_SPACE: u256 = 1024;

    /// @dev According to the Aptos docs, the first 0xa addresses are reserved for precompiles.
    /// https://github.com/aptos-labs/aptos-core/blob/main/aptos-move/framework/aptos-framework/doc/account.md#function-create_framework_reserved_account-1
    /// We use the same range for SUI, even though there is one documented reserved address outside of this range.
    /// Since sending a message to this address would not cause any negative side effects, as it would never register
    /// a callback with CCIP, there is no negative impact.
    /// https://move-book.com/appendix/reserved-addresses.html
    const MOVE_PRECOMPILE_SPACE: u256 = 0x0b;

    const ALLOW_OUT_OF_ORDER_EXECUTION: bool = true;

    const GAS_PRICE_BITS: u8 = 112;
    const GAS_PRICE_MASK_112_BITS: u256 = 0xffffffffffffffffffffffffffff; // 28 f's

    const MESSAGE_FIXED_BYTES: u64 = 32 * 15;
    const MESSAGE_FIXED_BYTES_PER_TOKEN: u64 = 32 * (4 + (3 + 2));

    const CCIP_LOCK_OR_BURN_V1_RET_BYTES: u32 = 32;

    /// The maximum number of accounts that can be passed in SVMExtraArgs.
    const SVM_EXTRA_ARGS_MAX_ACCOUNTS: u64 = 64;

    /// Number of overhead accounts needed for message execution on SVM.
    /// These are message.receiver, and the OffRamp Signer PDA specific to the receiver.
    const SVM_MESSAGING_ACCOUNTS_OVERHEAD: u64 = 2;

    /// The size of each SVM account (in bytes).
    const SVM_ACCOUNT_BYTE_SIZE: u64 = 32;

    /// The expected static payload size of a token transfer when Borsh encoded and submitted to SVM.
    /// TokenPool extra data and offchain data sizes are dynamic, and should be accounted for separately.
    const SVM_TOKEN_TRANSFER_DATA_OVERHEAD: u64 = (4 + 32) // source_pool
    + 32 // token_address
    + 4 // gas_amount
    + 4 // extra_data overhead
    + 32 // amount
    + 32 // size of the token lookup table account
    + 32 // token-related accounts in the lookup table, over-estimated to 32, typically between 11 - 13
    + 32 // token account belonging to the token receiver, e.g ATA, not included in the token lookup table
    + 32 // per-chain token pool config, not included in the token lookup table
    + 32 // per-chain token billing config, not always included in the token lookup table
    + 32; // OffRamp pool signer PDA, not included in the token lookup table;

    const MAX_U64: u256 = 18446744073709551615;
    const MAX_U160: u256 = 1461501637330902918203684832716283019655932542975;
    const MAX_U256: u256 =
        115792089237316195423570985008687907853269984665640564039457584007913129639935;
    const VAL_1E5: u256 = 100_000;
    const VAL_1E14: u256 = 100_000_000_000_000;
    const VAL_1E16: u256 = 10_000_000_000_000_000;
    const VAL_1E18: u256 = 1_000_000_000_000_000_000;

    // Link has 8 decimals on Aptos and 18 decimals on it's native chain, Ethereum. We want to emit
    // the fee in juels (1e18) denomination for consistency across chains. This means we multiply
    // the fee by 1e10 on Aptos before we emit it in the event.
    const LOCAL_8_TO_18_DECIMALS_LINK_MULTIPLIER: u256 = 10_000_000_000;

    struct FeeQuoterState has key, store {
        // max_fee_juels_per_msg is in juels (1e18) denomination for consistency across chains.
        max_fee_juels_per_msg: u256,
        link_token: address,
        token_price_staleness_threshold: u64,
        fee_tokens: vector<address>,
        usd_per_unit_gas_by_dest_chain: SmartTable<u64, TimestampedPrice>,
        usd_per_token: SmartTable<address, TimestampedPrice>,
        dest_chain_configs: SmartTable<u64, DestChainConfig>,
        // dest chain selector -> local token -> TokenTransferFeeConfig
        token_transfer_fee_configs: SmartTable<u64, SmartTable<address, TokenTransferFeeConfig>>,
        premium_multiplier_wei_per_eth: SmartTable<address, u64>,
        fee_token_added_events: EventHandle<FeeTokenAdded>,
        fee_token_removed_events: EventHandle<FeeTokenRemoved>,
        token_transfer_fee_config_added_events: EventHandle<TokenTransferFeeConfigAdded>,
        token_transfer_fee_config_removed_events: EventHandle<TokenTransferFeeConfigRemoved>,
        usd_per_token_updated_events: EventHandle<UsdPerTokenUpdated>,
        usd_per_unit_gas_updated_events: EventHandle<UsdPerUnitGasUpdated>,
        dest_chain_added_events: EventHandle<DestChainAdded>,
        dest_chain_config_updated_events: EventHandle<DestChainConfigUpdated>,
        premium_multiplier_wei_per_eth_updated_events: EventHandle<
            PremiumMultiplierWeiPerEthUpdated>
    }

    struct StaticConfig has drop {
        max_fee_juels_per_msg: u256,
        link_token: address,
        token_price_staleness_threshold: u64
    }

    struct DestChainConfig has store, drop, copy {
        is_enabled: bool,
        max_number_of_tokens_per_msg: u16,
        max_data_bytes: u32,
        max_per_msg_gas_limit: u32,
        dest_gas_overhead: u32,
        dest_gas_per_payload_byte_base: u8,
        dest_gas_per_payload_byte_high: u8,
        dest_gas_per_payload_byte_threshold: u16,
        dest_data_availability_overhead_gas: u32,
        dest_gas_per_data_availability_byte: u16,
        dest_data_availability_multiplier_bps: u16,
        chain_family_selector: vector<u8>,
        enforce_out_of_order: bool,
        default_token_fee_usd_cents: u16,
        default_token_dest_gas_overhead: u32,
        default_tx_gas_limit: u32,
        // Multiplier for gas costs, 1e18 based so 11e17 = 10% extra cost.
        gas_multiplier_wei_per_eth: u64,
        gas_price_staleness_threshold: u32,
        network_fee_usd_cents: u32
    }

    struct TokenTransferFeeConfig has store, drop, copy {
        min_fee_usd_cents: u32,
        max_fee_usd_cents: u32,
        deci_bps: u16,
        dest_gas_overhead: u32,
        dest_bytes_overhead: u32,
        is_enabled: bool
    }

    struct TimestampedPrice has store, drop, copy {
        value: u256,
        timestamp: u64
    }

    #[event]
    struct FeeTokenAdded has store, drop {
        fee_token: address
    }

    #[event]
    struct FeeTokenRemoved has store, drop {
        fee_token: address
    }

    #[event]
    struct TokenTransferFeeConfigAdded has store, drop {
        dest_chain_selector: u64,
        token: address,
        token_transfer_fee_config: TokenTransferFeeConfig
    }

    #[event]
    struct TokenTransferFeeConfigRemoved has store, drop {
        dest_chain_selector: u64,
        token: address
    }

    #[event]
    struct UsdPerTokenUpdated has store, drop {
        token: address,
        usd_per_token: u256,
        timestamp: u64
    }

    #[event]
    struct UsdPerUnitGasUpdated has store, drop {
        dest_chain_selector: u64,
        usd_per_unit_gas: u256,
        timestamp: u64
    }

    #[event]
    struct DestChainAdded has store, drop {
        dest_chain_selector: u64,
        dest_chain_config: DestChainConfig
    }

    #[event]
    struct DestChainConfigUpdated has store, drop {
        dest_chain_selector: u64,
        dest_chain_config: DestChainConfig
    }

    #[event]
    struct PremiumMultiplierWeiPerEthUpdated has store, drop {
        token: address,
        premium_multiplier_wei_per_eth: u64
    }

    const E_ALREADY_INITIALIZED: u64 = 1;
    const E_INVALID_LINK_TOKEN: u64 = 2;
    const E_UNKNOWN_DEST_CHAIN_SELECTOR: u64 = 3;
    const E_UNKNOWN_TOKEN: u64 = 4;
    const E_DEST_CHAIN_NOT_ENABLED: u64 = 5;
    const E_TOKEN_UPDATE_MISMATCH: u64 = 6;
    const E_GAS_UPDATE_MISMATCH: u64 = 7;
    const E_TOKEN_TRANSFER_FEE_CONFIG_MISMATCH: u64 = 8;
    const E_FEE_TOKEN_NOT_SUPPORTED: u64 = 9;
    const E_TOKEN_NOT_SUPPORTED: u64 = 10;
    const E_UNKNOWN_CHAIN_FAMILY_SELECTOR: u64 = 11;
    const E_STALE_GAS_PRICE: u64 = 12;
    const E_MESSAGE_TOO_LARGE: u64 = 13;
    const E_UNSUPPORTED_NUMBER_OF_TOKENS: u64 = 14;
    const E_INVALID_EVM_ADDRESS: u64 = 15;
    const E_INVALID_32BYTES_ADDRESS: u64 = 16;
    const E_FEE_TOKEN_COST_TOO_HIGH: u64 = 17;
    const E_MESSAGE_GAS_LIMIT_TOO_HIGH: u64 = 18;
    const E_EXTRA_ARG_OUT_OF_ORDER_EXECUTION_MUST_BE_TRUE: u64 = 19;
    const E_INVALID_EXTRA_ARGS_TAG: u64 = 20;
    const E_INVALID_EXTRA_ARGS_DATA: u64 = 21;
    const E_INVALID_TOKEN_RECEIVER: u64 = 22;
    const E_MESSAGE_COMPUTE_UNIT_LIMIT_TOO_HIGH: u64 = 23;
    const E_MESSAGE_FEE_TOO_HIGH: u64 = 24;
    const E_SOURCE_TOKEN_DATA_TOO_LARGE: u64 = 25;
    const E_INVALID_DEST_CHAIN_SELECTOR: u64 = 26;
    const E_INVALID_GAS_LIMIT: u64 = 27;
    const E_INVALID_CHAIN_FAMILY_SELECTOR: u64 = 28;
    const E_TO_TOKEN_AMOUNT_TOO_LARGE: u64 = 29;
    const E_UNKNOWN_FUNCTION: u64 = 30;
    const E_ZERO_TOKEN_PRICE: u64 = 31;
    const E_TOO_MANY_SVM_EXTRA_ARGS_ACCOUNTS: u64 = 32;
    const E_INVALID_SVM_EXTRA_ARGS_WRITABLE_BITMAP: u64 = 33;
    const E_INVALID_FEE_RANGE: u64 = 34;
    const E_INVALID_DEST_BYTES_OVERHEAD: u64 = 35;
    const E_INVALID_SVM_RECEIVER_LENGTH: u64 = 36;
    const E_TOKEN_AMOUNT_MISMATCH: u64 = 37;
    const E_INVALID_SVM_ACCOUNT_LENGTH: u64 = 38;

    #[view]
    public fun type_and_version(): String {
        string::utf8(b"FeeQuoter 1.6.0")
    }

    fun init_module(publisher: &signer) {
        // Register the entrypoint with mcms
        if (@mcms_register_entrypoints == @0x1) {
            register_mcms_entrypoint(publisher);
        };
    }

    public entry fun initialize(
        caller: &signer,
        max_fee_juels_per_msg: u256,
        link_token: address,
        token_price_staleness_threshold: u64,
        fee_tokens: vector<address>
    ) {
        auth::assert_only_owner(signer::address_of(caller));

        assert!(
            !exists<FeeQuoterState>(state_object::object_address()),
            error::invalid_argument(E_ALREADY_INITIALIZED)
        );

        assert!(
            object::object_exists<Metadata>(link_token),
            error::invalid_argument(E_INVALID_LINK_TOKEN)
        );

        let state_object_signer = state_object::object_signer();

        let state = FeeQuoterState {
            max_fee_juels_per_msg,
            link_token,
            token_price_staleness_threshold,
            fee_tokens,
            usd_per_unit_gas_by_dest_chain: smart_table::new(),
            usd_per_token: smart_table::new(),
            dest_chain_configs: smart_table::new(),
            token_transfer_fee_configs: smart_table::new(),
            premium_multiplier_wei_per_eth: smart_table::new(),
            fee_token_added_events: account::new_event_handle(&state_object_signer),
            fee_token_removed_events: account::new_event_handle(&state_object_signer),
            token_transfer_fee_config_added_events: account::new_event_handle(
                &state_object_signer
            ),
            token_transfer_fee_config_removed_events: account::new_event_handle(
                &state_object_signer
            ),
            usd_per_token_updated_events: account::new_event_handle(&state_object_signer),
            usd_per_unit_gas_updated_events: account::new_event_handle(
                &state_object_signer
            ),
            dest_chain_added_events: account::new_event_handle(&state_object_signer),
            dest_chain_config_updated_events: account::new_event_handle(
                &state_object_signer
            ),
            premium_multiplier_wei_per_eth_updated_events: account::new_event_handle(
                &state_object_signer
            )
        };
        move_to(&state_object_signer, state);
    }

    #[view]
    public fun get_token_price(token: address): TimestampedPrice acquires FeeQuoterState {
        get_token_price_internal(borrow_state(), token)
    }

    public fun timestamped_price_value(
        timestamped_price: &TimestampedPrice
    ): u256 {
        timestamped_price.value
    }

    public fun timestamped_price_timestamp(
        timestamped_price: &TimestampedPrice
    ): u64 {
        timestamped_price.timestamp
    }

    #[view]
    public fun get_token_prices(
        tokens: vector<address>
    ): (vector<TimestampedPrice>) acquires FeeQuoterState {
        let state = borrow_state();
        tokens.map_ref(|token| get_token_price_internal(state, *token))
    }

    #[view]
    public fun get_dest_chain_gas_price(
        dest_chain_selector: u64
    ): TimestampedPrice acquires FeeQuoterState {
        get_dest_chain_gas_price_internal(borrow_state(), dest_chain_selector)
    }

    #[view]
    public fun get_token_and_gas_prices(
        token: address, dest_chain_selector: u64
    ): (u256, u256) acquires FeeQuoterState {
        let state = borrow_state();
        let dest_chain_config = get_dest_chain_config_internal(
            state, dest_chain_selector
        );
        assert!(
            dest_chain_config.is_enabled,
            error::invalid_argument(E_DEST_CHAIN_NOT_ENABLED)
        );
        let token_price = get_token_price_internal(state, token);
        let gas_price_value =
            get_validated_gas_price_internal(
                state, dest_chain_config, dest_chain_selector
            );
        (token_price.value, gas_price_value)
    }

    #[view]
    public fun convert_token_amount(
        from_token: address, from_token_amount: u64, to_token: address
    ): u64 acquires FeeQuoterState {
        let state = borrow_state();
        convert_token_amount_internal(state, from_token, from_token_amount, to_token)
    }

    #[view]
    public fun get_fee_tokens(): vector<address> acquires FeeQuoterState {
        borrow_state().fee_tokens
    }

    public entry fun apply_fee_token_updates(
        caller: &signer,
        fee_tokens_to_remove: vector<address>,
        fee_tokens_to_add: vector<address>
    ) acquires FeeQuoterState {
        auth::assert_only_owner(signer::address_of(caller));

        let state = borrow_state_mut();

        // Remove tokens
        fee_tokens_to_remove.for_each_ref(
            |fee_token| {
                let fee_token = *fee_token;
                let (found, index) = state.fee_tokens.index_of(&fee_token);
                if (found) {
                    state.fee_tokens.remove(index);
                    event::emit_event(
                        &mut state.fee_token_removed_events, FeeTokenRemoved { fee_token }
                    );
                };
            }
        );

        // Add new tokens
        fee_tokens_to_add.for_each_ref(
            |fee_token| {
                let fee_token = *fee_token;
                let (found, _) = state.fee_tokens.index_of(&fee_token);
                if (!found) {
                    state.fee_tokens.push_back(fee_token);
                    event::emit_event(
                        &mut state.fee_token_added_events, FeeTokenAdded { fee_token }
                    );
                };
            }
        );
    }

    #[view]
    public fun get_token_transfer_fee_config(
        dest_chain_selector: u64, token: address
    ): TokenTransferFeeConfig acquires FeeQuoterState {
        *get_token_transfer_fee_config_internal(
            borrow_state(), dest_chain_selector, token
        )
    }

    inline fun get_token_transfer_fee_config_internal(
        state: &FeeQuoterState, dest_chain_selector: u64, token: address
    ): &TokenTransferFeeConfig {
        let empty_fee_config = TokenTransferFeeConfig {
            min_fee_usd_cents: 0,
            max_fee_usd_cents: 0,
            deci_bps: 0,
            dest_gas_overhead: 0,
            dest_bytes_overhead: 0,
            is_enabled: false
        };

        if (!state.token_transfer_fee_configs.contains(dest_chain_selector)) {
            &empty_fee_config
        } else {
            let dest_chain_fee_configs =
                state.token_transfer_fee_configs.borrow(dest_chain_selector);

            dest_chain_fee_configs.borrow_with_default(token, &empty_fee_config)
        }
    }

    // Note that unlike EVM, this only allows changes for a single dest chain selector
    // at a time.
    public entry fun apply_token_transfer_fee_config_updates(
        caller: &signer,
        dest_chain_selector: u64,
        add_tokens: vector<address>,
        add_min_fee_usd_cents: vector<u32>,
        add_max_fee_usd_cents: vector<u32>,
        add_deci_bps: vector<u16>,
        add_dest_gas_overhead: vector<u32>,
        add_dest_bytes_overhead: vector<u32>,
        add_is_enabled: vector<bool>,
        remove_tokens: vector<address>
    ) acquires FeeQuoterState {
        auth::assert_only_owner(signer::address_of(caller));

        let state = borrow_state_mut();

        if (!state.token_transfer_fee_configs.contains(dest_chain_selector)) {
            state.token_transfer_fee_configs.add(
                dest_chain_selector, smart_table::new()
            );
        };
        let token_transfer_fee_configs =
            state.token_transfer_fee_configs.borrow_mut(dest_chain_selector);

        let add_tokens_len = add_tokens.length();
        assert!(
            add_tokens_len == add_min_fee_usd_cents.length(),
            error::invalid_argument(E_TOKEN_TRANSFER_FEE_CONFIG_MISMATCH)
        );
        assert!(
            add_tokens_len == add_max_fee_usd_cents.length(),
            error::invalid_argument(E_TOKEN_TRANSFER_FEE_CONFIG_MISMATCH)
        );
        assert!(
            add_tokens_len == add_deci_bps.length(),
            error::invalid_argument(E_TOKEN_TRANSFER_FEE_CONFIG_MISMATCH)
        );
        assert!(
            add_tokens_len == add_dest_gas_overhead.length(),
            error::invalid_argument(E_TOKEN_TRANSFER_FEE_CONFIG_MISMATCH)
        );
        assert!(
            add_tokens_len == add_dest_bytes_overhead.length(),
            error::invalid_argument(E_TOKEN_TRANSFER_FEE_CONFIG_MISMATCH)
        );
        assert!(
            add_tokens_len == add_is_enabled.length(),
            error::invalid_argument(E_TOKEN_TRANSFER_FEE_CONFIG_MISMATCH)
        );

        for (i in 0..add_tokens_len) {
            let token = add_tokens[i];
            let min_fee_usd_cents = add_min_fee_usd_cents[i];
            let max_fee_usd_cents = add_max_fee_usd_cents[i];
            let deci_bps = add_deci_bps[i];
            let dest_gas_overhead = add_dest_gas_overhead[i];
            let dest_bytes_overhead = add_dest_bytes_overhead[i];
            let is_enabled = add_is_enabled[i];

            let token_transfer_fee_config = TokenTransferFeeConfig {
                min_fee_usd_cents,
                max_fee_usd_cents,
                deci_bps,
                dest_gas_overhead,
                dest_bytes_overhead,
                is_enabled
            };

            if (token_transfer_fee_config.min_fee_usd_cents
                >= token_transfer_fee_config.max_fee_usd_cents) {
                abort error::invalid_argument(E_INVALID_FEE_RANGE);
            };
            if (token_transfer_fee_config.dest_bytes_overhead
                < CCIP_LOCK_OR_BURN_V1_RET_BYTES) {
                abort error::invalid_argument(E_INVALID_DEST_BYTES_OVERHEAD);
            };

            token_transfer_fee_configs.upsert(token, token_transfer_fee_config);

            event::emit_event(
                &mut state.token_transfer_fee_config_added_events,
                TokenTransferFeeConfigAdded {
                    dest_chain_selector,
                    token,
                    token_transfer_fee_config
                }
            );
        };

        remove_tokens.for_each_ref(
            |token| {
                let token: address = *token;
                if (token_transfer_fee_configs.contains(token)) {
                    token_transfer_fee_configs.remove(token);

                    event::emit_event(
                        &mut state.token_transfer_fee_config_removed_events,
                        TokenTransferFeeConfigRemoved { dest_chain_selector, token }
                    );
                }
            }
        );
    }

    public fun update_prices(
        caller: &signer,
        source_tokens: vector<address>,
        source_usd_per_token: vector<u256>,
        gas_dest_chain_selectors: vector<u64>,
        gas_usd_per_unit_gas: vector<u256>
    ) acquires FeeQuoterState {
        auth::assert_is_allowed_offramp(signer::address_of(caller));

        assert!(
            source_tokens.length() == source_usd_per_token.length(),
            error::invalid_argument(E_TOKEN_UPDATE_MISMATCH)
        );
        assert!(
            gas_dest_chain_selectors.length() == gas_usd_per_unit_gas.length(),
            error::invalid_argument(E_GAS_UPDATE_MISMATCH)
        );

        let state = borrow_state_mut();
        let timestamp = timestamp::now_seconds();

        source_tokens.zip_ref(
            &source_usd_per_token,
            |token, usd_per_token| {
                let timestamped_price = TimestampedPrice { value: *usd_per_token, timestamp };
                state.usd_per_token.upsert(*token, timestamped_price);
                event::emit_event(
                    &mut state.usd_per_token_updated_events,
                    UsdPerTokenUpdated {
                        token: *token,
                        usd_per_token: *usd_per_token,
                        timestamp
                    }
                );
            }
        );

        gas_dest_chain_selectors.zip_ref(
            &gas_usd_per_unit_gas,
            |dest_chain_selector, usd_per_unit_gas| {
                let timestamped_price =
                    TimestampedPrice { value: *usd_per_unit_gas, timestamp };
                state.usd_per_unit_gas_by_dest_chain.upsert(
                    *dest_chain_selector, timestamped_price
                );

                event::emit_event(
                    &mut state.usd_per_unit_gas_updated_events,
                    UsdPerUnitGasUpdated {
                        dest_chain_selector: *dest_chain_selector,
                        usd_per_unit_gas: *usd_per_unit_gas,
                        timestamp
                    }
                );
            }
        );
    }

    #[view]
    public fun get_validated_fee(
        dest_chain_selector: u64,
        receiver: vector<u8>,
        data: vector<u8>,
        local_token_addresses: vector<address>,
        local_token_amounts: vector<u64>,
        _token_store_addresses: vector<address>,
        fee_token: address,
        _fee_token_store: address,
        extra_args: vector<u8>
    ): u64 acquires FeeQuoterState {
        let state = borrow_state();

        let dest_chain_config = get_dest_chain_config_internal(
            state, dest_chain_selector
        );
        assert!(
            dest_chain_config.is_enabled,
            error::invalid_argument(E_DEST_CHAIN_NOT_ENABLED)
        );

        assert!(
            state.fee_tokens.contains(&fee_token),
            error::invalid_argument(E_FEE_TOKEN_NOT_SUPPORTED)
        );

        let chain_family_selector = dest_chain_config.chain_family_selector;

        let data_len = data.length();
        let tokens_len = local_token_addresses.length();
        validate_message(dest_chain_config, data_len, tokens_len);

        let gas_limit =
            if (chain_family_selector == CHAIN_FAMILY_SELECTOR_EVM
                || chain_family_selector == CHAIN_FAMILY_SELECTOR_APTOS
                || chain_family_selector == CHAIN_FAMILY_SELECTOR_SUI) {
                resolve_generic_gas_limit(dest_chain_config, extra_args)
            } else if (chain_family_selector == CHAIN_FAMILY_SELECTOR_SVM) {
                resolve_svm_gas_limit(
                    dest_chain_config,
                    state,
                    dest_chain_selector,
                    extra_args,
                    receiver,
                    data_len,
                    tokens_len,
                    local_token_addresses
                )
            } else {
                abort error::invalid_argument(E_UNKNOWN_CHAIN_FAMILY_SELECTOR)
            };

        validate_dest_family_address(chain_family_selector, receiver, gas_limit);

        let fee_token_price = get_token_price_internal(state, fee_token);
        assert!(fee_token_price.value > 0, error::invalid_state(E_ZERO_TOKEN_PRICE));

        let packed_gas_price =
            get_validated_gas_price_internal(
                state, dest_chain_config, dest_chain_selector
            );

        let (premium_fee_usd_wei, token_transfer_gas, token_transfer_bytes_overhead) =
            if (tokens_len > 0) {
                get_token_transfer_cost(
                    state,
                    dest_chain_config,
                    dest_chain_selector,
                    fee_token,
                    fee_token_price,
                    local_token_addresses,
                    local_token_amounts
                )
            } else {
                ((dest_chain_config.network_fee_usd_cents as u256) * VAL_1E16, 0, 0)
            };
        let premium_multiplier =
            get_premium_multiplier_wei_per_eth_internal(state, fee_token);
        premium_fee_usd_wei *=(premium_multiplier as u256); // Apply premium multiplier in wei/eth units

        let data_availability_cost_usd_36_decimals =
            if (dest_chain_config.dest_data_availability_multiplier_bps > 0) {
                // Extract data availability gas price (upper 112 bits) - matches EVM uint112 behavior
                let data_availability_gas_price =
                    (packed_gas_price >> GAS_PRICE_BITS) & GAS_PRICE_MASK_112_BITS;
                get_data_availability_cost(
                    dest_chain_config,
                    data_availability_gas_price,
                    data_len,
                    tokens_len,
                    token_transfer_bytes_overhead
                )
            } else { 0 };

        let call_data_length: u256 =
            (data_len as u256) + (token_transfer_bytes_overhead as u256);
        let dest_call_data_cost =
            call_data_length
                * (dest_chain_config.dest_gas_per_payload_byte_base as u256);
        if (call_data_length
            > (dest_chain_config.dest_gas_per_payload_byte_threshold as u256)) {
            dest_call_data_cost =
                (dest_chain_config.dest_gas_per_payload_byte_base as u256)
                    * (dest_chain_config.dest_gas_per_payload_byte_threshold as u256)
                    + (
                        call_data_length
                            - (dest_chain_config.dest_gas_per_payload_byte_threshold as u256)
                    ) * (dest_chain_config.dest_gas_per_payload_byte_high as u256);
        };

        let total_dest_chain_gas =
            (dest_chain_config.dest_gas_overhead as u256) + (token_transfer_gas as u256)
                + dest_call_data_cost + gas_limit;

        let gas_cost = packed_gas_price & GAS_PRICE_MASK_112_BITS;

        let total_cost_usd =
            (
                total_dest_chain_gas * gas_cost
                    * (dest_chain_config.gas_multiplier_wei_per_eth as u256)
            ) + premium_fee_usd_wei + data_availability_cost_usd_36_decimals;

        let fee_token_cost = total_cost_usd / fee_token_price.value;

        // we need to convert back to a u64 which is what the fungible asset module uses for amounts.
        assert!(
            fee_token_cost <= MAX_U64,
            error::invalid_state(E_FEE_TOKEN_COST_TOO_HIGH)
        );
        fee_token_cost as u64
    }

    public entry fun apply_premium_multiplier_wei_per_eth_updates(
        caller: &signer, tokens: vector<address>, premium_multiplier_wei_per_eth: vector<u64>
    ) acquires FeeQuoterState {
        auth::assert_only_owner(signer::address_of(caller));

        let state = borrow_state_mut();

        tokens.zip_ref(
            &premium_multiplier_wei_per_eth,
            |token, premium_multiplier_wei_per_eth| {
                let token: address = *token;
                let premium_multiplier_wei_per_eth: u64 = *premium_multiplier_wei_per_eth;
                state.premium_multiplier_wei_per_eth.upsert(
                    token, premium_multiplier_wei_per_eth
                );
                event::emit_event(
                    &mut state.premium_multiplier_wei_per_eth_updated_events,
                    PremiumMultiplierWeiPerEthUpdated {
                        token,
                        premium_multiplier_wei_per_eth
                    }
                );
            }
        );
    }

    #[view]
    public fun get_premium_multiplier_wei_per_eth(token: address): u64 acquires FeeQuoterState {
        let state = borrow_state();
        get_premium_multiplier_wei_per_eth_internal(state, token)
    }

    inline fun get_premium_multiplier_wei_per_eth_internal(
        state: &FeeQuoterState, token: address
    ): u64 {
        assert!(
            state.premium_multiplier_wei_per_eth.contains(token),
            error::invalid_argument(E_UNKNOWN_TOKEN)
        );
        *state.premium_multiplier_wei_per_eth.borrow(token)
    }

    inline fun resolve_generic_gas_limit(
        dest_chain_config: &DestChainConfig, extra_args: vector<u8>
    ): u256 {
        let (gas_limit, _allow_out_of_order_execution) =
            decode_generic_extra_args(dest_chain_config, extra_args);
        assert!(
            gas_limit <= (dest_chain_config.max_per_msg_gas_limit as u256),
            error::invalid_argument(E_MESSAGE_GAS_LIMIT_TOO_HIGH)
        );
        gas_limit
    }

    inline fun resolve_svm_gas_limit(
        dest_chain_config: &DestChainConfig,
        state: &FeeQuoterState,
        dest_chain_selector: u64,
        extra_args: vector<u8>,
        receiver: vector<u8>,
        data_len: u64,
        tokens_len: u64,
        local_token_addresses: vector<address>
    ): u256 {
        let extra_args_len = extra_args.length();
        assert!(extra_args_len > 0, error::invalid_argument(E_INVALID_EXTRA_ARGS_DATA));

        let (
            compute_units,
            account_is_writable_bitmap,
            _allow_out_of_order_execution,
            token_receiver,
            accounts
        ) = decode_svm_extra_args(extra_args);

        let gas_limit = compute_units;

        assert!(
            gas_limit <= dest_chain_config.max_per_msg_gas_limit,
            error::invalid_argument(E_MESSAGE_COMPUTE_UNIT_LIMIT_TOO_HIGH)
        );

        let accounts_length = accounts.length();
        // The max payload size for SVM is heavily dependent on the accounts passed into extra args and the number of
        // tokens. Below, token and account overhead will count towards maxDataBytes.
        let svm_expanded_data_length = data_len;

        // The receiver length has not yet been validated before this point.
        assert!(
            receiver.length() == 32,
            error::invalid_argument(E_INVALID_SVM_RECEIVER_LENGTH)
        );
        let receiver_uint = eth_abi::decode_u256_value(receiver);
        if (receiver_uint == 0) {
            // When message receiver is zero, CCIP receiver is not invoked on SVM.
            // There should not be additional accounts specified for the receiver.
            assert!(
                accounts_length == 0,
                error::invalid_argument(E_TOO_MANY_SVM_EXTRA_ARGS_ACCOUNTS)
            );
        } else {
            // The messaging accounts needed for CCIP receiver on SVM are:
            // message receiver, offramp PDA signer,
            // plus remaining accounts specified in SVM extraArgs. Each account is 32 bytes.
            svm_expanded_data_length +=((accounts_length
                + SVM_MESSAGING_ACCOUNTS_OVERHEAD) * SVM_ACCOUNT_BYTE_SIZE);
        };

        for (i in 0..accounts_length) {
            assert!(
                accounts[i].length() == 32,
                error::invalid_argument(E_INVALID_SVM_ACCOUNT_LENGTH)
            );
        };

        if (tokens_len > 0) {
            assert!(
                token_receiver.length() == 32
                    && eth_abi::decode_u256_value(token_receiver) != 0,
                error::invalid_argument(E_INVALID_TOKEN_RECEIVER)
            );
        };
        assert!(
            accounts_length <= SVM_EXTRA_ARGS_MAX_ACCOUNTS,
            error::invalid_argument(E_TOO_MANY_SVM_EXTRA_ARGS_ACCOUNTS)
        );
        assert!(
            (account_is_writable_bitmap >> (accounts_length as u8)) == 0,
            error::invalid_argument(E_INVALID_SVM_EXTRA_ARGS_WRITABLE_BITMAP)
        );

        svm_expanded_data_length += tokens_len * SVM_TOKEN_TRANSFER_DATA_OVERHEAD;

        // The token destBytesOverhead can be very different per token so we have to take it into account as well.
        for (i in 0..tokens_len) {
            let local_token_address = local_token_addresses[i];
            let destBytesOverhead =
                get_token_transfer_fee_config_internal(
                    state, dest_chain_selector, local_token_address
                ).dest_bytes_overhead;

            // Pools get CCIP_LOCK_OR_BURN_V1_RET_BYTES by default, but if an override is set we use that instead.
            if (destBytesOverhead > 0) {
                svm_expanded_data_length +=(destBytesOverhead as u64);
            } else {
                svm_expanded_data_length +=(CCIP_LOCK_OR_BURN_V1_RET_BYTES as u64);
            }
        };

        assert!(
            svm_expanded_data_length <= (dest_chain_config.max_data_bytes as u64),
            error::invalid_argument(E_MESSAGE_TOO_LARGE)
        );

        gas_limit as u256
    }

    inline fun decode_generic_extra_args(
        dest_chain_config: &DestChainConfig, extra_args: vector<u8>
    ): (u256, bool) {
        let extra_args_len = extra_args.length();
        if (extra_args_len == 0) {
            // If extra args are empty, generate default values. Out-of-order is always true.
            (
                dest_chain_config.default_tx_gas_limit as u256,
                ALLOW_OUT_OF_ORDER_EXECUTION
            )
        } else {
            assert!(
                extra_args_len >= 4,
                error::invalid_argument(E_INVALID_EXTRA_ARGS_DATA)
            );

            let args_tag = extra_args.slice(0, 4);
            assert!(
                args_tag == client::generic_extra_args_v2_tag(),
                error::invalid_argument(E_INVALID_EXTRA_ARGS_TAG)
            );

            let args_data = extra_args.slice(4, extra_args_len);
            decode_generic_extra_args_v2(args_data)
        }
    }

    inline fun decode_generic_extra_args_v2(extra_args: vector<u8>): (u256, bool) {
        let stream = bcs_stream::new(extra_args);
        let gas_limit = bcs_stream::deserialize_u256(&mut stream);
        let allow_out_of_order_execution = bcs_stream::deserialize_bool(&mut stream);
        bcs_stream::assert_is_consumed(&stream);
        (gas_limit, allow_out_of_order_execution)
    }

    inline fun decode_svm_extra_args(
        extra_args: vector<u8>
    ): (
        u32, u64, bool, vector<u8>, vector<vector<u8>>
    ) {
        let extra_args_len = extra_args.length();
        assert!(extra_args_len >= 4, error::invalid_argument(E_INVALID_EXTRA_ARGS_DATA));

        let args_tag = extra_args.slice(0, 4);
        assert!(
            args_tag == client::svm_extra_args_v1_tag(),
            error::invalid_argument(E_INVALID_EXTRA_ARGS_TAG)
        );
        let args_data = extra_args.slice(4, extra_args_len);
        decode_svm_extra_args_v1(args_data)
    }

    inline fun decode_svm_extra_args_v1(
        extra_args: vector<u8>
    ): (
        u32, u64, bool, vector<u8>, vector<vector<u8>>
    ) {
        let stream = bcs_stream::new(extra_args);
        let compute_units = bcs_stream::deserialize_u32(&mut stream);
        let account_is_writable_bitmap = bcs_stream::deserialize_u64(&mut stream);
        let allow_out_of_order_execution = bcs_stream::deserialize_bool(&mut stream);
        let token_receiver = bcs_stream::deserialize_vector_u8(&mut stream);
        let accounts =
            bcs_stream::deserialize_vector(
                &mut stream, |stream| bcs_stream::deserialize_vector_u8(stream)
            );
        bcs_stream::assert_is_consumed(&stream);
        (
            compute_units,
            account_is_writable_bitmap,
            allow_out_of_order_execution,
            token_receiver,
            accounts
        )
    }

    inline fun get_data_availability_cost(
        dest_chain_config: &DestChainConfig,
        data_availability_gas_price: u256,
        data_len: u64,
        tokens_len: u64,
        total_transfer_bytes_overhead: u32
    ): u256 {
        let data_availability_length_bytes =
            MESSAGE_FIXED_BYTES + data_len + (tokens_len
                * MESSAGE_FIXED_BYTES_PER_TOKEN)
                + (total_transfer_bytes_overhead as u64);

        let data_availability_gas =
            ((data_availability_length_bytes as u256)
                * (dest_chain_config.dest_gas_per_data_availability_byte as u256)) + (
                dest_chain_config.dest_data_availability_overhead_gas as u256
            );

        data_availability_gas * data_availability_gas_price
            * (dest_chain_config.dest_data_availability_multiplier_bps as u256)
            * VAL_1E14
    }

    inline fun get_token_transfer_cost(
        state: &FeeQuoterState,
        dest_chain_config: &DestChainConfig,
        dest_chain_selector: u64,
        fee_token: address,
        fee_token_price: TimestampedPrice,
        local_token_addresses: vector<address>,
        local_token_amounts: vector<u64>
    ): (u256, u32, u32) {
        let token_transfer_fee_wei: u256 = 0;
        let token_transfer_gas: u32 = 0;
        let token_transfer_bytes_overhead: u32 = 0;

        local_token_addresses.zip_ref(
            &local_token_amounts,
            |local_token_address, local_token_amount| {
                let local_token_address: address = *local_token_address;
                let local_token_amount: u64 = *local_token_amount;

                let transfer_fee_config =
                    get_token_transfer_fee_config_internal(
                        state, dest_chain_selector, local_token_address
                    );

                if (!transfer_fee_config.is_enabled) {
                    token_transfer_fee_wei +=(
                        (dest_chain_config.default_token_fee_usd_cents as u256)
                            * VAL_1E16
                    );
                    token_transfer_gas += dest_chain_config.default_token_dest_gas_overhead;
                    token_transfer_bytes_overhead += CCIP_LOCK_OR_BURN_V1_RET_BYTES;
                } else {
                    let bps_fee_usd_wei = 0;
                    if (transfer_fee_config.deci_bps > 0) {
                        let token_price =
                            if (local_token_address == fee_token) {
                                fee_token_price
                            } else {
                                get_token_price_internal(state, local_token_address)
                            };
                        let token_usd_value =
                            calc_usd_value_from_token_amount(
                                local_token_amount, token_price.value
                            );
                        bps_fee_usd_wei =
                            (token_usd_value * (transfer_fee_config.deci_bps as u256))
                                / VAL_1E5;
                    };

                    token_transfer_gas += transfer_fee_config.dest_gas_overhead;
                    token_transfer_bytes_overhead += transfer_fee_config.dest_bytes_overhead;

                    let min_fee_usd_wei =
                        (transfer_fee_config.min_fee_usd_cents as u256) * VAL_1E16;
                    let max_fee_usd_wei =
                        (transfer_fee_config.max_fee_usd_cents as u256) * VAL_1E16;
                    let selected_fee_usd_wei =
                        if (bps_fee_usd_wei < min_fee_usd_wei) {
                            min_fee_usd_wei
                        } else if (bps_fee_usd_wei > max_fee_usd_wei) {
                            max_fee_usd_wei
                        } else {
                            bps_fee_usd_wei
                        };
                    token_transfer_fee_wei += selected_fee_usd_wei;
                }
            }
        );

        (token_transfer_fee_wei, token_transfer_gas, token_transfer_bytes_overhead)
    }

    inline fun calc_usd_value_from_token_amount(
        token_amount: u64, token_price: u256
    ): u256 {
        (token_amount as u256) * token_price / VAL_1E18
    }

    #[view]
    public fun get_token_receiver(
        dest_chain_selector: u64, extra_args: vector<u8>, message_receiver: vector<u8>
    ): vector<u8> acquires FeeQuoterState {
        let chain_family_selector =
            get_dest_chain_config_internal(borrow_state(), dest_chain_selector).chain_family_selector;
        if (chain_family_selector == CHAIN_FAMILY_SELECTOR_EVM
            || chain_family_selector == CHAIN_FAMILY_SELECTOR_APTOS
            || chain_family_selector == CHAIN_FAMILY_SELECTOR_SUI) {
            message_receiver
        } else if (chain_family_selector == CHAIN_FAMILY_SELECTOR_SVM) {
            let (
                _compute_units,
                _account_is_writable_bitmap,
                _allow_out_of_order_execution,
                token_receiver,
                _accounts
            ) = decode_svm_extra_args(extra_args);
            token_receiver
        } else {
            abort error::invalid_argument(E_UNKNOWN_CHAIN_FAMILY_SELECTOR)
        }
    }

    #[view]
    /// @returns (msg_fee_juels, is_out_of_order_execution, converted_extra_args, dest_exec_data_per_token)
    public fun process_message_args(
        dest_chain_selector: u64,
        fee_token: address,
        fee_token_amount: u64,
        extra_args: vector<u8>,
        local_token_addresses: vector<address>,
        dest_token_addresses: vector<vector<u8>>,
        dest_pool_datas: vector<vector<u8>>
    ): (
        u256, bool, vector<u8>, vector<vector<u8>>
    ) acquires FeeQuoterState {
        let state = borrow_state();
        // This is the fee in Aptos denomination. We convert it to juels (1e18 based) below.
        let msg_fee_link_local_denomination =
            if (fee_token == state.link_token) {
                fee_token_amount
            } else {
                convert_token_amount_internal(
                    state,
                    fee_token,
                    fee_token_amount,
                    state.link_token
                )
            };

        // We convert the local denomination to juels here. This means that the offchain monitoring will always
        // get a consistent juels amount regardless of the token denomination on the chain.
        let msg_fee_juels =
            (msg_fee_link_local_denomination as u256)
                * LOCAL_8_TO_18_DECIMALS_LINK_MULTIPLIER;

        // max_fee_juels_per_msg is in juels denomination for consistency across chains.
        assert!(
            msg_fee_juels <= state.max_fee_juels_per_msg,
            error::invalid_argument(E_MESSAGE_FEE_TOO_HIGH)
        );

        let dest_chain_config = get_dest_chain_config_internal(
            state, dest_chain_selector
        );

        let (converted_extra_args, is_out_of_order_execution) =
            process_chain_family_selector(
                dest_chain_config, !dest_token_addresses.is_empty(), extra_args
            );

        let dest_exec_data_per_token =
            process_pool_return_data(
                state,
                dest_chain_config,
                dest_chain_selector,
                local_token_addresses,
                dest_token_addresses,
                dest_pool_datas
            );

        (
            msg_fee_juels,
            is_out_of_order_execution,
            converted_extra_args,
            dest_exec_data_per_token
        )
    }

    inline fun process_chain_family_selector(
        dest_chain_config: &DestChainConfig,
        is_message_with_token_transfers: bool,
        extra_args: vector<u8>
    ): (vector<u8>, bool) {
        let chain_family_selector = dest_chain_config.chain_family_selector;
        if (chain_family_selector == CHAIN_FAMILY_SELECTOR_EVM
            || chain_family_selector == CHAIN_FAMILY_SELECTOR_APTOS
            || chain_family_selector == CHAIN_FAMILY_SELECTOR_SUI) {
            let (gas_limit, _allow_out_of_order_execution) =
                decode_generic_extra_args(dest_chain_config, extra_args);
            let extra_args_v2 =
                client::encode_generic_extra_args_v2(
                    gas_limit, ALLOW_OUT_OF_ORDER_EXECUTION
                );
            (extra_args_v2, ALLOW_OUT_OF_ORDER_EXECUTION)
        } else if (chain_family_selector == CHAIN_FAMILY_SELECTOR_SVM) {
            let (
                compute_units,
                _account_is_writable_bitmap,
                _allow_out_of_order_execution,
                token_receiver,
                _accounts
            ) = decode_svm_extra_args(extra_args);
            if (is_message_with_token_transfers) {
                assert!(
                    token_receiver.length() == 32,
                    error::invalid_argument(E_INVALID_TOKEN_RECEIVER)
                );
                let token_receiver_uint = eth_abi::decode_u256_value(token_receiver);
                assert!(
                    token_receiver_uint > 0,
                    error::invalid_argument(E_INVALID_TOKEN_RECEIVER)
                );
            };

            assert!(
                compute_units <= dest_chain_config.max_per_msg_gas_limit,
                error::invalid_argument(E_MESSAGE_COMPUTE_UNIT_LIMIT_TOO_HIGH)
            );

            (extra_args, ALLOW_OUT_OF_ORDER_EXECUTION)
        } else {
            abort error::invalid_argument(E_UNKNOWN_CHAIN_FAMILY_SELECTOR)
        }
    }

    inline fun process_pool_return_data(
        state: &FeeQuoterState,
        dest_chain_config: &DestChainConfig,
        dest_chain_selector: u64,
        local_token_addresses: vector<address>,
        dest_token_addresses: vector<vector<u8>>,
        dest_pool_datas: vector<vector<u8>>
    ): vector<vector<u8>> {
        let chain_family_selector = dest_chain_config.chain_family_selector;

        let tokens_len = dest_token_addresses.length();
        assert!(
            tokens_len == dest_pool_datas.length(),
            error::invalid_argument(E_TOKEN_AMOUNT_MISMATCH)
        );

        let dest_exec_data_per_token = vector[];
        for (i in 0..tokens_len) {
            let local_token_address = local_token_addresses[i];
            let dest_token_address = dest_token_addresses[i];
            let dest_pool_data_len = dest_pool_datas[i].length();

            let token_transfer_fee_config =
                get_token_transfer_fee_config_internal(
                    state, dest_chain_selector, local_token_address
                );
            if (dest_pool_data_len > (CCIP_LOCK_OR_BURN_V1_RET_BYTES as u64)) {
                assert!(
                    dest_pool_data_len
                        <= (token_transfer_fee_config.dest_bytes_overhead as u64),
                    error::invalid_argument(E_SOURCE_TOKEN_DATA_TOO_LARGE)
                );
            };

            // We pass in 1 as gas_limit as this only matters for SVM address validation. This ensures the address
            // may not be 0x0.
            validate_dest_family_address(chain_family_selector, dest_token_address, 1);

            let dest_gas_amount =
                if (token_transfer_fee_config.is_enabled) {
                    token_transfer_fee_config.dest_gas_overhead
                } else {
                    dest_chain_config.default_token_dest_gas_overhead
                };

            let dest_exec_data = bcs::to_bytes(&dest_gas_amount);
            dest_exec_data_per_token.push_back(dest_exec_data);
        };

        dest_exec_data_per_token
    }

    #[view]
    public fun get_dest_chain_config(
        dest_chain_selector: u64
    ): DestChainConfig acquires FeeQuoterState {
        *get_dest_chain_config_internal(borrow_state(), dest_chain_selector)
    }

    inline fun get_dest_chain_config_internal(
        state: &FeeQuoterState, dest_chain_selector: u64
    ): &DestChainConfig {
        assert!(
            state.dest_chain_configs.contains(dest_chain_selector),
            error::invalid_argument(E_UNKNOWN_DEST_CHAIN_SELECTOR)
        );
        state.dest_chain_configs.borrow(dest_chain_selector)
    }

    public entry fun apply_dest_chain_config_updates(
        caller: &signer,
        dest_chain_selector: u64,
        is_enabled: bool,
        max_number_of_tokens_per_msg: u16,
        max_data_bytes: u32,
        max_per_msg_gas_limit: u32,
        dest_gas_overhead: u32,
        dest_gas_per_payload_byte_base: u8,
        dest_gas_per_payload_byte_high: u8,
        dest_gas_per_payload_byte_threshold: u16,
        dest_data_availability_overhead_gas: u32,
        dest_gas_per_data_availability_byte: u16,
        dest_data_availability_multiplier_bps: u16,
        chain_family_selector: vector<u8>,
        enforce_out_of_order: bool,
        default_token_fee_usd_cents: u16,
        default_token_dest_gas_overhead: u32,
        default_tx_gas_limit: u32,
        gas_multiplier_wei_per_eth: u64,
        gas_price_staleness_threshold: u32,
        network_fee_usd_cents: u32
    ) acquires FeeQuoterState {
        auth::assert_only_owner(signer::address_of(caller));

        let state = borrow_state_mut();

        assert!(
            dest_chain_selector != 0,
            error::invalid_argument(E_INVALID_DEST_CHAIN_SELECTOR)
        );
        assert!(
            default_tx_gas_limit != 0 && default_tx_gas_limit <= max_per_msg_gas_limit,
            error::invalid_argument(E_INVALID_GAS_LIMIT)
        );

        assert!(
            chain_family_selector == CHAIN_FAMILY_SELECTOR_EVM
                || chain_family_selector == CHAIN_FAMILY_SELECTOR_SVM
                || chain_family_selector == CHAIN_FAMILY_SELECTOR_APTOS
                || chain_family_selector == CHAIN_FAMILY_SELECTOR_SUI,
            error::invalid_argument(E_INVALID_CHAIN_FAMILY_SELECTOR)
        );

        let dest_chain_config = DestChainConfig {
            is_enabled,
            max_number_of_tokens_per_msg,
            max_data_bytes,
            max_per_msg_gas_limit,
            dest_gas_overhead,
            dest_gas_per_payload_byte_base,
            dest_gas_per_payload_byte_high,
            dest_gas_per_payload_byte_threshold,
            dest_data_availability_overhead_gas,
            dest_gas_per_data_availability_byte,
            dest_data_availability_multiplier_bps,
            chain_family_selector,
            enforce_out_of_order,
            default_token_fee_usd_cents,
            default_token_dest_gas_overhead,
            default_tx_gas_limit,
            gas_multiplier_wei_per_eth,
            gas_price_staleness_threshold,
            network_fee_usd_cents
        };

        if (state.dest_chain_configs.contains(dest_chain_selector)) {
            let dest_chain_config_ref =
                state.dest_chain_configs.borrow_mut(dest_chain_selector);
            *dest_chain_config_ref = dest_chain_config;
            event::emit_event(
                &mut state.dest_chain_config_updated_events,
                DestChainConfigUpdated { dest_chain_selector, dest_chain_config }
            );
        } else {
            state.dest_chain_configs.add(dest_chain_selector, dest_chain_config);
            event::emit_event(
                &mut state.dest_chain_added_events,
                DestChainAdded { dest_chain_selector, dest_chain_config }
            );
        }
    }

    #[view]
    public fun get_static_config(): StaticConfig acquires FeeQuoterState {
        let state = borrow_state();
        StaticConfig {
            max_fee_juels_per_msg: state.max_fee_juels_per_msg,
            link_token: state.link_token,
            token_price_staleness_threshold: state.token_price_staleness_threshold
        }
    }

    inline fun borrow_state(): &FeeQuoterState {
        borrow_global<FeeQuoterState>(state_object::object_address())
    }

    inline fun borrow_state_mut(): &mut FeeQuoterState {
        borrow_global_mut<FeeQuoterState>(state_object::object_address())
    }

    inline fun get_validated_token_price(
        state: &FeeQuoterState, token: address
    ): TimestampedPrice {
        let token_price = get_token_price_internal(state, token);
        assert!(
            token_price.value > 0 && token_price.timestamp > 0,
            error::invalid_state(E_TOKEN_NOT_SUPPORTED)
        );
        token_price
    }

    // Token prices can be stale. On EVM we have additional fallbacks to a price feed, if configured. Since these
    // fallbacks don't exist on Aptos, we simply return the price as is.
    inline fun get_token_price_internal(
        state: &FeeQuoterState, token: address
    ): TimestampedPrice {
        assert!(
            state.usd_per_token.contains(token),
            error::invalid_argument(E_UNKNOWN_TOKEN)
        );
        *state.usd_per_token.borrow(token)
    }

    inline fun get_dest_chain_gas_price_internal(
        state: &FeeQuoterState, dest_chain_selector: u64
    ): TimestampedPrice {
        assert!(
            state.usd_per_unit_gas_by_dest_chain.contains(dest_chain_selector),
            error::invalid_argument(E_UNKNOWN_DEST_CHAIN_SELECTOR)
        );
        *state.usd_per_unit_gas_by_dest_chain.borrow(dest_chain_selector)
    }

    inline fun get_validated_gas_price_internal(
        state: &FeeQuoterState, dest_chain_config: &DestChainConfig, dest_chain_selector: u64
    ): u256 {
        let gas_price = get_dest_chain_gas_price_internal(state, dest_chain_selector);
        if (dest_chain_config.gas_price_staleness_threshold > 0) {
            let time_passed_seconds = timestamp::now_seconds() - gas_price.timestamp;
            assert!(
                time_passed_seconds
                    <= (dest_chain_config.gas_price_staleness_threshold as u64),
                error::invalid_state(E_STALE_GAS_PRICE)
            );
        };
        gas_price.value
    }

    inline fun convert_token_amount_internal(
        state: &FeeQuoterState,
        from_token: address,
        from_token_amount: u64,
        to_token: address
    ): u64 {
        let from_token_price = get_validated_token_price(state, from_token);
        let to_token_price = get_validated_token_price(state, to_token);
        let to_token_amount =
            ((from_token_amount as u256) * from_token_price.value) / to_token_price.value;
        assert!(
            to_token_amount <= MAX_U64,
            error::invalid_argument(E_TO_TOKEN_AMOUNT_TOO_LARGE)
        );
        to_token_amount as u64
    }

    inline fun validate_message(
        dest_chain_config: &DestChainConfig, data_len: u64, tokens_len: u64
    ) {
        assert!(
            data_len <= (dest_chain_config.max_data_bytes as u64),
            error::invalid_argument(E_MESSAGE_TOO_LARGE)
        );
        assert!(
            tokens_len <= (dest_chain_config.max_number_of_tokens_per_msg as u64),
            error::invalid_argument(E_UNSUPPORTED_NUMBER_OF_TOKENS)
        );
    }

    inline fun validate_dest_family_address(
        chain_family_selector: vector<u8>, encoded_address: vector<u8>, gas_limit: u256
    ) {
        if (chain_family_selector == CHAIN_FAMILY_SELECTOR_EVM) {
            validate_evm_address(encoded_address);
        } else if (chain_family_selector == CHAIN_FAMILY_SELECTOR_SVM) {
            // SVM addresses don't have a precompile space at the first X addresses, instead we validate that if the gasLimit
            // is non-zero, the address must not be 0x0.
            let min_address = 0;
            if (gas_limit > 0) {
                min_address = 1;
            };
            validate_32byte_address(encoded_address, min_address);
        } else if (chain_family_selector == CHAIN_FAMILY_SELECTOR_APTOS
            || chain_family_selector == CHAIN_FAMILY_SELECTOR_SUI) {
            validate_32byte_address(encoded_address, MOVE_PRECOMPILE_SPACE);
        };
    }

    inline fun validate_evm_address(encoded_address: vector<u8>) {
        assert!(
            encoded_address.length() == 32,
            error::invalid_argument(E_INVALID_EVM_ADDRESS)
        );

        let encoded_address_uint = eth_abi::decode_u256_value(encoded_address);

        assert!(
            encoded_address_uint >= EVM_PRECOMPILE_SPACE,
            error::invalid_argument(E_INVALID_EVM_ADDRESS)
        );
        assert!(
            encoded_address_uint <= MAX_U160,
            error::invalid_argument(E_INVALID_EVM_ADDRESS)
        );
    }

    inline fun validate_32byte_address(
        encoded_address: vector<u8>, min_value: u256
    ) {
        assert!(
            encoded_address.length() == 32,
            error::invalid_argument(E_INVALID_32BYTES_ADDRESS)
        );

        let encoded_address_uint = eth_abi::decode_u256_value(encoded_address);
        assert!(
            encoded_address_uint >= min_value,
            error::invalid_argument(E_INVALID_32BYTES_ADDRESS)
        );
    }

    // ================================================================
    // |                      MCMS Entrypoint                         |
    // ================================================================
    struct McmsCallback has drop {}

    public fun mcms_entrypoint<T: key>(
        _metadata: object::Object<T>
    ): option::Option<u128> acquires FeeQuoterState {
        let (caller, function, data) =
            mcms_registry::get_callback_params(@ccip, McmsCallback {});

        let function_bytes = *function.bytes();
        let stream = bcs_stream::new(data);

        if (function_bytes == b"initialize") {
            let max_fee_juels_per_msg = bcs_stream::deserialize_u256(&mut stream);
            let link_token = bcs_stream::deserialize_address(&mut stream);
            let token_price_staleness_threshold = bcs_stream::deserialize_u64(
                &mut stream
            );
            let fee_tokens =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_address(stream)
                );
            bcs_stream::assert_is_consumed(&stream);
            initialize(
                &caller,
                max_fee_juels_per_msg,
                link_token,
                token_price_staleness_threshold,
                fee_tokens
            )
        } else if (function_bytes == b"apply_fee_token_updates") {
            let fee_tokens_to_remove =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_address(stream)
                );
            let fee_tokens_to_add =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_address(stream)
                );
            bcs_stream::assert_is_consumed(&stream);
            apply_fee_token_updates(&caller, fee_tokens_to_remove, fee_tokens_to_add)
        } else if (function_bytes == b"apply_token_transfer_fee_config_updates") {
            let dest_chain_selector = bcs_stream::deserialize_u64(&mut stream);
            let add_tokens =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_address(stream)
                );
            let add_min_fee_usd_cents =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_u32(stream)
                );
            let add_max_fee_usd_cents =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_u32(stream)
                );
            let add_deci_bps =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_u16(stream)
                );
            let add_dest_gas_overhead =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_u32(stream)
                );
            let add_dest_bytes_overhead =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_u32(stream)
                );
            let add_is_enabled =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_bool(stream)
                );
            let remove_tokens =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_address(stream)
                );
            bcs_stream::assert_is_consumed(&stream);
            apply_token_transfer_fee_config_updates(
                &caller,
                dest_chain_selector,
                add_tokens,
                add_min_fee_usd_cents,
                add_max_fee_usd_cents,
                add_deci_bps,
                add_dest_gas_overhead,
                add_dest_bytes_overhead,
                add_is_enabled,
                remove_tokens
            )
        } else if (function_bytes == b"update_prices") {
            let source_tokens =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_address(stream)
                );
            let source_usd_per_token =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_u256(stream)
                );
            let gas_dest_chain_selectors =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_u64(stream)
                );
            let gas_usd_per_unit_gas =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_u256(stream)
                );
            bcs_stream::assert_is_consumed(&stream);
            update_prices(
                &caller,
                source_tokens,
                source_usd_per_token,
                gas_dest_chain_selectors,
                gas_usd_per_unit_gas
            )
        } else if (function_bytes == b"apply_premium_multiplier_wei_per_eth_updates") {
            let tokens =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_address(stream)
                );
            let premium_multiplier_wei_per_eth =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_u64(stream)
                );
            bcs_stream::assert_is_consumed(&stream);
            apply_premium_multiplier_wei_per_eth_updates(
                &caller, tokens, premium_multiplier_wei_per_eth
            )
        } else if (function_bytes == b"apply_dest_chain_config_updates") {
            let dest_chain_selector = bcs_stream::deserialize_u64(&mut stream);
            let is_enabled = bcs_stream::deserialize_bool(&mut stream);
            let max_number_of_tokens_per_msg = bcs_stream::deserialize_u16(&mut stream);
            let max_data_bytes = bcs_stream::deserialize_u32(&mut stream);
            let max_per_msg_gas_limit = bcs_stream::deserialize_u32(&mut stream);
            let dest_gas_overhead = bcs_stream::deserialize_u32(&mut stream);
            let dest_gas_per_payload_byte_base = bcs_stream::deserialize_u8(&mut stream);
            let dest_gas_per_payload_byte_high = bcs_stream::deserialize_u8(&mut stream);
            let dest_gas_per_payload_byte_threshold =
                bcs_stream::deserialize_u16(&mut stream);
            let dest_data_availability_overhead_gas =
                bcs_stream::deserialize_u32(&mut stream);
            let dest_gas_per_data_availability_byte =
                bcs_stream::deserialize_u16(&mut stream);
            let dest_data_availability_multiplier_bps =
                bcs_stream::deserialize_u16(&mut stream);
            let chain_family_selector =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_u8(stream)
                );
            let enforce_out_of_order = bcs_stream::deserialize_bool(&mut stream);
            let default_token_fee_usd_cents = bcs_stream::deserialize_u16(&mut stream);
            let default_token_dest_gas_overhead = bcs_stream::deserialize_u32(
                &mut stream
            );
            let default_tx_gas_limit = bcs_stream::deserialize_u32(&mut stream);
            let gas_multiplier_wei_per_eth = bcs_stream::deserialize_u64(&mut stream);
            let gas_price_staleness_threshold = bcs_stream::deserialize_u32(&mut stream);
            let network_fee_usd_cents = bcs_stream::deserialize_u32(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            apply_dest_chain_config_updates(
                &caller,
                dest_chain_selector,
                is_enabled,
                max_number_of_tokens_per_msg,
                max_data_bytes,
                max_per_msg_gas_limit,
                dest_gas_overhead,
                dest_gas_per_payload_byte_base,
                dest_gas_per_payload_byte_high,
                dest_gas_per_payload_byte_threshold,
                dest_data_availability_overhead_gas,
                dest_gas_per_data_availability_byte,
                dest_data_availability_multiplier_bps,
                chain_family_selector,
                enforce_out_of_order,
                default_token_fee_usd_cents,
                default_token_dest_gas_overhead,
                default_tx_gas_limit,
                gas_multiplier_wei_per_eth,
                gas_price_staleness_threshold,
                network_fee_usd_cents
            )
        } else {
            abort error::invalid_argument(E_UNKNOWN_FUNCTION)
        };

        option::none()
    }

    /// Callable during upgrades
    public(friend) fun register_mcms_entrypoint(publisher: &signer) {
        mcms_registry::register_entrypoint(
            publisher, string::utf8(b"fee_quoter"), McmsCallback {}
        );
    }

    public fun dest_chain_config_values(
        config: DestChainConfig
    ): (
        bool,
        u16,
        u32,
        u32,
        u32,
        u8,
        u8,
        u16,
        u32,
        u16,
        u16,
        vector<u8>,
        bool,
        u16,
        u32,
        u32,
        u64,
        u32,
        u32
    ) {
        (
            config.is_enabled,
            config.max_number_of_tokens_per_msg,
            config.max_data_bytes,
            config.max_per_msg_gas_limit,
            config.dest_gas_overhead,
            config.dest_gas_per_payload_byte_base,
            config.dest_gas_per_payload_byte_high,
            config.dest_gas_per_payload_byte_threshold,
            config.dest_data_availability_overhead_gas,
            config.dest_gas_per_data_availability_byte,
            config.dest_data_availability_multiplier_bps,
            config.chain_family_selector,
            config.enforce_out_of_order,
            config.default_token_fee_usd_cents,
            config.default_token_dest_gas_overhead,
            config.default_tx_gas_limit,
            config.gas_multiplier_wei_per_eth,
            config.gas_price_staleness_threshold,
            config.network_fee_usd_cents
        )
    }

    public fun token_transfer_fee_config_values(
        config: TokenTransferFeeConfig
    ): (u32, u32, u16, u32, u32, bool) {
        (
            config.min_fee_usd_cents,
            config.max_fee_usd_cents,
            config.deci_bps,
            config.dest_gas_overhead,
            config.dest_bytes_overhead,
            config.is_enabled
        )
    }

    // ========================== TEST ONLY ==========================
    #[test_only]
    public fun test_register_mcms_entrypoint(publisher: &signer) {
        mcms_registry::register_entrypoint(
            publisher, string::utf8(b"fee_quoter"), McmsCallback {}
        );
    }

    #[test_only]
    public fun test_decode_svm_extra_args(
        extra_args: vector<u8>
    ): (
        u32, u64, bool, vector<u8>, vector<vector<u8>>
    ) {
        decode_svm_extra_args(extra_args)
    }

    #[test_only]
    public fun test_decode_generic_extra_args(
        dest_chain_config: &DestChainConfig, extra_args: vector<u8>
    ): (u256, bool) {
        decode_generic_extra_args(dest_chain_config, extra_args)
    }

    #[test_only]
    public fun test_decode_generic_extra_args_v2(extra_args: vector<u8>): (u256, bool) {
        decode_generic_extra_args_v2(extra_args)
    }

    #[test_only]
    public fun test_decode_svm_extra_args_v1(
        extra_args: vector<u8>
    ): (
        u32, u64, bool, vector<u8>, vector<vector<u8>>
    ) {
        decode_svm_extra_args_v1(extra_args)
    }

    #[test_only]
    public fun test_create_dest_chain_config(
        is_enabled: bool,
        max_number_of_tokens_per_msg: u16,
        max_data_bytes: u32,
        max_per_msg_gas_limit: u32,
        dest_gas_overhead: u32,
        dest_gas_per_payload_byte_base: u8,
        dest_gas_per_payload_byte_high: u8,
        dest_gas_per_payload_byte_threshold: u16,
        dest_data_availability_overhead_gas: u32,
        dest_gas_per_data_availability_byte: u16,
        dest_data_availability_multiplier_bps: u16,
        chain_family_selector: vector<u8>,
        enforce_out_of_order: bool,
        default_token_fee_usd_cents: u16,
        default_token_dest_gas_overhead: u32,
        default_tx_gas_limit: u32,
        gas_multiplier_wei_per_eth: u64,
        gas_price_staleness_threshold: u32,
        network_fee_usd_cents: u32
    ): DestChainConfig {
        DestChainConfig {
            is_enabled,
            max_number_of_tokens_per_msg,
            max_data_bytes,
            max_per_msg_gas_limit,
            dest_gas_overhead,
            dest_gas_per_payload_byte_base,
            dest_gas_per_payload_byte_high,
            dest_gas_per_payload_byte_threshold,
            dest_data_availability_overhead_gas,
            dest_gas_per_data_availability_byte,
            dest_data_availability_multiplier_bps,
            chain_family_selector,
            enforce_out_of_order,
            default_token_fee_usd_cents,
            default_token_dest_gas_overhead,
            default_tx_gas_limit,
            gas_multiplier_wei_per_eth,
            gas_price_staleness_threshold,
            network_fee_usd_cents
        }
    }
}
`

/** sources/merkle_proof.move */
export const CCIP_MERKLE_PROOF_MOVE = `module ccip::merkle_proof {
    use std::aptos_hash;
    use std::error;

    const LEAF_DOMAIN_SEPARATOR: vector<u8> = x"0000000000000000000000000000000000000000000000000000000000000000";
    const INTERNAL_DOMAIN_SEPARATOR: vector<u8> = x"0000000000000000000000000000000000000000000000000000000000000001";

    const E_VECTOR_LENGTH_MISMATCH: u64 = 1;

    public fun leaf_domain_separator(): vector<u8> {
        LEAF_DOMAIN_SEPARATOR
    }

    public fun merkle_root(leaf: vector<u8>, proofs: vector<vector<u8>>): vector<u8> {
        proofs.fold(leaf, |acc, proof| hash_pair(acc, proof))
    }

    public fun vector_u8_gt(a: &vector<u8>, b: &vector<u8>): bool {
        let len = a.length();
        assert!(len == b.length(), error::invalid_argument(E_VECTOR_LENGTH_MISMATCH));

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

    /// Hashes two byte vectors using SHA3-256 after concatenating them with the internal domain separator
    inline fun hash_internal_node(left: vector<u8>, right: vector<u8>): vector<u8> {
        let data = INTERNAL_DOMAIN_SEPARATOR;
        data.append(left);
        data.append(right);
        aptos_hash::keccak256(data)
    }

    /// Hashes a pair of byte vectors, ordering them lexographically
    inline fun hash_pair(a: vector<u8>, b: vector<u8>): vector<u8> {
        if (!vector_u8_gt(&a, &b)) {
            hash_internal_node(a, b)
        } else {
            hash_internal_node(b, a)
        }
    }
}
`

/** sources/nonce_manager.move */
export const CCIP_NONCE_MANAGER_MOVE = `module ccip::nonce_manager {
    use std::signer;
    use std::smart_table::{Self, SmartTable};
    use std::string::{Self, String};

    use ccip::auth;
    use ccip::state_object;

    struct NonceManagerState has key, store {
        // dest chain selector -> sender -> nonce
        outbound_nonces: SmartTable<u64, SmartTable<address, u64>>
    }

    #[view]
    public fun type_and_version(): String {
        string::utf8(b"NonceManager 1.6.0")
    }

    fun init_module(_publisher: &signer) {
        let state_object_signer = state_object::object_signer();

        move_to(
            &state_object_signer,
            NonceManagerState { outbound_nonces: smart_table::new() }
        );
    }

    #[view]
    public fun get_outbound_nonce(
        dest_chain_selector: u64, sender: address
    ): u64 acquires NonceManagerState {
        let state = borrow_state();

        if (!state.outbound_nonces.contains(dest_chain_selector)) {
            return 0;
        };

        let dest_chain_nonces = state.outbound_nonces.borrow(dest_chain_selector);
        *dest_chain_nonces.borrow_with_default(sender, &0)
    }

    public fun get_incremented_outbound_nonce(
        caller: &signer, dest_chain_selector: u64, sender: address
    ): u64 acquires NonceManagerState {
        auth::assert_is_allowed_onramp(signer::address_of(caller));

        let state = borrow_state_mut();

        if (!state.outbound_nonces.contains(dest_chain_selector)) {
            state.outbound_nonces.add(dest_chain_selector, smart_table::new());
        };

        let dest_chain_nonces = state.outbound_nonces.borrow_mut(dest_chain_selector);
        let nonce_ref = dest_chain_nonces.borrow_mut_with_default(sender, 0);
        let incremented_nonce = *nonce_ref + 1;
        *nonce_ref = incremented_nonce;
        incremented_nonce
    }

    inline fun borrow_state(): &NonceManagerState {
        borrow_global<NonceManagerState>(state_object::object_address())
    }

    inline fun borrow_state_mut(): &mut NonceManagerState {
        borrow_global_mut<NonceManagerState>(state_object::object_address())
    }

    // ========================== TEST ONLY ==========================
    #[test_only]
    public fun test_init_module(publisher: &signer) {
        init_module(publisher);
    }
}
`

/** sources/ownable.move */
export const CCIP_OWNABLE_MOVE = `/// This module implements an Ownable component similar to Ownable2Step.sol for managing
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
module ccip::ownable {
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

/** sources/receiver_dispatcher.move */
export const CCIP_RECEIVER_DISPATCHER_MOVE = `module ccip::receiver_dispatcher {
    use std::dispatchable_fungible_asset;
    use std::signer;

    use ccip::auth;
    use ccip::client;
    use ccip::receiver_registry;

    public fun dispatch_receive(
        caller: &signer, receiver_address: address, message: client::Any2AptosMessage
    ) {
        auth::assert_is_allowed_offramp(signer::address_of(caller));

        if (receiver_registry::is_registered_receiver_v2(receiver_address)) {
            receiver_registry::invoke_ccip_receive_v2(receiver_address, message);
        } else {
            let dispatch_metadata =
                receiver_registry::start_receive(receiver_address, message);
            dispatchable_fungible_asset::derived_supply(dispatch_metadata);
            receiver_registry::finish_receive(receiver_address);
        }
    }
}
`

/** sources/receiver_registry.move */
export const CCIP_RECEIVER_REGISTRY_MOVE = `module ccip::receiver_registry {
    use std::account;
    use std::bcs;
    use std::dispatchable_fungible_asset;
    use std::error;
    use std::event::{Self, EventHandle};
    use std::function_info::{Self, FunctionInfo};
    use std::type_info::{Self, TypeInfo};
    use std::fungible_asset::{Self, Metadata};
    use std::object::{Self, ExtendRef, Object, TransferRef};
    use std::option::{Self, Option};
    use std::signer;
    use std::string::{Self, String};

    use ccip::client;
    use ccip::state_object;

    friend ccip::receiver_dispatcher;

    struct ReceiverRegistryState has key, store {
        extend_ref: ExtendRef,
        transfer_ref: TransferRef,
        receiver_registered_events: EventHandle<ReceiverRegistered>
    }

    struct ReceiverRegistryEventsV2 has key {
        receiver_registered_v2_events: EventHandle<ReceiverRegisteredV2>
    }

    struct CCIPReceiverRegistration has key {
        ccip_receive_function: FunctionInfo,
        proof_typeinfo: TypeInfo,
        dispatch_metadata: Object<Metadata>,
        dispatch_extend_ref: ExtendRef,
        dispatch_transfer_ref: TransferRef,
        executing_input: Option<client::Any2AptosMessage>
    }

    struct CCIPReceiverRegistrationV2 has key {
        callback: |client::Any2AptosMessage| has copy + drop + store
    }

    #[event]
    struct ReceiverRegistered has store, drop {
        receiver_address: address,
        receiver_module_name: vector<u8>
    }

    #[event]
    struct ReceiverRegisteredV2 has drop, store {
        receiver_address: address,
        callback: |client::Any2AptosMessage| has copy + drop + store
    }

    const E_ALREADY_REGISTERED: u64 = 1;
    const E_UNKNOWN_RECEIVER: u64 = 2;
    const E_UNKNOWN_PROOF_TYPE: u64 = 3;
    const E_MISSING_INPUT: u64 = 4;
    const E_NON_EMPTY_INPUT: u64 = 5;
    const E_PROOF_TYPE_ACCOUNT_MISMATCH: u64 = 6;
    const E_PROOF_TYPE_MODULE_MISMATCH: u64 = 7;
    const E_UNAUTHORIZED: u64 = 8;

    #[view]
    public fun type_and_version(): String {
        string::utf8(b"ReceiverRegistry 1.6.0")
    }

    fun init_module(_publisher: &signer) {
        let state_object_signer = state_object::object_signer();
        let constructor_ref =
            object::create_named_object(&state_object_signer, b"CCIPReceiverRegistry");
        let extend_ref = object::generate_extend_ref(&constructor_ref);
        let transfer_ref = object::generate_transfer_ref(&constructor_ref);

        let state = ReceiverRegistryState {
            extend_ref,
            transfer_ref,
            receiver_registered_events: account::new_event_handle(&state_object_signer)
        };

        move_to(&state_object_signer, state);
    }

    public fun register_receiver<ProofType: drop>(
        receiver_account: &signer, receiver_module_name: vector<u8>, _proof: ProofType
    ) acquires ReceiverRegistryState {
        let receiver_address = signer::address_of(receiver_account);
        assert!(
            !exists<CCIPReceiverRegistration>(receiver_address)
                && !exists<CCIPReceiverRegistrationV2>(receiver_address),
            error::invalid_argument(E_ALREADY_REGISTERED)
        );

        let ccip_receive_function =
            function_info::new_function_info(
                receiver_account,
                string::utf8(receiver_module_name),
                string::utf8(b"ccip_receive")
            );
        let proof_typeinfo = type_info::type_of<ProofType>();
        assert!(
            proof_typeinfo.account_address() == receiver_address,
            E_PROOF_TYPE_ACCOUNT_MISMATCH
        );
        assert!(
            proof_typeinfo.module_name() == receiver_module_name,
            E_PROOF_TYPE_MODULE_MISMATCH
        );

        let state = borrow_state_mut();
        let dispatch_signer = object::generate_signer_for_extending(&state.extend_ref);

        let dispatch_object_seed = bcs::to_bytes(&receiver_address);
        dispatch_object_seed.append(b"CCIPReceiverRegistration");

        let dispatch_constructor_ref =
            object::create_named_object(&dispatch_signer, dispatch_object_seed);
        let dispatch_extend_ref = object::generate_extend_ref(&dispatch_constructor_ref);
        let dispatch_transfer_ref =
            object::generate_transfer_ref(&dispatch_constructor_ref);
        let dispatch_metadata =
            fungible_asset::add_fungibility(
                &dispatch_constructor_ref,
                option::none(),
                // max name length is 32 chars
                string::utf8(b"CCIPReceiverRegistration"),
                // max symbol length is 10 chars
                string::utf8(b"CCIPRR"),
                0,
                string::utf8(b""),
                string::utf8(b"")
            );

        dispatchable_fungible_asset::register_derive_supply_dispatch_function(
            &dispatch_constructor_ref, option::some(ccip_receive_function)
        );

        move_to(
            receiver_account,
            CCIPReceiverRegistration {
                ccip_receive_function,
                proof_typeinfo,
                dispatch_metadata,
                dispatch_extend_ref,
                dispatch_transfer_ref,
                executing_input: option::none()
            }
        );

        event::emit_event(
            &mut state.receiver_registered_events,
            ReceiverRegistered { receiver_address, receiver_module_name }
        );
    }

    /// Registers a V2 CCIP receiver using a function-value callback (closure).
    ///
    /// Upgrade path: existing legacy receivers can upgrade to V2 by calling this function,
    /// which supersedes the legacy registration without requiring unregistration.
    /// New receivers should use V2 directly. Once V2 is registered, legacy registration
    /// via \`register_receiver()\` is rejected.
    ///
    /// SECURITY: The callback MUST wrap a private \`#[persistent]\` function. Exposing the
    /// receive function as \`public fun\` allows any caller to construct an \`Any2AptosMessage\`
    /// and invoke the receiver directly,
    ///
    /// Correct pattern:
    /// \`\`\`
    /// #[persistent]
    /// fun ccip_receive_v2(message: client::Any2AptosMessage) { ... }
    ///
    /// fun init_module(publisher: &signer) {
    ///     receiver_registry::register_receiver_v2(
    ///         publisher, |message| ccip_receive_v2(message)
    ///     );
    /// }
    /// \`\`\`
    public fun register_receiver_v2(
        receiver_account: &signer, callback: |client::Any2AptosMessage| has copy + drop + store
    ) {
        let receiver_address = signer::address_of(receiver_account);
        assert!(
            !exists<CCIPReceiverRegistrationV2>(receiver_address),
            error::invalid_argument(E_ALREADY_REGISTERED)
        );

        move_to(receiver_account, CCIPReceiverRegistrationV2 { callback });

        event::emit_event(
            &mut borrow_events_v2_mut().receiver_registered_v2_events,
            ReceiverRegisteredV2 { receiver_address, callback }
        );
    }

    #[view]
    public fun is_registered_receiver(receiver_address: address): bool {
        exists<CCIPReceiverRegistration>(receiver_address)
            || exists<CCIPReceiverRegistrationV2>(receiver_address)
    }

    #[view]
    public fun is_registered_receiver_v2(receiver_address: address): bool {
        exists<CCIPReceiverRegistrationV2>(receiver_address)
    }

    public fun get_receiver_input<ProofType: drop>(
        receiver_address: address, _proof: ProofType
    ): client::Any2AptosMessage acquires CCIPReceiverRegistration {
        let registration = get_registration_mut(receiver_address);

        assert!(
            registration.proof_typeinfo == type_info::type_of<ProofType>(),
            error::permission_denied(E_UNKNOWN_PROOF_TYPE)
        );

        assert!(
            registration.executing_input.is_some(),
            error::invalid_state(E_MISSING_INPUT)
        );

        registration.executing_input.extract()
    }

    public(friend) fun start_receive(
        receiver_address: address, message: client::Any2AptosMessage
    ): Object<Metadata> acquires CCIPReceiverRegistration {
        let registration = get_registration_mut(receiver_address);

        assert!(
            registration.executing_input.is_none(),
            error::invalid_state(E_NON_EMPTY_INPUT)
        );

        registration.executing_input.fill(message);

        registration.dispatch_metadata
    }

    public(friend) fun finish_receive(receiver_address: address) acquires CCIPReceiverRegistration {
        let registration = get_registration_mut(receiver_address);

        assert!(
            registration.executing_input.is_none(),
            error::invalid_state(E_NON_EMPTY_INPUT)
        );
    }

    public(friend) fun invoke_ccip_receive_v2(
        receiver_address: address, message: client::Any2AptosMessage
    ) acquires CCIPReceiverRegistrationV2 {
        assert!(
            exists<CCIPReceiverRegistrationV2>(receiver_address),
            error::invalid_argument(E_UNKNOWN_RECEIVER)
        );

        let registration = borrow_global<CCIPReceiverRegistrationV2>(receiver_address);
        (registration.callback) (message);
    }

    inline fun borrow_state(): &ReceiverRegistryState {
        borrow_global<ReceiverRegistryState>(state_object::object_address())
    }

    inline fun borrow_state_mut(): &mut ReceiverRegistryState {
        borrow_global_mut<ReceiverRegistryState>(state_object::object_address())
    }

    inline fun get_registration_mut(receiver_address: address)
        : &mut CCIPReceiverRegistration {
        assert!(
            exists<CCIPReceiverRegistration>(receiver_address),
            error::invalid_argument(E_UNKNOWN_RECEIVER)
        );
        borrow_global_mut<CCIPReceiverRegistration>(receiver_address)
    }

    inline fun borrow_events_v2_mut(): &mut ReceiverRegistryEventsV2 {
        let state_signer = &state_object::object_signer();
        let state_address = state_object::object_address();

        if (!exists<ReceiverRegistryEventsV2>(state_address)) {
            move_to(
                state_signer,
                ReceiverRegistryEventsV2 {
                    receiver_registered_v2_events: account::new_event_handle(state_signer)
                }
            );
        };

        borrow_global_mut<ReceiverRegistryEventsV2>(state_address)
    }

    #[test_only]
    public fun init_module_for_testing(publisher: &signer) {
        init_module(publisher);
    }
}
`

/** sources/rmn_remote.move */
export const CCIP_RMN_REMOTE_MOVE = `module ccip::rmn_remote {
    use std::account;
    use std::aptos_hash;
    use std::bcs;
    use std::chain_id;
    use std::error;
    use std::event::{Self, EventHandle};
    use std::object;
    use std::option;
    use std::secp256k1;
    use std::signer;
    use std::string::{Self, String};
    use std::smart_table::{Self, SmartTable};
    use std::ordered_map::{Self, OrderedMap};

    use ccip::auth;
    use ccip::eth_abi;
    use ccip::merkle_proof;
    use ccip::state_object;

    use mcms::bcs_stream;
    use mcms::mcms_registry;

    const GLOBAL_CURSE_SUBJECT: vector<u8> = x"01000000000000000000000000000001";

    struct RMNRemoteState has key {
        local_chain_selector: u64,
        config: Config,
        config_count: u32,
        signers: SmartTable<vector<u8>, bool>,
        cursed_subjects: SmartTable<vector<u8>, bool>,
        config_set_events: EventHandle<ConfigSet>,
        cursed_events: EventHandle<Cursed>,
        uncursed_events: EventHandle<Uncursed>
    }

    struct Config has copy, drop, store {
        rmn_home_contract_config_digest: vector<u8>,
        signers: vector<Signer>,
        f_sign: u64
    }

    struct Signer has copy, drop, store {
        onchain_public_key: vector<u8>,
        node_index: u64
    }

    struct Report has drop {
        dest_chain_id: u64,
        dest_chain_selector: u64,
        rmn_remote_contract_address: address,
        off_ramp_address: address,
        rmn_home_contract_config_digest: vector<u8>,
        merkle_roots: vector<MerkleRoot>
    }

    struct MerkleRoot has drop {
        source_chain_selector: u64,
        on_ramp_address: vector<u8>,
        min_seq_nr: u64,
        max_seq_nr: u64,
        merkle_root: vector<u8>
    }

    #[event]
    struct ConfigSet has store, drop {
        version: u32,
        config: Config
    }

    #[event]
    struct Cursed has store, drop {
        subjects: vector<vector<u8>>
    }

    #[event]
    struct Uncursed has store, drop {
        subjects: vector<vector<u8>>
    }

    // ================================================================
    // |                  AllowedCursersV2 (Fast Cursing)              |
    // ================================================================
    struct AllowedCursersV2 has key {
        allowed_cursers: OrderedMap<address, bool>,
        allowed_cursers_added_events: EventHandle<AllowedCursersAdded>,
        allowed_cursers_removed_events: EventHandle<AllowedCursersRemoved>
    }

    #[event]
    struct AllowedCursersAdded has store, drop {
        cursers: vector<address>
    }

    #[event]
    struct AllowedCursersRemoved has store, drop {
        cursers: vector<address>
    }

    const E_ALREADY_INITIALIZED: u64 = 1;
    const E_ALREADY_CURSED: u64 = 2;
    const E_CONFIG_NOT_SET: u64 = 3;
    const E_DUPLICATE_SIGNER: u64 = 4;
    const E_INVALID_SIGNATURE: u64 = 5;
    const E_INVALID_SIGNER_ORDER: u64 = 6;
    const E_NOT_ENOUGH_SIGNERS: u64 = 7;
    const E_NOT_CURSED: u64 = 8;
    const E_OUT_OF_ORDER_SIGNATURES: u64 = 9;
    const E_THRESHOLD_NOT_MET: u64 = 10;
    const E_UNEXPECTED_SIGNER: u64 = 11;
    const E_ZERO_VALUE_NOT_ALLOWED: u64 = 12;
    const E_MERKLE_ROOT_LENGTH_MISMATCH: u64 = 13;
    const E_INVALID_DIGEST_LENGTH: u64 = 14;
    const E_SIGNERS_MISMATCH: u64 = 15;
    const E_INVALID_SUBJECT_LENGTH: u64 = 16;
    const E_INVALID_PUBLIC_KEY_LENGTH: u64 = 17;
    const E_UNKNOWN_FUNCTION: u64 = 18;
    const E_NOT_OWNER_OR_ALLOWED_CURSER: u64 = 19;
    const E_ALLOWED_CURSERS_V2_ALREADY_INITIALIZED: u64 = 20;
    const E_ALLOWED_CURSERS_V2_NOT_INITIALIZED: u64 = 21;
    const E_CURSER_ALREADY_ALLOWED: u64 = 22;
    const E_CURSER_NOT_ALLOWED: u64 = 23;

    #[view]
    public fun type_and_version(): String {
        string::utf8(b"RMNRemote 1.6.0")
    }

    fun init_module(publisher: &signer) {
        // Register the entrypoint with mcms
        if (@mcms_register_entrypoints == @0x1) {
            register_mcms_entrypoint(publisher);
        };
    }

    public entry fun initialize(caller: &signer, local_chain_selector: u64) {
        auth::assert_only_owner(signer::address_of(caller));

        assert!(
            local_chain_selector != 0,
            error::invalid_argument(E_ZERO_VALUE_NOT_ALLOWED)
        );
        assert!(
            !exists<RMNRemoteState>(state_object::object_address()),
            error::invalid_argument(E_ALREADY_INITIALIZED)
        );

        let state_object_signer = state_object::object_signer();

        // Create V1 state (RMNRemoteState)
        let state = RMNRemoteState {
            local_chain_selector,
            config: Config {
                rmn_home_contract_config_digest: vector[],
                signers: vector[],
                f_sign: 0
            },
            config_count: 0,
            signers: smart_table::new(),
            cursed_subjects: smart_table::new(),
            config_set_events: account::new_event_handle(&state_object_signer),
            cursed_events: account::new_event_handle(&state_object_signer),
            uncursed_events: account::new_event_handle(&state_object_signer)
        };
        move_to(&state_object_signer, state);

        // Create V2 state (AllowedCursersV2) - new deployments get both
        move_to(
            &state_object_signer,
            AllowedCursersV2 {
                allowed_cursers: ordered_map::new(),
                allowed_cursers_added_events: account::new_event_handle(
                    &state_object_signer
                ),
                allowed_cursers_removed_events: account::new_event_handle(
                    &state_object_signer
                )
            }
        );
    }

    #[test_only]
    /// Legacy initialization that only creates RMNRemoteState (V1).
    /// Used for testing migration scenarios from V1 to V2.
    public entry fun initialize_v1(
        caller: &signer, local_chain_selector: u64
    ) {
        auth::assert_only_owner(signer::address_of(caller));

        assert!(
            local_chain_selector != 0,
            error::invalid_argument(E_ZERO_VALUE_NOT_ALLOWED)
        );
        assert!(
            !exists<RMNRemoteState>(state_object::object_address()),
            error::invalid_argument(E_ALREADY_INITIALIZED)
        );

        let state_object_signer = state_object::object_signer();
        let state = RMNRemoteState {
            local_chain_selector,
            config: Config {
                rmn_home_contract_config_digest: vector[],
                signers: vector[],
                f_sign: 0
            },
            config_count: 0,
            signers: smart_table::new(),
            cursed_subjects: smart_table::new(),
            config_set_events: account::new_event_handle(&state_object_signer),
            cursed_events: account::new_event_handle(&state_object_signer),
            uncursed_events: account::new_event_handle(&state_object_signer)
        };

        move_to(&state_object_signer, state);
    }

    inline fun calculate_digest(report: &Report): vector<u8> {
        let digest = vector[];
        eth_abi::encode_right_padded_bytes32(&mut digest, get_report_digest_header());
        eth_abi::encode_u64(&mut digest, report.dest_chain_id);
        eth_abi::encode_u64(&mut digest, report.dest_chain_selector);
        eth_abi::encode_address(&mut digest, report.rmn_remote_contract_address);
        eth_abi::encode_address(&mut digest, report.off_ramp_address);
        eth_abi::encode_right_padded_bytes32(
            &mut digest, report.rmn_home_contract_config_digest
        );
        report.merkle_roots.for_each_ref(
            |merkle_root| {
                let merkle_root: &MerkleRoot = merkle_root;
                eth_abi::encode_u64(&mut digest, merkle_root.source_chain_selector);
                eth_abi::encode_bytes(&mut digest, merkle_root.on_ramp_address);
                eth_abi::encode_u64(&mut digest, merkle_root.min_seq_nr);
                eth_abi::encode_u64(&mut digest, merkle_root.max_seq_nr);
                eth_abi::encode_right_padded_bytes32(
                    &mut digest, merkle_root.merkle_root
                );
            }
        );
        aptos_hash::keccak256(digest)
    }

    #[view]
    public fun verify(
        off_ramp_address: address,
        merkle_root_source_chain_selectors: vector<u64>,
        merkle_root_on_ramp_addresses: vector<vector<u8>>,
        merkle_root_min_seq_nrs: vector<u64>,
        merkle_root_max_seq_nrs: vector<u64>,
        merkle_root_values: vector<vector<u8>>,
        signatures: vector<vector<u8>>
    ): bool acquires RMNRemoteState {
        let state = borrow_state();

        assert!(state.config_count > 0, error::invalid_argument(E_CONFIG_NOT_SET));

        let signatures_len = signatures.length();
        assert!(
            signatures_len >= (state.config.f_sign + 1),
            error::invalid_argument(E_THRESHOLD_NOT_MET)
        );

        let merkle_root_len = merkle_root_source_chain_selectors.length();
        assert!(
            merkle_root_len == merkle_root_on_ramp_addresses.length(),
            error::invalid_argument(E_MERKLE_ROOT_LENGTH_MISMATCH)
        );
        assert!(
            merkle_root_len == merkle_root_min_seq_nrs.length(),
            error::invalid_argument(E_MERKLE_ROOT_LENGTH_MISMATCH)
        );
        assert!(
            merkle_root_len == merkle_root_max_seq_nrs.length(),
            error::invalid_argument(E_MERKLE_ROOT_LENGTH_MISMATCH)
        );
        assert!(
            merkle_root_len == merkle_root_values.length(),
            error::invalid_argument(E_MERKLE_ROOT_LENGTH_MISMATCH)
        );

        // Since we cannot pass structs, we need to reconstruct it from the individual components.
        let merkle_roots = vector[];
        for (i in 0..merkle_root_len) {
            let source_chain_selector = merkle_root_source_chain_selectors[i];
            let on_ramp_address = merkle_root_on_ramp_addresses[i];
            let min_seq_nr = merkle_root_min_seq_nrs[i];
            let max_seq_nr = merkle_root_max_seq_nrs[i];
            let merkle_root = merkle_root_values[i];
            merkle_roots.push_back(
                MerkleRoot {
                    source_chain_selector,
                    on_ramp_address,
                    min_seq_nr,
                    max_seq_nr,
                    merkle_root
                }
            );
        };

        let report = Report {
            dest_chain_id: (chain_id::get() as u64),
            dest_chain_selector: state.local_chain_selector,
            rmn_remote_contract_address: @ccip,
            off_ramp_address,
            rmn_home_contract_config_digest: state.config.rmn_home_contract_config_digest,
            merkle_roots
        };

        let digest = calculate_digest(&report);

        let previous_eth_address = vector[];
        for (i in 0..signatures_len) {
            let signature_bytes = signatures[i];
            let signature = secp256k1::ecdsa_signature_from_bytes(signature_bytes);

            // rmn only generates signatures with v = 27, subtract the ethereum recover id offset of 27 to get zero.
            let v = 0;
            let maybe_public_key = secp256k1::ecdsa_recover(digest, v, &signature);
            assert!(
                maybe_public_key.is_some(),
                error::invalid_argument(E_INVALID_SIGNATURE)
            );

            let public_key_bytes =
                secp256k1::ecdsa_raw_public_key_to_bytes(&maybe_public_key.extract());
            // trim the first 12 bytes of the hash to recover the ethereum address.
            let eth_address = aptos_hash::keccak256(public_key_bytes).trim(12);

            assert!(
                state.signers.contains(eth_address),
                error::invalid_argument(E_UNEXPECTED_SIGNER)
            );
            if (i > 0) {
                assert!(
                    merkle_proof::vector_u8_gt(&eth_address, &previous_eth_address),
                    error::invalid_argument(E_OUT_OF_ORDER_SIGNATURES)
                );
            };
            previous_eth_address = eth_address;
        };

        true
    }

    #[view]
    public fun get_arm(): address {
        @ccip
    }

    public entry fun set_config(
        caller: &signer,
        rmn_home_contract_config_digest: vector<u8>,
        signer_onchain_public_keys: vector<vector<u8>>,
        node_indexes: vector<u64>,
        f_sign: u64
    ) acquires RMNRemoteState {
        auth::assert_only_owner(signer::address_of(caller));

        let state = borrow_state_mut();

        assert!(
            rmn_home_contract_config_digest.length() == 32,
            error::invalid_argument(E_INVALID_DIGEST_LENGTH)
        );

        assert!(
            eth_abi::decode_u256_value(rmn_home_contract_config_digest) != 0,
            error::invalid_argument(E_ZERO_VALUE_NOT_ALLOWED)
        );

        let signers_len = signer_onchain_public_keys.length();
        assert!(
            signers_len == node_indexes.length(),
            error::invalid_argument(E_SIGNERS_MISMATCH)
        );

        for (i in 1..signers_len) {
            let previous_node_index = node_indexes[i - 1];
            let current_node_index = node_indexes[i];
            assert!(
                previous_node_index < current_node_index,
                error::invalid_argument(E_INVALID_SIGNER_ORDER)
            );
        };

        assert!(
            signers_len >= (2 * f_sign + 1),
            error::invalid_argument(E_NOT_ENOUGH_SIGNERS)
        );

        state.signers.clear();

        let signers =
            signer_onchain_public_keys.zip_map_ref(
                &node_indexes,
                |signer_public_key_bytes, node_indexes| {
                    let signer_public_key_bytes: vector<u8> = *signer_public_key_bytes;
                    let node_index: u64 = *node_indexes;
                    // expect an ethereum address of 20 bytes.
                    assert!(
                        signer_public_key_bytes.length() == 20,
                        error::invalid_argument(E_INVALID_PUBLIC_KEY_LENGTH)
                    );
                    assert!(
                        !state.signers.contains(signer_public_key_bytes),
                        error::invalid_argument(E_DUPLICATE_SIGNER)
                    );
                    state.signers.add(signer_public_key_bytes, true);
                    Signer {
                        onchain_public_key: signer_public_key_bytes,
                        node_index
                    }
                }
            );

        let new_config = Config {
            rmn_home_contract_config_digest,
            signers,
            f_sign
        };
        state.config = new_config;

        let new_config_count = state.config_count + 1;
        state.config_count = new_config_count;

        event::emit_event(
            &mut state.config_set_events,
            ConfigSet { version: new_config_count, config: new_config }
        );
    }

    #[view]
    public fun get_versioned_config(): (u32, Config) acquires RMNRemoteState {
        let state = borrow_state();
        (state.config_count, state.config)
    }

    #[view]
    public fun get_local_chain_selector(): u64 acquires RMNRemoteState {
        borrow_state().local_chain_selector
    }

    #[view]
    public fun get_report_digest_header(): vector<u8> {
        aptos_hash::keccak256(b"RMN_V1_6_ANY2APTOS_REPORT")
    }

    public entry fun curse(
        caller: &signer, subject: vector<u8>
    ) acquires RMNRemoteState, AllowedCursersV2 {
        curse_multiple(caller, vector[subject]);
    }

    public entry fun curse_multiple(
        caller: &signer, subjects: vector<vector<u8>>
    ) acquires RMNRemoteState, AllowedCursersV2 {
        assert_owner_or_allowed_curser(signer::address_of(caller));

        let state = borrow_state_mut();

        subjects.for_each_ref(
            |subject| {
                let subject: vector<u8> = *subject;
                assert!(
                    subject.length() == 16,
                    error::invalid_argument(E_INVALID_SUBJECT_LENGTH)
                );
                assert!(
                    !state.cursed_subjects.contains(subject),
                    error::invalid_argument(E_ALREADY_CURSED)
                );
                state.cursed_subjects.add(subject, true);
            }
        );
        event::emit_event(&mut state.cursed_events, Cursed { subjects });
    }

    public entry fun uncurse(
        caller: &signer, subject: vector<u8>
    ) acquires RMNRemoteState, AllowedCursersV2 {
        uncurse_multiple(caller, vector[subject]);
    }

    public entry fun uncurse_multiple(
        caller: &signer, subjects: vector<vector<u8>>
    ) acquires RMNRemoteState, AllowedCursersV2 {
        assert_owner_or_allowed_curser(signer::address_of(caller));

        let state = borrow_state_mut();

        subjects.for_each_ref(
            |subject| {
                let subject: vector<u8> = *subject;
                assert!(
                    state.cursed_subjects.contains(subject),
                    error::invalid_argument(E_NOT_CURSED)
                );
                state.cursed_subjects.remove(subject);
            }
        );
        event::emit_event(&mut state.uncursed_events, Uncursed { subjects });
    }

    #[view]
    public fun get_cursed_subjects(): vector<vector<u8>> acquires RMNRemoteState {
        borrow_state().cursed_subjects.keys()
    }

    #[view]
    public fun is_cursed_global(): bool acquires RMNRemoteState {
        borrow_state().cursed_subjects.contains(GLOBAL_CURSE_SUBJECT)
    }

    #[view]
    public fun is_cursed(subject: vector<u8>): bool acquires RMNRemoteState {
        borrow_state().cursed_subjects.contains(subject) || is_cursed_global()
    }

    #[view]
    public fun is_cursed_u128(subject_value: u128): bool acquires RMNRemoteState {
        let subject = bcs::to_bytes(&subject_value);
        subject.reverse();
        is_cursed(subject)
    }

    inline fun borrow_state(): &RMNRemoteState {
        borrow_global<RMNRemoteState>(state_object::object_address())
    }

    inline fun borrow_state_mut(): &mut RMNRemoteState {
        borrow_global_mut<RMNRemoteState>(state_object::object_address())
    }

    // ================================================================
    // |              AllowedCursersV2 Helper Functions                |
    // ================================================================
    inline fun borrow_allowed_cursers_v2(): &AllowedCursersV2 {
        borrow_global<AllowedCursersV2>(state_object::object_address())
    }

    inline fun borrow_allowed_cursers_v2_mut(): &mut AllowedCursersV2 {
        borrow_global_mut<AllowedCursersV2>(state_object::object_address())
    }

    #[view]
    /// Check if an address is an allowed curser.
    /// Returns false if AllowedCursersV2 is not initialized (V1 behavior: only owner can curse).
    public fun is_allowed_curser(curser: address): bool acquires AllowedCursersV2 {
        if (!exists<AllowedCursersV2>(state_object::object_address())) { false }
        else {
            borrow_allowed_cursers_v2().allowed_cursers.contains(&curser)
        }
    }

    #[view]
    /// Get the list of allowed cursers.
    /// Returns empty vector if AllowedCursersV2 is not initialized.
    public fun get_allowed_cursers(): vector<address> acquires AllowedCursersV2 {
        if (!exists<AllowedCursersV2>(state_object::object_address())) {
            vector[]
        } else {
            borrow_allowed_cursers_v2().allowed_cursers.keys()
        }
    }

    inline fun assert_owner_or_allowed_curser(caller: address) {
        assert!(
            caller == auth::owner() || is_allowed_curser(caller),
            error::permission_denied(E_NOT_OWNER_OR_ALLOWED_CURSER)
        );
    }

    // ================================================================
    // |           AllowedCursersV2 Admin Functions (Owner Only)       |
    // ================================================================

    /// Initialize the AllowedCursersV2 resource. Owner only.
    /// This must be called before adding allowed cursers.
    public entry fun initialize_allowed_cursers_v2(
        caller: &signer, initial_cursers: vector<address>
    ) {
        auth::assert_only_owner(signer::address_of(caller));

        assert!(
            !exists<AllowedCursersV2>(state_object::object_address()),
            error::already_exists(E_ALLOWED_CURSERS_V2_ALREADY_INITIALIZED)
        );

        let state_object_signer = state_object::object_signer();
        let allowed_cursers = ordered_map::new();

        initial_cursers.for_each_ref(
            |curser| {
                allowed_cursers.add(*curser, true);
            }
        );

        move_to(
            &state_object_signer,
            AllowedCursersV2 {
                allowed_cursers,
                allowed_cursers_added_events: account::new_event_handle(
                    &state_object_signer
                ),
                allowed_cursers_removed_events: account::new_event_handle(
                    &state_object_signer
                )
            }
        );

        if (!initial_cursers.is_empty()) {
            event::emit(AllowedCursersAdded { cursers: initial_cursers });
        };
    }

    /// Add allowed cursers. Owner only.
    /// AllowedCursersV2 must be initialized first.
    public entry fun add_allowed_cursers(
        caller: &signer, cursers_to_add: vector<address>
    ) acquires AllowedCursersV2 {
        auth::assert_only_owner(signer::address_of(caller));

        assert!(
            exists<AllowedCursersV2>(state_object::object_address()),
            error::invalid_state(E_ALLOWED_CURSERS_V2_NOT_INITIALIZED)
        );

        let state = borrow_allowed_cursers_v2_mut();

        cursers_to_add.for_each_ref(
            |curser| {
                assert!(
                    !state.allowed_cursers.contains(curser),
                    error::already_exists(E_CURSER_ALREADY_ALLOWED)
                );
                state.allowed_cursers.add(*curser, true);
            }
        );

        event::emit_event(
            &mut state.allowed_cursers_added_events,
            AllowedCursersAdded { cursers: cursers_to_add }
        );
    }

    /// Remove allowed cursers. Owner only.
    /// AllowedCursersV2 must be initialized first.
    public entry fun remove_allowed_cursers(
        caller: &signer, cursers_to_remove: vector<address>
    ) acquires AllowedCursersV2 {
        auth::assert_only_owner(signer::address_of(caller));

        assert!(
            exists<AllowedCursersV2>(state_object::object_address()),
            error::invalid_state(E_ALLOWED_CURSERS_V2_NOT_INITIALIZED)
        );

        let state = borrow_allowed_cursers_v2_mut();

        cursers_to_remove.for_each_ref(
            |curser| {
                assert!(
                    state.allowed_cursers.contains(curser),
                    error::not_found(E_CURSER_NOT_ALLOWED)
                );
                state.allowed_cursers.remove(curser);
            }
        );

        event::emit_event(
            &mut state.allowed_cursers_removed_events,
            AllowedCursersRemoved { cursers: cursers_to_remove }
        );
    }

    // ================================================================
    // |                      MCMS Entrypoint                         |
    // ================================================================
    struct McmsCallback has drop {}

    public fun mcms_entrypoint<T: key>(
        _metadata: object::Object<T>
    ): option::Option<u128> acquires RMNRemoteState, AllowedCursersV2 {
        let (caller, function, data) =
            mcms_registry::get_callback_params(@ccip, McmsCallback {});

        let function_bytes = *function.bytes();
        let stream = bcs_stream::new(data);

        if (function_bytes == b"initialize") {
            let local_chain_selector = bcs_stream::deserialize_u64(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            initialize(&caller, local_chain_selector);
        } else if (function_bytes == b"set_config") {
            let rmn_home_contract_config_digest =
                bcs_stream::deserialize_vector_u8(&mut stream);
            let signer_onchain_public_keys =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_vector_u8(stream)
                );
            let node_indexes =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_u64(stream)
                );
            let f_sign = bcs_stream::deserialize_u64(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            set_config(
                &caller,
                rmn_home_contract_config_digest,
                signer_onchain_public_keys,
                node_indexes,
                f_sign
            )
        } else if (function_bytes == b"curse") {
            let subject = bcs_stream::deserialize_vector_u8(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            curse(&caller, subject)
        } else if (function_bytes == b"curse_multiple") {
            let subjects =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_vector_u8(stream)
                );
            bcs_stream::assert_is_consumed(&stream);
            curse_multiple(&caller, subjects)
        } else if (function_bytes == b"uncurse") {
            let subject = bcs_stream::deserialize_vector_u8(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            uncurse(&caller, subject)
        } else if (function_bytes == b"uncurse_multiple") {
            let subjects =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_vector_u8(stream)
                );
            bcs_stream::assert_is_consumed(&stream);
            uncurse_multiple(&caller, subjects)
        } else if (function_bytes == b"initialize_allowed_cursers_v2") {
            let initial_cursers =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_address(stream)
                );
            bcs_stream::assert_is_consumed(&stream);
            initialize_allowed_cursers_v2(&caller, initial_cursers)
        } else if (function_bytes == b"add_allowed_cursers") {
            let cursers_to_add =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_address(stream)
                );
            bcs_stream::assert_is_consumed(&stream);
            add_allowed_cursers(&caller, cursers_to_add)
        } else if (function_bytes == b"remove_allowed_cursers") {
            let cursers_to_remove =
                bcs_stream::deserialize_vector(
                    &mut stream, |stream| bcs_stream::deserialize_address(stream)
                );
            bcs_stream::assert_is_consumed(&stream);
            remove_allowed_cursers(&caller, cursers_to_remove)
        } else {
            abort error::invalid_argument(E_UNKNOWN_FUNCTION)
        };

        option::none()
    }

    /// Callable during upgrades
    public(friend) fun register_mcms_entrypoint(publisher: &signer) {
        mcms_registry::register_entrypoint(
            publisher, string::utf8(b"rmn_remote"), McmsCallback {}
        );
    }
}
`

/** sources/state_object.move */
export const CCIP_STATE_OBJECT_MOVE = `/// This module creates a single object for storing CCIP state resources in order to:
///
/// - simplify ownership management
/// - simplify observability: all resources and events can be queried and viewed at a single address
/// - decouple module deployment and initialization: the CCIP module will be deployed using the
///   recommended object code deployment approach, but initialization requires various
///   "constructor" parameters that cannot be passed it at deploy (ie. init_module()) time.
///   Object code deployment only allows for publishing and upgrading modules, with no way to
///   retrieve a signer to store resources (see: 0x1::object_code_deployment), so a different
///   object is necessary.
module ccip::state_object {
    use std::account;
    use std::error;
    use std::object::{Self, ExtendRef, TransferRef};
    use std::signer;

    friend ccip::auth;
    friend ccip::fee_quoter;
    friend ccip::nonce_manager;
    friend ccip::receiver_registry;
    friend ccip::rmn_remote;
    friend ccip::token_admin_registry;

    struct StateObjectRefs has key {
        extend_ref: ExtendRef,
        transfer_ref: TransferRef
    }

    const E_NOT_OBJECT_DEPLOYMENT: u64 = 1;

    fun init_module(publisher: &signer) {
        assert!(
            object::is_object(signer::address_of(publisher)),
            error::invalid_state(E_NOT_OBJECT_DEPLOYMENT)
        );

        init_module_internal(publisher);
    }

    inline fun init_module_internal(publisher: &signer) {
        let constructor_ref = object::create_named_object(publisher, b"CCIPStateObject");

        let extend_ref = object::generate_extend_ref(&constructor_ref);
        let transfer_ref = object::generate_transfer_ref(&constructor_ref);
        let object_signer = object::generate_signer(&constructor_ref);

        // create an Account on the object for event handles.
        account::create_account_if_does_not_exist(
            object::address_from_constructor_ref(&constructor_ref)
        );

        move_to(&object_signer, StateObjectRefs { extend_ref, transfer_ref });
    }

    #[view]
    public fun get_object_address(): address {
        object_address()
    }

    public(friend) inline fun object_address(): address {
        // hard code the object seed directly in order to keep the function inline.
        object::create_object_address(&@ccip, b"CCIPStateObject")
    }

    public(friend) fun object_signer(): signer acquires StateObjectRefs {
        let store = borrow_global<StateObjectRefs>(object_address());
        object::generate_signer_for_extending(&store.extend_ref)
    }

    #[test_only]
    public fun init_module_for_testing(publisher: &signer) {
        init_module_internal(publisher);
    }
}
`

/** sources/token_admin_dispatcher.move */
export const CCIP_TOKEN_ADMIN_DISPATCHER_MOVE = `module ccip::token_admin_dispatcher {
    use std::dispatchable_fungible_asset;
    use std::fungible_asset::FungibleAsset;
    use std::signer;

    use ccip::auth;
    use ccip::token_admin_registry;

    public fun dispatch_lock_or_burn(
        caller: &signer,
        token_pool_address: address,
        fa: FungibleAsset,
        sender: address,
        remote_chain_selector: u64,
        receiver: vector<u8>
    ): (vector<u8>, vector<u8>) {
        auth::assert_is_allowed_onramp(signer::address_of(caller));

        if (token_admin_registry::has_token_pool_registration_v2(token_pool_address)) {
            token_admin_registry::lock_or_burn_v2(
                token_pool_address,
                fa,
                sender,
                remote_chain_selector,
                receiver
            )
        } else {
            let dispatch_fungible_store =
                token_admin_registry::start_lock_or_burn(
                    token_pool_address,
                    sender,
                    remote_chain_selector,
                    receiver
                );

            dispatchable_fungible_asset::deposit(dispatch_fungible_store, fa);

            token_admin_registry::finish_lock_or_burn(token_pool_address)
        }
    }

    public fun dispatch_release_or_mint(
        caller: &signer,
        token_pool_address: address,
        sender: vector<u8>,
        receiver: address,
        source_amount: u256,
        local_token: address,
        remote_chain_selector: u64,
        source_pool_address: vector<u8>,
        source_pool_data: vector<u8>,
        offchain_token_data: vector<u8>
    ): (FungibleAsset, u64) {
        auth::assert_is_allowed_offramp(signer::address_of(caller));

        if (token_admin_registry::has_token_pool_registration_v2(token_pool_address)) {
            token_admin_registry::release_or_mint_v2(
                token_pool_address,
                sender,
                receiver,
                source_amount,
                local_token,
                remote_chain_selector,
                source_pool_address,
                source_pool_data,
                offchain_token_data
            )
        } else {
            let (dispatch_owner, dispatch_fungible_store) =
                token_admin_registry::start_release_or_mint(
                    token_pool_address,
                    sender,
                    receiver,
                    source_amount,
                    local_token,
                    remote_chain_selector,
                    source_pool_address,
                    source_pool_data,
                    offchain_token_data
                );

            let fa =
                dispatchable_fungible_asset::withdraw(
                    &dispatch_owner, dispatch_fungible_store, 0
                );

            let destination_amount =
                token_admin_registry::finish_release_or_mint(token_pool_address);

            (fa, destination_amount)
        }
    }
}
`

/** sources/token_admin_registry.move */
export const CCIP_TOKEN_ADMIN_REGISTRY_MOVE = `module ccip::token_admin_registry {
    use std::account;
    use std::dispatchable_fungible_asset;
    use std::error;
    use std::event::{Self, EventHandle};
    use std::function_info::{Self, FunctionInfo};
    use std::fungible_asset::{Self, Metadata, FungibleStore, FungibleAsset};
    use std::object::{Self, Object, ExtendRef, TransferRef};
    use std::option::{Self, Option};
    use std::signer;
    use std::big_ordered_map::{Self, BigOrderedMap};
    use std::string::{Self, String};
    use std::type_info::{Self, TypeInfo};

    use ccip::auth;
    use ccip::state_object;

    use mcms::bcs_stream;
    use mcms::mcms_registry;

    friend ccip::token_admin_dispatcher;

    enum ExecutionState has store, drop, copy {
        IDLE,
        LOCK_OR_BURN,
        RELEASE_OR_MINT
    }

    struct TokenAdminRegistryState has key, store {
        extend_ref: ExtendRef,
        transfer_ref: TransferRef,

        // fungible asset metadata address -> TokenConfig
        token_configs: BigOrderedMap<address, TokenConfig>,
        pool_set_events: EventHandle<PoolSet>,
        administrator_transfer_requested_events: EventHandle<AdministratorTransferRequested>,
        administrator_transferred_events: EventHandle<AdministratorTransferred>,
        token_unregistered_events: EventHandle<TokenUnregistered>
    }

    struct TokenConfig has store, drop, copy {
        token_pool_address: address,
        administrator: address,
        pending_administrator: address
    }

    struct TokenPoolRegistration has key, store {
        lock_or_burn_function: FunctionInfo,
        release_or_mint_function: FunctionInfo,
        proof_typeinfo: TypeInfo,
        dispatch_metadata: Object<Metadata>,
        dispatch_deposit_fungible_store: Object<FungibleStore>,
        dispatch_extend_ref: ExtendRef,
        dispatch_transfer_ref: TransferRef,
        dispatch_fa_transfer_ref: fungible_asset::TransferRef,
        execution_state: ExecutionState,
        executing_lock_or_burn_input_v1: Option<LockOrBurnInputV1>,
        executing_release_or_mint_input_v1: Option<ReleaseOrMintInputV1>,
        executing_lock_or_burn_output_v1: Option<LockOrBurnOutputV1>,
        executing_release_or_mint_output_v1: Option<ReleaseOrMintOutputV1>,
        local_token: address
    }

    struct LockOrBurnInputV1 has store, drop {
        sender: address,
        remote_chain_selector: u64,
        receiver: vector<u8>
    }

    struct LockOrBurnOutputV1 has store, drop {
        dest_token_address: vector<u8>,
        dest_pool_data: vector<u8>
    }

    struct ReleaseOrMintInputV1 has store, drop {
        sender: vector<u8>,
        receiver: address,
        source_amount: u256,
        local_token: address,
        remote_chain_selector: u64,
        source_pool_address: vector<u8>,
        source_pool_data: vector<u8>,
        offchain_token_data: vector<u8>
    }

    struct ReleaseOrMintOutputV1 has store, drop {
        destination_amount: u64
    }

    struct TokenPoolCallbacks has copy, drop, store {
        lock_or_burn: |FungibleAsset, LockOrBurnInputV1| (vector<u8>, vector<u8>),
        release_or_mint: |ReleaseOrMintInputV1| (FungibleAsset, u64)
    }

    struct TokenPoolRegistrationV2 has key {
        callbacks: TokenPoolCallbacks,
        local_token: address
    }

    #[event]
    struct PoolSet has store, drop {
        local_token: address,
        previous_pool_address: address,
        new_pool_address: address
    }

    #[event]
    struct AdministratorTransferRequested has store, drop {
        local_token: address,
        current_admin: address,
        new_admin: address
    }

    #[event]
    struct AdministratorTransferred has store, drop {
        local_token: address,
        new_admin: address
    }

    #[event]
    struct TokenUnregistered has store, drop {
        local_token: address,
        previous_pool_address: address
    }

    const E_INVALID_FUNGIBLE_ASSET: u64 = 1;
    const E_NOT_FUNGIBLE_ASSET_OWNER: u64 = 2;
    const E_INVALID_TOKEN_POOL: u64 = 3;
    const E_ALREADY_REGISTERED: u64 = 4;
    const E_UNKNOWN_FUNCTION: u64 = 5;
    const E_PROOF_NOT_IN_TOKEN_POOL_MODULE: u64 = 6;
    const E_PROOF_NOT_AT_TOKEN_POOL_ADDRESS: u64 = 7;
    const E_UNKNOWN_PROOF_TYPE: u64 = 8;
    const E_NOT_IN_IDLE_STATE: u64 = 9;
    const E_NOT_IN_LOCK_OR_BURN_STATE: u64 = 10;
    const E_NOT_IN_RELEASE_OR_MINT_STATE: u64 = 11;
    const E_NON_EMPTY_LOCK_OR_BURN_INPUT: u64 = 12;
    const E_NON_EMPTY_LOCK_OR_BURN_OUTPUT: u64 = 13;
    const E_NON_EMPTY_RELEASE_OR_MINT_INPUT: u64 = 14;
    const E_NON_EMPTY_RELEASE_OR_MINT_OUTPUT: u64 = 15;
    const E_MISSING_LOCK_OR_BURN_INPUT: u64 = 16;
    const E_MISSING_LOCK_OR_BURN_OUTPUT: u64 = 17;
    const E_MISSING_RELEASE_OR_MINT_INPUT: u64 = 18;
    const E_MISSING_RELEASE_OR_MINT_OUTPUT: u64 = 19;
    const E_TOKEN_POOL_NOT_OBJECT: u64 = 20;
    const E_ADMIN_FOR_TOKEN_ALREADY_SET: u64 = 21;
    const E_FUNGIBLE_ASSET_NOT_REGISTERED: u64 = 22;
    const E_NOT_ADMINISTRATOR: u64 = 23;
    const E_NOT_PENDING_ADMINISTRATOR: u64 = 24;
    const E_NOT_AUTHORIZED: u64 = 25;
    const E_INVALID_TOKEN_FOR_POOL: u64 = 26;
    const E_ADMIN_NOT_SET_FOR_TOKEN: u64 = 27;
    const E_ADMIN_ALREADY_SET_FOR_TOKEN: u64 = 28;
    const E_ZERO_ADDRESS: u64 = 29;
    const E_POOL_NOT_REGISTERED: u64 = 30;
    const E_TOKEN_MISMATCH: u64 = 31;

    #[view]
    public fun type_and_version(): String {
        string::utf8(b"TokenAdminRegistry 1.6.0")
    }

    fun init_module(publisher: &signer) {
        // Register the entrypoint with mcms
        if (@mcms_register_entrypoints == @0x1) {
            register_mcms_entrypoint(publisher);
        };

        let state_object_signer = state_object::object_signer();

        let constructor_ref =
            object::create_named_object(
                &state_object_signer, b"CCIPTokenAdminRegistry"
            );
        let extend_ref = object::generate_extend_ref(&constructor_ref);
        let transfer_ref = object::generate_transfer_ref(&constructor_ref);

        let state = TokenAdminRegistryState {
            extend_ref,
            transfer_ref,
            token_configs: big_ordered_map::new(),
            pool_set_events: account::new_event_handle(&state_object_signer),
            administrator_transfer_requested_events: account::new_event_handle(
                &state_object_signer
            ),
            administrator_transferred_events: account::new_event_handle(
                &state_object_signer
            ),
            token_unregistered_events: account::new_event_handle(&state_object_signer)
        };

        move_to(&state_object_signer, state);
    }

    #[view]
    public fun get_pools(
        local_tokens: vector<address>
    ): vector<address> acquires TokenAdminRegistryState {
        let state = borrow_state();

        local_tokens.map_ref(
            |local_token| {
                let local_token: address = *local_token;
                if (state.token_configs.contains(&local_token)) {
                    let token_config = state.token_configs.borrow(&local_token);
                    token_config.token_pool_address
                } else {
                    // returns @0x0 for assets without token pools.
                    @0x0
                }
            }
        )
    }

    #[view]
    /// returns the token pool address for the given local token, or @0x0 if the token is not registered.
    public fun get_pool(local_token: address): address acquires TokenAdminRegistryState {
        let state = borrow_state();
        if (state.token_configs.contains(&local_token)) {
            let token_config = state.token_configs.borrow(&local_token);
            token_config.token_pool_address
        } else {
            // returns @0x0 for assets without token pools.
            @0x0
        }
    }

    #[view]
    /// Returns the local token address for the token pool (supports both V1 and V2).
    public fun get_pool_local_token(
        token_pool_address: address
    ): address acquires TokenPoolRegistration, TokenPoolRegistrationV2 {
        if (exists<TokenPoolRegistrationV2>(token_pool_address)) {
            TokenPoolRegistrationV2[token_pool_address].local_token
        } else if (exists<TokenPoolRegistration>(token_pool_address)) {
            get_registration(token_pool_address).local_token
        } else {
            abort error::invalid_argument(E_POOL_NOT_REGISTERED)
        }
    }

    #[view]
    /// Returns the local token address for the token pool.
    public fun get_pool_local_token_v2(
        token_pool_address: address
    ): address acquires TokenPoolRegistrationV2 {
        TokenPoolRegistrationV2[token_pool_address].local_token
    }

    #[view]
    /// Returns true if token pool has TokenPoolRegistrationV2 resource
    public fun has_token_pool_registration_v2(
        token_pool_address: address
    ): bool {
        exists<TokenPoolRegistrationV2>(token_pool_address)
    }

    #[view]
    /// returns (token_pool_address, administrator, pending_administrator)
    public fun get_token_config(
        local_token: address
    ): (address, address, address) acquires TokenAdminRegistryState {
        let state = borrow_state();
        if (state.token_configs.contains(&local_token)) {
            let token_config = state.token_configs.borrow(&local_token);
            (
                token_config.token_pool_address,
                token_config.administrator,
                token_config.pending_administrator
            )
        } else {
            (@0x0, @0x0, @0x0)
        }
    }

    #[view]
    /// Get configured tokens paginated using a start key and limit.
    /// Caller should call this on a certain block to ensure you the same state for every call.
    ///
    /// This function retrieves a batch of token addresses from the registry, starting from
    /// the token address that comes after the provided start_key.
    ///
    /// @param start_key - Address to start pagination from (returns tokens AFTER this address)
    /// @param max_count - Maximum number of tokens to return
    ///
    /// @return:
    ///   - vector<address>: List of token addresses (up to max_count)
    ///   - address: Next key to use for pagination (pass this as start_key in next call)
    ///   - bool: Whether there are more tokens after this batch
    public fun get_all_configured_tokens(
        start_key: address, max_count: u64
    ): (vector<address>, address, bool) acquires TokenAdminRegistryState {
        let token_configs = &borrow_state().token_configs;
        let result = vector[];

        let current_key_opt = token_configs.next_key(&start_key);
        if (max_count == 0 || current_key_opt.is_none()) {
            return (result, start_key, current_key_opt.is_some())
        };

        let current_key = *current_key_opt.borrow();

        result.push_back(current_key);

        if (max_count == 1) {
            let has_more = token_configs.next_key(&current_key).is_some();
            return (result, current_key, has_more);
        };

        for (i in 1..max_count) {
            let next_key_opt = token_configs.next_key(&current_key);
            if (next_key_opt.is_none()) {
                return (result, current_key, false)
            };

            current_key = *next_key_opt.borrow();
            result.push_back(current_key);
        };

        // Check if there are more tokens after the last key
        let has_more = token_configs.next_key(&current_key).is_some();
        (result, current_key, has_more)
    }

    // ================================================================
    // |                       Register Pool                          |
    // ================================================================
    #[deprecated]
    /// @deprecated: Use \`register_pool_v2()\` instead.
    ///
    /// Registers pool with \`TokenPoolRegistration\` and sets up dynamic dispatch for a token pool
    /// Registry token config mapping must be done separately via \`set_pool()\`
    /// by token owner or ccip owner.
    public fun register_pool<ProofType: drop>(
        token_pool_account: &signer,
        token_pool_module_name: vector<u8>,
        local_token: address,
        _proof: ProofType
    ) acquires TokenAdminRegistryState {
        let token_pool_address = signer::address_of(token_pool_account);
        assert!(
            !exists<TokenPoolRegistration>(token_pool_address)
                && !exists<TokenPoolRegistrationV2>(token_pool_address),
            error::invalid_argument(E_ALREADY_REGISTERED)
        );
        assert!(
            object::object_exists<Metadata>(local_token),
            error::invalid_argument(E_INVALID_FUNGIBLE_ASSET)
        );

        let state = borrow_state_mut();

        let lock_or_burn_function =
            function_info::new_function_info(
                token_pool_account,
                string::utf8(token_pool_module_name),
                string::utf8(b"lock_or_burn")
            );
        let proof_typeinfo = type_info::type_of<ProofType>();
        assert!(
            proof_typeinfo.account_address() == token_pool_address,
            error::invalid_argument(E_PROOF_NOT_AT_TOKEN_POOL_ADDRESS)
        );
        assert!(
            proof_typeinfo.module_name() == token_pool_module_name,
            error::invalid_argument(E_PROOF_NOT_IN_TOKEN_POOL_MODULE)
        );

        let release_or_mint_function =
            function_info::new_function_info(
                token_pool_account,
                string::utf8(token_pool_module_name),
                string::utf8(b"release_or_mint")
            );

        let dispatch_constructor_ref =
            object::create_sticky_object(
                object::address_from_extend_ref(&state.extend_ref)
            );
        let dispatch_extend_ref = object::generate_extend_ref(&dispatch_constructor_ref);
        let dispatch_transfer_ref =
            object::generate_transfer_ref(&dispatch_constructor_ref);

        let dispatch_metadata =
            fungible_asset::add_fungibility(
                &dispatch_constructor_ref,
                option::none(),
                // max name length is 32 chars
                string::utf8(b"CCIPTokenAdminRegistry"),
                // max symbol length is 10 chars
                string::utf8(b"CCIPTAR"),
                0,
                string::utf8(b""),
                string::utf8(b"")
            );

        let dispatch_fa_transfer_ref =
            fungible_asset::generate_transfer_ref(&dispatch_constructor_ref);

        // create a FungibleStore for dispatchable_deposit(). it's valid for the FungibleStore to be on the same object
        // as the fungible asset Metadata itself.
        let dispatch_deposit_fungible_store =
            fungible_asset::create_store(&dispatch_constructor_ref, dispatch_metadata);

        dispatchable_fungible_asset::register_dispatch_functions(
            &dispatch_constructor_ref,
            /* withdraw_function= */ option::some(release_or_mint_function),
            /* deposit_function= */ option::some(lock_or_burn_function),
            /* derived_balance_function= */ option::none()
        );

        move_to(
            token_pool_account,
            TokenPoolRegistration {
                lock_or_burn_function,
                release_or_mint_function,
                proof_typeinfo,
                dispatch_metadata,
                dispatch_deposit_fungible_store,
                dispatch_extend_ref,
                dispatch_transfer_ref,
                dispatch_fa_transfer_ref,
                execution_state: ExecutionState::IDLE,
                executing_lock_or_burn_input_v1: option::none(),
                executing_release_or_mint_input_v1: option::none(),
                executing_lock_or_burn_output_v1: option::none(),
                executing_release_or_mint_output_v1: option::none(),
                local_token
            }
        );
    }

    /// Registers a V2 token pool using function-value callbacks (closures).
    ///
    /// Upgrade path: existing legacy pools can upgrade to V2 by calling this function,
    /// which supersedes the legacy registration without requiring \`unregister_pool()\`.
    /// New pools should use V2 directly. Once V2 is registered, legacy registration
    /// via \`register_pool()\` is rejected.
    public fun register_pool_v2(
        token_pool_account: &signer,
        local_token: address,
        lock_or_burn: |FungibleAsset, LockOrBurnInputV1| (vector<u8>, vector<u8>) has copy
        + drop + store,
        release_or_mint: |ReleaseOrMintInputV1| (FungibleAsset, u64) has copy + drop + store
    ) {
        let token_pool_address = signer::address_of(token_pool_account);
        assert!(
            !exists<TokenPoolRegistrationV2>(token_pool_address),
            error::invalid_argument(E_ALREADY_REGISTERED)
        );
        assert!(
            object::object_exists<Metadata>(local_token),
            error::invalid_argument(E_INVALID_FUNGIBLE_ASSET)
        );
        if (exists<TokenPoolRegistration>(token_pool_address)) {
            assert!(
                get_registration(token_pool_address).local_token == local_token,
                error::invalid_argument(E_TOKEN_MISMATCH)
            );
        };

        move_to(
            token_pool_account,
            TokenPoolRegistrationV2 {
                callbacks: TokenPoolCallbacks { lock_or_burn, release_or_mint },
                local_token
            }
        );
    }

    public entry fun unregister_pool(
        caller: &signer, local_token: address
    ) acquires TokenAdminRegistryState, TokenPoolRegistration, TokenPoolRegistrationV2 {
        let state = borrow_state_mut();
        assert!(
            state.token_configs.contains(&local_token),
            error::invalid_argument(E_FUNGIBLE_ASSET_NOT_REGISTERED)
        );

        let token_config = state.token_configs.remove(&local_token);
        assert!(
            token_config.administrator == signer::address_of(caller),
            error::permission_denied(E_NOT_ADMINISTRATOR)
        );

        let previous_pool_address = token_config.token_pool_address;
        if (exists<TokenPoolRegistration>(previous_pool_address)) {
            let TokenPoolRegistration {
                lock_or_burn_function: _,
                release_or_mint_function: _,
                proof_typeinfo: _,
                dispatch_metadata: _,
                dispatch_deposit_fungible_store: _,
                dispatch_extend_ref: _,
                dispatch_transfer_ref: _,
                dispatch_fa_transfer_ref: _,
                execution_state: _,
                executing_lock_or_burn_input_v1: _,
                executing_release_or_mint_input_v1: _,
                executing_lock_or_burn_output_v1: _,
                executing_release_or_mint_output_v1: _,
                local_token: _
            } = move_from<TokenPoolRegistration>(previous_pool_address);
        };

        if (exists<TokenPoolRegistrationV2>(previous_pool_address)) {
            let TokenPoolRegistrationV2 { callbacks: _, local_token: _ } =
                move_from<TokenPoolRegistrationV2>(previous_pool_address);
        };

        event::emit_event(
            &mut state.token_unregistered_events,
            TokenUnregistered {
                local_token,
                previous_pool_address: token_config.token_pool_address
            }
        );
    }

    public entry fun set_pool(
        caller: &signer, local_token: address, token_pool_address: address
    ) acquires TokenAdminRegistryState, TokenPoolRegistration, TokenPoolRegistrationV2 {
        assert!(
            object::object_exists<Metadata>(local_token),
            error::invalid_argument(E_INVALID_FUNGIBLE_ASSET)
        );

        let caller_addr = signer::address_of(caller);

        let pool_local_token =
            if (exists<TokenPoolRegistrationV2>(token_pool_address)) {
                get_pool_local_token_v2(token_pool_address)
            } else if (exists<TokenPoolRegistration>(token_pool_address)) {
                get_registration(token_pool_address).local_token
            } else {
                abort error::invalid_argument(E_POOL_NOT_REGISTERED)
            };

        assert!(
            pool_local_token == local_token,
            error::invalid_argument(E_INVALID_TOKEN_FOR_POOL)
        );

        let state = borrow_state_mut();
        assert!(
            state.token_configs.contains(&local_token),
            error::invalid_argument(E_ADMIN_NOT_SET_FOR_TOKEN)
        );

        let config = state.token_configs.borrow_mut(&local_token);
        assert!(
            config.administrator == caller_addr,
            error::permission_denied(E_NOT_ADMINISTRATOR)
        );

        let previous_pool_address = config.token_pool_address;
        config.token_pool_address = token_pool_address;

        if (previous_pool_address != token_pool_address) {
            event::emit_event(
                &mut state.pool_set_events,
                PoolSet {
                    local_token,
                    previous_pool_address,
                    new_pool_address: token_pool_address
                }
            );
        }
    }

    public entry fun propose_administrator(
        caller: &signer, local_token: address, administrator: address
    ) acquires TokenAdminRegistryState {
        assert!(
            object::object_exists<Metadata>(local_token),
            error::invalid_argument(E_INVALID_FUNGIBLE_ASSET)
        );

        let metadata = object::address_to_object<Metadata>(local_token);
        let caller_addr = signer::address_of(caller);

        // Allow CCIP owner or token owner to propose administrator
        assert!(
            object::owns(metadata, caller_addr) || caller_addr == auth::owner(),
            error::permission_denied(E_NOT_AUTHORIZED)
        );

        assert!(administrator != @0x0, error::invalid_argument(E_ZERO_ADDRESS));

        let state = borrow_state_mut();
        if (state.token_configs.contains(&local_token)) {
            let config = state.token_configs.borrow_mut(&local_token);
            assert!(
                config.administrator == @0x0,
                error::invalid_argument(E_ADMIN_FOR_TOKEN_ALREADY_SET)
            );
            config.pending_administrator = administrator;
        } else {
            state.token_configs.add(
                local_token,
                TokenConfig {
                    token_pool_address: @0x0,
                    administrator: @0x0,
                    pending_administrator: administrator
                }
            );
        };

        event::emit_event(
            &mut state.administrator_transfer_requested_events,
            AdministratorTransferRequested {
                local_token,
                current_admin: @0x0,
                new_admin: administrator
            }
        );
    }

    public entry fun transfer_admin_role(
        caller: &signer, local_token: address, new_admin: address
    ) acquires TokenAdminRegistryState {
        let state = borrow_state_mut();

        assert!(
            state.token_configs.contains(&local_token),
            error::invalid_argument(E_FUNGIBLE_ASSET_NOT_REGISTERED)
        );

        let token_config = state.token_configs.borrow_mut(&local_token);

        assert!(
            token_config.administrator == signer::address_of(caller),
            error::permission_denied(E_NOT_ADMINISTRATOR)
        );

        // can be @0x0 to cancel a pending transfer.
        token_config.pending_administrator = new_admin;

        event::emit_event(
            &mut state.administrator_transfer_requested_events,
            AdministratorTransferRequested {
                local_token,
                current_admin: token_config.administrator,
                new_admin
            }
        );
    }

    public entry fun accept_admin_role(
        caller: &signer, local_token: address
    ) acquires TokenAdminRegistryState {
        let state = borrow_state_mut();

        assert!(
            state.token_configs.contains(&local_token),
            error::invalid_argument(E_FUNGIBLE_ASSET_NOT_REGISTERED)
        );

        let token_config = state.token_configs.borrow_mut(&local_token);

        assert!(
            token_config.pending_administrator == signer::address_of(caller),
            error::permission_denied(E_NOT_PENDING_ADMINISTRATOR)
        );

        token_config.administrator = token_config.pending_administrator;
        token_config.pending_administrator = @0x0;

        event::emit_event(
            &mut state.administrator_transferred_events,
            AdministratorTransferred {
                local_token,
                new_admin: token_config.administrator
            }
        );
    }

    #[view]
    public fun is_administrator(
        local_token: address, administrator: address
    ): bool acquires TokenAdminRegistryState {
        let state = borrow_state();
        assert!(
            state.token_configs.contains(&local_token),
            error::invalid_argument(E_FUNGIBLE_ASSET_NOT_REGISTERED)
        );

        let token_config = state.token_configs.borrow(&local_token);
        token_config.administrator == administrator
    }

    // ================================================================
    // |                         Pool I/O V1                          |
    // ================================================================
    public fun get_lock_or_burn_input_v1<ProofType: drop>(
        token_pool_address: address, _proof: ProofType
    ): LockOrBurnInputV1 acquires TokenPoolRegistration {
        let registration = get_registration_mut(token_pool_address);

        assert!(
            type_info::type_of<ProofType>() == registration.proof_typeinfo,
            error::permission_denied(E_UNKNOWN_PROOF_TYPE)
        );

        assert!(
            registration.execution_state is ExecutionState::LOCK_OR_BURN,
            error::invalid_state(E_NOT_IN_LOCK_OR_BURN_STATE)
        );
        assert!(
            registration.executing_lock_or_burn_input_v1.is_some(),
            error::invalid_state(E_MISSING_LOCK_OR_BURN_INPUT)
        );
        assert!(
            registration.executing_lock_or_burn_output_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_LOCK_OR_BURN_OUTPUT)
        );
        assert!(
            registration.executing_release_or_mint_input_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_RELEASE_OR_MINT_INPUT)
        );
        assert!(
            registration.executing_release_or_mint_output_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_RELEASE_OR_MINT_OUTPUT)
        );

        registration.executing_lock_or_burn_input_v1.extract()
    }

    public fun set_lock_or_burn_output_v1<ProofType: drop>(
        token_pool_address: address,
        _proof: ProofType,
        dest_token_address: vector<u8>,
        dest_pool_data: vector<u8>
    ) acquires TokenPoolRegistration {
        let registration = get_registration_mut(token_pool_address);

        assert!(
            type_info::type_of<ProofType>() == registration.proof_typeinfo,
            error::permission_denied(E_UNKNOWN_PROOF_TYPE)
        );

        assert!(
            registration.execution_state is ExecutionState::LOCK_OR_BURN,
            error::invalid_state(E_NOT_IN_LOCK_OR_BURN_STATE)
        );
        assert!(
            registration.executing_lock_or_burn_input_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_LOCK_OR_BURN_INPUT)
        );
        assert!(
            registration.executing_lock_or_burn_output_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_LOCK_OR_BURN_OUTPUT)
        );
        assert!(
            registration.executing_release_or_mint_input_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_RELEASE_OR_MINT_INPUT)
        );
        assert!(
            registration.executing_release_or_mint_output_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_RELEASE_OR_MINT_OUTPUT)
        );

        registration.executing_lock_or_burn_output_v1.fill(
            LockOrBurnOutputV1 { dest_token_address, dest_pool_data }
        )
    }

    public fun get_release_or_mint_input_v1<ProofType: drop>(
        token_pool_address: address, _proof: ProofType
    ): ReleaseOrMintInputV1 acquires TokenPoolRegistration {
        let registration = get_registration_mut(token_pool_address);

        assert!(
            type_info::type_of<ProofType>() == registration.proof_typeinfo,
            error::permission_denied(E_UNKNOWN_PROOF_TYPE)
        );

        assert!(
            registration.execution_state is ExecutionState::RELEASE_OR_MINT,
            error::invalid_state(E_NOT_IN_RELEASE_OR_MINT_STATE)
        );
        assert!(
            registration.executing_release_or_mint_input_v1.is_some(),
            error::invalid_state(E_MISSING_RELEASE_OR_MINT_INPUT)
        );
        assert!(
            registration.executing_release_or_mint_output_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_RELEASE_OR_MINT_OUTPUT)
        );
        assert!(
            registration.executing_lock_or_burn_input_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_LOCK_OR_BURN_INPUT)
        );
        assert!(
            registration.executing_lock_or_burn_output_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_LOCK_OR_BURN_OUTPUT)
        );

        registration.executing_release_or_mint_input_v1.extract()
    }

    public fun set_release_or_mint_output_v1<ProofType: drop>(
        token_pool_address: address, _proof: ProofType, destination_amount: u64
    ) acquires TokenPoolRegistration {
        let registration = get_registration_mut(token_pool_address);

        assert!(
            type_info::type_of<ProofType>() == registration.proof_typeinfo,
            error::permission_denied(E_UNKNOWN_PROOF_TYPE)
        );

        assert!(
            registration.execution_state is ExecutionState::RELEASE_OR_MINT,
            error::invalid_state(E_NOT_IN_RELEASE_OR_MINT_STATE)
        );
        assert!(
            registration.executing_release_or_mint_input_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_RELEASE_OR_MINT_INPUT)
        );
        assert!(
            registration.executing_release_or_mint_output_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_RELEASE_OR_MINT_OUTPUT)
        );
        assert!(
            registration.executing_lock_or_burn_input_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_LOCK_OR_BURN_INPUT)
        );
        assert!(
            registration.executing_lock_or_burn_output_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_LOCK_OR_BURN_OUTPUT)
        );

        registration.executing_release_or_mint_output_v1.fill(
            ReleaseOrMintOutputV1 { destination_amount }
        )
    }

    // LockOrBurnInput accessors
    public fun get_lock_or_burn_sender(input: &LockOrBurnInputV1): address {
        input.sender
    }

    public fun get_lock_or_burn_remote_chain_selector(
        input: &LockOrBurnInputV1
    ): u64 {
        input.remote_chain_selector
    }

    public fun get_lock_or_burn_receiver(input: &LockOrBurnInputV1): vector<u8> {
        input.receiver
    }

    // ReleaseOrMintInput accessors
    public fun get_release_or_mint_sender(input: &ReleaseOrMintInputV1): vector<u8> {
        input.sender
    }

    public fun get_release_or_mint_receiver(
        input: &ReleaseOrMintInputV1
    ): address {
        input.receiver
    }

    public fun get_release_or_mint_source_amount(
        input: &ReleaseOrMintInputV1
    ): u256 {
        input.source_amount
    }

    public fun get_release_or_mint_local_token(
        input: &ReleaseOrMintInputV1
    ): address {
        input.local_token
    }

    public fun get_release_or_mint_remote_chain_selector(
        input: &ReleaseOrMintInputV1
    ): u64 {
        input.remote_chain_selector
    }

    public fun get_release_or_mint_source_pool_address(
        input: &ReleaseOrMintInputV1
    ): vector<u8> {
        input.source_pool_address
    }

    public fun get_release_or_mint_source_pool_data(
        input: &ReleaseOrMintInputV1
    ): vector<u8> {
        input.source_pool_data
    }

    public fun get_release_or_mint_offchain_token_data(
        input: &ReleaseOrMintInputV1
    ): vector<u8> {
        input.offchain_token_data
    }

    // ================================================================
    // |                        Lock or Burn                          |
    // ================================================================
    public(friend) fun start_lock_or_burn(
        token_pool_address: address,
        sender: address,
        remote_chain_selector: u64,
        receiver: vector<u8>
    ): Object<FungibleStore> acquires TokenPoolRegistration {
        let registration = get_registration_mut(token_pool_address);

        assert!(
            registration.execution_state is ExecutionState::IDLE,
            error::invalid_state(E_NOT_IN_IDLE_STATE)
        );
        assert!(
            registration.executing_lock_or_burn_input_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_LOCK_OR_BURN_INPUT)
        );
        assert!(
            registration.executing_lock_or_burn_output_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_LOCK_OR_BURN_OUTPUT)
        );
        assert!(
            registration.executing_release_or_mint_input_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_RELEASE_OR_MINT_INPUT)
        );
        assert!(
            registration.executing_release_or_mint_output_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_RELEASE_OR_MINT_OUTPUT)
        );

        registration.execution_state = ExecutionState::LOCK_OR_BURN;
        registration.executing_lock_or_burn_input_v1.fill(
            LockOrBurnInputV1 { sender, remote_chain_selector, receiver }
        );

        registration.dispatch_deposit_fungible_store
    }

    public(friend) fun finish_lock_or_burn(
        token_pool_address: address
    ): (vector<u8>, vector<u8>) acquires TokenPoolRegistration {
        let registration = get_registration_mut(token_pool_address);

        assert!(
            registration.execution_state is ExecutionState::LOCK_OR_BURN,
            error::invalid_state(E_NOT_IN_LOCK_OR_BURN_STATE)
        );
        assert!(
            registration.executing_lock_or_burn_input_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_LOCK_OR_BURN_INPUT)
        );
        assert!(
            registration.executing_lock_or_burn_output_v1.is_some(),
            error::invalid_state(E_MISSING_LOCK_OR_BURN_OUTPUT)
        );
        assert!(
            registration.executing_release_or_mint_input_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_RELEASE_OR_MINT_INPUT)
        );
        assert!(
            registration.executing_release_or_mint_output_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_RELEASE_OR_MINT_OUTPUT)
        );

        registration.execution_state = ExecutionState::IDLE;

        // the dispatch callback is passed a fungible_asset::TransferRef reference which could allow the store to be frozen,
        // causing future deposit/withdraw callbacks to fail. note that this fungible store is only used as part of the dispatch
        // mechanism.
        // ref: https://github.com/aptos-labs/aptos-core/blob/7fc73792e9db11462c9a42038c4a9eb41cc00192/aptos-move/framework/aptos-framework/sources/fungible_asset.move#L923
        if (fungible_asset::is_frozen(registration.dispatch_deposit_fungible_store)) {
            fungible_asset::set_frozen_flag(
                &registration.dispatch_fa_transfer_ref,
                registration.dispatch_deposit_fungible_store,
                false
            );
        };

        let output = registration.executing_lock_or_burn_output_v1.extract();
        (output.dest_token_address, output.dest_pool_data)
    }

    // ================================================================
    // |                       Release or Mint                        |
    // ================================================================
    public(friend) fun start_release_or_mint(
        token_pool_address: address,
        sender: vector<u8>,
        receiver: address,
        source_amount: u256,
        local_token: address,
        remote_chain_selector: u64,
        source_pool_address: vector<u8>,
        source_pool_data: vector<u8>,
        offchain_token_data: vector<u8>
    ): (signer, Object<FungibleStore>) acquires TokenPoolRegistration {
        let registration = get_registration_mut(token_pool_address);

        assert!(
            registration.execution_state is ExecutionState::IDLE,
            error::invalid_state(E_NOT_IN_IDLE_STATE)
        );
        assert!(
            registration.executing_release_or_mint_input_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_RELEASE_OR_MINT_INPUT)
        );
        assert!(
            registration.executing_release_or_mint_output_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_RELEASE_OR_MINT_OUTPUT)
        );
        assert!(
            registration.executing_lock_or_burn_input_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_LOCK_OR_BURN_INPUT)
        );
        assert!(
            registration.executing_lock_or_burn_output_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_LOCK_OR_BURN_OUTPUT)
        );

        registration.execution_state = ExecutionState::RELEASE_OR_MINT;
        registration.executing_release_or_mint_input_v1.fill(
            ReleaseOrMintInputV1 {
                sender,
                receiver,
                source_amount,
                local_token,
                remote_chain_selector,
                source_pool_address,
                source_pool_data,
                offchain_token_data
            }
        );

        (
            object::generate_signer_for_extending(&registration.dispatch_extend_ref),
            registration.dispatch_deposit_fungible_store
        )
    }

    public(friend) fun finish_release_or_mint(
        token_pool_address: address
    ): u64 acquires TokenPoolRegistration {
        let registration = get_registration_mut(token_pool_address);

        assert!(
            registration.execution_state is ExecutionState::RELEASE_OR_MINT,
            error::invalid_state(E_NOT_IN_RELEASE_OR_MINT_STATE)
        );
        assert!(
            registration.executing_release_or_mint_input_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_RELEASE_OR_MINT_INPUT)
        );
        assert!(
            registration.executing_release_or_mint_output_v1.is_some(),
            error::invalid_state(E_MISSING_RELEASE_OR_MINT_OUTPUT)
        );
        assert!(
            registration.executing_lock_or_burn_input_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_LOCK_OR_BURN_INPUT)
        );
        assert!(
            registration.executing_lock_or_burn_output_v1.is_none(),
            error::invalid_state(E_NON_EMPTY_LOCK_OR_BURN_OUTPUT)
        );

        registration.execution_state = ExecutionState::IDLE;

        // the dispatch callback is passed a fungible_asset::TransferRef reference which could allow the store to be frozen,
        // causing future deposit/withdraw callbacks to fail. note that this fungible store is only used as part of the dispatch
        // mechanism.
        // ref: https://github.com/aptos-labs/aptos-core/blob/7fc73792e9db11462c9a42038c4a9eb41cc00192/aptos-move/framework/aptos-framework/sources/fungible_asset.move#L936
        if (fungible_asset::is_frozen(registration.dispatch_deposit_fungible_store)) {
            fungible_asset::set_frozen_flag(
                &registration.dispatch_fa_transfer_ref,
                registration.dispatch_deposit_fungible_store,
                false
            );
        };

        let output = registration.executing_release_or_mint_output_v1.extract();

        output.destination_amount
    }

    public(friend) fun lock_or_burn_v2(
        token_pool_address: address,
        fa: fungible_asset::FungibleAsset,
        sender: address,
        remote_chain_selector: u64,
        receiver: vector<u8>
    ): (vector<u8>, vector<u8>) acquires TokenPoolRegistrationV2 {
        let pool_config = &TokenPoolRegistrationV2[token_pool_address];
        let input = LockOrBurnInputV1 { sender, remote_chain_selector, receiver };

        (pool_config.callbacks.lock_or_burn)
        (fa, input)
    }

    public(friend) fun release_or_mint_v2(
        token_pool_address: address,
        sender: vector<u8>,
        receiver: address,
        source_amount: u256,
        local_token: address,
        remote_chain_selector: u64,
        source_pool_address: vector<u8>,
        source_pool_data: vector<u8>,
        offchain_token_data: vector<u8>
    ): (FungibleAsset, u64) acquires TokenPoolRegistrationV2 {
        let pool_config = &TokenPoolRegistrationV2[token_pool_address];
        let input =
            ReleaseOrMintInputV1 {
                sender,
                receiver,
                source_amount,
                local_token,
                remote_chain_selector,
                source_pool_address,
                source_pool_data,
                offchain_token_data
            };

        (pool_config.callbacks.release_or_mint)
        (input)
    }

    inline fun borrow_state(): &TokenAdminRegistryState {
        borrow_global<TokenAdminRegistryState>(state_object::object_address())
    }

    inline fun borrow_state_mut(): &mut TokenAdminRegistryState {
        borrow_global_mut<TokenAdminRegistryState>(state_object::object_address())
    }

    inline fun get_registration(token_pool_address: address): &TokenPoolRegistration {
        freeze(get_registration_mut(token_pool_address))
    }

    inline fun get_registration_mut(token_pool_address: address)
        : &mut TokenPoolRegistration {
        assert!(
            exists<TokenPoolRegistration>(token_pool_address),
            error::invalid_argument(E_INVALID_TOKEN_POOL)
        );
        borrow_global_mut<TokenPoolRegistration>(token_pool_address)
    }

    // ================================================================
    // |                      MCMS Entrypoint                         |
    // ================================================================
    struct McmsCallback has drop {}

    public fun mcms_entrypoint<T: key>(
        _metadata: Object<T>
    ): option::Option<u128> acquires TokenAdminRegistryState, TokenPoolRegistration, TokenPoolRegistrationV2 {
        let (caller, function, data) =
            mcms_registry::get_callback_params(@ccip, McmsCallback {});

        let function_bytes = *function.bytes();
        let stream = bcs_stream::new(data);

        if (function_bytes == b"set_pool") {
            let local_token = bcs_stream::deserialize_address(&mut stream);
            let token_pool_address = bcs_stream::deserialize_address(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            set_pool(&caller, local_token, token_pool_address)
        } else if (function_bytes == b"propose_administrator") {
            let local_token = bcs_stream::deserialize_address(&mut stream);
            let administrator = bcs_stream::deserialize_address(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            propose_administrator(&caller, local_token, administrator)
        } else if (function_bytes == b"transfer_admin_role") {
            let local_token = bcs_stream::deserialize_address(&mut stream);
            let new_admin = bcs_stream::deserialize_address(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            transfer_admin_role(&caller, local_token, new_admin)
        } else if (function_bytes == b"accept_admin_role") {
            let local_token = bcs_stream::deserialize_address(&mut stream);
            bcs_stream::assert_is_consumed(&stream);
            accept_admin_role(&caller, local_token)
        } else {
            abort error::invalid_argument(E_UNKNOWN_FUNCTION)
        };

        option::none()
    }

    /// Callable during upgrades
    public(friend) fun register_mcms_entrypoint(publisher: &signer) {
        mcms_registry::register_entrypoint(
            publisher, string::utf8(b"token_admin_registry"), McmsCallback {}
        );
    }

    #[test_only]
    public fun init_module_for_testing(publisher: &signer) {
        init_module(publisher);
    }

    #[test_only]
    public fun get_token_unregistered_events(): vector<TokenUnregistered> acquires TokenAdminRegistryState {
        event::emitted_events_by_handle<TokenUnregistered>(
            &borrow_state().token_unregistered_events
        )
    }

    #[test_only]
    fun insert_token_addresses_for_test(
        token_addresses: vector<address>
    ) acquires TokenAdminRegistryState {
        let state = borrow_state_mut();

        token_addresses.for_each(
            |token_address| {
                state.token_configs.add(
                    token_address,
                    TokenConfig {
                        token_pool_address: @0x0,
                        administrator: @0x0,
                        pending_administrator: @0x0
                    }
                );
            }
        );
    }

    #[test(publisher = @ccip)]
    fun test_get_all_configured_tokens(publisher: &signer) acquires TokenAdminRegistryState {
        state_object::init_module_for_testing(publisher);
        init_module_for_testing(publisher);

        insert_token_addresses_for_test(vector[@0x1, @0x2, @0x3]);

        let (res, next_key, has_more) = get_all_configured_tokens(@0x0, 0);
        assert!(res.length() == 0);
        assert!(next_key == @0x0);
        assert!(has_more);

        let (res, next_key, has_more) = get_all_configured_tokens(@0x0, 3);
        assert!(res.length() == 3);
        assert!(vector[@0x1, @0x2, @0x3] == res);
        assert!(next_key == @0x3);
        assert!(!has_more);
    }

    #[test(publisher = @ccip)]
    fun test_get_all_configured_tokens_edge_cases(
        publisher: &signer
    ) acquires TokenAdminRegistryState {
        state_object::init_module_for_testing(publisher);
        init_module_for_testing(publisher);

        // Test case 1: Empty state
        let (res, next_key, has_more) = get_all_configured_tokens(@0x0, 1);
        assert!(res.length() == 0);
        assert!(next_key == @0x0);
        assert!(!has_more);

        // Test case 2: Single token
        insert_token_addresses_for_test(vector[@0x1]);
        let (res, _next_key, has_more) = get_all_configured_tokens(@0x0, 1);
        assert!(res.length() == 1);
        assert!(res[0] == @0x1);
        assert!(!has_more);

        // Test case 3: Start from middle
        insert_token_addresses_for_test(vector[@0x2, @0x3]);
        let (res, _next_key, has_more) = get_all_configured_tokens(@0x1, 2);
        assert!(res.length() == 2);
        assert!(res[0] == @0x2);
        assert!(res[1] == @0x3);
        assert!(!has_more);

        // Test case 4: Request more than available
        let (res, _next_key, has_more) = get_all_configured_tokens(@0x0, 5);
        assert!(res.length() == 3);
        assert!(res[0] == @0x1);
        assert!(res[1] == @0x2);
        assert!(res[2] == @0x3);
        assert!(!has_more);
    }

    #[test(publisher = @ccip)]
    fun test_get_all_configured_tokens_pagination(
        publisher: &signer
    ) acquires TokenAdminRegistryState {
        state_object::init_module_for_testing(publisher);
        init_module_for_testing(publisher);

        insert_token_addresses_for_test(vector[@0x1, @0x2, @0x3, @0x4, @0x5]);

        // Test pagination with different chunk sizes
        let current_key = @0x0;
        let total_tokens = vector[];

        // First page: get 2 tokens
        let (res, next_key, more) = get_all_configured_tokens(current_key, 2);
        assert!(res.length() == 2);
        assert!(res[0] == @0x1);
        assert!(res[1] == @0x2);
        assert!(more);
        current_key = next_key;
        total_tokens.append(res);

        // Second page: get 2 more tokens
        let (res, next_key, more) = get_all_configured_tokens(current_key, 2);
        assert!(res.length() == 2);
        assert!(res[0] == @0x3);
        assert!(res[1] == @0x4);
        assert!(more);
        current_key = next_key;
        total_tokens.append(res);

        // Last page: get remaining token
        let (res, _next_key, more) = get_all_configured_tokens(current_key, 2);
        assert!(res.length() == 1);
        assert!(res[0] == @0x5);
        assert!(!more);
        total_tokens.append(res);

        // Verify we got all tokens in order
        assert!(total_tokens.length() == 5);
        assert!(total_tokens[0] == @0x1);
        assert!(total_tokens[1] == @0x2);
        assert!(total_tokens[2] == @0x3);
        assert!(total_tokens[3] == @0x4);
        assert!(total_tokens[4] == @0x5);
    }

    #[test(publisher = @ccip)]
    fun test_get_all_configured_tokens_non_existent(
        publisher: &signer
    ) acquires TokenAdminRegistryState {
        state_object::init_module_for_testing(publisher);
        init_module_for_testing(publisher);

        insert_token_addresses_for_test(vector[@0x1, @0x2, @0x3]);

        // Test starting from non-existent key
        let (res, next_key, has_more) = get_all_configured_tokens(@0x4, 1);
        assert!(res.length() == 0);
        assert!(next_key == @0x4);
        assert!(!has_more);

        // Test starting from key between existing tokens
        let (res, _next_key, has_more) = get_all_configured_tokens(@0x1, 1);
        assert!(res.length() == 1);
        assert!(res[0] == @0x2);
        assert!(has_more);
    }
}
`

/** sources/util/address.move */
export const CCIP_UTIL_ADDRESS_MOVE = `module ccip::address {

    const E_ZERO_ADDRESS_NOT_ALLOWED: u64 = 1;

    public fun assert_non_zero_address_vector(addr: &vector<u8>) {
        assert!(!addr.is_empty(), E_ZERO_ADDRESS_NOT_ALLOWED);

        let is_zero_address = addr.all(|byte| *byte == 0);
        assert!(!is_zero_address, E_ZERO_ADDRESS_NOT_ALLOWED);
    }

    public fun assert_non_zero_address(addr: address) {
        assert!(addr != @0x0, E_ZERO_ADDRESS_NOT_ALLOWED);
    }
}
`
