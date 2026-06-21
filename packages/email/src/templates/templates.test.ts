import { describe, it, expect } from 'vitest';
import { renderEmail } from '../render';
import { ConfirmSubscriptionEmail } from './confirm-subscription';
import { WeeklySummaryEmail } from './weekly-summary';

describe('email templates', () => {
  it('confirm email contains the confirm URL', async () => {
    const { html, text } = await renderEmail(
      ConfirmSubscriptionEmail({ confirmUrl: 'https://api.x/email/confirm?token=abc' }),
    );
    expect(html).toContain('https://api.x/email/confirm?token=abc');
    expect(text).toContain('https://api.x/email/confirm?token=abc');
  });

  it('weekly summary renders counts, movers, focus, CTA and unsubscribe link', async () => {
    const { html } = await renderEmail(
      WeeklySummaryEmail({
        exercisesCompleted: 42,
        languagesPracticed: ['Spanish', 'Turkish'],
        daysActive: 5,
        movers: ['Ser vs estar'],
        focus: ['Subjunctive mood', 'Past tense'],
        practiceUrl: 'https://langdrill.app',
        unsubscribeUrl: 'https://api.x/email/unsubscribe?token=u',
      }),
    );
    expect(html).toContain('42');
    expect(html).toContain('Ser vs estar');
    expect(html).toContain('Subjunctive mood');
    expect(html).toContain('https://langdrill.app');
    expect(html).toContain('https://api.x/email/unsubscribe?token=u');
    // No-gamification guard: copy must not introduce streak/XP language.
    expect(html.toLowerCase()).not.toContain('streak');
    expect(html.toLowerCase()).not.toContain(' xp');
  });
});
