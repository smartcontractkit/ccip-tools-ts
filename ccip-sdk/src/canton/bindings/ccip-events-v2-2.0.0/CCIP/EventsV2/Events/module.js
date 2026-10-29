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

var pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281 = require('@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-transfer-instruction-v1-1.0.0');
var pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-codec-v2-2.0.0');
var pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b = require('@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-holding-v1-1.0.0');
var pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-api-v2-2.0.0');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@chainlink/ccip-sdk/src/canton/bindings/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984 = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-client-api-v2-2.0.0');
var pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 = require('@chainlink/ccip-sdk/src/canton/bindings/chainlink-api-2.0.0');

var CCIP_EventsV2_Receipts = require('../../../CCIP/EventsV2/Receipts/module');

exports.CCIPMessageSent = damlTypes.assembleTemplate(
  {
    templateId: '#ccip-events-v2:CCIP.EventsV2.Events:CCIPMessageSent',
    templateIdWithPackageId: '#bfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f:CCIP.EventsV2.Events:CCIPMessageSent',
    keyDecoder: jtv.constant(undefined),
    keyEncode: function () { throw 'EncodeError'; },
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        ccipOwner: damlTypes.Party.decoder,
        ccvOwners: damlTypes.List(damlTypes.Party).decoder,
        sender: damlTypes.Party.decoder,
        observers: damlTypes.List(damlTypes.Party).decoder,
        event: exports.CCIPMessageSentEvent.decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
        ccvOwners: damlTypes.List(damlTypes.Party).encode(__typed__.ccvOwners),
        sender: damlTypes.Party.encode(__typed__.sender),
        observers: damlTypes.List(damlTypes.Party).encode(__typed__.observers),
        event: exports.CCIPMessageSentEvent.encode(__typed__.event),
      };
    },
    Archive: {
      template: function () { return exports.CCIPMessageSent; },
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
  pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.ICCIPMessageSent,
);

// Disable for now - causes logs on the console
// damlTypes.registerTemplate(exports.CCIPMessageSent, ['bfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f', '#ccip-events-v2']);

exports.CCIPMessageSentEvent = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destChainSelector: damlTypes.Numeric(0).decoder,
      sequenceNumber: damlTypes.Numeric(0).decoder,
      messageId: damlTypes.Text.decoder,
      feeToken: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      tokenAmountBeforeTokenPoolFees: damlTypes.Numeric(10).decoder,
      encodedMessage: damlTypes.Text.decoder,
      verifierBlobs: damlTypes.List(damlTypes.Text).decoder,
      receipts: damlTypes.List(CCIP_EventsV2_Receipts.Receipt).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      sequenceNumber: damlTypes.Numeric(0).encode(__typed__.sequenceNumber),
      messageId: damlTypes.Text.encode(__typed__.messageId),
      feeToken: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.feeToken),
      tokenAmountBeforeTokenPoolFees: damlTypes.Numeric(10).encode(__typed__.tokenAmountBeforeTokenPoolFees),
      encodedMessage: damlTypes.Text.encode(__typed__.encodedMessage),
      verifierBlobs: damlTypes.List(damlTypes.Text).encode(__typed__.verifierBlobs),
      receipts: damlTypes.List(CCIP_EventsV2_Receipts.Receipt).encode(__typed__.receipts),
    };
  },
};

exports.ExecutionStateChanged = damlTypes.assembleTemplate(
  {
    templateId: '#ccip-events-v2:CCIP.EventsV2.Events:ExecutionStateChanged',
    templateIdWithPackageId: '#bfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f:CCIP.EventsV2.Events:ExecutionStateChanged',
    keyDecoder: jtv.constant(undefined),
    keyEncode: function () { throw 'EncodeError'; },
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        ccipOwner: damlTypes.Party.decoder,
        ccvOwners: damlTypes.List(damlTypes.Party).decoder,
        receiver: damlTypes.Party.decoder,
        event: exports.ExecutionStateChangedEvent.decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
        ccvOwners: damlTypes.List(damlTypes.Party).encode(__typed__.ccvOwners),
        receiver: damlTypes.Party.encode(__typed__.receiver),
        event: exports.ExecutionStateChangedEvent.encode(__typed__.event),
      };
    },
    Archive: {
      template: function () { return exports.ExecutionStateChanged; },
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
  pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.IExecutionStateChanged,
);

// Disable for now - causes logs on the console
// damlTypes.registerTemplate(exports.ExecutionStateChanged, ['bfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f', '#ccip-events-v2']);

exports.ExecutionStateChangedEvent = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      sourceChainSelector: damlTypes.Numeric(0).decoder,
      sequenceNumber: damlTypes.Numeric(0).decoder,
      messageId: damlTypes.Text.decoder,
      state: pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.MessageExecutionState.decoder,
      returnData: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      sourceChainSelector: damlTypes.Numeric(0).encode(__typed__.sourceChainSelector),
      sequenceNumber: damlTypes.Numeric(0).encode(__typed__.sequenceNumber),
      messageId: damlTypes.Text.encode(__typed__.messageId),
      state: pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.MessageExecutionState.encode(__typed__.state),
      returnData: damlTypes.Text.encode(__typed__.returnData),
    };
  },
};

exports.TokenReceiveTicketClaimed = damlTypes.assembleTemplate(
  {
    templateId: '#ccip-events-v2:CCIP.EventsV2.Events:TokenReceiveTicketClaimed',
    templateIdWithPackageId: '#bfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f:CCIP.EventsV2.Events:TokenReceiveTicketClaimed',
    keyDecoder: jtv.constant(undefined),
    keyEncode: function () { throw 'EncodeError'; },
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        ccipOwner: damlTypes.Party.decoder,
        ccvOwners: damlTypes.List(damlTypes.Party).decoder,
        poolOwner: damlTypes.Party.decoder,
        receiver: damlTypes.Party.decoder,
        tokenReceiver: damlTypes.Party.decoder,
        tokenReceiveTicketCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.ITokenReceiveTicket).decoder,
        event: exports.TokenReceiveTicketClaimedEvent.decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
        ccvOwners: damlTypes.List(damlTypes.Party).encode(__typed__.ccvOwners),
        poolOwner: damlTypes.Party.encode(__typed__.poolOwner),
        receiver: damlTypes.Party.encode(__typed__.receiver),
        tokenReceiver: damlTypes.Party.encode(__typed__.tokenReceiver),
        tokenReceiveTicketCid: damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.ITokenReceiveTicket).encode(__typed__.tokenReceiveTicketCid),
        event: exports.TokenReceiveTicketClaimedEvent.encode(__typed__.event),
      };
    },
    Archive: {
      template: function () { return exports.TokenReceiveTicketClaimed; },
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
// damlTypes.registerTemplate(exports.TokenReceiveTicketClaimed, ['bfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f', '#ccip-events-v2']);

exports.TokenReceiveTicketClaimedEvent = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      verifiedCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      tokenAdminRegistryInstanceId: damlTypes.Text.decoder,
      poolAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      sourceAmount: damlTypes.Text.decoder,
      localAmount: damlTypes.Numeric(0).decoder,
      sourcePoolData: damlTypes.Text.decoder,
      messageId: damlTypes.Text.decoder,
      sourceChainSelector: damlTypes.Numeric(0).decoder,
      finality: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig.decoder,
      output: exports.TokenReceiveTicketClaimed_Output.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      verifiedCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.verifiedCCVs),
      tokenAdminRegistryInstanceId: damlTypes.Text.encode(__typed__.tokenAdminRegistryInstanceId),
      poolAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.poolAddress),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      sourceAmount: damlTypes.Text.encode(__typed__.sourceAmount),
      localAmount: damlTypes.Numeric(0).encode(__typed__.localAmount),
      sourcePoolData: damlTypes.Text.encode(__typed__.sourcePoolData),
      messageId: damlTypes.Text.encode(__typed__.messageId),
      sourceChainSelector: damlTypes.Numeric(0).encode(__typed__.sourceChainSelector),
      finality: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig.encode(__typed__.finality),
      output: exports.TokenReceiveTicketClaimed_Output.encode(__typed__.output),
    };
  },
};

exports.TokenReceiveTicketClaimed_Output = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.oneOf(
      jtv.object({
        tag: jtv.constant("TokenReceiveTicketClaimed_Pending"),
        value: exports.TokenReceiveTicketClaimed_Output.TokenReceiveTicketClaimed_Pending.decoder,
      }),
      jtv.object({
        tag: jtv.constant("TokenReceiveTicketClaimed_Completed"),
        value: exports.TokenReceiveTicketClaimed_Output.TokenReceiveTicketClaimed_Completed.decoder,
      }),
    );
  }),
  encode: function (__typed__) {
    switch(__typed__.tag) {
      case 'TokenReceiveTicketClaimed_Pending': return {tag: __typed__.tag, value: exports.TokenReceiveTicketClaimed_Output.TokenReceiveTicketClaimed_Pending.encode(__typed__.value)};
      case 'TokenReceiveTicketClaimed_Completed': return {tag: __typed__.tag, value: exports.TokenReceiveTicketClaimed_Output.TokenReceiveTicketClaimed_Completed.encode(__typed__.value)};
      default: throw 'unrecognized type tag: ' + __typed__.tag + ' while serializing a value of type TokenReceiveTicketClaimed_Output';
    }
  },
  TokenReceiveTicketClaimed_Completed: {
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
  TokenReceiveTicketClaimed_Pending: {
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
