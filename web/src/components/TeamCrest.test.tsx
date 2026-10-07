import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TeamCrest } from './TeamCrest';

describe('TeamCrest', () => {
  it('shows the crest served by our own server', () => {
    const { container } = render(<TeamCrest abbr="MIN" src="/api/crests/MIN.png" />);
    const image = container.querySelector('img');
    expect(image).toHaveAttribute('src', '/api/crests/MIN.png');
    expect(image).toHaveAttribute('alt', ''); // decorative: the team name is always written next to it
  });

  it('writes the abbreviation for a club that has no crest, such as one outside the NBA', () => {
    const { container, getByText } = render(<TeamCrest abbr="LON" src={undefined} />);
    expect(container.querySelector('img')).toBeNull();
    expect(getByText('LON')).toBeInTheDocument();
  });

  it('falls back to the abbreviation when the image cannot be loaded', () => {
    const { container, getByText } = render(<TeamCrest abbr="MIN" src="/api/crests/MIN.png" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(getByText('MIN')).toBeInTheDocument();
  });

  it('uses the requested size', () => {
    const { container } = render(<TeamCrest abbr="MIN" src="/x.png" size={64} />);
    expect(container.querySelector('img')).toHaveStyle({ width: '64px', height: '64px' });
  });
});
