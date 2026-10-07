import { describe, expect, it } from 'vitest';
import { createTagger, type TaggerTeam } from './tagger.js';

const TEAMS: TaggerTeam[] = [
  { id: '13', abbr: 'LAL', shortName: 'Lakers' },
  { id: '16', abbr: 'MIN', shortName: 'Timberwolves' },
  { id: '20', abbr: 'PHI', shortName: '76ers' },
  { id: '14', abbr: 'MIA', shortName: 'Heat' },
  { id: '19', abbr: 'ORL', shortName: 'Magic' },
  { id: '22', abbr: 'POR', shortName: 'Trail Blazers' },
];
const PLAYERS = ['LeBron James', 'Ariel Hukporti', 'Karl-Anthony Towns', 'Karl-Anthony Towns Jr.'];

const tag = (title: string, summary: string | null = null, tagger = createTagger(TEAMS, PLAYERS)) =>
  tagger.tag({ title, summary, teamIds: [], playerNames: [] });

describe('createTagger · teams by name', () => {
  it('finds the team in the title or in the summary', () => {
    expect(tag('Lakers beat the Timberwolves').teams.sort()).toEqual(['LAL', 'MIN']);
    expect(tag('Big night', 'The 76ers won again').teams).toEqual(['PHI']);
  });

  it('knows the nicknames', () => {
    expect(tag('Problemas en los nuevos Sixers').teams).toEqual(['PHI']);
    expect(tag('The Wolves rally').teams).toEqual(['MIN']);
    expect(tag('Blazers owner speaks').teams).toEqual(['POR']);
  });

  it('works with Spanish text and accented neighbours', () => {
    expect(tag('Los Lakers de LeBron: «¡Vamos!»').teams).toEqual(['LAL']);
  });

  it('needs the whole word and the capital letter', () => {
    expect(tag('Lakersfield is a place').teams).toEqual([]);
    expect(tag('The heat of the moment').teams).toEqual([]);
    expect(tag('Giannis leaning into Heat Culture').teams).toEqual(['MIA']);
  });

  it('does not take Magic Johnson for the Orlando Magic', () => {
    expect(tag('Magic Johnson praises the league').teams).toEqual([]);
    expect(tag('Magic win their opener').teams).toEqual(['ORL']);
  });

  it('is empty when no team is named', () => {
    expect(tag('Adam Silver discusses plans in Europe').teams).toEqual([]);
  });
});

describe('createTagger · players by name', () => {
  it('finds the full name of a known player', () => {
    expect(tag('LeBron James shoots down rumor').players).toEqual(['LeBron James']);
    expect(tag('Injury', 'Ariel Hukporti tore his Achilles').players).toEqual(['Ariel Hukporti']);
  });

  it('prefers the longest name', () => {
    expect(tag('Karl-Anthony Towns Jr. arrives').players).toEqual(['Karl-Anthony Towns Jr.']);
  });

  it('knows no one until ESPN has labelled someone', () => {
    expect(tag('LeBron James shoots down rumor', null, createTagger(TEAMS, [])).players).toEqual(
      [],
    );
  });
});

describe('createTagger · when the source labels the item itself', () => {
  const tagger = createTagger(TEAMS, PLAYERS);

  it("uses ESPN's labels as they are and does not search the text", () => {
    const tags = tagger.tag({
      title: 'Lakers and Timberwolves',
      summary: null,
      teamIds: ['20'],
      playerNames: ['Ariel Hukporti'],
    });
    expect(tags).toEqual({ teams: ['PHI'], players: ['Ariel Hukporti'] });
  });

  it('ignores a team id it does not know (an international club)', () => {
    expect(
      tagger.tag({ title: 'x', summary: null, teamIds: ['111837', '22'], playerNames: [] }).teams,
    ).toEqual(['POR']);
  });
});
