#!/usr/bin/env node
// `pnpm shoot` ergonomics: map --flag value onto the SHOOT_* env vars that
// shoot.spec.ts reads, then run the `shoot` Playwright project. Example:
//   pnpm shoot --route /review --theme dark --viewport mobile
//   pnpm shoot --route /read --animate
// Route is an app path. The dashboard landing is `/` (the app uses a
// `(dashboard)` route GROUP, so there is no `/dashboard` URL).
import { spawnSync } from 'node:child_process';

const VALUE_FLAGS = {
  '--route': 'SHOOT_ROUTE',
  '--theme': 'SHOOT_THEME',
  '--viewport': 'SHOOT_VIEWPORT',
  '--wait': 'SHOOT_WAIT',
  '--out': 'SHOOT_OUT',
};
const BOOL_FLAGS = {
  '--animate': 'SHOOT_ANIMATE',
  '--full-stack': 'SHOOT_FULL_STACK',
};

const env = { ...process.env };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (VALUE_FLAGS[arg]) {
    const value = argv[++i];
    if (value === undefined) {
      console.error(`[shoot] ${arg} needs a value`);
      process.exit(2);
    }
    env[VALUE_FLAGS[arg]] = value;
  } else if (BOOL_FLAGS[arg]) {
    env[BOOL_FLAGS[arg]] = '1';
  } else {
    console.error(`[shoot] unknown flag: ${arg}`);
    process.exit(2);
  }
}

if (!env.SHOOT_ROUTE) {
  console.error('[shoot] --route is required, e.g. `pnpm shoot --route /read`');
  process.exit(2);
}

const result = spawnSync(
  'playwright',
  ['test', '--project=shoot'],
  { stdio: 'inherit', env, shell: process.platform === 'win32' },
);
process.exit(result.status ?? 1);
