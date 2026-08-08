import { Fraunces, Inter, JetBrains_Mono, Caveat } from 'next/font/google';

export const fraunces = Fraunces({
  // latin-ext is load-bearing, not decorative: the display serif renders
  // target-language content (cloze/sentence-construction stems and the
  // learner's own typed answer). Turkish ğ/Ğ, ş/Ş and İ live in Latin
  // Extended-A, so on `latin` alone they silently fall back to Georgia
  // mid-word. (ı U+0131 is already in the latin subset.)
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-fraunces',
  axes: ['opsz', 'SOFT'],
});

export const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-inter',
  weight: ['400', '500', '600', '700'],
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
  weight: ['400', '500'],
});

export const caveat = Caveat({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-caveat',
  weight: '600',
});
