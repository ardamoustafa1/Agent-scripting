const path = require('node:path');
module.exports = {
  ci: {
    collect: {
      staticDistDir: path.join(__dirname, 'apps/agent-web/dist'),
      url: ['http://localhost/'],
      numberOfRuns: 3,
      settings: {
        onlyCategories: ['performance', 'accessibility'],
        chromeFlags: '--headless --no-sandbox',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.95, aggregationMethod: 'median' }],
        'categories:accessibility': ['error', { minScore: 1, aggregationMethod: 'pessimistic' }],
      },
    },
    upload: { target: 'filesystem', outputDir: path.join(__dirname, 'test-results/lighthouse') },
  },
};
