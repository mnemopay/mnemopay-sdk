/**
 * @mnemopay/sdk — identity module barrel.
 *
 * The Identity primitive is the native-shift cornerstone. Every other
 * primitive (Recall, FICO, Governance, MCP, Browser, Coding) will resolve
 * agents through a DID + Ed25519 wallet exported from this module.
 *
 * v1 surface:
 *
 *   import { mintDid, sign, verify, resolveDid, Wallet, exportBundle, importBundle }
 *     from "@mnemopay/sdk/identity";
 *
 * v1 deliberately keeps the registry in-process — future versions will
 * resolve DIDs over the network without changing this public API.
 */

export {
  mintDid,
  sign,
  verify,
  resolveDid,
  isDid,
  publicKeyMatchesDid,
  type Did,
  type DidDocument,
  type MintedDid,
} from "./did.js";

export {
  exportBundle,
  importBundle,
  canonicalize,
  hashPaymentHistory,
  type IdentityBundle,
  type IdentityBundlePayload,
  type ExportBundleOptions,
} from "./bundle.js";

export { Wallet, type WalletOptions, type WalletPersistMode } from "./wallet.js";

export {
  toAp2Credential,
  verifyAp2Credential,
  type Ap2Credential,
  type Ap2Context,
  type Ap2Type,
  type Ap2CredentialSubject,
  type Ap2SpendingMandate,
  type Ap2Governance,
  type Ap2VerifyError,
  type ToAp2Input,
  type VerifyResult,
} from "./ap2.js";
