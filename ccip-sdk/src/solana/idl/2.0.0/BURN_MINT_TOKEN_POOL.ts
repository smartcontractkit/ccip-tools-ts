/**
 * Anchor 0.29 IDL of `burnmint_token_pool 2.0.1`.
 *
 * From smartcontractkit/chainlink-ccip-solana@ee67ce0d, contracts/target/idl/burnmint_token_pool.json.
 *
 * Converted from the `anchor build` IDL (Anchor spec 0.1.0) to the Anchor 0.29 format, with every
 * instruction and account discriminator checked against the IDL's; regenerate rather than edit.
 * Newtypes are inlined as their single field (identical Borsh layout).
 */
export type BurnmintTokenPoolV2 = {
  version: '2.0.1'
  name: 'burnmint_token_pool'
  instructions: [
    {
      name: 'acceptOwnership'
      docs: [
        'Accepts a pending ownership transfer, making the caller the new pool owner.',
        'Shared function signature used by all CCIP token pool programs.',
      ]
      accounts: [
        { name: 'state'; isMut: true; isSigner: false },
        { name: 'mint'; isMut: false; isSigner: false },
        { name: 'authority'; isMut: false; isSigner: true },
      ]
      args: []
    },
    {
      name: 'appendRemotePoolAddresses'
      docs: [
        'Appends additional remote pool addresses to an existing ChainConfig.',
        'Reallocates the PDA to accommodate the extra entries.',
      ]
      accounts: [
        { name: 'state'; isMut: false; isSigner: false },
        { name: 'chainConfig'; isMut: true; isSigner: false },
        { name: 'authority'; isMut: true; isSigner: true },
        { name: 'systemProgram'; isMut: false; isSigner: false },
      ]
      args: [
        { name: 'remoteChainSelector'; type: 'u64' },
        { name: 'mint'; type: 'publicKey' },
        { name: 'addresses'; type: { vec: { defined: 'RemoteAddress' } } },
      ]
    },
    {
      name: 'configureAllowList'
      docs: [
        'Adds addresses to the allow-list and/or enables the allow-list check.',
        'When enabled, only listed addresses may send tokens through the pool.',
      ]
      accounts: [
        { name: 'state'; isMut: true; isSigner: false },
        { name: 'mint'; isMut: false; isSigner: false },
        { name: 'authority'; isMut: true; isSigner: true },
        { name: 'systemProgram'; isMut: false; isSigner: false },
      ]
      args: [{ name: 'add'; type: { vec: 'publicKey' } }, { name: 'enabled'; type: 'bool' }]
    },
    {
      name: 'deleteChainConfig'
      docs: [
        'Closes and reclaims rent from a ChainConfig PDA.',
        'After this call no cross-chain messages can be sent to or from that chain.',
      ]
      accounts: [
        { name: 'state'; isMut: false; isSigner: false },
        { name: 'chainConfig'; isMut: true; isSigner: false },
        { name: 'authority'; isMut: true; isSigner: true },
      ]
      args: [{ name: 'remoteChainSelector'; type: 'u64' }, { name: 'mint'; type: 'publicKey' }]
    },
    {
      name: 'deleteChainConfigOverride'
      docs: ['Closes and reclaims rent from a ChainConfigOverride PDA.']
      accounts: [
        { name: 'state'; isMut: false; isSigner: false },
        { name: 'chainConfigOverride'; isMut: true; isSigner: false },
        { name: 'authority'; isMut: true; isSigner: true },
        { name: 'eventAuthority'; isMut: false; isSigner: false },
        { name: 'program'; isMut: false; isSigner: false },
      ]
      args: [{ name: 'params'; type: { defined: 'DeleteChainConfigOverrideParams' } }]
    },
    {
      name: 'deriveAccountsLockOrBurnTokens'
      docs: [
        'Called by the router via CPI during `DeriveAccountsCcipSend` to discover',
        'any extra accounts needed for the onramp token transfer.',
        'Burnmint pools have no additional account requirements beyond the',
        'standard token lookup table, so this returns an empty set.',
      ]
      accounts: []
      args: [
        { name: 'stage'; type: 'string' },
        { name: 'lockOrBurn'; type: { defined: 'LockOrBurnInV1' } },
      ]
      returns: { defined: 'DeriveAccountsResponse' }
    },
    {
      name: 'deriveAccountsReleaseOrMintTokens'
      docs: [
        'Called by the offramp via CPI during `DeriveAccountsExecute` to discover',
        'any extra accounts needed for the offramp token transfer.',
        'Burnmint pools have no additional account requirements beyond the',
        'standard token lookup table, so this returns an empty set.',
      ]
      accounts: []
      args: [
        { name: 'stage'; type: 'string' },
        { name: 'releaseOrMint'; type: { defined: 'ReleaseOrMintInV1' } },
      ]
      returns: { defined: 'DeriveAccountsResponse' }
    },
    {
      name: 'editChainConfigV2'
      accounts: [
        { name: 'state'; isMut: false; isSigner: false },
        { name: 'chainConfigV2'; isMut: true; isSigner: false },
        { name: 'authority'; isMut: true; isSigner: true },
        { name: 'systemProgram'; isMut: false; isSigner: false },
        { name: 'eventAuthority'; isMut: false; isSigner: false },
        { name: 'program'; isMut: false; isSigner: false },
      ]
      args: [{ name: 'params'; type: { defined: 'SetChainConfigV2Params' } }]
    },
    {
      name: 'editChainRemoteConfig'
      docs: [
        'Overwrites the remote config (token address and pool addresses) for an',
        'existing ChainConfig. Reallocates the PDA if the new config is larger.',
      ]
      accounts: [
        { name: 'state'; isMut: false; isSigner: false },
        { name: 'chainConfig'; isMut: true; isSigner: false },
        { name: 'authority'; isMut: true; isSigner: true },
        { name: 'systemProgram'; isMut: false; isSigner: false },
      ]
      args: [
        { name: 'remoteChainSelector'; type: 'u64' },
        { name: 'mint'; type: 'publicKey' },
        { name: 'cfg'; type: { defined: 'RemoteConfig' } },
      ]
    },
    {
      name: 'getPoolFee'
      docs: ['Returns the fee receipt for a token transfer.']
      accounts: [
        { name: 'state'; isMut: false; isSigner: false },
        { name: 'chainConfig'; isMut: false; isSigner: false },
        {
          name: 'chainConfigV2'
          isMut: false
          isSigner: false
          docs: ['May or may not be initialized']
        },
      ]
      args: [{ name: 'getFeeIn'; type: { defined: 'GetFeeParams' } }]
      returns: { defined: 'GetFeeResult' }
    },
    {
      name: 'getRequiredCcvs'
      docs: [
        'This implementation returns base CCVs for all transfers, and includes additional CCVs when the transfer amount is above the configured threshold.',
      ]
      accounts: [
        { name: 'state'; isMut: false; isSigner: false },
        { name: 'chainConfig'; isMut: false; isSigner: false },
        {
          name: 'chainConfigV2'
          isMut: false
          isSigner: false
          docs: ['When initialized (owner == this program)']
        },
      ]
      args: [{ name: 'getRequiredCcvsIn'; type: { defined: 'GetRequiredCCVsIn' } }]
      returns: { defined: 'GetRequiredCCVsOut' }
    },
    {
      name: 'initChainConfigOverride'
      docs: [
        'Initializes a ChainConfigOverride PDA for the given remote chain and override type.',
        'Used to set separate rate limit buckets (e.g. for faster-than-finality transfers).',
      ]
      accounts: [
        { name: 'state'; isMut: false; isSigner: false },
        { name: 'chainConfigOverride'; isMut: true; isSigner: false },
        { name: 'authority'; isMut: true; isSigner: true },
        { name: 'systemProgram'; isMut: false; isSigner: false },
        { name: 'eventAuthority'; isMut: false; isSigner: false },
        { name: 'program'; isMut: false; isSigner: false },
      ]
      args: [{ name: 'params'; type: { defined: 'InitChainConfigOverrideParams' } }]
    },
    {
      name: 'initChainConfigV2'
      accounts: [
        { name: 'state'; isMut: false; isSigner: false },
        { name: 'chainConfigV2'; isMut: true; isSigner: false },
        { name: 'authority'; isMut: true; isSigner: true },
        { name: 'systemProgram'; isMut: false; isSigner: false },
        {
          name: 'mint'
          isMut: false
          isSigner: false
          docs: [
            "The token this pool wraps. Needed to create the fee vault ATA the lane's in-token BPS fee",
            'accrues into.',
          ]
        },
        { name: 'feeVault'; isMut: false; isSigner: false },
        {
          name: 'feeVaultTokenAccount'
          isMut: true
          isSigner: false
          docs: [
            "The fee vault's ATA for the pool's own mint, where `lock_or_burn_tokens_v2` accrues the",
            'in-token BPS fee. Created here so that configuring a',
            'lane and being able to collect (and withdraw) its BPS fee are the same operation.',
          ]
        },
        { name: 'tokenProgram'; isMut: false; isSigner: false },
        { name: 'associatedTokenProgram'; isMut: false; isSigner: false },
        { name: 'eventAuthority'; isMut: false; isSigner: false },
        { name: 'program'; isMut: false; isSigner: false },
      ]
      args: [{ name: 'params'; type: { defined: 'SetChainConfigV2Params' } }]
    },
    {
      name: 'initChainRemoteConfig'
      docs: [
        'Initializes a ChainConfig PDA for the given remote chain.',
        'Must be called before any cross-chain messages can be sent to or from',
        'that chain. Remote pool addresses are added separately via',
        'append_remote_pool_addresses.',
      ]
      accounts: [
        { name: 'state'; isMut: false; isSigner: false },
        { name: 'chainConfig'; isMut: true; isSigner: false },
        { name: 'authority'; isMut: true; isSigner: true },
        { name: 'systemProgram'; isMut: false; isSigner: false },
      ]
      args: [
        { name: 'remoteChainSelector'; type: 'u64' },
        { name: 'mint'; type: 'publicKey' },
        { name: 'cfg'; type: { defined: 'RemoteConfig' } },
      ]
    },
    {
      name: 'initGlobalConfig'
      docs: [
        'Initializes the program-level PoolConfig PDA.',
        "Must be called once by the program's upgrade authority before any",
        'token pool can be created.',
      ]
      accounts: [
        { name: 'config'; isMut: true; isSigner: false },
        { name: 'authority'; isMut: true; isSigner: true },
        { name: 'systemProgram'; isMut: false; isSigner: false },
        { name: 'program'; isMut: false; isSigner: false },
        { name: 'programData'; isMut: false; isSigner: false },
      ]
      args: [
        { name: 'routerAddress'; type: 'publicKey' },
        { name: 'rmnAddress'; type: 'publicKey' },
      ]
    },
    {
      name: 'initialize'
      docs: [
        'Creates a new per-mint State PDA for the given mint.',
        'The upgrade authority (or a mint authority when self-serve is enabled)',
        'becomes the pool owner.',
      ]
      accounts: [
        { name: 'state'; isMut: true; isSigner: false },
        { name: 'mint'; isMut: false; isSigner: false },
        { name: 'authority'; isMut: true; isSigner: true },
        { name: 'systemProgram'; isMut: false; isSigner: false },
        { name: 'program'; isMut: false; isSigner: false },
        { name: 'programData'; isMut: false; isSigner: false },
        { name: 'config'; isMut: false; isSigner: false },
      ]
      args: []
    },
    {
      name: 'initializeByMultisig'
      docs: [
        'Creates a new per-mint State PDA for the given mint via a mint authority multisig signer.',
        'Self-serve must be enabled. Only 1-of-N multisigs are supported.',
      ]
      accounts: [
        { name: 'state'; isMut: true; isSigner: false },
        { name: 'mint'; isMut: false; isSigner: false },
        { name: 'authority'; isMut: true; isSigner: true },
        { name: 'systemProgram'; isMut: false; isSigner: false },
        { name: 'program'; isMut: false; isSigner: false },
        { name: 'programData'; isMut: false; isSigner: false },
        { name: 'config'; isMut: false; isSigner: false },
        {
          name: 'mintAuthorityMultisig'
          isMut: false
          isSigner: false
          docs: ['Only 1-of-N SPL Token multisigs are supported here.']
        },
      ]
      args: []
    },
    {
      name: 'lockOrBurnTokens'
      docs: [
        "Burns tokens from the sender's account as part of an outbound",
        'cross-chain transfer. Called by the router via CPI after the onramp',
        'has validated the message.',
      ]
      accounts: [
        { name: 'authority'; isMut: false; isSigner: true },
        { name: 'state'; isMut: false; isSigner: false },
        { name: 'tokenProgram'; isMut: false; isSigner: false },
        { name: 'mint'; isMut: true; isSigner: false },
        { name: 'poolSigner'; isMut: false; isSigner: false },
        { name: 'poolTokenAccount'; isMut: true; isSigner: false },
        { name: 'rmnRemote'; isMut: false; isSigner: false },
        { name: 'rmnRemoteCurses'; isMut: false; isSigner: false },
        { name: 'rmnRemoteConfig'; isMut: false; isSigner: false },
        { name: 'chainConfig'; isMut: true; isSigner: false },
      ]
      args: [{ name: 'lockOrBurn'; type: { defined: 'LockOrBurnInV1' } }]
      returns: { defined: 'LockOrBurnOutV1' }
    },
    {
      name: 'lockOrBurnTokensV2'
      docs: ['Burns tokens from the pool as part of an outbound cross-chain transfer (V2).']
      accounts: [
        { name: 'authority'; isMut: false; isSigner: true },
        { name: 'state'; isMut: false; isSigner: false },
        { name: 'tokenProgram'; isMut: false; isSigner: false },
        { name: 'mint'; isMut: true; isSigner: false },
        { name: 'poolSigner'; isMut: false; isSigner: false },
        { name: 'poolTokenAccount'; isMut: true; isSigner: false },
        { name: 'chainConfig'; isMut: true; isSigner: false },
        {
          name: 'chainConfigV2'
          isMut: false
          isSigner: false
          docs: ['May or may not be initialized']
        },
        {
          name: 'chainConfigOverride'
          isMut: true
          isSigner: false
          docs: [
            'When initialized (owner == this program), its rate limit buckets',
            'override the default ones for faster-than-finality transfers.',
          ]
        },
        {
          name: 'feeVaultTokenAccount'
          isMut: true
          isSigner: false
          docs: [
            'token-pool receipt fees into. In-token BPS fees accrue here until the owner withdraws them',
            'with `withdraw_fee_tokens`. The vault PDA is derived inline rather than passed in: it holds',
            'no data and never signs here, and every account this instruction takes costs 32 bytes of a',
            '`ccip_send` transaction that is already close to the size limit.',
          ]
        },
        { name: 'eventAuthority'; isMut: false; isSigner: false },
        { name: 'program'; isMut: false; isSigner: false },
      ]
      args: [{ name: 'lockOrBurn'; type: { defined: 'LockOrBurnInV2' } }]
      returns: { defined: 'LockOrBurnOutV2' }
    },
    {
      name: 'nestedResolveAccountsStart'
      docs: [
        'Resolves the accounts needed for V2 lock_or_burn or release_or_mint',
        'instructions based on the instruction discriminator.',
      ]
      accounts: [{ name: 'state'; isMut: false; isSigner: false }]
      args: [{ name: 'params'; type: { defined: 'NestedResolveAccountsParams' } }]
      returns: { defined: 'NestedResolveAccountsResponse' }
    },
    {
      name: 'observeChainConfig'
      docs: [
        "Returns a pool's configuration for a single remote chain, for observability consumers.",
        'Rate limiter buckets are reported as of now, i.e. including the refill accrued since the',
        'last transfer.',
        '',
        'Permissionless and read-only: meant to be executed through `simulateTransaction`. Fails if',
        'the lane has no chain config, which callers can read as "not configured".',
      ]
      accounts: [{ name: 'chainConfig'; isMut: false; isSigner: false }]
      args: [{ name: 'remoteChainSelector'; type: 'u64' }, { name: 'mint'; type: 'publicKey' }]
      returns: { defined: 'PoolChainConfigObservation' }
    },
    {
      name: 'observeChainConfigOverride'
      docs: [
        "Returns a pool's rate limit override for a single remote chain and override type, for",
        'observability consumers. Rate limiter buckets are reported as of now, i.e. including the',
        'refill accrued since the last transfer.',
        '',
        'Permissionless and read-only: meant to be executed through `simulateTransaction`. Fails if',
        'the lane has no override of that type, which callers can read as "not overridden".',
      ]
      accounts: [{ name: 'chainConfigOverride'; isMut: false; isSigner: false }]
      args: [
        { name: 'remoteChainSelector'; type: 'u64' },
        { name: 'mint'; type: 'publicKey' },
        { name: 'overrideType'; type: { defined: 'PoolChainConfigOverrideType' } },
      ]
      returns: { defined: 'PoolChainConfigOverrideObservation' }
    },
    {
      name: 'observeChainConfigV2'
      docs: [
        "Returns a pool's CCIP 2.0 CCV configuration for a single remote chain, for observability",
        'consumers.',
        '',
        'Permissionless and read-only: meant to be executed through `simulateTransaction`. Fails if',
        'the lane has no CCV config, which callers can read as "not configured".',
      ]
      accounts: [{ name: 'chainConfigV2'; isMut: false; isSigner: false }]
      args: [{ name: 'remoteChainSelector'; type: 'u64' }, { name: 'mint'; type: 'publicKey' }]
      returns: { defined: 'PoolChainConfigV2Observation' }
    },
    {
      name: 'observeState'
      docs: [
        "Returns a pool's per-mint configuration, for observability consumers.",
        '',
        'Permissionless and read-only: meant to be executed through `simulateTransaction`. The',
        'allow list is reported as a count only.',
      ]
      accounts: [{ name: 'state'; isMut: false; isSigner: false }]
      args: [{ name: 'mint'; type: 'publicKey' }]
      returns: { defined: 'PoolStateObservation' }
    },
    {
      name: 'releaseOrMintTokens'
      docs: [
        "Mints tokens to the receiver's account as part of an inbound",
        'cross-chain transfer. Called by the offramp via CPI after the',
        'message has been verified and committed.',
      ]
      accounts: [
        { name: 'authority'; isMut: false; isSigner: true },
        {
          name: 'offrampProgram'
          isMut: false
          isSigner: false
          docs: [
            'CHECK offramp program: exists only to derive the allowed offramp PDA',
            'and the authority PDA.',
          ]
        },
        {
          name: 'allowedOfframp'
          isMut: false
          isSigner: false
          docs: [
            'CHECK PDA of the router program verifying the signer is an allowed offramp.',
            "If PDA does not exist, the router doesn't allow this offramp",
          ]
        },
        { name: 'state'; isMut: false; isSigner: false },
        { name: 'tokenProgram'; isMut: false; isSigner: false },
        { name: 'mint'; isMut: true; isSigner: false },
        { name: 'poolSigner'; isMut: false; isSigner: false },
        { name: 'poolTokenAccount'; isMut: true; isSigner: false },
        { name: 'chainConfig'; isMut: true; isSigner: false },
        { name: 'rmnRemote'; isMut: false; isSigner: false },
        { name: 'rmnRemoteCurses'; isMut: false; isSigner: false },
        { name: 'rmnRemoteConfig'; isMut: false; isSigner: false },
        { name: 'receiverTokenAccount'; isMut: true; isSigner: false },
      ]
      args: [{ name: 'releaseOrMint'; type: { defined: 'ReleaseOrMintInV1' } }]
      returns: { defined: 'ReleaseOrMintOutV1' }
    },
    {
      name: 'releaseOrMintTokensV2'
      docs: ['Mints tokens to the receiver as part of an inbound cross-chain transfer (V2).']
      accounts: [
        { name: 'authority'; isMut: false; isSigner: true },
        {
          name: 'offrampProgram'
          isMut: false
          isSigner: false
          docs: [
            'CHECK offramp program: exists only to derive the allowed offramp PDA',
            'and the authority PDA.',
          ]
        },
        {
          name: 'allowedOfframp'
          isMut: false
          isSigner: false
          docs: [
            'CHECK PDA of the router program verifying the signer is an allowed offramp.',
            "If PDA does not exist, the router doesn't allow this offramp",
          ]
        },
        { name: 'state'; isMut: false; isSigner: false },
        { name: 'tokenProgram'; isMut: false; isSigner: false },
        { name: 'mint'; isMut: true; isSigner: false },
        { name: 'poolSigner'; isMut: false; isSigner: false },
        { name: 'poolTokenAccount'; isMut: true; isSigner: false },
        { name: 'chainConfig'; isMut: true; isSigner: false },
        {
          name: 'chainConfigOverride'
          isMut: true
          isSigner: false
          docs: [
            'When initialized (owner == this program), its rate limit buckets',
            'override the default ones for faster-than-finality transfers.',
          ]
        },
        { name: 'receiverTokenAccount'; isMut: true; isSigner: false },
        { name: 'eventAuthority'; isMut: false; isSigner: false },
        { name: 'program'; isMut: false; isSigner: false },
      ]
      args: [{ name: 'releaseOrMint'; type: { defined: 'ReleaseOrMintInV2' } }]
      returns: { defined: 'ReleaseOrMintOutV2' }
    },
    {
      name: 'removeFromAllowList'
      docs: ['Removes addresses from the allow-list.']
      accounts: [
        { name: 'state'; isMut: true; isSigner: false },
        { name: 'mint'; isMut: false; isSigner: false },
        { name: 'authority'; isMut: true; isSigner: true },
        { name: 'systemProgram'; isMut: false; isSigner: false },
      ]
      args: [{ name: 'remove'; type: { vec: 'publicKey' } }]
    },
    {
      name: 'setChainConfigOverrideRateLimit'
      docs: [
        'Updates the rate limits on a ChainConfigOverride PDA.',
        'Callable by the pool owner or the rate-limit admin.',
      ]
      accounts: [
        { name: 'state'; isMut: false; isSigner: false },
        { name: 'chainConfigOverride'; isMut: true; isSigner: false },
        { name: 'authority'; isMut: false; isSigner: true },
        { name: 'eventAuthority'; isMut: false; isSigner: false },
        { name: 'program'; isMut: false; isSigner: false },
      ]
      args: [{ name: 'params'; type: { defined: 'SetChainConfigOverrideRateLimitParams' } }]
    },
    {
      name: 'setChainRateLimit'
      docs: [
        'Updates the inbound and outbound rate limits for a specific remote chain.',
        'Callable by either the pool owner or the rate-limit admin.',
      ]
      accounts: [
        { name: 'state'; isMut: false; isSigner: false },
        { name: 'chainConfig'; isMut: true; isSigner: false },
        { name: 'authority'; isMut: true; isSigner: true },
      ]
      args: [
        { name: 'remoteChainSelector'; type: 'u64' },
        { name: 'mint'; type: 'publicKey' },
        { name: 'inbound'; type: { defined: 'RateLimitConfig' } },
        { name: 'outbound'; type: { defined: 'RateLimitConfig' } },
      ]
    },
    {
      name: 'setRateLimitAdmin'
      docs: [
        'Sets the rate-limit admin for a token pool.',
        'The rate-limit admin may call set_chain_rate_limit without being the pool owner.',
      ]
      accounts: [
        { name: 'state'; isMut: true; isSigner: false },
        { name: 'authority'; isMut: true; isSigner: true },
      ]
      args: [{ name: 'mint'; type: 'publicKey' }, { name: 'newRateLimitAdmin'; type: 'publicKey' }]
    },
    {
      name: 'setRmn'
      docs: [
        "Updates the RMN Remote address on an individual token pool's State.",
        'Only callable by the upgrade authority if they also own the pool.',
      ]
      accounts: [
        { name: 'state'; isMut: true; isSigner: false },
        { name: 'mint'; isMut: false; isSigner: false },
        { name: 'authority'; isMut: true; isSigner: true },
        { name: 'program'; isMut: false; isSigner: false },
        { name: 'programData'; isMut: false; isSigner: false },
      ]
      args: [{ name: 'rmnAddress'; type: 'publicKey' }]
    },
    {
      name: 'setRouter'
      docs: [
        "Updates the router address on an individual token pool's State.",
        'Changes the expected signer for lock/burn and release/mint calls.',
        'Only callable by the upgrade authority if they also own the pool.',
      ]
      accounts: [
        { name: 'state'; isMut: true; isSigner: false },
        { name: 'mint'; isMut: false; isSigner: false },
        { name: 'authority'; isMut: true; isSigner: true },
        { name: 'program'; isMut: false; isSigner: false },
        { name: 'programData'; isMut: false; isSigner: false },
      ]
      args: [{ name: 'newRouter'; type: 'publicKey' }]
    },
    {
      name: 'transferMintAuthorityToMultisig'
      docs: [
        'Transfers the mint authority from the pool-signer PDA to a multisig.',
        'Used when an operator wants shared, multi-party control over minting.',
        'Only the program upgrade authority may invoke this.',
      ]
      accounts: [
        { name: 'state'; isMut: true; isSigner: false },
        { name: 'mint'; isMut: true; isSigner: false },
        { name: 'tokenProgram'; isMut: false; isSigner: false },
        { name: 'poolSigner'; isMut: false; isSigner: false },
        { name: 'authority'; isMut: false; isSigner: true },
        { name: 'newMultisigMintAuthority'; isMut: false; isSigner: false },
        { name: 'program'; isMut: false; isSigner: false },
        { name: 'programData'; isMut: false; isSigner: false },
      ]
      args: []
    },
    {
      name: 'transferMintAuthorityToPdaSigner'
      docs: [
        'Transfers the mint authority back from a multisig to the pool-signer PDA.',
        'Used during migration cleanup to revert from a multisig back to direct',
        'pool-signer control.',
      ]
      accounts: [
        { name: 'state'; isMut: false; isSigner: false },
        { name: 'mint'; isMut: true; isSigner: false },
        { name: 'tokenProgram'; isMut: false; isSigner: false },
        { name: 'poolSigner'; isMut: false; isSigner: false },
        { name: 'authority'; isMut: false; isSigner: true },
        { name: 'currentMintAuthorityAccount'; isMut: false; isSigner: false },
        { name: 'program'; isMut: false; isSigner: false },
        { name: 'programData'; isMut: false; isSigner: false },
      ]
      args: []
    },
    {
      name: 'transferOwnership'
      docs: [
        'Initiates an ownership transfer for this token pool to a new proposed owner.',
        'The proposed owner must call accept_ownership to complete the handover.',
      ]
      accounts: [
        { name: 'state'; isMut: true; isSigner: false },
        { name: 'mint'; isMut: false; isSigner: false },
        { name: 'authority'; isMut: false; isSigner: true },
      ]
      args: [{ name: 'proposedOwner'; type: 'publicKey' }]
    },
    {
      name: 'typeVersion'
      docs: [
        'Returns the program type (name) and version string encoded at build time.',
        'Offchain code calls this to confirm which program and version is deployed',
        'before sending any other instruction.',
      ]
      accounts: []
      args: []
      returns: 'string'
    },
    {
      name: 'updateDefaultRmn'
      docs: [
        'Updates the default RMN Remote address stored in PoolConfig.',
        'New token pools created after this call will use the new RMN Remote.',
      ]
      accounts: [
        { name: 'config'; isMut: true; isSigner: false },
        { name: 'authority'; isMut: false; isSigner: true },
        { name: 'program'; isMut: false; isSigner: false },
        { name: 'programData'; isMut: false; isSigner: false },
      ]
      args: [{ name: 'rmnAddress'; type: 'publicKey' }]
    },
    {
      name: 'updateDefaultRouter'
      docs: [
        'Updates the default router address stored in PoolConfig.',
        'New token pools created after this call will use the new router.',
      ]
      accounts: [
        { name: 'config'; isMut: true; isSigner: false },
        { name: 'authority'; isMut: false; isSigner: true },
        { name: 'program'; isMut: false; isSigner: false },
        { name: 'programData'; isMut: false; isSigner: false },
      ]
      args: [{ name: 'routerAddress'; type: 'publicKey' }]
    },
    {
      name: 'updateSelfServedAllowed'
      docs: [
        'Enables or disables self-served pool initialization.',
        'When enabled, any mint authority may create a pool for their mint',
        'without requiring the program upgrade authority.',
      ]
      accounts: [
        { name: 'config'; isMut: true; isSigner: false },
        { name: 'authority'; isMut: false; isSigner: true },
        { name: 'program'; isMut: false; isSigner: false },
        { name: 'programData'; isMut: false; isSigner: false },
      ]
      args: [{ name: 'selfServedAllowed'; type: 'bool' }]
    },
    {
      name: 'withdrawFeeTokens'
      docs: [
        'Sweeps the fees this pool accrued for `mint` in a single fee token into a recipient token',
        "account of the pool owner's choosing. Restricted to the pool owner.",
        '',
        'If `amount` is provided, only the requested amount is transferred. Otherwise (if None) the',
        'entire balance is transferred.',
      ]
      accounts: [
        { name: 'state'; isMut: false; isSigner: false },
        {
          name: 'mint'
          isMut: false
          isSigner: false
          docs: [
            'The token this pool wraps. Unrelated to `fee_token_mint`, but part of the fee vault seeds.',
          ]
        },
        { name: 'feeVault'; isMut: false; isSigner: false },
        { name: 'feeVaultTokenAccount'; isMut: true; isSigner: false },
        {
          name: 'recipient'
          isMut: true
          isSigner: false
          docs: [
            'Where the fees go. Freely chosen by the pool owner, unlike the executor and the CCVs, which',
            'pin the destination to a `fee_aggregator` held in their config.',
          ]
        },
        {
          name: 'feeTokenMint'
          isMut: false
          isSigner: false
          docs: [
            'The token the fees were billed in, which is whatever the sender paid with, so a pool',
            'accrues one vault ATA per fee token it has ever been paid in.',
          ]
        },
        { name: 'feeTokenProgram'; isMut: false; isSigner: false },
        { name: 'authority'; isMut: false; isSigner: true },
      ]
      args: [{ name: 'amount'; type: { option: 'u64' } }]
    },
  ]
  accounts: [
    {
      name: 'chainConfig'
      type: { kind: 'struct'; fields: [{ name: 'base'; type: { defined: 'BaseChain' } }] }
    },
    {
      name: 'chainConfigOverride'
      type: {
        kind: 'struct'
        fields: [
          { name: 'bump'; type: 'u8' },
          { name: 'version'; type: 'u8' },
          { name: 'base'; type: { defined: 'BaseOverrideConfig' } },
        ]
      }
    },
    {
      name: 'chainConfigV2'
      type: {
        kind: 'struct'
        fields: [
          { name: 'bump'; type: 'u8' },
          { name: 'version'; type: 'u8' },
          { name: 'remoteChainSelector'; type: 'u64' },
          { name: 'mint'; type: 'publicKey' },
          {
            name: 'allowedFinalityConfig'
            docs: [
              'Allowed finality policy for *outbound* (lock_or_burn) transfers on this lane.',
              "Mirrors EVM's pool-wide `s_allowedFinalityConfig`. Zero-initialized",
              '(`WAIT_FOR_FINALITY`) means only full-finality transfers are permitted.',
            ]
            type: { defined: 'FinalityConfig' }
          },
          { name: 'tokenTransferFeeConfig'; type: { defined: 'TokenTransferFeeConfig' } },
          { name: 'ccvConfig'; type: { defined: 'CCVConfig' } },
        ]
      }
    },
    {
      name: 'poolConfig'
      type: {
        kind: 'struct'
        fields: [
          { name: 'version'; type: 'u8' },
          { name: 'selfServedAllowed'; type: 'bool' },
          { name: 'router'; type: 'publicKey' },
          { name: 'rmnRemote'; type: 'publicKey' },
        ]
      }
    },
    {
      name: 'state'
      type: {
        kind: 'struct'
        fields: [
          { name: 'version'; type: 'u8' },
          { name: 'config'; type: { defined: 'BaseConfig' } },
        ]
      }
    },
  ]
  errors: [
    { code: 6000; name: 'InvalidMultisig'; msg: 'Invalid Multisig Mint' },
    { code: 6001; name: 'MintAuthorityAlreadySet'; msg: 'Mint Authority already set' },
    { code: 6002; name: 'FixedMintToken'; msg: 'Token with no Mint Authority' },
    { code: 6003; name: 'UnsupportedTokenProgram'; msg: 'Unsupported Token Program' },
    {
      code: 6004
      name: 'InvalidToken2022Multisig'
      msg: 'Invalid Multisig Account Data for Token 2022'
    },
    {
      code: 6005
      name: 'InvalidSPLTokenMultisig'
      msg: 'Invalid Multisig Account Data for SPL Token'
    },
    {
      code: 6006
      name: 'PoolSignerNotInMultisig'
      msg: 'Token Pool Signer PDA must be m times a signer of the Multisig'
    },
    {
      code: 6007
      name: 'MultisigMustHaveAtLeastTwoSigners'
      msg: 'Multisig must have at least 2 valid signers'
    },
    {
      code: 6008
      name: 'MultisigMustHaveMoreThanOneSigner'
      msg: 'Multisig must have more than one required signer'
    },
    { code: 6009; name: 'InvalidMultisigOwner'; msg: 'Multisig Owner must match Token Program ID' },
    {
      code: 6010
      name: 'InvalidMultisigThreshold'
      msg: 'Invalid multisig threshold: required signatures cannot exceed total signers'
    },
    {
      code: 6011
      name: 'InvalidMultisigThresholdTooHigh'
      msg: 'Invalid multisig m: required signatures cannot exceed the available for outside signers'
    },
  ]
  types: [
    {
      name: 'BaseChain'
      type: {
        kind: 'struct'
        fields: [
          { name: 'remote'; type: { defined: 'RemoteConfig' } },
          { name: 'inboundRateLimit'; type: { defined: 'RateLimitTokenBucket' } },
          { name: 'outboundRateLimit'; type: { defined: 'RateLimitTokenBucket' } },
        ]
      }
    },
    {
      name: 'BaseConfig'
      type: {
        kind: 'struct'
        fields: [
          { name: 'tokenProgram'; type: 'publicKey' },
          { name: 'mint'; type: 'publicKey' },
          { name: 'decimals'; type: 'u8' },
          { name: 'poolSigner'; type: 'publicKey' },
          { name: 'poolTokenAccount'; type: 'publicKey' },
          { name: 'owner'; type: 'publicKey' },
          { name: 'proposedOwner'; type: 'publicKey' },
          { name: 'rateLimitAdmin'; type: 'publicKey' },
          { name: 'routerOnrampAuthority'; type: 'publicKey' },
          { name: 'router'; type: 'publicKey' },
          {
            name: 'rebalancer'
            docs: [
              'Set the rebalancer address for the pool; if set to the default "no rebalance" address',
              '(Pubkey::default()), no rebalance is allowed.',
            ]
            type: 'publicKey'
          },
          {
            name: 'canAcceptLiquidity'
            docs: [
              'DEPRECATED: this field is no longer enforced at runtime. It is kept for backward',
              'compatibility (no PDA migration) and is always initialized to `true`.',
              'To disable inflows operationally, set the rebalancer to `Pubkey::default()`.',
            ]
            type: 'bool'
          },
          { name: 'listEnabled'; type: 'bool' },
          { name: 'allowList'; type: { vec: 'publicKey' } },
          { name: 'rmnRemote'; type: 'publicKey' },
        ]
      }
    },
    {
      name: 'BaseOverrideConfig'
      type: {
        kind: 'struct'
        fields: [
          { name: 'remoteChainSelector'; type: 'u64' },
          { name: 'mint'; type: 'publicKey' },
          { name: 'inboundRateLimit'; type: { defined: 'RateLimitTokenBucket' } },
          { name: 'outboundRateLimit'; type: { defined: 'RateLimitTokenBucket' } },
          { name: 'overrideType'; type: { defined: 'PoolChainConfigOverrideType' } },
        ]
      }
    },
    {
      name: 'CCVConfig'
      type: {
        kind: 'struct'
        fields: [
          { name: 'thresholdAmount'; type: 'u64' },
          { name: 'outboundCcvs'; type: { vec: 'publicKey' } },
          { name: 'thresholdOutboundCcvs'; type: { vec: 'publicKey' } },
          { name: 'inboundCcvs'; type: { vec: 'publicKey' } },
          { name: 'thresholdInboundCcvs'; type: { vec: 'publicKey' } },
        ]
      }
    },
    {
      name: 'ChainConfig'
      type: { kind: 'struct'; fields: [{ name: 'base'; type: { defined: 'BaseChain' } }] }
    },
    {
      name: 'ChainConfigOverride'
      type: {
        kind: 'struct'
        fields: [
          { name: 'bump'; type: 'u8' },
          { name: 'version'; type: 'u8' },
          { name: 'base'; type: { defined: 'BaseOverrideConfig' } },
        ]
      }
    },
    {
      name: 'ChainConfigV2'
      type: {
        kind: 'struct'
        fields: [
          { name: 'bump'; type: 'u8' },
          { name: 'version'; type: 'u8' },
          { name: 'remoteChainSelector'; type: 'u64' },
          { name: 'mint'; type: 'publicKey' },
          {
            name: 'allowedFinalityConfig'
            docs: [
              'Allowed finality policy for *outbound* (lock_or_burn) transfers on this lane.',
              "Mirrors EVM's pool-wide `s_allowedFinalityConfig`. Zero-initialized",
              '(`WAIT_FOR_FINALITY`) means only full-finality transfers are permitted.',
            ]
            type: { defined: 'FinalityConfig' }
          },
          { name: 'tokenTransferFeeConfig'; type: { defined: 'TokenTransferFeeConfig' } },
          { name: 'ccvConfig'; type: { defined: 'CCVConfig' } },
        ]
      }
    },
    {
      name: 'DeleteChainConfigOverrideParams'
      type: {
        kind: 'struct'
        fields: [
          { name: 'remoteChainSelector'; type: 'u64' },
          { name: 'mint'; type: 'publicKey' },
          { name: 'overrideType'; type: { defined: 'PoolChainConfigOverrideType' } },
        ]
      }
    },
    {
      name: 'DeriveAccountsResponse'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'askAgainWith'
            type: { vec: { defined: 'base_token_pool::v1::CcipAccountMeta' } }
          },
          {
            name: 'accountsToSave'
            type: { vec: { defined: 'base_token_pool::v1::CcipAccountMeta' } }
          },
          { name: 'lookUpTablesToSave'; type: { vec: 'publicKey' } },
          { name: 'currentStage'; type: 'string' },
          { name: 'nextStage'; type: 'string' },
        ]
      }
    },
    {
      name: 'FinalityConfig'
      docs: [
        'Per-message finality configuration. Wire-format: 4 bytes big-endian (flags || block_depth).',
        "Mirrors the `bytes4` Finality type in chainlink-ccv's `protocol/finality.go`.",
        '',
        'Layout (MSB first):',
        'flags[15:1]  — reserved',
        'flags[0]     — S: wait for `safe` head instead of full finality',
        'block_depth  — number of block confirmations required (0 = full finality / safe, per flags)',
      ]
      type: {
        kind: 'struct'
        fields: [{ name: 'flags'; type: 'u16' }, { name: 'blockDepth'; type: 'u16' }]
      }
    },
    {
      name: 'GetFeeParams'
      type: {
        kind: 'struct'
        fields: [
          { name: 'remoteChainSelector'; type: 'u64' },
          { name: 'amount'; type: 'u64' },
          { name: 'localToken'; type: 'publicKey' },
          { name: 'feeToken'; type: 'publicKey' },
          { name: 'requestedFinalityConfig'; type: { defined: 'FinalityConfig' } },
          { name: 'tokenArgs'; type: 'bytes' },
        ]
      }
    },
    {
      name: 'GetFeeResult'
      type: {
        kind: 'struct'
        fields: [
          { name: 'destGasLimit'; type: 'u32' },
          { name: 'destBytesOverhead'; type: 'u32' },
          { name: 'fee'; type: 'u32' },
          { name: 'tokenFeeBps'; type: 'u16' },
          { name: 'isEnabled'; type: 'bool' },
        ]
      }
    },
    {
      name: 'GetRequiredCCVsIn'
      type: {
        kind: 'struct'
        fields: [
          { name: 'remoteChainSelector'; type: 'u64' },
          {
            name: 'amount'
            docs: [
              'Token amount used to determine the required CCVs.',
              '',
              "For inbound transfers, the amount is denominated in the remote token's decimals",
              'and must be converted to local token decimals before applying amount-based CCV',
              'policies. For outbound transfers, the amount is already denominated in local',
              "token decimals, but is the gross amount before the pool's in-token BPS fee: the",
              'pool deducts that fee before applying amount-based CCV policies, as it only sends',
              'the post-fee remainder cross-chain. Inbound amounts are already post-fee.',
            ]
            type: { defined: 'ProtocolAmount' }
          },
          { name: 'localToken'; type: 'publicKey' },
          { name: 'direction'; type: { defined: 'MessageDirection' } },
          { name: 'requestedFinalityConfig'; type: { defined: 'FinalityConfig' } },
        ]
      }
    },
    {
      name: 'GetRequiredCCVsOut'
      type: { kind: 'struct'; fields: [{ name: 'requiredCcvs'; type: { vec: 'publicKey' } }] }
    },
    {
      name: 'InitChainConfigOverrideParams'
      type: {
        kind: 'struct'
        fields: [
          { name: 'remoteChainSelector'; type: 'u64' },
          { name: 'mint'; type: 'publicKey' },
          { name: 'overrideType'; type: { defined: 'PoolChainConfigOverrideType' } },
          { name: 'inbound'; type: { defined: 'RateLimitConfig' } },
          { name: 'outbound'; type: { defined: 'RateLimitConfig' } },
        ]
      }
    },
    {
      name: 'LockOrBurnInV1'
      type: {
        kind: 'struct'
        fields: [
          { name: 'receiver'; type: 'bytes' },
          { name: 'remoteChainSelector'; type: 'u64' },
          { name: 'originalSender'; type: 'publicKey' },
          { name: 'amount'; type: 'u64' },
          { name: 'localToken'; type: 'publicKey' },
          {
            name: 'msgTotalNonce'
            docs: [
              "DEPRECATED. The onramp's full nonce for this message, keyed by `original_sender` and",
              '`remote_chain_selector`. Still populated with a real value by the 1.6 onramp',
              "(`ccip-router`'s `instructions_v1/v1/onramp.rs`), but hard-coded to `0` by `ccip_send_v2`,",
              'which no longer tracks per-sender nonces.',
              '',
              'The only pool that reads it is `cctp-token-pool`, which uses it as a PDA seed for the',
              "`cctp_message_sent_event` account (see that program's `lib.rs` and `derive.rs`). A constant",
              '`0` would therefore collide across messages — so the `0` is only sound because a CCTP v1 pool',
              'can never be reached from `ccip_send_v2`:',
              '',
              '- CCTP and Lombard are the only v1 pools that set `implements_account_resolution`.',
              "- `TokenTransferContext::new` (the router's `instructions/common.rs`) verifies the",
              '`TokenAdminRegistry` PDA and then rejects `interface_version == 1` &&',
              '`implements_account_resolution` with `UnsupportedPoolV1ResolutionOnLaneV2`. That runs in',
              '`ccip_send_v2` before any pool CPI, so it is the authoritative gate; the account-resolution',
              'stage (`ccip_send/resolve_accounts/token_transfer_static.rs`) rejects the same combination',
              'earlier, but is only advisory since callers can build the transaction themselves.',
              '- `set_pool_interface_implementation` additionally refuses to register',
              '`implements_account_resolution` below `interface_version` 2. The runtime check still',
              'matters because registries migrated from 1.6 can carry the v1/resolution combination.',
              '',
              'Removing the field outright is a breaking change to the v1 pool interface, so it stays until',
              'the 1.6 lane is retired. Anything that starts consuming it must not assume it is meaningful',
              'on the v2 lane.',
            ]
            type: 'u64'
          },
        ]
      }
    },
    {
      name: 'LockOrBurnInV2'
      type: {
        kind: 'struct'
        fields: [
          { name: 'receiver'; type: 'bytes' },
          { name: 'remoteChainSelector'; type: 'u64' },
          { name: 'originalSender'; type: 'publicKey' },
          { name: 'amount'; type: 'u64' },
          { name: 'localToken'; type: 'publicKey' },
          { name: 'requestedFinalityConfig'; type: { defined: 'FinalityConfig' } },
          { name: 'tokenArgs'; type: 'bytes' },
        ]
      }
    },
    {
      name: 'LockOrBurnOutV1'
      type: {
        kind: 'struct'
        fields: [
          { name: 'destTokenAddress'; type: { defined: 'RemoteAddress' } },
          { name: 'destPoolData'; type: 'bytes' },
        ]
      }
    },
    {
      name: 'LockOrBurnOutV2'
      type: {
        kind: 'struct'
        fields: [
          { name: 'destTokenAddress'; type: { defined: 'RemoteAddress' } },
          { name: 'destPoolData'; type: 'bytes' },
          { name: 'destTokenAmount'; type: 'u64' },
        ]
      }
    },
    {
      name: 'MessageDirection'
      docs: ['Direction of a cross-chain message, used for CCV requirements.']
      type: { kind: 'enum'; variants: [{ name: 'Outbound' }, { name: 'Inbound' }] }
    },
    {
      name: 'NestedResolveAccountsParams'
      docs: [
        'Resolution parameters used by nested resolvers. Rather than the full ix_data and a metadata',
        'field, they have an opaque `cpi_resolution_inputs` field that doubles as both. The caller',
        'of the nested resolution is responsible for correctly encoding it by consulting',
        'the documentation.',
      ]
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'caller'
            docs: ['The account expected to sign the final instruction being resolved.']
            type: 'publicKey'
          },
          {
            name: 'callerProgram'
            docs: [
              'The program ID that derived `caller` and is driving this resolution (the router on the',
              'send side, the offramp on the execute side).',
            ]
            type: 'publicKey'
          },
          {
            name: 'cpiResolutionInputs'
            docs: [
              'Will be deserialized into a type the nested resolver understands. For what to',
              "send in the first stage of nested resolution, consult the nested resolver's documentation.",
            ]
            type: 'bytes'
          },
        ]
      }
    },
    {
      name: 'NestedResolveAccountsResponse'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'askAgainWith'
            docs: [
              'In the next resolution round, call the resolution method',
              'including these accounts (all read-only).',
            ]
            type: { vec: 'publicKey' }
          },
          {
            name: 'accountsToSave'
            docs: [
              'Append these accounts to a separate accumulator list. Once',
              '`next_ix_discriminator` is empty, this accumulated list',
              'contains all accounts for the instruction of interest.',
            ]
            type: { vec: { defined: 'ccip_common::resolution::CcipAccountMeta' } }
          },
          {
            name: 'lookupTablesToSave'
            docs: [
              'Append these lookup tables to a separate accumulator list.',
              'Once resolution is complete, the accumulated list contains all',
              'LUTs that the instruction of interest can use.',
            ]
            type: { vec: 'publicKey' }
          },
          {
            name: 'nextCpiResolutionInputs'
            docs: ['If nonempty, perform another resolution stage with these inputs.']
            type: 'bytes'
          },
        ]
      }
    },
    {
      name: 'PoolChainConfigObservation'
      docs: ['Per-remote-chain configuration of a token pool, as observed by off-chain consumers.']
      type: {
        kind: 'struct'
        fields: [
          { name: 'observationVersion'; type: 'u16' },
          { name: 'typeVersion'; type: 'string' },
          { name: 'remoteChainSelector'; type: 'u64' },
          { name: 'mint'; type: 'publicKey' },
          {
            name: 'remoteTokenAddress'
            docs: ['Token address on the remote chain, as raw bytes.']
            type: 'bytes'
          },
          { name: 'remoteDecimals'; type: 'u8' },
          {
            name: 'remotePoolAddresses'
            docs: [
              'Pool addresses on the remote chain, as raw bytes. More than one entry means earlier pool',
              'versions are still accepted as sources.',
            ]
            type: { vec: 'bytes' }
          },
          { name: 'inboundRateLimit'; type: { defined: 'RateLimiterObservation' } },
          { name: 'outboundRateLimit'; type: { defined: 'RateLimiterObservation' } },
        ]
      }
    },
    {
      name: 'PoolChainConfigOverrideObservation'
      docs: [
        'Per-remote-chain, per-override-type rate limit override of a token pool, as observed by',
        'off-chain consumers.',
        '',
        'Override PDAs are optional: when a lane has no override of the requested type, the observing',
        'instruction fails, which callers can read as "not overridden".',
      ]
      type: {
        kind: 'struct'
        fields: [
          { name: 'observationVersion'; type: 'u16' },
          { name: 'typeVersion'; type: 'string' },
          { name: 'version'; type: 'u8' },
          { name: 'remoteChainSelector'; type: 'u64' },
          { name: 'mint'; type: 'publicKey' },
          {
            name: 'overrideType'
            docs: ['Which flavour of transfer this override applies to (e.g. fast transfers).']
            type: { defined: 'PoolChainConfigOverrideType' }
          },
          { name: 'inboundRateLimit'; type: { defined: 'RateLimiterObservation' } },
          { name: 'outboundRateLimit'; type: { defined: 'RateLimiterObservation' } },
        ]
      }
    },
    { name: 'PoolChainConfigOverrideType'; type: { kind: 'enum'; variants: [{ name: 'FTF' }] } },
    {
      name: 'PoolChainConfigV2Observation'
      docs: [
        'Per-remote-chain CCIP 2.0 configuration of a token pool, as observed by off-chain consumers.',
      ]
      type: {
        kind: 'struct'
        fields: [
          { name: 'observationVersion'; type: 'u16' },
          { name: 'typeVersion'; type: 'string' },
          { name: 'version'; type: 'u8' },
          { name: 'remoteChainSelector'; type: 'u64' },
          { name: 'mint'; type: 'publicKey' },
          {
            name: 'thresholdAmount'
            docs: [
              'Transfer amount above which the threshold CCVs are additionally required. Zero disables the',
              'threshold lists.',
            ]
            type: 'u64'
          },
          { name: 'outboundCcvs'; type: { vec: 'publicKey' } },
          { name: 'thresholdOutboundCcvs'; type: { vec: 'publicKey' } },
          { name: 'inboundCcvs'; type: { vec: 'publicKey' } },
          { name: 'thresholdInboundCcvs'; type: { vec: 'publicKey' } },
          {
            name: 'allowedFinalityConfig'
            docs: ['Allowed finality policy for outbound (lock_or_burn) transfers on this lane.']
            type: { defined: 'FinalityConfig' }
          },
        ]
      }
    },
    {
      name: 'PoolConfig'
      type: {
        kind: 'struct'
        fields: [
          { name: 'version'; type: 'u8' },
          { name: 'selfServedAllowed'; type: 'bool' },
          { name: 'router'; type: 'publicKey' },
          { name: 'rmnRemote'; type: 'publicKey' },
        ]
      }
    },
    {
      name: 'PoolStateObservation'
      docs: [
        'Per-mint configuration of a token pool, as observed by off-chain consumers.',
        '',
        'The allow list is reported as a count only, as its size is unbounded by configuration.',
      ]
      type: {
        kind: 'struct'
        fields: [
          { name: 'observationVersion'; type: 'u16' },
          { name: 'typeVersion'; type: 'string' },
          { name: 'version'; type: 'u8' },
          { name: 'tokenProgram'; type: 'publicKey' },
          { name: 'mint'; type: 'publicKey' },
          { name: 'decimals'; type: 'u8' },
          { name: 'poolSigner'; type: 'publicKey' },
          { name: 'poolTokenAccount'; type: 'publicKey' },
          { name: 'owner'; type: 'publicKey' },
          { name: 'proposedOwner'; type: 'publicKey' },
          { name: 'rateLimitAdmin'; type: 'publicKey' },
          { name: 'router'; type: 'publicKey' },
          { name: 'routerOnrampAuthority'; type: 'publicKey' },
          { name: 'rmnRemote'; type: 'publicKey' },
          {
            name: 'rebalancer'
            docs: [
              'Rebalancer, only meaningful for lock/release pools. The default pubkey means rebalancing is',
              'not allowed.',
            ]
            type: 'publicKey'
          },
          { name: 'listEnabled'; type: 'bool' },
          { name: 'allowListCount'; type: 'u32' },
        ]
      }
    },
    {
      name: 'ProtocolAmount'
      docs: [
        'CCIP 2.0 compatible cross-chain amount representation (u256 in big-endian bytes, based',
        'on abi.encodePacked)',
      ]
      type: { kind: 'struct'; fields: [{ name: 'beBytes'; type: { array: ['u8', 32] } }] }
    },
    {
      name: 'RateLimitConfig'
      type: {
        kind: 'struct'
        fields: [
          { name: 'enabled'; type: 'bool' },
          { name: 'capacity'; type: 'u64' },
          { name: 'rate'; type: 'u64' },
        ]
      }
    },
    {
      name: 'RateLimitTokenBucket'
      type: {
        kind: 'struct'
        fields: [
          { name: 'tokens'; type: 'u64' },
          { name: 'lastUpdated'; type: 'u64' },
          { name: 'cfg'; type: { defined: 'RateLimitConfig' } },
        ]
      }
    },
    {
      name: 'RateLimiterObservation'
      docs: ['State of one rate limiter bucket, as of the moment of observation.']
      type: {
        kind: 'struct'
        fields: [
          { name: 'isEnabled'; type: 'bool' },
          { name: 'capacity'; type: 'u64' },
          { name: 'rate'; type: 'u64' },
          {
            name: 'tokens'
            docs: [
              'Tokens available now: the stored balance plus the refill accrued since the bucket was last',
              "touched, capped at `capacity`. This is the value EVM's `getCurrent*RateLimiterState`",
              'returns, not the raw stored balance.',
            ]
            type: 'u64'
          },
          {
            name: 'lastUpdated'
            docs: [
              'Timestamp the `tokens` value corresponds to (the observation time, for an enabled bucket).',
            ]
            type: 'u64'
          },
        ]
      }
    },
    {
      name: 'ReleaseOrMintInV1'
      type: {
        kind: 'struct'
        fields: [
          { name: 'originalSender'; type: { defined: 'RemoteAddress' } },
          { name: 'remoteChainSelector'; type: 'u64' },
          { name: 'receiver'; type: 'publicKey' },
          { name: 'amount'; type: { array: ['u8', 32] } },
          { name: 'localToken'; type: 'publicKey' },
          {
            name: 'sourcePoolAddress'
            docs: [
              '@dev WARNING: sourcePoolAddress should be checked prior to any processing of funds. Make sure it matches the',
              'expected pool address for the given remoteChainSelector.',
            ]
            type: { defined: 'RemoteAddress' }
          },
          { name: 'sourcePoolData'; type: 'bytes' },
          {
            name: 'offchainTokenData'
            docs: ['@dev WARNING: offchainTokenData is untrusted data.']
            type: 'bytes'
          },
        ]
      }
    },
    {
      name: 'ReleaseOrMintInV2'
      type: {
        kind: 'struct'
        fields: [
          { name: 'originalSender'; type: { defined: 'RemoteAddress' } },
          { name: 'remoteChainSelector'; type: 'u64' },
          { name: 'receiver'; type: 'publicKey' },
          { name: 'amount'; type: { defined: 'ProtocolAmount' } },
          { name: 'localToken'; type: 'publicKey' },
          { name: 'sourcePoolAddress'; type: { defined: 'RemoteAddress' } },
          { name: 'sourcePoolData'; type: 'bytes' },
          { name: 'requestedFinalityConfig'; type: { defined: 'FinalityConfig' } },
          { name: 'receiverUsage'; type: { defined: 'SVMTokenReceiverUsage' } },
        ]
      }
    },
    {
      name: 'ReleaseOrMintOutV1'
      type: { kind: 'struct'; fields: [{ name: 'destinationAmount'; type: 'u64' }] }
    },
    {
      name: 'ReleaseOrMintOutV2'
      type: { kind: 'struct'; fields: [{ name: 'destinationAmount'; type: 'u64' }] }
    },
    {
      name: 'RemoteAddress'
      type: { kind: 'struct'; fields: [{ name: 'address'; type: 'bytes' }] }
    },
    {
      name: 'RemoteConfig'
      type: {
        kind: 'struct'
        fields: [
          { name: 'poolAddresses'; type: { vec: { defined: 'RemoteAddress' } } },
          { name: 'tokenAddress'; type: { defined: 'RemoteAddress' } },
          { name: 'decimals'; type: 'u8' },
        ]
      }
    },
    {
      name: 'SVMTokenReceiverUsage'
      type: {
        kind: 'enum'
        variants: [
          { name: 'DeriveAtaAndCreate' },
          { name: 'DeriveAtaDontCreate' },
          { name: 'UseAsIs' },
        ]
      }
    },
    {
      name: 'SetChainConfigOverrideRateLimitParams'
      type: {
        kind: 'struct'
        fields: [
          { name: 'remoteChainSelector'; type: 'u64' },
          { name: 'mint'; type: 'publicKey' },
          { name: 'overrideType'; type: { defined: 'PoolChainConfigOverrideType' } },
          { name: 'inbound'; type: { defined: 'RateLimitConfig' } },
          { name: 'outbound'; type: { defined: 'RateLimitConfig' } },
        ]
      }
    },
    {
      name: 'SetChainConfigV2Params'
      type: {
        kind: 'struct'
        fields: [
          { name: 'mint'; type: 'publicKey' },
          { name: 'remoteChainSelector'; type: 'u64' },
          {
            name: 'allowedFinalityConfig'
            docs: [
              'Allowed finality policy for outbound (lock_or_burn) transfers on this lane.',
              '`WAIT_FOR_FINALITY` (zero) permits only full-finality transfers.',
            ]
            type: { defined: 'FinalityConfig' }
          },
          { name: 'tokenTransferFeeConfig'; type: { defined: 'TokenTransferFeeConfig' } },
          { name: 'ccvConfig'; type: { defined: 'CCVConfig' } },
        ]
      }
    },
    {
      name: 'State'
      type: {
        kind: 'struct'
        fields: [
          { name: 'version'; type: 'u8' },
          { name: 'config'; type: { defined: 'BaseConfig' } },
        ]
      }
    },
    {
      name: 'TokenTransferFeeConfig'
      type: {
        kind: 'struct'
        fields: [
          { name: 'destGasOverhead'; type: 'u32' },
          { name: 'destBytesOverhead'; type: 'u32' },
          { name: 'finalityFee'; type: 'u32' },
          { name: 'fastFinalityFee'; type: 'u32' },
          { name: 'finalityBpsFee'; type: 'u16' },
          { name: 'fastFinalityBpsFee'; type: 'u16' },
          { name: 'isEnabled'; type: 'bool' },
        ]
      }
    },
    {
      name: 'base_token_pool::v1::CcipAccountMeta'
      type: {
        kind: 'struct'
        fields: [
          { name: 'pubkey'; type: 'publicKey' },
          { name: 'isSigner'; type: 'bool' },
          { name: 'isWritable'; type: 'bool' },
        ]
      }
    },
    {
      name: 'ccip_common::resolution::CcipAccountMeta'
      type: {
        kind: 'struct'
        fields: [
          { name: 'pubkey'; type: 'publicKey' },
          { name: 'isSigner'; type: 'bool' },
          { name: 'isWritable'; type: 'bool' },
        ]
      }
    },
  ]
}

export const IDL: BurnmintTokenPoolV2 = {
  version: '2.0.1',
  name: 'burnmint_token_pool',
  instructions: [
    {
      name: 'acceptOwnership',
      docs: [
        'Accepts a pending ownership transfer, making the caller the new pool owner.',
        'Shared function signature used by all CCIP token pool programs.',
      ],
      accounts: [
        {
          name: 'state',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'mint',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: false,
          isSigner: true,
        },
      ],
      args: [],
    },
    {
      name: 'appendRemotePoolAddresses',
      docs: [
        'Appends additional remote pool addresses to an existing ChainConfig.',
        'Reallocates the PDA to accommodate the extra entries.',
      ],
      accounts: [
        {
          name: 'state',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'chainConfig',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'systemProgram',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'remoteChainSelector',
          type: 'u64',
        },
        {
          name: 'mint',
          type: 'publicKey',
        },
        {
          name: 'addresses',
          type: {
            vec: {
              defined: 'RemoteAddress',
            },
          },
        },
      ],
    },
    {
      name: 'configureAllowList',
      docs: [
        'Adds addresses to the allow-list and/or enables the allow-list check.',
        'When enabled, only listed addresses may send tokens through the pool.',
      ],
      accounts: [
        {
          name: 'state',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'mint',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'systemProgram',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'add',
          type: {
            vec: 'publicKey',
          },
        },
        {
          name: 'enabled',
          type: 'bool',
        },
      ],
    },
    {
      name: 'deleteChainConfig',
      docs: [
        'Closes and reclaims rent from a ChainConfig PDA.',
        'After this call no cross-chain messages can be sent to or from that chain.',
      ],
      accounts: [
        {
          name: 'state',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'chainConfig',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: true,
          isSigner: true,
        },
      ],
      args: [
        {
          name: 'remoteChainSelector',
          type: 'u64',
        },
        {
          name: 'mint',
          type: 'publicKey',
        },
      ],
    },
    {
      name: 'deleteChainConfigOverride',
      docs: ['Closes and reclaims rent from a ChainConfigOverride PDA.'],
      accounts: [
        {
          name: 'state',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'chainConfigOverride',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'eventAuthority',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'program',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'params',
          type: {
            defined: 'DeleteChainConfigOverrideParams',
          },
        },
      ],
    },
    {
      name: 'deriveAccountsLockOrBurnTokens',
      docs: [
        'Called by the router via CPI during `DeriveAccountsCcipSend` to discover',
        'any extra accounts needed for the onramp token transfer.',
        'Burnmint pools have no additional account requirements beyond the',
        'standard token lookup table, so this returns an empty set.',
      ],
      accounts: [],
      args: [
        {
          name: 'stage',
          type: 'string',
        },
        {
          name: 'lockOrBurn',
          type: {
            defined: 'LockOrBurnInV1',
          },
        },
      ],
      returns: {
        defined: 'DeriveAccountsResponse',
      },
    },
    {
      name: 'deriveAccountsReleaseOrMintTokens',
      docs: [
        'Called by the offramp via CPI during `DeriveAccountsExecute` to discover',
        'any extra accounts needed for the offramp token transfer.',
        'Burnmint pools have no additional account requirements beyond the',
        'standard token lookup table, so this returns an empty set.',
      ],
      accounts: [],
      args: [
        {
          name: 'stage',
          type: 'string',
        },
        {
          name: 'releaseOrMint',
          type: {
            defined: 'ReleaseOrMintInV1',
          },
        },
      ],
      returns: {
        defined: 'DeriveAccountsResponse',
      },
    },
    {
      name: 'editChainConfigV2',
      accounts: [
        {
          name: 'state',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'chainConfigV2',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'systemProgram',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'eventAuthority',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'program',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'params',
          type: {
            defined: 'SetChainConfigV2Params',
          },
        },
      ],
    },
    {
      name: 'editChainRemoteConfig',
      docs: [
        'Overwrites the remote config (token address and pool addresses) for an',
        'existing ChainConfig. Reallocates the PDA if the new config is larger.',
      ],
      accounts: [
        {
          name: 'state',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'chainConfig',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'systemProgram',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'remoteChainSelector',
          type: 'u64',
        },
        {
          name: 'mint',
          type: 'publicKey',
        },
        {
          name: 'cfg',
          type: {
            defined: 'RemoteConfig',
          },
        },
      ],
    },
    {
      name: 'getPoolFee',
      docs: ['Returns the fee receipt for a token transfer.'],
      accounts: [
        {
          name: 'state',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'chainConfig',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'chainConfigV2',
          isMut: false,
          isSigner: false,
          docs: ['May or may not be initialized'],
        },
      ],
      args: [
        {
          name: 'getFeeIn',
          type: {
            defined: 'GetFeeParams',
          },
        },
      ],
      returns: {
        defined: 'GetFeeResult',
      },
    },
    {
      name: 'getRequiredCcvs',
      docs: [
        'This implementation returns base CCVs for all transfers, and includes additional CCVs when the transfer amount is above the configured threshold.',
      ],
      accounts: [
        {
          name: 'state',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'chainConfig',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'chainConfigV2',
          isMut: false,
          isSigner: false,
          docs: ['When initialized (owner == this program)'],
        },
      ],
      args: [
        {
          name: 'getRequiredCcvsIn',
          type: {
            defined: 'GetRequiredCCVsIn',
          },
        },
      ],
      returns: {
        defined: 'GetRequiredCCVsOut',
      },
    },
    {
      name: 'initChainConfigOverride',
      docs: [
        'Initializes a ChainConfigOverride PDA for the given remote chain and override type.',
        'Used to set separate rate limit buckets (e.g. for faster-than-finality transfers).',
      ],
      accounts: [
        {
          name: 'state',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'chainConfigOverride',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'systemProgram',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'eventAuthority',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'program',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'params',
          type: {
            defined: 'InitChainConfigOverrideParams',
          },
        },
      ],
    },
    {
      name: 'initChainConfigV2',
      accounts: [
        {
          name: 'state',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'chainConfigV2',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'systemProgram',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'mint',
          isMut: false,
          isSigner: false,
          docs: [
            "The token this pool wraps. Needed to create the fee vault ATA the lane's in-token BPS fee",
            'accrues into.',
          ],
        },
        {
          name: 'feeVault',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'feeVaultTokenAccount',
          isMut: true,
          isSigner: false,
          docs: [
            "The fee vault's ATA for the pool's own mint, where `lock_or_burn_tokens_v2` accrues the",
            'in-token BPS fee. Created here so that configuring a',
            'lane and being able to collect (and withdraw) its BPS fee are the same operation.',
          ],
        },
        {
          name: 'tokenProgram',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'associatedTokenProgram',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'eventAuthority',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'program',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'params',
          type: {
            defined: 'SetChainConfigV2Params',
          },
        },
      ],
    },
    {
      name: 'initChainRemoteConfig',
      docs: [
        'Initializes a ChainConfig PDA for the given remote chain.',
        'Must be called before any cross-chain messages can be sent to or from',
        'that chain. Remote pool addresses are added separately via',
        'append_remote_pool_addresses.',
      ],
      accounts: [
        {
          name: 'state',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'chainConfig',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'systemProgram',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'remoteChainSelector',
          type: 'u64',
        },
        {
          name: 'mint',
          type: 'publicKey',
        },
        {
          name: 'cfg',
          type: {
            defined: 'RemoteConfig',
          },
        },
      ],
    },
    {
      name: 'initGlobalConfig',
      docs: [
        'Initializes the program-level PoolConfig PDA.',
        "Must be called once by the program's upgrade authority before any",
        'token pool can be created.',
      ],
      accounts: [
        {
          name: 'config',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'systemProgram',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'program',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'programData',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'routerAddress',
          type: 'publicKey',
        },
        {
          name: 'rmnAddress',
          type: 'publicKey',
        },
      ],
    },
    {
      name: 'initialize',
      docs: [
        'Creates a new per-mint State PDA for the given mint.',
        'The upgrade authority (or a mint authority when self-serve is enabled)',
        'becomes the pool owner.',
      ],
      accounts: [
        {
          name: 'state',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'mint',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'systemProgram',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'program',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'programData',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'config',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [],
    },
    {
      name: 'initializeByMultisig',
      docs: [
        'Creates a new per-mint State PDA for the given mint via a mint authority multisig signer.',
        'Self-serve must be enabled. Only 1-of-N multisigs are supported.',
      ],
      accounts: [
        {
          name: 'state',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'mint',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'systemProgram',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'program',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'programData',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'config',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'mintAuthorityMultisig',
          isMut: false,
          isSigner: false,
          docs: ['Only 1-of-N SPL Token multisigs are supported here.'],
        },
      ],
      args: [],
    },
    {
      name: 'lockOrBurnTokens',
      docs: [
        "Burns tokens from the sender's account as part of an outbound",
        'cross-chain transfer. Called by the router via CPI after the onramp',
        'has validated the message.',
      ],
      accounts: [
        {
          name: 'authority',
          isMut: false,
          isSigner: true,
        },
        {
          name: 'state',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'tokenProgram',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'mint',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'poolSigner',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'poolTokenAccount',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'rmnRemote',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'rmnRemoteCurses',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'rmnRemoteConfig',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'chainConfig',
          isMut: true,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'lockOrBurn',
          type: {
            defined: 'LockOrBurnInV1',
          },
        },
      ],
      returns: {
        defined: 'LockOrBurnOutV1',
      },
    },
    {
      name: 'lockOrBurnTokensV2',
      docs: ['Burns tokens from the pool as part of an outbound cross-chain transfer (V2).'],
      accounts: [
        {
          name: 'authority',
          isMut: false,
          isSigner: true,
        },
        {
          name: 'state',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'tokenProgram',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'mint',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'poolSigner',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'poolTokenAccount',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'chainConfig',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'chainConfigV2',
          isMut: false,
          isSigner: false,
          docs: ['May or may not be initialized'],
        },
        {
          name: 'chainConfigOverride',
          isMut: true,
          isSigner: false,
          docs: [
            'When initialized (owner == this program), its rate limit buckets',
            'override the default ones for faster-than-finality transfers.',
          ],
        },
        {
          name: 'feeVaultTokenAccount',
          isMut: true,
          isSigner: false,
          docs: [
            'token-pool receipt fees into. In-token BPS fees accrue here until the owner withdraws them',
            'with `withdraw_fee_tokens`. The vault PDA is derived inline rather than passed in: it holds',
            'no data and never signs here, and every account this instruction takes costs 32 bytes of a',
            '`ccip_send` transaction that is already close to the size limit.',
          ],
        },
        {
          name: 'eventAuthority',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'program',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'lockOrBurn',
          type: {
            defined: 'LockOrBurnInV2',
          },
        },
      ],
      returns: {
        defined: 'LockOrBurnOutV2',
      },
    },
    {
      name: 'nestedResolveAccountsStart',
      docs: [
        'Resolves the accounts needed for V2 lock_or_burn or release_or_mint',
        'instructions based on the instruction discriminator.',
      ],
      accounts: [
        {
          name: 'state',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'params',
          type: {
            defined: 'NestedResolveAccountsParams',
          },
        },
      ],
      returns: {
        defined: 'NestedResolveAccountsResponse',
      },
    },
    {
      name: 'observeChainConfig',
      docs: [
        "Returns a pool's configuration for a single remote chain, for observability consumers.",
        'Rate limiter buckets are reported as of now, i.e. including the refill accrued since the',
        'last transfer.',
        '',
        'Permissionless and read-only: meant to be executed through `simulateTransaction`. Fails if',
        'the lane has no chain config, which callers can read as "not configured".',
      ],
      accounts: [
        {
          name: 'chainConfig',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'remoteChainSelector',
          type: 'u64',
        },
        {
          name: 'mint',
          type: 'publicKey',
        },
      ],
      returns: {
        defined: 'PoolChainConfigObservation',
      },
    },
    {
      name: 'observeChainConfigOverride',
      docs: [
        "Returns a pool's rate limit override for a single remote chain and override type, for",
        'observability consumers. Rate limiter buckets are reported as of now, i.e. including the',
        'refill accrued since the last transfer.',
        '',
        'Permissionless and read-only: meant to be executed through `simulateTransaction`. Fails if',
        'the lane has no override of that type, which callers can read as "not overridden".',
      ],
      accounts: [
        {
          name: 'chainConfigOverride',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'remoteChainSelector',
          type: 'u64',
        },
        {
          name: 'mint',
          type: 'publicKey',
        },
        {
          name: 'overrideType',
          type: {
            defined: 'PoolChainConfigOverrideType',
          },
        },
      ],
      returns: {
        defined: 'PoolChainConfigOverrideObservation',
      },
    },
    {
      name: 'observeChainConfigV2',
      docs: [
        "Returns a pool's CCIP 2.0 CCV configuration for a single remote chain, for observability",
        'consumers.',
        '',
        'Permissionless and read-only: meant to be executed through `simulateTransaction`. Fails if',
        'the lane has no CCV config, which callers can read as "not configured".',
      ],
      accounts: [
        {
          name: 'chainConfigV2',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'remoteChainSelector',
          type: 'u64',
        },
        {
          name: 'mint',
          type: 'publicKey',
        },
      ],
      returns: {
        defined: 'PoolChainConfigV2Observation',
      },
    },
    {
      name: 'observeState',
      docs: [
        "Returns a pool's per-mint configuration, for observability consumers.",
        '',
        'Permissionless and read-only: meant to be executed through `simulateTransaction`. The',
        'allow list is reported as a count only.',
      ],
      accounts: [
        {
          name: 'state',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'mint',
          type: 'publicKey',
        },
      ],
      returns: {
        defined: 'PoolStateObservation',
      },
    },
    {
      name: 'releaseOrMintTokens',
      docs: [
        "Mints tokens to the receiver's account as part of an inbound",
        'cross-chain transfer. Called by the offramp via CPI after the',
        'message has been verified and committed.',
      ],
      accounts: [
        {
          name: 'authority',
          isMut: false,
          isSigner: true,
        },
        {
          name: 'offrampProgram',
          isMut: false,
          isSigner: false,
          docs: [
            'CHECK offramp program: exists only to derive the allowed offramp PDA',
            'and the authority PDA.',
          ],
        },
        {
          name: 'allowedOfframp',
          isMut: false,
          isSigner: false,
          docs: [
            'CHECK PDA of the router program verifying the signer is an allowed offramp.',
            "If PDA does not exist, the router doesn't allow this offramp",
          ],
        },
        {
          name: 'state',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'tokenProgram',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'mint',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'poolSigner',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'poolTokenAccount',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'chainConfig',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'rmnRemote',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'rmnRemoteCurses',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'rmnRemoteConfig',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'receiverTokenAccount',
          isMut: true,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'releaseOrMint',
          type: {
            defined: 'ReleaseOrMintInV1',
          },
        },
      ],
      returns: {
        defined: 'ReleaseOrMintOutV1',
      },
    },
    {
      name: 'releaseOrMintTokensV2',
      docs: ['Mints tokens to the receiver as part of an inbound cross-chain transfer (V2).'],
      accounts: [
        {
          name: 'authority',
          isMut: false,
          isSigner: true,
        },
        {
          name: 'offrampProgram',
          isMut: false,
          isSigner: false,
          docs: [
            'CHECK offramp program: exists only to derive the allowed offramp PDA',
            'and the authority PDA.',
          ],
        },
        {
          name: 'allowedOfframp',
          isMut: false,
          isSigner: false,
          docs: [
            'CHECK PDA of the router program verifying the signer is an allowed offramp.',
            "If PDA does not exist, the router doesn't allow this offramp",
          ],
        },
        {
          name: 'state',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'tokenProgram',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'mint',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'poolSigner',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'poolTokenAccount',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'chainConfig',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'chainConfigOverride',
          isMut: true,
          isSigner: false,
          docs: [
            'When initialized (owner == this program), its rate limit buckets',
            'override the default ones for faster-than-finality transfers.',
          ],
        },
        {
          name: 'receiverTokenAccount',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'eventAuthority',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'program',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'releaseOrMint',
          type: {
            defined: 'ReleaseOrMintInV2',
          },
        },
      ],
      returns: {
        defined: 'ReleaseOrMintOutV2',
      },
    },
    {
      name: 'removeFromAllowList',
      docs: ['Removes addresses from the allow-list.'],
      accounts: [
        {
          name: 'state',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'mint',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'systemProgram',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'remove',
          type: {
            vec: 'publicKey',
          },
        },
      ],
    },
    {
      name: 'setChainConfigOverrideRateLimit',
      docs: [
        'Updates the rate limits on a ChainConfigOverride PDA.',
        'Callable by the pool owner or the rate-limit admin.',
      ],
      accounts: [
        {
          name: 'state',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'chainConfigOverride',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: false,
          isSigner: true,
        },
        {
          name: 'eventAuthority',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'program',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'params',
          type: {
            defined: 'SetChainConfigOverrideRateLimitParams',
          },
        },
      ],
    },
    {
      name: 'setChainRateLimit',
      docs: [
        'Updates the inbound and outbound rate limits for a specific remote chain.',
        'Callable by either the pool owner or the rate-limit admin.',
      ],
      accounts: [
        {
          name: 'state',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'chainConfig',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: true,
          isSigner: true,
        },
      ],
      args: [
        {
          name: 'remoteChainSelector',
          type: 'u64',
        },
        {
          name: 'mint',
          type: 'publicKey',
        },
        {
          name: 'inbound',
          type: {
            defined: 'RateLimitConfig',
          },
        },
        {
          name: 'outbound',
          type: {
            defined: 'RateLimitConfig',
          },
        },
      ],
    },
    {
      name: 'setRateLimitAdmin',
      docs: [
        'Sets the rate-limit admin for a token pool.',
        'The rate-limit admin may call set_chain_rate_limit without being the pool owner.',
      ],
      accounts: [
        {
          name: 'state',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: true,
          isSigner: true,
        },
      ],
      args: [
        {
          name: 'mint',
          type: 'publicKey',
        },
        {
          name: 'newRateLimitAdmin',
          type: 'publicKey',
        },
      ],
    },
    {
      name: 'setRmn',
      docs: [
        "Updates the RMN Remote address on an individual token pool's State.",
        'Only callable by the upgrade authority if they also own the pool.',
      ],
      accounts: [
        {
          name: 'state',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'mint',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'program',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'programData',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'rmnAddress',
          type: 'publicKey',
        },
      ],
    },
    {
      name: 'setRouter',
      docs: [
        "Updates the router address on an individual token pool's State.",
        'Changes the expected signer for lock/burn and release/mint calls.',
        'Only callable by the upgrade authority if they also own the pool.',
      ],
      accounts: [
        {
          name: 'state',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'mint',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'program',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'programData',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'newRouter',
          type: 'publicKey',
        },
      ],
    },
    {
      name: 'transferMintAuthorityToMultisig',
      docs: [
        'Transfers the mint authority from the pool-signer PDA to a multisig.',
        'Used when an operator wants shared, multi-party control over minting.',
        'Only the program upgrade authority may invoke this.',
      ],
      accounts: [
        {
          name: 'state',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'mint',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'tokenProgram',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'poolSigner',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: false,
          isSigner: true,
        },
        {
          name: 'newMultisigMintAuthority',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'program',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'programData',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [],
    },
    {
      name: 'transferMintAuthorityToPdaSigner',
      docs: [
        'Transfers the mint authority back from a multisig to the pool-signer PDA.',
        'Used during migration cleanup to revert from a multisig back to direct',
        'pool-signer control.',
      ],
      accounts: [
        {
          name: 'state',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'mint',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'tokenProgram',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'poolSigner',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: false,
          isSigner: true,
        },
        {
          name: 'currentMintAuthorityAccount',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'program',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'programData',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [],
    },
    {
      name: 'transferOwnership',
      docs: [
        'Initiates an ownership transfer for this token pool to a new proposed owner.',
        'The proposed owner must call accept_ownership to complete the handover.',
      ],
      accounts: [
        {
          name: 'state',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'mint',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: false,
          isSigner: true,
        },
      ],
      args: [
        {
          name: 'proposedOwner',
          type: 'publicKey',
        },
      ],
    },
    {
      name: 'typeVersion',
      docs: [
        'Returns the program type (name) and version string encoded at build time.',
        'Offchain code calls this to confirm which program and version is deployed',
        'before sending any other instruction.',
      ],
      accounts: [],
      args: [],
      returns: 'string',
    },
    {
      name: 'updateDefaultRmn',
      docs: [
        'Updates the default RMN Remote address stored in PoolConfig.',
        'New token pools created after this call will use the new RMN Remote.',
      ],
      accounts: [
        {
          name: 'config',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: false,
          isSigner: true,
        },
        {
          name: 'program',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'programData',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'rmnAddress',
          type: 'publicKey',
        },
      ],
    },
    {
      name: 'updateDefaultRouter',
      docs: [
        'Updates the default router address stored in PoolConfig.',
        'New token pools created after this call will use the new router.',
      ],
      accounts: [
        {
          name: 'config',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: false,
          isSigner: true,
        },
        {
          name: 'program',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'programData',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'routerAddress',
          type: 'publicKey',
        },
      ],
    },
    {
      name: 'updateSelfServedAllowed',
      docs: [
        'Enables or disables self-served pool initialization.',
        'When enabled, any mint authority may create a pool for their mint',
        'without requiring the program upgrade authority.',
      ],
      accounts: [
        {
          name: 'config',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: false,
          isSigner: true,
        },
        {
          name: 'program',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'programData',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'selfServedAllowed',
          type: 'bool',
        },
      ],
    },
    {
      name: 'withdrawFeeTokens',
      docs: [
        'Sweeps the fees this pool accrued for `mint` in a single fee token into a recipient token',
        "account of the pool owner's choosing. Restricted to the pool owner.",
        '',
        'If `amount` is provided, only the requested amount is transferred. Otherwise (if None) the',
        'entire balance is transferred.',
      ],
      accounts: [
        {
          name: 'state',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'mint',
          isMut: false,
          isSigner: false,
          docs: [
            'The token this pool wraps. Unrelated to `fee_token_mint`, but part of the fee vault seeds.',
          ],
        },
        {
          name: 'feeVault',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'feeVaultTokenAccount',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'recipient',
          isMut: true,
          isSigner: false,
          docs: [
            'Where the fees go. Freely chosen by the pool owner, unlike the executor and the CCVs, which',
            'pin the destination to a `fee_aggregator` held in their config.',
          ],
        },
        {
          name: 'feeTokenMint',
          isMut: false,
          isSigner: false,
          docs: [
            'The token the fees were billed in, which is whatever the sender paid with, so a pool',
            'accrues one vault ATA per fee token it has ever been paid in.',
          ],
        },
        {
          name: 'feeTokenProgram',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'authority',
          isMut: false,
          isSigner: true,
        },
      ],
      args: [
        {
          name: 'amount',
          type: {
            option: 'u64',
          },
        },
      ],
    },
  ],
  accounts: [
    {
      name: 'chainConfig',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'base',
            type: {
              defined: 'BaseChain',
            },
          },
        ],
      },
    },
    {
      name: 'chainConfigOverride',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'bump',
            type: 'u8',
          },
          {
            name: 'version',
            type: 'u8',
          },
          {
            name: 'base',
            type: {
              defined: 'BaseOverrideConfig',
            },
          },
        ],
      },
    },
    {
      name: 'chainConfigV2',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'bump',
            type: 'u8',
          },
          {
            name: 'version',
            type: 'u8',
          },
          {
            name: 'remoteChainSelector',
            type: 'u64',
          },
          {
            name: 'mint',
            type: 'publicKey',
          },
          {
            name: 'allowedFinalityConfig',
            docs: [
              'Allowed finality policy for *outbound* (lock_or_burn) transfers on this lane.',
              "Mirrors EVM's pool-wide `s_allowedFinalityConfig`. Zero-initialized",
              '(`WAIT_FOR_FINALITY`) means only full-finality transfers are permitted.',
            ],
            type: {
              defined: 'FinalityConfig',
            },
          },
          {
            name: 'tokenTransferFeeConfig',
            type: {
              defined: 'TokenTransferFeeConfig',
            },
          },
          {
            name: 'ccvConfig',
            type: {
              defined: 'CCVConfig',
            },
          },
        ],
      },
    },
    {
      name: 'poolConfig',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'version',
            type: 'u8',
          },
          {
            name: 'selfServedAllowed',
            type: 'bool',
          },
          {
            name: 'router',
            type: 'publicKey',
          },
          {
            name: 'rmnRemote',
            type: 'publicKey',
          },
        ],
      },
    },
    {
      name: 'state',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'version',
            type: 'u8',
          },
          {
            name: 'config',
            type: {
              defined: 'BaseConfig',
            },
          },
        ],
      },
    },
  ],
  errors: [
    {
      code: 6000,
      name: 'InvalidMultisig',
      msg: 'Invalid Multisig Mint',
    },
    {
      code: 6001,
      name: 'MintAuthorityAlreadySet',
      msg: 'Mint Authority already set',
    },
    {
      code: 6002,
      name: 'FixedMintToken',
      msg: 'Token with no Mint Authority',
    },
    {
      code: 6003,
      name: 'UnsupportedTokenProgram',
      msg: 'Unsupported Token Program',
    },
    {
      code: 6004,
      name: 'InvalidToken2022Multisig',
      msg: 'Invalid Multisig Account Data for Token 2022',
    },
    {
      code: 6005,
      name: 'InvalidSPLTokenMultisig',
      msg: 'Invalid Multisig Account Data for SPL Token',
    },
    {
      code: 6006,
      name: 'PoolSignerNotInMultisig',
      msg: 'Token Pool Signer PDA must be m times a signer of the Multisig',
    },
    {
      code: 6007,
      name: 'MultisigMustHaveAtLeastTwoSigners',
      msg: 'Multisig must have at least 2 valid signers',
    },
    {
      code: 6008,
      name: 'MultisigMustHaveMoreThanOneSigner',
      msg: 'Multisig must have more than one required signer',
    },
    {
      code: 6009,
      name: 'InvalidMultisigOwner',
      msg: 'Multisig Owner must match Token Program ID',
    },
    {
      code: 6010,
      name: 'InvalidMultisigThreshold',
      msg: 'Invalid multisig threshold: required signatures cannot exceed total signers',
    },
    {
      code: 6011,
      name: 'InvalidMultisigThresholdTooHigh',
      msg: 'Invalid multisig m: required signatures cannot exceed the available for outside signers',
    },
  ],
  types: [
    {
      name: 'BaseChain',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'remote',
            type: {
              defined: 'RemoteConfig',
            },
          },
          {
            name: 'inboundRateLimit',
            type: {
              defined: 'RateLimitTokenBucket',
            },
          },
          {
            name: 'outboundRateLimit',
            type: {
              defined: 'RateLimitTokenBucket',
            },
          },
        ],
      },
    },
    {
      name: 'BaseConfig',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'tokenProgram',
            type: 'publicKey',
          },
          {
            name: 'mint',
            type: 'publicKey',
          },
          {
            name: 'decimals',
            type: 'u8',
          },
          {
            name: 'poolSigner',
            type: 'publicKey',
          },
          {
            name: 'poolTokenAccount',
            type: 'publicKey',
          },
          {
            name: 'owner',
            type: 'publicKey',
          },
          {
            name: 'proposedOwner',
            type: 'publicKey',
          },
          {
            name: 'rateLimitAdmin',
            type: 'publicKey',
          },
          {
            name: 'routerOnrampAuthority',
            type: 'publicKey',
          },
          {
            name: 'router',
            type: 'publicKey',
          },
          {
            name: 'rebalancer',
            docs: [
              'Set the rebalancer address for the pool; if set to the default "no rebalance" address',
              '(Pubkey::default()), no rebalance is allowed.',
            ],
            type: 'publicKey',
          },
          {
            name: 'canAcceptLiquidity',
            docs: [
              'DEPRECATED: this field is no longer enforced at runtime. It is kept for backward',
              'compatibility (no PDA migration) and is always initialized to `true`.',
              'To disable inflows operationally, set the rebalancer to `Pubkey::default()`.',
            ],
            type: 'bool',
          },
          {
            name: 'listEnabled',
            type: 'bool',
          },
          {
            name: 'allowList',
            type: {
              vec: 'publicKey',
            },
          },
          {
            name: 'rmnRemote',
            type: 'publicKey',
          },
        ],
      },
    },
    {
      name: 'BaseOverrideConfig',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'remoteChainSelector',
            type: 'u64',
          },
          {
            name: 'mint',
            type: 'publicKey',
          },
          {
            name: 'inboundRateLimit',
            type: {
              defined: 'RateLimitTokenBucket',
            },
          },
          {
            name: 'outboundRateLimit',
            type: {
              defined: 'RateLimitTokenBucket',
            },
          },
          {
            name: 'overrideType',
            type: {
              defined: 'PoolChainConfigOverrideType',
            },
          },
        ],
      },
    },
    {
      name: 'CCVConfig',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'thresholdAmount',
            type: 'u64',
          },
          {
            name: 'outboundCcvs',
            type: {
              vec: 'publicKey',
            },
          },
          {
            name: 'thresholdOutboundCcvs',
            type: {
              vec: 'publicKey',
            },
          },
          {
            name: 'inboundCcvs',
            type: {
              vec: 'publicKey',
            },
          },
          {
            name: 'thresholdInboundCcvs',
            type: {
              vec: 'publicKey',
            },
          },
        ],
      },
    },
    {
      name: 'ChainConfig',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'base',
            type: {
              defined: 'BaseChain',
            },
          },
        ],
      },
    },
    {
      name: 'ChainConfigOverride',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'bump',
            type: 'u8',
          },
          {
            name: 'version',
            type: 'u8',
          },
          {
            name: 'base',
            type: {
              defined: 'BaseOverrideConfig',
            },
          },
        ],
      },
    },
    {
      name: 'ChainConfigV2',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'bump',
            type: 'u8',
          },
          {
            name: 'version',
            type: 'u8',
          },
          {
            name: 'remoteChainSelector',
            type: 'u64',
          },
          {
            name: 'mint',
            type: 'publicKey',
          },
          {
            name: 'allowedFinalityConfig',
            docs: [
              'Allowed finality policy for *outbound* (lock_or_burn) transfers on this lane.',
              "Mirrors EVM's pool-wide `s_allowedFinalityConfig`. Zero-initialized",
              '(`WAIT_FOR_FINALITY`) means only full-finality transfers are permitted.',
            ],
            type: {
              defined: 'FinalityConfig',
            },
          },
          {
            name: 'tokenTransferFeeConfig',
            type: {
              defined: 'TokenTransferFeeConfig',
            },
          },
          {
            name: 'ccvConfig',
            type: {
              defined: 'CCVConfig',
            },
          },
        ],
      },
    },
    {
      name: 'DeleteChainConfigOverrideParams',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'remoteChainSelector',
            type: 'u64',
          },
          {
            name: 'mint',
            type: 'publicKey',
          },
          {
            name: 'overrideType',
            type: {
              defined: 'PoolChainConfigOverrideType',
            },
          },
        ],
      },
    },
    {
      name: 'DeriveAccountsResponse',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'askAgainWith',
            type: {
              vec: {
                defined: 'base_token_pool::v1::CcipAccountMeta',
              },
            },
          },
          {
            name: 'accountsToSave',
            type: {
              vec: {
                defined: 'base_token_pool::v1::CcipAccountMeta',
              },
            },
          },
          {
            name: 'lookUpTablesToSave',
            type: {
              vec: 'publicKey',
            },
          },
          {
            name: 'currentStage',
            type: 'string',
          },
          {
            name: 'nextStage',
            type: 'string',
          },
        ],
      },
    },
    {
      name: 'FinalityConfig',
      docs: [
        'Per-message finality configuration. Wire-format: 4 bytes big-endian (flags || block_depth).',
        "Mirrors the `bytes4` Finality type in chainlink-ccv's `protocol/finality.go`.",
        '',
        'Layout (MSB first):',
        'flags[15:1]  — reserved',
        'flags[0]     — S: wait for `safe` head instead of full finality',
        'block_depth  — number of block confirmations required (0 = full finality / safe, per flags)',
      ],
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'flags',
            type: 'u16',
          },
          {
            name: 'blockDepth',
            type: 'u16',
          },
        ],
      },
    },
    {
      name: 'GetFeeParams',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'remoteChainSelector',
            type: 'u64',
          },
          {
            name: 'amount',
            type: 'u64',
          },
          {
            name: 'localToken',
            type: 'publicKey',
          },
          {
            name: 'feeToken',
            type: 'publicKey',
          },
          {
            name: 'requestedFinalityConfig',
            type: {
              defined: 'FinalityConfig',
            },
          },
          {
            name: 'tokenArgs',
            type: 'bytes',
          },
        ],
      },
    },
    {
      name: 'GetFeeResult',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'destGasLimit',
            type: 'u32',
          },
          {
            name: 'destBytesOverhead',
            type: 'u32',
          },
          {
            name: 'fee',
            type: 'u32',
          },
          {
            name: 'tokenFeeBps',
            type: 'u16',
          },
          {
            name: 'isEnabled',
            type: 'bool',
          },
        ],
      },
    },
    {
      name: 'GetRequiredCCVsIn',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'remoteChainSelector',
            type: 'u64',
          },
          {
            name: 'amount',
            docs: [
              'Token amount used to determine the required CCVs.',
              '',
              "For inbound transfers, the amount is denominated in the remote token's decimals",
              'and must be converted to local token decimals before applying amount-based CCV',
              'policies. For outbound transfers, the amount is already denominated in local',
              "token decimals, but is the gross amount before the pool's in-token BPS fee: the",
              'pool deducts that fee before applying amount-based CCV policies, as it only sends',
              'the post-fee remainder cross-chain. Inbound amounts are already post-fee.',
            ],
            type: {
              defined: 'ProtocolAmount',
            },
          },
          {
            name: 'localToken',
            type: 'publicKey',
          },
          {
            name: 'direction',
            type: {
              defined: 'MessageDirection',
            },
          },
          {
            name: 'requestedFinalityConfig',
            type: {
              defined: 'FinalityConfig',
            },
          },
        ],
      },
    },
    {
      name: 'GetRequiredCCVsOut',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'requiredCcvs',
            type: {
              vec: 'publicKey',
            },
          },
        ],
      },
    },
    {
      name: 'InitChainConfigOverrideParams',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'remoteChainSelector',
            type: 'u64',
          },
          {
            name: 'mint',
            type: 'publicKey',
          },
          {
            name: 'overrideType',
            type: {
              defined: 'PoolChainConfigOverrideType',
            },
          },
          {
            name: 'inbound',
            type: {
              defined: 'RateLimitConfig',
            },
          },
          {
            name: 'outbound',
            type: {
              defined: 'RateLimitConfig',
            },
          },
        ],
      },
    },
    {
      name: 'LockOrBurnInV1',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'receiver',
            type: 'bytes',
          },
          {
            name: 'remoteChainSelector',
            type: 'u64',
          },
          {
            name: 'originalSender',
            type: 'publicKey',
          },
          {
            name: 'amount',
            type: 'u64',
          },
          {
            name: 'localToken',
            type: 'publicKey',
          },
          {
            name: 'msgTotalNonce',
            docs: [
              "DEPRECATED. The onramp's full nonce for this message, keyed by `original_sender` and",
              '`remote_chain_selector`. Still populated with a real value by the 1.6 onramp',
              "(`ccip-router`'s `instructions_v1/v1/onramp.rs`), but hard-coded to `0` by `ccip_send_v2`,",
              'which no longer tracks per-sender nonces.',
              '',
              'The only pool that reads it is `cctp-token-pool`, which uses it as a PDA seed for the',
              "`cctp_message_sent_event` account (see that program's `lib.rs` and `derive.rs`). A constant",
              '`0` would therefore collide across messages — so the `0` is only sound because a CCTP v1 pool',
              'can never be reached from `ccip_send_v2`:',
              '',
              '- CCTP and Lombard are the only v1 pools that set `implements_account_resolution`.',
              "- `TokenTransferContext::new` (the router's `instructions/common.rs`) verifies the",
              '`TokenAdminRegistry` PDA and then rejects `interface_version == 1` &&',
              '`implements_account_resolution` with `UnsupportedPoolV1ResolutionOnLaneV2`. That runs in',
              '`ccip_send_v2` before any pool CPI, so it is the authoritative gate; the account-resolution',
              'stage (`ccip_send/resolve_accounts/token_transfer_static.rs`) rejects the same combination',
              'earlier, but is only advisory since callers can build the transaction themselves.',
              '- `set_pool_interface_implementation` additionally refuses to register',
              '`implements_account_resolution` below `interface_version` 2. The runtime check still',
              'matters because registries migrated from 1.6 can carry the v1/resolution combination.',
              '',
              'Removing the field outright is a breaking change to the v1 pool interface, so it stays until',
              'the 1.6 lane is retired. Anything that starts consuming it must not assume it is meaningful',
              'on the v2 lane.',
            ],
            type: 'u64',
          },
        ],
      },
    },
    {
      name: 'LockOrBurnInV2',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'receiver',
            type: 'bytes',
          },
          {
            name: 'remoteChainSelector',
            type: 'u64',
          },
          {
            name: 'originalSender',
            type: 'publicKey',
          },
          {
            name: 'amount',
            type: 'u64',
          },
          {
            name: 'localToken',
            type: 'publicKey',
          },
          {
            name: 'requestedFinalityConfig',
            type: {
              defined: 'FinalityConfig',
            },
          },
          {
            name: 'tokenArgs',
            type: 'bytes',
          },
        ],
      },
    },
    {
      name: 'LockOrBurnOutV1',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'destTokenAddress',
            type: {
              defined: 'RemoteAddress',
            },
          },
          {
            name: 'destPoolData',
            type: 'bytes',
          },
        ],
      },
    },
    {
      name: 'LockOrBurnOutV2',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'destTokenAddress',
            type: {
              defined: 'RemoteAddress',
            },
          },
          {
            name: 'destPoolData',
            type: 'bytes',
          },
          {
            name: 'destTokenAmount',
            type: 'u64',
          },
        ],
      },
    },
    {
      name: 'MessageDirection',
      docs: ['Direction of a cross-chain message, used for CCV requirements.'],
      type: {
        kind: 'enum',
        variants: [
          {
            name: 'Outbound',
          },
          {
            name: 'Inbound',
          },
        ],
      },
    },
    {
      name: 'NestedResolveAccountsParams',
      docs: [
        'Resolution parameters used by nested resolvers. Rather than the full ix_data and a metadata',
        'field, they have an opaque `cpi_resolution_inputs` field that doubles as both. The caller',
        'of the nested resolution is responsible for correctly encoding it by consulting',
        'the documentation.',
      ],
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'caller',
            docs: ['The account expected to sign the final instruction being resolved.'],
            type: 'publicKey',
          },
          {
            name: 'callerProgram',
            docs: [
              'The program ID that derived `caller` and is driving this resolution (the router on the',
              'send side, the offramp on the execute side).',
            ],
            type: 'publicKey',
          },
          {
            name: 'cpiResolutionInputs',
            docs: [
              'Will be deserialized into a type the nested resolver understands. For what to',
              "send in the first stage of nested resolution, consult the nested resolver's documentation.",
            ],
            type: 'bytes',
          },
        ],
      },
    },
    {
      name: 'NestedResolveAccountsResponse',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'askAgainWith',
            docs: [
              'In the next resolution round, call the resolution method',
              'including these accounts (all read-only).',
            ],
            type: {
              vec: 'publicKey',
            },
          },
          {
            name: 'accountsToSave',
            docs: [
              'Append these accounts to a separate accumulator list. Once',
              '`next_ix_discriminator` is empty, this accumulated list',
              'contains all accounts for the instruction of interest.',
            ],
            type: {
              vec: {
                defined: 'ccip_common::resolution::CcipAccountMeta',
              },
            },
          },
          {
            name: 'lookupTablesToSave',
            docs: [
              'Append these lookup tables to a separate accumulator list.',
              'Once resolution is complete, the accumulated list contains all',
              'LUTs that the instruction of interest can use.',
            ],
            type: {
              vec: 'publicKey',
            },
          },
          {
            name: 'nextCpiResolutionInputs',
            docs: ['If nonempty, perform another resolution stage with these inputs.'],
            type: 'bytes',
          },
        ],
      },
    },
    {
      name: 'PoolChainConfigObservation',
      docs: ['Per-remote-chain configuration of a token pool, as observed by off-chain consumers.'],
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'observationVersion',
            type: 'u16',
          },
          {
            name: 'typeVersion',
            type: 'string',
          },
          {
            name: 'remoteChainSelector',
            type: 'u64',
          },
          {
            name: 'mint',
            type: 'publicKey',
          },
          {
            name: 'remoteTokenAddress',
            docs: ['Token address on the remote chain, as raw bytes.'],
            type: 'bytes',
          },
          {
            name: 'remoteDecimals',
            type: 'u8',
          },
          {
            name: 'remotePoolAddresses',
            docs: [
              'Pool addresses on the remote chain, as raw bytes. More than one entry means earlier pool',
              'versions are still accepted as sources.',
            ],
            type: {
              vec: 'bytes',
            },
          },
          {
            name: 'inboundRateLimit',
            type: {
              defined: 'RateLimiterObservation',
            },
          },
          {
            name: 'outboundRateLimit',
            type: {
              defined: 'RateLimiterObservation',
            },
          },
        ],
      },
    },
    {
      name: 'PoolChainConfigOverrideObservation',
      docs: [
        'Per-remote-chain, per-override-type rate limit override of a token pool, as observed by',
        'off-chain consumers.',
        '',
        'Override PDAs are optional: when a lane has no override of the requested type, the observing',
        'instruction fails, which callers can read as "not overridden".',
      ],
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'observationVersion',
            type: 'u16',
          },
          {
            name: 'typeVersion',
            type: 'string',
          },
          {
            name: 'version',
            type: 'u8',
          },
          {
            name: 'remoteChainSelector',
            type: 'u64',
          },
          {
            name: 'mint',
            type: 'publicKey',
          },
          {
            name: 'overrideType',
            docs: ['Which flavour of transfer this override applies to (e.g. fast transfers).'],
            type: {
              defined: 'PoolChainConfigOverrideType',
            },
          },
          {
            name: 'inboundRateLimit',
            type: {
              defined: 'RateLimiterObservation',
            },
          },
          {
            name: 'outboundRateLimit',
            type: {
              defined: 'RateLimiterObservation',
            },
          },
        ],
      },
    },
    {
      name: 'PoolChainConfigOverrideType',
      type: {
        kind: 'enum',
        variants: [
          {
            name: 'FTF',
          },
        ],
      },
    },
    {
      name: 'PoolChainConfigV2Observation',
      docs: [
        'Per-remote-chain CCIP 2.0 configuration of a token pool, as observed by off-chain consumers.',
      ],
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'observationVersion',
            type: 'u16',
          },
          {
            name: 'typeVersion',
            type: 'string',
          },
          {
            name: 'version',
            type: 'u8',
          },
          {
            name: 'remoteChainSelector',
            type: 'u64',
          },
          {
            name: 'mint',
            type: 'publicKey',
          },
          {
            name: 'thresholdAmount',
            docs: [
              'Transfer amount above which the threshold CCVs are additionally required. Zero disables the',
              'threshold lists.',
            ],
            type: 'u64',
          },
          {
            name: 'outboundCcvs',
            type: {
              vec: 'publicKey',
            },
          },
          {
            name: 'thresholdOutboundCcvs',
            type: {
              vec: 'publicKey',
            },
          },
          {
            name: 'inboundCcvs',
            type: {
              vec: 'publicKey',
            },
          },
          {
            name: 'thresholdInboundCcvs',
            type: {
              vec: 'publicKey',
            },
          },
          {
            name: 'allowedFinalityConfig',
            docs: ['Allowed finality policy for outbound (lock_or_burn) transfers on this lane.'],
            type: {
              defined: 'FinalityConfig',
            },
          },
        ],
      },
    },
    {
      name: 'PoolConfig',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'version',
            type: 'u8',
          },
          {
            name: 'selfServedAllowed',
            type: 'bool',
          },
          {
            name: 'router',
            type: 'publicKey',
          },
          {
            name: 'rmnRemote',
            type: 'publicKey',
          },
        ],
      },
    },
    {
      name: 'PoolStateObservation',
      docs: [
        'Per-mint configuration of a token pool, as observed by off-chain consumers.',
        '',
        'The allow list is reported as a count only, as its size is unbounded by configuration.',
      ],
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'observationVersion',
            type: 'u16',
          },
          {
            name: 'typeVersion',
            type: 'string',
          },
          {
            name: 'version',
            type: 'u8',
          },
          {
            name: 'tokenProgram',
            type: 'publicKey',
          },
          {
            name: 'mint',
            type: 'publicKey',
          },
          {
            name: 'decimals',
            type: 'u8',
          },
          {
            name: 'poolSigner',
            type: 'publicKey',
          },
          {
            name: 'poolTokenAccount',
            type: 'publicKey',
          },
          {
            name: 'owner',
            type: 'publicKey',
          },
          {
            name: 'proposedOwner',
            type: 'publicKey',
          },
          {
            name: 'rateLimitAdmin',
            type: 'publicKey',
          },
          {
            name: 'router',
            type: 'publicKey',
          },
          {
            name: 'routerOnrampAuthority',
            type: 'publicKey',
          },
          {
            name: 'rmnRemote',
            type: 'publicKey',
          },
          {
            name: 'rebalancer',
            docs: [
              'Rebalancer, only meaningful for lock/release pools. The default pubkey means rebalancing is',
              'not allowed.',
            ],
            type: 'publicKey',
          },
          {
            name: 'listEnabled',
            type: 'bool',
          },
          {
            name: 'allowListCount',
            type: 'u32',
          },
        ],
      },
    },
    {
      name: 'ProtocolAmount',
      docs: [
        'CCIP 2.0 compatible cross-chain amount representation (u256 in big-endian bytes, based',
        'on abi.encodePacked)',
      ],
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'beBytes',
            type: {
              array: ['u8', 32],
            },
          },
        ],
      },
    },
    {
      name: 'RateLimitConfig',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'enabled',
            type: 'bool',
          },
          {
            name: 'capacity',
            type: 'u64',
          },
          {
            name: 'rate',
            type: 'u64',
          },
        ],
      },
    },
    {
      name: 'RateLimitTokenBucket',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'tokens',
            type: 'u64',
          },
          {
            name: 'lastUpdated',
            type: 'u64',
          },
          {
            name: 'cfg',
            type: {
              defined: 'RateLimitConfig',
            },
          },
        ],
      },
    },
    {
      name: 'RateLimiterObservation',
      docs: ['State of one rate limiter bucket, as of the moment of observation.'],
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'isEnabled',
            type: 'bool',
          },
          {
            name: 'capacity',
            type: 'u64',
          },
          {
            name: 'rate',
            type: 'u64',
          },
          {
            name: 'tokens',
            docs: [
              'Tokens available now: the stored balance plus the refill accrued since the bucket was last',
              "touched, capped at `capacity`. This is the value EVM's `getCurrent*RateLimiterState`",
              'returns, not the raw stored balance.',
            ],
            type: 'u64',
          },
          {
            name: 'lastUpdated',
            docs: [
              'Timestamp the `tokens` value corresponds to (the observation time, for an enabled bucket).',
            ],
            type: 'u64',
          },
        ],
      },
    },
    {
      name: 'ReleaseOrMintInV1',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'originalSender',
            type: {
              defined: 'RemoteAddress',
            },
          },
          {
            name: 'remoteChainSelector',
            type: 'u64',
          },
          {
            name: 'receiver',
            type: 'publicKey',
          },
          {
            name: 'amount',
            type: {
              array: ['u8', 32],
            },
          },
          {
            name: 'localToken',
            type: 'publicKey',
          },
          {
            name: 'sourcePoolAddress',
            docs: [
              '@dev WARNING: sourcePoolAddress should be checked prior to any processing of funds. Make sure it matches the',
              'expected pool address for the given remoteChainSelector.',
            ],
            type: {
              defined: 'RemoteAddress',
            },
          },
          {
            name: 'sourcePoolData',
            type: 'bytes',
          },
          {
            name: 'offchainTokenData',
            docs: ['@dev WARNING: offchainTokenData is untrusted data.'],
            type: 'bytes',
          },
        ],
      },
    },
    {
      name: 'ReleaseOrMintInV2',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'originalSender',
            type: {
              defined: 'RemoteAddress',
            },
          },
          {
            name: 'remoteChainSelector',
            type: 'u64',
          },
          {
            name: 'receiver',
            type: 'publicKey',
          },
          {
            name: 'amount',
            type: {
              defined: 'ProtocolAmount',
            },
          },
          {
            name: 'localToken',
            type: 'publicKey',
          },
          {
            name: 'sourcePoolAddress',
            type: {
              defined: 'RemoteAddress',
            },
          },
          {
            name: 'sourcePoolData',
            type: 'bytes',
          },
          {
            name: 'requestedFinalityConfig',
            type: {
              defined: 'FinalityConfig',
            },
          },
          {
            name: 'receiverUsage',
            type: {
              defined: 'SVMTokenReceiverUsage',
            },
          },
        ],
      },
    },
    {
      name: 'ReleaseOrMintOutV1',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'destinationAmount',
            type: 'u64',
          },
        ],
      },
    },
    {
      name: 'ReleaseOrMintOutV2',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'destinationAmount',
            type: 'u64',
          },
        ],
      },
    },
    {
      name: 'RemoteAddress',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'address',
            type: 'bytes',
          },
        ],
      },
    },
    {
      name: 'RemoteConfig',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'poolAddresses',
            type: {
              vec: {
                defined: 'RemoteAddress',
              },
            },
          },
          {
            name: 'tokenAddress',
            type: {
              defined: 'RemoteAddress',
            },
          },
          {
            name: 'decimals',
            type: 'u8',
          },
        ],
      },
    },
    {
      name: 'SVMTokenReceiverUsage',
      type: {
        kind: 'enum',
        variants: [
          {
            name: 'DeriveAtaAndCreate',
          },
          {
            name: 'DeriveAtaDontCreate',
          },
          {
            name: 'UseAsIs',
          },
        ],
      },
    },
    {
      name: 'SetChainConfigOverrideRateLimitParams',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'remoteChainSelector',
            type: 'u64',
          },
          {
            name: 'mint',
            type: 'publicKey',
          },
          {
            name: 'overrideType',
            type: {
              defined: 'PoolChainConfigOverrideType',
            },
          },
          {
            name: 'inbound',
            type: {
              defined: 'RateLimitConfig',
            },
          },
          {
            name: 'outbound',
            type: {
              defined: 'RateLimitConfig',
            },
          },
        ],
      },
    },
    {
      name: 'SetChainConfigV2Params',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'mint',
            type: 'publicKey',
          },
          {
            name: 'remoteChainSelector',
            type: 'u64',
          },
          {
            name: 'allowedFinalityConfig',
            docs: [
              'Allowed finality policy for outbound (lock_or_burn) transfers on this lane.',
              '`WAIT_FOR_FINALITY` (zero) permits only full-finality transfers.',
            ],
            type: {
              defined: 'FinalityConfig',
            },
          },
          {
            name: 'tokenTransferFeeConfig',
            type: {
              defined: 'TokenTransferFeeConfig',
            },
          },
          {
            name: 'ccvConfig',
            type: {
              defined: 'CCVConfig',
            },
          },
        ],
      },
    },
    {
      name: 'State',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'version',
            type: 'u8',
          },
          {
            name: 'config',
            type: {
              defined: 'BaseConfig',
            },
          },
        ],
      },
    },
    {
      name: 'TokenTransferFeeConfig',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'destGasOverhead',
            type: 'u32',
          },
          {
            name: 'destBytesOverhead',
            type: 'u32',
          },
          {
            name: 'finalityFee',
            type: 'u32',
          },
          {
            name: 'fastFinalityFee',
            type: 'u32',
          },
          {
            name: 'finalityBpsFee',
            type: 'u16',
          },
          {
            name: 'fastFinalityBpsFee',
            type: 'u16',
          },
          {
            name: 'isEnabled',
            type: 'bool',
          },
        ],
      },
    },
    {
      name: 'base_token_pool::v1::CcipAccountMeta',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'pubkey',
            type: 'publicKey',
          },
          {
            name: 'isSigner',
            type: 'bool',
          },
          {
            name: 'isWritable',
            type: 'bool',
          },
        ],
      },
    },
    {
      name: 'ccip_common::resolution::CcipAccountMeta',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'pubkey',
            type: 'publicKey',
          },
          {
            name: 'isSigner',
            type: 'bool',
          },
          {
            name: 'isWritable',
            type: 'bool',
          },
        ],
      },
    },
  ],
}
