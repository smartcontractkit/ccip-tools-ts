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

exports.ICrossChainVerifier = damlTypes.assembleInterface(
  '#ccip-extension-api-v2:CCIP.InterfacesV2.CrossChainVerifier:ICrossChainVerifier',
  '#289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4:CCIP.InterfacesV2.CrossChainVerifier:ICrossChainVerifier',
  function () { return exports.CrossChainVerifierView; },
  {
    Archive: {
      template: function () { return exports.ICrossChainVerifier; },
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
    CrossChainVerifier_CalculateFee: {
      template: function () { return exports.ICrossChainVerifier; },
      choiceName: 'CrossChainVerifier_CalculateFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.CrossChainVerifier_CalculateFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.CrossChainVerifier_CalculateFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).encode(__typed__); },
    },
    CrossChainVerifier_ForwardToVerifier: {
      template: function () { return exports.ICrossChainVerifier; },
      choiceName: 'CrossChainVerifier_ForwardToVerifier',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.CrossChainVerifier_ForwardToVerifier.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.CrossChainVerifier_ForwardToVerifier.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).encode(__typed__); },
    },
    CrossChainVerifier_GetFee: {
      template: function () { return exports.ICrossChainVerifier; },
      choiceName: 'CrossChainVerifier_GetFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.CrossChainVerifier_GetFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.CrossChainVerifier_GetFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.CrossChainVerifierFeeQuote.decoder;
      }),
      resultEncode: function (__typed__) { return exports.CrossChainVerifierFeeQuote.encode(__typed__); },
    },
    CrossChainVerifier_VerifyMessage: {
      template: function () { return exports.ICrossChainVerifier; },
      choiceName: 'CrossChainVerifier_VerifyMessage',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.CrossChainVerifier_VerifyMessage.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.CrossChainVerifier_VerifyMessage.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage).encode(__typed__); },
    },
  }
);

exports.CrossChainVerifierFeeQuote = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccvInstanceId: damlTypes.Text.decoder,
      ccvOwner: damlTypes.Party.decoder,
      feeUSDCents: damlTypes.Numeric(0).decoder,
      gasForVerification: damlTypes.Int.decoder,
      payloadSizeBytes: damlTypes.Int.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccvInstanceId: damlTypes.Text.encode(__typed__.ccvInstanceId),
      ccvOwner: damlTypes.Party.encode(__typed__.ccvOwner),
      feeUSDCents: damlTypes.Numeric(0).encode(__typed__.feeUSDCents),
      gasForVerification: damlTypes.Int.encode(__typed__.gasForVerification),
      payloadSizeBytes: damlTypes.Int.encode(__typed__.payloadSizeBytes),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.CrossChainVerifierView = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      instanceId: damlTypes.Text.decoder,
      owner: damlTypes.Party.decoder,
      ccipOwner: damlTypes.Party.decoder,
      storageLocations: damlTypes.List(damlTypes.Text).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      instanceId: damlTypes.Text.encode(__typed__.instanceId),
      owner: damlTypes.Party.encode(__typed__.owner),
      ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
      storageLocations: damlTypes.List(damlTypes.Text).encode(__typed__.storageLocations),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.CrossChainVerifier_CalculateFee = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      sendingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      sendingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).encode(__typed__.sendingMessageCid),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.CrossChainVerifier_ForwardToVerifier = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      rmnRemoteCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.RMNRemote.IRMNRemote).decoder,
      sendingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).decoder,
      verifierArgs: damlTypes.Text.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      rmnRemoteCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.RMNRemote.IRMNRemote).encode(__typed__.rmnRemoteCid),
      sendingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).encode(__typed__.sendingMessageCid),
      verifierArgs: damlTypes.Text.encode(__typed__.verifierArgs),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.CrossChainVerifier_GetFee = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destChainSelector: damlTypes.Numeric(0).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.CrossChainVerifier_VerifyMessage = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      rmnRemoteCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.RMNRemote.IRMNRemote).decoder,
      executingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage).decoder,
      verifierResults: damlTypes.Text.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      rmnRemoteCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.RMNRemote.IRMNRemote).encode(__typed__.rmnRemoteCid),
      executingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage).encode(__typed__.executingMessageCid),
      verifierResults: damlTypes.Text.encode(__typed__.verifierResults),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};
