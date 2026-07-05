import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CopyId } from '../copy-id';

const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

beforeEach(() => {
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
});

describe('CopyId', () => {
  it('renders the label and a short id prefix, keeping the full id in title', () => {
    render(<CopyId id="0d9f3a12-4b56-7890-abcd-ef0123456789" label="session" />);
    const btn = screen.getByRole('button', { name: /copy session id/i });
    expect(btn).toHaveTextContent('session');
    expect(btn).toHaveTextContent('0d9f3a12…');
    expect(btn).toHaveAttribute('title', '0d9f3a12-4b56-7890-abcd-ef0123456789');
  });

  it('copies the FULL id on click and shows transient feedback', async () => {
    render(<CopyId id="0d9f3a12-4b56-7890-abcd-ef0123456789" label="user" />);
    fireEvent.click(screen.getByRole('button', { name: /copy user id/i }));
    expect(writeText).toHaveBeenCalledWith('0d9f3a12-4b56-7890-abcd-ef0123456789');
    await waitFor(() => expect(screen.getByText('✓')).toBeInTheDocument());
  });

  it('does not bubble the click to a parent handler (rows are clickable)', () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <CopyId id="abcdefgh-1234" label="exercise" />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /copy exercise id/i }));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('shows no false feedback when the clipboard is unavailable', async () => {
    Object.assign(navigator, { clipboard: undefined });
    render(<CopyId id="abcdefgh-1234" label="session" />);
    fireEvent.click(screen.getByRole('button', { name: /copy session id/i }));
    await waitFor(() => expect(screen.queryByText('✓')).not.toBeInTheDocument());
  });
});
