export enum CcipVersion {
  V1_0_0 = '1.0.0',
  V1_1_0 = '1.1.0',
  V1_2_0 = '1.2.0',
  V1_5_0_dev = '1.5.0-dev',
  V1_5_0 = '1.5.0',
  V1_6_0_dev = '1.6.0-dev',
  V1_6_0 = '1.6.0',
}

export const ALL_CCIP_VERSIONS = [
  CcipVersion.V1_0_0,
  CcipVersion.V1_1_0,
  CcipVersion.V1_2_0,
  CcipVersion.V1_5_0_dev,
  CcipVersion.V1_5_0,
  CcipVersion.V1_6_0_dev,
  CcipVersion.V1_6_0,
] as const

export const LATEST_CCIP_VERSION = CcipVersion.V1_5_0
