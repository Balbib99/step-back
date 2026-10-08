import type { PlayerLine } from '@step-back/shared';
import { useState } from 'react';
import { initialsOf } from '../lib/boxscore';

/**
 * A player's face, cut out against the team's colour, or his initials when there is no photo (or
 * it does not load). The parent paints the background (`team-field`) and sets the size.
 */
export function PlayerFace({
  player,
  imageClassName,
  initialsClassName,
}: {
  player: Pick<PlayerLine, 'shortName' | 'photoUrl'>;
  imageClassName: string;
  initialsClassName: string;
}) {
  const [failed, setFailed] = useState(false);
  if (player.photoUrl && !failed) {
    return (
      <img
        src={player.photoUrl}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={imageClassName}
      />
    );
  }
  return (
    <span aria-hidden="true" className={`voice-name grid place-items-center ${initialsClassName}`}>
      {initialsOf(player.shortName)}
    </span>
  );
}
