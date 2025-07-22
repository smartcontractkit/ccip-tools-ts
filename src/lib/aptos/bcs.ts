import {
  type EntryFunctionArgument,
  type U8,
  AccountAddress,
  FixedBytes,
  Hex,
  MoveVector,
  Serializable,
  Serializer,
  U256,
  U32,
  U64,
} from '@aptos-labs/ts-sdk'
import type { CCIPMessage, ExecutionReport } from '../types'

const hexStringToVectorU8 = (hexString: string) => {
  if (!hexString || hexString === '0x') {
    return MoveVector.U8([])
  }
  try {
    return MoveVector.U8(Hex.fromHexString(hexString).toUint8Array())
  } catch (error) {
    throw new Error(
      `Failed to convert hex string to vector<u8>: ${hexString}. Error: ${error as string}`,
    )
  }
}

const hexStringToFixedBytes32 = (hexString: string) => {
  if (!hexString || hexString === '0x') {
    throw new Error('Message ID cannot be empty for fixed 32-byte array')
  }
  try {
    const bytes = Hex.fromHexString(hexString).toUint8Array()
    if (bytes.length !== 32) {
      throw new Error(`Message ID must be exactly 32 bytes, got ${bytes.length}`)
    }
    return new FixedBytes(bytes)
  } catch (error) {
    throw new Error(
      `Failed to convert hex string to fixed 32 bytes: ${hexString}. Error: ${error as string}`,
    )
  }
}

/**
  struct RampMessageHeader has drop {
	message_id: vector<u8>,
	source_chain_selector: u64,
	dest_chain_selector: u64,
	sequence_number: u64,
	nonce: u64
  }
  */
class RampMessageHeaderSerializable extends Serializable {
  public readonly messageId: FixedBytes
  public readonly sourceChainSelector: U64
  public readonly destChainSelector: U64
  public readonly sequenceNumber: U64
  public readonly nonce: U64

  constructor(header: CCIPMessage<'1.6.0'>['header']) {
    super()
    this.messageId = hexStringToFixedBytes32(header.messageId)
    this.sourceChainSelector = new U64(header.sourceChainSelector)
    this.destChainSelector = new U64(header.destChainSelector)
    this.sequenceNumber = new U64(header.sequenceNumber)
    this.nonce = new U64(header.nonce)
  }

  serialize(serializer: Serializer): void {
    serializer.serialize(this.messageId)
    serializer.serialize(this.sourceChainSelector)
    serializer.serialize(this.destChainSelector)
    serializer.serialize(this.sequenceNumber)
    serializer.serialize(this.nonce)
  }
}

/**
  struct Any2AptosTokenTransfer has drop {
	source_pool_address: vector<u8>,
	dest_token_address: address,
	dest_gas_amount: u32,
	extra_data: vector<u8>,
  
	// This is the amount to transfer, as set on the source chain.
	amount: u256
  }
  */
class Any2AptosTokenTransferSerializable extends Serializable implements EntryFunctionArgument {
  public readonly sourcePoolAddress: MoveVector<U8>
  public readonly destTokenAddress: AccountAddress
  public readonly destGasAmount: U32
  public readonly extraData: MoveVector<U8>
  public readonly amount: U256

  constructor(tokenTransfer: CCIPMessage<'1.6.0'>['tokenAmounts'][number]) {
    super()
    this.sourcePoolAddress = hexStringToVectorU8(tokenTransfer.sourcePoolAddress)
    this.destTokenAddress = AccountAddress.from(tokenTransfer.destTokenAddress)
    this.destGasAmount = new U32(Number(tokenTransfer.destGasAmount))
    this.extraData = hexStringToVectorU8(tokenTransfer.extraData)
    this.amount = new U256(tokenTransfer.amount)
  }

  serialize(serializer: Serializer): void {
    serializer.serialize(this.sourcePoolAddress)
    serializer.serialize(this.destTokenAddress)
    serializer.serialize(this.destGasAmount)
    serializer.serialize(this.extraData)
    serializer.serialize(this.amount)
  }

  serializeForEntryFunction(serializer: Serializer): void {
    const bcsBytes = this.bcsToBytes()
    serializer.serializeBytes(bcsBytes)
  }
}

/**
  struct Any2AptosRampMessage has drop {
	header: RampMessageHeader,
	sender: vector<u8>,
	data: vector<u8>,
	receiver: address,
	gas_limit: u256,
	token_amounts: vector<Any2AptosTokenTransfer>
  }
   */
class MessageSerializable extends Serializable {
  public readonly header: RampMessageHeaderSerializable
  public readonly sender: MoveVector<U8>
  public readonly data: MoveVector<U8>
  public readonly receiver: AccountAddress
  public readonly gasLimit: U256
  public readonly tokenAmounts: MoveVector<Any2AptosTokenTransferSerializable>

  constructor(message: CCIPMessage<'1.6.0'>, gasLimit: bigint) {
    super()
    this.header = new RampMessageHeaderSerializable(message.header)
    this.sender = hexStringToVectorU8(message.sender)
    this.data = hexStringToVectorU8(message.data)
    this.receiver = AccountAddress.from(message.receiver)
    this.gasLimit = new U256(gasLimit)
    this.tokenAmounts = new MoveVector(
      message.tokenAmounts.map(
        (tokenTransfer) => new Any2AptosTokenTransferSerializable(tokenTransfer),
      ),
    )
  }

  serialize(serializer: Serializer): void {
    serializer.serialize(this.header)
    serializer.serialize(this.sender)
    serializer.serialize(this.data)
    serializer.serialize(this.receiver)
    serializer.serialize(this.gasLimit)
    serializer.serialize(this.tokenAmounts)
  }
}

/**
  Matches the on-chain <address>::offchain::ExecutionReport struct:
  struct ExecutionReport has drop {
	source_chain_selector: u64,
	message: Any2AptosRampMessage,
	offchain_token_data: vector<vector<u8>>,
	proofs: vector<vector<u8>>
  }
  */
export class ExecutionReportSerializable extends Serializable {
  public readonly sourceChainSelector: U64
  public readonly message: MessageSerializable
  public readonly offchainTokenData: MoveVector<MoveVector<U8>>
  public readonly proofs: MoveVector<FixedBytes>

  constructor(report: ExecutionReport, gasLimit: bigint) {
    super()
    this.sourceChainSelector = new U64(report.sourceChainSelector)
    this.message = new MessageSerializable(report.message, gasLimit)
    this.offchainTokenData = new MoveVector(report.offchainTokenData.map(hexStringToVectorU8))
    this.proofs = new MoveVector(report.proofs.map(hexStringToFixedBytes32))
  }

  serialize(serializer: Serializer): void {
    serializer.serialize(this.sourceChainSelector)
    serializer.serialize(this.message)
    serializer.serialize(this.offchainTokenData)
    serializer.serialize(this.proofs)
  }
}

export const serializeExecutionReport = (report: ExecutionReport, gasLimit: bigint) => {
  const serializer = new Serializer()
  new ExecutionReportSerializable(report, gasLimit).serialize(serializer)
  return serializer.toUint8Array()
}
