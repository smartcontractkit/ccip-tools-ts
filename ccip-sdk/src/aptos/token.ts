import type { Aptos } from '@aptos-labs/ts-sdk'

export async function getTokenInfo(
  provider: Aptos,
  token: string,
): Promise<{ name?: string; symbol: string; decimals: number }> {
  let lastErr: Error | undefined

  // First, try to get info from Fungible Asset metadata resource
  try {
    const resources = await provider.getAccountResources({ accountAddress: token })
    const metadataResource = resources.find((r) => r.type === '0x1::fungible_asset::Metadata')

    if (metadataResource?.data) {
      const metadata = metadataResource.data as {
        name?: string
        symbol?: string
        decimals?: number
      }
      if (metadata.symbol !== undefined && metadata.decimals !== undefined) {
        return {
          name: metadata.name,
          symbol: metadata.symbol,
          decimals: metadata.decimals,
        }
      }
    }
  } catch (err) {
    lastErr = err as Error
  }

  // Try to get info using standard coin functions with type arguments
  try {
    const symbolRes = await provider.view({
      payload: {
        function: '0x1::coin::symbol',
        typeArguments: [token],
      },
    })

    const decimalsRes = await provider.view({
      payload: {
        function: '0x1::coin::decimals',
        typeArguments: [token],
      },
    })

    let name: string | undefined
    try {
      const nameRes = await provider.view({
        payload: {
          function: '0x1::coin::name',
          typeArguments: [token],
        },
      })
      name = nameRes[0] as string
    } catch {
      // name function not available, continue without it
    }

    return {
      name,
      symbol: symbolRes[0] as string,
      decimals: decimalsRes[0] as number,
    }
  } catch (err) {
    lastErr = err as Error
  }

  // Try to get symbol and decimals from token module functions (legacy approach)
  const modules = await provider.getAccountModules({ accountAddress: token })
  const moduleNames = modules
    .map(({ abi }) => abi!.name)
    .filter((name) => name.includes('coin') || name.includes('token'))

  for (const moduleName of moduleNames) {
    try {
      const symbolRes = await provider.view({
        payload: {
          function: `${token}::${moduleName}::symbol`,
        },
      })

      const decimalsRes = await provider.view({
        payload: {
          function: `${token}::${moduleName}::decimals`,
        },
      })

      let name: string | undefined
      try {
        const nameRes = await provider.view({
          payload: {
            function: `${token}::${moduleName}::name`,
          },
        })
        name = nameRes[0] as string
      } catch {
        // name function not available, continue without it
      }

      return {
        name,
        symbol: symbolRes[0] as string,
        decimals: decimalsRes[0] as number,
      }
    } catch (err) {
      lastErr = err as Error
    }
  }

  // Fallback: try common coin module patterns
  const commonPatterns = ['coin', 'token', 'fungible_asset']
  for (const pattern of commonPatterns) {
    try {
      const symbolRes = await provider.view({
        payload: {
          function: `${token}::${pattern}::symbol`,
        },
      })

      const decimalsRes = await provider.view({
        payload: {
          function: `${token}::${pattern}::decimals`,
        },
      })

      let name: string | undefined
      try {
        const nameRes = await provider.view({
          payload: {
            function: `${token}::${pattern}::name`,
          },
        })
        name = nameRes[0] as string
      } catch {
        // name function not available, continue without it
      }

      return {
        name,
        symbol: symbolRes[0] as string,
        decimals: decimalsRes[0] as number,
      }
    } catch (err) {
      lastErr = err as Error
    }
  }

  throw lastErr ?? new Error(`Could not view token info for ${token}`)
}
