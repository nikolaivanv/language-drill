# Clerk Invite-Only Configuration

This is a one-time manual setup in the Clerk dashboard. It cannot be done in code — Clerk's invitation system is configured via their UI and Management API.

## Why This Matters

This configuration enforces requirement R4.5: users cannot create accounts without a valid invite code. Without these steps, anyone can sign up freely.

## Dashboard Setup

1. Log in to the [Clerk Dashboard](https://dashboard.clerk.com)
2. Select your application
3. Navigate to **User & Authentication → Email, Phone, Username**
4. Under **Authentication strategies**, ensure your desired methods are enabled (e.g. Email address, Google OAuth)
5. Navigate to **User & Authentication → Restrictions**
6. Under **Sign-up mode**, select **Restricted** — this blocks open sign-ups
7. Enable **Invitations** — this allows users to sign up only via invitation links

Once configured, any attempt to sign up without a valid invitation will be rejected by Clerk automatically.

## Creating Invite Codes

### Via Clerk Dashboard

1. Navigate to **User & Authentication → Invitations**
2. Click **Create Invitation**
3. Enter the invitee's email address
4. Optionally set an expiration
5. Click **Send Invitation** — Clerk emails the invite link directly

### Via Clerk Management API

Use the Clerk Backend API to create invitations programmatically:

```bash
curl -X POST https://api.clerk.com/v1/invitations \
  -H "Authorization: Bearer <CLERK_SECRET_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "email_address": "user@example.com",
    "redirect_url": "https://yourdomain.com/sign-up",
    "notify": true
  }'
```

**Parameters:**
- `email_address` (required) — the invitee's email
- `redirect_url` (optional) — where the user lands after clicking the invite link
- `notify` (optional, default `true`) — whether Clerk sends the invitation email
- `expires_in_days` (optional) — number of days until the invitation expires

**Response** includes the invitation `id`, `status`, and `url` (the invite link, useful if `notify` is `false` and you want to send it yourself).

### Bulk Invitations

To create multiple invites, call the API in a loop:

```bash
for email in user1@example.com user2@example.com; do
  curl -X POST https://api.clerk.com/v1/invitations \
    -H "Authorization: Bearer <CLERK_SECRET_KEY>" \
    -H "Content-Type: application/json" \
    -d "{\"email_address\": \"$email\", \"notify\": true}"
done
```

## Webhook Integration

Configure a webhook in Clerk Dashboard → Webhooks:

- **Endpoint URL:** `https://api.langdrill.app/webhooks/clerk`
- **Events:** `user.created` (and optionally `user.updated`, `user.deleted`)
- **Signing Secret:** store in AWS Secrets Manager as `language-drill/CLERK_WEBHOOK_SECRET`

The `/webhooks/clerk` route bypasses JWT auth at the API Gateway level (uses SVIX signature verification instead).

When an invited user completes sign-up, Clerk fires a `user.created` webhook. Our Lambda handler (`infra/lambda/src/routes/webhooks/clerk.ts`) catches this event and:

1. Inserts a row in the `users` table
2. Marks the corresponding `invitations` row as used (`usedBy`, `usedAt`)

This provides the defense-in-depth layer: even if Clerk's invitation check were bypassed, the Lambda invite middleware would still reject API calls from users without a valid invite record.

## JWT Template

The Clerk production instance requires a JWT template named `api`:

1. Go to Clerk Dashboard → JWT Templates → Create template
2. **Name:** `api`
3. **Claims:** `{ "aud": "language-drill", "sub": "{{user.id}}" }`

The frontend uses `getToken({ template: 'api' })` to request tokens. API Gateway validates these against Clerk's JWKS endpoint (`https://clerk.langdrill.app/.well-known/jwks.json`).
