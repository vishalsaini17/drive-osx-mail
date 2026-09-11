import { createHash, createSign } from 'node:crypto';

export interface OciSigningIdentity {
  tenancyOcid: string;
  userOcid: string;
  fingerprint: string;
  privateKey: string;
}

/**
 * Builds the headers OCI's API requires on a signed POST request (the "Request
 * Signing Version 1" scheme — OCI has no bearer-token auth, every control-plane
 * call is signed with an API key's private key). Deliberately hand-rolled
 * rather than pulling in the official OCI SDK: that SDK covers the entire OCI
 * API surface for the one endpoint this service calls (CLAUDE.md §46 — prefer
 * fewer dependencies when they satisfy the requirement).
 *
 * Reference: https://docs.oracle.com/en-us/iaas/Content/API/Concepts/signingrequests.htm
 */
export function signOciPostRequest(
  identity: OciSigningIdentity,
  path: string,
  host: string,
  body: string,
): Record<string, string> {
  const date = new Date().toUTCString();
  const contentSha256 = createHash('sha256').update(body).digest('base64');
  const contentLength = String(Buffer.byteLength(body));

  const signedHeaders = ['(request-target)', 'date', 'host', 'x-content-sha256', 'content-type', 'content-length'];
  const signingString = [
    `(request-target): post ${path}`,
    `date: ${date}`,
    `host: ${host}`,
    `x-content-sha256: ${contentSha256}`,
    `content-type: application/json`,
    `content-length: ${contentLength}`,
  ].join('\n');

  const signature = createSign('RSA-SHA256').update(signingString).sign(identity.privateKey, 'base64');
  const keyId = `${identity.tenancyOcid}/${identity.userOcid}/${identity.fingerprint}`;

  return {
    Date: date,
    Host: host,
    'Content-Type': 'application/json',
    'Content-Length': contentLength,
    'x-content-sha256': contentSha256,
    Authorization:
      `Signature version="1",headers="${signedHeaders.join(' ')}",` +
      `keyId="${keyId}",algorithm="rsa-sha256",signature="${signature}"`,
  };
}
