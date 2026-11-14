import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MULTISIG_SIZE, MultisigLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { deriveRouterConfigPda, deriveTokenAdminRegistryPda } from '../../programs/router.ts'
import {
  type GenerateOwnerOverridePendingAdministratorParams,
  OwnerOverridePendingAdministrator,
} from './owner-override-pending-administrator.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const ADDRESS = Keypair.generate().publicKey.toBase58()
const ROUTER = Keypair.generate().publicKey.toBase58()
const OWNER = Keypair.generate().publicKey.toBase58()
const NEW_ADMIN = Keypair.generate().publicKey.toBase58()
const HASH = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: new PublicKey(OWNER),
  signTransaction: async <T>(tx: T) => tx,
}

/** A mint whose mint authority is `mintAuthority`. */
function mintAccount(mintAuthority: PublicKey) {
  const data = Buffer.alloc(82)
  data.writeUInt32LE(1, 0)
  mintAuthority.toBuffer().copy(data, 4)
  data[44] = 9
  data[45] = 1
  return { data, executable: false, lamports: 1, owner: TOKEN_PROGRAM_ID, rentEpoch: 0 }
}

/** An initialized `m`-of-N SPL multisig of `signers`, owned by the mint's token program. */
function multisigAccount(m: number, signers: PublicKey[]) {
  const data = Buffer.alloc(MULTISIG_SIZE)
  MultisigLayout.encode(
    {
      m,
      n: signers.length,
      isInitialized: true,
      ...Object.fromEntries(
        Array.from({ length: 11 }, (_, i) => [`signer${i + 1}`, signers[i] ?? PublicKey.default]),
      ),
    } as never,
    data,
  )
  return { data, executable: false, lamports: 1, owner: TOKEN_PROGRAM_ID, rentEpoch: 0 }
}

/**
 * A chain whose token has `mintAuthority` (the owner by default); `mintAuthorityAccount` is that
 * account, e.g. a multisig.
 */
function stubChain(
  administrator = PublicKey.default.toBase58(),
  onAddress?: (address: string) => void,
  mintAuthority = new PublicKey(OWNER),
  mintAuthorityAccount: ReturnType<typeof multisigAccount> | null = null,
): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: async (address: PublicKey) => {
        if (address.toBase58() === TOKEN) return mintAccount(mintAuthority)
        if (address.equals(mintAuthority)) return mintAuthorityAccount
        return assert.fail('unexpected account lookup')
      },
      simulateTransaction: async () => ({ value: { err: null, logs: [], unitsConsumed: 1 } }),
      getLatestBlockhash: async () => ({
        blockhash: PublicKey.default.toBase58(),
        lastValidBlockHeight: 1,
      }),
      sendTransaction: async () => HASH,
      confirmTransaction: async () => ({ value: { err: null } }),
    },
    getTokenAdminRegistryFor: async (address: string) => {
      onAddress?.(address)
      return ROUTER
    },
    getRegistryTokenConfig: async () => ({ administrator }),
  } as unknown as SolanaChain
}

function generate(opts: Partial<GenerateOwnerOverridePendingAdministratorParams> = {}) {
  return new OwnerOverridePendingAdministrator().generate(stubChain(), {
    tokenAddress: TOKEN,
    address: ADDRESS,
    newAdmin: NEW_ADMIN,
    payer: OWNER,
    authority: OWNER,
    ...opts,
  })
}

describe('OwnerOverridePendingAdministrator (cct/solana)', () => {
  describe('generate', () => {
    it('builds an unsigned owner override pending administrator instruction', async () => {
      const unsigned = await generate()
      const [instruction] = unsigned.instructions

      assert.ok(instruction)
      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.equal(unsigned.mainIndex, 0)
      assert.equal(instruction.programId.toBase58(), ROUTER)
      assert.equal(instruction.data.subarray(0, 8).toString('hex'), 'e66f8695cba876c9')
      assert.deepEqual(instruction.data.subarray(8), new PublicKey(NEW_ADMIN).toBuffer())
      assert.deepEqual(
        instruction.keys.map(({ pubkey, isSigner, isWritable }) => ({
          pubkey: pubkey.toBase58(),
          isSigner,
          isWritable,
        })),
        [
          {
            pubkey: deriveRouterConfigPda(new PublicKey(ROUTER)).toBase58(),
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: deriveTokenAdminRegistryPda(
              new PublicKey(ROUTER),
              new PublicKey(TOKEN),
            ).toBase58(),
            isSigner: false,
            isWritable: true,
          },
          { pubkey: TOKEN, isSigner: false, isWritable: false },
          { pubkey: OWNER, isSigner: true, isWritable: true },
          { pubkey: PublicKey.default.toBase58(), isSigner: false, isWritable: false },
        ],
      )
    })

    it('resolves the router from address', async () => {
      let requestedAddress: string | undefined
      await new OwnerOverridePendingAdministrator().generate(
        stubChain(PublicKey.default.toBase58(), (address) => (requestedAddress = address)),
        { tokenAddress: TOKEN, address: ADDRESS, newAdmin: NEW_ADMIN, payer: OWNER },
      )

      assert.equal(requestedAddress, ADDRESS)
    })
  })

  describe('multisig mint authority', () => {
    const MULTISIG = Keypair.generate().publicKey

    function generateMultisig(m: number, authority = OWNER) {
      const chain = stubChain(
        undefined,
        undefined,
        MULTISIG,
        multisigAccount(m, [Keypair.generate().publicKey, new PublicKey(OWNER)]),
      )
      return new OwnerOverridePendingAdministrator().generate(chain, {
        tokenAddress: TOKEN,
        address: ADDRESS,
        newAdmin: NEW_ADMIN,
        payer: OWNER,
        authority,
      })
    }

    it('overrides through a signer of a 1-of-N multisig', async () => {
      const [instruction] = (await generateMultisig(1)).instructions

      assert.equal(instruction!.programId.toBase58(), ROUTER)
      // multisig_owner_override_pending_administrator, from the program's IDL
      assert.equal(instruction!.data.subarray(0, 8).toString('hex'), 'd0a8330336a6fdb9')
      assert.deepEqual(instruction!.data.subarray(8), new PublicKey(NEW_ADMIN).toBuffer())
      assert.deepEqual(
        instruction!.keys.map(({ pubkey, isSigner, isWritable }) => [
          pubkey.toBase58(),
          isSigner,
          isWritable,
        ]),
        [
          [deriveRouterConfigPda(new PublicKey(ROUTER)).toBase58(), false, false],
          [
            deriveTokenAdminRegistryPda(new PublicKey(ROUTER), new PublicKey(TOKEN)).toBase58(),
            false,
            true,
          ],
          [TOKEN, false, false],
          [OWNER, true, true],
          [MULTISIG.toBase58(), false, false],
          [SystemProgram.programId.toBase58(), false, false],
        ],
      )
    })

    it('rejects a non-signer or a multisig threshold above 1', async () => {
      for (const [m, authority] of [
        [1, NEW_ADMIN],
        [2, OWNER],
      ] as const) {
        await assert.rejects(
          () => generateMultisig(m, authority),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError && err.context.param === 'authority',
        )
      }
    })
  })

  describe('validation', () => {
    for (const param of ['tokenAddress', 'address', 'newAdmin', 'authority'] as const) {
      it(`rejects an invalid ${param}`, async () => {
        await assert.rejects(
          () => generate({ [param]: 'not-a-public-key' }),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
      })
    }

    it('rejects an accepted registry administrator before building the transaction', async () => {
      await assert.rejects(
        () =>
          new OwnerOverridePendingAdministrator().generate(stubChain(OWNER), {
            tokenAddress: TOKEN,
            address: ADDRESS,
            newAdmin: NEW_ADMIN,
            payer: OWNER,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'tokenAddress' &&
          typeof err.context.reason === 'string' &&
          err.context.reason.includes('The current administrator must use transferAdmin instead'),
      )
    })
  })

  describe('execute', () => {
    it('signs, submits, and returns the tx hash', async () => {
      assert.deepEqual(
        await new OwnerOverridePendingAdministrator().execute(stubChain(), {
          tokenAddress: TOKEN,
          address: ADDRESS,
          newAdmin: NEW_ADMIN,
          wallet: WALLET,
        }),
        { hash: HASH },
      )
    })

    it('requires the mint authority to be the executing wallet', async () => {
      await assert.rejects(
        () =>
          new OwnerOverridePendingAdministrator().execute(stubChain(), {
            tokenAddress: TOKEN,
            address: ADDRESS,
            newAdmin: NEW_ADMIN,
            authority: NEW_ADMIN,
            wallet: WALLET,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'authority' &&
          typeof err.context.reason === 'string' &&
          err.context.reason.includes('requires authority to be the executing wallet'),
      )
    })
  })
})
