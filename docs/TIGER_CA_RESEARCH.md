# Tiger Shared Free CA: focused source review

Reviewed October 15, 2026. Read-only public documentation and source inspection; no account, service, credential, database, trust-store or application changes.

**Result: no authenticated Shared Free CA download, fingerprint, bundled root, or connection-certificate API field was found in the inspected official sources. The direct Shared Free TLS gate remains unresolved.** This is a bounded source review, not proof that an undocumented provider endpoint cannot exist.

## Concrete findings

1. The current [official strict-SSL documentation](https://www.tigerdata.com/docs/deploy/tiger-cloud/tiger-cloud-aws/security/strict-ssl/) explicitly says, “Free services do not supply SSL certificates.” Its system-trust instructions address certificates from Google or ZeroSSL. Its older-client procedure extracts a certificate chain from the database endpoint; it does not supply an authenticated Tiger private CA or fingerprint. That procedure cannot independently establish trust in this Shared Free service's private CA.
2. The [official Tiger CLI](https://github.com/timescale/tiger-cli/tree/92fb1da08eee1e40b4a653446c37e0cc1fe12c42) was pinned to `92fb1da08eee1e40b4a653446c37e0cc1fe12c42`. Its recursive source tree contains no `.pem`, `.crt`, `.cer`, `.p12` or `.pfx` certificate asset.
3. The pinned [public OpenAPI specification](https://github.com/timescale/tiger-cli/blob/92fb1da08eee1e40b4a653446c37e0cc1fe12c42/openapi.yaml) has 4,114 lines. Inspection for certificate, TLS, SSL and connection-info terminology found no CA/certificate field or endpoint. The unrelated `connection_string` fields belong to Azure Monitor metric export.
4. The [`tiger db uri` command](https://github.com/timescale/tiger-cli/blob/92fb1da08eee1e40b4a653446c37e0cc1fe12c42/internal/cmd/db_uri.go) provides pooling, role, password-inclusion and read-only options; there is no CA-download option. Its [connection formatter](https://github.com/timescale/tiger-cli/blob/92fb1da08eee1e40b4a653446c37e0cc1fe12c42/internal/common/connection.go#L118) emits `sslmode=require`, so using that URI would not resolve server-identity verification.
5. Relevant non-test Go connection, client and service source files, including the generated API client, were also searched. The sole additional certificate reference is a [generic HTTP-client customization comment](https://github.com/timescale/tiger-cli/blob/92fb1da08eee1e40b4a653446c37e0cc1fe12c42/internal/api/client.go#L37); it is not a database certificate response or provider CA source.

## Remaining gate

Tiger must provide the CA certificate or its independently authenticated fingerprint through an authenticated provider channel, or confirm an official HTTPS download tied to this service. The existing support case has not supplied that trust material. No further peer-chain export, certificate-verification bypass, paid conversion or console search was attempted.

The existing strict-TLS trial probe remains valid evidence for its isolated trial scope; it does not clear the separate Shared Free trust gate or establish durable public-demo persistence. See [Tiger verification](TIGER_VERIFICATION.md).

## Reproducibility

The canonical [documentation Markdown](https://www.tigerdata.com/docs/deploy/tiger-cloud/tiger-cloud-aws/security/strict-ssl/index.md) was fetched over verified HTTPS: 4,935 bytes, SHA-256 `e8ef0135c4ab31406e967dfc189ce6546dd279924ded69939726503aa751d392`. The generated `internal/api/client.go` was 495,009 bytes, SHA-256 `59aaae9a74f24c402b1decfa9f63393d08c6ea69a1c6dc8132d86da8046a2924`. All GitHub references above use the inspected immutable commit.
