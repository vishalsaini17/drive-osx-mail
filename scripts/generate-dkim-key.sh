#!/usr/bin/env bash
set -euo pipefail

# Generates the RSA keypair used to DKIM-sign outbound mail, and prints the
# exact DNS TXT record to publish for the public half.
#
# Run this on the machine/environment that will actually send mail in
# production — do not copy a key generated somewhere else into production;
# generate fresh there. Re-running overwrites the existing key, which
# invalidates any previously published DNS record (the old key would no
# longer match), so only re-run this if you intend to rotate the key and
# update DNS immediately after.

cd "$(dirname "$0")/.."

SELECTOR="${DKIM_SELECTOR:-mail}"
DOMAIN="${MAIL_DOMAIN:-driveosx.com}"
OUT_DIR="secrets"
PRIVATE_KEY="$OUT_DIR/dkim-private.pem"
PUBLIC_KEY="$OUT_DIR/dkim-public.pem"

mkdir -p "$OUT_DIR"

openssl genrsa -out "$PRIVATE_KEY" 2048 2>/dev/null
openssl rsa -in "$PRIVATE_KEY" -pubout -out "$PUBLIC_KEY" 2>/dev/null
# 644, not 600: this gets bind-mounted read-only into a container running as
# a different uid (see docker-compose.yml), so it must stay group/other
# readable to actually be usable. It is still outside any served directory
# and gitignored — tighten to 600 if your deployment runs the container as
# the same uid that generated the key.
chmod 644 "$PRIVATE_KEY"

# The DNS record needs the public key as one continuous base64 blob, with
# the PEM header/footer and line breaks stripped.
PUBLIC_KEY_B64=$(grep -v '^-----' "$PUBLIC_KEY" | tr -d '\n')

echo "DKIM key pair written to $PRIVATE_KEY / $PUBLIC_KEY"
echo
echo "Set in drive-osx-mail/.env:"
echo "  DKIM_SELECTOR=$SELECTOR"
echo "  DKIM_PRIVATE_KEY_PATH=./secrets/dkim-private.pem"
echo
echo "Publish this DNS TXT record:"
echo
echo "  Host/Name: ${SELECTOR}._domainkey.${DOMAIN}"
echo "  Type:      TXT"
echo "  Value:     v=DKIM1; k=rsa; p=${PUBLIC_KEY_B64}"
echo
echo "Verify after DNS propagates (usually minutes, sometimes hours):"
echo "  dig TXT ${SELECTOR}._domainkey.${DOMAIN} +short"
