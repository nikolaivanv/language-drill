import { Resend } from 'resend';

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
  headers?: Record<string, string>;
}

export interface SendEmailResult {
  id: string | null;
  delivered: boolean;
}

const DEFAULT_FROM = 'Language Drill <summary@langdrill.app>';

/**
 * Send one email through Resend. When RESEND_API_KEY is unset (local dev) the
 * rendered HTML is logged instead of sent, so the whole pipeline is runnable
 * without a Resend account. Throws on a Resend-reported error so the caller
 * (sender Lambda) leaves the SQS message un-ACKed and SQS retries.
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = args.from ?? process.env.EMAIL_FROM ?? DEFAULT_FROM;

  if (!apiKey) {
    console.log(
      JSON.stringify({
        level: 'info',
        message: 'RESEND_API_KEY unset — email not sent (local dev)',
        to: args.to,
        subject: args.subject,
        htmlPreview: args.html.slice(0, 200),
      }),
    );
    return { id: null, delivered: false };
  }

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
    headers: args.headers,
  });

  if (error) {
    throw new Error(error.message);
  }
  return { id: data?.id ?? null, delivered: true };
}
