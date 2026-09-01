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
var pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb = require('@daml.js/ccip-codec-v2-2.0.0');
var pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b = require('@daml.js/splice-api-token-holding-v1-1.0.0');
var pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 = require('@daml.js/ccip-api-v2-2.0.0');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 = require('@daml.js/chainlink-api-2.0.0');
var pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f = require('@daml.js/ccip-events-v2-2.0.0');

exports.AddCCVFee = {
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

exports.AddExecutorFee = {
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

exports.AddTokenSend = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      poolInstanceId: damlTypes.Text.decoder,
      poolOwner: damlTypes.Party.decoder,
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      amount: damlTypes.Text.decoder,
      destTokenAddress: damlTypes.Text.decoder,
      extraData: damlTypes.Text.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      poolInstanceId: damlTypes.Text.encode(__typed__.poolInstanceId),
      poolOwner: damlTypes.Party.encode(__typed__.poolOwner),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      amount: damlTypes.Text.encode(__typed__.amount),
      destTokenAddress: damlTypes.Text.encode(__typed__.destTokenAddress),
      extraData: damlTypes.Text.encode(__typed__.extraData),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.AddTokenSendFee = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      poolInstanceId: damlTypes.Text.decoder,
      poolOwner: damlTypes.Party.decoder,
      feeUSDCents: damlTypes.Numeric(0).decoder,
      destGasOverhead: damlTypes.Int.decoder,
      destBytesOverhead: damlTypes.Int.decoder,
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
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.AddVerifierData = {
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

exports.BuildMessage = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.CCVFee = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccvInstanceId: damlTypes.Text.decoder,
      ccvOwner: damlTypes.Party.decoder,
      feeUSDCents: damlTypes.Numeric(0).decoder,
      destGasLimit: damlTypes.Int.decoder,
      destBytesOverhead: damlTypes.Int.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccvInstanceId: damlTypes.Text.encode(__typed__.ccvInstanceId),
      ccvOwner: damlTypes.Party.encode(__typed__.ccvOwner),
      feeUSDCents: damlTypes.Numeric(0).encode(__typed__.feeUSDCents),
      destGasLimit: damlTypes.Int.encode(__typed__.destGasLimit),
      destBytesOverhead: damlTypes.Int.encode(__typed__.destBytesOverhead),
    };
  },
};

exports.ExecutionMode = {
  ExecutionMode_Executor: 'ExecutionMode_Executor',
  ExecutionMode_NoExecutor: 'ExecutionMode_NoExecutor',
  keys: ['ExecutionMode_Executor', 'ExecutionMode_NoExecutor'],
  decoder: damlTypes.lazyMemo(function () {
    return jtv.oneOf(
      jtv.constant(exports.ExecutionMode.ExecutionMode_Executor),
      jtv.constant(exports.ExecutionMode.ExecutionMode_NoExecutor),
    );
  }),
  encode: function (__typed__) { return __typed__; },
};

exports.ExecutorFee = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      executorInstanceId: damlTypes.Text.decoder,
      executorOwner: damlTypes.Party.decoder,
      feeUSDCents: damlTypes.Numeric(0).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      executorInstanceId: damlTypes.Text.encode(__typed__.executorInstanceId),
      executorOwner: damlTypes.Party.encode(__typed__.executorOwner),
      feeUSDCents: damlTypes.Numeric(0).encode(__typed__.feeUSDCents),
    };
  },
};

exports.FeeTokenAmount = {
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

exports.FinalizeFee = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      feeTokenPrice: damlTypes.Numeric(10).decoder,
      premiumMultiplier: damlTypes.Numeric(10).decoder,
      totalExecutionGasLimit: damlTypes.Int.decoder,
      executorDestGasLimit: damlTypes.Int.decoder,
      executorDestBytesOverhead: damlTypes.Int.decoder,
      executionCostUSDCents: damlTypes.Numeric(0).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      feeTokenPrice: damlTypes.Numeric(10).encode(__typed__.feeTokenPrice),
      premiumMultiplier: damlTypes.Numeric(10).encode(__typed__.premiumMultiplier),
      totalExecutionGasLimit: damlTypes.Int.encode(__typed__.totalExecutionGasLimit),
      executorDestGasLimit: damlTypes.Int.encode(__typed__.executorDestGasLimit),
      executorDestBytesOverhead: damlTypes.Int.encode(__typed__.executorDestBytesOverhead),
      executionCostUSDCents: damlTypes.Numeric(0).encode(__typed__.executionCostUSDCents),
    };
  },
};

exports.FinalizeSend = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      messageSender: damlTypes.Party.decoder,
      messageSentObservers: damlTypes.List(damlTypes.Party).decoder,
      verifierBlobs: damlTypes.List(damlTypes.Text).decoder,
      receipts: damlTypes.List(pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Receipts.Receipt).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      messageSender: damlTypes.Party.encode(__typed__.messageSender),
      messageSentObservers: damlTypes.List(damlTypes.Party).encode(__typed__.messageSentObservers),
      verifierBlobs: damlTypes.List(damlTypes.Text).encode(__typed__.verifierBlobs),
      receipts: damlTypes.List(pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Receipts.Receipt).encode(__typed__.receipts),
    };
  },
};

exports.FinalizeSendResult = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccipMessageSent: damlTypes.ContractId(pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Events.CCIPMessageSent).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccipMessageSent: damlTypes.ContractId(pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Events.CCIPMessageSent).encode(__typed__.ccipMessageSent),
    };
  },
};

exports.SendingMessage = damlTypes.assembleTemplate(
  {
    templateId: '#ccip-core-v2:CCIP.CoreV2.SendingMessage:SendingMessage',
    templateIdWithPackageId: '#35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3:CCIP.CoreV2.SendingMessage:SendingMessage',
    keyDecoder: jtv.constant(undefined),
    keyEncode: function () { throw 'EncodeError'; },
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        deps: exports.SendingMessageDeps.decoder,
        ccipOwner: damlTypes.Party.decoder,
        sender: damlTypes.Party.decoder,
        destChainSelector: damlTypes.Numeric(0).decoder,
        destAddressBytesLength: damlTypes.Int.decoder,
        sequenceNumber: damlTypes.Numeric(0).decoder,
        destDefaultCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
        requiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
        requiredExecutor: jtv.Decoder.withDefault(null, damlTypes.Optional(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder),
        executorAddress: damlTypes.Text.decoder,
        executionMode: jtv.Decoder.withDefault(null, damlTypes.Optional(exports.ExecutionMode).decoder),
        sourceChainSelector: damlTypes.Numeric(0).decoder,
        senderAddress: damlTypes.Text.decoder,
        receiver: damlTypes.Text.decoder,
        payload: damlTypes.Text.decoder,
        executionGasLimit: damlTypes.Int.decoder,
        ccipReceiveGasLimit: damlTypes.Int.decoder,
        ccvAndExecutorHash: damlTypes.Text.decoder,
        onRampAddress: damlTypes.Text.decoder,
        offRampAddress: damlTypes.Text.decoder,
        tokenReceiver: damlTypes.Text.decoder,
        tokenArgs: damlTypes.Text.decoder,
        feeToken: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
        networkFeeUSDCents: damlTypes.Numeric(0).decoder,
        expectedTokenInstrumentId: jtv.Decoder.withDefault(null, damlTypes.Optional(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId).decoder),
        tokenAmountBeforeTokenPoolFees: damlTypes.Numeric(10).decoder,
        outboundPoolCCVs: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress)).decoder),
        executorArgs: damlTypes.Text.decoder,
        executorFee: jtv.Decoder.withDefault(null, damlTypes.Optional(exports.ExecutorFee).decoder),
        executorDestGasLimit: damlTypes.Int.decoder,
        executorDestBytesOverhead: damlTypes.Int.decoder,
        executorFeeTokenAmount: damlTypes.Numeric(10).decoder,
        observingParties: damlTypes.List(damlTypes.Party).decoder,
        ccvFees: damlTypes.List(exports.CCVFee).decoder,
        tokenSendFee: jtv.Decoder.withDefault(null, damlTypes.Optional(exports.TokenSendFee).decoder),
        ccvFeeTokenAmounts: damlTypes.List(damlTypes.Numeric(10)).decoder,
        tokenSendFeeTokenAmount: damlTypes.Numeric(10).decoder,
        networkFeeTokenAmount: damlTypes.Numeric(10).decoder,
        tokenSendData: jtv.Decoder.withDefault(null, damlTypes.Optional(exports.TokenSendData).decoder),
        verifierData: damlTypes.List(exports.VerifierData).decoder,
        ccvOwners: damlTypes.List(damlTypes.Party).decoder,
        message: jtv.Decoder.withDefault(null, damlTypes.Optional(pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1).decoder),
        encodedMessage: damlTypes.Text.decoder,
        messageId: damlTypes.Text.decoder,
        state: exports.SendingMessageState.decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        deps: exports.SendingMessageDeps.encode(__typed__.deps),
        ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
        sender: damlTypes.Party.encode(__typed__.sender),
        destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
        destAddressBytesLength: damlTypes.Int.encode(__typed__.destAddressBytesLength),
        sequenceNumber: damlTypes.Numeric(0).encode(__typed__.sequenceNumber),
        destDefaultCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.destDefaultCCVs),
        requiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.requiredCCVs),
        requiredExecutor: damlTypes.Optional(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.requiredExecutor),
        executorAddress: damlTypes.Text.encode(__typed__.executorAddress),
        executionMode: damlTypes.Optional(exports.ExecutionMode).encode(__typed__.executionMode),
        sourceChainSelector: damlTypes.Numeric(0).encode(__typed__.sourceChainSelector),
        senderAddress: damlTypes.Text.encode(__typed__.senderAddress),
        receiver: damlTypes.Text.encode(__typed__.receiver),
        payload: damlTypes.Text.encode(__typed__.payload),
        executionGasLimit: damlTypes.Int.encode(__typed__.executionGasLimit),
        ccipReceiveGasLimit: damlTypes.Int.encode(__typed__.ccipReceiveGasLimit),
        ccvAndExecutorHash: damlTypes.Text.encode(__typed__.ccvAndExecutorHash),
        onRampAddress: damlTypes.Text.encode(__typed__.onRampAddress),
        offRampAddress: damlTypes.Text.encode(__typed__.offRampAddress),
        tokenReceiver: damlTypes.Text.encode(__typed__.tokenReceiver),
        tokenArgs: damlTypes.Text.encode(__typed__.tokenArgs),
        feeToken: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.feeToken),
        networkFeeUSDCents: damlTypes.Numeric(0).encode(__typed__.networkFeeUSDCents),
        expectedTokenInstrumentId: damlTypes.Optional(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId).encode(__typed__.expectedTokenInstrumentId),
        tokenAmountBeforeTokenPoolFees: damlTypes.Numeric(10).encode(__typed__.tokenAmountBeforeTokenPoolFees),
        outboundPoolCCVs: damlTypes.Optional(damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress)).encode(__typed__.outboundPoolCCVs),
        executorArgs: damlTypes.Text.encode(__typed__.executorArgs),
        executorFee: damlTypes.Optional(exports.ExecutorFee).encode(__typed__.executorFee),
        executorDestGasLimit: damlTypes.Int.encode(__typed__.executorDestGasLimit),
        executorDestBytesOverhead: damlTypes.Int.encode(__typed__.executorDestBytesOverhead),
        executorFeeTokenAmount: damlTypes.Numeric(10).encode(__typed__.executorFeeTokenAmount),
        observingParties: damlTypes.List(damlTypes.Party).encode(__typed__.observingParties),
        ccvFees: damlTypes.List(exports.CCVFee).encode(__typed__.ccvFees),
        tokenSendFee: damlTypes.Optional(exports.TokenSendFee).encode(__typed__.tokenSendFee),
        ccvFeeTokenAmounts: damlTypes.List(damlTypes.Numeric(10)).encode(__typed__.ccvFeeTokenAmounts),
        tokenSendFeeTokenAmount: damlTypes.Numeric(10).encode(__typed__.tokenSendFeeTokenAmount),
        networkFeeTokenAmount: damlTypes.Numeric(10).encode(__typed__.networkFeeTokenAmount),
        tokenSendData: damlTypes.Optional(exports.TokenSendData).encode(__typed__.tokenSendData),
        verifierData: damlTypes.List(exports.VerifierData).encode(__typed__.verifierData),
        ccvOwners: damlTypes.List(damlTypes.Party).encode(__typed__.ccvOwners),
        message: damlTypes.Optional(pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1).encode(__typed__.message),
        encodedMessage: damlTypes.Text.encode(__typed__.encodedMessage),
        messageId: damlTypes.Text.encode(__typed__.messageId),
        state: exports.SendingMessageState.encode(__typed__.state),
      };
    },
    AddCCVFee: {
      template: function () { return exports.SendingMessage; },
      choiceName: 'AddCCVFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.AddCCVFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.AddCCVFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.SendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.SendingMessage).encode(__typed__); },
    },
    AddExecutorFee: {
      template: function () { return exports.SendingMessage; },
      choiceName: 'AddExecutorFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.AddExecutorFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.AddExecutorFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.SendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.SendingMessage).encode(__typed__); },
    },
    AddTokenSend: {
      template: function () { return exports.SendingMessage; },
      choiceName: 'AddTokenSend',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.AddTokenSend.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.AddTokenSend.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.SendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.SendingMessage).encode(__typed__); },
    },
    AddTokenSendFee: {
      template: function () { return exports.SendingMessage; },
      choiceName: 'AddTokenSendFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.AddTokenSendFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.AddTokenSendFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.SendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.SendingMessage).encode(__typed__); },
    },
    AddVerifierData: {
      template: function () { return exports.SendingMessage; },
      choiceName: 'AddVerifierData',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.AddVerifierData.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.AddVerifierData.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.SendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.SendingMessage).encode(__typed__); },
    },
    Archive: {
      template: function () { return exports.SendingMessage; },
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
    BuildMessage: {
      template: function () { return exports.SendingMessage; },
      choiceName: 'BuildMessage',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.BuildMessage.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.BuildMessage.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.SendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.SendingMessage).encode(__typed__); },
    },
    FeeTokenAmount: {
      template: function () { return exports.SendingMessage; },
      choiceName: 'FeeTokenAmount',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.FeeTokenAmount.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.FeeTokenAmount.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.Numeric(10).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.Numeric(10).encode(__typed__); },
    },
    FinalizeFee: {
      template: function () { return exports.SendingMessage; },
      choiceName: 'FinalizeFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.FinalizeFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.FinalizeFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.SendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.SendingMessage).encode(__typed__); },
    },
    FinalizeSend: {
      template: function () { return exports.SendingMessage; },
      choiceName: 'FinalizeSend',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.FinalizeSend.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.FinalizeSend.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.FinalizeSendResult.decoder;
      }),
      resultEncode: function (__typed__) { return exports.FinalizeSendResult.encode(__typed__); },
    },
    SetOutboundPoolCCVs: {
      template: function () { return exports.SendingMessage; },
      choiceName: 'SetOutboundPoolCCVs',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.SetOutboundPoolCCVs.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.SetOutboundPoolCCVs.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.SendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.SendingMessage).encode(__typed__); },
    },
  },
  pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage,
);

damlTypes.registerTemplate(exports.SendingMessage, ['35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3', '#ccip-core-v2']);

exports.SendingMessageDeps = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      router: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      onRamp: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      globalConfig: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      rmnRemote: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      tokenAdminRegistry: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      feeQuoter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      router: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.router),
      onRamp: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.onRamp),
      globalConfig: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.globalConfig),
      rmnRemote: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.rmnRemote),
      tokenAdminRegistry: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.tokenAdminRegistry),
      feeQuoter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.feeQuoter),
    };
  },
};

exports.SendingMessageState = {
  SendingMessageState_RequirePoolCCVs: 'SendingMessageState_RequirePoolCCVs',
  SendingMessageState_Prepared: 'SendingMessageState_Prepared',
  SendingMessageState_TokenLocked: 'SendingMessageState_TokenLocked',
  SendingMessageState_ExecutorFinalized: 'SendingMessageState_ExecutorFinalized',
  SendingMessageState_FeeFinalized: 'SendingMessageState_FeeFinalized',
  keys: ['SendingMessageState_RequirePoolCCVs', 'SendingMessageState_Prepared', 'SendingMessageState_TokenLocked', 'SendingMessageState_ExecutorFinalized', 'SendingMessageState_FeeFinalized'],
  decoder: damlTypes.lazyMemo(function () {
    return jtv.oneOf(
      jtv.constant(exports.SendingMessageState.SendingMessageState_RequirePoolCCVs),
      jtv.constant(exports.SendingMessageState.SendingMessageState_Prepared),
      jtv.constant(exports.SendingMessageState.SendingMessageState_TokenLocked),
      jtv.constant(exports.SendingMessageState.SendingMessageState_ExecutorFinalized),
      jtv.constant(exports.SendingMessageState.SendingMessageState_FeeFinalized),
    );
  }),
  encode: function (__typed__) { return __typed__; },
};

exports.SetOutboundPoolCCVs = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      poolCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      poolCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.poolCCVs),
    };
  },
};

exports.TokenSendData = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      poolInstanceId: damlTypes.Text.decoder,
      poolOwner: damlTypes.Party.decoder,
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      amount: damlTypes.Text.decoder,
      destTokenAddress: damlTypes.Text.decoder,
      extraData: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      poolInstanceId: damlTypes.Text.encode(__typed__.poolInstanceId),
      poolOwner: damlTypes.Party.encode(__typed__.poolOwner),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      amount: damlTypes.Text.encode(__typed__.amount),
      destTokenAddress: damlTypes.Text.encode(__typed__.destTokenAddress),
      extraData: damlTypes.Text.encode(__typed__.extraData),
    };
  },
};

exports.TokenSendFee = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      poolInstanceId: damlTypes.Text.decoder,
      poolOwner: damlTypes.Party.decoder,
      feeUSDCents: damlTypes.Numeric(0).decoder,
      destGasOverhead: damlTypes.Int.decoder,
      destBytesOverhead: damlTypes.Int.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      poolInstanceId: damlTypes.Text.encode(__typed__.poolInstanceId),
      poolOwner: damlTypes.Party.encode(__typed__.poolOwner),
      feeUSDCents: damlTypes.Numeric(0).encode(__typed__.feeUSDCents),
      destGasOverhead: damlTypes.Int.encode(__typed__.destGasOverhead),
      destBytesOverhead: damlTypes.Int.encode(__typed__.destBytesOverhead),
    };
  },
};

exports.VerifierData = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccvInstanceId: damlTypes.Text.decoder,
      ccvOwner: damlTypes.Party.decoder,
      versionTag: damlTypes.Text.decoder,
      verifierBlob: damlTypes.Text.decoder,
      messageSentObservers: damlTypes.List(damlTypes.Party).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccvInstanceId: damlTypes.Text.encode(__typed__.ccvInstanceId),
      ccvOwner: damlTypes.Party.encode(__typed__.ccvOwner),
      versionTag: damlTypes.Text.encode(__typed__.versionTag),
      verifierBlob: damlTypes.Text.encode(__typed__.verifierBlob),
      messageSentObservers: damlTypes.List(damlTypes.Party).encode(__typed__.messageSentObservers),
    };
  },
};
