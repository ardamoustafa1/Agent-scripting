import { describe, expect, it } from 'vitest';

import { releaseRisk, removedPages, type RiskInput } from './risk.js';

const safe: RiskInput = {
  health: { score: 96, errors: 0 },
  scenarios: 4,
  coveragePercent: 100,
  changes: 3,
  removedPages: 0,
  newDataFlows: 0,
  riskyNewDataFlows: 0,
  impact: { assignments: 1, campaigns: 1 },
};

describe('releaseRisk', () => {
  it('rates a tested, healthy, small change low with no factors', () => {
    expect(releaseRisk(safe)).toEqual({ level: 'low', score: 0, factors: [] });
  });

  it('explains every factor and orders them by weight', () => {
    const risk = releaseRisk({
      ...safe,
      health: { score: 40, errors: 2 },
      scenarios: 0,
      changes: 80,
      removedPages: 1,
      newDataFlows: 3,
      riskyNewDataFlows: 1,
      impact: { assignments: 7, campaigns: 2 },
    });
    expect(risk.level).toBe('high');
    expect(risk.score).toBe(100);
    expect(risk.factors.map((f) => f.factor)).toEqual([
      'blockingIssues',
      'noTests',
      'newExposure',
      'largeChange',
      'newDataFlows',
      'removedPages',
      'wideImpact',
    ]);
  });

  it.each([
    [{ coveragePercent: 30 }, 'lowCoverage', 'medium'],
    [{ coveragePercent: 70 }, 'partialCoverage', 'low'],
    [{ health: { score: 60, errors: 0 } }, 'lowHealth', 'low'],
    [{ changes: 20 }, 'mediumChange', 'low'],
    [{ riskyNewDataFlows: 2, newDataFlows: 2 }, 'newExposure', 'high'],
  ] as const)('%o adds %s', (patch, factor, level) => {
    const risk = releaseRisk({ ...safe, ...patch });
    expect(risk.factors.map((f) => f.factor)).toEqual([factor]);
    expect(risk.level).toBe(level);
  });

  it('ignores reach it cannot see and coverage it has not measured', () => {
    expect(releaseRisk({ ...safe, impact: null, coveragePercent: null }).factors).toEqual([]);
  });
});

describe('removedPages', () => {
  it('counts only whole-page removals', () => {
    expect(
      removedPages([
        { op: 'remove', path: '/pages/2' },
        { op: 'remove', path: '/pages/0/layout/children/1' },
        { op: 'add', path: '/pages/3' },
      ]),
    ).toBe(1);
  });
});
