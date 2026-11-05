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
var pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-codec-v2-2.0.0');
var pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b = require('@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-holding-v1-1.0.0');
var pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-api-v2-2.0.0');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@chainlink/ccip-sdk/src/canton/bindings/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 = require('@chainlink/ccip-sdk/src/canton/bindings/chainlink-api-2.0.0');

exports.ICCIPMessageSent = damlTypes.assembleInterface(
  '#ccip-client-api-v2:CCIP.ClientV2:ICCIPMessageSent',
  '#b8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984:CCIP.ClientV2:ICCIPMessageSent',
  function () { return exports.CCIPMessageSentView; },
  {
    Archive: {
      template: function () { return exports.ICCIPMessageSent; },
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
  }
);

exports.IExecutionStateChanged = damlTypes.assembleInterface(
  '#ccip-client-api-v2:CCIP.ClientV2:IExecutionStateChanged',
  '#b8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984:CCIP.ClientV2:IExecutionStateChanged',
  function () { return exports.ExecutionStateChangedView; },
  {
    Archive: {
      template: function () { return exports.IExecutionStateChanged; },
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
  }
);

exports.PerPartyRouter = damlTypes.assembleInterface(
  '#ccip-client-api-v2:CCIP.ClientV2:PerPartyRouter',
  '#b8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984:CCIP.ClientV2:PerPartyRouter',
  function () { return exports.PerPartyRouterView; },
  {
    Archive: {
      template: function () { return exports.PerPartyRouter; },
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
    PerPartyRouter_CCIPSend: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'PerPartyRouter_CCIPSend',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.PerPartyRouter_CCIPSend.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.PerPartyRouter_CCIPSend.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.CCIPSendResult.decoder;
      }),
      resultEncode: function (__typed__) { return exports.CCIPSendResult.encode(__typed__); },
    },
    PerPartyRouter_Execute: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'PerPartyRouter_Execute',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.PerPartyRouter_Execute.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.PerPartyRouter_Execute.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.ExecuteResult.decoder;
      }),
      resultEncode: function (__typed__) { return exports.ExecuteResult.encode(__typed__); },
    },
    PerPartyRouter_FinalizeFee: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'PerPartyRouter_FinalizeFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.PerPartyRouter_FinalizeFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.PerPartyRouter_FinalizeFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).encode(__typed__); },
    },
    PerPartyRouter_GetExecutionState: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'PerPartyRouter_GetExecutionState',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.PerPartyRouter_GetExecutionState.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.PerPartyRouter_GetExecutionState.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.MessageExecutionState.decoder;
      }),
      resultEncode: function (__typed__) { return pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.MessageExecutionState.encode(__typed__); },
    },
    PerPartyRouter_GetFee: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'PerPartyRouter_GetFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.PerPartyRouter_GetFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.PerPartyRouter_GetFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.GetFeeResult.decoder;
      }),
      resultEncode: function (__typed__) { return exports.GetFeeResult.encode(__typed__); },
    },
    PerPartyRouter_GetRequiredCCVsForExecute: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'PerPartyRouter_GetRequiredCCVsForExecute',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.PerPartyRouter_GetRequiredCCVsForExecute.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.PerPartyRouter_GetRequiredCCVsForExecute.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__); },
    },
    PerPartyRouter_GetRequiredCCVsForSend: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'PerPartyRouter_GetRequiredCCVsForSend',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.PerPartyRouter_GetRequiredCCVsForSend.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.PerPartyRouter_GetRequiredCCVsForSend.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__); },
    },
    PerPartyRouter_GetSequenceNumber: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'PerPartyRouter_GetSequenceNumber',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.PerPartyRouter_GetSequenceNumber.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.PerPartyRouter_GetSequenceNumber.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.Numeric(0).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.Numeric(0).encode(__typed__); },
    },
    PerPartyRouter_PrepareExecute: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'PerPartyRouter_PrepareExecute',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.PerPartyRouter_PrepareExecute.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.PerPartyRouter_PrepareExecute.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage).encode(__typed__); },
    },
    PerPartyRouter_PrepareSend: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'PerPartyRouter_PrepareSend',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.PerPartyRouter_PrepareSend.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.PerPartyRouter_PrepareSend.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).encode(__typed__); },
    },
  }
);

exports.CCIPMessageSentView = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccipOwner: damlTypes.Party.decoder,
      messageId: damlTypes.Text.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
      messageId: damlTypes.Text.encode(__typed__.messageId),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.CCIPSendResult = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      router: damlTypes.ContractId(exports.PerPartyRouter).decoder,
      ccipMessageSent: damlTypes.ContractId(exports.ICCIPMessageSent).decoder,
      messageId: damlTypes.Text.decoder,
      feeChangeCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).decoder,
      pendingFeeInstructions: damlTypes.List(damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction)).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      router: damlTypes.ContractId(exports.PerPartyRouter).encode(__typed__.router),
      ccipMessageSent: damlTypes.ContractId(exports.ICCIPMessageSent).encode(__typed__.ccipMessageSent),
      messageId: damlTypes.Text.encode(__typed__.messageId),
      feeChangeCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).encode(__typed__.feeChangeCids),
      pendingFeeInstructions: damlTypes.List(damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction)).encode(__typed__.pendingFeeInstructions),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.CCVExtraArg = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccvAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      ccvArgs: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccvAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.ccvAddress),
      ccvArgs: damlTypes.Text.encode(__typed__.ccvArgs),
    };
  },
};

exports.Canton2AnyMessage = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      receiver: damlTypes.Text.decoder,
      payload: damlTypes.Text.decoder,
      tokenTransfer: jtv.Decoder.withDefault(null, damlTypes.Optional(exports.TokenTransfer).decoder),
      feeToken: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      extraArgs: exports.ExtraArgs.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      receiver: damlTypes.Text.encode(__typed__.receiver),
      payload: damlTypes.Text.encode(__typed__.payload),
      tokenTransfer: damlTypes.Optional(exports.TokenTransfer).encode(__typed__.tokenTransfer),
      feeToken: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.feeToken),
      extraArgs: exports.ExtraArgs.encode(__typed__.extraArgs),
    };
  },
};

exports.ExecuteResult = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      router: damlTypes.ContractId(exports.PerPartyRouter).decoder,
      tokenReceiveTicket: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.ITokenReceiveTicket)).decoder),
      executionStateChanged: damlTypes.ContractId(exports.IExecutionStateChanged).decoder,
      messageId: damlTypes.Text.decoder,
      message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1.decoder,
      state: pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.MessageExecutionState.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      router: damlTypes.ContractId(exports.PerPartyRouter).encode(__typed__.router),
      tokenReceiveTicket: damlTypes.Optional(damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.ITokenReceiveTicket)).encode(__typed__.tokenReceiveTicket),
      executionStateChanged: damlTypes.ContractId(exports.IExecutionStateChanged).encode(__typed__.executionStateChanged),
      messageId: damlTypes.Text.encode(__typed__.messageId),
      message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1.encode(__typed__.message),
      state: pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.MessageExecutionState.encode(__typed__.state),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.ExecutionStateChangedView = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccipOwner: damlTypes.Party.decoder,
      messageId: damlTypes.Text.decoder,
      state: pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.MessageExecutionState.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
      messageId: damlTypes.Text.encode(__typed__.messageId),
      state: pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.MessageExecutionState.encode(__typed__.state),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.ExecutorExtraArg = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.oneOf(
      jtv.object({
        tag: jtv.constant("Executor_NoExecutor"),
        value: damlTypes.Unit.decoder,
      }),
      jtv.object({
        tag: jtv.constant("Executor_UseDefault"),
        value: exports.ExecutorExtraArg.Executor_UseDefault.decoder,
      }),
      jtv.object({
        tag: jtv.constant("Executor_WithAddress"),
        value: exports.ExecutorExtraArg.Executor_WithAddress.decoder,
      }),
    );
  }),
  encode: function (__typed__) {
    switch(__typed__.tag) {
      case 'Executor_NoExecutor': return {tag: __typed__.tag, value: damlTypes.Unit.encode(__typed__.value)};
      case 'Executor_UseDefault': return {tag: __typed__.tag, value: exports.ExecutorExtraArg.Executor_UseDefault.encode(__typed__.value)};
      case 'Executor_WithAddress': return {tag: __typed__.tag, value: exports.ExecutorExtraArg.Executor_WithAddress.encode(__typed__.value)};
      default: throw 'unrecognized type tag: ' + __typed__.tag + ' while serializing a value of type ExecutorExtraArg';
    }
  },
  Executor_UseDefault: {
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        executorArgs: damlTypes.Text.decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        executorArgs: damlTypes.Text.encode(__typed__.executorArgs),
      };
    },
  },
  Executor_WithAddress: {
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        executorAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
        executorArgs: damlTypes.Text.decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        executorAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.executorAddress),
        executorArgs: damlTypes.Text.encode(__typed__.executorArgs),
      };
    },
  },
};

exports.ExtraArgs = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.oneOf(
      jtv.object({
        tag: jtv.constant("V3"),
        value: exports.GenericExtraArgsV3.decoder,
      }),
    );
  }),
  encode: function (__typed__) {
    switch(__typed__.tag) {
      case 'V3': return {tag: __typed__.tag, value: exports.GenericExtraArgsV3.encode(__typed__.value)};
      default: throw 'unrecognized type tag: ' + __typed__.tag + ' while serializing a value of type ExtraArgs';
    }
  },
};

exports.GenericExtraArgsV3 = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      gasLimit: damlTypes.Int.decoder,
      ccvs: damlTypes.List(exports.CCVExtraArg).decoder,
      executor: exports.ExecutorExtraArg.decoder,
      tokenReceiver: damlTypes.Text.decoder,
      tokenArgs: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      gasLimit: damlTypes.Int.encode(__typed__.gasLimit),
      ccvs: damlTypes.List(exports.CCVExtraArg).encode(__typed__.ccvs),
      executor: exports.ExecutorExtraArg.encode(__typed__.executor),
      tokenReceiver: damlTypes.Text.encode(__typed__.tokenReceiver),
      tokenArgs: damlTypes.Text.encode(__typed__.tokenArgs),
    };
  },
};

exports.GetFeeResult = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      feeTokenAmount: damlTypes.Numeric(0).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      feeTokenAmount: damlTypes.Numeric(0).encode(__typed__.feeTokenAmount),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.PerPartyRouterView = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccipOwner: damlTypes.Party.decoder,
      owner: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
      owner: damlTypes.Party.encode(__typed__.owner),
    };
  },
};

exports.PerPartyRouter_CCIPSend = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      sendingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).decoder,
      feeTokenHoldingCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).decoder,
      feeTokenConfigCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig).decoder,
      feeTokenTransferFactory: damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory).decoder,
      feeTokenExtraArgs: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ExtraArgs.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      sendingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).encode(__typed__.sendingMessageCid),
      feeTokenHoldingCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).encode(__typed__.feeTokenHoldingCids),
      feeTokenConfigCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig).encode(__typed__.feeTokenConfigCid),
      feeTokenTransferFactory: damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory).encode(__typed__.feeTokenTransferFactory),
      feeTokenExtraArgs: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ExtraArgs.encode(__typed__.feeTokenExtraArgs),
    };
  },
};

exports.PerPartyRouter_Execute = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      executingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      executingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage).encode(__typed__.executingMessageCid),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.PerPartyRouter_FinalizeFee = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      sendingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      sendingMessageCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).encode(__typed__.sendingMessageCid),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.PerPartyRouter_GetExecutionState = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      messageHash: damlTypes.Text.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      messageHash: damlTypes.Text.encode(__typed__.messageHash),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.PerPartyRouter_GetFee = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destChainSelector: damlTypes.Numeric(0).decoder,
      message: exports.Canton2AnyMessage.decoder,
      ccvFeeQuotes: damlTypes.List(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.CrossChainVerifier.CrossChainVerifierFeeQuote).decoder,
      tokenPoolFeeQuote: jtv.Decoder.withDefault(null, damlTypes.Optional(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.TokenPoolFeeQuote).decoder),
      executorFeeQuote: jtv.Decoder.withDefault(null, damlTypes.Optional(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.Executor.ExecutorFeeQuote).decoder),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      message: exports.Canton2AnyMessage.encode(__typed__.message),
      ccvFeeQuotes: damlTypes.List(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.CrossChainVerifier.CrossChainVerifierFeeQuote).encode(__typed__.ccvFeeQuotes),
      tokenPoolFeeQuote: damlTypes.Optional(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.TokenPoolFeeQuote).encode(__typed__.tokenPoolFeeQuote),
      executorFeeQuote: damlTypes.Optional(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.Executor.ExecutorFeeQuote).encode(__typed__.executorFeeQuote),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.PerPartyRouter_GetRequiredCCVsForExecute = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1.decoder,
      receiverRequiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      receiverOptionalCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      receiverOptionalThreshold: damlTypes.Int.decoder,
      tokenPoolRequiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1.encode(__typed__.message),
      receiverRequiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.receiverRequiredCCVs),
      receiverOptionalCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.receiverOptionalCCVs),
      receiverOptionalThreshold: damlTypes.Int.encode(__typed__.receiverOptionalThreshold),
      tokenPoolRequiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.tokenPoolRequiredCCVs),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.PerPartyRouter_GetRequiredCCVsForSend = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destChainSelector: damlTypes.Numeric(0).decoder,
      message: exports.Canton2AnyMessage.decoder,
      poolReportedCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      message: exports.Canton2AnyMessage.encode(__typed__.message),
      poolReportedCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.poolReportedCCVs),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.PerPartyRouter_GetSequenceNumber = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destChainSelector: damlTypes.Numeric(0).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.PerPartyRouter_PrepareExecute = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      encodedMessage: damlTypes.Text.decoder,
      receiverParty: damlTypes.Party.decoder,
      tokenReceiverParty: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.Party).decoder),
      receiverRequiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      receiverOptionalCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      receiverOptionalThreshold: damlTypes.Int.decoder,
      receiverFinalityConfig: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      encodedMessage: damlTypes.Text.encode(__typed__.encodedMessage),
      receiverParty: damlTypes.Party.encode(__typed__.receiverParty),
      tokenReceiverParty: damlTypes.Optional(damlTypes.Party).encode(__typed__.tokenReceiverParty),
      receiverRequiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.receiverRequiredCCVs),
      receiverOptionalCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.receiverOptionalCCVs),
      receiverOptionalThreshold: damlTypes.Int.encode(__typed__.receiverOptionalThreshold),
      receiverFinalityConfig: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig.encode(__typed__.receiverFinalityConfig),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.PerPartyRouter_PrepareSend = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destinationChainSelector: damlTypes.Numeric(0).decoder,
      message: exports.Canton2AnyMessage.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destinationChainSelector: damlTypes.Numeric(0).encode(__typed__.destinationChainSelector),
      message: exports.Canton2AnyMessage.encode(__typed__.message),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.TokenTransfer = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      token: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      amount: damlTypes.Numeric(10).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      token: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.token),
      amount: damlTypes.Numeric(10).encode(__typed__.amount),
    };
  },
};
