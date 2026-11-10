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

exports.LocalAmountConversionResult = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      localAmount: damlTypes.Numeric(0).decoder,
      truncatedRemainder: damlTypes.Text.decoder,
      wasTruncated: damlTypes.Bool.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      localAmount: damlTypes.Numeric(0).encode(__typed__.localAmount),
      truncatedRemainder: damlTypes.Text.encode(__typed__.truncatedRemainder),
      wasTruncated: damlTypes.Bool.encode(__typed__.wasTruncated),
    };
  },
};
