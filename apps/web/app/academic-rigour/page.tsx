import type { Metadata } from 'next';
import { AcademicRigourPage } from '../_landing/academic-rigour';
import { AcademicRigourMobile } from '../_landing/academic-rigour-mobile';
import { LandingDarkCanvas } from '../_landing/landing-dark-canvas';

export const metadata: Metadata = {
  title: 'drill — academic rigour',
  description:
    'How drill builds its material and keeps it honest — grounded in official curricula and comprehensive grammars, calibrated to your CEFR level, and rewritten the moment the data says an item fell short.',
};

// Public marketing deep-dive on how the exercise material is made. Unlike the
// root landing it does not redirect signed-in visitors; it is reachable from the
// landing header and stat-band. The .landing-desktop / .landing-mobile CSS
// toggle (at 760px) shows exactly one tree, so first paint is correct on either
// viewport with no hydration flash.
export default function AcademicRigourRoute() {
  return (
    <>
      <LandingDarkCanvas />
      <div className="landing-desktop">
        <AcademicRigourPage />
      </div>
      <div className="landing-mobile">
        <AcademicRigourMobile />
      </div>
    </>
  );
}
