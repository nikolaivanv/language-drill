/**
 * Seed dictation exercises: insert the clip rows (idempotent, deterministic
 * UUIDs) and synthesize each clip's audio once via AWS Polly → private S3,
 * storing the S3 key on exercises.audio_s3_key.
 *
 * Usage:
 *   DATABASE_URL=... CONTENT_BUCKET_NAME=... AWS_REGION=eu-central-1 \
 *     npx tsx packages/db/scripts/seed-dictation.ts
 *
 * Requires AWS creds with polly:SynthesizeSpeech and s3:PutObject/HeadObject.
 * Re-runnable: existing rows are skipped (ON CONFLICT DO NOTHING) and existing
 * audio objects are not re-synthesized (HeadObject check).
 */

import { fileURLToPath } from 'node:url';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  PollyClient,
  SynthesizeSpeechCommand,
  type SynthesizeSpeechCommandInput,
} from '@aws-sdk/client-polly';
import { eq } from 'drizzle-orm';

import { createDb, type Db } from '../src/client';
import { deterministicUuid } from '../src/lib/deterministic-uuid';
import { exercises } from '../src/schema/index';

export type DictationClip = {
  key: string;
  language: 'ES';
  difficulty: 'B1' | 'B2';
  voiceId: string;
  title: string;
  blurb: string;
  accent: string;
  domain: string;
  register: string;
  tested: string[];
  sentences: string[];
  durationSec: number;
  waveform: number[];
};

const WAVE = [0.22, 0.5, 0.82, 0.44, 0.62, 0.9, 0.5, 0.28, 0.7, 0.4, 0.84, 0.36];

export const DICTATION_CLIPS: DictationClip[] = [
  {
    key: 'es-dictation-b2-1',
    language: 'ES',
    difficulty: 'B2',
    voiceId: 'Sergio',
    title: 'El tiempo lo cura todo',
    blurb: 'Alguien recuerda un consejo de su abuela y lo matiza desde la edad adulta.',
    accent: 'español peninsular · centro',
    domain: 'narrativa personal · reflexión',
    register: 'neutro',
    tested: ['Habla ligada (sinalefa)', 'Límites de palabra', 'Ortografía: h muda, tildes'],
    sentences: [
      'Cuando era niño, mi abuela siempre me decía que el tiempo lo cura todo.',
      'Ahora que soy mayor, me he dado cuenta de que no es del todo cierto.',
      'Hay heridas que no se curan; simplemente aprendemos a vivir con ellas.',
      'Aun así, sigo creyendo que vale la pena seguir adelante.',
    ],
    durationSec: 23,
    waveform: WAVE,
  },
  {
    key: 'es-dictation-b2-2',
    language: 'ES',
    difficulty: 'B2',
    voiceId: 'Lucia',
    title: 'Una reunión inesperada',
    blurb: 'Una trabajadora cuenta cómo una reunión de última hora le cambió los planes.',
    accent: 'español peninsular · norte',
    domain: 'vida laboral · anécdota',
    register: 'informal-neutro',
    tested: ['b/v confusión gráfica', 'Tildes en esdrújulas', 'Habla encadenada'],
    sentences: [
      'El viernes pasado, justo cuando iba a salir de la oficina, me avisaron de una reunión urgente.',
      'Tuve que llamar a mi pareja para decirle que llegaría tarde a cenar.',
      'La reunión duró casi dos horas, pero al final llegamos a un acuerdo bastante bueno.',
      'A veces las interrupciones inesperadas acaban siendo las más productivas.',
    ],
    durationSec: 24,
    waveform: WAVE,
  },
  {
    key: 'es-dictation-b2-3',
    language: 'ES',
    difficulty: 'B2',
    voiceId: 'Sergio',
    title: 'El viaje que cambió mi perspectiva',
    blurb: 'Un viajero reflexiona sobre lo que aprendió durante un viaje largo.',
    accent: 'español peninsular · centro',
    domain: 'viajes · reflexión personal',
    register: 'neutro',
    tested: ['Diptongos y triptongos', 'Ortografía: g/j', 'Subordinadas de relativo'],
    sentences: [
      'Después de pasar tres semanas viajando por el sur de Europa, volví a casa con una visión distinta del mundo.',
      'Conocer a personas de culturas tan diferentes me enseñó a cuestionar mis propios prejuicios.',
      'Lo que más me sorprendió fue la generosidad de la gente que apenas tenía recursos.',
      'Ese viaje me confirmó que los mejores aprendizajes no se encuentran en los libros.',
    ],
    durationSec: 26,
    waveform: WAVE,
  },
  {
    key: 'es-dictation-b2-4',
    language: 'ES',
    difficulty: 'B2',
    voiceId: 'Lucia',
    title: 'La tecnología y nuestra atención',
    blurb: 'Una reflexión sobre cómo el móvil afecta a nuestra capacidad de concentración.',
    accent: 'español peninsular · norte',
    domain: 'opinión · tecnología',
    register: 'formal-neutro',
    tested: ['Subjuntivo en opinión negativa', 'Tildes diacríticas', 'h muda'],
    sentences: [
      'Cada vez más estudios demuestran que el uso excesivo del teléfono reduce nuestra capacidad de atención.',
      'No creo que sea una exageración afirmar que hemos perdido el hábito de aburrirnos.',
      'Sin embargo, tampoco hay que demonizar la tecnología; todo depende del uso que hagamos de ella.',
      'El verdadero reto está en encontrar un equilibrio que nos permita desconectar cuando lo necesitamos.',
    ],
    durationSec: 27,
    waveform: WAVE,
  },
  {
    key: 'es-dictation-b1-1',
    language: 'ES',
    difficulty: 'B1',
    voiceId: 'Sergio',
    title: 'Mi rutina de los lunes',
    blurb: 'Alguien describe cómo empieza la semana de trabajo.',
    accent: 'español peninsular · centro',
    domain: 'vida cotidiana · rutina',
    register: 'informal',
    tested: ['Presente de indicativo', 'b/v en verbos', 'Conectores temporales'],
    sentences: [
      'Los lunes suelo levantarme a las siete y media y desayunar en casa antes de salir.',
      'Voy al trabajo en metro porque el trayecto no es muy largo y puedo leer durante el viaje.',
      'Por las tardes, cuando termino la jornada, intento dar un paseo corto antes de volver.',
    ],
    durationSec: 18,
    waveform: WAVE,
  },
  {
    key: 'es-dictation-b1-2',
    language: 'ES',
    difficulty: 'B1',
    voiceId: 'Lucia',
    title: 'Mi ciudad favorita',
    blurb: 'Una persona describe los aspectos que más le gustan de la ciudad donde vive.',
    accent: 'español peninsular · norte',
    domain: 'descripción · vida urbana',
    register: 'informal-neutro',
    tested: ['Ser/estar', 'Adjetivos de descripción', 'Ortografía: c/z/s'],
    sentences: [
      'La ciudad donde vivo tiene muchos parques y es fácil moverse en bicicleta.',
      'Lo que más me gusta es que hay mercados al aire libre casi todos los fines de semana.',
      'La gente es muy amable y siempre está dispuesta a ayudar a los visitantes que se pierden.',
    ],
    durationSec: 17,
    waveform: WAVE,
  },
];

export function toDictationContent(clip: DictationClip) {
  return {
    type: 'dictation' as const,
    title: clip.title,
    blurb: clip.blurb,
    referenceText: clip.sentences.join(' '),
    sentences: clip.sentences,
    accent: clip.accent,
    voiceId: clip.voiceId,
    domain: clip.domain,
    register: clip.register,
    tested: clip.tested,
    durationSec: clip.durationSec,
    waveform: clip.waveform,
  };
}

export function audioKeyFor(exerciseId: string): string {
  return `dictation/${exerciseId}.mp3`;
}

async function objectExists(s3: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function synthesizeToS3(
  polly: PollyClient,
  s3: S3Client,
  bucket: string,
  key: string,
  text: string,
  voiceId: string,
): Promise<void> {
  const input: SynthesizeSpeechCommandInput = {
    Engine: 'neural',
    OutputFormat: 'mp3',
    Text: text,
    VoiceId: voiceId as SynthesizeSpeechCommandInput['VoiceId'],
    LanguageCode: 'es-ES',
  };
  const out = await polly.send(new SynthesizeSpeechCommand(input));
  const bytes = await out.AudioStream!.transformToByteArray();
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: 'audio/mpeg' }),
  );
}

async function seedClip(
  db: Db,
  polly: PollyClient,
  s3: S3Client,
  bucket: string,
  clip: DictationClip,
) {
  const id = deterministicUuid(clip.key);
  const key = audioKeyFor(id);
  const content = toDictationContent(clip);

  if (!(await objectExists(s3, bucket, key))) {
    await synthesizeToS3(polly, s3, bucket, key, content.referenceText, clip.voiceId);
  }

  const inserted = await db
    .insert(exercises)
    .values({
      id,
      type: 'dictation',
      language: clip.language,
      difficulty: clip.difficulty,
      contentJson: content,
      audioS3Key: key,
    })
    .onConflictDoNothing()
    .returning({ id: exercises.id });

  if (inserted.length === 0) {
    await db.update(exercises).set({ audioS3Key: key }).where(eq(exercises.id, id));
  }
  return inserted.length > 0;
}

async function main() {
  const databaseUrl = process.env['DATABASE_URL'];
  const bucket = process.env['CONTENT_BUCKET_NAME'];
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  if (!bucket) {
    console.error('CONTENT_BUCKET_NAME is not set');
    process.exit(1);
  }

  const db = createDb(databaseUrl);
  const polly = new PollyClient({});
  const s3 = new S3Client({});

  let inserted = 0;
  for (const clip of DICTATION_CLIPS) {
    const isNew = await seedClip(db, polly, s3, bucket, clip);
    if (isNew) inserted++;
    console.log(`  ${clip.key}: ${isNew ? 'inserted' : 'already present'}`);
  }
  console.log(
    `\nDone. ${inserted} dictation exercise(s) created, ${DICTATION_CLIPS.length - inserted} skipped.`,
  );
}

const isDirectRun = process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error('Dictation seed failed:', err);
    process.exit(1);
  });
}
