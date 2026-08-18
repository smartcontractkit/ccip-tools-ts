/**
 * Token Admin Registry (TAR) CCT operations barrel.
 *
 * @packageDocumentation
 */

export {
  SetPool,
  type SetPoolParams,
  type PoolRegistration,
  type GenerateSetPoolParams,
  type GenerateSetPoolResult,
  type ExecuteSetPoolParams,
  type ExecuteSetPoolResult,
} from './set-pool.ts'

export {
  RegisterAdmin,
  type RegisterAdminParams,
  type GenerateRegisterAdminParams,
  type GenerateRegisterAdminResult,
  type ExecuteRegisterAdminParams,
  type ExecuteRegisterAdminResult,
} from './register-admin.ts'

export {
  AcceptAdmin,
  type AcceptAdminParams,
  type GenerateAcceptAdminParams,
  type GenerateAcceptAdminResult,
  type ExecuteAcceptAdminParams,
  type ExecuteAcceptAdminResult,
} from './accept-admin.ts'

export {
  TransferAdmin,
  type TransferAdminParams,
  type GenerateTransferAdminParams,
  type GenerateTransferAdminResult,
  type ExecuteTransferAdminParams,
  type ExecuteTransferAdminResult,
} from './transfer-admin.ts'

export {
  GetTokenAdminRegistry,
  type GetTokenAdminRegistryParams,
  type GetTokenAdminRegistryResult,
} from './get-token-admin-registry.ts'

export {
  GetSupportedTokens,
  type GetSupportedTokensParams,
  type GetSupportedTokensResult,
} from './get-supported-tokens.ts'
