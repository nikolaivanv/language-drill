import {
  createDb,
  requireEnv,
  emailPreferences,
  sentEmails,
  users,
} from '@language-drill/db';
import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import { and, eq } from 'drizzle-orm';

import { weeklyWindow } from './period-key';
import type { WeeklySummaryJobMessage } from './job-message';
import { isPlaceholderEmail } from '../lib/placeholder-email';

const KIND = 'weekly_summary';
const MAX_BATCH_SIZE = 10; // SQS hard limit

const db = createDb(requireEnv('DATABASE_URL'));
const sqs = new SQSClient({ region: requireEnv('AWS_REGION') });

function log(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * EventBridge-invoked weekly dispatcher. Enumerates confirmed subscribers,
 * drops any already recorded in sent_emails for this period (idempotent across
 * same-week re-fires), and fans out one SQS message per remaining user. The
 * sender Lambda does the per-user work.
 */
export async function handler(): Promise<void> {
  const startedAt = Date.now();
  const queueUrl = requireEnv('EMAIL_QUEUE_URL');
  const { start, end, periodKey } = weeklyWindow(new Date());

  log({ level: 'info', periodKey, message: 'weekly-summary dispatcher started' });

  const subscribers = await db
    .select({ userId: emailPreferences.userId, email: users.email })
    .from(emailPreferences)
    .innerJoin(users, eq(users.id, emailPreferences.userId))
    .where(eq(emailPreferences.weeklySummary, 'confirmed'));

  const already = await db
    .select({ userId: sentEmails.userId })
    .from(sentEmails)
    .where(and(eq(sentEmails.kind, KIND), eq(sentEmails.periodKey, periodKey)));
  const sentUserIds = new Set(already.map((r) => r.userId));

  const validSubscribers = subscribers.filter(
    (s) => s.email && !isPlaceholderEmail(s.email),
  );
  const skippedPlaceholder = subscribers.length - validSubscribers.length;
  if (skippedPlaceholder > 0) {
    log({ level: 'info', periodKey, skippedPlaceholder, message: 'skipped placeholder-email subscribers' });
  }

  const targets = validSubscribers.filter((s) => !sentUserIds.has(s.userId));

  if (targets.length === 0) {
    log({ level: 'info', periodKey, enqueued: 0, durationMs: Date.now() - startedAt, message: 'nothing to enqueue' });
    return;
  }

  const messages: WeeklySummaryJobMessage[] = targets.map((t) => ({
    userId: t.userId,
    email: t.email,
    periodKey,
    windowStartIso: start.toISOString(),
    windowEndIso: end.toISOString(),
  }));

  for (const batch of chunk(messages, MAX_BATCH_SIZE)) {
    await sqs.send(
      new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch.map((msg, i) => ({ Id: String(i), MessageBody: JSON.stringify(msg) })),
      }),
    );
  }

  log({ level: 'info', periodKey, enqueued: messages.length, durationMs: Date.now() - startedAt, message: 'weekly-summary dispatcher complete' });
}
