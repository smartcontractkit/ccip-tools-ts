/**
 * applyChainUpdates — configures, enables and disables a token pool's remote lanes: the remote
 * token, the remote pool(s) allowed to bridge into it, and both directional rate limits.
 *
 * The one CCT pool write whose *parameters* changed shape mid-life, so it is discriminated on
 * {@link ApplyChainUpdatesParams.version} rather than version-transparent, and sectioned by version
 * so each shape's type, parser and encoder sit together.
 *
 * @packageDocumentation
 */

import type { Interface } from "ethers";

import type { EVMChain } from "../../../../evm/index.ts";
import type { UnsignedEVMTx } from "../../../../evm/types.ts";
import { CCTParamsInvalidError } from "../../../errors.ts";
import type { TransactionResult } from "../../../operation.ts";
import {
  type EVMExecuteParams,
  EVMOperation,
  callTx,
} from "../../operation.ts";
import {
  parseHexBytes,
  parseRecord,
  parseUniqueHexBytesArray,
  validateArray,
  validateBoolean,
  validateNonZeroAddress,
  validateUint64,
} from "../../validate.ts";
import {
  TokenPoolVersion,
  assertPoolOwner,
  getTokenPoolInterface,
  resolveEncoder,
  resolveTokenPool,
} from "../contracts.ts";
import {
  type ParsedRateLimitConfig,
  type RateLimitConfig,
  parseRateLimitConfig,
} from "../rate-limit.ts";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/**
 * The `version` discriminant of {@link ApplyChainUpdatesParams}: the two parameter shapes
 * `applyChainUpdates` has had, each spelled as the version that introduced it — so `1.5.1` is the
 * shape for every pool from v1.5.1 up, v1.6.1 and v2.0.0 included.
 */
export type ApplyChainUpdatesParamVersion =
  | typeof TokenPoolVersion.V1_5_0
  | typeof TokenPoolVersion.V1_5_1;

/** The lane fields both parameter shapes share, and which encode identically. */
type ChainUpdateCommon = {
  /** CCIP selector of the remote chain (`uint64`). */
  remoteChainSelector: bigint;
  /** Hex-encoded remote token address, `0x` prefix optional; must be non-empty whole bytes. */
  remoteTokenAddress: string;
  /** Rate limit for tokens received from the remote chain. */
  inboundRateLimiterConfig: RateLimitConfig;
  /** Rate limit for tokens sent to the remote chain. */
  outboundRateLimiterConfig: RateLimitConfig;
};

/** The top-level parameters both shapes share; each version adds its own lane arrays. */
type ApplyChainUpdatesBaseParams = {
  /** Token pool whose lanes are being configured. */
  poolAddress: string;
  /**
   * Pool owner; sets `tx.from` for offline / multisig signing. When supplied it is also
   * pre-flighted against the pool's on-chain `owner()`, so an unauthorized caller fails here
   * rather than as an opaque revert.
   */
  sender?: string;
};

/** A lane with its rate limits resolved — derived, so the parsed and public shapes cannot drift. */
type WithParsedRateLimits<T> = Omit<
  T,
  "inboundRateLimiterConfig" | "outboundRateLimiterConfig"
> & {
  inboundRateLimiterConfig: ParsedRateLimitConfig;
  outboundRateLimiterConfig: ParsedRateLimitConfig;
};

/**
 * Parses a lane's `remoteChainSelector`: a `uint64`, unique within its own array, and — for a lane
 * being *added* — non-zero. `seen` is mutated as each selector is accepted, and is per-array: the
 * same selector in both v1.5.1 arrays is the replace idiom.
 *
 * @remarks `requireNonZero` holds only for an addition, which `TokenPool.applyChainUpdates` does
 * not guard: `s_remoteChainSelectors.add(0)` succeeds, so the tx **mines as a success** and leaves
 * `getSupportedChains()` holding a lane nothing can route. A removal is how such a pool is
 * repaired, so `0n` stays legal there. Not a *known*-selector check, though — the registry lags new
 * chains, and rejecting a real-but-unrecognised selector is the worse failure.
 */
function parseLaneSelector(
  operation: string,
  param: string,
  selector: unknown,
  seen: Set<bigint>,
  requireNonZero: boolean,
): bigint {
  validateUint64(operation, param, selector);
  if (requireNonZero && selector === 0n) {
    throw new CCTParamsInvalidError(
      operation,
      param,
      "must not be zero: 0 is not a CCIP chain selector, and the pool would accept it as a permanently unroutable lane rather than reverting",
    );
  }
  if (seen.has(selector)) {
    throw new CCTParamsInvalidError(
      operation,
      param,
      `is a duplicate of an earlier entry in the same array (${selector}); each lane may appear only once`,
    );
  }
  seen.add(selector);
  return selector;
}

/** Parses the lane fields both shapes share. */
function parseLaneCommon(
  operation: string,
  path: string,
  update: { [k: string]: unknown },
  seen: Set<bigint>,
  requireNonZero: boolean,
): WithParsedRateLimits<ChainUpdateCommon> {
  return {
    remoteChainSelector: parseLaneSelector(
      operation,
      `${path}.remoteChainSelector`,
      update.remoteChainSelector,
      seen,
      requireNonZero,
    ),
    remoteTokenAddress: parseHexBytes(
      operation,
      `${path}.remoteTokenAddress`,
      update.remoteTokenAddress,
    ),
    inboundRateLimiterConfig: parseRateLimitConfig(
      operation,
      `${path}.inboundRateLimiterConfig`,
      update.inboundRateLimiterConfig,
      null,
    ),
    outboundRateLimiterConfig: parseRateLimitConfig(
      operation,
      `${path}.outboundRateLimiterConfig`,
      update.outboundRateLimiterConfig,
      null,
    ),
  };
}

// ---------------------------------------------------------------------------
// v1.5.0
// ---------------------------------------------------------------------------

/**
 * One lane's configuration on a **v1.5.0** pool.
 * @remarks Field-for-field the Solana `ChainUpdate` in
 * `cct/solana/token-pool/operations/apply-chain-updates.ts`, minus its Solana-only
 * `remoteTokenDecimals`.
 */
export type ChainUpdateV1_5_0 = ChainUpdateCommon & {
  /**
   * Whether the lane is enabled. **v1.5.0 only** — `false` removes the lane, which is how this
   * version spells v1.5.1+'s `remoteChainSelectorsToRemove`. Every other field is still required
   * and still encoded for a removal, and both rate limits must be `{ enabled: false }`: v1.5.0
   * validates them with `mustBeDisabled = !update.allowed` and reverts `RateLimitMustBeDisabled()`
   * otherwise, so passing a lane's current (enabled) limits back through is rejected.
   */
  allowed: boolean;
  /** Hex-encoded remote pool address, `0x` prefix optional. Singular at v1.5.0 — one pool per lane. */
  remotePoolAddress: string;
};

/** {@link ApplyChainUpdatesParamsV1_5_0} once parsed — derived, so the two cannot drift. */
type ParsedApplyChainUpdatesParamsV1_5_0 = Omit<
  ApplyChainUpdatesParamsV1_5_0,
  "chains"
> & {
  chains: WithParsedRateLimits<ChainUpdateV1_5_0>[];
};

/**
 * Parses the v1.5.0 `chains` array. See {@link ChainUpdateV1_5_0.allowed} for why a removal must
 * also carry both rate limits disabled.
 */
function parseChainsV1_5_0(operation: string, chains: unknown) {
  validateArray(operation, "chains", chains, 1);
  const seen = new Set<bigint>();
  return chains.map((entry, i) => {
    const path = `chains[${i}]`;
    const update = parseRecord(operation, path, entry, "chain update");
    const { allowed } = update;
    validateBoolean(operation, `${path}.allowed`, allowed);
    const lane = {
      ...parseLaneCommon(operation, path, update, seen, allowed),
      allowed,
      remotePoolAddress: parseHexBytes(
        operation,
        `${path}.remotePoolAddress`,
        update.remotePoolAddress,
      ),
    };
    const stillEnabled =
      !allowed &&
      (["inboundRateLimiterConfig", "outboundRateLimiterConfig"] as const).find(
        (direction) => lane[direction].enabled,
      );
    if (stillEnabled) {
      throw new CCTParamsInvalidError(
        operation,
        `${path}.${stillEnabled}`,
        "must be disabled when allowed is false: v1.5.0 validates both rate limits with mustBeDisabled = !allowed and reverts RateLimitMustBeDisabled — pass { enabled: false } for a removal",
      );
    }
    return lane;
  });
}

/** Encodes the v1.5.0 signature. */
const encodeV1_5_0 = (
  iface: Interface,
  params: ParsedApplyChainUpdatesParamsV1_5_0,
): UnsignedEVMTx =>
  callTx(
    params.poolAddress,
    iface.encodeFunctionData("applyChainUpdates", [
      params.chains.map((lane) => ({
        ...lane,
        // re-key the shared `enabled` to the ABI's `isEnabled`
        inboundRateLimiterConfig: (({
          enabled: isEnabled,
          capacity,
          rate,
        }) => ({
          isEnabled,
          capacity,
          rate,
        }))(lane.inboundRateLimiterConfig),
        outboundRateLimiterConfig: (({
          enabled: isEnabled,
          capacity,
          rate,
        }) => ({
          isEnabled,
          capacity,
          rate,
        }))(lane.outboundRateLimiterConfig),
      })),
    ]),
  );

// ---------------------------------------------------------------------------
// v1.5.1+
// ---------------------------------------------------------------------------

/**
 * One lane's configuration on a **v1.5.1+** pool. No `allowed` bit: removals are a separate array
 * on {@link ApplyChainUpdatesParams}.
 */
export type ChainUpdateV1_5_1 = ChainUpdateCommon & {
  /**
   * Hex-encoded remote pool addresses, `0x` prefix optional — plural, because a lane may accept
   * several remote pools, e.g. while migrating one. Non-empty, and unique within the lane
   * (compared as bytes, so `0xAB` and `ab` collide).
   */
  remotePoolAddresses: string[];
};

/** {@link ApplyChainUpdatesParamsV1_5_1} once parsed — derived, so the two cannot drift. */
type ParsedApplyChainUpdatesParamsV1_5_1 = Omit<
  ApplyChainUpdatesParamsV1_5_1,
  "chainsToAdd"
> & {
  chainsToAdd: WithParsedRateLimits<ChainUpdateV1_5_1>[];
};

/** Parses the v1.5.1+ pair of arrays: removals (applied first on-chain), then additions. */
function parseChainsV1_5_1(
  operation: string,
  chainsToAdd: unknown,
  remoteChainSelectorsToRemove: unknown,
) {
  validateArray(operation, "chainsToAdd", chainsToAdd);
  validateArray(
    operation,
    "remoteChainSelectorsToRemove",
    remoteChainSelectorsToRemove,
  );
  if (!chainsToAdd.length && !remoteChainSelectorsToRemove.length) {
    throw new CCTParamsInvalidError(
      operation,
      "chainsToAdd",
      "at least one of chainsToAdd or remoteChainSelectorsToRemove must be non-empty",
    );
  }

  const seenRemovals = new Set<bigint>();
  const removals = remoteChainSelectorsToRemove.map((selector, i) =>
    parseLaneSelector(
      operation,
      `remoteChainSelectorsToRemove[${i}]`,
      selector,
      seenRemovals,
      false,
    ),
  );

  const seenAdds = new Set<bigint>();
  const adds = chainsToAdd.map((entry, i) => {
    const path = `chainsToAdd[${i}]`;
    const update = parseRecord(operation, path, entry, "chain update");
    return {
      ...parseLaneCommon(operation, path, update, seenAdds, true),
      remotePoolAddresses: parseUniqueHexBytesArray(
        operation,
        `${path}.remotePoolAddresses`,
        update.remotePoolAddresses,
      ),
    };
  });
  return { chainsToAdd: adds, remoteChainSelectorsToRemove: removals };
}

/** Encodes the v1.5.1+ signature. */
const encodeV1_5_1 = (
  iface: Interface,
  params: ParsedApplyChainUpdatesParamsV1_5_1,
): UnsignedEVMTx =>
  callTx(
    params.poolAddress,
    iface.encodeFunctionData("applyChainUpdates", [
      params.remoteChainSelectorsToRemove,
      params.chainsToAdd.map((lane) => ({
        ...lane,
        // re-key the shared `enabled` to the ABI's `isEnabled`
        inboundRateLimiterConfig: (({
          enabled: isEnabled,
          capacity,
          rate,
        }) => ({
          isEnabled,
          capacity,
          rate,
        }))(lane.inboundRateLimiterConfig),
        outboundRateLimiterConfig: (({
          enabled: isEnabled,
          capacity,
          rate,
        }) => ({
          isEnabled,
          capacity,
          rate,
        }))(lane.outboundRateLimiterConfig),
      })),
    ]),
  );

/**
 * Parameters for {@link ApplyChainUpdates}, discriminated on `version` — the calldata shape you are
 * writing, not a free-form pool version; see {@link ApplyChainUpdatesParamVersion}.
 *
 * The two signatures have different selectors (`0xdb6327dc` vs `0xe8a1da17`), so
 * {@link ApplyChainUpdates.buildUnsigned} checks the declaration against the pool's own
 * `typeAndVersion`: a mismatch is a parameter error rather than a tx that reverts on an unknown
 * function.
 */
export type ApplyChainUpdatesParams =
  | ApplyChainUpdatesParamsV1_5_0
  | ApplyChainUpdatesParamsV1_5_1;

/** The **v1.5.0** parameter shape: a single `chains` array, each lane carrying its `allowed` bit. */
export type ApplyChainUpdatesParamsV1_5_0 = ApplyChainUpdatesBaseParams & {
  version: typeof TokenPoolVersion.V1_5_0;
  /**
   * Lanes to configure; `allowed: false` removes one. At least one entry, no holes, and a given
   * `remoteChainSelector` may appear only once.
   */
  chains: ChainUpdateV1_5_0[];
};

/** The **v1.5.1+** parameter shape: additions and removals as two arrays. */
export type ApplyChainUpdatesParamsV1_5_1 = ApplyChainUpdatesBaseParams & {
  version: typeof TokenPoolVersion.V1_5_1;
  /**
   * Lanes to add or reconfigure. To replace a lane's remote pools wholesale, list its selector
   * here *and* in `remoteChainSelectorsToRemove` — the contract applies removals first, so that
   * cross-array pairing stays legal. Within this array a selector may appear only once, and may
   * not be `0n`; holes are rejected too.
   */
  chainsToAdd: ChainUpdateV1_5_1[];
  /**
   * Lanes to remove, applied before `chainsToAdd`. No duplicates and no holes; `0n` *is* accepted
   * here, so a pool already holding a junk lane can be cleaned up.
   */
  remoteChainSelectorsToRemove: bigint[];
};

/**
 * {@link ApplyChainUpdatesParams} as {@link ApplyChainUpdates.parse} leaves it. The encoders add
 * no validation of their own — a parsed lane is already a `ChainUpdate` struct.
 */
type ParsedApplyChainUpdatesParams =
  | ParsedApplyChainUpdatesParamsV1_5_0
  | ParsedApplyChainUpdatesParamsV1_5_1;

/** Encodes parsed params into `applyChainUpdates` calldata, widened over the parsed union. */
type Encoder = (
  iface: Interface,
  params: ParsedApplyChainUpdatesParams,
) => UnsignedEVMTx;

/** One {@link ApplyChainUpdates.encoders} entry: the shape it accepts, and the encoder for it. */
type EncoderEntry = { shape: ApplyChainUpdatesParamVersion; encode: Encoder };

/**
 * Configures, enables and disables a token pool's remote lanes via `applyChainUpdates`.
 *
 * @remarks Owner-gated on-chain (`onlyOwner`). Supply `sender` to have that checked against the
 * pool's `owner()` before a tx is built; {@link ApplyChainUpdates.execute} defaults it to the
 * signing wallet, the only address a broadcast tx can satisfy it with.
 */
export class ApplyChainUpdates extends EVMOperation<
  ApplyChainUpdatesParams,
  ParsedApplyChainUpdatesParams
> {
  readonly name = "applyChainUpdates";

  /** Encoder per pool version, floor-matched; v1.6.1 and v2.0.0 inherit v1.5.1's. */
  private readonly encoders = {
    [TokenPoolVersion.V1_5_0]: {
      shape: TokenPoolVersion.V1_5_0,
      encode: encodeV1_5_0,
    },
    [TokenPoolVersion.V1_5_1]: {
      shape: TokenPoolVersion.V1_5_1,
      encode: encodeV1_5_1,
    },
  } as Partial<Record<TokenPoolVersion, EncoderEntry>>;

  /**
   * Validates the pool address and every lane entry before any RPC, *keeping* what each check
   * produced so neither {@link buildUnsigned} nor an encoder re-derives it. Only the
   * version-conditional rate bound is left to {@link assertRateBounds}.
   * @throws {@link CCTParamsInvalidError} if `version` is unknown, or any lane field is invalid
   */
  protected override parse(
    params: ApplyChainUpdatesParams,
  ): ParsedApplyChainUpdatesParams {
    validateNonZeroAddress(this.name, "poolAddress", params.poolAddress);
    const version: string = params.version;
    switch (params.version) {
      case TokenPoolVersion.V1_5_0:
        return {
          ...params,
          chains: parseChainsV1_5_0(this.name, params.chains),
        };
      case TokenPoolVersion.V1_5_1:
        return {
          ...params,
          ...parseChainsV1_5_1(
            this.name,
            params.chainsToAdd,
            params.remoteChainSelectorsToRemove,
          ),
        };
      default:
        throw new CCTParamsInvalidError(
          this.name,
          "version",
          `must be one of ${TokenPoolVersion.V1_5_0}, ${
            TokenPoolVersion.V1_5_1
          }, got ${String(version)}`,
        );
    }
  }

  /**
   * Applies the version-conditional rate bound, which needs the version `resolveTokenPool` has
   * just reported, via the shared {@link parseRateLimitConfig}.
   */
  private assertRateBounds(
    params: ParsedApplyChainUpdatesParams,
    version: TokenPoolVersion,
  ): void {
    const lanes =
      params.version === TokenPoolVersion.V1_5_0
        ? params.chains.map((lane, i) => [`chains[${i}]`, lane] as const)
        : params.chainsToAdd.map(
            (lane, i) => [`chainsToAdd[${i}]`, lane] as const,
          );

    for (const [path, lane] of lanes) {
      for (const direction of [
        "inboundRateLimiterConfig",
        "outboundRateLimiterConfig",
      ] as const) {
        // already parsed to the shared `enabled` shape; re-running with the resolved version
        // applies the version-conditional bound
        parseRateLimitConfig(
          this.name,
          `${path}.${direction}`,
          lane[direction],
          version,
        );
      }
    }
  }

  /**
   * Resolves the pool's type and version, applies the checks that needed it, then encodes.
   * @throws {@link CCTParamsInvalidError} if the declared `version` is not this pool's shape, a
   * rate limit breaks its enabled-bucket bound, or `sender` is not the pool owner
   * @throws {@link CCTContractTypeInvalidError} if the address is not a supported pool type
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: ParsedApplyChainUpdatesParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version } = await resolveTokenPool(chain, params.poolAddress);

    const { shape, encode } = resolveEncoder(this.encoders, version, this.name);
    if (params.version !== shape)
      throw new CCTParamsInvalidError(
        this.name,
        "version",
        `must be '${shape}' for this pool, which reports v${version} — the two signatures have different selectors, so the declared shape would not exist on-chain`,
      );

    this.assertRateBounds(params, version);

    if (params.sender !== undefined)
      await assertPoolOwner(
        this.name,
        chain,
        params.poolAddress,
        params.sender,
      );

    return encode(getTokenPoolInterface(type, version), params);
  }

  /**
   * Signs and submits as the pool owner, defaulting `sender` to the signing wallet — the only
   * address the contract's `onlyOwner` check can pass. See
   * {@link EVMOperation.resolveWalletSender} for why a divergent `sender` is rejected.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<ApplyChainUpdatesParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender);
    return super.execute(chain, { ...params, sender });
  }
}
