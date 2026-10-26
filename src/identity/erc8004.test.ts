import { describe, it, expect, beforeEach } from "vitest";

import { mintDid, _resetResolver, type Did } from "./did.js";
import {
  ERC8004_REGISTRATION_TYPE,
  normalizeBytes32Hex,
  toErc8004FeedbackAttestation,
  toErc8004IdentityRegistration,
  toErc8004RegistrationFile,
  toErc8004ValidationRequest,
  toErc8004ValidationResponse,
  verifyErc8004FeedbackAttestation,
  verifyErc8004IdentityRegistration,
  verifyErc8004ValidationRequest,
  verifyErc8004ValidationResponse,
  type Erc8004FeedbackAttestation,
  type Erc8004IdentityRegistration,
  type Erc8004ValidationRequest,
  type Erc8004ValidationResponse,
} from "./erc8004.js";

const NOW = new Date("2026-06-01T00:00:00.000Z");
const ISSUED_AT = "2026-05-01T00:00:00.000Z";
const AGENT_REGISTRY = "eip155:8453:0x742d35cc6634c0532925a3b844bc454e4438f44e";
const REQUEST_HASH =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const RESPONSE_HASH =
  "0x2222222222222222222222222222222222222222222222222222222222222222";

function sampleRegistration(agentDid: Did) {
  return toErc8004RegistrationFile({
    name: "mnemo-shopping-agent",
    description: "Autonomous procurement agent with audited payment limits.",
    image: "https://mnemopay.com/agents/shopping.png",
    services: [
      {
        name: "MCP",
        endpoint: "https://mcp.mnemopay.com/agents/shopping",
        version: "2025-06-18",
      },
      {
        name: "DID",
        endpoint: agentDid,
        version: "v1",
      },
    ],
    x402Support: true,
    registrations: [{ agentId: 42, agentRegistry: AGENT_REGISTRY }],
    supportedTrust: ["reputation", "crypto-economic", "tee-attestation"],
  });
}

describe("erc8004 identity registration", () => {
  beforeEach(() => _resetResolver());

  it("builds a draft ERC-8004 registration file and signed identity proof", () => {
    const agent = mintDid();
    const registration = sampleRegistration(agent.did);
    const proof = toErc8004IdentityRegistration({
      did: agent.did,
      privateKey: agent.privateKey,
      publicKey: agent.publicKey,
      registration,
      issuedAt: ISSUED_AT,
    });

    expect(registration.type).toBe(ERC8004_REGISTRATION_TYPE);
    expect(registration.registrations).toEqual([
      { agentId: 42, agentRegistry: AGENT_REGISTRY },
    ]);
    expect(proof.protocol).toBe("erc-8004");
    expect(proof.type).toBe("identity.registration");
    expect(proof.subject.id).toBe(agent.did);
    expect(proof.subject.publicKey).toBe(agent.publicKey);
    expect(proof.proof.verificationMethod).toBe(`${agent.did}#keys-1`);
    expect(proof.proof.proofValue).toMatch(/^z[1-9A-HJ-NP-Za-km-z]+$/);

    expect(verifyErc8004IdentityRegistration(proof, { now: NOW }).valid).toBe(true);
  });

  it("rejects a tampered registration profile", () => {
    const agent = mintDid();
    const proof = toErc8004IdentityRegistration({
      did: agent.did,
      privateKey: agent.privateKey,
      publicKey: agent.publicKey,
      registration: sampleRegistration(agent.did),
      issuedAt: ISSUED_AT,
    });
    const tampered: Erc8004IdentityRegistration = {
      ...proof,
      subject: {
        ...proof.subject,
        registration: {
          ...proof.subject.registration,
          active: false,
        },
      },
    };

    const result = verifyErc8004IdentityRegistration(tampered, { now: NOW });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("proof_invalid");
  });

  it("rejects a malformed registration file before signing", () => {
    expect(() =>
      toErc8004RegistrationFile({
        name: "bad",
        description: "missing registrations",
        image: "https://example.com/agent.png",
        services: [],
        registrations: [],
      }),
    ).toThrow(/registrations/);
  });
});

describe("erc8004 reputation feedback attestation", () => {
  beforeEach(() => _resetResolver());

  it("builds and verifies a signed reputation feedback signal", () => {
    const agent = mintDid();
    const client = mintDid();
    const attestation = toErc8004FeedbackAttestation({
      clientDid: client.did,
      privateKey: client.privateKey,
      publicKey: client.publicKey,
      agentRegistry: AGENT_REGISTRY,
      agentId: 42,
      subjectDid: agent.did,
      clientAddress: "eip155:8453:0x00000000000000000000000000000000000000c1",
      createdAt: ISSUED_AT,
      value: 9977,
      valueDecimals: 2,
      tag1: "uptime",
      tag2: "month",
      endpoint: "https://mcp.mnemopay.com/agents/shopping",
      feedbackURI: "ipfs://bafyfeedback",
      mcp: { tool: "quote" },
      proofOfPayment: {
        fromAddress: "0x00000000000000000000000000000000000000c1",
        toAddress: "0x0000000000000000000000000000000000000042",
        chainId: "8453",
        txHash: "0xabc",
      },
    });

    expect(attestation.type).toBe("reputation.feedback");
    expect(attestation.issuer.id).toBe(client.did);
    expect(attestation.subjectDid).toBe(agent.did);
    expect(attestation.value).toBe(9977);
    expect(attestation.valueDecimals).toBe(2);
    expect(attestation.tag1).toBe("uptime");

    const result = verifyErc8004FeedbackAttestation(attestation, { now: NOW });
    expect(result.valid).toBe(true);
  });

  it("rejects tampered attestation values", () => {
    const agent = mintDid();
    const client = mintDid();
    const attestation = toErc8004FeedbackAttestation({
      clientDid: client.did,
      privateKey: client.privateKey,
      publicKey: client.publicKey,
      agentRegistry: AGENT_REGISTRY,
      agentId: 42,
      subjectDid: agent.did,
      createdAt: ISSUED_AT,
      value: 100,
      valueDecimals: 0,
      tag1: "successRate",
    });
    const tampered: Erc8004FeedbackAttestation = {
      ...attestation,
      value: 0,
    };

    const result = verifyErc8004FeedbackAttestation(tampered, { now: NOW });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("proof_invalid");
  });

  it("rejects feedback decimals outside ERC-8004's 0-18 range", () => {
    const client = mintDid();
    expect(() =>
      toErc8004FeedbackAttestation({
        clientDid: client.did,
        privateKey: client.privateKey,
        publicKey: client.publicKey,
        agentRegistry: AGENT_REGISTRY,
        agentId: 42,
        createdAt: ISSUED_AT,
        value: 1,
        valueDecimals: 19,
      }),
    ).toThrow(/valueDecimals/);
  });
});

describe("erc8004 validation registry proofs", () => {
  beforeEach(() => _resetResolver());

  it("builds and verifies a validation request", () => {
    const agent = mintDid();
    const validator = mintDid();
    const request = toErc8004ValidationRequest({
      requesterDid: agent.did,
      privateKey: agent.privateKey,
      publicKey: agent.publicKey,
      agentRegistry: AGENT_REGISTRY,
      agentId: "42",
      validatorAddress: "0x0000000000000000000000000000000000000bad",
      validatorDid: validator.did,
      requestURI: "ipfs://bafyrequest",
      requestHash: REQUEST_HASH,
      createdAt: ISSUED_AT,
    });

    expect(request.type).toBe("validation.request");
    expect(request.requestHash).toBe(REQUEST_HASH);
    expect(request.validatorDid).toBe(validator.did);
    expect(verifyErc8004ValidationRequest(request, { now: NOW }).valid).toBe(true);
  });

  it("builds and verifies a validator response against the original request", () => {
    const agent = mintDid();
    const validator = mintDid();
    const request = toErc8004ValidationRequest({
      requesterDid: agent.did,
      privateKey: agent.privateKey,
      publicKey: agent.publicKey,
      agentRegistry: AGENT_REGISTRY,
      agentId: 42,
      validatorAddress: "0x0000000000000000000000000000000000000bad",
      validatorDid: validator.did,
      requestURI: "ipfs://bafyrequest",
      requestHash: REQUEST_HASH,
      createdAt: ISSUED_AT,
    });
    const response = toErc8004ValidationResponse({
      validatorDid: validator.did,
      privateKey: validator.privateKey,
      publicKey: validator.publicKey,
      requestHash: request.requestHash,
      response: 100,
      agentRegistry: request.agentRegistry,
      agentId: request.agentId,
      validatorAddress: request.validatorAddress,
      responseURI: "ipfs://bafyresponse",
      responseHash: RESPONSE_HASH,
      tag: "hard-finality",
      createdAt: ISSUED_AT,
    });

    expect(response.type).toBe("validation.response");
    expect(response.response).toBe(100);
    expect(response.responseHash).toBe(RESPONSE_HASH);

    const result = verifyErc8004ValidationResponse(response, {
      now: NOW,
      request,
      publicKeys: {
        [validator.did]: validator.publicKey,
      },
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a validation response signed by a different validator", () => {
    const agent = mintDid();
    const validator = mintDid();
    const impostor = mintDid();
    const request = toErc8004ValidationRequest({
      requesterDid: agent.did,
      privateKey: agent.privateKey,
      publicKey: agent.publicKey,
      agentRegistry: AGENT_REGISTRY,
      agentId: 42,
      validatorAddress: "0x0000000000000000000000000000000000000bad",
      validatorDid: validator.did,
      requestURI: "ipfs://bafyrequest",
      requestHash: REQUEST_HASH,
      createdAt: ISSUED_AT,
    });
    const response = toErc8004ValidationResponse({
      validatorDid: impostor.did,
      privateKey: impostor.privateKey,
      publicKey: impostor.publicKey,
      requestHash: request.requestHash,
      response: 100,
      createdAt: ISSUED_AT,
    });

    const result = verifyErc8004ValidationResponse(response, {
      now: NOW,
      request,
      publicKeys: {
        [impostor.did]: impostor.publicKey,
      },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("key_mismatch");
  });

  it("rejects invalid validation scores and malformed bytes32 hashes", () => {
    const validator = mintDid();
    expect(() =>
      toErc8004ValidationResponse({
        validatorDid: validator.did,
        privateKey: validator.privateKey,
        publicKey: validator.publicKey,
        requestHash: REQUEST_HASH,
        response: 101,
      }),
    ).toThrow(/response/);

    expect(() => normalizeBytes32Hex("0x1234")).toThrow(/32-byte/);
  });

  it("survives JSON-string transport before verification", () => {
    const agent = mintDid();
    const validator = mintDid();
    const request = toErc8004ValidationRequest({
      requesterDid: agent.did,
      privateKey: agent.privateKey,
      publicKey: agent.publicKey,
      agentRegistry: AGENT_REGISTRY,
      agentId: 42,
      validatorAddress: "0x0000000000000000000000000000000000000bad",
      validatorDid: validator.did,
      requestURI: "ipfs://bafyrequest",
      requestHash: REQUEST_HASH,
      createdAt: ISSUED_AT,
    });
    const response = toErc8004ValidationResponse({
      validatorDid: validator.did,
      privateKey: validator.privateKey,
      publicKey: validator.publicKey,
      requestHash: request.requestHash,
      response: 67,
      createdAt: ISSUED_AT,
    });

    const parsedRequest = JSON.parse(JSON.stringify(request)) as Erc8004ValidationRequest;
    const parsedResponse = JSON.parse(JSON.stringify(response)) as Erc8004ValidationResponse;
    expect(verifyErc8004ValidationRequest(parsedRequest, { now: NOW }).valid).toBe(true);
    expect(
      verifyErc8004ValidationResponse(parsedResponse, {
        now: NOW,
        request: parsedRequest,
        publicKey: validator.publicKey,
      }).valid,
    ).toBe(true);
  });
});
