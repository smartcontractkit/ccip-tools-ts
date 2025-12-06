import { type Wallet as AnchorWallet, AnchorProvider, Program } from '@coral-xyz/anchor'
import {
  type Connection,
  AddressLookupTableProgram,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js'
import { dataSlice, hexlify } from 'ethers'
import { memoize } from 'micro-memoize'

import { sleep } from '../utils.ts'
import { IDL as CCIP_OFFRAMP_IDL } from './idl/1.6.0/CCIP_OFFRAMP.ts'
import type { SolanaChain } from './index.ts'
import type { Wallet } from './types.ts'
import { simulateAndSendTxs } from './utils.ts'

/**
 * Clean up and recycle buffers and Address Lookup Tables owned by wallet
 * @param provider - AnchorProvider with connection and wallet
 * @param getLogs - SolanaChain-compatible getLogs function (to scan for Buffers and ALTs)
 * @param opts.dontWait - Whether to skip waiting for lookup table deactivation cool down period
 *   (513 slots) to pass before closing; by default, we deactivate (if needed) and wait to close
 *   before returning from this method
 */
export async function cleanUpBuffers(
  connection: Connection,
  wallet: Wallet,
  getLogs: SolanaChain['getLogs'],
  opts?: { waitDeactivation?: boolean },
): Promise<void> {
  console.debug(
    'Starting cleaning up buffers and lookup tables for account',
    wallet.publicKey.toString(),
  )

  const seenAccs = new Set<string>()
  const pendingPromises = []
  const getCurrentSlot = memoize(
    async () => {
      let lastErr
      for (let i = 0; i < 10; i++) {
        try {
          return await connection.getSlot()
        } catch (err) {
          lastErr = err
          console.warn('Failed to get current slot', i, err)
          await sleep(500)
        }
      }
      throw lastErr
    },
    { maxAge: 1000, async: true },
  )

  const closeAlt = async (lookupTable: PublicKey, deactivationSlot: number) => {
    const altAddr = lookupTable.toBase58()
    let sig
    while (!sig) {
      const delta = deactivationSlot + 513 - (await getCurrentSlot())
      if (delta > 0) {
        if (!opts?.waitDeactivation) {
          console.warn(
            'Skipping: lookup table',
            altAddr,
            'not yet ready for close until',
            0.4 * delta,
            'seconds',
          )
          return
        }
        console.debug(
          'Waiting for slot',
          deactivationSlot + 513,
          'to be reached in',
          0.4 * delta,
          'seconds before closing lookup table',
          altAddr,
        )
        await sleep(400 * delta)
      }

      const closeIx = AddressLookupTableProgram.closeLookupTable({
        authority: wallet.publicKey,
        recipient: wallet.publicKey,
        lookupTable,
      })
      try {
        sig = await simulateAndSendTxs(connection, wallet, { instructions: [closeIx] })
        console.info('🗑️  Closed lookup table', altAddr, ': tx =>', sig)
      } catch (err) {
        const info = await connection.getAddressLookupTable(lookupTable)
        if (!info?.value) break
        else if (info.value.state.deactivationSlot < 2n ** 63n)
          deactivationSlot = Number(info.value.state.deactivationSlot)
        console.warn('Failed to close lookup table', altAddr, err)
      }
    }
  }

  let alreadyClosed = 0
  for await (const log of getLogs({
    address: wallet.publicKey.toBase58(),
    topics: [
      'Instruction: BufferExecutionReport',
      'Instruction: CreateLookupTable',
      'Instruction: DeactivateLookupTable',
    ],
    programs: true,
  })) {
    const tx = log.tx
    switch (log.data) {
      case 'Instruction: BufferExecutionReport': {
        const bufferIds = tx.tx.transaction.message.compiledInstructions
          .filter(
            // method discriminant plus 4B first param bytearray length of 32B=0x20 (bufferId)
            ({ data }) => dataSlice(data, 0, 8 + 4) === '0x23cafcdc0252bd1720000000',
          )
          .map(({ data }) => Buffer.from(data.subarray(8 + 4, 8 + 4 + 32)))

        for (const bufferId of bufferIds) {
          const offrampProgram = new Program(
            CCIP_OFFRAMP_IDL,
            new PublicKey(log.address),
            new AnchorProvider(connection, wallet as AnchorWallet, { commitment: 'confirmed' }),
          )

          const [executionReportBuffer] = PublicKey.findProgramAddressSync(
            [Buffer.from('execution_report_buffer'), bufferId, wallet.publicKey.toBuffer()],
            offrampProgram.programId,
          )
          if (seenAccs.has(executionReportBuffer.toBase58())) continue
          seenAccs.add(executionReportBuffer.toBase58())

          const accInfo = await connection.getAccountInfo(executionReportBuffer)
          if (!accInfo) {
            console.debug(
              'Buffer with bufferId',
              hexlify(bufferId),
              'at',
              executionReportBuffer.toBase58(),
              'already closed',
            )
            continue
          }
          const bufferingAccounts = {
            executionReportBuffer,
            config: PublicKey.findProgramAddressSync(
              [Buffer.from('config')],
              offrampProgram.programId,
            )[0],
            authority: wallet.publicKey,
            systemProgram: SystemProgram.programId,
          }
          try {
            const sig = await offrampProgram.methods
              .closeExecutionReportBuffer(bufferId)
              .accounts(bufferingAccounts)
              .rpc()
            console.info(
              '🗑️  Closed bufferId',
              hexlify(bufferId),
              'at',
              executionReportBuffer.toBase58(),
              ': tx =>',
              sig,
            )
          } catch (err) {
            console.warn(
              'Failed to close bufferId',
              hexlify(bufferId),
              'at',
              executionReportBuffer.toBase58(),
              err,
            )
          }
        }
        break
      }
      case 'Instruction: DeactivateLookupTable':
      case 'Instruction: CreateLookupTable': {
        const lookupTable = tx.tx.transaction.message.staticAccountKeys[1]
        if (seenAccs.has(lookupTable.toBase58())) continue
        seenAccs.add(lookupTable.toBase58())

        const info = await connection.getAddressLookupTable(lookupTable)
        if (!info?.value) {
          alreadyClosed++ // assume we're done when we hit Nth closed ALT; maybe add an option to keep going?
          console.debug('Lookup table', lookupTable.toBase58(), 'already closed')
        } else if (info.value.state.authority?.toBase58() !== wallet.publicKey.toBase58()) {
          console.debug(
            'Lookup table',
            lookupTable.toBase58(),
            'not owned by us, but by',
            info.value.state.authority?.toBase58(),
          )
        } else if (info.value.state.deactivationSlot < 2n ** 63n) {
          // non-deactivated have deactivationSlot=MAX_UINT64
          pendingPromises.push(closeAlt(lookupTable, Number(info.value.state.deactivationSlot)))
        } else if (
          info.value.state.addresses.length >= 18 &&
          info.value.state.addresses[6].equals(wallet.publicKey)
        ) {
          // the conditions above match for ALTs created for ccip manualExec
          const deactivateIx = AddressLookupTableProgram.deactivateLookupTable({
            authority: wallet.publicKey,
            lookupTable: lookupTable,
          })

          try {
            const sig = await simulateAndSendTxs(connection, wallet, {
              instructions: [deactivateIx],
            })
            console.info('⤵️  Deactivated lookup table', lookupTable.toBase58(), ': tx =>', sig)
            pendingPromises.push(closeAlt(lookupTable, await getCurrentSlot()))
          } catch (err) {
            console.warn('Failed to deactivate lookup table', lookupTable.toBase58(), err)
          }
        }
        break // case
      }
    }
    if (alreadyClosed >= 3) break // loop
  }

  await Promise.allSettled(pendingPromises)
}
