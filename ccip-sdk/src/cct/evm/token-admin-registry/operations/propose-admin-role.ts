/**
 * proposeAdminRole — proposes the caller as administrator for a token via the
 * RegistryModuleOwnerCustom contract, which verifies the caller's authority
 * (token owner, CCIP admin, or AccessControl default admin) and then calls
 * `proposeAdministrator(token, caller)` on the TokenAdminRegistry.
 *
 * @packageDocumentation
 */

import { interfaces } from '../../../../evm/const.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation } from '../../operation.ts'
import { validateAddress } from '../../validate.ts'

/** How RegistryModuleOwnerCustom verifies the caller's authority over the token. */
export type EVMRegistrationMethod = 'owner' | 'getCCIPAdmin' | 'accessControlDefaultAdmin'

/** RegistryModuleOwnerCustom function per registration method. */
const REGISTRATION_FUNCTION_NAMES: Record<EVMRegistrationMethod, string> = {
  owner: 'registerAdminViaOwner',
  getCCIPAdmin: 'registerAdminViaGetCCIPAdmin',
  accessControlDefaultAdmin: 'registerAccessControlDefaultAdmin',
}

/** Parameters for `proposeAdminRole`. */
export type ProposeAdminRoleParams = {
  /** Token to propose an administrator for. */
  tokenAddress: string
  /** RegistryModuleOwnerCustom contract address (from the CCIP chains API `registryModule`). */
  registryModuleAddress: string
  /** How the contract verifies caller authority. Defaults to `'owner'`. */
  registrationMethod?: EVMRegistrationMethod
  sender?: string
}

/** Proposes the caller as token administrator via RegistryModuleOwnerCustom. */
export class ProposeAdminRole extends EVMOperation<ProposeAdminRoleParams> {
  readonly name = 'proposeAdminRole'

  /** Validates addresses and the registration method before any RPC. */
  protected validate(p: ProposeAdminRoleParams): void {
    validateAddress(this.name, 'tokenAddress', p.tokenAddress)
    validateAddress(this.name, 'registryModuleAddress', p.registryModuleAddress)
    if (p.registrationMethod && !(p.registrationMethod in REGISTRATION_FUNCTION_NAMES)) {
      throw new CCTParamsInvalidError(
        this.name,
        'registrationMethod',
        `must be one of ${Object.keys(REGISTRATION_FUNCTION_NAMES).join(', ')}`,
      )
    }
  }

  /** Builds the RegistryModuleOwnerCustom registration calldata. */
  protected buildUnsigned(_chain: EVMChain, p: ProposeAdminRoleParams): UnsignedEVMTx {
    const functionName = REGISTRATION_FUNCTION_NAMES[p.registrationMethod ?? 'owner']
    const data = interfaces.RegistryModuleOwnerCustom.encodeFunctionData(functionName, [
      p.tokenAddress,
    ])
    return { family: ChainFamily.EVM, transactions: [{ to: p.registryModuleAddress, data }] }
  }
}
