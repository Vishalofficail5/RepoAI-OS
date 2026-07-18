const views = [...document.querySelectorAll('.view')];
const navItems = [...document.querySelectorAll('.nav-item')];
const sidebar = document.querySelector('#sidebar');
const commandOverlay = document.querySelector('#command-overlay');
const commandInput = document.querySelector('#command-input');
const connectModal = document.querySelector('#connect-modal');
const toast = document.querySelector('#toast');
const toastMessage = document.querySelector('#toast-message');
const actionModal = document.querySelector('#action-modal');
const actionModalTitle = document.querySelector('#action-modal-title');
const actionModalContent = document.querySelector('#action-modal-content');
const actionModalActions = document.querySelector('#action-modal-actions');
const appShell = document.querySelector('#app');
const loginScreen = document.querySelector('#login-screen');
const loginError = document.querySelector('#login-error');
let connectedRepositories = [];
let activeRepositoryId = null;
let activeRepository = null;
let activeGraphView = 'systems';
let lastEvidence = [];
let authenticatedUser = null;
let recentQuestions = [];
let repositoryInvestigations = [];
const securityScans = {};
const generatedDocuments = {};
const repositoryImpacts = {};
const requestTimeoutMs = 30000;

const repositoryData = {};
let activeRepositoryRequest = null;
let modalTrigger = null;

async function requestApi(path, options = {}) {
  const { headers = {}, signal, ...requestOptions } = options;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, requestTimeoutMs);
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = await fetch(path, { ...requestOptions, headers: { 'Content-Type': 'application/json', ...headers }, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) showLogin('Your session has ended. Sign in to continue.');
    if (!response.ok) throw new Error(body.error ?? 'RepoAI request failed');
    return body;
  } catch (error) {
    if (timedOut) throw new Error('RepoAI took too long to respond. Please try again.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

function userInitials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
}

function formatProvider(provider) {
  return provider === 'github' ? 'GitHub' : 'OAuth';
}

function showLogin(message = '') {
  authenticatedUser = null;
  connectedRepositories = [];
  activeRepositoryId = null;
  activeRepository = null;
  appShell.hidden = true;
  loginScreen.hidden = false;
  loginError.hidden = !message;
  loginError.textContent = message;
  setSidebarOpen(false);
}

function showApp(user) {
  authenticatedUser = user;
  const name = user.name || 'RepoAI user';
  const avatar = document.querySelector('#user-avatar');
  avatar.textContent = userInitials(name);
  avatar.classList.toggle('has-image', Boolean(user.avatarUrl));
  avatar.style.backgroundImage = user.avatarUrl ? `url(${JSON.stringify(user.avatarUrl)})` : '';
  document.querySelector('#user-name').textContent = name;
  document.querySelector('#user-provider').textContent = `Signed in with ${formatProvider(user.provider)}`;
  document.querySelector('#workspace-avatar').textContent = userInitials(name).slice(0, 1);
  document.querySelector('#workspace-name').textContent = `${name.split(/\s+/)[0]}'s workspace`;
  document.querySelector('#workspace-type').textContent = 'Private workspace';
  document.querySelector('#overview-greeting').textContent = `Welcome, ${name.split(/\s+/)[0]}.`;
  renderConnectedRepositories();
  renderRepositoryIntelligence(null);
  loginScreen.hidden = true;
  appShell.hidden = false;
}

async function initializeApp() {
  try {
    const response = await fetch('/api/session', { headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    const authError = new URLSearchParams(window.location.search).get('auth_error');
    if (!response.ok) return showLogin(authError || 'Unable to check your session.');
    if (!body.user) return showLogin(authError || '');
    showApp(body.user);
    await loadConnectedRepositories();
  } catch {
    showLogin('RepoAI is unavailable. Start the local server and try again.');
  }
}

async function startGitHubOAuth() {
  try {
    const response = await fetch('/api/auth/providers', { headers: { Accept: 'application/json' } });
    const providers = await response.json().catch(() => ({}));
    if (!response.ok) return showLogin('Unable to start sign-in. Start RepoAI and try again.');
    if (!providers.github) return showLogin('GitHub OAuth is not configured. Add its client ID, client secret, and SESSION_SECRET to .env, then restart RepoAI.');
    window.location.assign('/auth/github');
  } catch {
    showLogin('Unable to start sign-in. Start RepoAI and try again.');
  }
}

async function logout() {
  try {
    await fetch('/auth/logout', { method: 'POST' });
  } finally {
    showLogin();
  }
}

function formatLanguageSummary(languageCounts = {}) {
  const [language] = Object.entries(languageCounts).sort((left, right) => right[1] - left[1]);
  return language ? language[0] : 'Source code';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function formatRelativeTime(date) {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function updateRepositoryData(repository, index) {
  const colors = ['violet', 'blue', 'coral', 'green'];
  const language = formatLanguageSummary(repository.summary.languageCounts);
  repositoryData[repository.id] = {
    logo: repository.name.charAt(0).toUpperCase(),
    className: colors[index % colors.length],
    title: repository.name,
    description: `${repository.summary.fileCount} analyzed files · ${language} · ${repository.branch}`,
    languages: `<i class="lang-dot ts-dot"></i>${language}`,
    endpoints: `${repository.summary.endpointCount} mapped`,
    dependencies: `${repository.summary.importCount} analyzed`,
    contributors: repository.branch
  };
}

function renderConnectedRepositories() {
  const table = document.querySelector('.repo-table');
  if (connectedRepositories.length === 0) {
    table.innerHTML = '<div class="empty-repositories">No repositories connected yet. Use Connect repository to add your first codebase.</div>';
    renderRepositoryDetail(null);
    renderOverviewRepositories();
    return;
  }
  table.innerHTML = `<div class="repo-table-head"><span>Repository</span><span>Analysis</span><span>Endpoints</span><span>Last analyzed</span><span></span></div>${connectedRepositories.map((repository, index) => {
    updateRepositoryData(repository, index);
    const data = repositoryData[repository.id];
    return `<button class="repo-table-row repo-target" data-repo="${repository.id}"><span class="repo-cell"><span class="repo-logo ${data.className}">${data.logo}</span><span><strong>${escapeHtml(repository.name)}</strong><small><svg><use href="#i-branch"/></svg> ${escapeHtml(repository.branch)}</small></span></span><span><i class="health-dot good-dot"></i>Analyzed <b>${repository.summary.fileCount}</b></span><span>${repository.summary.endpointCount} mapped</span><span class="analyzed">${formatRelativeTime(repository.analyzedAt)}</span><span><svg class="row-arrow"><use href="#i-chevron"/></svg></span></button>`;
  }).join('')}`;
  renderOverviewRepositories();
}

function renderOverviewRepositories() {
  const healthList = document.querySelector('.health-list');
  const overviewCard = document.querySelector('.stats-grid .stat-card:first-child');
  const overviewCount = overviewCard.querySelector('strong');
  const navigationCount = document.querySelector('.nav-item[data-view="repositories"] em');
  overviewCount.textContent = String(connectedRepositories.length);
  overviewCard.querySelector('small').textContent = connectedRepositories.length === 1 ? '1 private repository' : `${connectedRepositories.length} private repositories`;
  navigationCount.textContent = String(connectedRepositories.length);
  document.querySelector('.health-panel .panel-heading h2').textContent = 'Repository analysis';
  document.querySelector('.health-panel .panel-heading p').textContent = 'Latest signals from connected codebases';
  if (connectedRepositories.length === 0) {
    healthList.innerHTML = '<p class="empty-repositories">No repositories connected yet.</p>';
    return;
  }
  healthList.innerHTML = connectedRepositories.slice(0, 6).map((repository, index) => {
    updateRepositoryData(repository, index);
    const data = repositoryData[repository.id];
    return `<button class="health-row repo-target" data-repo="${repository.id}"><span class="repo-logo ${data.className}">${data.logo}</span><span class="health-name"><strong>${escapeHtml(repository.name)}</strong><small>${escapeHtml(repository.branch)} · ${repository.summary.fileCount} files · Updated ${formatRelativeTime(repository.analyzedAt)}</small></span><span class="stack-dots"><i class="dot ts"></i><i class="dot next"></i></span><span class="score good">${repository.summary.endpointCount} API</span><svg class="row-arrow"><use href="#i-chevron"/></svg></button>`;
  }).join('');
}

function documentationFiles(repository) {
  return repository.files.filter((file) => file.language === 'Markdown' || /(^|\/)(readme|contributing|changelog|license|docs?)\b/i.test(file.path));
}

function securitySignals(repository) {
  const rules = [
    { pattern: /\beval\s*\(/, severity: 'high', title: 'Dynamic code execution', detail: 'Uses eval()' },
    { pattern: /\bnew\s+Function\s*\(/, severity: 'high', title: 'Dynamic function creation', detail: 'Uses Function constructor' },
    { pattern: /\b(?:exec|spawn)\s*\(/, severity: 'medium', title: 'Process execution surface', detail: 'Calls a process execution API' },
    { pattern: /dangerouslySetInnerHTML|\.innerHTML\s*=/, severity: 'medium', title: 'HTML injection surface', detail: 'Writes HTML content directly' }
  ];
  return repository.files.flatMap((file) => rules.filter((rule) => rule.pattern.test(file.searchText)).map((rule) => ({ ...rule, path: file.path }))).slice(0, 12);
}

function setOverviewCard(card, label, value, detail, action, view) {
  const content = card.querySelector('div');
  content.querySelector('p').textContent = label;
  content.querySelector('strong').textContent = String(value);
  content.querySelector('small').textContent = detail;
  const button = card.querySelector('button');
  button.dataset.view = view;
  button.innerHTML = `${escapeHtml(action)} <svg><use href="#i-arrow"/></svg>`;
}

function renderCommitPanels(repository) {
  const commits = repository.git?.commits ?? [];
  const deploymentPanel = document.querySelector('.deployment-panel');
  deploymentPanel.querySelector('h2').textContent = 'Recent commits';
  deploymentPanel.querySelector('.panel-heading p').textContent = `From ${repository.name}`;
  deploymentPanel.querySelector('.deploy-list').innerHTML = commits.length > 0
    ? commits.slice(0, 4).map((commit) => `<article class="deploy-row"><span class="deploy-status success"><svg><use href="#i-git"/></svg></span><div><strong>${escapeHtml(commit.message)}</strong><p>${escapeHtml(commit.author)} · ${formatRelativeTime(commit.date)}</p></div><span class="commit">${escapeHtml(commit.sha)}</span><span class="avatar avatar-one">${escapeHtml(userInitials(commit.author).slice(0, 2))}</span></article>`).join('')
    : '<p class="empty-repositories">No Git commit history is available for this repository.</p>';
  const footer = deploymentPanel.querySelector('.panel-footer');
  footer.dataset.view = 'architecture';
  footer.innerHTML = 'Open architecture <svg><use href="#i-arrow"/></svg>';

  const activityPanel = document.querySelector('.activity-panel');
  activityPanel.querySelector('h2').textContent = 'Repository activity';
  activityPanel.querySelector('.panel-heading p').textContent = `Recent commits in ${repository.name}`;
  activityPanel.querySelector('.activity-list').innerHTML = commits.length > 0
    ? commits.slice(0, 4).map((commit) => `<article class="activity-row"><span class="activity-icon code"><svg><use href="#i-git"/></svg></span><p><strong>${escapeHtml(commit.author)}</strong> committed ${escapeHtml(commit.message)}<small>${escapeHtml(repository.name)} · ${formatRelativeTime(commit.date)}</small></p><span class="avatar avatar-one">${escapeHtml(userInitials(commit.author).slice(0, 2))}</span></article>`).join('')
    : '<p class="empty-repositories">No Git activity is available for this repository.</p>';
}

function renderDocumentation(repository, docs, generated = []) {
  const documentationPanel = document.querySelector('.docs-coverage');
  documentationPanel.innerHTML = `<div><p class="eyebrow">Repository documentation</p><strong>${generated.length + docs.length}</strong><p>Generated guides and detected documentation files for ${escapeHtml(repository.name)}.</p></div><div class="coverage-ring"><span>${generated.length}</span></div><div class="coverage-metrics"><span><i class="metric-green"></i>Components <b>${repository.architecture.length}</b></span><span><i class="metric-amber"></i>Endpoints <b>${repository.endpoints.length}</b></span><span><i class="metric-gray"></i>Source files <b>${repository.summary.fileCount}</b></span></div>`;

  const activity = document.querySelector('.docs-activity');
  activity.querySelector('h2').textContent = 'Repository knowledge';
  activity.querySelector('.panel-heading p').textContent = `Generated from ${repository.name}`;
  activity.querySelector('.docs-activity-list').innerHTML = `<p><span class="activity-icon docs"><svg><use href="#i-file"/></svg></span><strong>${repository.endpoints.length} endpoints mapped</strong><small>${repository.summary.functionCount} functions were analyzed</small></p><p><span class="activity-icon code"><svg><use href="#i-share"/></svg></span><strong>Architecture map generated</strong><small>${repository.architecture.length} top-level components detected</small></p>`;

  const library = document.querySelector('.document-list');
  document.querySelector('.documents-panel .panel-heading p').textContent = `Generated from the current analysis of ${repository.name}.`;
  document.querySelector('.doc-tabs').innerHTML = '';
  library.innerHTML = generated.length + docs.length > 0
    ? `${generated.map((document, index) => `<article data-generated-document="${index}"><span class="document-icon api-doc">${escapeHtml(document.type.slice(0, 2).toUpperCase())}</span><div><h3>${escapeHtml(document.title)}</h3><p>Generated from the current repository analysis.</p><small>Updated ${formatRelativeTime(repository.analyzedAt)} · <b>Current</b></small></div><span class="doc-type">${escapeHtml(document.type)}</span><button><svg><use href="#i-chevron"/></svg></button></article>`).join('')}${docs.slice(0, 8).map((file) => `<article data-document-path="${escapeHtml(file.path)}"><span class="document-icon readme">${escapeHtml(fileName(file.path).charAt(0).toUpperCase())}</span><div><h3>${escapeHtml(file.path)}</h3><p>${escapeHtml(`${file.language} file · ${file.lines} lines`)}</p><small>Analyzed ${formatRelativeTime(repository.analyzedAt)} · <b>Mapped</b></small></div><span class="doc-type">${escapeHtml(file.language)}</span><button><svg><use href="#i-chevron"/></svg></button></article>`).join('')}`
    : '<p class="empty-repositories">No documentation files were detected in this repository.</p>';
}

function renderSecurity(repository, scan) {
  const signals = scan.findings ?? [];
  const counts = ['high', 'medium', 'low'].map((severity) => signals.filter((signal) => signal.severity === severity).length);
  const score = scan.summary?.score ?? Math.max(0, 100 - counts[0] * 15 - counts[1] * 7 - counts[2] * 3);
  document.querySelector('#view-security .subtitle').textContent = `Findings and remediation guidance for ${repository.name} · ${repository.summary.fileCount} analyzed files.`;
  const scorePanel = document.querySelector('.security-score');
  scorePanel.innerHTML = `<p class="eyebrow">Local security scan</p><strong>${score}<span>/100</span></strong><p>${signals.length > 0 ? `${signals.length} findings need review.` : 'No configured security findings were detected.'}</p><div><i style="width:${score}%"></i></div>`;
  document.querySelector('.security-counts').innerHTML = `<div><span class="finding-count critical">0</span><p>Critical</p></div><div><span class="finding-count high-count">${counts[0]}</span><p>High</p></div><div><span class="finding-count medium-count">${counts[1]}</span><p>Medium</p></div><div><span class="finding-count low-count">${counts[2]}</span><p>Low</p></div>`;
  document.querySelector('.security-findings .panel-heading h2').textContent = 'Security findings';
  document.querySelector('.security-findings .panel-heading p').textContent = `Detected in ${repository.name} by ${scan.summary?.ruleCount ?? 0} local rules.`;
  const filter = document.querySelector('.security-findings .panel-heading button');
  filter.textContent = 'Local rules';
  filter.disabled = true;
  document.querySelector('.finding-list').innerHTML = signals.length > 0
    ? signals.map((signal) => `<article><span class="finding-severity ${signal.severity === 'high' ? 'high-finding' : signal.severity === 'medium' ? 'medium-finding' : 'low-finding'}"><svg><use href="#i-alert"/></svg></span><div><p><span class="severity ${signal.severity}">${escapeHtml(signal.severity)}</span><span class="finding-category">${escapeHtml(signal.category)}</span></p><h3>${escapeHtml(signal.title)}</h3><small>${escapeHtml(signal.path)}:${signal.startLine} · ${escapeHtml(signal.detail)}</small></div><div class="finding-meta"><span>Local rule</span><button data-question="Explain ${escapeHtml(signal.title)} in ${escapeHtml(signal.path)}">Explore <svg><use href="#i-arrow"/></svg></button></div></article>`).join('')
    : '<p class="empty-repositories">No configured security findings were detected. This is not a full security audit.</p>';
}

function repositoryQuestions(repository) {
  const endpoint = repository.endpoints[0];
  const component = repository.architecture[0];
  return [
    `Summarize ${repository.name}`,
    endpoint ? `What does ${endpoint.method} ${endpoint.path} do?` : `What are the main functions in ${repository.name}?`,
    component ? `How is ${component.label} connected in ${repository.name}?` : `What are the key dependencies in ${repository.name}?`
  ];
}

function renderSearchViews(repository) {
  const questions = repositoryQuestions(repository);
  document.querySelector('.search-page-heading > p:last-child').textContent = `Search code, architecture, and Git history in ${repository.name}.`;
  document.querySelector('#ai-question').placeholder = `Ask about ${repository.name}...`;
  document.querySelector('.ask-input span').textContent = questions[0];
  document.querySelector('.suggestion-chips').innerHTML = questions.map((question) => `<button data-question="${escapeHtml(question)}">${escapeHtml(question)}</button>`).join('');
  document.querySelector('.search-examples').innerHTML = questions.map((question) => `<button data-question="${escapeHtml(question)}">${escapeHtml(question)}</button>`).join('');
  const history = recentQuestions.filter((item) => item.repositoryId === repository.id);
  document.querySelector('.question-list').innerHTML = history.length > 0
    ? history.map((item) => `<button data-question="${escapeHtml(item.question)}"><span class="question-icon"><svg><use href="#i-search"/></svg></span><span><strong>${escapeHtml(item.question)}</strong><small>${escapeHtml(repository.name)} · ${formatRelativeTime(item.askedAt)}</small></span><svg><use href="#i-chevron"/></svg></button>`).join('')
    : '<p class="empty-repositories">No repository questions yet. Choose a suggestion above to search this codebase.</p>';
}

function renderEmptyRepositoryIntelligence() {
  const cards = [...document.querySelectorAll('.stats-grid .stat-card')];
  document.querySelector('.nav-item[data-view="investigations"] em').textContent = '0';
  setOverviewCard(cards[1], 'Recent commits', 0, 'Connect a repository to load Git history', 'Connect repository', 'repositories');
  setOverviewCard(cards[2], 'Documentation files', 0, 'Connect a repository to inspect its documentation', 'Connect repository', 'repositories');
  setOverviewCard(cards[3], 'Security signals', 0, 'Connect a repository to run a code-pattern scan', 'Connect repository', 'repositories');
  document.querySelector('.deployment-panel .panel-heading h2').textContent = 'Recent commits';
  document.querySelector('.deployment-panel .panel-heading p').textContent = 'From the selected repository';
  document.querySelector('.deploy-list').innerHTML = '<p class="empty-repositories">Connect a repository to load Git commits.</p>';
  const deployFooter = document.querySelector('.deployment-panel .panel-footer');
  deployFooter.dataset.view = 'architecture';
  deployFooter.innerHTML = 'Open architecture <svg><use href="#i-arrow"/></svg>';
  document.querySelector('.activity-panel .panel-heading h2').textContent = 'Repository activity';
  document.querySelector('.activity-panel .panel-heading p').textContent = 'Changes from the selected repository';
  document.querySelector('.activity-list').innerHTML = '<p class="empty-repositories">Connect a repository to load activity.</p>';
  document.querySelector('.docs-coverage').innerHTML = '<div><p class="eyebrow">Repository documentation</p><strong>0</strong><p>Connect a repository to detect documentation files.</p></div>';
  document.querySelector('.docs-activity-list').innerHTML = '<p class="empty-repositories">No repository knowledge is available yet.</p>';
  document.querySelector('.document-list').innerHTML = '<p class="empty-repositories">Connect a repository to build the documentation library.</p>';
  document.querySelector('.security-score').innerHTML = '<p class="eyebrow">Heuristic code scan</p><strong>—</strong><p>Connect a repository to inspect code-pattern signals.</p>';
  document.querySelector('.security-counts').innerHTML = '';
  document.querySelector('.finding-list').innerHTML = '<p class="empty-repositories">No repository scan is available yet.</p>';
  document.querySelector('.suggestion-chips').innerHTML = '';
  document.querySelector('.search-examples').innerHTML = '<p class="empty-repositories">Connect a repository before asking a code question.</p>';
  document.querySelector('.question-list').innerHTML = '<p class="empty-repositories">No repository questions yet.</p>';
  document.querySelector('.search-page-heading > p:last-child').textContent = 'Connect a repository to search its code and architecture.';
  document.querySelector('#ai-question').placeholder = 'Connect a repository before asking a question';
  document.querySelector('.ask-input span').textContent = 'Connect a repository to ask a code question';
  document.querySelector('.investigation-list').innerHTML = '<p class="empty-repositories">Connect a repository before starting an investigation.</p>';
  renderInvestigationDetail(null);
}

function renderRepositoryIntelligence(repository) {
  if (!repository) {
    renderEmptyRepositoryIntelligence();
    document.querySelector('.health-list').innerHTML = '<p class="empty-repositories">Connect a repository to populate workspace intelligence.</p>';
    renderEmptyGraph();
    return;
  }
  const docs = documentationFiles(repository);
  const scan = securityScans[repository.id] ?? { findings: securitySignals(repository) };
  const signals = scan.findings;
  const commits = repository.git?.commits ?? [];
  const cards = [...document.querySelectorAll('.stats-grid .stat-card')];
  document.querySelector('.nav-item[data-view="investigations"] em').textContent = String(repositoryInvestigations.filter((item) => item.repositoryId === repository.id).length);
  setOverviewCard(cards[1], 'Recent commits', commits.length, commits.length > 0 ? `Latest ${formatRelativeTime(commits[0].date)}` : 'No Git history available', 'View map', 'architecture');
  setOverviewCard(cards[2], 'Documentation files', docs.length, `${repository.summary.fileCount} source files analyzed`, 'Open docs', 'documentation');
  setOverviewCard(cards[3], 'Security findings', signals.length, signals.length > 0 ? 'Local review needed' : 'No findings detected', 'View scan', 'security');
  renderCommitPanels(repository);
  renderDocumentation(repository, docs, generatedDocuments[repository.id] ?? []);
  renderSecurity(repository, scan);
  renderSearchViews(repository);
  renderInvestigations(repository);
}

async function loadConnectedRepositories() {
  try {
    const data = await requestApi('/api/repositories');
    connectedRepositories = data.repositories;
    connectedRepositories.forEach(updateRepositoryData);
    if (!connectedRepositories.some((repository) => repository.id === activeRepositoryId)) activeRepositoryId = connectedRepositories[0]?.id ?? null;
    renderConnectedRepositories();
  } catch {
    connectedRepositories = [];
    activeRepositoryId = null;
    activeRepository = null;
    renderConnectedRepositories();
    renderRepositoryIntelligence(null);
    renderGraphView(activeGraphView);
    if (authenticatedUser) showToast('Unable to load repositories. Please try again.');
    return;
  }
  try {
    await loadActiveRepository();
  } catch {
    activeRepository = null;
    renderGraphView(activeGraphView);
  }
}

const nodeData = {};

const graphPositions = [['7%', '82px'], ['39%', '82px'], ['71%', '82px'], ['7%', '254px'], ['39%', '254px'], ['71%', '254px']];

function fileName(filePath) {
  return filePath.split('/').at(-1) || filePath;
}

function nodeStyle(name) {
  if (/(app|client|web|ui|frontend|component|view)/i.test(name)) return 'ui-node';
  if (/(data|db|store|model|schema|entity|repository)/i.test(name)) return 'data-node';
  if (/(adapter|integration|gateway|external)/i.test(name)) return 'integration-node';
  return 'service-node';
}

function nodeIcon(style) {
  if (style === 'ui-node') return { icon: 'i-grid', iconClass: 'ui-icon' };
  if (style === 'integration-node') return { icon: 'i-external', iconClass: 'service-mini' };
  return { icon: 'i-cube', iconClass: 'service-mini' };
}

function importComponent(filePath, imported) {
  if (!imported.startsWith('.')) return null;
  const parts = filePath.split('/').slice(0, -1);
  imported.split('/').forEach((part) => {
    if (part === '.' || !part) return;
    if (part === '..') parts.pop();
    else parts.push(part);
  });
  return parts[0] || 'root';
}

function fileReferences(file) {
  return [...(file.searchText ?? '').matchAll(/\b(?:src|href)\s*=\s*['"]([^'"?#]+)[^'"]*['"]/gi)].map((match) => match[1]);
}

function referenceComponent(filePath, reference) {
  if (/^(?:[a-z]+:|\/\/|#)/i.test(reference)) return null;
  const parts = reference.startsWith('/') ? [] : filePath.split('/').slice(0, -1);
  reference.split('/').forEach((part) => {
    if (part === '.' || !part) return;
    if (part === '..') parts.pop();
    else parts.push(part);
  });
  return parts[0] || 'root';
}

function componentConnections(repository, component) {
  const componentIds = new Set(repository.architecture.map((item) => item.id));
  const componentFiles = new Set(component.files);
  return [...new Set(repository.files.filter((file) => componentFiles.has(file.path)).flatMap((file) => [
    ...file.imports.map((item) => importComponent(file.path, item)),
    ...fileReferences(file).map((item) => referenceComponent(file.path, item))
  ]).filter((id) => id && id !== component.id && componentIds.has(id)))];
}

function createComponentNodes(repository) {
  const components = [...repository.architecture].sort((left, right) => right.fileCount - left.fileCount).slice(0, 6);
  const labels = new Map(components.map((component) => [component.id, component.label]));
  return components.map((component, index) => {
    const connectionIds = componentConnections(repository, component).filter((id) => labels.has(id));
    const endpointCount = repository.endpoints.filter((endpoint) => component.files.includes(endpoint.file)).length;
    const style = nodeStyle(component.label);
    return {
      id: `system-${index}`,
      sourceId: component.id,
      title: component.label,
      subtitle: `${component.fileCount} analyzed files`,
      kind: 'Code component',
      description: `Top-level ${component.label === 'root' ? 'repository files' : `module “${component.label}”`} analyzed from this repository.`,
      files: component.fileCount,
      dependencies: component.imports.length,
      endpoints: endpointCount,
      style,
      connections: connectionIds.map((id) => labels.get(id)),
      connectionIds
    };
  });
}

function createEndpointNodes(repository) {
  const nodes = repository.endpoints.slice(0, 6).map((endpoint, index) => {
    const file = repository.files.find((item) => item.path === endpoint.file);
    return {
      id: `api-${index}`,
      sourceId: endpoint.file,
      title: `${endpoint.method} ${endpoint.path}`,
      subtitle: endpoint.file,
      kind: 'API endpoint',
      description: `Detected ${endpoint.method} endpoint in ${endpoint.file}.`,
      files: 1,
      dependencies: file?.imports.length ?? 0,
      endpoints: 1,
      style: nodeStyle(endpoint.file),
      connections: file?.imports.filter((item) => !item.startsWith('.')).slice(0, 3) ?? [],
      connectionIds: []
    };
  });
  if (nodes.length > 0) return nodes;
  return repository.files.filter((file) => file.functions.length > 0).slice(0, 6).map((file, index) => ({
    id: `api-${index}`,
    sourceId: file.path,
    title: `${file.functions[0]}()`,
    subtitle: file.path,
    kind: 'Code function',
    description: `Detected function in ${file.path}. No HTTP endpoints were found in this repository.`,
    files: 1,
    dependencies: file.imports.length,
    endpoints: file.endpoints.length,
    style: nodeStyle(file.path),
    connections: file.imports.filter((item) => !item.startsWith('.')).slice(0, 3),
    connectionIds: []
  }));
}

function createDataNodes(repository) {
  const dataFiles = repository.files.filter((file) => /(data|db|store|model|schema|entity|repository)/i.test(file.path));
  const candidates = (dataFiles.length > 0 ? dataFiles : repository.files).slice(0, 6);
  return candidates.map((file, index) => ({
    id: `data-${index}`,
    sourceId: file.path,
    title: fileName(file.path),
    subtitle: `${file.language} · ${file.functions.length} functions`,
    kind: dataFiles.length > 0 ? 'Data-related module' : 'Source module',
    description: `Analyzed module ${file.path} with ${file.imports.length} imports and ${file.endpoints.length} endpoints.`,
    files: 1,
    dependencies: file.imports.length,
    endpoints: file.endpoints.length,
    style: dataFiles.length > 0 ? 'data-node' : nodeStyle(file.path),
    connections: file.imports.filter((item) => !item.startsWith('.')).slice(0, 3),
    connectionIds: []
  }));
}

function graphLines(nodes) {
  const nodeIndexes = new Map(nodes.map((node, index) => [node.sourceId, index]));
  const points = [[190, 122], [416, 122], [650, 122], [190, 294], [416, 294], [650, 294]];
  const connections = new Set();
  return nodes.flatMap((node, index) => node.connectionIds.map((connection) => {
    const targetIndex = nodeIndexes.get(connection);
    if (targetIndex === undefined || targetIndex === index) return '';
    const key = [index, targetIndex].sort((left, right) => left - right).join(':');
    if (connections.has(key)) return '';
    connections.add(key);
    const [fromX, fromY] = points[index];
    const [toX, toY] = points[targetIndex];
    return `<path d="M${fromX} ${fromY} C${(fromX + toX) / 2} ${fromY} ${(fromX + toX) / 2} ${toY} ${toX} ${toY}"/>`;
  })).join('');
}

function graphNodeMarkup(node, index) {
  const position = graphPositions[index];
  const icon = nodeIcon(node.style);
  return `<button class="graph-node ${node.style}" data-node="${escapeHtml(node.id)}" style="left:${position[0]};top:${position[1]}"><span class="node-icon ${icon.iconClass}"><svg><use href="#${icon.icon}"/></svg></span><strong>${escapeHtml(node.title)}</strong><small>${escapeHtml(node.subtitle)}</small></button>`;
}

function renderEmptyGraph() {
  const canvas = document.querySelector('#graph-canvas');
  canvas.innerHTML = '<p class="empty-repositories graph-empty">Connect a repository to generate its architecture map.</p>';
  document.querySelector('#inspector-kind').textContent = 'Repository intelligence';
  document.querySelector('#inspector-title').textContent = 'No repository selected';
  document.querySelector('#inspector-description').textContent = 'Connect a repository to inspect its code components, endpoints, and data-related modules.';
  document.querySelector('#node-files').textContent = '—';
  document.querySelector('#node-dependencies').textContent = '—';
  document.querySelector('#node-endpoints').textContent = '—';
  document.querySelector('#node-connections').innerHTML = '';
}

function renderGraphView(viewName) {
  activeGraphView = viewName;
  if (!activeRepository) return renderEmptyGraph();
  const nodes = viewName === 'systems' ? createComponentNodes(activeRepository) : viewName === 'api' ? createEndpointNodes(activeRepository) : createDataNodes(activeRepository);
  if (nodes.length === 0) return renderEmptyGraph();
  Object.keys(nodeData).forEach((key) => delete nodeData[key]);
  nodes.forEach((node) => {
    const icon = nodeIcon(node.style);
    nodeData[node.id] = { ...node, ...icon };
  });
  const captions = {
    systems: `System map generated from ${activeRepository.summary.fileCount} analyzed files`,
    api: `${activeRepository.endpoints.length} detected API endpoints in ${activeRepository.name}`,
    data: `Data modules and source files analyzed in ${activeRepository.name}`
  };
  const canvas = document.querySelector('#graph-canvas');
  canvas.innerHTML = `<svg class="graph-lines" viewBox="0 0 760 480" preserveAspectRatio="none">${graphLines(nodes)}</svg>${nodes.map(graphNodeMarkup).join('')}<span class="graph-caption">${escapeHtml(captions[viewName])}</span>`;
  selectNode(nodes[0].id);
}

function setView(viewName) {
  const target = document.querySelector(`#view-${viewName}`);
  if (!target) return;
  views.forEach((view) => view.classList.toggle('is-visible', view === target));
  navItems.forEach((item) => item.classList.toggle('active', item.dataset.view === viewName));
  if (viewName === 'security' && activeRepository) {
    renderSecurity(activeRepository, securityScans[activeRepository.id] ?? { findings: securitySignals(activeRepository) });
  }
  setSidebarOpen(false);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setSidebarOpen(open) {
  sidebar.classList.toggle('open', open);
  const menuButton = document.querySelector('#menu-button');
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
}

function showToast(message) {
  toastMessage.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function openCommand() {
  modalTrigger = document.activeElement;
  commandOverlay.classList.add('open');
  commandOverlay.setAttribute('aria-hidden', 'false');
  window.setTimeout(() => commandInput.focus(), 100);
}

function closeCommand() {
  const wasOpen = commandOverlay.classList.contains('open');
  commandOverlay.classList.remove('open');
  commandOverlay.setAttribute('aria-hidden', 'true');
  if (wasOpen) restoreModalFocus();
}

function openConnectModal() {
  modalTrigger = document.activeElement;
  connectModal.classList.add('open');
  connectModal.setAttribute('aria-hidden', 'false');
  window.setTimeout(() => document.querySelector('#repository-url').focus(), 100);
}

function closeConnectModal() {
  const wasOpen = connectModal.classList.contains('open');
  connectModal.classList.remove('open');
  connectModal.setAttribute('aria-hidden', 'true');
  if (wasOpen) restoreModalFocus();
}

function openActionModal(title, content, actions = []) {
  modalTrigger = document.activeElement;
  actionModalTitle.textContent = title;
  actionModalContent.innerHTML = content;
  actionModalActions.innerHTML = actions.map((action) => `<button class="button ${action.primary ? 'primary' : 'secondary'}" data-modal-action="${action.id}">${escapeHtml(action.label)}</button>`).join('');
  actionModal.classList.add('open');
  actionModal.setAttribute('aria-hidden', 'false');
  window.setTimeout(() => document.querySelector('#action-modal-close').focus(), 0);
}

function closeActionModal() {
  const wasOpen = actionModal.classList.contains('open');
  actionModal.classList.remove('open');
  actionModal.setAttribute('aria-hidden', 'true');
  if (wasOpen) restoreModalFocus();
}

function restoreModalFocus() {
  const trigger = modalTrigger;
  modalTrigger = null;
  if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
}

function trapModalFocus(event) {
  const overlay = document.querySelector('.command-overlay.open, .modal-overlay.open');
  if (!overlay || event.key !== 'Tab') return;
  const focusable = [...overlay.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
  if (focusable.length === 0) return;
  const current = document.activeElement;
  const index = focusable.indexOf(current);
  if (event.shiftKey && (index <= 0 || current === overlay)) {
    event.preventDefault();
    focusable.at(-1).focus();
  } else if (!event.shiftKey && index === focusable.length - 1) {
    event.preventDefault();
    focusable[0].focus();
  }
}

function setDarkMode(enabled) {
  document.body.classList.toggle('dark-mode', enabled);
  document.querySelector('#dark-mode-toggle').textContent = enabled ? '◑' : '◐';
  document.querySelector('#dark-mode-toggle').setAttribute('aria-label', enabled ? 'Disable dark mode' : 'Enable dark mode');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', enabled ? '#1d2021' : '#fbf1c7');
  try { localStorage.setItem('repoai-dark-mode', enabled ? 'on' : 'off'); } catch { }
}

function renderRepositoryDetail(repository) {
  const detail = document.querySelector('#repository-detail');
  detail.hidden = !repository;
  if (!repository) return;
  const data = repositoryData[repository.id];
  if (!data) return;
  const logo = document.querySelector('#detail-logo');
  logo.textContent = data.logo;
  logo.className = `repo-logo ${data.className}`;
  document.querySelector('#detail-title').textContent = data.title;
  document.querySelector('#detail-description').textContent = data.description;
  const metrics = document.querySelectorAll('.detail-metrics strong');
  metrics[0].innerHTML = data.languages;
  metrics[1].textContent = data.endpoints;
  metrics[2].textContent = data.dependencies;
  metrics[3].textContent = `${repository.testIntelligence?.coveragePercent ?? 0}% test-linked`;
  const folders = [...(repository.architecture ?? [])].sort((left, right) => right.fileCount - left.fileCount).slice(0, 5);
  document.querySelector('.folder-list').innerHTML = folders.length > 0
    ? folders.map((folder) => `<li><svg><use href="#i-file"/></svg>${escapeHtml(folder.label)} <small>${folder.fileCount} files</small></li>`).join('')
    : '<li>No top-level source components were found.</li>';
  const signals = [
    [`${repository.summary.endpointCount} API endpoints detected`, `${repository.summary.fileCount} analyzed files`],
    [`${repository.summary.importCount} imports mapped`, `${repository.summary.functionCount} functions discovered`],
    [`Analysis updated ${formatRelativeTime(repository.analyzedAt)}`, repository.git?.branch ?? repository.branch]
  ];
  document.querySelector('.signal-list').innerHTML = signals.map(([title, detail], index) => `<li><i class="${index === 0 ? 'signal-purple' : index === 1 ? 'signal-green' : 'signal-blue'}"></i>${escapeHtml(title)} <time>${escapeHtml(detail)}</time></li>`).join('');
  document.querySelector('#architecture-repository-name').textContent = repository.name;
}

async function loadActiveRepository() {
  if (!activeRepositoryId) {
    activeRepositoryRequest?.abort();
    activeRepositoryRequest = null;
    activeRepository = null;
    renderRepositoryIntelligence(null);
    return;
  }
  const repositoryId = activeRepositoryId;
  activeRepositoryRequest?.abort();
  const controller = new AbortController();
  activeRepositoryRequest = controller;
  let result;
  try {
    result = await requestApi(`/api/repositories/${repositoryId}`, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) return;
    throw error;
  }
  if (activeRepositoryId !== repositoryId) return;
  activeRepository = result.repository;
  const insights = await Promise.allSettled([
    requestApi(`/api/repositories/${repositoryId}/investigations`, { signal: controller.signal }),
    requestApi(`/api/repositories/${repositoryId}/security`, { signal: controller.signal }),
    requestApi(`/api/repositories/${repositoryId}/documentation`, { signal: controller.signal })
  ]);
  if (activeRepositoryId !== repositoryId || controller.signal.aborted) return;
  if (insights[0].status === 'fulfilled') repositoryInvestigations = [...repositoryInvestigations.filter((item) => item.repositoryId !== repositoryId), ...insights[0].value.investigations];
  if (insights[1].status === 'fulfilled') securityScans[repositoryId] = insights[1].value.scan;
  if (insights[2].status === 'fulfilled') generatedDocuments[repositoryId] = insights[2].value.documents;
  renderRepositoryDetail(activeRepository);
  renderGraphView(activeGraphView);
  renderRepositoryIntelligence(activeRepository);
  if (activeRepositoryRequest === controller) activeRepositoryRequest = null;
}

async function selectRepository(repositoryId) {
  if (!connectedRepositories.some((repository) => repository.id === repositoryId)) return;
  activeRepositoryId = repositoryId;
  setView('repositories');
  window.setTimeout(() => document.querySelector('#repository-detail').scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  try {
    await loadActiveRepository();
  } catch (error) {
    showToast(error.message);
  }
}

function selectNode(nodeName) {
  const data = nodeData[nodeName];
  if (!data) return;
  document.querySelectorAll('.graph-node').forEach((node) => node.classList.toggle('selected', node.dataset.node === nodeName));
  const icon = document.querySelector('#inspector-icon');
  icon.className = `node-icon ${data.iconClass}`;
  icon.innerHTML = `<svg><use href="#${data.icon}"/></svg>`;
  document.querySelector('#inspector-kind').textContent = data.kind;
  document.querySelector('#inspector-title').textContent = data.title;
  document.querySelector('#inspector-description').textContent = data.description;
  document.querySelector('#node-files').textContent = data.files;
  document.querySelector('#node-dependencies').textContent = data.dependencies;
  document.querySelector('#node-endpoints').textContent = data.endpoints;
  document.querySelector('#node-connections').innerHTML = data.connections.length > 0
    ? data.connections.map((name) => `<button><span class="mini-node service-mini">${escapeHtml(name.charAt(0))}</span>${escapeHtml(name)}<svg><use href="#i-chevron"/></svg></button>`).join('')
    : '<p class="empty-repositories">No direct component links were detected.</p>';
}

function renderInvestigationDetail(investigation) {
  const detail = document.querySelector('.investigation-detail');
  if (!investigation) {
    detail.innerHTML = '<div class="investigation-detail-head"><div><p class="eyebrow">Repository intelligence</p><h2>No active investigations</h2><p>Start an investigation to generate evidence from the selected repository.</p></div></div>';
    return;
  }
  const evidence = investigation.evidence ?? [];
  const commits = investigation.commits ?? [];
  detail.innerHTML = `<div class="investigation-detail-head"><div><span class="severity medium">Repository analysis</span><p class="eyebrow">Created ${formatRelativeTime(investigation.createdAt)}</p><h2>${escapeHtml(investigation.title)}</h2><p>${escapeHtml(investigation.likelyRootCause)}</p></div></div><div class="finding-callout"><span class="alert-icon"><svg><use href="#i-sparkle"/></svg></span><div><p class="eyebrow">Evidence summary</p><h3>${escapeHtml(investigation.confidence)} confidence</h3><p>Evidence was gathered from the current repository analysis.</p></div></div><div class="investigation-grid"><div><h3>Evidence</h3><div class="timeline">${evidence.length > 0 ? evidence.slice(0, 5).map((item) => `<article><i class="timeline-blue"></i><time>${escapeHtml(item.path)}</time><p><strong>${escapeHtml(item.functions?.join(', ') || item.endpoints?.map((endpoint) => `${endpoint.method} ${endpoint.path}`).join(', ') || 'Relevant source file')}</strong><span>${escapeHtml(item.excerpt?.slice(0, 140) || 'Matched repository evidence')}</span></p></article>`).join('') : '<p class="empty-repositories">No matching evidence was returned.</p>'}</div></div><div><h3>Recent commits</h3><div class="affected-list">${commits.length > 0 ? commits.slice(0, 4).map((commit) => `<div><span class="file-chip"><svg><use href="#i-git"/></svg></span><p><strong>${escapeHtml(commit.message)}</strong><small>${escapeHtml(commit.author)} · ${escapeHtml(commit.sha)}</small></p></div>`).join('') : '<p class="empty-repositories">No Git commits are available.</p>'}</div></div></div>`;
}

function renderInvestigations(repository) {
  const investigations = repositoryInvestigations.filter((item) => item.repositoryId === repository.id);
  const list = document.querySelector('.investigation-list');
  list.innerHTML = `<div class="investigation-list-head"><span>${investigations.length} active</span></div>${investigations.length > 0 ? investigations.map((item) => `<button class="investigation-row${item.id === investigations[0].id ? ' active' : ''}" data-investigation="${escapeHtml(item.id)}"><span class="severity medium">Analysis</span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(repository.name)} · ${formatRelativeTime(item.createdAt)}</small></span><span class="investigation-progress">Evidence gathered</span></button>`).join('') : '<p class="empty-repositories">No active investigations for this repository.</p>'}`;
  renderInvestigationDetail(investigations[0]);
}

function selectInvestigation(id) {
  const investigation = repositoryInvestigations.find((item) => item.id === id && item.repositoryId === activeRepositoryId);
  if (!investigation) return;
  document.querySelectorAll('.investigation-row').forEach((row) => row.classList.toggle('active', row.dataset.investigation === id));
  renderInvestigationDetail(investigation);
}

function renderNoRepositoryAnswer(question) {
  document.querySelector('#answer-question').textContent = question;
  document.querySelector('#answer-content').textContent = 'Connect and select a repository before asking a code question.';
  document.querySelector('#evidence-grid').innerHTML = '';
  document.querySelector('.evidence-heading span').textContent = 'No repository selected';
  document.querySelector('.answer-footer').textContent = 'Repository analysis is required';
  document.querySelector('#search-answer').classList.remove('hidden');
}

function recordQuestion(question) {
  if (!activeRepository) return;
  recentQuestions = [{ repositoryId: activeRepository.id, question, askedAt: new Date().toISOString() }, ...recentQuestions.filter((item) => item.question !== question || item.repositoryId !== activeRepository.id)].slice(0, 8);
  renderSearchViews(activeRepository);
}

function renderRepositoryAnswer(question, result) {
  lastEvidence = result.evidence;
  document.querySelector('#answer-question').textContent = question;
  const answerContent = document.querySelector('#answer-content');
  answerContent.replaceChildren();
  const conclusion = document.createElement('p');
  conclusion.textContent = result.answer;
  answerContent.append(conclusion);
  if (result.explanation) {
    const explanation = document.createElement('p');
    explanation.textContent = result.explanation;
    answerContent.append(explanation);
  }
  if (Array.isArray(result.nextSteps) && result.nextSteps.length > 0) {
    const nextSteps = document.createElement('p');
    const label = document.createElement('strong');
    label.textContent = 'Next steps';
    nextSteps.append(label);
    const list = document.createElement('ul');
    result.nextSteps.forEach((step) => {
      const item = document.createElement('li');
      item.textContent = step;
      list.append(item);
    });
    answerContent.append(nextSteps, list);
  }
  document.querySelector('#evidence-grid').innerHTML = result.evidence.map((item, index) => `<button class="evidence-card" data-evidence-index="${index}"><svg><use href="#i-file"/></svg><span><strong>${escapeHtml(item.path)}${item.startLine ? `:${item.startLine}-${item.endLine}` : ''}</strong><small>${escapeHtml(item.functions.join(', ') || item.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`).join(', ') || item.terms.join(', '))}</small></span></button>`).join('');
  document.querySelector('.evidence-heading span').textContent = `Grounded in ${result.evidence.length} source files`;
  document.querySelector('.answer-footer').innerHTML = `<span><i></i>${result.confidence} confidence · ${result.source === 'openai' ? 'OpenAI synthesis' : 'Local evidence synthesis'}</span><span>Analyzed codebase</span>`;
  document.querySelector('#search-answer').classList.remove('hidden');
  recordQuestion(question);
  if (result.warning) showToast(result.warning);
  window.setTimeout(() => document.querySelector('#search-answer').scrollIntoView({ behavior: 'smooth', block: 'start' }), 70);
}

async function askQuestion(question) {
  const trimmedQuestion = question.trim() || (activeRepository ? repositoryQuestions(activeRepository)[0] : 'Ask a repository question');
  if (!activeRepositoryId) return renderNoRepositoryAnswer(trimmedQuestion);
  try {
    const result = await requestApi(`/api/repositories/${activeRepositoryId}/search`, { method: 'POST', body: JSON.stringify({ question: trimmedQuestion }) });
    renderRepositoryAnswer(trimmedQuestion, result);
  } catch (error) {
    showToast(error.message);
  }
}

document.querySelectorAll('[data-view]').forEach((element) => {
  element.addEventListener('click', () => setView(element.dataset.view));
});

document.querySelectorAll('.repo-target').forEach((button) => {
  button.addEventListener('click', () => selectRepository(button.dataset.repo));
});

document.querySelector('.repo-table').addEventListener('click', (event) => {
  const button = event.target.closest('.repo-target');
  if (button) selectRepository(button.dataset.repo);
});

document.querySelector('.health-list').addEventListener('click', (event) => {
  const button = event.target.closest('.repo-target');
  if (button) selectRepository(button.dataset.repo);
});

document.querySelector('#graph-canvas').addEventListener('click', (event) => {
  const node = event.target.closest('.graph-node');
  if (node) selectNode(node.dataset.node);
});

document.querySelector('.investigation-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-investigation]');
  if (button) selectInvestigation(button.dataset.investigation);
});

document.querySelector('#open-command').addEventListener('click', openCommand);
document.querySelector('#github-login').addEventListener('click', startGitHubOAuth);
document.querySelector('#user-menu').addEventListener('click', () => {
  const name = authenticatedUser?.name || 'RepoAI user';
  const provider = formatProvider(authenticatedUser?.provider);
  openActionModal(name, `<p>Signed in with ${escapeHtml(provider)}.</p><ul><li>Repository analysis is private to this workspace.</li></ul>`, [{ id: 'create-mcp-token', label: 'Create MCP token' }, { id: 'manage-mcp-tokens', label: 'Manage MCP tokens' }, { id: 'toggle-dark', label: document.body.classList.contains('dark-mode') ? 'Use light mode' : 'Use dark mode' }, { id: 'logout', label: 'Log out', primary: true }, { id: 'close', label: 'Close' }]);
});
document.querySelector('#menu-button').addEventListener('click', (event) => {
  event.preventDefault();
  setSidebarOpen(!sidebar.classList.contains('open'));
});
document.querySelector('#mobile-close').addEventListener('click', (event) => {
  event.preventDefault();
  setSidebarOpen(false);
});
document.querySelector('#connect-repo').addEventListener('click', openConnectModal);
document.querySelector('[data-close-modal]').addEventListener('click', closeConnectModal);
document.querySelector('#connect-modal').addEventListener('click', (event) => { if (event.target === connectModal) closeConnectModal(); });
document.querySelector('#confirm-connect').addEventListener('click', async () => {
  const sourcePath = document.querySelector('#repository-url').value.trim();
  const name = document.querySelector('#repository-name').value.trim();
  if (!sourcePath) return showToast('Enter a local repository path');
  const button = document.querySelector('#confirm-connect');
  button.disabled = true;
  button.textContent = 'Analyzing repository…';
  try {
    const data = await requestApi('/api/repositories', { method: 'POST', body: JSON.stringify({ path: sourcePath, name }) });
    await loadConnectedRepositories();
    closeConnectModal();
    selectRepository(data.repository.id);
    showToast(`${data.repository.name} connected and analyzed`);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = 'Connect and analyze <svg><use href="#i-arrow"/></svg>';
  }
});

document.querySelector('#repo-filter').addEventListener('input', (event) => {
  const query = event.target.value.toLowerCase();
  document.querySelectorAll('.repo-table-row').forEach((row) => {
    row.style.display = row.textContent.toLowerCase().includes(query) ? '' : 'none';
  });
});

document.querySelector('#fit-graph').addEventListener('click', () => {
  document.querySelector('#graph-canvas').scrollIntoView({ behavior: 'smooth', block: 'center' });
  showToast('System map fitted to view');
});

document.querySelector('#analyze-impact').addEventListener('click', async () => {
  if (!activeRepositoryId) return showToast('Connect a repository before analyzing changes');
  try {
    const result = await requestApi(`/api/repositories/${activeRepositoryId}/impact`, { method: 'POST', body: JSON.stringify({}) });
    repositoryImpacts[activeRepositoryId] = result.impact;
    const affected = result.impact.affectedFiles.slice(0, 8).map((file) => `<li><strong>${escapeHtml(file.path)}</strong> — ${escapeHtml(file.reason)}${file.tests.length > 0 ? ` · tests: ${escapeHtml(file.tests.join(', '))}` : ''}</li>`).join('');
    const gaps = result.impact.testGaps.length > 0 ? `<p>Changed or affected source files without linked tests: ${escapeHtml(result.impact.testGaps.join(', '))}</p>` : '<p>Every changed or affected source file has a linked test.</p>';
    openActionModal('Latest change impact', `<p>${result.impact.changedFiles.length} changed files affect ${result.impact.affectedFiles.length} files and ${result.impact.endpoints.length} endpoints.</p>${gaps}<ul>${affected || '<li>No source files changed.</li>'}</ul>`, [{ id: 'close', label: 'Close', primary: true }]);
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelectorAll('.tab[data-graph]').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab[data-graph]').forEach((item) => item.classList.toggle('active', item === tab));
    renderGraphView(tab.dataset.graph);
    showToast(`${tab.textContent} loaded`);
  });
});

function askFromInput() {
  askQuestion(document.querySelector('#ai-question').value);
}

document.querySelector('#ask-button').addEventListener('click', askFromInput);
document.querySelector('#ai-question').addEventListener('keydown', (event) => { if (event.key === 'Enter') askFromInput(); });
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-question]');
  if (!button) return;
  const question = button.dataset.question;
  setView('search');
  document.querySelector('#ai-question').value = question;
  window.setTimeout(() => askQuestion(question), 50);
});

document.querySelector('#copy-answer').addEventListener('click', async () => {
  const text = document.querySelector('#answer-content').innerText;
  try { await navigator.clipboard.writeText(text); } catch { }
  showToast('Answer copied to clipboard');
});

document.querySelector('#start-investigation').addEventListener('click', async () => {
  if (!activeRepositoryId) return showToast('Connect a repository before starting an investigation');
  try {
    const result = await requestApi(`/api/repositories/${activeRepositoryId}/investigations`, { method: 'POST', body: JSON.stringify({ question: 'What changed recently and what is affected?' }) });
    const investigation = result.investigation;
    repositoryInvestigations = [investigation, ...repositoryInvestigations.filter((item) => item.repositoryId !== activeRepositoryId)];
    renderRepositoryIntelligence(activeRepository);
    showToast('Investigation created from repository evidence');
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector('#generate-docs').addEventListener('click', async () => {
  if (!activeRepository) return showToast('Connect a repository before generating documentation');
  try {
    const result = await requestApi(`/api/repositories/${activeRepositoryId}/documentation`, { method: 'POST' });
    generatedDocuments[activeRepositoryId] = result.documents;
    renderDocumentation(activeRepository, documentationFiles(activeRepository), result.documents);
    showToast('Repository documentation generated');
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector('#run-security-scan').addEventListener('click', async () => {
  if (!activeRepository) return showToast('Connect a repository before scanning');
  try {
    const result = await requestApi(`/api/repositories/${activeRepositoryId}/security`, { method: 'POST' });
    securityScans[activeRepositoryId] = result.scan;
    renderSecurity(activeRepository, result.scan);
    showToast('Repository security scan completed');
  } catch (error) {
    showToast(error.message);
  }
});

commandOverlay.addEventListener('click', (event) => { if (event.target === commandOverlay) closeCommand(); });
document.querySelectorAll('[data-command]').forEach((button) => {
  button.addEventListener('click', () => {
    const command = button.dataset.command;
    closeCommand();
    setView(command);
    if (command === 'search') window.setTimeout(() => document.querySelector('#ai-question').focus(), 100);
    if (command === 'investigations') document.querySelector('#start-investigation').focus();
  });
});

commandInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    const question = commandInput.value.trim();
    closeCommand();
    setView('search');
    document.querySelector('#ai-question').value = question;
    if (question) window.setTimeout(() => askQuestion(question), 60);
  }
});

document.addEventListener('keydown', (event) => {
  trapModalFocus(event);
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openCommand();
  }
  if (event.key === 'Escape') {
    closeCommand();
    closeConnectModal();
    closeActionModal();
    setSidebarOpen(false);
  }
});

document.querySelector('#action-modal-close').addEventListener('click', closeActionModal);
actionModal.addEventListener('click', (event) => { if (event.target === actionModal) closeActionModal(); });

try { setDarkMode(localStorage.getItem('repoai-dark-mode') === 'on'); } catch { setDarkMode(false); }

document.querySelector('#dark-mode-toggle').addEventListener('click', () => {
  setDarkMode(!document.body.classList.contains('dark-mode'));
  showToast(document.body.classList.contains('dark-mode') ? 'Forest dark mode enabled' : 'Gruvbox light mode enabled');
});

document.querySelector('#help-button').addEventListener('click', () => {
  openActionModal('How to use RepoAI', '<p>Connect a local repository, then search its code and run evidence-based investigations.</p><ul><li>Repositories: ingest and inspect a codebase</li><li>AI Search: ask code questions with file evidence</li><li>Architecture: inspect components and dependencies</li><li>Security: review generated findings</li></ul>', [{ id: 'close', label: 'Got it', primary: true }]);
});

document.querySelector('#notifications-button').addEventListener('click', () => {
  const repository = activeRepository;
  const messages = repository ? [`${escapeHtml(repository.name)} was analyzed ${formatRelativeTime(repository.analyzedAt)}.`, `${repository.summary.fileCount} source files and ${repository.endpoints.length} endpoints are mapped.`, `${repositoryInvestigations.filter((item) => item.repositoryId === repository.id).length} active repository investigations.`] : ['Connect a repository to receive analysis updates.'];
  openActionModal('Repository updates', `<ul>${messages.map((message) => `<li>${message}</li>`).join('')}</ul>`, [{ id: 'close', label: 'Close', primary: true }]);
});

document.querySelector('.workspace-switcher').addEventListener('click', () => {
  const workspaceName = authenticatedUser?.name ? `${authenticatedUser.name.split(/\s+/)[0]}'s workspace` : 'Private workspace';
  openActionModal(workspaceName, `<p>This workspace contains ${connectedRepositories.length} connected repositories owned by your GitHub account.</p>`, [{ id: 'repositories', label: 'Open repositories', primary: true }]);
});

actionModalActions.addEventListener('click', async (event) => {
  const revokeButton = event.target.closest('[data-revoke-mcp-token]');
  if (revokeButton) {
    try {
      await requestApi(`/api/mcp/tokens/${encodeURIComponent(revokeButton.dataset.revokeMcpToken)}`, { method: 'DELETE' });
      revokeButton.closest('li').remove();
      showToast('MCP token revoked');
    } catch (error) {
      showToast(error.message);
    }
    return;
  }
  const button = event.target.closest('[data-modal-action]');
  if (!button) return;
  if (button.dataset.modalAction === 'toggle-dark') setDarkMode(!document.body.classList.contains('dark-mode'));
  if (button.dataset.modalAction === 'repositories') setView('repositories');
  if (button.dataset.modalAction === 'logout') await logout();
  if (button.dataset.modalAction === 'create-mcp-token') {
    try {
      const result = await requestApi('/api/mcp/tokens', { method: 'POST' });
      actionModalTitle.textContent = 'MCP access token';
       actionModalContent.innerHTML = `<p>Copy this token now; it will not be shown again.</p><pre class="source-preview">${escapeHtml(result.token)}</pre><p>Expires ${escapeHtml(new Date(result.expiresAt).toLocaleDateString())}. Set it as <code>REPOAI_MCP_TOKEN</code> for the MCP server.</p>`;
       actionModalActions.innerHTML = '<button class="button primary" data-modal-action="close">Close</button>';
       actionModalActions.querySelector('button').focus();
       return;
    } catch (error) {
      showToast(error.message);
      return;
    }
  }
  if (button.dataset.modalAction === 'manage-mcp-tokens') {
    try {
      const result = await requestApi('/api/mcp/tokens');
      actionModalTitle.textContent = 'MCP access tokens';
      actionModalContent.innerHTML = result.tokens.length > 0
        ? `<ul>${result.tokens.map((token) => `<li>Expires ${escapeHtml(new Date(token.expiresAt).toLocaleDateString())} <button class="text-button" data-revoke-mcp-token="${escapeHtml(token.id)}">Revoke</button></li>`).join('')}</ul>`
        : '<p>No active MCP tokens.</p>';
      actionModalActions.innerHTML = '<button class="button primary" data-modal-action="close">Close</button>';
      actionModalActions.querySelector('button').focus();
      return;
    } catch (error) {
      showToast(error.message);
      return;
    }
  }
  closeActionModal();
});

const exportButton = [...document.querySelectorAll('.heading-actions .button')].find((button) => button.textContent.includes('Export'));
if (exportButton) {
  exportButton.dataset.handled = 'true';
  exportButton.addEventListener('click', () => {
    const repository = connectedRepositories.find((item) => item.id === activeRepositoryId);
    const exportData = repository ? { name: repository.name, analyzedAt: repository.analyzedAt, summary: repository.summary } : { name: 'web-app', summary: 'Demo architecture' };
    const download = document.createElement('a');
    download.href = URL.createObjectURL(new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' }));
    download.download = `${exportData.name}-architecture.json`;
    download.click();
    URL.revokeObjectURL(download.href);
    showToast('Architecture export downloaded');
  });
}

document.querySelectorAll('.doc-tabs button').forEach((button) => {
  button.dataset.handled = 'true';
  button.addEventListener('click', () => {
    document.querySelectorAll('.doc-tabs button').forEach((item) => item.classList.toggle('active', item === button));
    showToast(`${button.textContent} selected`);
  });
});

document.querySelectorAll('.document-list article').forEach((article) => {
  const button = article.querySelector('button');
  button.dataset.handled = 'true';
  button.addEventListener('click', () => {
    openActionModal(article.querySelector('h3').textContent, `<p>${article.querySelector('p').textContent}</p><ul><li>Document status: ${article.querySelector('small').textContent}</li><li>Source is ready to review in the documentation library.</li></ul>`, [{ id: 'close', label: 'Close', primary: true }]);
  });
});

document.querySelector('.document-list').addEventListener('click', (event) => {
  const article = event.target.closest('[data-document-path], [data-generated-document]');
  if (!article || !activeRepository) return;
  if (article.dataset.generatedDocument !== undefined) {
    const document = generatedDocuments[activeRepository.id]?.[Number(article.dataset.generatedDocument)];
    if (document) openActionModal(document.title, `<pre class="source-preview">${escapeHtml(document.content)}</pre>`, [{ id: 'close', label: 'Close', primary: true }]);
    return;
  }
  const file = activeRepository.files.find((item) => item.path === article.dataset.documentPath);
  if (!file) return;
  openActionModal(file.path, `<p>${escapeHtml(`${file.language} · ${file.lines} lines`)}</p><pre class="source-preview">${escapeHtml(file.searchText || 'No preview is available for this file.')}</pre>`, [{ id: 'close', label: 'Close', primary: true }]);
});

document.querySelectorAll('.finding-meta button').forEach((button) => {
  button.dataset.handled = 'true';
  button.addEventListener('click', () => {
    const finding = button.closest('article');
    openActionModal(finding.querySelector('h3').textContent, `<p>${finding.querySelector('small').textContent}</p><ul><li>Review the affected file and validate remediation.</li><li>Track the finding until the next security scan.</li></ul>`, [{ id: 'close', label: 'Close', primary: true }]);
  });
});

document.querySelector('#evidence-grid').addEventListener('click', (event) => {
  const card = event.target.closest('[data-evidence-index]');
  if (!card) return;
  const evidence = lastEvidence[Number(card.dataset.evidenceIndex)];
  if (!evidence) return;
  const metadata = evidence.functions.join(', ') || evidence.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`).join(', ') || evidence.terms.join(', ');
  openActionModal(evidence.path, `<p>${escapeHtml(metadata || 'Analyzed source file')}</p><pre class="source-preview">${escapeHtml(evidence.excerpt || 'No preview is available for this source file.')}</pre>`, [{ id: 'close', label: 'Close', primary: true }]);
});

document.querySelectorAll('button').forEach((button) => {
  if (button.dataset.view || button.dataset.question || button.dataset.repo || button.dataset.node || button.dataset.investigation || button.dataset.command || button.dataset.graph || button.dataset.handled || button.id || button.closest('#action-modal') || button.hasAttribute('data-close-modal')) return;
  button.addEventListener('click', () => {
    const label = button.textContent.replace(/\s+/g, ' ').trim() || 'More options';
    openActionModal(label, `<p>${label} is ready. RepoAI has opened the related workflow for this workspace.</p>`, [{ id: 'close', label: 'Close', primary: true }]);
  });
});

initializeApp();
