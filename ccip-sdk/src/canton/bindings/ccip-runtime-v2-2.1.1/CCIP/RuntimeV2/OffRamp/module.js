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

var pkg506234a38fffe1945e3b5ff3a5e444a237fa9592b249b0f7444c194207df2c2d = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-tickets-v2-2.0.0');
var pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240 = require('@chainlink/ccip-sdk/src/canton/bindings/mcms-api-1.0.0');
var pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-codec-v2-2.0.0');
var pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39 = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-core-v2-2.1.1');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@chainlink/ccip-sdk/src/canton/bindings/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 = require('@chainlink/ccip-sdk/src/canton/bindings/chainlink-api-2.0.0');
var pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-events-v2-2.0.0');

var CCIP_RuntimeV2_OffRampTypes = require('../../../CCIP/RuntimeV2/OffRampTypes/module');

exports.ExecuteFromRouter = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      routerPartyOwner: damlTypes.Party.decoder,
      executingMessageCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.ExecutingMessage.ExecutingMessage).decoder,
      globalConfigCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig).decoder,
      tokenAdminRegistryCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.TokenAdminRegistry.TokenAdminRegistry).decoder,
      tokenConfigCid: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.TokenAdminRegistry.TokenConfig)).decoder),
      rmnRemoteCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.RMNRemote.RMNRemote).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      routerPartyOwner: damlTypes.Party.encode(__typed__.routerPartyOwner),
      executingMessageCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.ExecutingMessage.ExecutingMessage).encode(__typed__.executingMessageCid),
      globalConfigCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig).encode(__typed__.globalConfigCid),
      tokenAdminRegistryCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.TokenAdminRegistry.TokenAdminRegistry).encode(__typed__.tokenAdminRegistryCid),
      tokenConfigCid: damlTypes.Optional(damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.TokenAdminRegistry.TokenConfig)).encode(__typed__.tokenConfigCid),
      rmnRemoteCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.RMNRemote.RMNRemote).encode(__typed__.rmnRemoteCid),
    };
  },
};

exports.ExecuteFromRouterResult = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      messageId: damlTypes.Text.decoder,
      message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1.decoder,
      sourceChainSelector: damlTypes.Numeric(0).decoder,
      sequenceNumber: damlTypes.Numeric(0).decoder,
      tokenReceiveTicket: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkg506234a38fffe1945e3b5ff3a5e444a237fa9592b249b0f7444c194207df2c2d.CCIP.TicketsV2.TokenReceiveTicket)).decoder),
      executionStateChanged: damlTypes.ContractId(pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Events.ExecutionStateChanged).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      messageId: damlTypes.Text.encode(__typed__.messageId),
      message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1.encode(__typed__.message),
      sourceChainSelector: damlTypes.Numeric(0).encode(__typed__.sourceChainSelector),
      sequenceNumber: damlTypes.Numeric(0).encode(__typed__.sequenceNumber),
      tokenReceiveTicket: damlTypes.Optional(damlTypes.ContractId(pkg506234a38fffe1945e3b5ff3a5e444a237fa9592b249b0f7444c194207df2c2d.CCIP.TicketsV2.TokenReceiveTicket)).encode(__typed__.tokenReceiveTicket),
      executionStateChanged: damlTypes.ContractId(pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Events.ExecutionStateChanged).encode(__typed__.executionStateChanged),
    };
  },
};

exports.GetRequiredCCVsForExecuteFromRouter = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      globalConfigCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig).decoder,
      message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1.decoder,
      receiverRequiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      receiverOptionalCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      receiverOptionalThreshold: damlTypes.Int.decoder,
      tokenPoolRequiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      globalConfigCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig).encode(__typed__.globalConfigCid),
      message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1.encode(__typed__.message),
      receiverRequiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.receiverRequiredCCVs),
      receiverOptionalCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.receiverOptionalCCVs),
      receiverOptionalThreshold: damlTypes.Int.encode(__typed__.receiverOptionalThreshold),
      tokenPoolRequiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.tokenPoolRequiredCCVs),
    };
  },
};

exports.OffRamp = damlTypes.assembleTemplate(
  {
    templateId: '#ccip-runtime-v2:CCIP.RuntimeV2.OffRamp:OffRamp',
    templateIdWithPackageId: '#00ce3527b21ca012761fa58fae105954103a62bc4d72a2018d001b32b79a11a9:CCIP.RuntimeV2.OffRamp:OffRamp',
    keyDecoder: jtv.constant(undefined),
    keyEncode: function () { throw 'EncodeError'; },
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        instanceId: damlTypes.Text.decoder,
        ccipOwner: damlTypes.Party.decoder,
        deps: CCIP_RuntimeV2_OffRampTypes.OffRampDeps.decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        instanceId: damlTypes.Text.encode(__typed__.instanceId),
        ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
        deps: CCIP_RuntimeV2_OffRampTypes.OffRampDeps.encode(__typed__.deps),
      };
    },
    Archive: {
      template: function () { return exports.OffRamp; },
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
    ExecuteFromRouter: {
      template: function () { return exports.OffRamp; },
      choiceName: 'ExecuteFromRouter',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.ExecuteFromRouter.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.ExecuteFromRouter.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.ExecuteFromRouterResult.decoder;
      }),
      resultEncode: function (__typed__) { return exports.ExecuteFromRouterResult.encode(__typed__); },
    },
    GetRequiredCCVsForExecuteFromRouter: {
      template: function () { return exports.OffRamp; },
      choiceName: 'GetRequiredCCVsForExecuteFromRouter',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GetRequiredCCVsForExecuteFromRouter.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GetRequiredCCVsForExecuteFromRouter.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__); },
    },
    PrepareExecute: {
      template: function () { return exports.OffRamp; },
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
    SetDeps: {
      template: function () { return exports.OffRamp; },
      choiceName: 'SetDeps',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.SetDeps.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.SetDeps.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.OffRamp).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.OffRamp).encode(__typed__); },
    },
  },
  pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240.MCMS.MCMSReceiver.MCMSReceiver,
);

// Disable for now - causes logs on the console
// damlTypes.registerTemplate(exports.OffRamp, ['00ce3527b21ca012761fa58fae105954103a62bc4d72a2018d001b32b79a11a9', '#ccip-runtime-v2']);

exports.PrepareExecute = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      encodedMessage: damlTypes.Text.decoder,
      globalConfigCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig).decoder,
      tokenAdminRegistryCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.TokenAdminRegistry.TokenAdminRegistry).decoder,
      receiverRequiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      receiverOptionalCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      receiverOptionalThreshold: damlTypes.Int.decoder,
      receiverFinalityConfig: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig.decoder,
      rmnRemoteCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.RMNRemote.RMNRemote).decoder,
      receiverParty: damlTypes.Party.decoder,
      tokenReceiverParty: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.Party).decoder),
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      encodedMessage: damlTypes.Text.encode(__typed__.encodedMessage),
      globalConfigCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig).encode(__typed__.globalConfigCid),
      tokenAdminRegistryCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.TokenAdminRegistry.TokenAdminRegistry).encode(__typed__.tokenAdminRegistryCid),
      receiverRequiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.receiverRequiredCCVs),
      receiverOptionalCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.receiverOptionalCCVs),
      receiverOptionalThreshold: damlTypes.Int.encode(__typed__.receiverOptionalThreshold),
      receiverFinalityConfig: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig.encode(__typed__.receiverFinalityConfig),
      rmnRemoteCid: damlTypes.ContractId(pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.RMNRemote.RMNRemote).encode(__typed__.rmnRemoteCid),
      receiverParty: damlTypes.Party.encode(__typed__.receiverParty),
      tokenReceiverParty: damlTypes.Optional(damlTypes.Party).encode(__typed__.tokenReceiverParty),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.SetDeps = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      newDeps: CCIP_RuntimeV2_OffRampTypes.SetDepsParams.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      newDeps: CCIP_RuntimeV2_OffRampTypes.SetDepsParams.encode(__typed__.newDeps),
    };
  },
};
