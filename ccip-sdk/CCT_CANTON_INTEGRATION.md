# CCT Canton SDK — integration guide

The SDK composes unsigned Canton transactions; the integrating app signs and submits
them via its wallet (`prepareExecute` → approve → execute).

## Deploy a token pool (one call, one approval)

```ts
const unsigned = await manager.generateUnsignedDeployTokenPool({
  poolType: 'burnMint',                    // or 'lockRelease'
  instanceId: 'mytoken-pool-001',
  poolOwner: issuerParty,                  // == instrumentId.admin (self-issued)
  ccipOwner: ccipOwnerParty,               // network constant (networks.ts)
  instrumentId: { admin: issuerParty, id: 'MYTOKEN' },
  decimals: 10,                            // token decimals ON CANTON (10 for Token Standard)
  observers: [edsObserverParty],           // mandatory — EDS auto-discovery party
  admin: issuerParty,
  tokenAdminRegistryInstanceAddress: tarAddress, // network constant
  lanes: [{
    remoteChainSelector: 16015286601757825753n,
    remotePools: ['0x<remote pool>'],
    remoteTokenAddress: '0x<remote token>',
    inboundCCVs: ['<ccv>@<ccvOwner>'],
    outboundCCVs: ['<ccv>@<ccvOwner>'],
    inbound:             { instanceId: '…-rl-in',        isEnabled: true, capacity, rate }, // capacity/rate in base units (10^decimals × tokens)
    outbound:            { instanceId: '…-rl-out',       isEnabled: true, capacity, rate },
    inboundCustomFinality: { instanceId: '…-rl-in-custom', isEnabled: true, capacity, rate },
  }],
  sender: issuerParty,
})
// → hand unsigned.commands to the wallet's prepareExecute. One command
//   (CreateAndExercise + Initialize): TAR registration + lane wiring +
//   3 rate limiters + SetPool all land in one transaction.
```

## Validate the deployment (read-only, no wallet)

```
CONFIG_JSON=pool.json node --experimental-strip-types ccip-sdk/examples/validate-pool-deployment.ts
```

9 checks (pool config, TAR registration, lane addresses + CCVs + limiter
references, factory wiring, all 3 rate limiters); exits non-zero on any failure.

## What the integrator provides

1. **Signer**: wallet connection consuming `unsigned.commands` (`{ commands, actAs, disclosedContracts, commandId }`) → `prepareExecute` → approve → execute.
2. **Ledger reads at compose time**: the caller's connection needs `CanReadAs` over the issuer party (composition resolves TAR/pool contracts via ACS).
3. **Network constants** (if not CV1 testnet): `ccipOwner`, TAR/FeeQuoter/RMNRemote addresses, EDS + ledger URLs — add to `networks.ts` or pass via env (`TAR_RAW`, `FEE_QUOTER_RAW`, `RMN_REMOTE_RAW`).

Reference implementation of the full flow: `ccip-sdk/examples/canton-pool-example.ts`.
