import { PollyClient } from '@aws-sdk/client-polly';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { synthesizeToS3 } from '@language-drill/db';

// Cold-start singletons — reused across warm invocations.
let s3Client: S3Client | null = null;
function s3(): S3Client {
  if (!s3Client) s3Client = new S3Client({});
  return s3Client;
}
let pollyClient: PollyClient | null = null;
function polly(): PollyClient {
  if (!pollyClient) pollyClient = new PollyClient({});
  return pollyClient;
}

function bucket(): string {
  const b = process.env.CONTENT_BUCKET_NAME;
  if (!b) throw new Error('CONTENT_BUCKET_NAME is not set');
  return b;
}

/** True if the key already exists in the content bucket (cross-user cache hit). */
export async function headObjectExists(key: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return true;
  } catch (err) {
    const name = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (name.name === 'NotFound' || name.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

/** Synthesize the passage with Polly (neural) and upload the MP3 to S3. */
export async function synthesizeReadingAudio(args: {
  text: string;
  key: string;
  voiceId: string;
  languageCode: string;
}): Promise<void> {
  await synthesizeToS3({
    polly: polly(),
    s3: s3(),
    bucket: bucket(),
    key: args.key,
    text: args.text,
    voiceId: args.voiceId,
    languageCode: args.languageCode,
  });
}
