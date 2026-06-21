# Email DNS + Resend setup (manual, one-time per environment)

Required before any real send. Without these records mail lands in spam.

## 1. Resend account + domain

1. Create/sign in to Resend; add domain `langdrill.app` (prod) — Resend issues
   SPF, DKIM, and (optionally) DMARC records.
2. In **Cloudflare** (registrar + DNS), add the issued records as **DNS-only /
   grey-cloud** (consistent with existing records). Wait for Resend to mark the
   domain **Verified**.
3. Verify the `summary@langdrill.app` from-address sends under the verified
   domain.

## 2. Secrets Manager

Add `RESEND_API_KEY` to AWS Secrets Manager in **eu-central-1** for both envs:
- prod: `language-drill/RESEND_API_KEY`
- dev:  `language-drill-dev/RESEND_API_KEY`

```bash
aws --region eu-central-1 secretsmanager create-secret \
  --name language-drill/RESEND_API_KEY --secret-string '<resend_api_key>'
```

## 3. Verify end-to-end

- Toggle the weekly summary on in settings → confirm the confirmation email
  arrives and the confirm link flips status to `confirmed`.
- Manually invoke the dispatcher Lambda (or wait for Monday 08:00 UTC) and
  confirm a summary arrives; check CloudWatch for the sender Lambda logs.
