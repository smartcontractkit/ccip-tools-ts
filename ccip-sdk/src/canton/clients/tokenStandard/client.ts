import createClient from 'openapi-fetch'

import { CCIPErrorCode } from '../../../errors/index.ts'
import type { CantonInstrumentId, PartyId } from '../../addressCodec.ts'
import { resolvePartyUrl } from '../url-template.ts'
import type { paths as tokenMetadataV1Paths } from './generated/token-metadata-v1.generated.d.ts'
import type { paths as transferInstructionV1Paths } from './generated/transfer-instruction-v1.generated.d.ts'

interface TokenStandardProviderConfig {
  urlsByAdmin: Record<string, string>
}

export class TokenStandardClientProvider {
  // maps PartyId => Token Standard URL
  // wildcards:
  // - '{party}' acts as a URL template for any known admin ({party} is replaced
  //   with the resolved admin party ID, e.g. for DA Registry URLs embedding the
  //   party)
  // - '*' acts as a plain fallback
  private readonly urlsByAdmin: Record<string, string>

  constructor(config: TokenStandardProviderConfig) {
    this.urlsByAdmin = config.urlsByAdmin
  }

  urlFor(partyOrInstrumentId: PartyId | CantonInstrumentId): string {
    // Determine the admin party for the given input
    // If it's a PartyId, use it directly
    // If it's a CantonInstrumentId, use the admin field
    const admin =
      typeof partyOrInstrumentId === 'string' ? partyOrInstrumentId : partyOrInstrumentId.admin

    return resolvePartyUrl(this.urlsByAdmin, admin, {
      code: CCIPErrorCode.TOKEN_NOT_CONFIGURED,
      subject: 'token standard',
    })
  }

  tokenMetadataV1ClientFor(partyOrInstrumentId: PartyId | CantonInstrumentId) {
    return createClient<tokenMetadataV1Paths>({
      baseUrl: this.urlFor(partyOrInstrumentId),
    })
  }

  transferInstructionV1ClientFor(partyOrInstrumentId: PartyId | CantonInstrumentId) {
    return createClient<transferInstructionV1Paths>({
      baseUrl: this.urlFor(partyOrInstrumentId),
    })
  }
}
