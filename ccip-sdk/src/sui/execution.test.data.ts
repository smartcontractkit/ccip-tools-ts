/**
 * Recorded live payloads for the Sui failed-execution-detection REGRESSION
 * suite — the double-executed message phenomenon, captured verbatim from
 * sui-testnet while the fixtures were still in retention.
 *
 * PROVENANCE (all values real on-chain data, not fabricated):
 * - endpoint: https://fullnode.testnet.sui.io:443 (the official gRPC fullnode)
 * - recorded: 2026-10-22, through read-only SuiGrpcChainClient requests
 * - SUCCESS_TX  F9jVv5MCyauwHoVaYHRiKuYBhgBrGwHdRL1UNL4EyE9v  cp 396192399:
 *   the OCR bot's init_execute of the committed sepolia→sui text message
 *   (seq 168), emitting ocr3_base::Transmitted + offramp::ExecutionStateChanged
 *   (state 2). Message 0x1e15bb1159b4780663b642313b999bca63ab1016bfc05cc20a8cdff05480f742.
 * - DUPLICATE_TX AhvqUfUnPagbF73cuFZd67pK6h2SYcNbW1vrqwuTBtGo cp 397545835: a
 *   later manual manually_init_execute of the SAME message — the offramp's
 *   already-executed guard emits SkippedAlreadyExecuted and the PTB COMPLETES
 *   (a text-only skip aborts nothing): no ExecutionStateChanged, no failure.
 * - every response is the SuiGrpcChainClient's normalized return for the
 *   recorded request; the pages cover exactly the queries the exercised code
 *   paths issue (see execution-regression.test.ts). executePages list their
 *   transactions by digest; the replaying client serves them from txResponses
 *   (the same transactions, read with showInput/showEffects/showEvents).
 * - G2neUY2JsV… (cp 396690211) is another message's (seq 582) execution inside
 *   the regression's range: it proves the stream keys on the message id.
 */

export const executionFixtures = {
  provenance: {
    endpoint: 'https://fullnode.testnet.sui.io:443',
    recorded: '2026-10-22',
    recordedBy: 'read-only SuiGrpcChainClient requests',
    note: 'verbatim SuiGrpcChainClient responses; all values are real on-chain data',
    successTx: 'F9jVv5MCyauwHoVaYHRiKuYBhgBrGwHdRL1UNL4EyE9v',
    successCheckpoint: 396192399,
    duplicateTx: 'AhvqUfUnPagbF73cuFZd67pK6h2SYcNbW1vrqwuTBtGo',
    duplicateCheckpoint: 397545835,
  },
  chainIdentifier: '4c78adac',
  latestCheckpoint: '397969146',
  txResponses: {
    F9jVv5MCyauwHoVaYHRiKuYBhgBrGwHdRL1UNL4EyE9v: {
      digest: 'F9jVv5MCyauwHoVaYHRiKuYBhgBrGwHdRL1UNL4EyE9v',
      checkpoint: '396192399',
      timestampMs: '1792293267905',
      signatures: [],
      transaction: {
        data: {
          messageVersion: 'v1',
          sender: '0x151dd28d363d6d8a3c7f4fcdd6a36485ab2434e10628a2b7c1f80c51c78fbaaf',
          transaction: {
            kind: 'ProgrammableTransaction',
            transactions: [
              {
                MoveCall: {
                  package: '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6',
                  module: 'offramp',
                  function: 'init_execute',
                  type_arguments: [],
                  arguments: [
                    {
                      Input: 0,
                    },
                    {
                      Input: 1,
                    },
                    {
                      Input: 2,
                    },
                    {
                      Input: 3,
                    },
                    {
                      Input: 4,
                    },
                  ],
                },
              },
              {
                MoveCall: {
                  package: '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6',
                  module: 'offramp',
                  function: 'finish_execute',
                  type_arguments: [],
                  arguments: [
                    {
                      Input: 0,
                    },
                    {
                      Input: 1,
                    },
                    {
                      Result: 0,
                    },
                  ],
                },
              },
            ],
            inputs: [
              {
                type: 'object',
                objectType: 'sharedObject',
                objectId: '0xc38827d91c5bbe72e88b213a7ffc7b3460d2df4984b67605783446111ca06281',
                initialSharedVersion: '659034287',
                mutable: false,
              },
              {
                type: 'object',
                objectType: 'sharedObject',
                objectId: '0x966c3391b10675b8791fefeb2a18345a7716b65b32abcd0dec560e937904a6bf',
                initialSharedVersion: '659034303',
                mutable: true,
              },
              {
                type: 'object',
                objectType: 'sharedObject',
                objectId: '0x0000000000000000000000000000000000000000000000000000000000000006',
                initialSharedVersion: '1',
                mutable: false,
              },
              {
                type: 'pure',
                value:
                  '0x0220000ac75625cc5db0360c69475e85e733a93bcd9da31bdc2ea8be3732c3192f782000000000000000000000000000000000000000000000000000000000002e2d43',
              },
              {
                type: 'pure',
                value:
                  '0xc301d91ad9c94fba41de1e15bb1159b4780663b642313b999bca63ab1016bfc05cc20a8cdff05480f742d91ad9c94fba41deec1182faa7c27b87a800000000000000000000000000000014540f2eb3af8c47f8e3bf027d6702d6f5e46e65dd021337ba738da6a08aabddf7743da9059a09c0e7e5fc04a56db007a66b4bf7daa33fb040420f00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
              },
            ],
          },
          gasData: {
            budget: '2416582',
            owner: '0x151dd28d363d6d8a3c7f4fcdd6a36485ab2434e10628a2b7c1f80c51c78fbaaf',
            payment: [
              {
                digest: 'ERodvxfd1fbLjSQdamrgVJn5c6h6bypXJxQTPcEcs8Xx',
                objectId: '0x55293828142b63f1cb62ca88c8037264dbc8f88dbe8f2e976ad78831a20907b3',
                version: '1057302580',
              },
            ],
            price: '1000',
          },
        },
      },
      effects: {
        status: {
          status: 'success',
        },
        gasUsed: {
          computationCost: '1000000n',
          storageCost: '16324800n',
          storageRebate: '14909709n',
          nonRefundableStorageFee: '1491n',
        },
        created: [],
        gasObject: {
          reference: {
            objectId: '0x55293828142b63f1cb62ca88c8037264dbc8f88dbe8f2e976ad78831a20907b3',
            version: '0',
            digest: '',
          },
        },
        eventsDigest: 'HgGiuc4r1S8AzndiAJLjabhiZyZ7eHL3PiTaLFPs3kvQ',
        dependencies: [],
        lamportVersion: '1057315619n',
      },
      events: [
        {
          id: {
            txDigest: '',
            eventSeq: '0',
          },
          packageId: '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6',
          parsedJson: {
            config_digest: [
              0, 10, 199, 86, 37, 204, 93, 176, 54, 12, 105, 71, 94, 133, 231, 51, 169, 59, 205,
              157, 163, 27, 220, 46, 168, 190, 55, 50, 195, 25, 47, 120,
            ],
            ocr_plugin_type: 1,
            sequence_number: '3026243',
          },
          sender: '0x151dd28d363d6d8a3c7f4fcdd6a36485ab2434e10628a2b7c1f80c51c78fbaaf',
          transactionModule:
            '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6::offramp',
          type: '0x01a0a22b2abacbd48e9a026c1661189a8ec5ce4942cba07017b63eaad0a205a4::ocr3_base::Transmitted',
          bcs: '',
          bcsEncoding: 'base64',
        },
        {
          id: {
            txDigest: '',
            eventSeq: '0',
          },
          packageId: '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6',
          parsedJson: {
            message_hash: [
              195, 161, 194, 85, 241, 55, 206, 241, 17, 202, 106, 51, 102, 249, 200, 180, 110, 13,
              57, 139, 197, 104, 145, 123, 46, 194, 4, 112, 254, 153, 209, 245,
            ],
            message_id: [
              30, 21, 187, 17, 89, 180, 120, 6, 99, 182, 66, 49, 59, 153, 155, 202, 99, 171, 16, 22,
              191, 192, 92, 194, 10, 140, 223, 240, 84, 128, 247, 66,
            ],
            sequence_number: '168',
            source_chain_selector: '16015286601757825753',
            state: 2,
          },
          sender: '0x151dd28d363d6d8a3c7f4fcdd6a36485ab2434e10628a2b7c1f80c51c78fbaaf',
          transactionModule:
            '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6::offramp',
          type: '0x01a0a22b2abacbd48e9a026c1661189a8ec5ce4942cba07017b63eaad0a205a4::offramp::ExecutionStateChanged',
          bcs: '',
          bcsEncoding: 'base64',
        },
      ],
    },
    G2neUY2JsVc4v7ZsU2WKMYwff3pyUXQcBqHeYxpt4PrX: {
      digest: 'G2neUY2JsVc4v7ZsU2WKMYwff3pyUXQcBqHeYxpt4PrX',
      checkpoint: '396690211',
      timestampMs: '1792401954316',
      signatures: [],
      transaction: {
        data: {
          messageVersion: 'v1',
          sender: '0xb804a62e626c53ba707aafbb6f8e9406d375fe79af00545e8427c3f403283357',
          transaction: {
            kind: 'ProgrammableTransaction',
            transactions: [
              {
                MoveCall: {
                  package: '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6',
                  module: 'offramp',
                  function: 'init_execute',
                  type_arguments: [],
                  arguments: [
                    {
                      Input: 0,
                    },
                    {
                      Input: 1,
                    },
                    {
                      Input: 2,
                    },
                    {
                      Input: 3,
                    },
                    {
                      Input: 4,
                    },
                  ],
                },
              },
              {
                MoveCall: {
                  package: '0x6a97d9f8e0c6dcb294f0a5331f4ce58d09525f85eb7ddff4978c251c31947fe8',
                  module: 'managed_token_pool',
                  function: 'release_or_mint',
                  type_arguments: [
                    '0xde9a44c43b1e5cf3bee4ae5d6c1aa53f2981513ab3354ebace4fba470f44f92a::ccip_burn_mint_token::CCIP_BURN_MINT_TOKEN',
                  ],
                  arguments: [
                    {
                      Input: 0,
                    },
                    {
                      Result: 0,
                    },
                    {
                      Input: 2,
                    },
                    {
                      Input: 5,
                    },
                    {
                      Input: 6,
                    },
                    {
                      Input: 7,
                    },
                  ],
                },
              },
              {
                MoveCall: {
                  package: '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6',
                  module: 'offramp',
                  function: 'finish_execute',
                  type_arguments: [],
                  arguments: [
                    {
                      Input: 0,
                    },
                    {
                      Input: 1,
                    },
                    {
                      Result: 0,
                    },
                  ],
                },
              },
            ],
            inputs: [
              {
                type: 'object',
                objectType: 'sharedObject',
                objectId: '0xc38827d91c5bbe72e88b213a7ffc7b3460d2df4984b67605783446111ca06281',
                initialSharedVersion: '659034287',
                mutable: false,
              },
              {
                type: 'object',
                objectType: 'sharedObject',
                objectId: '0x966c3391b10675b8791fefeb2a18345a7716b65b32abcd0dec560e937904a6bf',
                initialSharedVersion: '659034303',
                mutable: true,
              },
              {
                type: 'object',
                objectType: 'sharedObject',
                objectId: '0x0000000000000000000000000000000000000000000000000000000000000006',
                initialSharedVersion: '1',
                mutable: false,
              },
              {
                type: 'pure',
                value:
                  '0x0220000ac75625cc5db0360c69475e85e733a93bcd9da31bdc2ea8be3732c3192f782000000000000000000000000000000000000000000000000000000000002e7189',
              },
              {
                type: 'pure',
                value:
                  '0xbc02fb968f03709115b800d14896fdbe36ccc1d9b310f3f04ab28a6d5f19baeb610c7c94b756cafc21affb968f03709115b8ec1182faa7c27b87460200000000000000000000000000001489810cb91a5fe67ddf3483182f08e1559a5699de0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000efb7673bf1544d0228c91f8cc184ff5b040059bcbd9f057f2c17f8bfb2e1707201149f49971b7c86e258f25f5a2e1fe740c0e1b903f1331ce2ba0901fec09d863f0d4162ae29bae2898922e345f3e4cd356363ce3c1b905f010020000000000000000000000000000000000000000000000000000000000000001200009e1869d02904000000000000000000000000000000000000000000000000010000',
              },
              {
                type: 'object',
                objectType: 'sharedObject',
                objectId: '0x0000000000000000000000000000000000000000000000000000000000000403',
                initialSharedVersion: '22257037',
                mutable: false,
              },
              {
                type: 'object',
                objectType: 'sharedObject',
                objectId: '0x91b9ca848f5c8bac560b5570265a8ad2f9f970a4efc73bb26465ee1f308ede84',
                initialSharedVersion: '677238672',
                mutable: true,
              },
              {
                type: 'object',
                objectType: 'sharedObject',
                objectId: '0xa93f7f6dd23f6244d06b85e9d324aa68ea9a8cfc72a4d916ad974b045843f2a6',
                initialSharedVersion: '679834449',
                mutable: true,
              },
            ],
          },
          gasData: {
            budget: '4215128',
            owner: '0xb804a62e626c53ba707aafbb6f8e9406d375fe79af00545e8427c3f403283357',
            payment: [
              {
                digest: 'FMh5J8GuP84sexjohaXdFNAcAMk8rN2oCNkSYanxHnoK',
                objectId: '0x01714b2a8dd229227d2ff729e36857e1f18a251f2fc96cec49091015589b1871',
                version: '1058813045',
              },
            ],
            price: '1000',
          },
        },
      },
      effects: {
        status: {
          status: 'success',
        },
        gasUsed: {
          computationCost: '1230000',
          storageCost: '32619200',
          storageRebate: '29637036',
          nonRefundableStorageFee: '2964',
        },
        created: [],
        gasObject: {
          reference: {
            objectId: '0x01714b2a8dd229227d2ff729e36857e1f18a251f2fc96cec49091015589b1871',
            version: '0',
            digest: '',
          },
        },
        eventsDigest: 'CVGbdFg7g7xfoLXR2xUN8Up7eckubXxAFWxw2Rf5czB8',
        dependencies: [],
        lamportVersion: '1058826437',
      },
      events: [
        {
          id: {
            txDigest: '',
            eventSeq: '0',
          },
          packageId: '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6',
          parsedJson: {
            config_digest: 'AArHViXMXbA2DGlHXoXnM6k7zZ2jG9wuqL43MsMZL3g=',
            ocr_plugin_type: 1,
            sequence_number: '3043721',
          },
          sender: '0xb804a62e626c53ba707aafbb6f8e9406d375fe79af00545e8427c3f403283357',
          transactionModule:
            '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6::offramp',
          type: '0x01a0a22b2abacbd48e9a026c1661189a8ec5ce4942cba07017b63eaad0a205a4::ocr3_base::Transmitted',
          bcs: '',
          bcsEncoding: 'base64',
        },
        {
          id: {
            txDigest: '',
            eventSeq: '0',
          },
          packageId: '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6',
          parsedJson: {
            message_hash: 'z5i5RcrX2dBv4UkyaNKpgnkKdt/8XquWuFLo5VJU2Ds=',
            message_id: 'ANFIlv2+NszB2bMQ8/BKsoptXxm662EMfJS3Vsr8Ia8=',
            sequence_number: '582',
            source_chain_selector: '13264668187771770619',
            state: 2,
          },
          sender: '0xb804a62e626c53ba707aafbb6f8e9406d375fe79af00545e8427c3f403283357',
          transactionModule:
            '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6::offramp',
          type: '0x01a0a22b2abacbd48e9a026c1661189a8ec5ce4942cba07017b63eaad0a205a4::offramp::ExecutionStateChanged',
          bcs: '',
          bcsEncoding: 'base64',
        },
        {
          id: {
            txDigest: '',
            eventSeq: '0',
          },
          packageId: '0x6a97d9f8e0c6dcb294f0a5331f4ce58d09525f85eb7ddff4978c251c31947fe8',
          parsedJson: {
            remote_chain_selector: '13264668187771770619',
            tokens: '300000000',
          },
          sender: '0xb804a62e626c53ba707aafbb6f8e9406d375fe79af00545e8427c3f403283357',
          transactionModule:
            '0x6a97d9f8e0c6dcb294f0a5331f4ce58d09525f85eb7ddff4978c251c31947fe8::managed_token_pool',
          type: '0x6a97d9f8e0c6dcb294f0a5331f4ce58d09525f85eb7ddff4978c251c31947fe8::token_pool_rate_limiter::TokensConsumed',
          bcs: '',
          bcsEncoding: 'base64',
        },
        {
          id: {
            txDigest: '',
            eventSeq: '0',
          },
          packageId: '0x6a97d9f8e0c6dcb294f0a5331f4ce58d09525f85eb7ddff4978c251c31947fe8',
          parsedJson: {
            amount: '300000000',
            mint_cap: '0x8a18483f59b74afe593e2ffcdc9898b057b0631c9b72a9aa0308188736b2f742',
            minter: '0xb804a62e626c53ba707aafbb6f8e9406d375fe79af00545e8427c3f403283357',
            to: '0xefb7673bf1544d0228c91f8cc184ff5b040059bcbd9f057f2c17f8bfb2e17072',
          },
          sender: '0xb804a62e626c53ba707aafbb6f8e9406d375fe79af00545e8427c3f403283357',
          transactionModule:
            '0x6a97d9f8e0c6dcb294f0a5331f4ce58d09525f85eb7ddff4978c251c31947fe8::managed_token_pool',
          type: '0x2498ef5418740a8c422b9581cd9b8b56cc372938a2111557c158c46307d916f0::managed_token::Minted',
          bcs: '',
          bcsEncoding: 'base64',
        },
        {
          id: {
            txDigest: '',
            eventSeq: '0',
          },
          packageId: '0x6a97d9f8e0c6dcb294f0a5331f4ce58d09525f85eb7ddff4978c251c31947fe8',
          parsedJson: {
            amount: '300000000',
            local_token: '0x331ce2ba0901fec09d863f0d4162ae29bae2898922e345f3e4cd356363ce3c1b',
            recipient: '0xefb7673bf1544d0228c91f8cc184ff5b040059bcbd9f057f2c17f8bfb2e17072',
            remote_chain_selector: '13264668187771770619',
          },
          sender: '0xb804a62e626c53ba707aafbb6f8e9406d375fe79af00545e8427c3f403283357',
          transactionModule:
            '0x6a97d9f8e0c6dcb294f0a5331f4ce58d09525f85eb7ddff4978c251c31947fe8::managed_token_pool',
          type: '0x6a97d9f8e0c6dcb294f0a5331f4ce58d09525f85eb7ddff4978c251c31947fe8::token_pool::ReleasedOrMinted',
          bcs: '',
          bcsEncoding: 'base64',
        },
      ],
    },
    AhvqUfUnPagbF73cuFZd67pK6h2SYcNbW1vrqwuTBtGo: {
      digest: 'AhvqUfUnPagbF73cuFZd67pK6h2SYcNbW1vrqwuTBtGo',
      checkpoint: '397545835',
      timestampMs: '1792594298044',
      signatures: [],
      transaction: {
        data: {
          messageVersion: 'v1',
          sender: '0xefb7673bf1544d0228c91f8cc184ff5b040059bcbd9f057f2c17f8bfb2e17072',
          transaction: {
            kind: 'ProgrammableTransaction',
            transactions: [
              {
                MoveCall: {
                  package: '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6',
                  module: 'offramp',
                  function: 'manually_init_execute',
                  type_arguments: [],
                  arguments: [
                    {
                      Input: 0,
                    },
                    {
                      Input: 1,
                    },
                    {
                      Input: 2,
                    },
                    {
                      Input: 3,
                    },
                  ],
                },
              },
              {
                MoveCall: {
                  package: '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6',
                  module: 'offramp',
                  function: 'finish_execute',
                  type_arguments: [],
                  arguments: [
                    {
                      Input: 0,
                    },
                    {
                      Input: 1,
                    },
                    {
                      Result: 0,
                    },
                  ],
                },
              },
            ],
            inputs: [
              {
                type: 'object',
                objectType: 'sharedObject',
                objectId: '0xc38827d91c5bbe72e88b213a7ffc7b3460d2df4984b67605783446111ca06281',
                initialSharedVersion: '659034287',
                mutable: false,
              },
              {
                type: 'object',
                objectType: 'sharedObject',
                objectId: '0x966c3391b10675b8791fefeb2a18345a7716b65b32abcd0dec560e937904a6bf',
                initialSharedVersion: '659034303',
                mutable: true,
              },
              {
                type: 'object',
                objectType: 'sharedObject',
                objectId: '0x0000000000000000000000000000000000000000000000000000000000000006',
                initialSharedVersion: '1',
                mutable: false,
              },
              {
                type: 'pure',
                value:
                  '0xc301d91ad9c94fba41de1e15bb1159b4780663b642313b999bca63ab1016bfc05cc20a8cdff05480f742d91ad9c94fba41deec1182faa7c27b87a800000000000000000000000000000014540f2eb3af8c47f8e3bf027d6702d6f5e46e65dd021337ba738da6a08aabddf7743da9059a09c0e7e5fc04a56db007a66b4bf7daa33fb040420f00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
              },
            ],
          },
          gasData: {
            budget: '2001186',
            owner: '0xefb7673bf1544d0228c91f8cc184ff5b040059bcbd9f057f2c17f8bfb2e17072',
            payment: [],
            price: '1000',
          },
        },
      },
      effects: {
        status: {
          status: 'success',
        },
        gasUsed: {
          computationCost: '1000000n',
          storageCost: '11856000n',
          storageRebate: '11854814n',
          nonRefundableStorageFee: '1186n',
        },
        created: [],
        eventsDigest: 'D3CEwK4geqrUxwqn6ZGszuxETcVkARvx4PfhKRAcyg5x',
        dependencies: [],
        lamportVersion: '1061505744n',
      },
      events: [
        {
          id: {
            txDigest: '',
            eventSeq: '0',
          },
          packageId: '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6',
          parsedJson: {
            sequence_number: '168',
            source_chain_selector: '16015286601757825753',
          },
          sender: '0xefb7673bf1544d0228c91f8cc184ff5b040059bcbd9f057f2c17f8bfb2e17072',
          transactionModule:
            '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6::offramp',
          type: '0x01a0a22b2abacbd48e9a026c1661189a8ec5ce4942cba07017b63eaad0a205a4::offramp::SkippedAlreadyExecuted',
          bcs: '',
          bcsEncoding: 'base64',
        },
      ],
    },
  },
  eventsPages: [
    {
      cursor: null,
      page: {
        data: [
          {
            id: {
              txDigest: 'G2neUY2JsVc4v7ZsU2WKMYwff3pyUXQcBqHeYxpt4PrX',
              eventSeq: '1',
            },
            packageId: '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6',
            parsedJson: {
              source_chain_selector: '13264668187771770619',
              sequence_number: '582',
              message_id: [
                0, 209, 72, 150, 253, 190, 54, 204, 193, 217, 179, 16, 243, 240, 74, 178, 138, 109,
                95, 25, 186, 235, 97, 12, 124, 148, 183, 86, 202, 252, 33, 175,
              ],
              message_hash: [
                207, 152, 185, 69, 202, 215, 217, 208, 111, 225, 73, 50, 104, 210, 169, 130, 121,
                10, 118, 223, 252, 94, 171, 150, 184, 82, 232, 229, 82, 84, 216, 59,
              ],
              state: 2,
            },
            sender: '0xb804a62e626c53ba707aafbb6f8e9406d375fe79af00545e8427c3f403283357',
            transactionModule:
              '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6::offramp',
            type: '0x01a0a22b2abacbd48e9a026c1661189a8ec5ce4942cba07017b63eaad0a205a4::offramp::ExecutionStateChanged',
            bcs: '+5aPA3CRFbhGAgAAAAAAACAA0UiW/b42zMHZsxDz8Eqyim1fGbrrYQx8lLdWyvwhryDPmLlFytfZ0G/hSTJo0qmCeQp23/xeq5a4UujlUlTYOwI=',
            bcsEncoding: 'base64',
          },
          {
            id: {
              txDigest: 'F9jVv5MCyauwHoVaYHRiKuYBhgBrGwHdRL1UNL4EyE9v',
              eventSeq: '1',
            },
            packageId: '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6',
            parsedJson: {
              source_chain_selector: '16015286601757825753',
              sequence_number: '168',
              message_id: [
                30, 21, 187, 17, 89, 180, 120, 6, 99, 182, 66, 49, 59, 153, 155, 202, 99, 171, 16,
                22, 191, 192, 92, 194, 10, 140, 223, 240, 84, 128, 247, 66,
              ],
              message_hash: [
                195, 161, 194, 85, 241, 55, 206, 241, 17, 202, 106, 51, 102, 249, 200, 180, 110, 13,
                57, 139, 197, 104, 145, 123, 46, 194, 4, 112, 254, 153, 209, 245,
              ],
              state: 2,
            },
            sender: '0x151dd28d363d6d8a3c7f4fcdd6a36485ab2434e10628a2b7c1f80c51c78fbaaf',
            transactionModule:
              '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6::offramp',
            type: '0x01a0a22b2abacbd48e9a026c1661189a8ec5ce4942cba07017b63eaad0a205a4::offramp::ExecutionStateChanged',
            bcs: '2RrZyU+6Qd6oAAAAAAAAACAeFbsRWbR4BmO2QjE7mZvKY6sQFr/AXMIKjN/wVID3QiDDocJV8TfO8RHKajNm+ci0bg05i8VokXsuwgRw/pnR9QI=',
            bcsEncoding: 'base64',
          },
        ],
        hasNextPage: false,
        nextCursor: {
          txDigest: 'grpc:KAFCDgiP1fW8ARDoqaTDDxgB',
          eventSeq: '1',
        },
      },
    },
  ],
  executePages: [
    {
      filter: {
        package: '0x01a0a22b2abacbd48e9a026c1661189a8ec5ce4942cba07017b63eaad0a205a4',
        module: 'offramp',
        function: 'init_execute',
      },
      cursor: null,
      page: {
        digests: [],
        hasNextPage: false,
        nextCursor: null,
      },
    },
    {
      filter: {
        package: '0x01a0a22b2abacbd48e9a026c1661189a8ec5ce4942cba07017b63eaad0a205a4',
        module: 'offramp',
        function: 'manually_init_execute',
      },
      cursor: null,
      page: {
        digests: [],
        hasNextPage: false,
        nextCursor: null,
      },
    },
    {
      filter: {
        package: '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6',
        module: 'offramp',
        function: 'init_execute',
      },
      cursor: null,
      page: {
        digests: [
          'G2neUY2JsVc4v7ZsU2WKMYwff3pyUXQcBqHeYxpt4PrX',
          'F9jVv5MCyauwHoVaYHRiKuYBhgBrGwHdRL1UNL4EyE9v',
        ],
        hasNextPage: false,
        nextCursor: 'eyJhIjoiS0FFNkRBaWpocFM5QVJDYW9LbkdEdz09In0=',
      },
    },
    {
      filter: {
        package: '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6',
        module: 'offramp',
        function: 'manually_init_execute',
      },
      cursor: null,
      page: {
        digests: ['AhvqUfUnPagbF73cuFZd67pK6h2SYcNbW1vrqwuTBtGo'],
        hasNextPage: false,
        nextCursor: 'eyJhIjoiS0FFNkRBanJvc2k5QVJDYWdyWE1Edz09In0=',
      },
    },
  ],
  offRampOwnedObjects: {
    data: [
      {
        data: {
          objectId: '0x13ab825c301a46d066d85dcad63f1ef97a12bf208b17460d2f43aaf91419cf86',
          version: '659034303',
          digest: 'Bxq4wXob3EgHpFFSyZPxPFHvuePzW5z6EGk8TmZJWk3k',
          type: '0x01a0a22b2abacbd48e9a026c1661189a8ec5ce4942cba07017b63eaad0a205a4::offramp::OffRampStatePointer',
          owner: {
            AddressOwner: '0x01a0a22b2abacbd48e9a026c1661189a8ec5ce4942cba07017b63eaad0a205a4',
          },
          content: {
            dataType: 'moveObject',
            fields: {
              id: '0x13ab825c301a46d066d85dcad63f1ef97a12bf208b17460d2f43aaf91419cf86',
              off_ramp_object_id:
                '0x65cee13e7a48e46ac78b24020a9acf56ecee8307c84d151f63f4b0b565aee981',
            },
            hasPublicTransfer: true,
          },
        },
      },
    ],
    hasNextPage: false,
    nextCursor: null,
  },
  objectResponses: {
    '0x966c3391b10675b8791fefeb2a18345a7716b65b32abcd0dec560e937904a6bf': {
      data: {
        objectId: '0x966c3391b10675b8791fefeb2a18345a7716b65b32abcd0dec560e937904a6bf',
        version: '1062789821',
        digest: 'ETmCrk83xCknmtn485AWxxwFciMkDnyF7qhFedM87qR1',
        type: '0x01a0a22b2abacbd48e9a026c1661189a8ec5ce4942cba07017b63eaad0a205a4::offramp::OffRampState',
        owner: {
          Shared: {
            initialSharedVersion: '659034303',
          },
        },
        content: {
          dataType: 'moveObject',
          fields: {
            id: {
              id: '0x966c3391b10675b8791fefeb2a18345a7716b65b32abcd0dec560e937904a6bf',
            },
            package_ids: [
              '0x01a0a22b2abacbd48e9a026c1661189a8ec5ce4942cba07017b63eaad0a205a4',
              '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6',
            ],
            ocr3_base_state: {
              fields: {
                id: {
                  id: '0xec9a897c050e3c8b5858563ecbe837765e984e6f4460ad58f77cf18c41068020',
                },
                ocr3_configs: {
                  fields: {
                    id: {
                      id: '0xda87795f2ae0413a9509205011d16f6a10f2e6a9e43ee37cc206b4b5c91f61c7',
                    },
                    size: '2',
                  },
                },
                signer_oracles: {
                  fields: {
                    id: {
                      id: '0x8dbbacd09efdc166ac1476045cf7d609cc050c479f39de05117caa2024f52c1d',
                    },
                    size: '1',
                  },
                },
                transmitter_oracles: {
                  fields: {
                    id: {
                      id: '0xd849e343f71a4b8eed15f35937403c88f5c64b0896a3680a4ea222e8db4b3ba6',
                    },
                    size: '2',
                  },
                },
              },
            },
            chain_selector: '9762610643973837292',
            permissionless_execution_threshold_seconds: 28800,
            source_chain_configs: {
              fields: {
                contents: [
                  {
                    fields: {
                      key: '16015286601757825753',
                      value: {
                        fields: {
                          router:
                            '0x5ef4b483da6644c84aa78eae4f51a9bfb1fb4554d5134ac98892e931fcbdd6bf',
                          is_enabled: true,
                          min_seq_nr: '169',
                          is_rmn_verification_disabled: true,
                          on_ramp: [
                            35, 165, 8, 79, 167, 129, 4, 243, 223, 17, 198, 58, 229, 159, 202, 196,
                            246, 173, 157, 238,
                          ],
                        },
                      },
                    },
                  },
                  {
                    fields: {
                      key: '5224473277236331295',
                      value: {
                        fields: {
                          router:
                            '0x5ef4b483da6644c84aa78eae4f51a9bfb1fb4554d5134ac98892e931fcbdd6bf',
                          is_enabled: true,
                          min_seq_nr: '460',
                          is_rmn_verification_disabled: true,
                          on_ramp: [
                            143, 91, 237, 95, 118, 1, 2, 91, 18, 169, 123, 1, 88, 66, 32, 193, 46,
                            52, 57, 134,
                          ],
                        },
                      },
                    },
                  },
                  {
                    fields: {
                      key: '16281711391670634445',
                      value: {
                        fields: {
                          router:
                            '0x5ef4b483da6644c84aa78eae4f51a9bfb1fb4554d5134ac98892e931fcbdd6bf',
                          is_enabled: true,
                          min_seq_nr: '398',
                          is_rmn_verification_disabled: true,
                          on_ramp: [
                            244, 235, 204, 44, 7, 125, 57, 57, 67, 76, 122, 176, 87, 38, 96, 197,
                            164, 94, 77, 245,
                          ],
                        },
                      },
                    },
                  },
                  {
                    fields: {
                      key: '13264668187771770619',
                      value: {
                        fields: {
                          router:
                            '0x5ef4b483da6644c84aa78eae4f51a9bfb1fb4554d5134ac98892e931fcbdd6bf',
                          is_enabled: true,
                          min_seq_nr: '583',
                          is_rmn_verification_disabled: true,
                          on_ramp: [
                            40, 160, 37, 211, 76, 131, 11, 242, 18, 245, 210, 53, 124, 141, 202,
                            179, 45, 217, 42, 32,
                          ],
                        },
                      },
                    },
                  },
                  {
                    fields: {
                      key: '945045181441419236',
                      value: {
                        fields: {
                          router:
                            '0x5ef4b483da6644c84aa78eae4f51a9bfb1fb4554d5134ac98892e931fcbdd6bf',
                          is_enabled: true,
                          min_seq_nr: '455',
                          is_rmn_verification_disabled: true,
                          on_ramp: [
                            31, 94, 243, 135, 130, 182, 183, 198, 222, 72, 148, 6, 184, 238, 80, 78,
                            70, 240, 90, 24,
                          ],
                        },
                      },
                    },
                  },
                  {
                    fields: {
                      key: '10344971235874465080',
                      value: {
                        fields: {
                          router:
                            '0x5ef4b483da6644c84aa78eae4f51a9bfb1fb4554d5134ac98892e931fcbdd6bf',
                          is_enabled: true,
                          min_seq_nr: '471',
                          is_rmn_verification_disabled: true,
                          on_ramp: [
                            40, 160, 37, 211, 76, 131, 11, 242, 18, 245, 210, 53, 124, 141, 202,
                            179, 45, 217, 42, 32,
                          ],
                        },
                      },
                    },
                  },
                  {
                    fields: {
                      key: '3478487238524512106',
                      value: {
                        fields: {
                          router:
                            '0x5ef4b483da6644c84aa78eae4f51a9bfb1fb4554d5134ac98892e931fcbdd6bf',
                          is_enabled: true,
                          min_seq_nr: '390',
                          is_rmn_verification_disabled: true,
                          on_ramp: [
                            40, 160, 37, 211, 76, 131, 11, 242, 18, 245, 210, 53, 124, 141, 202,
                            179, 45, 217, 42, 32,
                          ],
                        },
                      },
                    },
                  },
                  {
                    fields: {
                      key: '14767482510784806043',
                      value: {
                        fields: {
                          router:
                            '0x5ef4b483da6644c84aa78eae4f51a9bfb1fb4554d5134ac98892e931fcbdd6bf',
                          is_enabled: true,
                          min_seq_nr: '22',
                          is_rmn_verification_disabled: true,
                          on_ramp: [
                            165, 213, 176, 184, 68, 200, 241, 27, 97, 242, 138, 201, 139, 186, 132,
                            222, 169, 184, 9, 83,
                          ],
                        },
                      },
                    },
                  },
                  {
                    fields: {
                      key: '16423721717087811551',
                      value: {
                        fields: {
                          router:
                            '0x5ef4b483da6644c84aa78eae4f51a9bfb1fb4554d5134ac98892e931fcbdd6bf',
                          is_enabled: true,
                          min_seq_nr: '6',
                          is_rmn_verification_disabled: true,
                          on_ramp: [
                            172, 151, 41, 119, 225, 186, 181, 255, 246, 198, 134, 41, 31, 153, 79,
                            245, 47, 52, 171, 237, 27, 199, 223, 136, 247, 111, 67, 249, 38, 89, 44,
                            143,
                          ],
                        },
                      },
                    },
                  },
                  {
                    fields: {
                      key: '9763904284804119144',
                      value: {
                        fields: {
                          router:
                            '0x5ef4b483da6644c84aa78eae4f51a9bfb1fb4554d5134ac98892e931fcbdd6bf',
                          is_enabled: true,
                          min_seq_nr: '2',
                          is_rmn_verification_disabled: true,
                          on_ramp: [
                            40, 150, 57, 203, 81, 112, 64, 67, 33, 61, 46, 136, 6, 209, 153, 121,
                            237, 133, 51, 228,
                          ],
                        },
                      },
                    },
                  },
                  {
                    fields: {
                      key: '3967220077692964309',
                      value: {
                        fields: {
                          router:
                            '0x5ef4b483da6644c84aa78eae4f51a9bfb1fb4554d5134ac98892e931fcbdd6bf',
                          is_enabled: true,
                          min_seq_nr: '1',
                          is_rmn_verification_disabled: true,
                          on_ramp: [
                            31, 94, 243, 135, 130, 182, 183, 198, 222, 72, 148, 6, 184, 238, 80, 78,
                            70, 240, 90, 24,
                          ],
                        },
                      },
                    },
                  },
                  {
                    fields: {
                      key: '8457817439310187923',
                      value: {
                        fields: {
                          router:
                            '0x5ef4b483da6644c84aa78eae4f51a9bfb1fb4554d5134ac98892e931fcbdd6bf',
                          is_enabled: true,
                          min_seq_nr: '1',
                          is_rmn_verification_disabled: true,
                          on_ramp: [
                            213, 3, 0, 90, 151, 119, 26, 204, 36, 131, 58, 134, 139, 45, 55, 19, 11,
                            120, 115, 172,
                          ],
                        },
                      },
                    },
                  },
                  {
                    fields: {
                      key: '7728255861635209484',
                      value: {
                        fields: {
                          router:
                            '0x5ef4b483da6644c84aa78eae4f51a9bfb1fb4554d5134ac98892e931fcbdd6bf',
                          is_enabled: true,
                          min_seq_nr: '2',
                          is_rmn_verification_disabled: true,
                          on_ramp: [
                            8, 185, 77, 38, 175, 32, 28, 103, 50, 48, 85, 10, 112, 112, 148, 102,
                            131, 132, 124, 122,
                          ],
                        },
                      },
                    },
                  },
                ],
              },
            },
            execution_states: {
              fields: {
                id: {
                  id: '0xb382aa24f4eab3d26d17fc55c4648bf78d70990cde24842aef3f6c66da10eeb6',
                },
                size: '13',
              },
            },
            roots: {
              fields: {
                id: {
                  id: '0x9049393bf8feaf7a9e08e7773bcf23e4a7654ddfc9187bf2a8f873f099321c27',
                },
                size: '1651',
              },
            },
            latest_price_sequence_number: '3793095',
            fee_quoter_cap: {
              fields: {
                vec: [
                  {
                    fields: {
                      id: {
                        id: '0xa1118548faabc9a33dff7d966e24d7cee82bae54e0fd318556149c9db977a23c',
                      },
                    },
                  },
                ],
              },
            },
            dest_transfer_cap: {
              fields: {
                vec: [
                  {
                    fields: {
                      id: {
                        id: '0x05c6f7de83af6095a4036a71cebfeb2d4fdddfcbb689304a3bf2e81c64852e2c',
                      },
                    },
                  },
                ],
              },
            },
            ownable_state: {
              fields: {
                owner: '0x832b7fd3b7f03d2fd55811cd565d675c09d938f2dc8c24dfd5e73bae4ca118df',
                pending_transfer: {
                  fields: {
                    vec: [],
                  },
                },
                owner_cap_id: '0x0090c2a65a768616accbce6496a3fc32d1e1ce99a59033baeb0967439aa1768a',
              },
            },
          },
          hasPublicTransfer: true,
        },
      },
    },
  },
}
