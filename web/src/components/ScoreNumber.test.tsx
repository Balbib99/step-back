import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScoreNumber } from './ScoreNumber';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('ScoreNumber', () => {
  it('does not animate the first time it is shown', () => {
    const { getByLabelText } = render(<ScoreNumber value={78} />);
    expect(getByLabelText('78 puntos')).not.toHaveClass('score-tick');
  });

  it('ticks when the score changes, as when a team scores', () => {
    const { getByLabelText, rerender } = render(<ScoreNumber value={78} />);
    rerender(<ScoreNumber value={81} />);
    expect(getByLabelText('81 puntos')).toHaveClass('score-tick');
  });

  it('stops ticking after a moment, and does not tick for the same score again', () => {
    const { getByLabelText, rerender } = render(<ScoreNumber value={78} />);
    rerender(<ScoreNumber value={81} />);
    wait(300);
    expect(getByLabelText('81 puntos')).not.toHaveClass('score-tick');

    rerender(<ScoreNumber value={81} />);
    expect(getByLabelText('81 puntos')).not.toHaveClass('score-tick');
  });

  it('ticks again on the next change', () => {
    const { getByLabelText, rerender } = render(<ScoreNumber value={78} />);
    rerender(<ScoreNumber value={81} />);
    wait(300);
    rerender(<ScoreNumber value={83} />);
    expect(getByLabelText('83 puntos')).toHaveClass('score-tick');
  });

  it('keeps the classes it is given', () => {
    const { getByLabelText } = render(<ScoreNumber value={10} className="voice-number" />);
    expect(getByLabelText('10 puntos')).toHaveClass('voice-number');
  });
});
