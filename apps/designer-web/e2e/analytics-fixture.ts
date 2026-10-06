import type { AnalyticsDashboard as Dashboard } from '@verbis/shared-types';

export const analyticsFixture: Dashboard = {
  generatedAt: '2026-10-03T12:00:00.000Z',
  sampleEvents: 80,
  sessions: 20,
  completed: 15,
  completionRate: 0.75,
  meanDurationMs: 125000,
  scripts: [
    {
      key: 'onboarding',
      sessions: 20,
      completed: 15,
      completionRate: 0.75,
      meanDurationMs: 125000,
    },
  ],
  agents: [
    {
      key: 'a'.repeat(64),
      sessions: 20,
      completed: 15,
      completionRate: 0.75,
      meanDurationMs: 125000,
    },
  ],
  pages: [
    {
      key: 'welcome',
      visits: 20,
      sessions: 20,
      meanDwellMs: 30000,
      dropOff: 2,
      dropOffRate: 0.1,
    },
    {
      key: 'offer',
      visits: 18,
      sessions: 18,
      meanDwellMs: 50000,
      dropOff: 3,
      dropOffRate: 3 / 18,
    },
  ],
  paths: [
    { source: 'welcome', target: 'offer', count: 18 },
    { source: 'offer', target: 'complete', count: 15 },
  ],
  outcomes: [
    { key: 'sale', count: 12 },
    { key: 'callback', count: 3 },
  ],
  sources: [{ key: 'customer-lookup', calls: 20, meanLatencyMs: 150, errorRate: 0.05 }],
  heatmap: [],
  compliance: { eligible: 20, acknowledged: 18, rate: 0.9 },
  variants: [
    {
      experimentId: 'sample',
      key: 'A',
      sessions: 10,
      completed: 6,
      completionRate: 0.6,
      meanDurationMs: 140000,
    },
    {
      experimentId: 'sample',
      key: 'B',
      sessions: 10,
      completed: 9,
      completionRate: 0.9,
      meanDurationMs: 110000,
    },
  ],
  comparisons: [
    {
      experimentId: 'sample',
      a: 'A',
      b: 'B',
      difference: 0.3,
      pValue: null,
      significant: false,
      reason: 'insufficient',
    },
  ],
  active: [
    {
      sessionId: 'session-fixture',
      scriptId: 'onboarding',
      campaignId: 'campaign-fixture',
      agent: null,
      state: 'active',
      since: '2026-10-03T11:55:00Z',
    },
  ],
  liveCampaigns: [{ key: 'campaign-fixture', active: 1, completed: 15 }],
};
