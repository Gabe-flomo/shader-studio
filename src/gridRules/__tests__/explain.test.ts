/**
 * The Grid Rules editor's explanations (gridRules/explain.ts): the 3×3 pictures on the Born /
 * Survive switches, the switch words, the one-sentence summary for several rules, the
 * neighbourhood pictures and the mini-board's test patterns.
 */
import { describe, expect, it } from 'vitest';
import {
  countLabel, countedCells, formatCounts, liveCount, neighbourPicture, patternBoard, patternCells, rangeCounts, ruleSentence, surviveFate,
} from '../explain';
import { cpuStep } from '../cpu';
import { COUNT_PRESETS, GRID_DEFAULTS, countsOf } from '../spec';

/** A picture as text: # live, . empty, x unused, row by row. */
const draw = (cells: string[]) => [0, 1, 2].map(r => cells.slice(r * 3, r * 3 + 3).map(c => (c === 'live' ? '#' : c === 'empty' ? '.' : 'x')).join('')).join('/');

describe('3×3 neighbour pictures', () => {
  it('Born row: the centre empty, k neighbours filled clockwise from the top left', () => {
    expect(draw(neighbourPicture(0))).toBe('.../.../...');
    expect(draw(neighbourPicture(1))).toBe('#../.../...');
    expect(draw(neighbourPicture(3))).toBe('###/.../...');
    expect(draw(neighbourPicture(4))).toBe('###/..#/...');
    expect(draw(neighbourPicture(8))).toBe('###/#.#/###');
  });

  it('Survive row: the centre live, and it is never counted as a neighbour', () => {
    expect(draw(neighbourPicture(2, 'moore', true))).toBe('##./.#./...');
    for (let k = 0; k <= 8; k++) {
      const pic = neighbourPicture(k, 'moore', true);
      expect(pic.filter((c, i) => i !== 4 && c === 'live')).toHaveLength(k);
      expect(pic[4]).toBe('live');
    }
  });

  it('von Neumann: only the four beside the cell, the corners unused', () => {
    expect(draw(neighbourPicture(0, 'vonNeumann'))).toBe('x.x/.../x.x');
    expect(draw(neighbourPicture(2, 'vonNeumann'))).toBe('x#x/..#/x.x');
    expect(draw(neighbourPicture(4, 'vonNeumann', true))).toBe('x#x/###/x#x');
    // More than the neighbourhood holds: clamped.
    expect(neighbourPicture(7, 'vonNeumann').filter(c => c === 'live')).toHaveLength(4);
  });

  it('neighbourhoods as highlighted cells', () => {
    const moore = countedCells('moore');
    expect(moore.size).toBe(3);
    expect(moore.cells.filter(Boolean)).toHaveLength(8);
    expect(moore.cells[4]).toBe(false);
    const vn = countedCells('vonNeumann');
    expect(vn.cells.map(c => (c ? '#' : '.')).join('')).toBe('.#.#.#.#.');
    const box = countedCells('radius', 2, 'box');
    expect(box.size).toBe(5);
    expect(box.cells.filter(Boolean)).toHaveLength(24);
    const circle = countedCells('radius', 2, 'circle');
    expect(circle.cells.filter(Boolean).length).toBeLessThan(24);
    expect(circle.cells[0]).toBe(false); // a corner is outside the circle
  });
});

describe('switch words', () => {
  const life = { born: [3], survive: [2, 3] };
  it('Born: comes alive or stays empty', () => {
    expect(countLabel('born', 3, life.born, life.survive)).toBe('empty + 3 neighbours → comes alive');
    expect(countLabel('born', 1, life.born, life.survive)).toBe('empty + 1 neighbour → stays empty');
  });
  it('Survive: stays alive, dies of loneliness below, too crowded above', () => {
    expect(countLabel('survive', 2, life.born, life.survive)).toBe('live + 2 → stays alive');
    expect(countLabel('survive', 1, life.born, life.survive)).toBe('live + 1 → dies of loneliness');
    expect(countLabel('survive', 4, life.born, life.survive)).toBe('live + 4 → dies (too crowded)');
    expect(surviveFate(5, [1, 3, 5, 7])).toBe('survives');
    expect(surviveFate(4, [1, 3, 5, 7])).toBe('dies');
    expect(surviveFate(4, [])).toBe('dies');
  });
  it('Stages: a cell starts dying instead', () => {
    expect(countLabel('survive', 6, [2], [3, 4, 5], true)).toBe('live + 6 → starts dying (too crowded)');
    expect(countLabel('survive', 0, [2], [3, 4, 5], true)).toBe('live + 0 → starts dying (lonely)');
  });
});

describe('the one-sentence summary', () => {
  const sentence = (key: string, max = 8) => {
    const p = COUNT_PRESETS[key].params;
    return ruleSentence({ born: countsOf(Number(p.bornMask), max), survive: countsOf(Number(p.surviveMask), max), max });
  };
  it('Life, word for word', () => {
    expect(sentence('life')).toBe('Cells are born with exactly 3 neighbours and survive with 2 or 3; fewer and they die of loneliness, more and they die of crowding.');
  });
  it('HighLife: two born counts', () => {
    expect(sentence('highLife')).toBe('Cells are born with 3 or 6 neighbours and survive with 2 or 3; fewer and they die of loneliness, more and they die of crowding.');
  });
  it('Seeds: nothing survives', () => {
    expect(ruleSentence({ born: [2], survive: [], max: 8 })).toBe('Cells are born with exactly 2 neighbours, and no live cell survives a step.');
  });
  it('a run of counts reads as a range; only one side dies', () => {
    expect(ruleSentence({ born: [3], survive: [4, 5, 6, 7, 8], max: 8 })).toBe('Cells are born with exactly 3 neighbours and survive with 4 to 8; fewer and they die of loneliness.');
    expect(ruleSentence({ born: [1], survive: [0, 1], max: 4 })).toBe('Cells are born with exactly 1 neighbour and survive with 0 or 1; more and they die of crowding.');
  });
  it('gaps, nothing born, any count', () => {
    expect(ruleSentence({ born: [3, 6, 8], survive: [1, 3, 5, 7], max: 8 })).toBe('Cells are born with 3, 6 or 8 neighbours and survive with 1, 3, 5 or 7; any other count and they die.');
    expect(ruleSentence({ born: [], survive: [2, 3], max: 8 })).toBe('Nothing is ever born, and live cells survive with 2 or 3; fewer and they die of loneliness, more and they die of crowding.');
    expect(ruleSentence({ born: [3], survive: [0, 1, 2, 3, 4, 5, 6, 7, 8], max: 8 })).toBe('Cells are born with exactly 3 neighbours, and live cells survive with any count.');
  });
  it('Stages: start dying, and the dying stages counted', () => {
    expect(ruleSentence({ born: [2], survive: [], max: 8, stages: true, states: 3 })).toBe('Cells are born with exactly 2 neighbours, and every live cell starts dying the next step. A dying cell fades through 1 stage before it is empty.');
    expect(ruleSentence({ born: [2], survive: [3, 4, 5], max: 8, stages: true, states: 6 })).toBe('Cells are born with exactly 2 neighbours and survive with 3 to 5; fewer and they start dying of loneliness, more and they start dying of crowding. A dying cell fades through 4 stages before it is empty.');
  });
  it('a Larger than Life range', () => {
    expect(ruleSentence({ born: rangeCounts(34, 45), survive: rangeCounts(33, 57), max: 120 })).toBe('Cells are born with 34 to 45 neighbours and survive with 33 to 57; fewer and they die of loneliness, more and they die of crowding.');
  });
  it('formatCounts', () => {
    expect(formatCounts([3])).toBe('exactly 3');
    expect(formatCounts([3, 2])).toBe('2 or 3');
    expect(formatCounts([])).toBe('no count');
  });
});

describe('mini-board test patterns', () => {
  const life = { ...GRID_DEFAULTS, ...COUNT_PRESETS.life.params, ruleType: 'count' };
  it('each pattern has its cells, centred', () => {
    expect(patternCells('glider')).toHaveLength(5);
    expect(patternCells('blinker')).toHaveLength(3);
    expect(patternCells('rpentomino')).toHaveLength(5);
    expect(patternCells('blob', () => 0).length).toBeGreaterThan(20);
    expect(patternCells('blob', () => 0.99)).toHaveLength(0);
    expect(liveCount(patternBoard('glider'))).toBe(5);
  });
  it('in Life a blinker blinks and a glider keeps its five cells', () => {
    let b = patternBoard('blinker', 16, 16);
    const start = Array.from(b.a);
    b = cpuStep(life, b);
    expect(Array.from(b.a)).not.toEqual(start);
    expect(liveCount(b)).toBe(3);
    b = cpuStep(life, b);
    expect(Array.from(b.a)).toEqual(start);
    let g = patternBoard('glider', 16, 16);
    for (let k = 0; k < 8; k++) { g = cpuStep(life, g); expect(liveCount(g)).toBe(5); }
  });
});
