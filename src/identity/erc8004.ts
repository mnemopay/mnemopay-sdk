/**
 * ERC-8004 (Trustless Agents) identity adapter.
 *
 * ERC-8004 is currently a draft. This module mirrors the draft's three
 * registry surfaces without performing chain I/O:
 *
 *   - Identity Registry: signed agent registration files.
 *   - Reputation Registry: signed feedback / attestation signals.
 *   - Validation Registry: signed validation requests and responses.
 *
 * The wire objects use MnemoPay's existing did:mp Ed25519 keys and the same
 * canonical JSON + Multibase proof style used by the AP2 adapter. That keeps
 * the adapter dependency-free while giving callers stable objects they can
 * store off-chain, pin to IPFS, or map into ERC-8004 contract calls.
 */

import {
  isDid,
  publicKeyMatchesDid,
  resolveDid,
  sign as didSign,
  verify as didVerify,
  type Did,
} from "./did.js";
import { canonicalize } from "./bundle.js";
import {
  multibaseBase58btcDecode,
  multibaseBase58btcEncode,
} from "./multibase.js";

export const ERC8004_PROTOCOL = "erc-8004" as const;
export const ERC8004_SPEC_VERSION = "draft-2025-08-13" as const;
export const ERC8004_REGISTRATION_TYPE =
  "https://eips.ethereum.org/EIPS/eip-8004#registration-v1" as const;

export type Erc8004Protocol = typeof ERC8004_PROTOCOL;
export type Erc8004SpecVersion = typeof ERC8004_SPEC_VERSION;
export type Bytes32Hex = `0x${string}`;
export type Erc8004AgentId = number | string;
export type Erc8004TrustModel =
  | "reputation"
  | "crypto-economic"
  | "tee-attestation"
  | string;

export interface Erc8004Service {
  name: string;
  endpoint: string;
  version?: string;
  skills?: string[];
  domains?: string[];
  [key: string]: unknown;
}

export interface Erc8004OnChainRegistration {
  agentId: Erc8004AgentId;
  agentRegistry: string;
}

export interface Erc8004RegistrationFile {
  type: typeof ERC8004_REGISTRATION_TYPE;
  name: string;
  description: string;
  image: string;
  services: Erc8004Service[];
  x402Support: boolean;
  active: boolean;
  registrations: Erc8004OnChainRegistration[];
  supportedTrust?: Erc8004TrustModel[];
  [key: string]: unknown;
}

export interface Erc8004Proof {
  type: "Ed25519Signature2020";
  created: string;
  verificationMethod: `${Did}#keys-1`;
  proofPurpose: "assertionMethod";
  proofValue: string;
}

export interface Erc8004IdentityRegistration {
  protocol: Erc8004Protocol;
  specVersion: Erc8004SpecVersion;
  type: "identity.registration";
  issuer: {
    id: Did;
  };
  issuedAt: string;
  expirationDate?: string;
  subject: {
    id: Did;
    publicKey: string;
    registration: Erc8004RegistrationFile;
  };
  proof: Erc8004Proof;
}

export interface Erc8004McpContext {
  tool?: string;
  prompt?: string;
  resource?: string;
  [key: string]: unknown;
}

export interface Erc8004A2aContext {
  skills?: string[];
  contextId?: string;
  taskId?: string;
  [key: string]: unknown;
}

export interface Erc8004OasfContext {
  skills?: string[];
  domains?: string[];
  [key: string]: unknown;
}

export interface Erc8004PaymentProof {
  fromAddress?: string;
  toAddress?: string;
  chainId?: string;
  txHash?: string;
  [key: string]: unknown;
}

export interface Erc8004FeedbackAttestation {
  protocol: Erc8004Protocol;
  specVersion: Erc8004SpecVersion;
  type: "reputation.feedback";
  issuer: {
    id: Did;
  };
  agentRegistry: string;
  agentId: Erc8004AgentId;
  subjectDid?: Did;
  clientAddress?: string;
  createdAt: string;
  value: number | string;
  valueDecimals: number;
  tag1?: string;
  tag2?: string;
  endpoint?: string;
  feedbackURI?: string;
  feedbackHash?: Bytes32Hex;
  mcp?: Erc8004McpContext;
  a2a?: Erc8004A2aContext;
  oasf?: Erc8004OasfContext;
  proofOfPayment?: Erc8004PaymentProof;
  proof: Erc8004Proof;
}

export type Erc8004Attestation = Erc8004FeedbackAttestation;

export interface Erc8004ValidationRequest {
  protocol: Erc8004Protocol;
  specVersion: Erc8004SpecVersion;
  type: "validation.request";
  issuer: {
    id: Did;
  };
  agentRegistry: string;
  agentId: Erc8004AgentId;
  validatorAddress: string;
  validatorDid?: Did;
  requestURI: string;
  requestHash: Bytes32Hex;
  createdAt: string;
  proof: Erc8004Proof;
}

export interface Erc8004ValidationResponse {
  protocol: Erc8004Protocol;
  specVersion: Erc8004SpecVersion;
  type: "validation.response";
  issuer: {
    id: Did;
  };
  requestHash: Bytes32Hex;
  response: number;
  agentRegistry?: string;
  agentId?: Erc8004AgentId;
  validatorAddress?: string;
  responseURI?: string;
  responseHash?: Bytes32Hex;
  tag?: string;
  createdAt: string;
  proof: Erc8004Proof;
}

export interface ToErc8004RegistrationFileInput {
  name: string;
  description: string;
  image: string;
  services: Erc8004Service[];
  registrations: Erc8004OnChainRegistration[];
  x402Support?: boolean;
  active?: boolean;
  supportedTrust?: Erc8004TrustModel[];
  extra?: Record<string, unknown>;
}

export interface ToErc8004IdentityRegistrationInput {
  did: Did;
  privateKey: string;
  publicKey: string;
  registration: Erc8004RegistrationFile;
  issuedAt?: string;
  expirationDate?: string;
}

export interface ToErc8004FeedbackAttestationInput {
  clientDid: Did;
  privateKey: string;
  publicKey: string;
  agentRegistry: string;
  agentId: Erc8004AgentId;
  subjectDid?: Did;
  clientAddress?: string;
  createdAt?: string;
  value: number | string;
  valueDecimals: number;
  tag1?: string;
  tag2?: string;
  endpoint?: string;
  feedbackURI?: string;
  feedbackHash?: string;
  mcp?: Erc8004McpContext;
  a2a?: Erc8004A2aContext;
  oasf?: Erc8004OasfContext;
  proofOfPayment?: Erc8004PaymentProof;
}

export interface ToErc8004ValidationRequestInput {
  requesterDid: Did;
  privateKey: string;
  publicKey: string;
  agentRegistry: string;
  agentId: Erc8004AgentId;
  validatorAddress: string;
  validatorDid?: Did;
  requestURI: string;
  requestHash: string;
  createdAt?: string;
}

export interface ToErc8004ValidationResponseInput {
  validatorDid: Did;
  privateKey: string;
  publicKey: string;
  requestHash: string;
  response: number;
  agentRegistry?: string;
  agentId?: Erc8004AgentId;
  validatorAddress?: string;
  responseURI?: string;
  responseHash?: string;
  tag?: string;
  createdAt?: string;
}

export interface Erc8004VerifyOptions {
  now?: Date;
  publicKey?: string;
  publicKeys?: Record<string, string>;
}

export interface Erc8004ValidationResponseVerifyOptions extends Erc8004VerifyOptions {
  request?: Erc8004ValidationRequest;
}

export type Erc8004VerifyError =
  | "malformed"
  | "bad_did"
  | "key_mismatch"
  | "proof_invalid"
  | "not_yet_valid"
  | "expired"
  | "registration_invalid"
  | "feedback_invalid"
  | "validation_invalid";

export type Erc8004VerifyResult =
  | { valid: true }
  | { valid: false; error: Erc8004VerifyError; detail?: string };

type SignedErc8004Document = { proof: Erc8004Proof };

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAgentRegistry(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+:[0-9]+:.+$/i.test(value);
}

function isAgentId(value: unknown): value is Erc8004AgentId {
  return (
    (typeof value === "number" && Number.isInteger(value) && value >= 0) ||
    (typeof value === "string" && /^[0-9]+$/.test(value))
  );
}

function isIntegerLike(value: unknown): value is number | string {
  return (
    (typeof value === "number" && Number.isInteger(value)) ||
    (typeof value === "string" && /^-?[0-9]+$/.test(value))
  );
}

export function isBytes32Hex(value: string): value is Bytes32Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function normalizeBytes32Hex(value: string): Bytes32Hex {
  const candidate = value.startsWith("0x") ? value : `0x${value}`;
  if (!isBytes32Hex(candidate)) {
    throw new Error("normalizeBytes32Hex: expected 32-byte hex string");
  }
  return candidate.toLowerCase() as Bytes32Hex;
}

function assertSigner(prefix: string, did: Did, publicKey: string): void {
  if (!isDid(did)) throw new Error(`${prefix}: invalid DID: ${did}`);
  if (!publicKeyMatchesDid(did, publicKey)) {
    throw new Error(`${prefix}: public key does not self-certify the DID`);
  }
}

function validationError(
  error: Erc8004VerifyError,
  detail?: string,
): Extract<Erc8004VerifyResult, { valid: false }> {
  return detail === undefined ? { valid: false, error } : { valid: false, error, detail };
}

function validateRegistrationFile(
  registration: unknown,
): Extract<Erc8004VerifyResult, { valid: false }> | null {
  if (!isObject(registration)) {
    return validationError("registration_invalid", "registration is not an object");
  }
  if (registration.type !== ERC8004_REGISTRATION_TYPE) {
    return validationError("registration_invalid", "type is not ERC-8004 registration-v1");
  }
  for (const key of ["name", "description", "image"] as const) {
    if (typeof registration[key] !== "string" || registration[key].length === 0) {
      return validationError("registration_invalid", `${key} must be a non-empty string`);
    }
  }
  if (!Array.isArray(registration.services)) {
    return validationError("registration_invalid", "services must be an array");
  }
  for (const [index, service] of registration.services.entries()) {
    if (
      !isObject(service) ||
      typeof service.name !== "string" ||
      service.name.length === 0 ||
      typeof service.endpoint !== "string" ||
      service.endpoint.length === 0
    ) {
      return validationError(
        "registration_invalid",
        `service ${index} must include name and endpoint`,
      );
    }
  }
  if (typeof registration.x402Support !== "boolean") {
    return validationError("registration_invalid", "x402Support must be a boolean");
  }
  if (typeof registration.active !== "boolean") {
    return validationError("registration_invalid", "active must be a boolean");
  }
  if (!Array.isArray(registration.registrations) || registration.registrations.length === 0) {
    return validationError("registration_invalid", "registrations must be a non-empty array");
  }
  for (const [index, entry] of registration.registrations.entries()) {
    if (!isObject(entry) || !isAgentId(entry.agentId) || !isAgentRegistry(entry.agentRegistry)) {
      return validationError(
        "registration_invalid",
        `registration ${index} must include agentId and agentRegistry`,
      );
    }
  }
  if (
    registration.supportedTrust !== undefined &&
    (!Array.isArray(registration.supportedTrust) ||
      registration.supportedTrust.some((item) => typeof item !== "string" || item.length === 0))
  ) {
    return validationError("registration_invalid", "supportedTrust must be an array of strings");
  }
  return null;
}

function validateFeedbackFields(
  feedback: Erc8004FeedbackAttestation,
): Extract<Erc8004VerifyResult, { valid: false }> | null {
  if (!isAgentRegistry(feedback.agentRegistry)) {
    return validationError("feedback_invalid", "agentRegistry is malformed");
  }
  if (!isAgentId(feedback.agentId)) {
    return validationError("feedback_invalid", "agentId is malformed");
  }
  if (feedback.subjectDid !== undefined && !isDid(feedback.subjectDid)) {
    return validationError("bad_did", `subjectDid: ${feedback.subjectDid}`);
  }
  if (!isIntegerLike(feedback.value)) {
    return validationError("feedback_invalid", "value must be an integer-like fixed-point value");
  }
  if (
    !Number.isInteger(feedback.valueDecimals) ||
    feedback.valueDecimals < 0 ||
    feedback.valueDecimals > 18
  ) {
    return validationError("feedback_invalid", "valueDecimals must be between 0 and 18");
  }
  if (feedback.feedbackHash !== undefined && !isBytes32Hex(feedback.feedbackHash)) {
    return validationError("feedback_invalid", "feedbackHash must be bytes32 hex");
  }
  return null;
}

function validateValidationRequestFields(
  request: Erc8004ValidationRequest,
): Extract<Erc8004VerifyResult, { valid: false }> | null {
  if (!isAgentRegistry(request.agentRegistry)) {
    return validationError("validation_invalid", "agentRegistry is malformed");
  }
  if (!isAgentId(request.agentId)) {
    return validationError("validation_invalid", "agentId is malformed");
  }
  if (request.validatorDid !== undefined && !isDid(request.validatorDid)) {
    return validationError("bad_did", `validatorDid: ${request.validatorDid}`);
  }
  if (typeof request.validatorAddress !== "string" || request.validatorAddress.length === 0) {
    return validationError("validation_invalid", "validatorAddress is required");
  }
  if (typeof request.requestURI !== "string" || request.requestURI.length === 0) {
    return validationError("validation_invalid", "requestURI is required");
  }
  if (!isBytes32Hex(request.requestHash)) {
    return validationError("validation_invalid", "requestHash must be bytes32 hex");
  }
  return null;
}

function validateValidationResponseFields(
  response: Erc8004ValidationResponse,
): Extract<Erc8004VerifyResult, { valid: false }> | null {
  if (!isBytes32Hex(response.requestHash)) {
    return validationError("validation_invalid", "requestHash must be bytes32 hex");
  }
  if (!Number.isInteger(response.response) || response.response < 0 || response.response > 100) {
    return validationError("validation_invalid", "response must be an integer from 0 to 100");
  }
  if (response.agentRegistry !== undefined && !isAgentRegistry(response.agentRegistry)) {
    return validationError("validation_invalid", "agentRegistry is malformed");
  }
  if (response.agentId !== undefined && !isAgentId(response.agentId)) {
    return validationError("validation_invalid", "agentId is malformed");
  }
  if (response.responseHash !== undefined && !isBytes32Hex(response.responseHash)) {
    return validationError("validation_invalid", "responseHash must be bytes32 hex");
  }
  return null;
}

function documentForSigning<T extends SignedErc8004Document>(
  document: T,
): Omit<T, "proof"> & { proof: Omit<Erc8004Proof, "proofValue"> } {
  const { proof, ...rest } = document;
  const { proofValue: _, ...proofWithoutSig } = proof;
  return { ...rest, proof: proofWithoutSig };
}

function signDocument<T extends SignedErc8004Document>(
  document: T,
  did: Did,
  privateKey: string,
): T {
  const canonical = canonicalize(documentForSigning(document));
  const sigBase64 = didSign(did, privateKey, canonical);
  const sigBytes = Buffer.from(sigBase64, "base64");
  document.proof.proofValue = multibaseBase58btcEncode(sigBytes);
  return document;
}

function resolveVerifierPublicKey(did: Did, options: Erc8004VerifyOptions): string | undefined {
  if (options.publicKeys?.[did]) return options.publicKeys[did];
  if (options.publicKey) return options.publicKey;
  const doc = resolveDid(did);
  return doc?.verificationMethod[0]?.publicKeyHex;
}

function verifyTemporal(
  iso: string,
  errorDetail: string,
  now: Date,
): Erc8004VerifyResult | null {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return validationError("malformed", `${errorDetail} is not parseable`);
  }
  if (parsed.getTime() > now.getTime()) {
    return validationError("not_yet_valid", errorDetail);
  }
  return null;
}

function verifySignedDocument<T extends SignedErc8004Document>(
  document: T,
  signerDid: Did,
  options: Erc8004VerifyOptions = {},
): Erc8004VerifyResult {
  if (!isDid(signerDid)) {
    return validationError("bad_did", `signer: ${signerDid}`);
  }
  if (!document || !isObject(document) || !isObject(document.proof)) {
    return validationError("malformed", "missing proof");
  }
  if (document.proof.type !== "Ed25519Signature2020") {
    return validationError("malformed", "unsupported proof type");
  }
  if (document.proof.proofPurpose !== "assertionMethod") {
    return validationError("malformed", "unsupported proof purpose");
  }
  if (document.proof.verificationMethod !== `${signerDid}#keys-1`) {
    return validationError(
      "key_mismatch",
      `verificationMethod ${document.proof.verificationMethod} does not match signer`,
    );
  }

  const now = options.now ?? new Date();
  const proofTime = verifyTemporal(document.proof.created, "proof.created", now);
  if (proofTime) return proofTime;

  const publicKey = resolveVerifierPublicKey(signerDid, options);
  if (!publicKey) {
    return validationError(
      "key_mismatch",
      "could not resolve signer public key (pass options.publicKey or register the DID first)",
    );
  }
  if (!publicKeyMatchesDid(signerDid, publicKey)) {
    return validationError("key_mismatch", "public key does not self-certify the DID");
  }

  if (!document.proof.proofValue || typeof document.proof.proofValue !== "string") {
    return validationError("proof_invalid", "missing proofValue");
  }

  let signatureBase64: string;
  try {
    const sigBytes = multibaseBase58btcDecode(document.proof.proofValue);
    signatureBase64 = Buffer.from(sigBytes).toString("base64");
  } catch (err: any) {
    return validationError(
      "proof_invalid",
      `proofValue is not Multibase base58btc: ${err?.message || err}`,
    );
  }

  const canonical = canonicalize(documentForSigning(document));
  if (!didVerify(signerDid, signatureBase64, canonical, publicKey)) {
    return validationError("proof_invalid");
  }

  return { valid: true };
}

export function toErc8004RegistrationFile(
  input: ToErc8004RegistrationFileInput,
): Erc8004RegistrationFile {
  const registration: Erc8004RegistrationFile = {
    type: ERC8004_REGISTRATION_TYPE,
    name: input.name,
    description: input.description,
    image: input.image,
    services: input.services,
    x402Support: input.x402Support ?? false,
    active: input.active ?? true,
    registrations: input.registrations,
    ...input.extra,
  };
  if (input.supportedTrust !== undefined) {
    registration.supportedTrust = input.supportedTrust;
  }

  const invalid = validateRegistrationFile(registration);
  if (invalid) {
    throw new Error(`toErc8004RegistrationFile: ${invalid.detail ?? invalid.error}`);
  }
  return registration;
}

export function toErc8004IdentityRegistration(
  input: ToErc8004IdentityRegistrationInput,
): Erc8004IdentityRegistration {
  assertSigner("toErc8004IdentityRegistration", input.did, input.publicKey);
  const invalid = validateRegistrationFile(input.registration);
  if (invalid) {
    throw new Error(`toErc8004IdentityRegistration: ${invalid.detail ?? invalid.error}`);
  }

  const issuedAt = input.issuedAt ?? new Date().toISOString();
  const document: Erc8004IdentityRegistration = {
    protocol: ERC8004_PROTOCOL,
    specVersion: ERC8004_SPEC_VERSION,
    type: "identity.registration",
    issuer: { id: input.did },
    issuedAt,
    subject: {
      id: input.did,
      publicKey: input.publicKey,
      registration: input.registration,
    },
    proof: {
      type: "Ed25519Signature2020",
      created: issuedAt,
      verificationMethod: `${input.did}#keys-1`,
      proofPurpose: "assertionMethod",
      proofValue: "",
    },
  };
  if (input.expirationDate !== undefined) document.expirationDate = input.expirationDate;
  return signDocument(document, input.did, input.privateKey);
}

export function verifyErc8004IdentityRegistration(
  registration: Erc8004IdentityRegistration,
  options: Erc8004VerifyOptions = {},
): Erc8004VerifyResult {
  if (!registration || registration.protocol !== ERC8004_PROTOCOL) {
    return validationError("malformed", "protocol must be erc-8004");
  }
  if (registration.specVersion !== ERC8004_SPEC_VERSION) {
    return validationError("malformed", "unsupported specVersion");
  }
  if (registration.type !== "identity.registration") {
    return validationError("malformed", "type must be identity.registration");
  }
  const issuerDid = registration.issuer?.id;
  const subjectDid = registration.subject?.id;
  if (!isDid(issuerDid)) return validationError("bad_did", `issuer: ${issuerDid}`);
  if (!isDid(subjectDid)) return validationError("bad_did", `subject: ${subjectDid}`);
  if (issuerDid !== subjectDid) {
    return validationError("key_mismatch", "issuer and subject DID must match");
  }
  if (
    typeof registration.subject.publicKey !== "string" ||
    !publicKeyMatchesDid(subjectDid, registration.subject.publicKey)
  ) {
    return validationError("key_mismatch", "subject public key does not self-certify the DID");
  }

  const invalidRegistration = validateRegistrationFile(registration.subject.registration);
  if (invalidRegistration) return invalidRegistration;

  const now = options.now ?? new Date();
  const issued = verifyTemporal(registration.issuedAt, "issuedAt", now);
  if (issued) return issued;
  if (registration.expirationDate !== undefined) {
    const exp = new Date(registration.expirationDate);
    if (Number.isNaN(exp.getTime())) {
      return validationError("malformed", "expirationDate is not parseable");
    }
    if (exp.getTime() <= now.getTime()) {
      return validationError("expired");
    }
  }

  return verifySignedDocument(registration, issuerDid, options);
}

export function toErc8004FeedbackAttestation(
  input: ToErc8004FeedbackAttestationInput,
): Erc8004FeedbackAttestation {
  assertSigner("toErc8004FeedbackAttestation", input.clientDid, input.publicKey);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const attestation: Erc8004FeedbackAttestation = {
    protocol: ERC8004_PROTOCOL,
    specVersion: ERC8004_SPEC_VERSION,
    type: "reputation.feedback",
    issuer: { id: input.clientDid },
    agentRegistry: input.agentRegistry,
    agentId: input.agentId,
    createdAt,
    value: input.value,
    valueDecimals: input.valueDecimals,
    proof: {
      type: "Ed25519Signature2020",
      created: createdAt,
      verificationMethod: `${input.clientDid}#keys-1`,
      proofPurpose: "assertionMethod",
      proofValue: "",
    },
  };
  if (input.subjectDid !== undefined) attestation.subjectDid = input.subjectDid;
  if (input.clientAddress !== undefined) attestation.clientAddress = input.clientAddress;
  if (input.tag1 !== undefined) attestation.tag1 = input.tag1;
  if (input.tag2 !== undefined) attestation.tag2 = input.tag2;
  if (input.endpoint !== undefined) attestation.endpoint = input.endpoint;
  if (input.feedbackURI !== undefined) attestation.feedbackURI = input.feedbackURI;
  if (input.feedbackHash !== undefined) attestation.feedbackHash = normalizeBytes32Hex(input.feedbackHash);
  if (input.mcp !== undefined) attestation.mcp = input.mcp;
  if (input.a2a !== undefined) attestation.a2a = input.a2a;
  if (input.oasf !== undefined) attestation.oasf = input.oasf;
  if (input.proofOfPayment !== undefined) attestation.proofOfPayment = input.proofOfPayment;

  const invalid = validateFeedbackFields(attestation);
  if (invalid) throw new Error(`toErc8004FeedbackAttestation: ${invalid.detail ?? invalid.error}`);
  return signDocument(attestation, input.clientDid, input.privateKey);
}

export const toErc8004Attestation = toErc8004FeedbackAttestation;

export function verifyErc8004FeedbackAttestation(
  attestation: Erc8004FeedbackAttestation,
  options: Erc8004VerifyOptions = {},
): Erc8004VerifyResult {
  if (!attestation || attestation.protocol !== ERC8004_PROTOCOL) {
    return validationError("malformed", "protocol must be erc-8004");
  }
  if (attestation.specVersion !== ERC8004_SPEC_VERSION) {
    return validationError("malformed", "unsupported specVersion");
  }
  if (attestation.type !== "reputation.feedback") {
    return validationError("malformed", "type must be reputation.feedback");
  }
  const issuerDid = attestation.issuer?.id;
  if (!isDid(issuerDid)) return validationError("bad_did", `issuer: ${issuerDid}`);
  const invalid = validateFeedbackFields(attestation);
  if (invalid) return invalid;
  const created = verifyTemporal(attestation.createdAt, "createdAt", options.now ?? new Date());
  if (created) return created;
  return verifySignedDocument(attestation, issuerDid, options);
}

export const verifyErc8004Attestation = verifyErc8004FeedbackAttestation;

export function toErc8004ValidationRequest(
  input: ToErc8004ValidationRequestInput,
): Erc8004ValidationRequest {
  assertSigner("toErc8004ValidationRequest", input.requesterDid, input.publicKey);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const request: Erc8004ValidationRequest = {
    protocol: ERC8004_PROTOCOL,
    specVersion: ERC8004_SPEC_VERSION,
    type: "validation.request",
    issuer: { id: input.requesterDid },
    agentRegistry: input.agentRegistry,
    agentId: input.agentId,
    validatorAddress: input.validatorAddress,
    requestURI: input.requestURI,
    requestHash: normalizeBytes32Hex(input.requestHash),
    createdAt,
    proof: {
      type: "Ed25519Signature2020",
      created: createdAt,
      verificationMethod: `${input.requesterDid}#keys-1`,
      proofPurpose: "assertionMethod",
      proofValue: "",
    },
  };
  if (input.validatorDid !== undefined) request.validatorDid = input.validatorDid;

  const invalid = validateValidationRequestFields(request);
  if (invalid) throw new Error(`toErc8004ValidationRequest: ${invalid.detail ?? invalid.error}`);
  return signDocument(request, input.requesterDid, input.privateKey);
}

export function verifyErc8004ValidationRequest(
  request: Erc8004ValidationRequest,
  options: Erc8004VerifyOptions = {},
): Erc8004VerifyResult {
  if (!request || request.protocol !== ERC8004_PROTOCOL) {
    return validationError("malformed", "protocol must be erc-8004");
  }
  if (request.specVersion !== ERC8004_SPEC_VERSION) {
    return validationError("malformed", "unsupported specVersion");
  }
  if (request.type !== "validation.request") {
    return validationError("malformed", "type must be validation.request");
  }
  const issuerDid = request.issuer?.id;
  if (!isDid(issuerDid)) return validationError("bad_did", `issuer: ${issuerDid}`);
  const invalid = validateValidationRequestFields(request);
  if (invalid) return invalid;
  const created = verifyTemporal(request.createdAt, "createdAt", options.now ?? new Date());
  if (created) return created;
  return verifySignedDocument(request, issuerDid, options);
}

export function toErc8004ValidationResponse(
  input: ToErc8004ValidationResponseInput,
): Erc8004ValidationResponse {
  assertSigner("toErc8004ValidationResponse", input.validatorDid, input.publicKey);
  if (!Number.isInteger(input.response) || input.response < 0 || input.response > 100) {
    throw new Error("toErc8004ValidationResponse: response must be an integer from 0 to 100");
  }
  const createdAt = input.createdAt ?? new Date().toISOString();
  const response: Erc8004ValidationResponse = {
    protocol: ERC8004_PROTOCOL,
    specVersion: ERC8004_SPEC_VERSION,
    type: "validation.response",
    issuer: { id: input.validatorDid },
    requestHash: normalizeBytes32Hex(input.requestHash),
    response: input.response,
    createdAt,
    proof: {
      type: "Ed25519Signature2020",
      created: createdAt,
      verificationMethod: `${input.validatorDid}#keys-1`,
      proofPurpose: "assertionMethod",
      proofValue: "",
    },
  };
  if (input.agentRegistry !== undefined) response.agentRegistry = input.agentRegistry;
  if (input.agentId !== undefined) response.agentId = input.agentId;
  if (input.validatorAddress !== undefined) response.validatorAddress = input.validatorAddress;
  if (input.responseURI !== undefined) response.responseURI = input.responseURI;
  if (input.responseHash !== undefined) response.responseHash = normalizeBytes32Hex(input.responseHash);
  if (input.tag !== undefined) response.tag = input.tag;

  const invalid = validateValidationResponseFields(response);
  if (invalid) throw new Error(`toErc8004ValidationResponse: ${invalid.detail ?? invalid.error}`);
  return signDocument(response, input.validatorDid, input.privateKey);
}

export function verifyErc8004ValidationResponse(
  response: Erc8004ValidationResponse,
  options: Erc8004ValidationResponseVerifyOptions = {},
): Erc8004VerifyResult {
  if (!response || response.protocol !== ERC8004_PROTOCOL) {
    return validationError("malformed", "protocol must be erc-8004");
  }
  if (response.specVersion !== ERC8004_SPEC_VERSION) {
    return validationError("malformed", "unsupported specVersion");
  }
  if (response.type !== "validation.response") {
    return validationError("malformed", "type must be validation.response");
  }
  const issuerDid = response.issuer?.id;
  if (!isDid(issuerDid)) return validationError("bad_did", `issuer: ${issuerDid}`);
  const invalid = validateValidationResponseFields(response);
  if (invalid) return invalid;
  const created = verifyTemporal(response.createdAt, "createdAt", options.now ?? new Date());
  if (created) return created;

  if (options.request !== undefined) {
    if (response.requestHash !== options.request.requestHash) {
      return validationError("validation_invalid", "response requestHash does not match request");
    }
    if (options.request.validatorDid !== undefined && issuerDid !== options.request.validatorDid) {
      return validationError("key_mismatch", "response signer is not the requested validator");
    }
    if (
      response.validatorAddress !== undefined &&
      response.validatorAddress !== options.request.validatorAddress
    ) {
      return validationError("key_mismatch", "validatorAddress does not match request");
    }
    if (response.agentRegistry !== undefined && response.agentRegistry !== options.request.agentRegistry) {
      return validationError("validation_invalid", "agentRegistry does not match request");
    }
    if (response.agentId !== undefined && response.agentId !== options.request.agentId) {
      return validationError("validation_invalid", "agentId does not match request");
    }
  }

  return verifySignedDocument(response, issuerDid, options);
}
