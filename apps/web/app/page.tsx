import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { DrillLanding } from './_landing/drill-landing';
import { DrillLandingMobile } from './_landing/drill-landing-mobile';
import { LandingDarkCanvas } from './_landing/landing-dark-canvas';
import { publicPageMetadata } from '../lib/public-metadata';

export const metadata: Metadata = publicPageMetadata({
  title: 'drill — type it, don’t tap it',
  description:
    'Read real prose, save the words you trip on, and drill them back by typing the answer — not picking it. drill grades every keystroke and coaches the miss on the spot.',
  path: '/',
  // Already carries the brand. (The root `title.template` would skip it
  // anyway — this page shares the layout's segment.)
  absoluteTitle: true,
});

// The public marketing landing. Signed-in visitors skip it and land on their
// dashboard; everyone else sees the page.
export default async function LandingPage() {
  const { userId } = await auth();
  if (userId) redirect('/home');
  // Both trees are server-rendered; landing.css's .landing-desktop/.landing-mobile
  // display toggle (at 760px) shows exactly one, so first paint is correct on
  // either viewport without a hydration flash.
  return (
    <>
      <LandingDarkCanvas />
      <div className="landing-desktop">
        <DrillLanding />
      </div>
      <div className="landing-mobile">
        <DrillLandingMobile />
      </div>
    </>
  );
}
