import {
  PollyClient,
  SynthesizeSpeechCommand,
  type SynthesizeSpeechCommandInput,
} from '@aws-sdk/client-polly';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * S3 key convention for dictation clips. This is the sole writer of the key; it
 * is stored on `exercises.audio_s3_key` and presigned verbatim at serve time by
 * `infra/lambda/src/lib/audio-url.ts` (a generic presigner that assumes no
 * particular key shape).
 */
export function dictationAudioKey(exerciseId: string): string {
  return `dictation/${exerciseId}.mp3`;
}

export type SynthesizeToS3Args = {
  polly: PollyClient;
  s3: S3Client;
  bucket: string;
  key: string;
  text: string;
  voiceId: string;
  /** BCP-47 Polly language code, e.g. 'es-ES'. Was hardcoded in the seed script. */
  languageCode: string;
};

/** Synthesize `text` with a Polly neural voice and upload the MP3 to S3. */
export async function synthesizeToS3(args: SynthesizeToS3Args): Promise<void> {
  const input: SynthesizeSpeechCommandInput = {
    Engine: 'neural',
    OutputFormat: 'mp3',
    Text: args.text,
    VoiceId: args.voiceId as SynthesizeSpeechCommandInput['VoiceId'],
    LanguageCode: args.languageCode as SynthesizeSpeechCommandInput['LanguageCode'],
  };
  const out = await args.polly.send(new SynthesizeSpeechCommand(input));
  const bytes = await out.AudioStream!.transformToByteArray();
  await args.s3.send(
    new PutObjectCommand({ Bucket: args.bucket, Key: args.key, Body: bytes, ContentType: 'audio/mpeg' }),
  );
}
