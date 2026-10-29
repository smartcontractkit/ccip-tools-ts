"use strict";
/* eslint-disable-next-line no-unused-vars */
function __export(m) {
/* eslint-disable-next-line no-prototype-builtins */
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
Object.defineProperty(exports, "__esModule", { value: true });

/* eslint-disable-next-line no-unused-vars */
var jtv = require('@mojotech/json-type-validation');
/* eslint-disable-next-line no-unused-vars */
var damlTypes = require('@daml/types');

var pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4 = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-extension-api-v2-2.0.0');
var pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f = require('@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-metadata-v1-1.0.0');
var pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240 = require('@chainlink/ccip-sdk/src/canton/bindings/mcms-api-1.0.0');
var pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b = require('@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-holding-v1-1.0.0');
var pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39 = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-core-v2-2.1.1');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@chainlink/ccip-sdk/src/canton/bindings/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984 = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-client-api-v2-2.0.0');
var pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 = require('@chainlink/ccip-sdk/src/canton/bindings/chainlink-api-2.0.0');
var pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-events-v2-2.0.0');

var CCIP_RuntimeV2_OnRampTypes = require('../../../CCIP/RuntimeV2/OnRampTypes/module');

exports.CCIPSendFromRouter = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      routerPartyOwner: damlTypes.Party.decoder,
      routerInstanceId: damlTypes.Text.decoder,
      currentSequenceNumber: damlTypes.Numeric(0).decoder,
      rmnRemoteCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.RMNRemote.RMNRemote).decoder,
      globalConfigCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig).decoder,
      tokenAdminRegistryCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.TokenAdminRegistry.TokenAdminRegistry).decoder,
      tokenConfigCid: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.TokenAdminRegistry.TokenConfig)).decoder),
      sendingMessageCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      routerPartyOwner: damlTypes.Party.encode(__typed__.routerPartyOwner),
      routerInstanceId: damlTypes.Text.encode(__typed__.routerInstanceId),
      currentSequenceNumber: damlTypes.Numeric(0).encode(__typed__.currentSequenceNumber),
      rmnRemoteCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.RMNRemote.RMNRemote).encode(__typed__.rmnRemoteCid),
      globalConfigCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig).encode(__typed__.globalConfigCid),
      tokenAdminRegistryCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.TokenAdminRegistry.TokenAdminRegistry).encode(__typed__.tokenAdminRegistryCid),
      tokenConfigCid: damlTypes.Optional(damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.TokenAdminRegistry.TokenConfig)).encode(__typed__.tokenConfigCid),
      sendingMessageCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage).encode(__typed__.sendingMessageCid),
    };
  },
};

exports.CCIPSendFromRouterResult = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccipMessageSent: damlTypes.ContractId(pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Events.CCIPMessageSent).decoder,
      verifierBlobs: damlTypes.List(damlTypes.Text).decoder,
      messageSentObservers: damlTypes.List(damlTypes.Party).decoder,
      receipts: damlTypes.List(pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Receipts.Receipt).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccipMessageSent: damlTypes.ContractId(pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Events.CCIPMessageSent).encode(__typed__.ccipMessageSent),
      verifierBlobs: damlTypes.List(damlTypes.Text).encode(__typed__.verifierBlobs),
      messageSentObservers: damlTypes.List(damlTypes.Party).encode(__typed__.messageSentObservers),
      receipts: damlTypes.List(pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Receipts.Receipt).encode(__typed__.receipts),
    };
  },
};

exports.FeeCalculationInputs = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      feeToken: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      payload: damlTypes.Text.decoder,
      executorArgs: damlTypes.Text.decoder,
      hasTokenTransfer: damlTypes.Bool.decoder,
      ccipReceiveGasLimit: damlTypes.Int.decoder,
      ccvFeeUSDCents: damlTypes.Numeric(0).decoder,
      ccvGasSum: damlTypes.Int.decoder,
      ccvBytesSum: damlTypes.Int.decoder,
      poolFeeUSDCents: damlTypes.Numeric(0).decoder,
      poolGas: damlTypes.Int.decoder,
      poolBytes: damlTypes.Int.decoder,
      executorFeeUSDCents: damlTypes.Numeric(0).decoder,
      hasExecutorFee: damlTypes.Bool.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      feeToken: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.feeToken),
      payload: damlTypes.Text.encode(__typed__.payload),
      executorArgs: damlTypes.Text.encode(__typed__.executorArgs),
      hasTokenTransfer: damlTypes.Bool.encode(__typed__.hasTokenTransfer),
      ccipReceiveGasLimit: damlTypes.Int.encode(__typed__.ccipReceiveGasLimit),
      ccvFeeUSDCents: damlTypes.Numeric(0).encode(__typed__.ccvFeeUSDCents),
      ccvGasSum: damlTypes.Int.encode(__typed__.ccvGasSum),
      ccvBytesSum: damlTypes.Int.encode(__typed__.ccvBytesSum),
      poolFeeUSDCents: damlTypes.Numeric(0).encode(__typed__.poolFeeUSDCents),
      poolGas: damlTypes.Int.encode(__typed__.poolGas),
      poolBytes: damlTypes.Int.encode(__typed__.poolBytes),
      executorFeeUSDCents: damlTypes.Numeric(0).encode(__typed__.executorFeeUSDCents),
      hasExecutorFee: damlTypes.Bool.encode(__typed__.hasExecutorFee),
    };
  },
};

exports.FeeCalculationResult = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      totalFeeTokenAmount: damlTypes.Numeric(0).decoder,
      totalUSDCents: damlTypes.Numeric(0).decoder,
      executionCostUSDCents: damlTypes.Numeric(0).decoder,
      executorDestGasLimit: damlTypes.Int.decoder,
      executorDestBytesOverhead: damlTypes.Int.decoder,
      totalExecutionGasLimit: damlTypes.Int.decoder,
      premiumMultiplier: damlTypes.Numeric(10).decoder,
      feeTokenPrice: damlTypes.Numeric(10).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      totalFeeTokenAmount: damlTypes.Numeric(0).encode(__typed__.totalFeeTokenAmount),
      totalUSDCents: damlTypes.Numeric(0).encode(__typed__.totalUSDCents),
      executionCostUSDCents: damlTypes.Numeric(0).encode(__typed__.executionCostUSDCents),
      executorDestGasLimit: damlTypes.Int.encode(__typed__.executorDestGasLimit),
      executorDestBytesOverhead: damlTypes.Int.encode(__typed__.executorDestBytesOverhead),
      totalExecutionGasLimit: damlTypes.Int.encode(__typed__.totalExecutionGasLimit),
      premiumMultiplier: damlTypes.Numeric(10).encode(__typed__.premiumMultiplier),
      feeTokenPrice: damlTypes.Numeric(10).encode(__typed__.feeTokenPrice),
    };
  },
};

exports.FinalizeFeeFromRouter = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      routerPartyOwner: damlTypes.Party.decoder,
      routerInstanceId: damlTypes.Text.decoder,
      globalConfigCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig).decoder,
      feeQuoterCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.FeeQuoter.FeeQuoter).decoder,
      sendingMessageCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      routerPartyOwner: damlTypes.Party.encode(__typed__.routerPartyOwner),
      routerInstanceId: damlTypes.Text.encode(__typed__.routerInstanceId),
      globalConfigCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig).encode(__typed__.globalConfigCid),
      feeQuoterCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.FeeQuoter.FeeQuoter).encode(__typed__.feeQuoterCid),
      sendingMessageCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage).encode(__typed__.sendingMessageCid),
    };
  },
};

exports.GetFeeFromRouter = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      routerPartyOwner: damlTypes.Party.decoder,
      routerInstanceId: damlTypes.Text.decoder,
      globalConfigCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig).decoder,
      feeQuoterCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.FeeQuoter.FeeQuoter).decoder,
      destChainSelector: damlTypes.Numeric(0).decoder,
      message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage.decoder,
      ccvFeeQuotes: damlTypes.List(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.CrossChainVerifier.CrossChainVerifierFeeQuote).decoder,
      tokenPoolFeeQuote: jtv.Decoder.withDefault(null, damlTypes.Optional(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.TokenPoolFeeQuote).decoder),
      executorFeeQuote: jtv.Decoder.withDefault(null, damlTypes.Optional(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.Executor.ExecutorFeeQuote).decoder),
    });
  }),
  encode: function (__typed__) {
    return {
      routerPartyOwner: damlTypes.Party.encode(__typed__.routerPartyOwner),
      routerInstanceId: damlTypes.Text.encode(__typed__.routerInstanceId),
      globalConfigCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig).encode(__typed__.globalConfigCid),
      feeQuoterCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.FeeQuoter.FeeQuoter).encode(__typed__.feeQuoterCid),
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage.encode(__typed__.message),
      ccvFeeQuotes: damlTypes.List(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.CrossChainVerifier.CrossChainVerifierFeeQuote).encode(__typed__.ccvFeeQuotes),
      tokenPoolFeeQuote: damlTypes.Optional(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.TokenPoolFeeQuote).encode(__typed__.tokenPoolFeeQuote),
      executorFeeQuote: damlTypes.Optional(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.Executor.ExecutorFeeQuote).encode(__typed__.executorFeeQuote),
    };
  },
};

exports.GetFeeFromRouterResult = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      feeTokenAmount: damlTypes.Numeric(0).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      feeTokenAmount: damlTypes.Numeric(0).encode(__typed__.feeTokenAmount),
    };
  },
};

exports.GetRequiredCCVsForSendFromRouter = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      globalConfigCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig).decoder,
      destChainSelector: damlTypes.Numeric(0).decoder,
      message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage.decoder,
      poolReportedCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      globalConfigCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig).encode(__typed__.globalConfigCid),
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage.encode(__typed__.message),
      poolReportedCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.poolReportedCCVs),
    };
  },
};

exports.OnRamp = damlTypes.assembleTemplate(
  {
    templateId: '#ccip-runtime-v2:CCIP.RuntimeV2.OnRamp:OnRamp',
    templateIdWithPackageId: '#00ce3527b21ca012761fa58fae105954103a62bc4d72a2018d001b32b79a11a9:CCIP.RuntimeV2.OnRamp:OnRamp',
    keyDecoder: jtv.constant(undefined),
    keyEncode: function () { throw 'EncodeError'; },
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        instanceId: damlTypes.Text.decoder,
        ccipOwner: damlTypes.Party.decoder,
        maxUSDCentsPerMsg: damlTypes.Numeric(0).decoder,
        deps: CCIP_RuntimeV2_OnRampTypes.OnRampDeps.decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        instanceId: damlTypes.Text.encode(__typed__.instanceId),
        ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
        maxUSDCentsPerMsg: damlTypes.Numeric(0).encode(__typed__.maxUSDCentsPerMsg),
        deps: CCIP_RuntimeV2_OnRampTypes.OnRampDeps.encode(__typed__.deps),
      };
    },
    Archive: {
      template: function () { return exports.OnRamp; },
      choiceName: 'Archive',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder;
      }),
      argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.Unit.decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
    },
    CCIPSendFromRouter: {
      template: function () { return exports.OnRamp; },
      choiceName: 'CCIPSendFromRouter',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.CCIPSendFromRouter.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.CCIPSendFromRouter.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.CCIPSendFromRouterResult.decoder;
      }),
      resultEncode: function (__typed__) { return exports.CCIPSendFromRouterResult.encode(__typed__); },
    },
    FinalizeFeeFromRouter: {
      template: function () { return exports.OnRamp; },
      choiceName: 'FinalizeFeeFromRouter',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.FinalizeFeeFromRouter.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.FinalizeFeeFromRouter.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage).encode(__typed__); },
    },
    GetFeeFromRouter: {
      template: function () { return exports.OnRamp; },
      choiceName: 'GetFeeFromRouter',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GetFeeFromRouter.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GetFeeFromRouter.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.GetFeeFromRouterResult.decoder;
      }),
      resultEncode: function (__typed__) { return exports.GetFeeFromRouterResult.encode(__typed__); },
    },
    GetRequiredCCVsForSendFromRouter: {
      template: function () { return exports.OnRamp; },
      choiceName: 'GetRequiredCCVsForSendFromRouter',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GetRequiredCCVsForSendFromRouter.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GetRequiredCCVsForSendFromRouter.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__); },
    },
    PrepareSendFromRouter: {
      template: function () { return exports.OnRamp; },
      choiceName: 'PrepareSendFromRouter',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.PrepareSendFromRouter.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.PrepareSendFromRouter.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage).encode(__typed__); },
    },
    SetDeps: {
      template: function () { return exports.OnRamp; },
      choiceName: 'SetDeps',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.SetDeps.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.SetDeps.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.OnRamp).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.OnRamp).encode(__typed__); },
    },
  },
  pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240.MCMS.MCMSReceiver.MCMSReceiver,
);

// Disable for now - causes logs on the console
// damlTypes.registerTemplate(exports.OnRamp, ['00ce3527b21ca012761fa58fae105954103a62bc4d72a2018d001b32b79a11a9', '#ccip-runtime-v2']);

exports.PrepareSendFromRouter = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destChainSelector: damlTypes.Numeric(0).decoder,
      message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage.decoder,
      routerPartyOwner: damlTypes.Party.decoder,
      routerInstanceId: damlTypes.Text.decoder,
      globalConfigCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig).decoder,
      tokenAdminRegistryCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.TokenAdminRegistry.TokenAdminRegistry).decoder,
      feeQuoterCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.FeeQuoter.FeeQuoter).decoder,
      rmnRemoteCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.RMNRemote.RMNRemote).decoder,
      currentSequenceNumber: damlTypes.Numeric(0).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage.encode(__typed__.message),
      routerPartyOwner: damlTypes.Party.encode(__typed__.routerPartyOwner),
      routerInstanceId: damlTypes.Text.encode(__typed__.routerInstanceId),
      globalConfigCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig).encode(__typed__.globalConfigCid),
      tokenAdminRegistryCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.TokenAdminRegistry.TokenAdminRegistry).encode(__typed__.tokenAdminRegistryCid),
      feeQuoterCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.FeeQuoter.FeeQuoter).encode(__typed__.feeQuoterCid),
      rmnRemoteCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.RMNRemote.RMNRemote).encode(__typed__.rmnRemoteCid),
      currentSequenceNumber: damlTypes.Numeric(0).encode(__typed__.currentSequenceNumber),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.SetDeps = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      newDeps: CCIP_RuntimeV2_OnRampTypes.SetDepsParams.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      newDeps: CCIP_RuntimeV2_OnRampTypes.SetDepsParams.encode(__typed__.newDeps),
    };
  },
};
