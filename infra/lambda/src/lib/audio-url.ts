/**
 * Presign a private-S3 audio object as a time-limited GET URL.
 *
 * Dictation clip audio lives in the private content bucket. The browser cannot
 * read it directly; the API injects a presigned URL into the exercise response.
 * Returns null when there is no key or the bucket env is unset (callers degrade
 * gracefully — a dictation exercise with no audioUrl shows a disabled player).
 */

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** TTL comfortably exceeds a drill session (1 hour). */
const PRESIGN_TTL_SECONDS = 60 * 60;

let client: S3Client | null = null;
function s3(): S3Client {
  if (!client) client = new S3Client({});
  return client;
}

export async function presignAudioUrl(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  const bucket = process.env.CONTENT_BUCKET_NAME;
  if (!bucket) return null;
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: PRESIGN_TTL_SECONDS,
  });
}
