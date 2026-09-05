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

var pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f = require('@daml.js/splice-api-token-metadata-v1-1.0.0');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 = require('@daml.js/chainlink-api-2.0.0');

exports.ISendingMessage = damlTypes.assembleInterface(
  '#ccip-api-v2:CCIP.APIV2.SendingMessage:ISendingMessage',
  '#7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58:CCIP.APIV2.SendingMessage:ISendingMessage',
  function () { return exports.SendingMessageView; },
  {
    Archive: {
      template: function () { return exports.ISendingMessage; },
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
    SendingMessage_AddCCVFee: {
      template: function () { return exports.ISendingMessage; },
      choiceName: 'SendingMessage_AddCCVFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.SendingMessage_AddCCVFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.SendingMessage_AddCCVFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.ISendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.ISendingMessage).encode(__typed__); },
    },
    SendingMessage_AddExecutorFee: {
      template: function () { return exports.ISendingMessage; },
      choiceName: 'SendingMessage_AddExecutorFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.SendingMessage_AddExecutorFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.SendingMessage_AddExecutorFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.ISendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.ISendingMessage).encode(__typed__); },
    },
    SendingMessage_AddVerifierData: {
      template: function () { return exports.ISendingMessage; },
      choiceName: 'SendingMessage_AddVerifierData',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.SendingMessage_AddVerifierData.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.SendingMessage_AddVerifierData.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.ISendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.ISendingMessage).encode(__typed__); },
    },
    SendingMessage_FeeTokenAmount: {
      template: function () { return exports.ISendingMessage; },
      choiceName: 'SendingMessage_FeeTokenAmount',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.SendingMessage_FeeTokenAmount.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.SendingMessage_FeeTokenAmount.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.Numeric(10).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.Numeric(10).encode(__typed__); },
    },
  }
);

exports.SendingMessageView = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccipOwner: damlTypes.Party.decoder,
      sender: damlTypes.Party.decoder,
      destChainSelector: damlTypes.Numeric(0).decoder,
      requiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      outboundPoolCCVs: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress)).decoder),
      router: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      onRamp: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      globalConfig: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      rmnRemote: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      tokenAdminRegistry: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      feeQuoter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
      sender: damlTypes.Party.encode(__typed__.sender),
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      requiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.requiredCCVs),
      outboundPoolCCVs: damlTypes.Optional(damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress)).encode(__typed__.outboundPoolCCVs),
      router: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.router),
      onRamp: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.onRamp),
      globalConfig: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.globalConfig),
      rmnRemote: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.rmnRemote),
      tokenAdminRegistry: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.tokenAdminRegistry),
      feeQuoter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.feeQuoter),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.SendingMessage_AddCCVFee = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccvInstanceId: damlTypes.Text.decoder,
      feeUSDCents: damlTypes.Numeric(0).decoder,
      destGasLimit: damlTypes.Int.decoder,
      destBytesOverhead: damlTypes.Int.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccvInstanceId: damlTypes.Text.encode(__typed__.ccvInstanceId),
      feeUSDCents: damlTypes.Numeric(0).encode(__typed__.feeUSDCents),
      destGasLimit: damlTypes.Int.encode(__typed__.destGasLimit),
      destBytesOverhead: damlTypes.Int.encode(__typed__.destBytesOverhead),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.SendingMessage_AddExecutorFee = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      executorInstanceId: damlTypes.Text.decoder,
      executorArgs: damlTypes.Text.decoder,
      feeUSDCents: damlTypes.Numeric(0).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      executorInstanceId: damlTypes.Text.encode(__typed__.executorInstanceId),
      executorArgs: damlTypes.Text.encode(__typed__.executorArgs),
      feeUSDCents: damlTypes.Numeric(0).encode(__typed__.feeUSDCents),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.SendingMessage_AddVerifierData = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccvInstanceId: damlTypes.Text.decoder,
      versionTag: damlTypes.Text.decoder,
      verifierBlob: damlTypes.Text.decoder,
      messageSentObservers: damlTypes.List(damlTypes.Party).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccvInstanceId: damlTypes.Text.encode(__typed__.ccvInstanceId),
      versionTag: damlTypes.Text.encode(__typed__.versionTag),
      verifierBlob: damlTypes.Text.encode(__typed__.verifierBlob),
      messageSentObservers: damlTypes.List(damlTypes.Party).encode(__typed__.messageSentObservers),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.SendingMessage_FeeTokenAmount = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};
