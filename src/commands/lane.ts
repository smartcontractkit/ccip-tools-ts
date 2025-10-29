/* eslint-disable @typescript-eslint/no-base-to-string */
import { Contract, ZeroAddress } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import { Format } from './types.ts'
import { formatDuration, prettyLane } from './utils.ts'
import FeeQuoterABI from '../abi/FeeQuoter_1_6.ts'
import RouterABI from '../abi/Router.ts'
import {
  type CCIPVersion,
  bigIntReplacer,
  chainIdFromSelector,
  chainNameFromSelector,
  chainSelectorFromId,
  decodeAddress,
  discoverOffRamp,
  networkInfo,
  toObject,
} from '../lib/index.ts'

export async function showLaneConfigs(
  providers: Providers,
  argv: { source: string; onramp_or_router: string; dest: string; format: Format; page: number },
) {
  const sourceChainId = networkInfo(argv.source).chainId
  const destChainId = networkInfo(argv.dest).chainId
  const source = await providers.forChainId(sourceChainId)
  const [onrampOrRouterType, , onrampOrRouterTnV] = await getTypeAndVersion(
    source,
    argv.onramp_or_router,
  )
  let onramp
  if (onrampOrRouterType === 'Router') {
    const router = new Contract(
      argv.onramp_or_router,
      RouterABI,
      source,
    ) as unknown as TypedContract<typeof RouterABI>
    onramp = (await router.getOnRamp(chainSelectorFromId(destChainId))) as string
  } else if (onrampOrRouterType.endsWith(CCIPContractType.OnRamp)) {
    onramp = argv.onramp_or_router
  } else {
    throw new Error(`Unknown contract type for onramp_or_router: ${onrampOrRouterTnV}`)
  }
  const [lane, onRampContract] = await getOnRampLane(
    source,
    onramp,
    chainSelectorFromId(destChainId),
  )
  switch (argv.format) {
    case Format.log:
      console.log('Lane:', lane)
      break
    case Format.pretty:
      prettyLane(lane)
      break
    case Format.json:
      console.info(JSON.stringify(lane, bigIntReplacer, 2))
      break
  }

  const staticConfig = toObject(await onRampContract.getStaticConfig())
  const dynamicConfig = toObject(await onRampContract.getDynamicConfig())
  let onRampRouter, destChainConfig
  if ('router' in dynamicConfig) {
    onRampRouter = dynamicConfig.router as string
  } else {
    const [sequenceNumber, allowlistEnabled, onRampRouter_] = await (
      onRampContract as CCIPContract<typeof CCIPContractType.OnRamp, typeof CCIPVersion.V1_6>
    ).getDestChainConfig(lane.destChainSelector)
    onRampRouter = onRampRouter_ as string
    destChainConfig = { sequenceNumber, allowlistEnabled, router: onRampRouter }
  }
  if (onRampRouter !== ZeroAddress) {
    const router = new Contract(onRampRouter, RouterABI, source) as unknown as TypedContract<
      typeof RouterABI
    >
    const onRampInRouter = (await router.getOnRamp(lane.destChainSelector)) as string
    if (onRampInRouter !== onramp) {
      console.warn(
        `OnRamp=${onramp} is not registered in Router=${await router.getAddress()} for dest="${chainNameFromSelector(lane.destChainSelector)}"; instead, have=${onRampInRouter}`,
      )
    }
  }
  if (onrampOrRouterType === 'Router' && argv.onramp_or_router !== onRampRouter) {
    console.warn(
      `OnRamp=${onramp} has Router=${onRampRouter} set instead of ${argv.onramp_or_router}`,
    )
  }

  let feeQuoterConfig
  if ('feeQuoter' in dynamicConfig) {
    const feeQuoter = new Contract(
      dynamicConfig.feeQuoter,
      FeeQuoterABI,
      source,
    ) as unknown as TypedContract<typeof FeeQuoterABI>
    feeQuoterConfig = toObject(await feeQuoter.getDestChainConfig(lane.destChainSelector))
  }

  switch (argv.format) {
    case Format.log:
      console.log('OnRamp configs:', {
        staticConfig: staticConfig,
        dynamicConfig: dynamicConfig,
        ...(destChainConfig ? { destChainConfig } : {}),
        ...(feeQuoterConfig ? { feeQuoterConfig } : {}),
      })
      break
    case Format.pretty:
      console.table({
        typeAndVersion: (await getTypeAndVersion(onRampContract))[2],
        ...staticConfig,
        ...dynamicConfig,
        ...(destChainConfig ?? {}),
        ...(feeQuoterConfig
          ? Object.fromEntries(
              Object.entries(feeQuoterConfig).map(([k, v]) => [`feeQuoter.${k}`, v]),
            )
          : {}),
      })
      break
    case Format.json:
      console.log(
        JSON.stringify(
          {
            onRamp: {
              staticConfig: staticConfig,
              dynamicConfig: dynamicConfig,
              ...(destChainConfig ? { destChainConfig } : {}),
              ...(feeQuoterConfig ? { feeQuoterConfig } : {}),
            },
          },
          bigIntReplacer,
          2,
        ),
      )
      break
  }

  const dest = await providers.forChainId(chainIdFromSelector(lane.destChainSelector))
  const offRampContract = await discoverOffRamp(dest, lane, { page: argv.page })
  const offRamp = await offRampContract.getAddress()
  const [offVersion, offTnV] = await validateContractType(dest, offRamp, CCIPContractType.OffRamp)
  console.info('OffRamp:', offRamp, 'is', offTnV)
  if (offVersion !== lane.version) {
    console.warn(`OffRamp=${offRamp} is not v${lane.version}`)
  }

  const offStaticConfig = toObject(await offRampContract.getStaticConfig())
  const offDynamicConfig = toObject(await offRampContract.getDynamicConfig())
  let offRampRouter, sourceChainConfig
  if ('router' in offDynamicConfig) {
    offRampRouter = offDynamicConfig.router as string
  } else {
    sourceChainConfig = toObject(
      await (
        offRampContract as CCIPContract<typeof CCIPContractType.OffRamp, typeof CCIPVersion.V1_6>
      ).getSourceChainConfig(lane.sourceChainSelector),
    )
    offRampRouter = sourceChainConfig.router as string
  }
  if (offRampRouter !== ZeroAddress) {
    const router = new Contract(offRampRouter, RouterABI, dest) as unknown as TypedContract<
      typeof RouterABI
    >
    const offRamps = await router.getOffRamps()
    if (
      !offRamps.some(
        ({ sourceChainSelector, offRamp: addr }) =>
          sourceChainSelector === lane.sourceChainSelector && addr === offRamp,
      )
    ) {
      console.warn(
        `OffRamp=${offRamp} is not registered in Router=${offRampRouter} for source="${chainNameFromSelector(lane.sourceChainSelector)}"; instead, have=${offRamps
          .filter(({ sourceChainSelector }) => sourceChainSelector === lane.sourceChainSelector)
          .map(({ offRamp }) => offRamp)
          .join(', ')}`,
      )
    }
  }

  switch (argv.format) {
    case Format.log:
      console.log('OffRamp configs:', {
        staticConfig: offStaticConfig,
        dynamicConfig: offDynamicConfig,
        ...(sourceChainConfig ? { sourceChainConfig } : {}),
      })
      break
    case Format.pretty:
      console.table({
        typeAndVersion: (await getTypeAndVersion(offRampContract))[2],
        ...offStaticConfig,
        ...{
          ...offDynamicConfig,
          permissionLessExecutionThresholdSeconds: formatDuration(
            Number(offDynamicConfig.permissionLessExecutionThresholdSeconds),
          ),
        },
        ...(sourceChainConfig
          ? {
              ...sourceChainConfig,
              onRamp: decodeAddress(sourceChainConfig.onRamp, networkInfo(sourceChainId).family),
            }
          : {}),
      })
      break
    case Format.json:
      console.log(
        JSON.stringify(
          {
            offRamp: {
              staticConfig: offStaticConfig,
              dynamicConfig: offDynamicConfig,
              ...(sourceChainConfig ? { sourceChainConfig } : {}),
            },
          },
          bigIntReplacer,
          2,
        ),
      )
      break
  }
}
