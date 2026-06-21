import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { emailPreferences, users } from '@language-drill/db';
import {
  sendEmail,
  renderEmail,
  ConfirmSubscriptionEmail,
} from '@language-drill/email';
import { db } from '../db';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';

const email = new Hono<{ Bindings: Bindings; Variables: Variables }>();

email.use('/me/email-preferences', authMiddleware);
email.use('/email/weekly-summary', authMiddleware);

const linkBase = (): string =>
  process.env.EMAIL_LINK_BASE_URL ?? 'http://localhost:3001';

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:sans-serif;max-width:480px;margin:64px auto;padding:0 16px;text-align:center"><h1 style="font-size:20px">${title}</h1><p style="color:#374151">${body}</p></body></html>`;
}

// --- GET /me/email-preferences -------------------------------------------
email.get('/me/email-preferences', async (c) => {
  const userId = c.get('userId');
  const rows = await db
    .select({ weeklySummary: emailPreferences.weeklySummary })
    .from(emailPreferences)
    .where(eq(emailPreferences.userId, userId))
    .limit(1);
  return c.json({ weeklySummary: rows[0]?.weeklySummary ?? 'off' });
});

// --- POST /email/weekly-summary ------------------------------------------
const ToggleSchema = z.object({ enabled: z.boolean() });

email.post('/email/weekly-summary', async (c) => {
  const userId = c.get('userId');
  const parsed = ToggleSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', code: 'VALIDATION_ERROR' }, 400);
  }

  if (!parsed.data.enabled) {
    const rows = await db
      .insert(emailPreferences)
      .values({ userId, weeklySummary: 'off' })
      .onConflictDoUpdate({
        target: emailPreferences.userId,
        set: { weeklySummary: 'off', confirmToken: null, updatedAt: new Date() },
      })
      .returning({ weeklySummary: emailPreferences.weeklySummary });
    return c.json({ weeklySummary: rows[0]?.weeklySummary ?? 'off' });
  }

  // Enable → pending + fresh confirm token. crypto.randomUUID is available in
  // the Node 22 Lambda runtime.
  const confirmToken = crypto.randomUUID();
  const rows = await db
    .insert(emailPreferences)
    .values({ userId, weeklySummary: 'pending', confirmToken, confirmSentAt: new Date() })
    .onConflictDoUpdate({
      target: emailPreferences.userId,
      set: {
        weeklySummary: 'pending',
        confirmToken,
        confirmSentAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning({
      weeklySummary: emailPreferences.weeklySummary,
      confirmToken: emailPreferences.confirmToken,
    });

  const token = rows[0]?.confirmToken ?? confirmToken;
  const confirmUrl = `${linkBase()}/email/confirm?token=${token}`;
  const { html, text } = await renderEmail(ConfirmSubscriptionEmail({ confirmUrl }));
  // Recipient must be the user's real address (the auth middleware guarantees a
  // users row exists).
  await sendEmail({
    to: await resolveEmail(userId),
    subject: 'Confirm your weekly Language Drill summary',
    html,
    text,
  });

  return c.json({ weeklySummary: rows[0]?.weeklySummary ?? 'pending' });
});

// --- GET /email/confirm (public) -----------------------------------------
email.get('/email/confirm', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.html(htmlPage('Invalid link', 'This confirmation link is missing its token.'), 200);
  const rows = await db
    .update(emailPreferences)
    .set({ weeklySummary: 'confirmed', confirmedAt: new Date(), confirmToken: null, updatedAt: new Date() })
    .where(eq(emailPreferences.confirmToken, token))
    .returning({ userId: emailPreferences.userId });
  if (rows.length === 0) {
    return c.html(htmlPage('Already confirmed', 'This link has already been used, or it has expired. Nothing else to do.'), 200);
  }
  return c.html(htmlPage('You’re subscribed', 'Your weekly summary is on. You can unsubscribe anytime from any email.'), 200);
});

// --- unsubscribe (public; GET for click, POST for RFC 8058 one-click) -----
async function doUnsubscribe(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const rows = await db
    .update(emailPreferences)
    .set({ weeklySummary: 'off', confirmToken: null, updatedAt: new Date() })
    .where(eq(emailPreferences.unsubscribeToken, token))
    .returning({ userId: emailPreferences.userId });
  return rows.length > 0;
}

email.get('/email/unsubscribe', async (c) => {
  await doUnsubscribe(c.req.query('token'));
  return c.html(htmlPage('Unsubscribed', 'You won’t receive the weekly summary anymore. You can turn it back on in settings.'), 200);
});

email.post('/email/unsubscribe', async (c) => {
  await doUnsubscribe(c.req.query('token'));
  return c.body(null, 200);
});

// Resolve a user's email for the confirmation recipient.
async function resolveEmail(userId: string): Promise<string> {
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.email ?? '';
}

export default email;
