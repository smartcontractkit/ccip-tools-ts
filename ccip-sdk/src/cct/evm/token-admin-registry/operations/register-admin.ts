/**
 * registerAdmin — proposes a token's administrator in the TokenAdminRegistry (TAR) by calling a
 * RegistryModuleOwnerCustom, one of three self-service paths CCIP ships so a token owner never
 * needs the TAR owner's help to onboard. Two-step by design, like `transferAdmin`: the token
 * lands in `pendingAdministrator` until the proposed administrator calls `acceptAdmin`.
 *
 * @packageDocumentation
 */

import { Contract, Interface, ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { type PreconditionError, CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx, unmet } from '../../operation.ts'
import { validateAddress } from '../../validate.ts'
import {
  RegistryModuleOwnerCustomVersion,
  getRegistryModuleOwnerCustomInterface,
  isRegistryModule,
  readTokenAdminRegistryConfig,
  resolveRegistryModuleOwnerCustom,
} from '../contracts.ts'

/**
 * Self-service authorization paths a RegistryModuleOwnerCustom accepts, each proving control of
 * the token through a different on-chain getter rather than a signature the module has to verify
 * itself. Defaults to `owner`, the common case for a plain `Ownable` token.
 */
const REGISTRATION_METHODS = {
  OWNER: 'owner',
  CCIP_ADMIN: 'ccip-admin',
  ACCESS_CONTROL_DEFAULT_ADMIN: 'access-control-default-admin',
} as const

/** Authorization path used to register a token's administrator via a RegistryModuleOwnerCustom. */
export type RegisterAdminMethod = (typeof REGISTRATION_METHODS)[keyof typeof REGISTRATION_METHODS]

/**
 * Per-method wiring: the RegistryModuleOwnerCustom function this op calls. `owner`/`ccip-admin`
 * also carry the token getter whose return value the module registers as administrator and
 * checks against the caller (`_registerAdmin`'s `admin != msg.sender` revert) — used here to
 * pre-flight that same equality. `access-control-default-admin` has no such getter: unlike the
 * other two, `registerAccessControlDefaultAdmin` never derives an address from the token at all —
 * it checks `AccessControl(token).hasRole(DEFAULT_ADMIN_ROLE(), msg.sender)` and then registers
 * `msg.sender` itself, so it's pre-flighted as a role check in {@link RegisterAdmin.preconditions}
 * rather than through a `tokenGetter` here.
 */
const REGISTRATION: Record<
  RegisterAdminMethod,
  { readonly moduleFn: string; readonly tokenGetter?: string }
> = {
  [REGISTRATION_METHODS.OWNER]: { moduleFn: 'registerAdminViaOwner', tokenGetter: 'owner' },
  [REGISTRATION_METHODS.CCIP_ADMIN]: {
    moduleFn: 'registerAdminViaGetCCIPAdmin',
    tokenGetter: 'getCCIPAdmin',
  },
  [REGISTRATION_METHODS.ACCESS_CONTROL_DEFAULT_ADMIN]: {
    moduleFn: 'registerAccessControlDefaultAdmin',
  },
}

/** Registration paths a v1.5.0 module offers — both derive the administrator from a token getter. */
export type RegisterAdminMethodV1_5_0 = Exclude<RegisterAdminMethod, 'access-control-default-admin'>

/** Fields every registration path needs, whatever the module version. */
type RegisterAdminBaseParams = {
  /** Token to register. Stays unregistered until `acceptAdmin` is called by the proposed admin. */
  tokenAddress: string
  /**
   * `RegistryModuleOwnerCustom` to call. The TAR exposes `isRegistryModule` but no enumeration,
   * so — unlike `address` below — this can't be discovered on-chain and must be supplied.
   */
  registryModule: string
  /**
   * Contract to resolve the TokenAdminRegistry from. Pass the registry itself for a direct
   * lookup; a Router, OnRamp, OffRamp, or TokenPool also work but add hops and need a
   * configured lane.
   */
  address: string
  /**
   * Address the registration is authorized against. Optional here, unlike `transferAdmin` and
   * `acceptAdmin` which reject an omitted `sender`: leaving it out SKIPS the token-authority probe
   * in {@link RegisterAdmin.buildUnsigned}, so the tx builds without that check and can then only
   * fail on-chain. {@link RegisterAdmin.execute} defaults it to the signing wallet.
   */
  sender?: string
}

/**
 * Registration through a v1.5.0 `RegistryModuleOwnerCustom` — that version has no
 * `registerAccessControlDefaultAdmin`, so `registrationMethod` narrows to the two getter-derived
 * paths and the AccessControl one will not typecheck.
 */
export type RegisterAdminParamsV1_5_0 = RegisterAdminBaseParams & {
  registryModuleVersion: typeof RegistryModuleOwnerCustomVersion.V1_5_0
  /** Selects which token getter proves control; defaults to `owner`. */
  registrationMethod?: RegisterAdminMethodV1_5_0
}

/**
 * Registration through a v1.6.0 `RegistryModuleOwnerCustom` — the default, and the only version
 * offering `access-control-default-admin`.
 */
export type RegisterAdminParamsV1_6_0 = RegisterAdminBaseParams & {
  registryModuleVersion?: typeof RegistryModuleOwnerCustomVersion.V1_6_0
  /** Selects how control is proved; defaults to `owner`. */
  registrationMethod?: RegisterAdminMethod
}

/**
 * Parameters for {@link RegisterAdmin}, discriminated on `registryModuleVersion`: `1.5.0` drops
 * `access-control-default-admin` (a compile-time guarantee); omit it for the `1.6.0` default.
 * {@link RegisterAdmin.buildUnsigned} verifies the declaration against the module's on-chain
 * version. The administrator itself is never a parameter — see {@link REGISTRATION}.
 */
export type RegisterAdminParams = RegisterAdminParamsV1_5_0 | RegisterAdminParamsV1_6_0

/**
 * Proposes a token's administrator in the TokenAdminRegistry via a RegistryModuleOwnerCustom.
 * For `owner`/`ccip-admin` the module — not this op — derives the administrator from the token
 * itself; for `access-control-default-admin` it registers the caller once a role check passes.
 */
export class RegisterAdmin extends EVMOperation<RegisterAdminParams> {
  readonly name = 'registerAdmin'

  /** Validates addresses and, if given, `registrationMethod`; no RPC. */
  protected override validate(p: RegisterAdminParams): void {
    validateAddress(this.name, 'tokenAddress', p.tokenAddress)
    validateAddress(this.name, 'registryModule', p.registryModule)
    validateAddress(this.name, 'address', p.address)
    if (
      p.registrationMethod !== undefined &&
      !Object.values(REGISTRATION_METHODS).includes(p.registrationMethod)
    ) {
      throw new CCTParamsInvalidError(
        this.name,
        'registrationMethod',
        `must be one of ${Object.values(REGISTRATION_METHODS).join(', ')}`,
      )
    }
  }

  /**
   * Resolves the TAR and the module's on-chain version, then encodes the module call.
   *
   * @remarks Both checks here stay fatal while the rest are reported. A module the registry does
   * not know is infrastructure the CCIP operator installs, not something a CCT plan can add; and
   * the resolved version selects the interface the calldata is built from, so there would be no
   * transaction to attach a report to.
   */
  protected async buildUnsigned(chain: EVMChain, p: RegisterAdminParams): Promise<UnsignedEVMTx> {
    const method = p.registrationMethod ?? REGISTRATION_METHODS.OWNER
    const { moduleFn } = REGISTRATION[method]

    const registry = await chain.getTokenAdminRegistryFor(p.address)

    // The TAR reverts `OnlyRegistryModuleOrOwner` from deep inside the module call; check here.
    if (!(await isRegistryModule(chain, registry, p.registryModule))) {
      throw new CCTParamsInvalidError(
        this.name,
        'registryModule',
        `${p.registryModule} is not a registered module on the TokenAdminRegistry at ${registry}`,
      )
    }

    // Both versions encode the shared functions identically, so a wrong `registryModuleVersion`
    // would go unnoticed until the module rejected the call. Resolve and compare instead.
    const onChainVersion = await resolveRegistryModuleOwnerCustom(chain, p.registryModule)
    const declaredVersion = p.registryModuleVersion ?? RegistryModuleOwnerCustomVersion.V1_6_0
    if (onChainVersion !== declaredVersion) {
      throw new CCTParamsInvalidError(
        this.name,
        'registryModuleVersion',
        `${p.registryModule} is a v${onChainVersion} RegistryModuleOwnerCustom, but v${declaredVersion} was declared`,
      )
    }

    const data = getRegistryModuleOwnerCustomInterface(onChainVersion).encodeFunctionData(
      moduleFn,
      [p.tokenAddress],
    )
    return callTx(p.registryModule, data)
  }

  /**
   * Mirrors the module's own authorization check against `sender`, and confirms the token is not
   * already registered or proposed.
   *
   * @remarks All reported rather than thrown outright: `transferTokenOwnership` or `setCCIPAdmin`
   * in an earlier plan step is what makes `sender` the address the module will accept, and the
   * registration state is what the `registerAdmin → acceptAdmin` pair moves through.
   */
  protected override async preconditions(
    chain: EVMChain,
    p: RegisterAdminParams,
  ): Promise<PreconditionError[]> {
    const method = p.registrationMethod ?? REGISTRATION_METHODS.OWNER
    const registry = await chain.getTokenAdminRegistryFor(p.address)
    const [authority, { administrator, pendingAdministrator }] = await Promise.all([
      this.checkRegistrationAuthority(chain, p, method),
      readTokenAdminRegistryConfig(chain, registry, p.tokenAddress),
    ])

    return unmet(
      authority,
      // `proposeAdministrator` reverts `AlreadyRegistered` only once `administrator` is non-zero;
      // a pending proposal is silently overwritten. Reporting that too is deliberately stricter.
      administrator === ZeroAddress
        ? undefined
        : {
            param: 'tokenAddress',
            reason: `token already has registry administrator ${administrator} — use transferAdmin to hand the role over, or setPool if you are already the admin`,
          },
      pendingAdministrator === ZeroAddress
        ? undefined
        : {
            param: 'tokenAddress',
            reason: `a registration proposing ${pendingAdministrator} is already pending — that address must call acceptAdmin (re-registering would silently replace the proposal)`,
          },
    )
  }

  /**
   * Mirrors the check the chosen module performs on its caller (see `REGISTRATION`), so a
   * mismatch is reported here rather than reverting `CanOnlySelfRegister` /
   * `RequiredRoleNotFound`. Needs `sender`; reports nothing without one.
   */
  private async checkRegistrationAuthority(
    chain: EVMChain,
    p: RegisterAdminParams,
    method: RegisterAdminMethod,
  ): Promise<PreconditionError | undefined> {
    if (p.sender === undefined) return undefined

    if (method === REGISTRATION_METHODS.ACCESS_CONTROL_DEFAULT_ADMIN) {
      // Not `defaultAdmin()`: that lives on `AccessControlDefaultAdminRules`, not the plain
      // `AccessControl` the module casts to. Mirror the module: read the role, then `hasRole`.
      const accessControlInterface = new Interface([
        'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
        'function hasRole(bytes32, address) view returns (bool)',
      ])
      const token = new Contract(p.tokenAddress, accessControlInterface, chain.provider)
      const role = (await token.getFunction('DEFAULT_ADMIN_ROLE')()) as string
      const hasRole = (await token.getFunction('hasRole')(role, p.sender)) as boolean
      if (hasRole) return undefined
      return {
        param: 'sender',
        reason: `must hold the token's DEFAULT_ADMIN_ROLE (AccessControl.hasRole) for registrationMethod "access-control-default-admin"`,
      }
    }

    const tokenGetter = REGISTRATION[method].tokenGetter!
    const tokenGetterInterface = new Interface([`function ${tokenGetter}() view returns (address)`])
    const admin = (await new Contract(
      p.tokenAddress,
      tokenGetterInterface,
      chain.provider,
    ).getFunction(tokenGetter)()) as string
    if (getAddress(admin) === getAddress(p.sender)) return undefined
    return {
      param: 'sender',
      reason: `must equal token.${tokenGetter}() (${admin}) for registrationMethod "${method}"`,
    }
  }

  /**
   * Signs and submits as the token's authority, defaulting `sender` to the signing wallet — the
   * only address the module's `msg.sender` check can pass. See
   * {@link EVMOperation.resolveWalletSender} for why a divergent `sender` is rejected.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<RegisterAdminParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
