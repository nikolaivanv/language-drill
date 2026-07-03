import type { Metadata } from 'next';
import { WhyNotPage } from '../_landing/why-not-chatgpt';
import { WhyNotMobile } from '../_landing/why-not-chatgpt-mobile';
import { LandingDarkCanvas } from '../_landing/landing-dark-canvas';

export const metadata: Metadata = {
  title: 'drill — why not just ChatGPT?',
  description:
    'ChatGPT can write and grade exercises — that’s what inspired drill. But daily practice in a chat drifts off your level, repeats itself and forgets your mistakes. Here’s the point-by-point comparison.',
};

// Standalone marketing deep-dive linked from the landing's "Why not ChatGPT?"
// section. Public, and (unlike `/`) not redirected for signed-in users — the
// comparison is worth reading either way.
export default function WhyNotChatGPTPage() {
  // Both trees are server-rendered; landing.css's .landing-desktop/.landing-mobile
  // display toggle (at 760px) shows exactly one, so first paint is correct on
  // either viewport without a hydration flash.
  return (
    <>
      <LandingDarkCanvas />
      <div className="landing-desktop">
        <WhyNotPage />
      </div>
      <div className="landing-mobile">
        <WhyNotMobile />
      </div>
    </>
  );
}
