function markdownList(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- None detected';
}

export function generateRepositoryDocumentation(repository) {
  const components = repository.architecture.map((component) => `${component.label}: ${component.fileCount} files`);
  const endpoints = repository.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path} (${endpoint.file})`);
  const test = repository.testIntelligence ?? {};
  return [
    {
      id: 'overview',
      title: `${repository.name} overview`,
      type: 'Overview',
      content: `# ${repository.name}\n\n${repository.summary.fileCount} source files were analyzed on ${repository.analyzedAt}.\n\n## Languages\n${markdownList(Object.entries(repository.summary.languageCounts).map(([language, count]) => `${language}: ${count} files`))}\n\n## Git\n- Branch: ${repository.git?.branch ?? 'Unavailable'}\n- Head: ${repository.git?.headCommit ?? 'Unavailable'}`
    },
    {
      id: 'architecture',
      title: 'Architecture map',
      type: 'Architecture',
      content: `# Architecture\n\n## Components\n${markdownList(components)}\n\n## Imports\n${repository.summary.importCount} imports were mapped across the repository.`
    },
    {
      id: 'api-reference',
      title: 'API reference',
      type: 'API reference',
      content: `# API reference\n\n${markdownList(endpoints)}`
    },
    {
      id: 'test-intelligence',
      title: 'Test intelligence',
      type: 'Testing',
      content: `# Test intelligence\n\n- Test files: ${test.testFileCount ?? 0}\n- Source files: ${test.sourceFileCount ?? 0}\n- Source files with linked tests: ${test.coveredFileCount ?? 0}\n- Linked-test coverage: ${test.coveragePercent ?? 0}%\n\n## Largest gaps\n${markdownList((test.gaps ?? []).slice(0, 12))}`
    }
  ];
}
