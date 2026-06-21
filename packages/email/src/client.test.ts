import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendMock = vi.fn();
// NB: the constructor pattern uses `this`-assignment rather than `() => ({...})`
// because vitest 4.1.5's vi.fn() does not honor implementations that return a
// value when invoked with `new` — same pattern used in packages/ai/src/observability.test.ts.
vi.mock('resend', () => ({
  Resend: vi.fn(function (this: { emails: { send: typeof sendMock } }) {
    this.emails = { send: sendMock };
  }),
}));

describe('sendEmail', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env = { ...OLD_ENV };
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('logs and does NOT call Resend when RESEND_API_KEY is unset', async () => {
    delete process.env.RESEND_API_KEY;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { sendEmail } = await import('./client');
    const res = await sendEmail({
      to: 'a@b.com',
      subject: 'hi',
      html: '<p>hi</p>',
      text: 'hi',
    });
    expect(sendMock).not.toHaveBeenCalled();
    expect(res).toEqual({ id: null, delivered: false });
    expect(logSpy).toHaveBeenCalled();
  });

  it('calls Resend with the default from + headers when the key is set', async () => {
    process.env.RESEND_API_KEY = 'test_key';
    sendMock.mockResolvedValue({ data: { id: 'eml_1' }, error: null });
    const { sendEmail } = await import('./client');
    const res = await sendEmail({
      to: 'a@b.com',
      subject: 'hi',
      html: '<p>hi</p>',
      text: 'hi',
      headers: { 'List-Unsubscribe': '<https://x/u>' },
    });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Language Drill <summary@langdrill.app>',
        to: 'a@b.com',
        subject: 'hi',
        headers: { 'List-Unsubscribe': '<https://x/u>' },
      }),
    );
    expect(res).toEqual({ id: 'eml_1', delivered: true });
  });

  it('throws when Resend returns an error', async () => {
    process.env.RESEND_API_KEY = 'test_key';
    sendMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { sendEmail } = await import('./client');
    await expect(
      sendEmail({ to: 'a@b.com', subject: 'h', html: 'h', text: 'h' }),
    ).rejects.toThrow('boom');
  });
});
