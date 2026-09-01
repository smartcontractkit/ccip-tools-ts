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
var pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 = require('@daml.js/ccip-api-v2-2.0.0');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 = require('@daml.js/chainlink-api-2.0.0');

exports.IExecutor = damlTypes.assembleInterface(
  '#ccip-extension-api-v2:CCIP.InterfacesV2.Executor:IExecutor',
  '#289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4:CCIP.InterfacesV2.Executor:IExecutor',
  function () { return exports.ExecutorView; },
  {
    Archive: {
      template: function () { return exports.IExecutor; },
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
    Executor_CalculateFee: {
      template: function () { return exports.IExecutor; },
      choiceName: 'Executor_CalculateFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.Executor_CalculateFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.Executor_CalculateFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).encode(__typed__); },
    },
    Executor_GetFee: {
      template: function () { return exports.IExecutor; },
      choiceName: 'Executor_GetFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.Executor_GetFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.Executor_GetFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.ExecutorFeeQuote.decoder;
      }),
      resultEncode: function (__typed__) { return exports.ExecutorFeeQuote.encode(__typed__); },
    },
  }
);

exports.ExecutorFeeQuote = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      executorInstanceId: damlTypes.Text.decoder,
      executorOwner: damlTypes.Party.decoder,
      feeUSDCents: damlTypes.Numeric(0).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      executorInstanceId: damlTypes.Text.encode(__typed__.executorInstanceId),
      executorOwner: damlTypes.Party.encode(__typed__.executorOwner),
      feeUSDCents: damlTypes.Numeric(0).encode(__typed__.feeUSDCents),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.ExecutorView = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      instanceId: damlTypes.Text.decoder,
      owner: damlTypes.Party.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      instanceId: damlTypes.Text.encode(__typed__.instanceId),
      owner: damlTypes.Party.encode(__typed__.owner),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.Executor_CalculateFee = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      expectedExecutor: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      sendingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).decoder,
      executorArgs: damlTypes.Text.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      expectedExecutor: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.expectedExecutor),
      sendingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).encode(__typed__.sendingMessageCid),
      executorArgs: damlTypes.Text.encode(__typed__.executorArgs),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.Executor_GetFee = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      expectedExecutor: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      destChainSelector: damlTypes.Numeric(0).decoder,
      requiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      expectedExecutor: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.expectedExecutor),
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      requiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.requiredCCVs),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};
