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
var pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281 = require('@daml.js/splice-api-token-transfer-instruction-v1-1.0.0');
var pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b = require('@daml.js/splice-api-token-holding-v1-1.0.0');
var pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 = require('@daml.js/ccip-api-v2-2.0.0');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 = require('@daml.js/chainlink-api-2.0.0');

exports.ITokenPool = damlTypes.assembleInterface(
  '#ccip-extension-api-v2:CCIP.InterfacesV2.TokenPool:ITokenPool',
  '#289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4:CCIP.InterfacesV2.TokenPool:ITokenPool',
  function () { return exports.TokenPoolView; },
  {
    Archive: {
      template: function () { return exports.ITokenPool; },
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
    TokenPool_CalculateFee: {
      template: function () { return exports.ITokenPool; },
      choiceName: 'TokenPool_CalculateFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenPool_CalculateFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenPool_CalculateFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).encode(__typed__); },
    },
    TokenPool_GetFee: {
      template: function () { return exports.ITokenPool; },
      choiceName: 'TokenPool_GetFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenPool_GetFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenPool_GetFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenPoolFeeQuote.decoder;
      }),
      resultEncode: function (__typed__) { return exports.TokenPoolFeeQuote.encode(__typed__); },
    },
    TokenPool_GetRequiredCCVs: {
      template: function () { return exports.ITokenPool; },
      choiceName: 'TokenPool_GetRequiredCCVs',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenPool_GetRequiredCCVs.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenPool_GetRequiredCCVs.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__); },
    },
    TokenPool_LockOrBurn: {
      template: function () { return exports.ITokenPool; },
      choiceName: 'TokenPool_LockOrBurn',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenPool_LockOrBurn.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenPool_LockOrBurn.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.LockOrBurnResult.decoder;
      }),
      resultEncode: function (__typed__) { return exports.LockOrBurnResult.encode(__typed__); },
    },
    TokenPool_ReleaseFromTicket: {
      template: function () { return exports.ITokenPool; },
      choiceName: 'TokenPool_ReleaseFromTicket',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenPool_ReleaseFromTicket.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenPool_ReleaseFromTicket.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.ReleaseOrMintResult.decoder;
      }),
      resultEncode: function (__typed__) { return exports.ReleaseOrMintResult.encode(__typed__); },
    },
    TokenPool_VerifyInboundMessage: {
      template: function () { return exports.ITokenPool; },
      choiceName: 'TokenPool_VerifyInboundMessage',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenPool_VerifyInboundMessage.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenPool_VerifyInboundMessage.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage).encode(__typed__); },
    },
    TokenPool_VerifyOutboundCCVs: {
      template: function () { return exports.ITokenPool; },
      choiceName: 'TokenPool_VerifyOutboundCCVs',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenPool_VerifyOutboundCCVs.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenPool_VerifyOutboundCCVs.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).encode(__typed__); },
    },
  }
);

exports.LockOrBurnResult = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      poolChangeCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).decoder,
      senderChangeCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).decoder,
      sendingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      poolChangeCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).encode(__typed__.poolChangeCids),
      senderChangeCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).encode(__typed__.senderChangeCids),
      sendingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).encode(__typed__.sendingMessageCid),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.ReleaseOrMintResult = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      output: exports.ReleaseOrMintResult_Output.decoder,
      poolChangeCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).decoder,
      claimedEventCid: damlTypes.ContractId(damlTypes.Unit).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      output: exports.ReleaseOrMintResult_Output.encode(__typed__.output),
      poolChangeCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).encode(__typed__.poolChangeCids),
      claimedEventCid: damlTypes.ContractId(damlTypes.Unit).encode(__typed__.claimedEventCid),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.ReleaseOrMintResult_Output = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.oneOf(
      jtv.object({
        tag: jtv.constant("ReleaseOrMintResult_Pending"),
        value: exports.ReleaseOrMintResult_Output.ReleaseOrMintResult_Pending.decoder,
      }),
      jtv.object({
        tag: jtv.constant("ReleaseOrMintResult_Completed"),
        value: exports.ReleaseOrMintResult_Output.ReleaseOrMintResult_Completed.decoder,
      }),
    );
  }),
  encode: function (__typed__) {
    switch(__typed__.tag) {
      case 'ReleaseOrMintResult_Pending': return {tag: __typed__.tag, value: exports.ReleaseOrMintResult_Output.ReleaseOrMintResult_Pending.encode(__typed__.value)};
      case 'ReleaseOrMintResult_Completed': return {tag: __typed__.tag, value: exports.ReleaseOrMintResult_Output.ReleaseOrMintResult_Completed.encode(__typed__.value)};
      default: throw 'unrecognized type tag: ' + __typed__.tag + ' while serializing a value of type ReleaseOrMintResult_Output';
    }
  },
  ReleaseOrMintResult_Completed: {
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        receiverHoldingCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        receiverHoldingCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).encode(__typed__.receiverHoldingCids),
      };
    },
  },
  ReleaseOrMintResult_Pending: {
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        transferInstructionCid: damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction).decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        transferInstructionCid: damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction).encode(__typed__.transferInstructionCid),
      };
    },
  },
};

exports.TokenPoolFeeQuote = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      poolInstanceId: damlTypes.Text.decoder,
      poolOwner: damlTypes.Party.decoder,
      feeUSDCents: damlTypes.Numeric(0).decoder,
      destGasOverhead: damlTypes.Int.decoder,
      destBytesOverhead: damlTypes.Int.decoder,
      tokenFeeBps: damlTypes.Numeric(0).decoder,
      isEnabled: damlTypes.Bool.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      poolInstanceId: damlTypes.Text.encode(__typed__.poolInstanceId),
      poolOwner: damlTypes.Party.encode(__typed__.poolOwner),
      feeUSDCents: damlTypes.Numeric(0).encode(__typed__.feeUSDCents),
      destGasOverhead: damlTypes.Int.encode(__typed__.destGasOverhead),
      destBytesOverhead: damlTypes.Int.encode(__typed__.destBytesOverhead),
      tokenFeeBps: damlTypes.Numeric(0).encode(__typed__.tokenFeeBps),
      isEnabled: damlTypes.Bool.encode(__typed__.isEnabled),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.TokenPoolView = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      owner: damlTypes.Party.decoder,
      ccipOwner: damlTypes.Party.decoder,
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      owner: damlTypes.Party.encode(__typed__.owner),
      ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.TokenPool_CalculateFee = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenAdminRegistryCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenAdminRegistry).decoder,
      tokenConfigCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig).decoder,
      sendingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).decoder,
      feeQuoterCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.FeeQuoter.IFeeQuoter).decoder,
      tokenInstrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenAdminRegistryCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenAdminRegistry).encode(__typed__.tokenAdminRegistryCid),
      tokenConfigCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig).encode(__typed__.tokenConfigCid),
      sendingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).encode(__typed__.sendingMessageCid),
      feeQuoterCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.FeeQuoter.IFeeQuoter).encode(__typed__.feeQuoterCid),
      tokenInstrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.tokenInstrumentId),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TokenPool_GetFee = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      feeQuoterCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.FeeQuoter.IFeeQuoter).decoder,
      destChainSelector: damlTypes.Numeric(0).decoder,
      tokenInstrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      feeQuoterCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.FeeQuoter.IFeeQuoter).encode(__typed__.feeQuoterCid),
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      tokenInstrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.tokenInstrumentId),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TokenPool_GetRequiredCCVs = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      remoteChainSelector: damlTypes.Numeric(0).decoder,
      sourceAmount: damlTypes.Text.decoder,
      finality: damlTypes.Text.decoder,
      extraData: damlTypes.Text.decoder,
      direction: exports.TransferDirection.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      remoteChainSelector: damlTypes.Numeric(0).encode(__typed__.remoteChainSelector),
      sourceAmount: damlTypes.Text.encode(__typed__.sourceAmount),
      finality: damlTypes.Text.encode(__typed__.finality),
      extraData: damlTypes.Text.encode(__typed__.extraData),
      direction: exports.TransferDirection.encode(__typed__.direction),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TokenPool_LockOrBurn = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenAdminRegistryCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenAdminRegistry).decoder,
      tokenConfigCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig).decoder,
      rmnRemoteCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.RMNRemote.IRMNRemote).decoder,
      sendingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).decoder,
      senderInputCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).decoder,
      amount: damlTypes.Numeric(10).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenAdminRegistryCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenAdminRegistry).encode(__typed__.tokenAdminRegistryCid),
      tokenConfigCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig).encode(__typed__.tokenConfigCid),
      rmnRemoteCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.RMNRemote.IRMNRemote).encode(__typed__.rmnRemoteCid),
      sendingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).encode(__typed__.sendingMessageCid),
      senderInputCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).encode(__typed__.senderInputCids),
      amount: damlTypes.Numeric(10).encode(__typed__.amount),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TokenPool_ReleaseFromTicket = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenAdminRegistryCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenAdminRegistry).decoder,
      tokenConfigCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig).decoder,
      rmnRemoteCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.RMNRemote.IRMNRemote).decoder,
      tokenReceiveTicketCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.ITokenReceiveTicket).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenAdminRegistryCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenAdminRegistry).encode(__typed__.tokenAdminRegistryCid),
      tokenConfigCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig).encode(__typed__.tokenConfigCid),
      rmnRemoteCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.RMNRemote.IRMNRemote).encode(__typed__.rmnRemoteCid),
      tokenReceiveTicketCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.ITokenReceiveTicket).encode(__typed__.tokenReceiveTicketCid),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TokenPool_VerifyInboundMessage = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenAdminRegistryCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenAdminRegistry).decoder,
      tokenConfigCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig).decoder,
      executingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenAdminRegistryCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenAdminRegistry).encode(__typed__.tokenAdminRegistryCid),
      tokenConfigCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig).encode(__typed__.tokenConfigCid),
      executingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage).encode(__typed__.executingMessageCid),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TokenPool_VerifyOutboundCCVs = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenAdminRegistryCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenAdminRegistry).decoder,
      tokenConfigCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig).decoder,
      sendingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).decoder,
      amount: damlTypes.Numeric(10).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenAdminRegistryCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenAdminRegistry).encode(__typed__.tokenAdminRegistryCid),
      tokenConfigCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig).encode(__typed__.tokenConfigCid),
      sendingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).encode(__typed__.sendingMessageCid),
      amount: damlTypes.Numeric(10).encode(__typed__.amount),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TransferDirection = {
  Outbound: 'Outbound',
  Inbound: 'Inbound',
  keys: ['Outbound', 'Inbound'],
  decoder: damlTypes.lazyMemo(function () {
    return jtv.oneOf(
      jtv.constant(exports.TransferDirection.Outbound),
      jtv.constant(exports.TransferDirection.Inbound),
    );
  }),
  encode: function (__typed__) { return __typed__; },
};
