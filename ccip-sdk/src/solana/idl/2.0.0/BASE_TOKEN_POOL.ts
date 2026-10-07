/**
 * Minimal CCIP v2 (`burnmint-token-pool 2.0.0-dev`) token pool IDL.
 *
 * Describes the accounts the SDK reads from canonical token pools: the pool `State`, the per-remote
 * `ChainConfig`, and the faster-than-finality (FTF) `ChainConfigOverride`. `State` and `ChainConfig`
 * are Borsh-identical to their 1.6 layouts, so this IDL reads both 1.6 and 2.0 pools. `BaseConfig`
 * only declares its fields up to `router`: Borsh ignores trailing bytes, so pools whose `State`
 * carries extra or older trailing fields still decode. `ChainConfig` is the burn-mint and
 * lock-release layout; CCTP and Lombard pools prefix it with a schema version byte. Instructions are
 * not listed. Anchor 0.29 IDL format.
 */
export type BaseTokenPoolV2 = {
  version: '2.0.0'
  name: 'base_token_pool'
  instructions: []
  accounts: [
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
    {
      name: 'chainConfig'
      type: {
        kind: 'struct'
        fields: [{ name: 'base'; type: { defined: 'BaseChain' } }]
      }
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
  ]
  types: [
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
        ]
      }
    },
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
      name: 'PoolChainConfigOverrideType'
      type: { kind: 'enum'; variants: [{ name: 'FTF' }] }
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
      name: 'RemoteAddress'
      type: {
        kind: 'struct'
        fields: [{ name: 'address'; type: 'bytes' }]
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
  ]
}

export const IDL: BaseTokenPoolV2 = {
  version: '2.0.0',
  name: 'base_token_pool',
  instructions: [],
  accounts: [
    {
      name: 'state',
      type: {
        kind: 'struct',
        fields: [
          { name: 'version', type: 'u8' },
          { name: 'config', type: { defined: 'BaseConfig' } },
        ],
      },
    },
    {
      name: 'chainConfig',
      type: {
        kind: 'struct',
        fields: [{ name: 'base', type: { defined: 'BaseChain' } }],
      },
    },
    {
      name: 'chainConfigOverride',
      type: {
        kind: 'struct',
        fields: [
          { name: 'bump', type: 'u8' },
          { name: 'version', type: 'u8' },
          { name: 'base', type: { defined: 'BaseOverrideConfig' } },
        ],
      },
    },
  ],
  types: [
    {
      name: 'BaseConfig',
      type: {
        kind: 'struct',
        fields: [
          { name: 'tokenProgram', type: 'publicKey' },
          { name: 'mint', type: 'publicKey' },
          { name: 'decimals', type: 'u8' },
          { name: 'poolSigner', type: 'publicKey' },
          { name: 'poolTokenAccount', type: 'publicKey' },
          { name: 'owner', type: 'publicKey' },
          { name: 'proposedOwner', type: 'publicKey' },
          { name: 'rateLimitAdmin', type: 'publicKey' },
          { name: 'routerOnrampAuthority', type: 'publicKey' },
          { name: 'router', type: 'publicKey' },
        ],
      },
    },
    {
      name: 'BaseChain',
      type: {
        kind: 'struct',
        fields: [
          { name: 'remote', type: { defined: 'RemoteConfig' } },
          { name: 'inboundRateLimit', type: { defined: 'RateLimitTokenBucket' } },
          { name: 'outboundRateLimit', type: { defined: 'RateLimitTokenBucket' } },
        ],
      },
    },
    {
      name: 'BaseOverrideConfig',
      type: {
        kind: 'struct',
        fields: [
          { name: 'remoteChainSelector', type: 'u64' },
          { name: 'mint', type: 'publicKey' },
          { name: 'inboundRateLimit', type: { defined: 'RateLimitTokenBucket' } },
          { name: 'outboundRateLimit', type: { defined: 'RateLimitTokenBucket' } },
          { name: 'overrideType', type: { defined: 'PoolChainConfigOverrideType' } },
        ],
      },
    },
    {
      name: 'PoolChainConfigOverrideType',
      type: { kind: 'enum', variants: [{ name: 'FTF' }] },
    },
    {
      name: 'RemoteConfig',
      type: {
        kind: 'struct',
        fields: [
          { name: 'poolAddresses', type: { vec: { defined: 'RemoteAddress' } } },
          { name: 'tokenAddress', type: { defined: 'RemoteAddress' } },
          { name: 'decimals', type: 'u8' },
        ],
      },
    },
    {
      name: 'RemoteAddress',
      type: {
        kind: 'struct',
        fields: [{ name: 'address', type: 'bytes' }],
      },
    },
    {
      name: 'RateLimitTokenBucket',
      type: {
        kind: 'struct',
        fields: [
          { name: 'tokens', type: 'u64' },
          { name: 'lastUpdated', type: 'u64' },
          { name: 'cfg', type: { defined: 'RateLimitConfig' } },
        ],
      },
    },
    {
      name: 'RateLimitConfig',
      type: {
        kind: 'struct',
        fields: [
          { name: 'enabled', type: 'bool' },
          { name: 'capacity', type: 'u64' },
          { name: 'rate', type: 'u64' },
        ],
      },
    },
  ],
}
