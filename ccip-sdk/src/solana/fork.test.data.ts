import type { ForkTestMessage } from '../evm/fork.test.data.ts'
import type { EstimateMessageInput } from '../gas.ts'
import { type VerifierResult, MessageStatus } from '../types.ts'

// All messages discovered via the CCIP staging API (api.ccip.cldev.cloud) on 2026-03-24.
// Solana mainnet chain selector: 124615329519749607
// Genesis hash: 5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d

export const SOLANA_TO_ETHEREUM: ForkTestMessage[] = [
  {
    messageId: '0x2d5cb1ef113d128b055b136fe8fd9a3c8c236e419ca524d2aae6992442b0b133',
    txHash:
      '47rEK1VRU2jdmmA4EADYRPFCRRJBsCgtNf5D9Zs9TgAq55edKoKfHiZq96wgF4HdJNqtLpqNif2zKie7anMGys1F',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'data-only message from Solana to Ethereum',
  },
  {
    messageId: '0x6bacb96f497de5c20be944c9c92570df3ee735bdba7c33840355484197c242b0',
    txHash:
      '5Vhci2yRssCAm26RZjF1JJazZcKQbyZxtsmLtLiD4gjZ6AGSpm8aRZrL2SDi2r1vK2e7cdyCFyb6aVYN8D8rTPJS',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'USDC token transfer (~57.8 USDC) from Solana to Ethereum',
  },
  {
    messageId: '0x71ccbe8726eef5f4678db2d73e27a93bef18094beac17e252fd69ff9169abe7b',
    txHash:
      '2r6L7HSFVLTi7DWEieHeJYNALmkCZH8vTba8JwGkCniHAxUZXpSHg3Ujkt622ETNoekQEpMz7Ainx3z8K5xd3b6j',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'USDC token transfer (~13.7 USDC) from Solana to Ethereum',
  },
]

export const ETHEREUM_TO_SOLANA: ForkTestMessage[] = [
  {
    messageId: '0x8c8edfe2c116630204c2fa44ec4461024b3a4439cc98ae137a11c98647f8ab8c',
    txHash: '0x31f4f01bb07a1d990cba9bbbf5b044f6d794e3c07be48e4f6bc988377b92a750',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'data-only message from Ethereum to Solana',
  },
  {
    messageId: '0x7ed0b76fde523b4723e75300cf92e38bd2629429a27a1ce6a69e431d8e5d024a',
    txHash: '0x5b8ebd841d581566d8ce63166e1805f950aee27fed5c930e4411bfc9c0e5b61c',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'token transfer from BSC to Solana (~15B units)',
  },
  {
    messageId: '0xda90d3c54f7ce256c8fa45ee0b8f265c48bf4446810d560ecfc9deebe41c9cff',
    txHash: '0xc7731e71a9aa0cd8a241ee0dcd3c824a6f88bad329ecb2b5b0d0dd6219b6a02c',
    status: MessageStatus.Failed,
    version: '1.6',
    description: 'failed token transfer (10 tokens) from Base to Solana, receiver=system program',
  },
]

export const FUJI_TO_SOLANA: ForkTestMessage[] = [
  {
    messageId: '0xa1faadaaec9be0b0da3e313ddf86ab59e6bf2fade84798d03547f1de07f965ad',
    txHash: '0xf227699a7b8c962b46607647b2c8548439f7e710b8f3e08d0678aeefe5d262c6',
    status: MessageStatus.Failed,
    version: '1.6',
    description:
      'failed data-only message from Fuji to Solana devnet; receiver rejects all messages',
  },
]

// based off on https://ccip.chain.link/msg/0xcf961d156e9278ba53ee92b4648e3db37793a360aaca1341cb5f752e6c598602
export const SOLANA_ESTIMATE_RECEIVER_MESSAGE: EstimateMessageInput = {
  sourceChainSelector: 16015286601757825753n,
  receiver: 'BesnAdTWpzME36BGb9uv55NWQzzREc7K9rMCsUSzjUei',
  data: 'SGVsbG8gU29sYW5hIENDSVA=',
  tokenAmounts: [
    {
      amount: 1000000000000000000n,
      extraData: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABI=',
      token: 'J7cTWLLwHQfsv7c384FBrWKQVYJY853pBFQmK1TWsg3Y',
    },
  ],
  tokenReceiver: 'DXdqFCfipfcK34Y2nYkdBqsDH5VDFzFVE9MEFmGs3PcE',
  accounts: [
    'H4UWEXGwhkBr5ofoEXZMSbd5SVyWhbYrmxWt7Bbuaiwt',
    'F8CGQmR7ofkzoXmNyUre3VTvwjxAehNbTnWv9DPSiQrB',
    'J7cTWLLwHQfsv7c384FBrWKQVYJY853pBFQmK1TWsg3Y',
    'Da1dtMUhyXLdPGEe5hUGJXW6u3W5cZ5irgSDG4MrYdcp',
    'DXdqFCfipfcK34Y2nYkdBqsDH5VDFzFVE9MEFmGs3PcE',
    'HhZogge3sHoQoYyMbcjtKjwSBWqYFkvrQeziHHGuVM2u',
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  ],
  accountIsWritableBitmap: 42n,
}

// CCIP 2.0 private staging deployment on Solana devnet (selector 16423721717087811551), used by
// the account resolution fork tests. `sendLookupTable` is the deployment's fixed ccip_send lookup
// table: resolution only returns the lookup tables it discovers (e.g. token pools'), so callers
// add this one themselves, and token transfers only fit a v0 transaction with it.
export const SOLANA_DEVNET_V2_STAGING = {
  router: 'CcipP6NhMw34e7hNJXmNytvzmSYrwQ1TcFgfQAxJhNqm',
  offRamp: 'offzdKY3MVHcs8c639Atwqr7KGbZrxmNDC27s2DJeEr',
  sendLookupTable: '61yGrR9h9YU7wq5b3LiYSdePou1iAg5giaVMBig8fK6m',
  committeeVerifier: 'CVMVgsQYG7NHp7NY2XWCNkXjxAw5E14dnFHNu8e2Gt3M',
  executor: 'Exet1XoEHNwruTsyjsB2v9JrgBQm8EPVzncJ3gkAP14w',
  sepoliaSelector: 16015286601757825753n,
  // SPL token with a BurnMint 2.0 pool on the Sepolia lane
  sepoliaToken: '3pGvaqUczmzrxA62F1egTf9wpwJ6WNLoPQ823eCXmipc',
  sepoliaTokenPool: '29VTYP3rprC2vQPUteiR45UTsHWD2L2QXAseJmMeEpWZ',
  // landed ccip_send_v2 (Solana -> Sepolia) and execute_v2 (Sepolia -> Solana) transactions
  sendTx:
    '5RrQuDzcwPdVTKTTLVNhz31V5XzNLRZdxaGzLQddqePsu4TYycS6BMKP8V2WtuQ2VS9GdWTZfGt4WjnzKMBZFdM5',
  executeTx:
    '4qeWX8ELjDt57JLDuDsSW3jYzP915R7wyXLWMshPZJkiDVxt1HAv2DTqmNow64Nxns8PSgrX1vLTYHWTabjFztDM',
  executeMessageId: '0x6aada2cd53b51bd5b4f12cbd01b1e43a092d692e3211dd8a8cb062f28c28144f',
} as const

// A Sepolia -> Solana devnet token-only transfer on the CCIP 2.0 staging lane, from the staging
// API on 2026-10-02. Sent with executor NO_EXECUTION_ADDRESS, so no executor delivers it: it stays
// unexecuted on devnet, for a fork to execute through execute_v2 for real. Don't execute it on
// devnet.
export const SEPOLIA_TO_SOLANA_DEVNET_V2_NOEXEC = {
  messageId: '0x988b37bd1730c0c7e62f4bae4d6c5d315caef0a7df2eb1e65cde6bcfc6f22101',
  sendTx: '0x642dc16ccaeb2b9f4e3a68c94fc08a94242cc50b8289088c874dcd5360edcb96',
  sequenceNumber: 12634n,
  onRamp: '0x99F6Faf45CcfA166781DED7d9A4D9C548F2aA344',
  sender: '0x4aA1B21843b42bA0aB356707a84876DB0B671206',
  executor: '0xEBa517d200000000000000000000000000000000',
  // the source CCV (committee verifier) the message requires
  sourceCcvs: ['0x0849847ff1d46E2dca6DB46Bc36A69E228709805'],
  // 1e16 units of the staging BurnMint token (18 decimals on Sepolia) to the token receiver's ATA,
  // with no data and no receiver: execute_v2 consults the token pool, not a receiver
  sourceToken: '0x8566387689573c0c4aFf427c30e3935039185C7D',
  sourceTokenPool: '0x7512C1885cB1D67c369CBfFA153B22E039E0b218',
  destToken: SOLANA_DEVNET_V2_STAGING.sepoliaToken,
  amount: 10_000_000_000_000_000n,
  tokenReceiver: 'GVuEzxzvpVQr9RTwNguw4AcZSZmGiP9EWaRPkp8x6Xrx',
  // keccak256 of it is the messageId
  encodedMessage:
    '0x01de41ba4fc9d91ad9e3ecc7e294e337df000000000000315a000b7d4000000000000000003f289fa51fafa6740d7be098251dc6364dcf0fe1603054daf8ff7ce6bdb86ceb2000000000000000000000000099f6faf45ccfa166781ded7d9a4d9c548f2aa344200bf471b27864b619aefea0b87423c2077f77672be8229af45fc8c2db8bf786df200000000000000000000000004aa1b21843b42ba0ab356707a84876db0b671206200000000000000000000000000000000000000000000000000000000000000000000e1a2b3c4d0000000000000000000000c701000000000000000000000000000000000000000000000000002386f26fc10000200000000000000000000000007512c1885cb1d67c369cbffa153b22e039e0b218200000000000000000000000008566387689573c0c4aff427c30e3935039185c7d2029d3ad522f9124c53e405570216ef1922116eb6939771b651a2051f35dcb396d20e646a2d46a2e6fdcf7183a3c98e84fd9a95d2aebc9469b1b3ac48aab7ee28961002000000000000000000000000000000000000000000000000000000000000000120000',
  // the committee verifier's result, from its aggregator on 2026-10-02 (the staging API doesn't
  // serve it yet): its destAddress is SOLANA_DEVNET_V2_STAGING.committeeVerifier
  verifications: [
    {
      destAddress: 'CVMVgsQYG7NHp7NY2XWCNkXjxAw5E14dnFHNu8e2Gt3M',
      ccvData:
        '0xe9a05a200080b9e440f81b36037c745f25e39ea7fff0cd5689523560b6af00dd58fb964604b23db6f05ef9b91004403e01790a32f2db591067cf851b715bf7fc27a8f5ec469e7dc0e410c5fc836186d202229e206ce43b4e3df68a01ee79e850b0bbb0adf5c91f1c61688689cbd3c8686197ab03687c2b66b70e7811fb8cb0e405884b52b071',
    },
  ] as Pick<VerifierResult, 'ccvData' | 'destAddress'>[],
} as const
