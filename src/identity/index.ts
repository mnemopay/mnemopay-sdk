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

export {
  ERC8004_PROTOCOL,
  ERC8004_REGISTRATION_TYPE,
  ERC8004_SPEC_VERSION,
  isBytes32Hex,
  normalizeBytes32Hex,
  toErc8004Attestation,
  toErc8004FeedbackAttestation,
  toErc8004IdentityRegistration,
  toErc8004RegistrationFile,
  toErc8004ValidationRequest,
  toErc8004ValidationResponse,
  verifyErc8004Attestation,
  verifyErc8004FeedbackAttestation,
  verifyErc8004IdentityRegistration,
  verifyErc8004ValidationRequest,
  verifyErc8004ValidationResponse,
  type Bytes32Hex,
  type Erc8004A2aContext,
  type Erc8004AgentId,
  type Erc8004Attestation,
  type Erc8004FeedbackAttestation,
  type Erc8004McpContext,
  type Erc8004OasfContext,
  type Erc8004OnChainRegistration,
  type Erc8004PaymentProof,
  type Erc8004Protocol,
  type Erc8004Proof,
  type Erc8004RegistrationFile,
  type Erc8004Service,
  type Erc8004SpecVersion,
  type Erc8004TrustModel,
  type Erc8004ValidationRequest,
  type Erc8004ValidationResponse,
  type Erc8004ValidationResponseVerifyOptions,
  type Erc8004VerifyError,
  type Erc8004VerifyOptions,
  type Erc8004VerifyResult,
  type ToErc8004FeedbackAttestationInput,
  type ToErc8004IdentityRegistrationInput,
  type ToErc8004RegistrationFileInput,
  type ToErc8004ValidationRequestInput,
  type ToErc8004ValidationResponseInput,
} from "./erc8004.js";

export {
  base58btcEncode,
  base58btcDecode,
  multibaseBase58btcEncode,
  multibaseBase58btcDecode,
} from "./multibase.js";
