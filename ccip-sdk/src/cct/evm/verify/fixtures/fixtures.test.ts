import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { keccak256, toUtf8Bytes } from 'ethers'

import { loadStandardJson } from './index.ts'
import BURN_FROM_MINT_BYTECODE from '../../artifacts/bytecode/V2_0_0/burn-from-mint-token-pool.ts'
import BURN_MINT_BYTECODE from '../../artifacts/bytecode/V2_0_0/burn-mint-token-pool.ts'
import BURN_WITH_FROM_MINT_BYTECODE from '../../artifacts/bytecode/V2_0_0/burn-with-from-mint-token-pool.ts'
import CROSS_CHAIN_TOKEN_BYTECODE from '../../artifacts/bytecode/V2_0_0/cross-chain-token.ts'
import ERC20_LOCKBOX_BYTECODE from '../../artifacts/bytecode/V2_0_0/erc20-lockbox.ts'
import LOCK_RELEASE_BYTECODE from '../../artifacts/bytecode/V2_0_0/lock-release-token-pool.ts'
import type { DeployableContract } from '../../deployable.ts'
import MANIFEST from './V2_0_0/manifest.ts'
import POOL from './V2_0_0/sources.ts'

/** The vendored creation bytecode each fixture claims to co-version with. */
const BYTECODE: Record<DeployableContract, string> = {
  CrossChainToken: CROSS_CHAIN_TOKEN_BYTECODE,
  ERC20LockBox: ERC20_LOCKBOX_BYTECODE,
  BurnMintTokenPool: BURN_MINT_BYTECODE,
  BurnFromMintTokenPool: BURN_FROM_MINT_BYTECODE,
  BurnWithFromMintTokenPool: BURN_WITH_FROM_MINT_BYTECODE,
  LockReleaseTokenPool: LOCK_RELEASE_BYTECODE,
}

const CONTRACTS = Object.keys(BYTECODE) as DeployableContract[]

/** `0x00081a` = solc 0.8.26, as CBOR-appended to every contract built by the release profile. */
const CBOR_SOLC_0_8_26 = 'a164736f6c634300081a'

void describe('verification fixtures', () => {
  void it('covers exactly the deployable contracts', () => {
    assert.deepEqual(Object.keys(MANIFEST.contracts).sort(), [...CONTRACTS].sort())
  })

  void it('references only source units present in the pool', () => {
    for (const contract of CONTRACTS) {
      for (const unit of MANIFEST.contracts[contract].sources) {
        assert.ok(POOL[unit], `${contract} references missing source unit ${unit}`)
      }
    }
  })

  void it('names each contract consistently across fqn, manifest key and source unit', () => {
    for (const contract of CONTRACTS) {
      const [unit, name] = MANIFEST.contracts[contract].fqn.split(':')
      assert.equal(name, contract)
      assert.ok(unit && POOL[unit], `${contract} fqn path ${unit} is not a pooled source unit`)
    }
  })

  void it('ties each fixture to the exact vendored bytecode it co-versions with', () => {
    for (const contract of CONTRACTS) {
      assert.equal(
        MANIFEST.contracts[contract].bytecodeKeccak,
        keccak256(toUtf8Bytes(BYTECODE[contract])),
        `${contract} fixture is stale relative to its vendored creation bytecode`,
      )
    }
  })

  void it('agrees with the compiler version recorded in the deployed bytecode', () => {
    // Search, do not tail-slice: some contracts carry trailing bytes after the CBOR marker.
    assert.ok(MANIFEST.compilerVersion.startsWith('v0.8.26'))
    for (const contract of CONTRACTS) {
      assert.ok(
        BYTECODE[contract].includes(CBOR_SOLC_0_8_26),
        `${contract} bytecode was not built by solc 0.8.26`,
      )
    }
  })

  void it('pins the release compiler settings', () => {
    assert.equal(MANIFEST.evmVersion, 'paris')
    assert.equal(MANIFEST.viaIR, true)
    assert.equal(MANIFEST.bytecodeHash, 'none')
    // Per-contract optimizer runs, from scripts/compile_all: pools build at 50k, the token at 80k.
    for (const contract of CONTRACTS) {
      const expected = contract === 'CrossChainToken' ? 80_000 : 50_000
      assert.equal(MANIFEST.contracts[contract].optimizerRuns, expected, contract)
    }
  })

  void it('keeps a non-empty outputSelection — solc emits no bytecode without one', () => {
    assert.ok(Object.keys(MANIFEST.outputSelection).length > 0)
  })
})

void describe('loadStandardJson', () => {
  void it('rebuilds a submittable input for every deployable contract', async () => {
    for (const contract of CONTRACTS) {
      const { input, fqn, compilerVersion } = await loadStandardJson(contract)
      assert.equal(fqn, MANIFEST.contracts[contract].fqn)
      assert.equal(compilerVersion, MANIFEST.compilerVersion)
      assert.equal(input.language, 'Solidity')
      assert.equal(
        Object.keys(input.sources).length,
        MANIFEST.contracts[contract].sources.length,
        contract,
      )
      // Every source must carry real content — never `{ content: undefined }`.
      for (const [unit, source] of Object.entries(input.sources)) {
        assert.equal(typeof source.content, 'string', `${contract}:${unit}`)
        assert.ok(source.content.length > 0, `${contract}:${unit}`)
      }
      assert.equal(input.settings.optimizer.runs, MANIFEST.contracts[contract].optimizerRuns)
      assert.ok(input.settings.remappings.length > 0)
    }
  })

  void it('throws for a contract with no fixture', async () => {
    await assert.rejects(
      () => loadStandardJson('NotAContract' as DeployableContract),
      /no verification fixture/,
    )
  })
})
