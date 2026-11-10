// Generated from ../../../CCIP/CodecV2/Uint256/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

export declare type LocalAmountConversionResult = {
  localAmount: damlTypes.Numeric,
  truncatedRemainder: string,
  wasTruncated: boolean,
}

export declare const LocalAmountConversionResult:
  damlTypes.Serializable<LocalAmountConversionResult>
