import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsNav, SETTINGS_SECTIONS } from '../settings-nav';

describe('SettingsNav', () => {
  it('renders a button per section and reports jumps', () => {
    const onJump = vi.fn();
    render(<SettingsNav activeId="languages" onJump={onJump} />);
    for (const s of SETTINGS_SECTIONS) {
      expect(screen.getByRole('button', { name: s.label })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: /goals/i }));
    expect(onJump).toHaveBeenCalledWith('goals');
  });
});
