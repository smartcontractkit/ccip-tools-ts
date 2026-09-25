import { CCIPError, CCIPErrorCode } from '../errors/index.ts'
import { getDataBytes } from '../utils.ts'
import type {
  JsCommands,
  JsPrepareSubmissionRequest,
  JsSubmitAndWaitForTransactionResponse,
} from './client/index.ts'
import type { TransactionSigner } from './types.ts'
import type { CantonChain } from './index.ts'

const CANTON_SEND_PACKAGE_NAMES = [
  'ccip-core',
  'ccip-executor',
  'ccip-burn-mint-token-pool',
  'splice-amulet',
  'splice-api-token-holding-v1',
  'splice-api-token-transfer-instruction-v1',
  'link',
] as const

function templateIdsFromCommands(commands: JsCommands): string[] {
  const ids: string[] = []
  for (const disclosed of commands.disclosedContracts ?? []) {
    if (disclosed.templateId) ids.push(disclosed.templateId)
  }
  for (const command of commands.commands) {
    const record = command as Record<string, unknown>
    for (const key of ['ExerciseCommand', 'CreateCommand', 'CreateAndExerciseCommand'] as const) {
      const nested = record[key]
      if (!nested || typeof nested !== 'object') continue
      const templateId = (nested as Record<string, unknown>)['templateId']
      if (typeof templateId === 'string') ids.push(templateId)
    }
  }
  return ids
}

function packageNamesFromTemplateRefs(commands: JsCommands): string[] {
  const names = new Set<string>()
  for (const templateId of templateIdsFromCommands(commands)) {
    if (!templateId.startsWith('#')) continue
    const trimmed = templateId.slice(1)
    const sep = trimmed.indexOf(':')
    if (sep > 0) names.add(trimmed.slice(0, sep))
  }
  return [...names]
}

function resolvePackageNamesForCommands(commands: JsCommands): string[] {
  const names = new Set<string>([
    ...packageNamesFromTemplateRefs(commands),
    ...CANTON_SEND_PACKAGE_NAMES,
  ])
  return [...names]
}

async function resolveSubmissionSynchronizerId(
  chain: CantonChain,
  commands: JsCommands,
): Promise<string> {
  if (commands.synchronizerId) return commands.synchronizerId

  const fromDisclosed = commands.disclosedContracts
    ?.map((dc) => dc.synchronizerId)
    .find((id) => typeof id === 'string' && id.length > 0)
  if (fromDisclosed) return fromDisclosed

  const synchronizers = await chain.provider.getConnectedSynchronizers()
  const synchronizerId = synchronizers[0]?.synchronizerId
  if (!synchronizerId) {
    throw new CCIPError(
      CCIPErrorCode.CANTON_API_ERROR,
      'CantonChain: unable to resolve synchronizerId for prepare submission',
    )
  }
  return synchronizerId
}

async function buildPrepareRequest(
  chain: CantonChain,
  commands: JsCommands,
): Promise<JsPrepareSubmissionRequest> {
  const synchronizerId = await resolveSubmissionSynchronizerId(chain, commands)
  const packageNames = resolvePackageNamesForCommands(commands)
  const packageIdSelectionPreference = await chain.provider.getPreferredPackageIds(
    commands.actAs,
    packageNames,
    synchronizerId,
  )
  if (packageIdSelectionPreference.length === 0) {
    throw new CCIPError(
      CCIPErrorCode.CANTON_API_ERROR,
      'CantonChain: unable to resolve packageIdSelectionPreference for prepare submission',
    )
  }

  return {
    commandId: commands.commandId,
    commands: commands.commands,
    actAs: commands.actAs,
    readAs: commands.readAs,
    disclosedContracts: commands.disclosedContracts,
    synchronizerId,
    packageIdSelectionPreference,
    hashingSchemeVersion: 'HASHING_SCHEME_VERSION_V3',
  }
}

/** Direct submit with no signer; otherwise prepare → sign → execute via interactive submission. */
export async function submitCantonCommands(
  chain: CantonChain,
  commands: JsCommands,
  signer?: TransactionSigner,
): Promise<JsSubmitAndWaitForTransactionResponse> {
  if (!signer) {
    return chain.provider.submitAndWaitForTransaction(commands)
  }

  const prepareRequest = await buildPrepareRequest(chain, commands)
  const prepareResponse = await chain.provider.prepareSubmission(prepareRequest)

  if (!prepareResponse.preparedTransaction || !prepareResponse.preparedTransactionHash) {
    throw new CCIPError(
      CCIPErrorCode.CANTON_API_ERROR,
      'prepareSubmission returned an incomplete response (missing preparedTransaction or hash)',
    )
  }

  const hashBytes = getDataBytes(prepareResponse.preparedTransactionHash)
  const partySignatures = await signer.signTxHash(hashBytes)

  const hashingSchemeVersion =
    prepareResponse.hashingSchemeVersion &&
    prepareResponse.hashingSchemeVersion !== 'HASHING_SCHEME_VERSION_UNSPECIFIED'
      ? prepareResponse.hashingSchemeVersion
      : 'HASHING_SCHEME_VERSION_V3'

  return chain.provider.executeSubmissionAndWaitForTransaction({
    preparedTransaction: prepareResponse.preparedTransaction,
    partySignatures: { signatures: [partySignatures] },
    deduplicationPeriod: { Empty: {} },
    hashingSchemeVersion,
    submissionId: `ext-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  })
}
