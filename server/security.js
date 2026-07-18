const rules = [
  {
    id: 'hardcoded-secret',
    severity: 'high',
    category: 'secret',
    title: 'Potential hardcoded credential',
    pattern: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"\n]{8,}['"]/i,
    detail: 'A credential-like value is embedded in source code.',
    remediation: 'Read the value from a protected environment variable or secret manager.'
  },
  {
    id: 'dynamic-code',
    severity: 'high',
    category: 'code execution',
    title: 'Dynamic code execution',
    pattern: /\b(?:eval|Function)\s*\(/,
    detail: 'Runtime code execution can turn untrusted input into arbitrary behavior.',
    remediation: 'Replace dynamic evaluation with a constrained parser or explicit control flow.'
  },
  {
    id: 'jwt-algorithm',
    severity: 'high',
    category: 'authentication',
    title: 'JWT verification may not allowlist algorithms',
    pattern: /\b(?:jwt\.)?verify\s*\([^\n]{0,240}\)/i,
    detail: 'JWT verification should explicitly restrict accepted signing algorithms.',
    remediation: 'Pass an algorithms allowlist that matches the configured signing key.'
  },
  {
    id: 'process-execution',
    severity: 'medium',
    category: 'code execution',
    title: 'Process execution surface',
    pattern: /\b(?:exec|execSync|spawn|spawnSync)\s*\(/,
    detail: 'Process execution requires strict validation of every argument.',
    remediation: 'Use fixed command names and argument arrays; never pass untrusted shell input.'
  },
  {
    id: 'html-injection',
    severity: 'medium',
    category: 'injection',
    title: 'HTML injection surface',
    pattern: /(?:dangerouslySetInnerHTML|\.innerHTML\s*=)/,
    detail: 'HTML insertion must be protected from untrusted content.',
    remediation: 'Use text rendering or sanitize content with a reviewed allowlist.'
  },
  {
    id: 'unbounded-retry',
    severity: 'medium',
    category: 'reliability',
    title: 'Retry loop may be unbounded',
    pattern: /(?:while\s*\([^)]*\)|for\s*\(;;\))[\s\S]{0,500}?\b(?:retry|attempt)/i,
    detail: 'Retries without a bounded attempt count can amplify outages.',
    remediation: 'Set an attempt limit, deadline, and bounded backoff.'
  },
  {
    id: 'floating-dependency',
    severity: 'low',
    category: 'dependency',
    title: 'Floating dependency version',
    pattern: /['"][^'"]+['"]\s*:\s*['"](?:\*|latest)['"]/,
    detail: 'Floating versions make builds and vulnerability reviews non-repeatable.',
    remediation: 'Pin an explicit compatible version and commit the lockfile.'
  }
];

function lineNumber(text, index, offset) {
  return offset + text.slice(0, index).split(/\r?\n/).length - 1;
}

function findingsForRule(file, rule) {
  const chunks = file.chunks?.length > 0 ? file.chunks : [{ startLine: 1, endLine: file.lines, text: file.searchText ?? '' }];
  return chunks.flatMap((chunk) => {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    const match = pattern.exec(chunk.text);
    if (!match) return [];
    if (rule.id === 'jwt-algorithm' && /algorithms\s*:/i.test(match[0])) return [];
    return [{
      id: `${rule.id}:${file.path}:${lineNumber(chunk.text, match.index, chunk.startLine)}`,
      severity: rule.severity,
      category: rule.category,
      title: rule.title,
      detail: rule.detail,
      remediation: rule.remediation,
      path: file.path,
      startLine: lineNumber(chunk.text, match.index, chunk.startLine),
      endLine: lineNumber(chunk.text, match.index + match[0].length, chunk.startLine),
      excerpt: match[0].slice(0, 240)
    }];
  }).slice(0, 1);
}

export function scanRepositorySecurity(repository) {
  const findings = repository.files.flatMap((file) => rules.flatMap((rule) => findingsForRule(file, rule)));
  const counts = Object.fromEntries(['high', 'medium', 'low'].map((severity) => [severity, findings.filter((finding) => finding.severity === severity).length]));
  const score = Math.max(0, 100 - counts.high * 15 - counts.medium * 7 - counts.low * 3);
  return {
    scannedAt: new Date().toISOString(),
    findings,
    summary: { ...counts, score, filesScanned: repository.files.length, ruleCount: rules.length }
  };
}
