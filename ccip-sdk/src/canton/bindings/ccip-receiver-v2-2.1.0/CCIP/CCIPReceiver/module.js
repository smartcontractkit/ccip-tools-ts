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
var pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-codec-v2-2.0.0');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@chainlink/ccip-sdk/src/canton/bindings/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984 = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-client-api-v2-2.0.0');
var pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 = require('@chainlink/ccip-sdk/src/canton/bindings/chainlink-api-2.0.0');

exports.CCIPMessageReceived = damlTypes.assembleTemplate(
  {
    templateId: '#ccip-receiver-v2:CCIP.CCIPReceiver:CCIPMessageReceived',
    templateIdWithPackageId: '#95c3cdc53c172c7202f5b2711ad01d591c84e0aa00cbce4fd0d9ad8f75c11552:CCIP.CCIPReceiver:CCIPMessageReceived',
    keyDecoder: jtv.constant(undefined),
    keyEncode: function () { throw 'EncodeError'; },
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        owner: damlTypes.Party.decoder,
        router: damlTypes.ContractId(pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.PerPartyRouter).decoder,
        messageId: damlTypes.Text.decoder,
        message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1.decoder,
        tokenReleaseResult: jtv.Decoder.withDefault(null, damlTypes.Optional(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.ReleaseOrMintResult).decoder),
      });
    }),
    encode: function (__typed__) {
      return {
        owner: damlTypes.Party.encode(__typed__.owner),
        router: damlTypes.ContractId(pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.PerPartyRouter).encode(__typed__.router),
        messageId: damlTypes.Text.encode(__typed__.messageId),
        message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1.encode(__typed__.message),
        tokenReleaseResult: damlTypes.Optional(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.ReleaseOrMintResult).encode(__typed__.tokenReleaseResult),
      };
    },
    Archive: {
      template: function () { return exports.CCIPMessageReceived; },
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
  },
);

// Disable for now - causes logs on the console
// damlTypes.registerTemplate(exports.CCIPMessageReceived, ['95c3cdc53c172c7202f5b2711ad01d591c84e0aa00cbce4fd0d9ad8f75c11552', '#ccip-receiver-v2']);

exports.CCIPReceiver = damlTypes.assembleTemplate(
  {
    templateId: '#ccip-receiver-v2:CCIP.CCIPReceiver:CCIPReceiver',
    templateIdWithPackageId: '#95c3cdc53c172c7202f5b2711ad01d591c84e0aa00cbce4fd0d9ad8f75c11552:CCIP.CCIPReceiver:CCIPReceiver',
    keyDecoder: jtv.constant(undefined),
    keyEncode: function () { throw 'EncodeError'; },
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        instanceId: damlTypes.Text.decoder,
        owner: damlTypes.Party.decoder,
        requiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
        optionalCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
        optionalThreshold: damlTypes.Int.decoder,
        receiverFinalityConfig: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig.decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        instanceId: damlTypes.Text.encode(__typed__.instanceId),
        owner: damlTypes.Party.encode(__typed__.owner),
        requiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.requiredCCVs),
        optionalCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.optionalCCVs),
        optionalThreshold: damlTypes.Int.encode(__typed__.optionalThreshold),
        receiverFinalityConfig: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig.encode(__typed__.receiverFinalityConfig),
      };
    },
    Archive: {
      template: function () { return exports.CCIPReceiver; },
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
    Execute: {
      template: function () { return exports.CCIPReceiver; },
      choiceName: 'Execute',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.Execute.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.Execute.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.CCIPMessageReceived).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.CCIPMessageReceived).encode(__typed__); },
    },
    GetRequiredCCVs: {
      template: function () { return exports.CCIPReceiver; },
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
    UpdateRequiredCCVs: {
      template: function () { return exports.CCIPReceiver; },
      choiceName: 'UpdateRequiredCCVs',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.UpdateRequiredCCVs.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.UpdateRequiredCCVs.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.CCIPReceiver).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.CCIPReceiver).encode(__typed__); },
    },
  },
);

// Disable for now - causes logs on the console
// damlTypes.registerTemplate(exports.CCIPReceiver, ['95c3cdc53c172c7202f5b2711ad01d591c84e0aa00cbce4fd0d9ad8f75c11552', '#ccip-receiver-v2']);

exports.CCVInput = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccvCid: damlTypes.ContractId(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.CrossChainVerifier.ICrossChainVerifier).decoder,
      verifierResults: damlTypes.Text.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccvCid: damlTypes.ContractId(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.CrossChainVerifier.ICrossChainVerifier).encode(__typed__.ccvCid),
      verifierResults: damlTypes.Text.encode(__typed__.verifierResults),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.Execute = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      routerCid: damlTypes.ContractId(pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.PerPartyRouter).decoder,
      encodedMessage: damlTypes.Text.decoder,
      tokenTransfer: jtv.Decoder.withDefault(null, damlTypes.Optional(exports.TokenTransferInput).decoder),
      ccvInputs: damlTypes.List(exports.CCVInput).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      routerCid: damlTypes.ContractId(pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.PerPartyRouter).encode(__typed__.routerCid),
      encodedMessage: damlTypes.Text.encode(__typed__.encodedMessage),
      tokenTransfer: damlTypes.Optional(exports.TokenTransferInput).encode(__typed__.tokenTransfer),
      ccvInputs: damlTypes.List(exports.CCVInput).encode(__typed__.ccvInputs),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.GetRequiredCCVs = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      routerCid: damlTypes.ContractId(pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.PerPartyRouter).decoder,
      encodedMessage: damlTypes.Text.decoder,
      tokenPoolCid: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.ITokenPool)).decoder),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      routerCid: damlTypes.ContractId(pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.PerPartyRouter).encode(__typed__.routerCid),
      encodedMessage: damlTypes.Text.encode(__typed__.encodedMessage),
      tokenPoolCid: damlTypes.Optional(damlTypes.ContractId(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.ITokenPool)).encode(__typed__.tokenPoolCid),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.TokenTransferInput = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenPoolCid: damlTypes.ContractId(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.ITokenPool).decoder,
      tokenReceiverParty: damlTypes.Party.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenPoolCid: damlTypes.ContractId(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.ITokenPool).encode(__typed__.tokenPoolCid),
      tokenReceiverParty: damlTypes.Party.encode(__typed__.tokenReceiverParty),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.UpdateRequiredCCVs = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      newRequiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      newRequiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.newRequiredCCVs),
    };
  },
};
