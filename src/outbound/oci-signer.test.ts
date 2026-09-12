import { generateKeyPairSync, createHash, createVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signOciPostRequest } from './oci-signer.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const identity = {
  tenancyOcid: 'ocid1.tenancy.oc1..tenancy',
  userOcid: 'ocid1.user.oc1..user',
  fingerprint: 'aa:bb:cc:dd',
  privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
};

describe('signOciPostRequest', () => {
  it('produces a signature that verifies against the signing string it claims to have signed', () => {
    const body = JSON.stringify({ compartmentId: 'ocid1.compartment.oc1..x', emailAddress: 'alice@driveosx.com' });
    const headers = signOciPostRequest(identity, '/20170907/senders', 'email.us-ashburn-1.oci.oraclecloud.com', body);

    const authorization = headers.Authorization;
    const signature = /signature="([^"]+)"/.exec(authorization)?.[1];
    expect(signature).toBeTruthy();

    // Reconstruct the exact signing string from the headers this call
    // produced — if the implementation and this test independently arrive
    // at the same six lines, byte for byte, this is what OCI itself will
    // compute on receipt and check the signature against.
    const signingString = [
      '(request-target): post /20170907/senders',
      `date: ${headers.Date}`,
      `host: ${headers.Host}`,
      `x-content-sha256: ${headers['x-content-sha256']}`,
      `content-type: ${headers['Content-Type']}`,
      `content-length: ${headers['Content-Length']}`,
    ].join('\n');

    const verifier = createVerify('RSA-SHA256');
    verifier.update(signingString);
    expect(verifier.verify(publicKey, signature!, 'base64')).toBe(true);
  });

  it('hashes the exact body bytes into x-content-sha256', () => {
    const body = '{"compartmentId":"ocid1.compartment.oc1..x","emailAddress":"bob@driveosx.com"}';
    const headers = signOciPostRequest(identity, '/20170907/senders', 'email.us-ashburn-1.oci.oraclecloud.com', body);

    expect(headers['x-content-sha256']).toBe(createHash('sha256').update(body).digest('base64'));
    expect(headers['Content-Length']).toBe(String(Buffer.byteLength(body)));
  });

  it('includes all six required headers in the keyId/algorithm/headers list', () => {
    const headers = signOciPostRequest(identity, '/20170907/senders', 'email.us-ashburn-1.oci.oraclecloud.com', '{}');

    expect(headers.Authorization).toContain(
      'headers="(request-target) date host x-content-sha256 content-type content-length"',
    );
    expect(headers.Authorization).toContain(
      `keyId="${identity.tenancyOcid}/${identity.userOcid}/${identity.fingerprint}"`,
    );
    expect(headers.Authorization).toContain('algorithm="rsa-sha256"');
  });
});
