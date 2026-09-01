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

var pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4 = require('@daml.js/ccip-extension-api-v2-2.0.0');
var pkg35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3 = require('@daml.js/ccip-core-v2-2.1.1');
var pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f = require('@daml.js/splice-api-token-metadata-v1-1.0.0');
var pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240 = require('@daml.js/mcms-api-1.0.0');
var pkg6856206c569bf6c13704eb5cd3fedecb64245fce1af80898b4ddf6580f51fa92 = require('@daml.js/ccip-registry-rate-limiter-v2-2.0.1');
var pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb = require('@daml.js/ccip-codec-v2-2.0.0');
var pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b = require('@daml.js/splice-api-token-holding-v1-1.0.0');
var pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 = require('@daml.js/ccip-api-v2-2.0.0');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 = require('@daml.js/chainlink-api-2.0.0');

var CCIP_Registry_BurnMintTokenPoolV2Types = require('../../../CCIP/Registry/BurnMintTokenPoolV2Types/module');

exports.AddPoolReceiveContextContractValue = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      contextKey: damlTypes.Text.decoder,
      referredContract: damlTypes.ContractId(damlTypes.Unit).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      contextKey: damlTypes.Text.encode(__typed__.contextKey),
      referredContract: damlTypes.ContractId(damlTypes.Unit).encode(__typed__.referredContract),
    };
  },
};

exports.AddPoolReceiveContextNonContractValue = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      contextKey: damlTypes.Text.decoder,
      value: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.AnyValue.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      contextKey: damlTypes.Text.encode(__typed__.contextKey),
      value: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.AnyValue.encode(__typed__.value),
    };
  },
};

exports.ApplyChainUpdates = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      remoteChainSelectorsToRemove: damlTypes.List(damlTypes.Numeric(0)).decoder,
      chainsToAdd: damlTypes.List(CCIP_Registry_BurnMintTokenPoolV2Types.ChainUpdate).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      remoteChainSelectorsToRemove: damlTypes.List(damlTypes.Numeric(0)).encode(__typed__.remoteChainSelectorsToRemove),
      chainsToAdd: damlTypes.List(CCIP_Registry_BurnMintTokenPoolV2Types.ChainUpdate).encode(__typed__.chainsToAdd),
    };
  },
};

exports.ApplyTokenTransferFeeConfigUpdates = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenTransferFeeConfigArgs: damlTypes.List(CCIP_Registry_BurnMintTokenPoolV2Types.TokenTransferFeeConfigArgs).decoder,
      disableTokenTransferFeeConfigArgs: damlTypes.List(damlTypes.Numeric(0)).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenTransferFeeConfigArgs: damlTypes.List(CCIP_Registry_BurnMintTokenPoolV2Types.TokenTransferFeeConfigArgs).encode(__typed__.tokenTransferFeeConfigArgs),
      disableTokenTransferFeeConfigArgs: damlTypes.List(damlTypes.Numeric(0)).encode(__typed__.disableTokenTransferFeeConfigArgs),
    };
  },
};

exports.BurnMintTokenPool = damlTypes.assembleTemplate(
  {
    templateId: '#ccip-registry-burn-mint-token-pool-v2:CCIP.Registry.BurnMintTokenPoolV2:BurnMintTokenPool',
    templateIdWithPackageId: '#35a93dc2c0d2b65ac5aeffc1ed4f45d72a649adce56919e0354ba75bc88fc170:CCIP.Registry.BurnMintTokenPoolV2:BurnMintTokenPool',
    keyDecoder: jtv.constant(undefined),
    keyEncode: function () { throw 'EncodeError'; },
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        instanceId: damlTypes.Text.decoder,
        poolOwner: damlTypes.Party.decoder,
        ccipOwner: damlTypes.Party.decoder,
        instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
        decimals: damlTypes.Int.decoder,
        rateLimitAdmin: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.Party).decoder),
        observers: damlTypes.List(damlTypes.Party).decoder,
        remoteChainConfigs: damlTypes.Map(damlTypes.Numeric(0), CCIP_Registry_BurnMintTokenPoolV2Types.RemoteChainConfig).decoder,
        tokenTransferFeeConfigs: damlTypes.Map(damlTypes.Numeric(0), CCIP_Registry_BurnMintTokenPoolV2Types.TokenTransferFeeConfig).decoder,
        poolReceiveContext: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
        transferTimeout: CCIP_Registry_BurnMintTokenPoolV2Types.TransferTimeout.decoder,
        deps: exports.BurnMintTokenPoolDeps.decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        instanceId: damlTypes.Text.encode(__typed__.instanceId),
        poolOwner: damlTypes.Party.encode(__typed__.poolOwner),
        ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
        instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
        decimals: damlTypes.Int.encode(__typed__.decimals),
        rateLimitAdmin: damlTypes.Optional(damlTypes.Party).encode(__typed__.rateLimitAdmin),
        observers: damlTypes.List(damlTypes.Party).encode(__typed__.observers),
        remoteChainConfigs: damlTypes.Map(damlTypes.Numeric(0), CCIP_Registry_BurnMintTokenPoolV2Types.RemoteChainConfig).encode(__typed__.remoteChainConfigs),
        tokenTransferFeeConfigs: damlTypes.Map(damlTypes.Numeric(0), CCIP_Registry_BurnMintTokenPoolV2Types.TokenTransferFeeConfig).encode(__typed__.tokenTransferFeeConfigs),
        poolReceiveContext: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.poolReceiveContext),
        transferTimeout: CCIP_Registry_BurnMintTokenPoolV2Types.TransferTimeout.encode(__typed__.transferTimeout),
        deps: exports.BurnMintTokenPoolDeps.encode(__typed__.deps),
      };
    },
    AddPoolReceiveContextContractValue: {
      template: function () { return exports.BurnMintTokenPool; },
      choiceName: 'AddPoolReceiveContextContractValue',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.AddPoolReceiveContextContractValue.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.AddPoolReceiveContextContractValue.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.BurnMintTokenPool).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.BurnMintTokenPool).encode(__typed__); },
    },
    AddPoolReceiveContextNonContractValue: {
      template: function () { return exports.BurnMintTokenPool; },
      choiceName: 'AddPoolReceiveContextNonContractValue',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.AddPoolReceiveContextNonContractValue.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.AddPoolReceiveContextNonContractValue.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.BurnMintTokenPool).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.BurnMintTokenPool).encode(__typed__); },
    },
    ApplyChainUpdates: {
      template: function () { return exports.BurnMintTokenPool; },
      choiceName: 'ApplyChainUpdates',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.ApplyChainUpdates.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.ApplyChainUpdates.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.BurnMintTokenPool).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.BurnMintTokenPool).encode(__typed__); },
    },
    ApplyTokenTransferFeeConfigUpdates: {
      template: function () { return exports.BurnMintTokenPool; },
      choiceName: 'ApplyTokenTransferFeeConfigUpdates',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.ApplyTokenTransferFeeConfigUpdates.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.ApplyTokenTransferFeeConfigUpdates.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.BurnMintTokenPool).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.BurnMintTokenPool).encode(__typed__); },
    },
    Archive: {
      template: function () { return exports.BurnMintTokenPool; },
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
    CalculateFee: {
      template: function () { return exports.BurnMintTokenPool; },
      choiceName: 'CalculateFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.CalculateFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.CalculateFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).encode(__typed__); },
    },
    ClearPoolReceiveContext: {
      template: function () { return exports.BurnMintTokenPool; },
      choiceName: 'ClearPoolReceiveContext',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.ClearPoolReceiveContext.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.ClearPoolReceiveContext.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.BurnMintTokenPool).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.BurnMintTokenPool).encode(__typed__); },
    },
    GetFee: {
      template: function () { return exports.BurnMintTokenPool; },
      choiceName: 'GetFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GetFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GetFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.TokenPoolFeeQuote.decoder;
      }),
      resultEncode: function (__typed__) { return pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.TokenPoolFeeQuote.encode(__typed__); },
    },
    GetRequiredCCVs: {
      template: function () { return exports.BurnMintTokenPool; },
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
    Initialize: {
      template: function () { return exports.BurnMintTokenPool; },
      choiceName: 'Initialize',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.Initialize.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.Initialize.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.InitializeResult.decoder;
      }),
      resultEncode: function (__typed__) { return exports.InitializeResult.encode(__typed__); },
    },
    LockOrBurn: {
      template: function () { return exports.BurnMintTokenPool; },
      choiceName: 'LockOrBurn',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.LockOrBurn.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.LockOrBurn.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.LockOrBurnResult.decoder;
      }),
      resultEncode: function (__typed__) { return pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.LockOrBurnResult.encode(__typed__); },
    },
    ReleaseFromTicket: {
      template: function () { return exports.BurnMintTokenPool; },
      choiceName: 'ReleaseFromTicket',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.ReleaseFromTicket.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.ReleaseFromTicket.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.ReleaseOrMintResult.decoder;
      }),
      resultEncode: function (__typed__) { return pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.ReleaseOrMintResult.encode(__typed__); },
    },
    RemovePoolReceiveContextValue: {
      template: function () { return exports.BurnMintTokenPool; },
      choiceName: 'RemovePoolReceiveContextValue',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.RemovePoolReceiveContextValue.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.RemovePoolReceiveContextValue.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.BurnMintTokenPool).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.BurnMintTokenPool).encode(__typed__); },
    },
    SetDynamicConfig: {
      template: function () { return exports.BurnMintTokenPool; },
      choiceName: 'SetDynamicConfig',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.SetDynamicConfig.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.SetDynamicConfig.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.BurnMintTokenPool).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.BurnMintTokenPool).encode(__typed__); },
    },
    SetObservers: {
      template: function () { return exports.BurnMintTokenPool; },
      choiceName: 'SetObservers',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.SetObservers.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.SetObservers.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.BurnMintTokenPool).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.BurnMintTokenPool).encode(__typed__); },
    },
    SetRateLimitConfig: {
      template: function () { return exports.BurnMintTokenPool; },
      choiceName: 'SetRateLimitConfig',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.SetRateLimitConfig.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.SetRateLimitConfig.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(pkg6856206c569bf6c13704eb5cd3fedecb64245fce1af80898b4ddf6580f51fa92.CCIP.Registry.RateLimiterV2.RateLimiter).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(pkg6856206c569bf6c13704eb5cd3fedecb64245fce1af80898b4ddf6580f51fa92.CCIP.Registry.RateLimiterV2.RateLimiter).encode(__typed__); },
    },
    SetRateLimiterReferences: {
      template: function () { return exports.BurnMintTokenPool; },
      choiceName: 'SetRateLimiterReferences',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.SetRateLimiterReferences.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.SetRateLimiterReferences.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.BurnMintTokenPool).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.BurnMintTokenPool).encode(__typed__); },
    },
    SetTransferTimeout: {
      template: function () { return exports.BurnMintTokenPool; },
      choiceName: 'SetTransferTimeout',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.SetTransferTimeout.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.SetTransferTimeout.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.BurnMintTokenPool).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.BurnMintTokenPool).encode(__typed__); },
    },
    VerifyInboundMessage: {
      template: function () { return exports.BurnMintTokenPool; },
      choiceName: 'VerifyInboundMessage',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.VerifyInboundMessage.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.VerifyInboundMessage.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage).encode(__typed__); },
    },
    VerifyOutboundCCVs: {
      template: function () { return exports.BurnMintTokenPool; },
      choiceName: 'VerifyOutboundCCVs',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.VerifyOutboundCCVs.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.VerifyOutboundCCVs.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage).encode(__typed__); },
    },
  },
  pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.ITokenPool,
  pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240.MCMS.MCMSReceiver.MCMSReceiver,
);

damlTypes.registerTemplate(exports.BurnMintTokenPool, ['35a93dc2c0d2b65ac5aeffc1ed4f45d72a649adce56919e0354ba75bc88fc170', '#ccip-registry-burn-mint-token-pool-v2']);

exports.BurnMintTokenPoolDeps = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenAdminRegistry: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      rmnRemote: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      feeQuoter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenAdminRegistry: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.tokenAdminRegistry),
      rmnRemote: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.rmnRemote),
      feeQuoter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.feeQuoter),
    };
  },
};

exports.CalculateFee = {
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

exports.ClearPoolReceiveContext = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
    });
  }),
  encode: function (__typed__) {
    return {};
  },
};

exports.GetFee = {
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

exports.GetRequiredCCVs = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      remoteChainSelector: damlTypes.Numeric(0).decoder,
      sourceAmount: damlTypes.Text.decoder,
      finality: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig.decoder,
      extraData: damlTypes.Text.decoder,
      direction: pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.TransferDirection.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      remoteChainSelector: damlTypes.Numeric(0).encode(__typed__.remoteChainSelector),
      sourceAmount: damlTypes.Text.encode(__typed__.sourceAmount),
      finality: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig.encode(__typed__.finality),
      extraData: damlTypes.Text.encode(__typed__.extraData),
      direction: pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.TransferDirection.encode(__typed__.direction),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.Initialize = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenAdminRegistryCid: damlTypes.ContractId(pkg35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3.CCIP.CoreV2.TokenAdminRegistry.TokenAdminRegistry).decoder,
      existingTokenConfigCid: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkg35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3.CCIP.CoreV2.TokenAdminRegistry.TokenConfig)).decoder),
      admin: damlTypes.Party.decoder,
      lanes: damlTypes.List(CCIP_Registry_BurnMintTokenPoolV2Types.LaneDeploySpec).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenAdminRegistryCid: damlTypes.ContractId(pkg35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3.CCIP.CoreV2.TokenAdminRegistry.TokenAdminRegistry).encode(__typed__.tokenAdminRegistryCid),
      existingTokenConfigCid: damlTypes.Optional(damlTypes.ContractId(pkg35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3.CCIP.CoreV2.TokenAdminRegistry.TokenConfig)).encode(__typed__.existingTokenConfigCid),
      admin: damlTypes.Party.encode(__typed__.admin),
      lanes: damlTypes.List(CCIP_Registry_BurnMintTokenPoolV2Types.LaneDeploySpec).encode(__typed__.lanes),
    };
  },
};

exports.InitializeResult = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      rateLimiterCids: damlTypes.List(damlTypes.ContractId(pkg6856206c569bf6c13704eb5cd3fedecb64245fce1af80898b4ddf6580f51fa92.CCIP.Registry.RateLimiterV2.RateLimiter)).decoder,
      tokenConfigCid: damlTypes.ContractId(pkg35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3.CCIP.CoreV2.TokenAdminRegistry.TokenConfig).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      rateLimiterCids: damlTypes.List(damlTypes.ContractId(pkg6856206c569bf6c13704eb5cd3fedecb64245fce1af80898b4ddf6580f51fa92.CCIP.Registry.RateLimiterV2.RateLimiter)).encode(__typed__.rateLimiterCids),
      tokenConfigCid: damlTypes.ContractId(pkg35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3.CCIP.CoreV2.TokenAdminRegistry.TokenConfig).encode(__typed__.tokenConfigCid),
    };
  },
};

exports.LockOrBurn = {
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

exports.ReleaseFromTicket = {
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

exports.RemovePoolReceiveContextValue = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      contextKey: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      contextKey: damlTypes.Text.encode(__typed__.contextKey),
    };
  },
};

exports.SetDynamicConfig = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      rateLimitAdmin: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.Party).decoder),
    });
  }),
  encode: function (__typed__) {
    return {
      rateLimitAdmin: damlTypes.Optional(damlTypes.Party).encode(__typed__.rateLimitAdmin),
    };
  },
};

exports.SetObservers = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      observers: damlTypes.List(damlTypes.Party).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      observers: damlTypes.List(damlTypes.Party).encode(__typed__.observers),
    };
  },
};

exports.SetRateLimitConfig = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      caller: damlTypes.Party.decoder,
      rateLimiterCid: damlTypes.ContractId(pkg6856206c569bf6c13704eb5cd3fedecb64245fce1af80898b4ddf6580f51fa92.CCIP.Registry.RateLimiterV2.RateLimiter).decoder,
      newIsEnabled: damlTypes.Bool.decoder,
      newCapacity: damlTypes.Numeric(0).decoder,
      newRate: damlTypes.Numeric(0).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      caller: damlTypes.Party.encode(__typed__.caller),
      rateLimiterCid: damlTypes.ContractId(pkg6856206c569bf6c13704eb5cd3fedecb64245fce1af80898b4ddf6580f51fa92.CCIP.Registry.RateLimiterV2.RateLimiter).encode(__typed__.rateLimiterCid),
      newIsEnabled: damlTypes.Bool.encode(__typed__.newIsEnabled),
      newCapacity: damlTypes.Numeric(0).encode(__typed__.newCapacity),
      newRate: damlTypes.Numeric(0).encode(__typed__.newRate),
    };
  },
};

exports.SetRateLimiterReferences = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      rateLimitConfigArgs: damlTypes.List(CCIP_Registry_BurnMintTokenPoolV2Types.RateLimitConfigArgs).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      rateLimitConfigArgs: damlTypes.List(CCIP_Registry_BurnMintTokenPoolV2Types.RateLimitConfigArgs).encode(__typed__.rateLimitConfigArgs),
    };
  },
};

exports.SetTransferTimeout = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      newTransferTimeout: CCIP_Registry_BurnMintTokenPoolV2Types.TransferTimeout.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      newTransferTimeout: CCIP_Registry_BurnMintTokenPoolV2Types.TransferTimeout.encode(__typed__.newTransferTimeout),
    };
  },
};

exports.VerifyInboundMessage = {
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

exports.VerifyOutboundCCVs = {
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
