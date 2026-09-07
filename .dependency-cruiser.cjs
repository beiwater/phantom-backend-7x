/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'warn',
      comment: 'Warn on circular dependencies in server',
      from: {
        path: '^server'
      },
      to: {
        circular: true
      }
    },
    {
      name: 'core-no-higher-layers',
      severity: 'warn',
      comment: 'Core utilities should not depend on game, services, or routes',
      from: {
        path: '^server/core'
      },
      to: {
        path: '^server/(game|services|routes|application)'
      }
    }
  ],
  options: {
    doNotFollow: {
      path: 'node_modules'
    },
    exclude: '(frontend-original|historical|reconstruction|crawled_guides|test-results|artifacts)',
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json'
    }
  }
};
