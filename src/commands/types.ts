export const Format = {
  log: 'log',
  pretty: 'pretty',
  json: 'json',
} as const
export type Format = (typeof Format)[keyof typeof Format]

type BaseManualExecCommandArgs<T extends object> = T & {
  gasLimit?: number
  estimateGasLimit?: number
  tokensGasLimit?: number
  logIndex?: number
  format: Format
  page: number
  wallet?: string
}

export type AptosManualExecFlags = {
  // Aptos
  aptosOfframp: string
  aptosPrivateKey: string
}

export type SolanaManualExecFlags = {
  // Solana
  solanaOfframp: string
  solanaKeypair: string
  solanaBufferAddress: string
  solanaForceBuffer: boolean
  solanaForceLookupTable: boolean
  solanaCuLimit?: number
}

export type EVMManualExecCommandArgs = BaseManualExecCommandArgs<object>
export type AptosManualExecCommandArgs = BaseManualExecCommandArgs<AptosManualExecFlags>
export type SolanaManualExecCommandArgs = BaseManualExecCommandArgs<SolanaManualExecFlags>

export type ManualExecCommandArgs =
  | AptosManualExecCommandArgs
  | SolanaManualExecCommandArgs
  | EVMManualExecCommandArgs

export function isAptosManualExecCommandArgs(
  args: ManualExecCommandArgs,
): args is AptosManualExecCommandArgs {
  return 'aptosOfframp' in args && 'aptosPrivateKey' in args
}

export function isSolanaManualExecCommandArgs(
  args: ManualExecCommandArgs,
): args is SolanaManualExecCommandArgs {
  return 'solanaOfframp' in args && 'solanaKeypair' in args
}
