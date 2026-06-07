import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { DrillLanding } from './_landing/drill-landing';
import { DrillLandingMobile } from './_landing/drill-landing-mobile';

export const metadata: Metadata = {
  title: 'drill — read, save, produce',
  description:
    'Read real prose, save the words you trip on, and drill them back by typing the answer — not picking it. drill grades every keystroke and coaches the miss on the spot.',
};

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
      <div className="landing-desktop">
        <DrillLanding />
      </div>
      <div className="landing-mobile">
        <DrillLandingMobile />
      </div>
    </>
  );
}
