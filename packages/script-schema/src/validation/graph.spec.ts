import { describe, expect, it } from 'vitest';

import { cycles, reachable, stronglyConnectedComponents } from './graph.js';

const graph = (edges: Record<string, string[]>) => (vertex: string) => edges[vertex] ?? [];

describe('stronglyConnectedComponents', () => {
  it('groups cycles and keeps singletons', () => {
    const successors = graph({ a: ['b'], b: ['c', 'd'], c: ['a'], d: ['e'], e: [] });
    const components = stronglyConnectedComponents(['a', 'b', 'c', 'd', 'e'], successors);
    expect(components.map((component) => [...component].sort())).toEqual(
      expect.arrayContaining([['a', 'b', 'c'], ['d'], ['e']]),
    );
  });

  it('handles disconnected vertices and deep chains without recursion limits', () => {
    const size = 20_000;
    const vertices = Array.from({ length: size }, (_, i) => `v${i}`);
    const successors = (vertex: string) => {
      const next = Number(vertex.slice(1)) + 1;
      return next < size ? [`v${next}`] : ['v0'];
    };
    expect(stronglyConnectedComponents(vertices, successors)).toHaveLength(1);
  });
});

describe('cycles', () => {
  it('reports multi-vertex cycles and self-loops only', () => {
    const successors = graph({ a: ['a'], b: ['c'], c: ['b'], d: [] });
    expect(cycles(['a', 'b', 'c', 'd'], successors).map((c) => [...c].sort())).toEqual([
      ['a'],
      ['b', 'c'],
    ]);
    expect(cycles(['x'], graph({}))).toEqual([]);
  });
});

describe('reachable', () => {
  it('walks breadth-first and tolerates cycles', () => {
    const successors = graph({ a: ['b'], b: ['a', 'c'], c: [], d: ['a'] });
    expect([...reachable(['a'], successors)].sort()).toEqual(['a', 'b', 'c']);
    expect(reachable([], successors).size).toBe(0);
  });
});
