import createClient from 'openapi-fetch'

import { CCIPErrorCode } from '../../../errors/index.ts'
import { type CantonAddress, type PartyId, RawInstanceAddress } from '../../addressCodec.ts'
import { resolvePartyUrl } from '../url-template.ts'
import type { paths as ccipPaths } from './generated/eds-ccip.generated.d.ts'
import type { paths as ccvPaths } from './generated/eds-ccv.generated.d.ts'
import type { components as commonComponents } from './generated/eds-common.generated.d.ts'
import type { paths as executorPaths } from './generated/eds-executor.generated.d.ts'
import type { paths as globalPaths } from './generated/eds-global.generated.d.ts'
import type { paths as tokenPoolPaths } from './generated/eds-tokenpool.generated.d.ts'

export type Message = commonComponents['schemas']['Message']
export type TokenTransfer = commonComponents['schemas']['TokenTransfer']
export type InstrumentId = commonComponents['schemas']['InstrumentId']

interface EdsClientProviderConfig {
  edsUrlsByOwner: Record<string, string>
}

export class EdsClientProvider {
  // maps PartyId => EDS base URL
  // wildcards:
  // - '{party}' acts as a URL template for any known party ({party} is replaced
  //   with the resolved party ID, e.g. for DA Registry URLs embedding the party)
  // - '*' acts as a plain fallback, also used when the party cannot be
  //   determined (opaque hashed InstanceAddress)
  private readonly edsUrlsByOwner: Record<string, string>

  constructor(config: EdsClientProviderConfig) {
    this.edsUrlsByOwner = config.edsUrlsByOwner
  }

  urlFor(partyOrAddress: PartyId | CantonAddress) {
    // Determine the owner party for the given input.
    // If it's a PartyId, use it directly.
    // If it's a CantonAddress, extract the owner.
    // If it's an InstanceAddress (which is opaque), the owner is unknown.
    const owner =
      typeof partyOrAddress === 'string'
        ? partyOrAddress
        : partyOrAddress instanceof RawInstanceAddress
          ? partyOrAddress.owner
          : undefined

    return resolvePartyUrl(this.edsUrlsByOwner, owner, {
      code: CCIPErrorCode.API_CLIENT_NOT_AVAILABLE,
      subject: 'EDS',
    })
  }

  ccipClientFor(partyOrAddress: PartyId | CantonAddress) {
    return createClient<ccipPaths>({
      baseUrl: this.urlFor(partyOrAddress),
    })
  }

  ccvClientFor(partyOrAddress: PartyId | CantonAddress) {
    return createClient<ccvPaths>({
      baseUrl: this.urlFor(partyOrAddress),
    })
  }

  executorClientFor(partyOrAddress: PartyId | CantonAddress) {
    return createClient<executorPaths>({
      baseUrl: this.urlFor(partyOrAddress),
    })
  }

  globalClientFor(partyOrAddress: PartyId | CantonAddress) {
    return createClient<globalPaths>({
      baseUrl: this.urlFor(partyOrAddress),
    })
  }

  tokenPoolClientFor(partyOrAddress: PartyId | CantonAddress) {
    return createClient<tokenPoolPaths>({
      baseUrl: this.urlFor(partyOrAddress),
    })
  }
}
