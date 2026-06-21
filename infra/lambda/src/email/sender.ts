import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import {
  createDb,
  requireEnv,
  sentEmails,
  emailPreferences,
  getGrammarPoint,
} from '@language-drill/db';
import {
  renderEmail,
  WeeklySummaryEmail,
  sendEmail,
} from '@language-drill/email';
import { and, eq } from 'drizzle-orm';

import type { WeeklySummaryJobMessage } from './job-message';
import { buildWeeklySummaryData } from './summary-data';
import { gatherSummary } from './gather';

const KIND = 'weekly_summary';
const db = createDb(requireEnv('DATABASE_URL'));

function log(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload));
}

const LANGUAGE_NAMES: Record<string, string> = { ES: 'Spanish', DE: 'German', TR: 'Turkish', EN: 'English' };
const languageNameFor = (code: string): string => LANGUAGE_NAMES[code] ?? code;

/** Curriculum label lookup with a graceful fallback to the raw key. */
function makeLabelFor(_language: string): (key: string) => string {
  return (key: string) => {
    try {
      const gp = getGrammarPoint(key);
      return gp?.name ?? key;
    } catch {
      return key;
    }
  };
}

async function processOne(msg: WeeklySummaryJobMessage): Promise<void> {
  // 1. Claim the period row. ON CONFLICT DO NOTHING → empty array means another
  //    delivery already handled it (idempotent); no-op.
  const claim = await db
    .insert(sentEmails)
    .values({ userId: msg.userId, kind: KIND, periodKey: msg.periodKey, status: 'pending' })
    .onConflictDoNothing()
    .returning({ id: sentEmails.id });
  if (claim.length === 0) {
    // A prior delivery attempt claimed the row but may have crashed mid-process,
    // leaving it 'pending' forever. Re-select to check the actual status:
    // - 'sent' or 'skipped' → terminal, safe to no-op.
    // - 'pending' (prior crash) → fall through and retry; markStatus will UPDATE the row.
    const existing = await db
      .select({ status: sentEmails.status })
      .from(sentEmails)
      .where(and(eq(sentEmails.userId, msg.userId), eq(sentEmails.kind, KIND), eq(sentEmails.periodKey, msg.periodKey)))
      .limit(1);
    const existingStatus = existing[0]?.status;
    if (existingStatus === 'sent' || existingStatus === 'skipped') {
      log({ level: 'info', userId: msg.userId, periodKey: msg.periodKey, status: existingStatus, message: 'already handled — skipping' });
      return;
    }
    // status is 'pending' (crashed previously) — fall through to retry.
    log({ level: 'info', userId: msg.userId, periodKey: msg.periodKey, message: 'prior attempt left pending — retrying' });
  }

  // 2. Gather + shape.
  const start = new Date(msg.windowStartIso);
  const end = new Date(msg.windowEndIso);
  const { historyRows, masteryRows } = await gatherSummary(db, msg.userId, start, end);
  // The user's primary language for label lookups = the most-practiced this
  // week, falling back to the first mastery row's implied language is overkill;
  // use the first history row's language, else 'ES'.
  const primaryLanguage = historyRows[0]?.language ?? 'ES';
  const data = buildWeeklySummaryData({
    historyRows,
    masteryRows,
    labelFor: makeLabelFor(primaryLanguage),
    languageNameFor,
  });

  const markStatus = async (status: 'sent' | 'skipped') => {
    await db
      .update(sentEmails)
      .set({ status, sentAt: status === 'sent' ? new Date() : null })
      .where(and(eq(sentEmails.userId, msg.userId), eq(sentEmails.kind, KIND), eq(sentEmails.periodKey, msg.periodKey)))
      .returning({ id: sentEmails.id });
  };

  // 3. No activity → skip (no email), record it so we don't re-evaluate.
  if (!data.hasActivity) {
    await markStatus('skipped');
    log({ level: 'info', userId: msg.userId, periodKey: msg.periodKey, message: 'no activity — skipped' });
    return;
  }

  // 4. Render + send.
  const linkBase = process.env.EMAIL_LINK_BASE_URL ?? 'http://localhost:3001';
  const appUrl = process.env.EMAIL_APP_URL ?? 'https://langdrill.app';
  // Look up the user's stable unsubscribe token for the footer link + header.
  const unsubscribeUrl = `${linkBase}/email/unsubscribe?token=${await resolveUnsubscribeToken(msg.userId)}`;

  const { html, text } = await renderEmail(
    WeeklySummaryEmail({
      exercisesCompleted: data.exercisesCompleted,
      languagesPracticed: data.languagesPracticed,
      daysActive: data.daysActive,
      movers: data.movers,
      focus: data.focus,
      practiceUrl: appUrl,
      unsubscribeUrl,
    }),
  );

  await sendEmail({
    to: msg.email,
    subject: 'Your week in Language Drill',
    html,
    text,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });

  // 5. Mark sent only after Resend accepted it.
  await markStatus('sent');
  log({ level: 'info', userId: msg.userId, periodKey: msg.periodKey, message: 'sent' });
}

async function resolveUnsubscribeToken(userId: string): Promise<string> {
  const rows = await db
    .select({ token: emailPreferences.unsubscribeToken })
    .from(emailPreferences)
    .where(eq(emailPreferences.userId, userId))
    .limit(1);
  return rows[0]?.token ?? '';
}

/**
 * SQS handler. batchSize=1, reportBatchItemFailures: a thrown error returns the
 * record as a batch-item failure so SQS redrives it (→ DLQ after maxReceive).
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];
  for (const record of event.Records) {
    try {
      const msg = JSON.parse(record.body) as WeeklySummaryJobMessage;
      await processOne(msg);
    } catch (err) {
      log({ level: 'error', messageId: record.messageId, error: String(err), message: 'sender failed' });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
