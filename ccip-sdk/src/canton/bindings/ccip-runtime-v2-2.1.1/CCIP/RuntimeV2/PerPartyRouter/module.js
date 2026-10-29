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
var pkg506234a38fffe1945e3b5ff3a5e444a237fa9592b249b0f7444c194207df2c2d = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-tickets-v2-2.0.0');
var pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281 = require('@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-transfer-instruction-v1-1.0.0');
var pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240 = require('@chainlink/ccip-sdk/src/canton/bindings/mcms-api-1.0.0');
var pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-codec-v2-2.0.0');
var pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b = require('@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-holding-v1-1.0.0');
var pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39 = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-core-v2-2.1.1');
var pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-api-v2-2.0.0');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@chainlink/ccip-sdk/src/canton/bindings/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkgb70db8369e1c461d5c70f1c86f526a29e9776c655e6ffc2560f95b05ccb8b946 = require('@chainlink/ccip-sdk/src/canton/bindings/daml-stdlib-DA-Time-Types-1.0.0');
var pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984 = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-client-api-v2-2.0.0');
var pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 = require('@chainlink/ccip-sdk/src/canton/bindings/chainlink-api-2.0.0');
var pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-events-v2-2.0.0');
var pkgc3bb0c5d04799b3f11bad7c3c102963e115cf53da3e4afcbcfd9f06ebd82b4ff = require('@chainlink/ccip-sdk/src/canton/bindings/daml-stdlib-DA-Set-Types-1.0.0');

var CCIP_RuntimeV2_OnRamp = require('../../../CCIP/RuntimeV2/OnRamp/module');
var CCIP_RuntimeV2_PerPartyRouterTypes = require('../../../CCIP/RuntimeV2/PerPartyRouterTypes/module');

exports.AddCustomObservers = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      parties: damlTypes.List(damlTypes.Party).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      parties: damlTypes.List(damlTypes.Party).encode(__typed__.parties),
    };
  },
};

exports.ArchivedExecutedMessages = damlTypes.assembleTemplate(
  {
    templateId: '#ccip-runtime-v2:CCIP.RuntimeV2.PerPartyRouter:ArchivedExecutedMessages',
    templateIdWithPackageId: '#00ce3527b21ca012761fa58fae105954103a62bc4d72a2018d001b32b79a11a9:CCIP.RuntimeV2.PerPartyRouter:ArchivedExecutedMessages',
    keyDecoder: jtv.constant(undefined),
    keyEncode: function () { throw 'EncodeError'; },
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        ccipOwner: damlTypes.Party.decoder,
        partyOwner: damlTypes.Party.decoder,
        perPartyRouterInstanceId: damlTypes.Text.decoder,
        archiveIndex: damlTypes.Int.decoder,
        executedMessages: pkgc3bb0c5d04799b3f11bad7c3c102963e115cf53da3e4afcbcfd9f06ebd82b4ff.DA.Set.Types.Set(damlTypes.Text).decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
        partyOwner: damlTypes.Party.encode(__typed__.partyOwner),
        perPartyRouterInstanceId: damlTypes.Text.encode(__typed__.perPartyRouterInstanceId),
        archiveIndex: damlTypes.Int.encode(__typed__.archiveIndex),
        executedMessages: pkgc3bb0c5d04799b3f11bad7c3c102963e115cf53da3e4afcbcfd9f06ebd82b4ff.DA.Set.Types.Set(damlTypes.Text).encode(__typed__.executedMessages),
      };
    },
    Archive: {
      template: function () { return exports.ArchivedExecutedMessages; },
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
    IsExecuted: {
      template: function () { return exports.ArchivedExecutedMessages; },
      choiceName: 'IsExecuted',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.IsExecuted.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.IsExecuted.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.Bool.decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.Bool.encode(__typed__); },
    },
  },
);

// Disable for now - causes logs on the console
// damlTypes.registerTemplate(exports.ArchivedExecutedMessages, ['00ce3527b21ca012761fa58fae105954103a62bc4d72a2018d001b32b79a11a9', '#ccip-runtime-v2']);

exports.CCIPSend = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      sendingMessageCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage).decoder,
      feeTokenHoldingCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).decoder,
      feeTokenConfigCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.TokenAdminRegistry.TokenConfig).decoder,
      feeTokenTransferFactory: damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory).decoder,
      feeTokenExtraArgs: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ExtraArgs.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      sendingMessageCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage).encode(__typed__.sendingMessageCid),
      feeTokenHoldingCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).encode(__typed__.feeTokenHoldingCids),
      feeTokenConfigCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.TokenAdminRegistry.TokenConfig).encode(__typed__.feeTokenConfigCid),
      feeTokenTransferFactory: damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory).encode(__typed__.feeTokenTransferFactory),
      feeTokenExtraArgs: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ExtraArgs.encode(__typed__.feeTokenExtraArgs),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.CCIPSendResult = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      router: damlTypes.ContractId(exports.PerPartyRouter).decoder,
      ccipMessageSent: damlTypes.ContractId(pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Events.CCIPMessageSent).decoder,
      messageId: damlTypes.Text.decoder,
      feeChangeCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).decoder,
      pendingFeeInstructions: damlTypes.List(damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction)).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      router: damlTypes.ContractId(exports.PerPartyRouter).encode(__typed__.router),
      ccipMessageSent: damlTypes.ContractId(pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Events.CCIPMessageSent).encode(__typed__.ccipMessageSent),
      messageId: damlTypes.Text.encode(__typed__.messageId),
      feeChangeCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).encode(__typed__.feeChangeCids),
      pendingFeeInstructions: damlTypes.List(damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction)).encode(__typed__.pendingFeeInstructions),
    };
  },
};

exports.CreateRouter = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      partyOwner: damlTypes.Party.decoder,
      instanceId: damlTypes.Text.decoder,
      feeTransferLifetime: jtv.Decoder.withDefault(null, damlTypes.Optional(pkgb70db8369e1c461d5c70f1c86f526a29e9776c655e6ffc2560f95b05ccb8b946.DA.Time.Types.RelTime).decoder),
    });
  }),
  encode: function (__typed__) {
    return {
      partyOwner: damlTypes.Party.encode(__typed__.partyOwner),
      instanceId: damlTypes.Text.encode(__typed__.instanceId),
      feeTransferLifetime: damlTypes.Optional(pkgb70db8369e1c461d5c70f1c86f526a29e9776c655e6ffc2560f95b05ccb8b946.DA.Time.Types.RelTime).encode(__typed__.feeTransferLifetime),
    };
  },
};

exports.CreateRouterResult = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      router: damlTypes.ContractId(exports.PerPartyRouter).decoder,
      factory: damlTypes.ContractId(exports.PerPartyRouterFactory).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      router: damlTypes.ContractId(exports.PerPartyRouter).encode(__typed__.router),
      factory: damlTypes.ContractId(exports.PerPartyRouterFactory).encode(__typed__.factory),
    };
  },
};

exports.Execute = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      executingMessageCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.ExecutingMessage.ExecutingMessage).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      executingMessageCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.ExecutingMessage.ExecutingMessage).encode(__typed__.executingMessageCid),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.ExecuteResult = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      router: damlTypes.ContractId(exports.PerPartyRouter).decoder,
      tokenReceiveTicket: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkg506234a38fffe1945e3b5ff3a5e444a237fa9592b249b0f7444c194207df2c2d.CCIP.TicketsV2.TokenReceiveTicket)).decoder),
      executionStateChanged: damlTypes.ContractId(pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Events.ExecutionStateChanged).decoder,
      messageId: damlTypes.Text.decoder,
      message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1.decoder,
      state: pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.MessageExecutionState.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      router: damlTypes.ContractId(exports.PerPartyRouter).encode(__typed__.router),
      tokenReceiveTicket: damlTypes.Optional(damlTypes.ContractId(pkg506234a38fffe1945e3b5ff3a5e444a237fa9592b249b0f7444c194207df2c2d.CCIP.TicketsV2.TokenReceiveTicket)).encode(__typed__.tokenReceiveTicket),
      executionStateChanged: damlTypes.ContractId(pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Events.ExecutionStateChanged).encode(__typed__.executionStateChanged),
      messageId: damlTypes.Text.encode(__typed__.messageId),
      message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1.encode(__typed__.message),
      state: pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.MessageExecutionState.encode(__typed__.state),
    };
  },
};

exports.FactorySetDeps = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      newDeps: CCIP_RuntimeV2_PerPartyRouterTypes.SetDepsParams.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      newDeps: CCIP_RuntimeV2_PerPartyRouterTypes.SetDepsParams.encode(__typed__.newDeps),
    };
  },
};

exports.FinalizeFee = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      sendingMessageCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      sendingMessageCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage).encode(__typed__.sendingMessageCid),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.GetExecutionState = {
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

exports.GetFee = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      destChainSelector: damlTypes.Numeric(0).decoder,
      message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage.decoder,
      ccvFeeQuotes: damlTypes.List(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.CrossChainVerifier.CrossChainVerifierFeeQuote).decoder,
      tokenPoolFeeQuote: jtv.Decoder.withDefault(null, damlTypes.Optional(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.TokenPoolFeeQuote).decoder),
      executorFeeQuote: jtv.Decoder.withDefault(null, damlTypes.Optional(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.Executor.ExecutorFeeQuote).decoder),
    });
  }),
  encode: function (__typed__) {
    return {
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage.encode(__typed__.message),
      ccvFeeQuotes: damlTypes.List(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.CrossChainVerifier.CrossChainVerifierFeeQuote).encode(__typed__.ccvFeeQuotes),
      tokenPoolFeeQuote: damlTypes.Optional(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.TokenPoolFeeQuote).encode(__typed__.tokenPoolFeeQuote),
      executorFeeQuote: damlTypes.Optional(pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.Executor.ExecutorFeeQuote).encode(__typed__.executorFeeQuote),
    };
  },
};

exports.GetRequiredCCVsForExecute = {
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

exports.GetRequiredCCVsForSend = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destChainSelector: damlTypes.Numeric(0).decoder,
      message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage.decoder,
      poolReportedCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage.encode(__typed__.message),
      poolReportedCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.poolReportedCCVs),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.GetSequenceNumber = {
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

exports.HasRouter = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      partyOwner: damlTypes.Party.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      partyOwner: damlTypes.Party.encode(__typed__.partyOwner),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.IsExecuted = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      messageHash: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      messageHash: damlTypes.Text.encode(__typed__.messageHash),
    };
  },
};

exports.PerPartyRouter = damlTypes.assembleTemplate(
  {
    templateId: '#ccip-runtime-v2:CCIP.RuntimeV2.PerPartyRouter:PerPartyRouter',
    templateIdWithPackageId: '#00ce3527b21ca012761fa58fae105954103a62bc4d72a2018d001b32b79a11a9:CCIP.RuntimeV2.PerPartyRouter:PerPartyRouter',
    keyDecoder: jtv.constant(undefined),
    keyEncode: function () { throw 'EncodeError'; },
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        instanceId: damlTypes.Text.decoder,
        ccipOwner: damlTypes.Party.decoder,
        partyOwner: damlTypes.Party.decoder,
        deps: CCIP_RuntimeV2_PerPartyRouterTypes.PerPartyRouterDeps.decoder,
        outboundSequenceNumbers: damlTypes.Map(damlTypes.Numeric(0), damlTypes.Numeric(0)).decoder,
        executedMessages: pkgc3bb0c5d04799b3f11bad7c3c102963e115cf53da3e4afcbcfd9f06ebd82b4ff.DA.Set.Types.Set(damlTypes.Text).decoder,
        archivedExecutionContractIds: damlTypes.List(damlTypes.ContractId(exports.ArchivedExecutedMessages)).decoder,
        customObservers: damlTypes.List(damlTypes.Party).decoder,
        feeTransferLifetime: jtv.Decoder.withDefault(null, damlTypes.Optional(pkgb70db8369e1c461d5c70f1c86f526a29e9776c655e6ffc2560f95b05ccb8b946.DA.Time.Types.RelTime).decoder),
      });
    }),
    encode: function (__typed__) {
      return {
        instanceId: damlTypes.Text.encode(__typed__.instanceId),
        ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
        partyOwner: damlTypes.Party.encode(__typed__.partyOwner),
        deps: CCIP_RuntimeV2_PerPartyRouterTypes.PerPartyRouterDeps.encode(__typed__.deps),
        outboundSequenceNumbers: damlTypes.Map(damlTypes.Numeric(0), damlTypes.Numeric(0)).encode(__typed__.outboundSequenceNumbers),
        executedMessages: pkgc3bb0c5d04799b3f11bad7c3c102963e115cf53da3e4afcbcfd9f06ebd82b4ff.DA.Set.Types.Set(damlTypes.Text).encode(__typed__.executedMessages),
        archivedExecutionContractIds: damlTypes.List(damlTypes.ContractId(exports.ArchivedExecutedMessages)).encode(__typed__.archivedExecutionContractIds),
        customObservers: damlTypes.List(damlTypes.Party).encode(__typed__.customObservers),
        feeTransferLifetime: damlTypes.Optional(pkgb70db8369e1c461d5c70f1c86f526a29e9776c655e6ffc2560f95b05ccb8b946.DA.Time.Types.RelTime).encode(__typed__.feeTransferLifetime),
      };
    },
    AddCustomObservers: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'AddCustomObservers',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.AddCustomObservers.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.AddCustomObservers.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.PerPartyRouter).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.PerPartyRouter).encode(__typed__); },
    },
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
    CCIPSend: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'CCIPSend',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.CCIPSend.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.CCIPSend.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.CCIPSendResult.decoder;
      }),
      resultEncode: function (__typed__) { return exports.CCIPSendResult.encode(__typed__); },
    },
    Execute: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'Execute',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.Execute.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.Execute.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.ExecuteResult.decoder;
      }),
      resultEncode: function (__typed__) { return exports.ExecuteResult.encode(__typed__); },
    },
    FinalizeFee: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'FinalizeFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.FinalizeFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.FinalizeFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage).encode(__typed__); },
    },
    GetExecutionState: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'GetExecutionState',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GetExecutionState.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GetExecutionState.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.MessageExecutionState.decoder;
      }),
      resultEncode: function (__typed__) { return pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.MessageExecutionState.encode(__typed__); },
    },
    GetFee: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'GetFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GetFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GetFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return CCIP_RuntimeV2_OnRamp.GetFeeFromRouterResult.decoder;
      }),
      resultEncode: function (__typed__) { return CCIP_RuntimeV2_OnRamp.GetFeeFromRouterResult.encode(__typed__); },
    },
    GetRequiredCCVsForExecute: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'GetRequiredCCVsForExecute',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GetRequiredCCVsForExecute.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GetRequiredCCVsForExecute.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__); },
    },
    GetRequiredCCVsForSend: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'GetRequiredCCVsForSend',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GetRequiredCCVsForSend.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GetRequiredCCVsForSend.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__); },
    },
    GetSequenceNumber: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'GetSequenceNumber',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GetSequenceNumber.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GetSequenceNumber.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.Numeric(0).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.Numeric(0).encode(__typed__); },
    },
    PrepareExecute: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'PrepareExecute',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.PrepareExecute.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.PrepareExecute.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.ExecutingMessage.ExecutingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.ExecutingMessage.ExecutingMessage).encode(__typed__); },
    },
    PrepareSend: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'PrepareSend',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.PrepareSend.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.PrepareSend.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage).encode(__typed__); },
    },
    RemoveCustomObservers: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'RemoveCustomObservers',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.RemoveCustomObservers.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.RemoveCustomObservers.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.PerPartyRouter).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.PerPartyRouter).encode(__typed__); },
    },
    SetDeps: {
      template: function () { return exports.PerPartyRouter; },
      choiceName: 'SetDeps',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.SetDeps.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.SetDeps.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.PerPartyRouter).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.PerPartyRouter).encode(__typed__); },
    },
  },
  pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.PerPartyRouter,
  pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240.MCMS.MCMSReceiver.MCMSReceiver,
);

// Disable for now - causes logs on the console
// damlTypes.registerTemplate(exports.PerPartyRouter, ['00ce3527b21ca012761fa58fae105954103a62bc4d72a2018d001b32b79a11a9', '#ccip-runtime-v2']);

exports.PerPartyRouterFactory = damlTypes.assembleTemplate(
  {
    templateId: '#ccip-runtime-v2:CCIP.RuntimeV2.PerPartyRouter:PerPartyRouterFactory',
    templateIdWithPackageId: '#00ce3527b21ca012761fa58fae105954103a62bc4d72a2018d001b32b79a11a9:CCIP.RuntimeV2.PerPartyRouter:PerPartyRouterFactory',
    keyDecoder: jtv.constant(undefined),
    keyEncode: function () { throw 'EncodeError'; },
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        instanceId: damlTypes.Text.decoder,
        ccipOwner: damlTypes.Party.decoder,
        deps: CCIP_RuntimeV2_PerPartyRouterTypes.PerPartyRouterDeps.decoder,
        registeredRouters: damlTypes.Map(damlTypes.Party, damlTypes.Text).decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        instanceId: damlTypes.Text.encode(__typed__.instanceId),
        ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
        deps: CCIP_RuntimeV2_PerPartyRouterTypes.PerPartyRouterDeps.encode(__typed__.deps),
        registeredRouters: damlTypes.Map(damlTypes.Party, damlTypes.Text).encode(__typed__.registeredRouters),
      };
    },
    Archive: {
      template: function () { return exports.PerPartyRouterFactory; },
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
    CreateRouter: {
      template: function () { return exports.PerPartyRouterFactory; },
      choiceName: 'CreateRouter',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.CreateRouter.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.CreateRouter.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.CreateRouterResult.decoder;
      }),
      resultEncode: function (__typed__) { return exports.CreateRouterResult.encode(__typed__); },
    },
    FactorySetDeps: {
      template: function () { return exports.PerPartyRouterFactory; },
      choiceName: 'FactorySetDeps',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.FactorySetDeps.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.FactorySetDeps.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.PerPartyRouterFactory).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.PerPartyRouterFactory).encode(__typed__); },
    },
    HasRouter: {
      template: function () { return exports.PerPartyRouterFactory; },
      choiceName: 'HasRouter',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.HasRouter.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.HasRouter.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.Bool.decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.Bool.encode(__typed__); },
    },
  },
  pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240.MCMS.MCMSReceiver.MCMSReceiver,
);

// Disable for now - causes logs on the console
// damlTypes.registerTemplate(exports.PerPartyRouterFactory, ['00ce3527b21ca012761fa58fae105954103a62bc4d72a2018d001b32b79a11a9', '#ccip-runtime-v2']);

exports.PrepareExecute = {
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

exports.PrepareSend = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destinationChainSelector: damlTypes.Numeric(0).decoder,
      message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destinationChainSelector: damlTypes.Numeric(0).encode(__typed__.destinationChainSelector),
      message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage.encode(__typed__.message),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.RemoveCustomObservers = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      parties: damlTypes.List(damlTypes.Party).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      parties: damlTypes.List(damlTypes.Party).encode(__typed__.parties),
    };
  },
};

exports.SetDeps = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      newDeps: CCIP_RuntimeV2_PerPartyRouterTypes.SetDepsParams.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      newDeps: CCIP_RuntimeV2_PerPartyRouterTypes.SetDepsParams.encode(__typed__.newDeps),
    };
  },
};
