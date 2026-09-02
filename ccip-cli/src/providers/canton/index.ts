/**
 * Canton CLI providers — config, wallet, and OAuth 2.0 orchestration.
 *
 * @packageDocumentation
 *
 * This folder owns the Node-specific bits of the Canton integration:
 * - `config.ts` — loading + validating the Canton config JSON file, and
 *   CLI/indexer/router resolution helpers.
 * - `wallet.ts` — the Ed25519 transaction signer and wallet loading.
 * - `auth.ts` — the OAuth 2.0 orchestration (local callback server, browser
 *   launching, env-var resolution) that composes the SDK's runtime-agnostic
 *   protocol helpers and hands the result to `cantonConfig`.
 *
 * The SDK (`@chainlink/ccip-sdk`) is runtime-agnostic: it consumes only what
 * it's given (`jwt` or `tokenGetter`) and never orchestrates an OAuth flow.
 */

export {
  type CantonCliConfig,
  loadCantonConfig,
  resolveCliIndexer,
  resolveCliRouter,
} from './config.ts'
export {
  createCliAuthProvider,
  mergeAuthEnvVars,
  openBrowser,
  resolveCantonTokenGetter,
  runAuthorizationCodeFlow,
} from './auth.ts'
export {
  type CantonWalletWithSigner,
  Ed25519TransactionSigner,
  loadCantonWallet,
} from './wallet.ts'
