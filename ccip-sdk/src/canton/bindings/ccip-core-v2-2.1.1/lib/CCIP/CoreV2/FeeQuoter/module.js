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
var pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4 = require('@daml.js/daml-prim-DA-Types-1.0.0');
var pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240 = require('@daml.js/mcms-api-1.0.0');
var pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b = require('@daml.js/splice-api-token-holding-v1-1.0.0');
var pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 = require('@daml.js/ccip-api-v2-2.0.0');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkgc3bb0c5d04799b3f11bad7c3c102963e115cf53da3e4afcbcfd9f06ebd82b4ff = require('@daml.js/daml-stdlib-DA-Set-Types-1.0.0');

var CCIP_CoreV2_FeeQuoterTypes = require('../../../CCIP/CoreV2/FeeQuoterTypes/module');

exports.AddPriceUpdaters = {
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

exports.ApplyFeeQuoterDestChainConfigUpdates = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destChainConfigArgs: damlTypes.List(CCIP_CoreV2_FeeQuoterTypes.FeeQuoterDestChainConfigArgs).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destChainConfigArgs: damlTypes.List(CCIP_CoreV2_FeeQuoterTypes.FeeQuoterDestChainConfigArgs).encode(__typed__.destChainConfigArgs),
    };
  },
};

exports.ApplyPriceUpdatersUpdate = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      addedPriceUpdaters: damlTypes.List(damlTypes.Party).decoder,
      removedPriceUpdaters: damlTypes.List(damlTypes.Party).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      addedPriceUpdaters: damlTypes.List(damlTypes.Party).encode(__typed__.addedPriceUpdaters),
      removedPriceUpdaters: damlTypes.List(damlTypes.Party).encode(__typed__.removedPriceUpdaters),
    };
  },
};

exports.FeeQuoter = damlTypes.assembleTemplate(
  {
    templateId: '#ccip-core-v2:CCIP.CoreV2.FeeQuoter:FeeQuoter',
    templateIdWithPackageId: '#35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3:CCIP.CoreV2.FeeQuoter:FeeQuoter',
    keyDecoder: jtv.constant(undefined),
    keyEncode: function () { throw 'EncodeError'; },
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        instanceId: damlTypes.Text.decoder,
        ccipOwner: damlTypes.Party.decoder,
        feeTokens: pkgc3bb0c5d04799b3f11bad7c3c102963e115cf53da3e4afcbcfd9f06ebd82b4ff.DA.Set.Types.Set(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId).decoder,
        destChainConfigs: damlTypes.Map(damlTypes.Numeric(0), CCIP_CoreV2_FeeQuoterTypes.FeeQuoterDestChainConfig).decoder,
        tokenTransferFeeConfigs: damlTypes.Map(damlTypes.Numeric(0), damlTypes.Map(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId, exports.TokenTransferFeeConfig)).decoder,
        usdPerUnitGasByDestChainSelector: damlTypes.Map(damlTypes.Numeric(0), exports.TimestampedPrice).decoder,
        usdPerToken: damlTypes.Map(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId, exports.TimestampedPrice).decoder,
        linkTokenInstrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
        priceUpdaters: damlTypes.List(damlTypes.Party).decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        instanceId: damlTypes.Text.encode(__typed__.instanceId),
        ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
        feeTokens: pkgc3bb0c5d04799b3f11bad7c3c102963e115cf53da3e4afcbcfd9f06ebd82b4ff.DA.Set.Types.Set(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId).encode(__typed__.feeTokens),
        destChainConfigs: damlTypes.Map(damlTypes.Numeric(0), CCIP_CoreV2_FeeQuoterTypes.FeeQuoterDestChainConfig).encode(__typed__.destChainConfigs),
        tokenTransferFeeConfigs: damlTypes.Map(damlTypes.Numeric(0), damlTypes.Map(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId, exports.TokenTransferFeeConfig)).encode(__typed__.tokenTransferFeeConfigs),
        usdPerUnitGasByDestChainSelector: damlTypes.Map(damlTypes.Numeric(0), exports.TimestampedPrice).encode(__typed__.usdPerUnitGasByDestChainSelector),
        usdPerToken: damlTypes.Map(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId, exports.TimestampedPrice).encode(__typed__.usdPerToken),
        linkTokenInstrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.linkTokenInstrumentId),
        priceUpdaters: damlTypes.List(damlTypes.Party).encode(__typed__.priceUpdaters),
      };
    },
    AddPriceUpdaters: {
      template: function () { return exports.FeeQuoter; },
      choiceName: 'AddPriceUpdaters',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.AddPriceUpdaters.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.AddPriceUpdaters.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.FeeQuoter).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.FeeQuoter).encode(__typed__); },
    },
    ApplyFeeQuoterDestChainConfigUpdates: {
      template: function () { return exports.FeeQuoter; },
      choiceName: 'ApplyFeeQuoterDestChainConfigUpdates',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.ApplyFeeQuoterDestChainConfigUpdates.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.ApplyFeeQuoterDestChainConfigUpdates.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.FeeQuoter).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.FeeQuoter).encode(__typed__); },
    },
    ApplyPriceUpdatersUpdate: {
      template: function () { return exports.FeeQuoter; },
      choiceName: 'ApplyPriceUpdatersUpdate',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.ApplyPriceUpdatersUpdate.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.ApplyPriceUpdatersUpdate.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.FeeQuoter).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.FeeQuoter).encode(__typed__); },
    },
    Archive: {
      template: function () { return exports.FeeQuoter; },
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
    Get: {
      template: function () { return exports.FeeQuoter; },
      choiceName: 'Get',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.Get.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.Get.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.FeeQuoter.decoder;
      }),
      resultEncode: function (__typed__) { return exports.FeeQuoter.encode(__typed__); },
    },
    GetDestChainConfig: {
      template: function () { return exports.FeeQuoter; },
      choiceName: 'GetDestChainConfig',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GetDestChainConfig.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GetDestChainConfig.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return CCIP_CoreV2_FeeQuoterTypes.FeeQuoterDestChainConfig.decoder;
      }),
      resultEncode: function (__typed__) { return CCIP_CoreV2_FeeQuoterTypes.FeeQuoterDestChainConfig.encode(__typed__); },
    },
    GetDestinationChainGasPrice: {
      template: function () { return exports.FeeQuoter; },
      choiceName: 'GetDestinationChainGasPrice',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GetDestinationChainGasPrice.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GetDestinationChainGasPrice.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.TimestampedPrice.decoder;
      }),
      resultEncode: function (__typed__) { return exports.TimestampedPrice.encode(__typed__); },
    },
    GetFeeTokens: {
      template: function () { return exports.FeeQuoter; },
      choiceName: 'GetFeeTokens',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GetFeeTokens.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GetFeeTokens.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.List(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.List(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId).encode(__typed__); },
    },
    GetTokenPrice: {
      template: function () { return exports.FeeQuoter; },
      choiceName: 'GetTokenPrice',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GetTokenPrice.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GetTokenPrice.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.TimestampedPrice.decoder;
      }),
      resultEncode: function (__typed__) { return exports.TimestampedPrice.encode(__typed__); },
    },
    GetTokenTransferFee: {
      template: function () { return exports.FeeQuoter; },
      choiceName: 'GetTokenTransferFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GetTokenTransferFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GetTokenTransferFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple3(damlTypes.Numeric(0), damlTypes.Int, damlTypes.Int).decoder;
      }),
      resultEncode: function (__typed__) { return pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple3(damlTypes.Numeric(0), damlTypes.Int, damlTypes.Int).encode(__typed__); },
    },
    QuoteGasForExec: {
      template: function () { return exports.FeeQuoter; },
      choiceName: 'QuoteGasForExec',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.QuoteGasForExec.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.QuoteGasForExec.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.QuoteGasForExecResult.decoder;
      }),
      resultEncode: function (__typed__) { return exports.QuoteGasForExecResult.encode(__typed__); },
    },
    RemoveFeeTokens: {
      template: function () { return exports.FeeQuoter; },
      choiceName: 'RemoveFeeTokens',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.RemoveFeeTokens.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.RemoveFeeTokens.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.FeeQuoter).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.FeeQuoter).encode(__typed__); },
    },
    RemovePriceUpdaters: {
      template: function () { return exports.FeeQuoter; },
      choiceName: 'RemovePriceUpdaters',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.RemovePriceUpdaters.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.RemovePriceUpdaters.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.FeeQuoter).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.FeeQuoter).encode(__typed__); },
    },
    UpdatePrices: {
      template: function () { return exports.FeeQuoter; },
      choiceName: 'UpdatePrices',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.UpdatePrices.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.UpdatePrices.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.FeeQuoter).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.FeeQuoter).encode(__typed__); },
    },
  },
  pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.FeeQuoter.IFeeQuoter,
  pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240.MCMS.MCMSReceiver.MCMSReceiver,
);

damlTypes.registerTemplate(exports.FeeQuoter, ['35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3', '#ccip-core-v2']);

exports.Get = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.GetDestChainConfig = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destChainSelector: damlTypes.Numeric(0).decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.GetDestinationChainGasPrice = {
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

exports.GetFeeTokens = {
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

exports.GetTokenPrice = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      token: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      token: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.token),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.GetTokenTransferFee = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destChainSelector: damlTypes.Numeric(0).decoder,
      token: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      token: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.token),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.QuoteGasForExec = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destChainSelector: damlTypes.Numeric(0).decoder,
      nonCalldataGas: damlTypes.Int.decoder,
      calldataSize: damlTypes.Int.decoder,
      feeToken: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      nonCalldataGas: damlTypes.Int.encode(__typed__.nonCalldataGas),
      calldataSize: damlTypes.Int.encode(__typed__.calldataSize),
      feeToken: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.feeToken),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.QuoteGasForExecResult = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      totalGas: damlTypes.Int.decoder,
      gasCostUSDCents: damlTypes.Numeric(0).decoder,
      feeTokenPrice: damlTypes.Numeric(10).decoder,
      premiumMultiplier: damlTypes.Numeric(10).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      totalGas: damlTypes.Int.encode(__typed__.totalGas),
      gasCostUSDCents: damlTypes.Numeric(0).encode(__typed__.gasCostUSDCents),
      feeTokenPrice: damlTypes.Numeric(10).encode(__typed__.feeTokenPrice),
      premiumMultiplier: damlTypes.Numeric(10).encode(__typed__.premiumMultiplier),
    };
  },
};

exports.RemoveFeeTokens = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      feeTokensToRemove: damlTypes.List(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      feeTokensToRemove: damlTypes.List(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId).encode(__typed__.feeTokensToRemove),
    };
  },
};

exports.RemovePriceUpdaters = {
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

exports.TimestampedPrice = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      price: damlTypes.Numeric(10).decoder,
      timestamp: damlTypes.Time.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      price: damlTypes.Numeric(10).encode(__typed__.price),
      timestamp: damlTypes.Time.encode(__typed__.timestamp),
    };
  },
};

exports.TokenTransferFeeConfig = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      isEnabled: damlTypes.Bool.decoder,
      feeUSD: damlTypes.Numeric(0).decoder,
      destGasOverhead: damlTypes.Int.decoder,
      destBytesOverhead: damlTypes.Int.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      isEnabled: damlTypes.Bool.encode(__typed__.isEnabled),
      feeUSD: damlTypes.Numeric(0).encode(__typed__.feeUSD),
      destGasOverhead: damlTypes.Int.encode(__typed__.destGasOverhead),
      destBytesOverhead: damlTypes.Int.encode(__typed__.destBytesOverhead),
    };
  },
};

exports.UpdatePrices = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      priceUpdates: CCIP_CoreV2_FeeQuoterTypes.PriceUpdates.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      priceUpdates: CCIP_CoreV2_FeeQuoterTypes.PriceUpdates.encode(__typed__.priceUpdates),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};
