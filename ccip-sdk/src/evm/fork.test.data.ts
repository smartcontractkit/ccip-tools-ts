/**
 * Curated collection of real testnet CCIP messages for fork testing.
 * Messages span Sepolia, Fuji, and Aptos testnets with diverse statuses,
 * protocol versions, token transfers, and sender patterns.
 *
 * All messages are from before Feb 24, 2026 to ensure stable state.
 */

import { MessageStatus } from '../types.ts'

/** A real testnet CCIP message reference for fork testing. */
export type ForkTestMessage = {
  messageId: string
  txHash: string
  status: MessageStatus
  version: '1.5' | '1.6' | '2.0'
  description: string
}

// ── Sepolia → Fuji (EVM → EVM) ──

export const SEPOLIA_TO_FUJI: ForkTestMessage[] = [
  // VERIFIED — only one on this lane
  {
    messageId: '0xd3ad975c42aea68b22a21f659b13cc803881f1a9f191da63d0dafaf9e03fa6b2',
    txHash: '0x2e3e7bd3f5bafd93f372de769df374ccba5b1a80f8583c636e40cb7bc9d82503',
    status: MessageStatus.Verified,
    version: '2.0',
    description: 'token transfer (1000 CCIP-BnM), no calldata',
  },
  // FAILED — USDC transfer via contract, ready for manual exec
  {
    messageId: '0xb92d88bf2f704fdc2403ec1270fe8eca39f02f04daecc5e63060ac8676d708c5',
    txHash: '0x6a6f5ec9d6bd20ee35b90c94bab758939cc89779e65dff3cee004cb2250abdf5',
    status: MessageStatus.Failed,
    version: '1.5',
    description: 'failed USDC transfer (1 USDC) via contract, ready for manual exec',
  },
  // FAILED — data-only via contract
  {
    messageId: '0xa27322c65bb3d73cdd4de4011b5b0ea2ef6a0c1667b168c59ece3a4aea6b1aef',
    txHash: '0x53ada97118a53484c834f39a3c67038892068cb531317d2e029823872d7bf250',
    status: MessageStatus.Failed,
    version: '2.0',
    description: 'failed data-only via contract, ready for manual exec',
  },
  // FAILED — data-only, direct sender
  {
    messageId: '0x047060367f4543d021b2a5d8b952e049af26d8fa71e7aab18fd7b28396341356',
    txHash: '0xcb2e1f7bf1236b2ef3be634fc19af5abe2e9e210f2fe105be6713aeed9e9d164',
    status: MessageStatus.Failed,
    version: '1.6',
    description: 'failed data-only, direct sender, ready for manual exec',
  },
  // SOURCE_FINALIZED — only one on this lane
  {
    messageId: '0x4126205056a83104d8f93fe33725b0146a5c8f6d4cf2d3834040357198cbec11',
    txHash: '0xfb56673057bca392621f52eb2b11a10d3ea8c722803b39deea99b5f8f2434711',
    status: MessageStatus.SourceFinalized,
    version: '2.0',
    description: 'source finalized, no token, no calldata',
  },
  // SUCCESS — token transfer via contract
  {
    messageId: '0x48c5c33b8ea2907c60fac7db8a6e4f191efe293f4ba09ce34d9bab5f6dae647c',
    txHash: '0xb36d3df54afcb4002085cece6a9b9060cc6c14d519538fa85ff1fe5a72983d27',
    status: MessageStatus.Success,
    version: '2.0',
    description: 'token transfer (0.001 CCIP-BnM) with calldata, sent via contract',
  },
  // SUCCESS — USDC transfer via contract
  {
    messageId: '0xd7baa415bb71a130305074649ecb790d55d5016ba67716495834cb52c4a3cecd',
    txHash: '0x3ff0129c3a6768d2ecf6f342ea90063c63160a90bddf4d787ebaa2b14a4903eb',
    status: MessageStatus.Success,
    version: '1.5',
    description: 'USDC transfer (1 USDC) with calldata, sent via contract',
  },
  // SUCCESS — large token transfer, direct sender
  {
    messageId: '0x7e7f13227eee5461d0e05c374df607266aaedc4c2900ab50df3bc6161de63b55',
    txHash: '0x7ba6068319477983b115ca7d4ae53e7119aa2d8af250d2a8a73546b727e6737f',
    status: MessageStatus.Success,
    version: '1.5',
    description: 'token transfer (100 tokens), no calldata, direct sender',
  },
  // SUCCESS — token transfer, direct sender, different token
  {
    messageId: '0xa3ac788e347afc8eacac3a63c56e948fecbe1151a50fb2a8e76b2f5130280a2a',
    txHash: '0x048297727f50c111a1e0ed782886d0b9d677698837c44e05f7a5fe5f6f176beb',
    status: MessageStatus.Success,
    version: '2.0',
    description: 'token transfer (1 token), no calldata, direct sender',
  },
  // SUCCESS — very large token transfer via contract
  {
    messageId: '0x3ff6000bb5250282c8c6e2b2c10e31215f71711de06e1f3916f8755227a01b30',
    txHash: '0x8774def5d0dcc1bd5a9fb4163f5f4b67b41d224b1097f5c77443a3967b2b3231',
    status: MessageStatus.Success,
    version: '1.5',
    description: 'token transfer (500 tokens), no calldata, sent via contract',
  },
  // SUCCESS — small token transfer via contract
  {
    messageId: '0xd417a2e5be441069539df7599e3c127c73981461ae0ef047327b7bbc359325c7',
    txHash: '0xd0ab05857bb9705e2d66a1e7aad5b7ed6677e08dcc3998ebb0c24e130fb942d6',
    status: MessageStatus.Success,
    version: '1.5',
    description: 'token transfer (0.2 tokens) via contract',
  },
]

// ── Sepolia → Aptos (EVM → Aptos) ──

export const SEPOLIA_TO_APTOS: ForkTestMessage[] = [
  // BLESSED — only one found across all lanes
  {
    messageId: '0xa1cff7067c976cdad55a3d014ecbc8716118abac4874ac34075d3dc806a94100',
    txHash: '0xdbbf17e83141593b261cf2aab50dd014e94941f9644f2152ba495e253c78a234',
    status: MessageStatus.Blessed,
    version: '1.6',
    description: 'blessed, data-only, no tokens — only BLESSED message across all lanes',
  },
  // FAILED — data-only
  {
    messageId: '0xe72855c094bd104d001fed612a9db96d92b902389f459a846aae60f0420b58a5',
    txHash: '0x50e49522f478dccb49d41c847fd2dffde20ea14d464809965700a34ed0c51f4d',
    status: MessageStatus.Failed,
    version: '1.6',
    description: 'failed data-only, not ready for manual exec',
  },
  // SOURCE_FINALIZED — with token
  {
    messageId: '0xe031b5cbaa569ba82c0e62e8fffb15e2e49cfb3c724217e734bea72200fcbcde',
    txHash: '0x3a9c2a3e315a7e58e6ed33628c0c3358db6da0c21d7a2dac321f790a37b606de',
    status: MessageStatus.SourceFinalized,
    version: '1.6',
    description: 'source finalized, token transfer (CCIP-BnM)',
  },
  // SOURCE_FINALIZED — data-only
  {
    messageId: '0xced6ca0a79a49d725d638f43e2bd747709e4c3c9a4bb52e958a569f1e32a3459',
    txHash: '0xcf306bad7244ceff48507747e4cb57e9b7f4ef4d6c6bc488c0bf411eec763fb1',
    status: MessageStatus.SourceFinalized,
    version: '1.6',
    description: 'source finalized, data-only',
  },
  // SUCCESS — token transfer (recent)
  {
    messageId: '0x32b83468bed4219589c6403b4c6437b11134f6324fe0c60d5152e93c5de36cee',
    txHash: '0x6b886d22efe98731dda3bef8b302ffbd62f111932bf5433dbcd044081b9f86e7',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'token transfer (0.0001 CCIP-BnM)',
  },
  // SUCCESS — token transfer (older)
  {
    messageId: '0x9e41590fe803f0977dd66d005bc4d7b1551f07228693374beb13aca2fc2eabec',
    txHash: '0x33861bffcf8ab35e5265ed5d519c0abbe066b828bc9852d38fc473c5e9f1df41',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'token transfer (0.001 CCIP-BnM)',
  },
  // SUCCESS — data-only
  {
    messageId: '0x04c8a26e34589a21fe1837f7454561af11e28e32eb506e20bf16bedb337fb277',
    txHash: '0x77241dac3f1952ce0e6c1c4ad6548f9dd697a0b2989f7554d12fd428988ae47b',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'data-only, no token transfer',
  },
]

// ── Fuji → Sepolia (EVM → EVM) ──

export const FUJI_TO_SEPOLIA: ForkTestMessage[] = [
  // FAILED — data-only, gasLimit=1 (intentionally low), used by existing executeReport test
  {
    messageId: '0xe7b71ffcab4fc1ad029c412bb75b33a2d036b59853f08b9306cc317690a29246',
    txHash: '0xccf840f3e8268ad00822458862408a642d3bbef079096cacf65a68c8f2e21bc9',
    status: MessageStatus.Failed,
    version: '1.6',
    description:
      'failed data-only (gasLimit=1), ready for manual exec — used by existing executeReport test',
  },
  // VERIFIED — token transfer via contract
  {
    messageId: '0x3947f2c41dfc48be4186a45a0765301460ac1d08f6c5566f538596bd9cd1c97f',
    txHash: '0x9cf08fcd2e6071fc8045eff624449b1a5b0f2c8f4aadc8b85d2d79b6125a82f0',
    status: MessageStatus.Verified,
    version: '2.0',
    description: 'verified, token transfer with calldata, sent via contract',
  },
  // VERIFIED — token transfer, direct sender
  {
    messageId: '0x96d34613aef6771c4abfd53ec7b5dcae783a5faa792bc3c8c0997e582666a1a8',
    txHash: '0x39ce6e6954b637f66bfb63fe3c76ddb2dead0a461f12542b2569820ecc3d646f',
    status: MessageStatus.Verified,
    version: '2.0',
    description: 'verified, token transfer (1 token), no calldata',
  },
  // VERIFIED — data-only
  {
    messageId: '0x17c66e061f3dd839392d48f9d525637f9ef054c58a736e3c598d1b36f8135aa5',
    txHash: '0x15d1da8fc22d5b21958d230f530562b55fbe7f545e5c36b604525a978f42ec84',
    status: MessageStatus.Verified,
    version: '2.0',
    description: 'verified, data-only, no token transfer',
  },
  // FAILED — data-only
  {
    messageId: '0xba823dd1a4b4d87638bd69e17ff671bd9eb9b8a65d6ca3f5ab767d78b00e481d',
    txHash: '0x5ff94a1643eb45409ffe9633c86e807017c7111c533a61aa01b8bbb13f638c69',
    status: MessageStatus.Failed,
    version: '1.6',
    description: 'failed data-only, ready for manual exec',
  },
  // SOURCE_FINALIZED — data-only
  {
    messageId: '0x2c65e216060b1a5ab29596efec58dc67a70b031248ea3e37fe4993069af18ff9',
    txHash: '0x217c4c7956a39ed46da8f3a8a5c23109f7e71f8ea8c80a3efe4bbc1a6d0c93d2',
    status: MessageStatus.SourceFinalized,
    version: '1.6',
    description: 'source finalized, data-only',
  },
  // SUCCESS — USDC transfer via contract
  {
    messageId: '0xe6a8037712a8e8b8bc09fed1978374b9017b88e462bdd361fd44fee10f068f50',
    txHash: '0xbe684b671c5b6c20d05fa948fc83e17abda8fcb147d83a939db459f04669bf28',
    status: MessageStatus.Success,
    version: '1.5',
    description: 'USDC transfer (1 USDC) with calldata, sent via contract',
  },
  // SUCCESS — tiny token transfer (1 wei)
  {
    messageId: '0xccfa8b06005e4f76eb1e01e5b12bc6e36b04a54c52253d00cd2f584d8247ec9c',
    txHash: '0xc2d5875983773cf6666c0295345081fec29ca0fc4593534552b6af2645216eef',
    status: MessageStatus.Success,
    version: '1.5',
    description: 'token transfer (1 wei CCIP-BnM), no calldata',
  },
  // SUCCESS — ~1 token transfer
  {
    messageId: '0xe35ef9fc643e428152afcb44a0f8aedc7d16480d8f7caf2e67cba2fa857b0a14',
    txHash: '0x260aeec758c7a71e66234cc0594f4eae6a962959d07e01739c2fa0936adca64a',
    status: MessageStatus.Success,
    version: '1.5',
    description: 'token transfer (~1 CCIP-BnM), no calldata',
  },
  // SUCCESS — different token, v2.0
  {
    messageId: '0x885732e25391b1b451588c30fb3020db7903e1f6249aa0a40f73d75842e85f28',
    txHash: '0x6a9b3124d5f7ba5b57050826815bd2d9eb530cbac21d900c4d7dea1e36d7319d',
    status: MessageStatus.Success,
    version: '2.0',
    description: 'token transfer (1 token), no calldata',
  },
  // SUCCESS — data-only, v2.0
  {
    messageId: '0x0ff98ce9efabe08551e6d5385b98d9c0eb3001cb59eda7123aab4399cbf67677',
    txHash: '0x5b816bd5e8b9d04937a1335a56ce77c5c24b3481e17d87fb48f2be1cdcdc97de',
    status: MessageStatus.Success,
    version: '2.0',
    description: 'data-only, no token transfer',
  },
  // SUCCESS — data-only via contract
  {
    messageId: '0xb38eda2958eaa3f4e2ab934b18b1942181a968a4b909ee2f66fd608d4e7c9408',
    txHash: '0x01e9cc85b239bd999e8d516d12f70338f80db828ec3e44e0edc81f42c496232a',
    status: MessageStatus.Success,
    version: '1.5',
    description: 'data-only via contract, no token transfer',
  },
]

// ── Fuji → Aptos (EVM → Aptos) ──

export const FUJI_TO_APTOS: ForkTestMessage[] = [
  // SOURCE_FINALIZED — data-only
  {
    messageId: '0xdb04b5eec6eec0ddefb8ab7554bb157befda6a6cb1b718a8629f27e65d758bf2',
    txHash: '0xf255eb0f3d4d555475576bbd8e51d7fba27af085f62223502179c8758315117a',
    status: MessageStatus.SourceFinalized,
    version: '1.6',
    description: 'source finalized, data-only',
  },
  // SUCCESS — token transfer
  {
    messageId: '0xdfa6b193258ba47ea75da4ce4a1724f062c59d6daa239211aedf436c4b4aeec9',
    txHash: '0x13d5e92b8bd335543444c4836e82d0b755ae3cacfd749b740932ae13f93f6dcf',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'token transfer (CCIP-BnM)',
  },
  // SUCCESS — data-only
  {
    messageId: '0xecd2b92c261cb62935f2ef5179f07bc0ed21b449f407eb3500607bcffcb4436a',
    txHash: '0x8048fee930f270f8e99f7064f07038e82ea59ccb8d9621b9206880affeb740da',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'data-only, no token transfer',
  },
]

// ── Aptos → Sepolia (Aptos → EVM) ──

export const APTOS_TO_SEPOLIA: ForkTestMessage[] = [
  // FAILED — data-only
  {
    messageId: '0x4c56bdfad05e814c7b3f5f7294adf16f56ffa5e4ba19c35598abe43054fca85b',
    txHash: '0x2bb233bd1bc42933c25185da4f34135b1142b82e25ebcef073dc04d20387558a',
    status: MessageStatus.Failed,
    version: '1.6',
    description: 'failed data-only, ready for manual exec',
  },
  // FAILED — token transfer
  {
    messageId: '0xab3fbecd2bd0eee8c384c3c5665681bfc932072201d3fb959a54c2d73b5aa2e9',
    txHash: '0x48f6b2386b6db0f8d81f22edca4f4674a8a775bd7230917bd8821571ded86607',
    status: MessageStatus.Failed,
    version: '1.6',
    description: 'failed token transfer with calldata, ready for manual exec',
  },
  // SOURCE_FINALIZED — token transfer
  {
    messageId: '0xe1d6ed104b0a370bf152d3adbfe44ebffbeb0ee88acd8b3e7a96a1ddfe876a6b',
    txHash: '0xc7c0a5c1ac3d1bc525aaddbd6bd6be69b75d91ac93d2cf28905f16e6381d93d0',
    status: MessageStatus.SourceFinalized,
    version: '1.6',
    description: 'source finalized, token transfer',
  },
  // SOURCE_FINALIZED — data-only
  {
    messageId: '0x6b491f774408861d124e694423ccb625e8241de9528f21d088171f2628c8e97e',
    txHash: '0xabf1038f5e5350762df0367183c70254092a85ef2999c8e7e8ff58b13ac33cc5',
    status: MessageStatus.SourceFinalized,
    version: '1.6',
    description: 'source finalized, data-only',
  },
  // SUCCESS — token transfer with calldata
  {
    messageId: '0xdb581d52ad36629438cbc05f41c22fecb8d053df9f6d548a48fc975ec73a7ae8',
    txHash: '0x17cfd47c6174852bab976fc2b691c90a9586f907815e8a039c2c1a5ce90a86fa',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'token transfer with calldata',
  },
  // SUCCESS — different token, smaller amount
  {
    messageId: '0x680793ab61bd10a9cfb77d969834d6f29af685be9ec4f0cb3f0a5fe85aff16a1',
    txHash: '0xad7c8899fdc63fbc86cf4acd121a11aa55022271bb902b773b64c3920188d6b0',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'token transfer (different token, smaller amount)',
  },
  // SUCCESS — data-only
  {
    messageId: '0x21cefd2355eeb78b3388438b9c7065168798a8e43651ff8765b6a3281c6505c1',
    txHash: '0xaac4c4dada3fa93ca098374ebf92857cfdeb6fb73986f525bbbc1cd6fad62fac',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'data-only, no token transfer',
  },
]

// ── Aptos → Fuji (Aptos → EVM) ──

export const APTOS_TO_FUJI: ForkTestMessage[] = [
  // FAILED — token transfer
  {
    messageId: '0x4dd86657e40a43ab05acd098deeb8978f0257908f761e150654e2427f8d6527f',
    txHash: '0xbb75c1696aeb76bbbbbc033ee61e3f4c42ec264ef8e39ee9edc972f3dbbfe011',
    status: MessageStatus.Failed,
    version: '1.6',
    description: 'failed token transfer, ready for manual exec',
  },
  // SUCCESS — token transfer
  {
    messageId: '0x7acef5a95365a266cf76678be6533bcddedc5903b755fddcc0ac0c31c6f21274',
    txHash: '0x6b183e4ed8130619be13c1c0348124992e4bc0941d1d789cc5d1fb0d50fbd679',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'token transfer',
  },
  // SUCCESS — data-only
  {
    messageId: '0x7a97f70648b7d96e62084f7340dc54dc4137afdd53d68c65818bce0ece8aae2c',
    txHash: '0x315b36fdf49284b1edac0420efae3ae597174b742ed4b198d90edd26f93ef3be',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'data-only, no token transfer',
  },
]
