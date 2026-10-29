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
var pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281 = require('@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-transfer-instruction-v1-1.0.0');
var pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b = require('@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-holding-v1-1.0.0');
var pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-api-v2-2.0.0');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@chainlink/ccip-sdk/src/canton/bindings/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984 = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-client-api-v2-2.0.0');
var pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 = require('@chainlink/ccip-sdk/src/canton/bindings/chainlink-api-2.0.0');

exports.CCIPSender = damlTypes.assembleTemplate(
  {
    templateId: '#ccip-sender-v2:CCIP.CCIPSender:CCIPSender',
    templateIdWithPackageId: '#7ffa2b979e063523780a09ae70c71166410b177abb98094e448c658869335af3:CCIP.CCIPSender:CCIPSender',
    keyDecoder: jtv.constant(undefined),
    keyEncode: function () { throw 'EncodeError'; },
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        instanceId: damlTypes.Text.decoder,
        owner: damlTypes.Party.decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        instanceId: damlTypes.Text.encode(__typed__.instanceId),
        owner: damlTypes.Party.encode(__typed__.owner),
      };
    },
    Archive: {
      template: function () { return exports.CCIPSender; },
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
    GetFee: {
      template: function () { return exports.CCIPSender; },
      choiceName: 'GetFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GetFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GetFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.GetFeeResult.decoder;
      }),
      resultEncode: function (__typed__) { return exports.GetFeeResult.encode(__typed__); },
    },
    GetRequiredCCVs: {
      template: function () { return exports.CCIPSender; },
      choiceName: 'GetRequiredCCVs',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GetRequiredCCVs.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GetRequiredCCVs.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__); },
    },
    Send: {
      template: function () { return exports.CCIPSender; },
      choiceName: 'Send',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.Send.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.Send.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.CCIPSendResult.decoder;
      }),
      resultEncode: function (__typed__) { return pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.CCIPSendResult.encode(__typed__); },
    },
  },
);

// Disable for now - causes logs on the console
// damlTypes.registerTemplate(exports.CCIPSender, ['7ffa2b979e063523780a09ae70c71166410b177abb98094e448c658869335af3', '#ccip-sender-v2']);

exports.CCVSendInput = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccvAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      ccvCid: damlTypes.ContractId(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.CrossChainVerifier.ICrossChainVerifier).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccvAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.ccvAddress),
      ccvCid: damlTypes.ContractId(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.CrossChainVerifier.ICrossChainVerifier).encode(__typed__.ccvCid),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.ExecutorInput = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      executorCid: damlTypes.ContractId(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.Executor.IExecutor).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      executorCid: damlTypes.ContractId(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.Executor.IExecutor).encode(__typed__.executorCid),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.FeeTokenInput = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      senderInputCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).decoder,
      feeTokenConfigCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig).decoder,
      feeTokenTransferFactory: damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory).decoder,
      feeTokenExtraArgs: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ExtraArgs.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      senderInputCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).encode(__typed__.senderInputCids),
      feeTokenConfigCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig).encode(__typed__.feeTokenConfigCid),
      feeTokenTransferFactory: damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory).encode(__typed__.feeTokenTransferFactory),
      feeTokenExtraArgs: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ExtraArgs.encode(__typed__.feeTokenExtraArgs),
    };
  },
};

exports.GetFee = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destinationChainSelector: damlTypes.Numeric(0).decoder,
      message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage.decoder,
      routerCid: damlTypes.ContractId(pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.PerPartyRouter).decoder,
      ccvSendInputs: damlTypes.List(exports.CCVSendInput).decoder,
      tokenTransferInput: jtv.Decoder.withDefault(null, damlTypes.Optional(exports.TokenTransferInput).decoder),
      executorInput: jtv.Decoder.withDefault(null, damlTypes.Optional(exports.ExecutorInput).decoder),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destinationChainSelector: damlTypes.Numeric(0).encode(__typed__.destinationChainSelector),
      message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage.encode(__typed__.message),
      routerCid: damlTypes.ContractId(pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.PerPartyRouter).encode(__typed__.routerCid),
      ccvSendInputs: damlTypes.List(exports.CCVSendInput).encode(__typed__.ccvSendInputs),
      tokenTransferInput: damlTypes.Optional(exports.TokenTransferInput).encode(__typed__.tokenTransferInput),
      executorInput: damlTypes.Optional(exports.ExecutorInput).encode(__typed__.executorInput),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.GetFeeResult = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      feeTokenAmount: damlTypes.Numeric(10).decoder,
      poolFeeTokenAmount: damlTypes.Numeric(10).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      feeTokenAmount: damlTypes.Numeric(10).encode(__typed__.feeTokenAmount),
      poolFeeTokenAmount: damlTypes.Numeric(10).encode(__typed__.poolFeeTokenAmount),
    };
  },
};

exports.GetRequiredCCVs = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destinationChainSelector: damlTypes.Numeric(0).decoder,
      message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage.decoder,
      routerCid: damlTypes.ContractId(pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.PerPartyRouter).decoder,
      tokenPoolCid: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.ITokenPool)).decoder),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destinationChainSelector: damlTypes.Numeric(0).encode(__typed__.destinationChainSelector),
      message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage.encode(__typed__.message),
      routerCid: damlTypes.ContractId(pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.PerPartyRouter).encode(__typed__.routerCid),
      tokenPoolCid: damlTypes.Optional(damlTypes.ContractId(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.ITokenPool)).encode(__typed__.tokenPoolCid),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.Send = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destinationChainSelector: damlTypes.Numeric(0).decoder,
      message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage.decoder,
      routerCid: damlTypes.ContractId(pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.PerPartyRouter).decoder,
      feeTokenInput: exports.FeeTokenInput.decoder,
      ccvSendInputs: damlTypes.List(exports.CCVSendInput).decoder,
      tokenTransferInput: jtv.Decoder.withDefault(null, damlTypes.Optional(exports.TokenTransferInput).decoder),
      executorInput: jtv.Decoder.withDefault(null, damlTypes.Optional(exports.ExecutorInput).decoder),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destinationChainSelector: damlTypes.Numeric(0).encode(__typed__.destinationChainSelector),
      message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage.encode(__typed__.message),
      routerCid: damlTypes.ContractId(pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.PerPartyRouter).encode(__typed__.routerCid),
      feeTokenInput: exports.FeeTokenInput.encode(__typed__.feeTokenInput),
      ccvSendInputs: damlTypes.List(exports.CCVSendInput).encode(__typed__.ccvSendInputs),
      tokenTransferInput: damlTypes.Optional(exports.TokenTransferInput).encode(__typed__.tokenTransferInput),
      executorInput: damlTypes.Optional(exports.ExecutorInput).encode(__typed__.executorInput),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.TokenTransferInput = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      senderInputCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).decoder,
      tokenPoolCid: damlTypes.ContractId(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.ITokenPool).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      senderInputCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).encode(__typed__.senderInputCids),
      tokenPoolCid: damlTypes.ContractId(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.ITokenPool).encode(__typed__.tokenPoolCid),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};
