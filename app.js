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
let connectedRepositories = [];
let activeRepositoryId = null;
let lastEvidence = [];

const repositoryData = {
  'web-app': {
    logo: 'W', className: 'violet', title: 'web-app',
    description: 'Frontend application for the Acme customer platform.',
    languages: '<i class="lang-dot ts-dot"></i>TypeScript <i class="lang-dot css-dot"></i>CSS', endpoints: '38 mapped', dependencies: '124 analyzed', contributors: '18 active'
  },
  'api-service': {
    logo: 'A', className: 'blue', title: 'api-service',
    description: 'Core REST API for users, billing, and account operations.',
    languages: '<i class="lang-dot ts-dot"></i>TypeScript <i class="lang-dot postgres"></i>PostgreSQL', endpoints: '64 mapped', dependencies: '92 analyzed', contributors: '15 active'
  },
  'checkout-service': {
    logo: 'C', className: 'coral', title: 'checkout-service',
    description: 'Payment orchestration service for checkout and subscriptions.',
    languages: '<i class="lang-dot go"></i>Go <i class="lang-dot redis"></i>Redis', endpoints: '12 mapped', dependencies: '48 analyzed', contributors: '7 active'
  },
  'data-pipeline': {
    logo: 'D', className: 'green', title: 'data-pipeline',
    description: 'Analytics jobs and warehouse transformations.',
    languages: '<i class="lang-dot python"></i>Python <i class="lang-dot snowflake"></i>SQL', endpoints: '8 mapped', dependencies: '58 analyzed', contributors: '9 active'
  }
};

async function requestApi(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'RepoAI request failed');
  return body;
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
  if (connectedRepositories.length === 0) return;
  const table = document.querySelector('.repo-table');
  table.innerHTML = `<div class="repo-table-head"><span>Repository</span><span>Health</span><span>Coverage</span><span>Last analyzed</span><span></span></div>${connectedRepositories.map((repository, index) => {
    updateRepositoryData(repository, index);
    const data = repositoryData[repository.id];
    const coverage = Math.min(100, Math.max(45, Math.round((repository.summary.functionCount / Math.max(1, repository.summary.fileCount)) * 30 + 62)));
    return `<button class="repo-table-row repo-target" data-repo="${repository.id}"><span class="repo-cell"><span class="repo-logo ${data.className}">${data.logo}</span><span><strong>${escapeHtml(repository.name)}</strong><small><svg><use href="#i-branch"/></svg> ${escapeHtml(repository.branch)}</small></span></span><span><i class="health-dot good-dot"></i>Analyzed <b>${repository.summary.fileCount}</b></span><span class="coverage"><i><b style="width: ${coverage}%"></b></i>${coverage}%</span><span class="analyzed">${formatRelativeTime(repository.analyzedAt)}</span><span><svg class="row-arrow"><use href="#i-chevron"/></svg></span></button>`;
  }).join('')}`;
  renderOverviewRepositories();
}

function renderOverviewRepositories() {
  const healthList = document.querySelector('.health-list');
  const overviewCount = document.querySelector('.stats-grid .stat-card:first-child strong');
  const navigationCount = document.querySelector('.nav-item[data-view="repositories"] em');
  overviewCount.textContent = String(connectedRepositories.length);
  navigationCount.textContent = String(connectedRepositories.length);
  healthList.innerHTML = connectedRepositories.slice(0, 6).map((repository, index) => {
    updateRepositoryData(repository, index);
    const data = repositoryData[repository.id];
    const score = Math.min(99, Math.max(70, 72 + Math.min(25, repository.summary.fileCount)));
    return `<button class="health-row repo-target" data-repo="${repository.id}"><span class="repo-logo ${data.className}">${data.logo}</span><span class="health-name"><strong>${escapeHtml(repository.name)}</strong><small>${escapeHtml(repository.branch)} · ${repository.summary.fileCount} files · Updated ${formatRelativeTime(repository.analyzedAt)}</small></span><span class="stack-dots"><i class="dot ts"></i><i class="dot next"></i></span><span class="score good">${score}</span><svg class="row-arrow"><use href="#i-chevron"/></svg></button>`;
  }).join('');
}

async function loadConnectedRepositories() {
  try {
    const data = await requestApi('/api/repositories');
    connectedRepositories = data.repositories;
    connectedRepositories.forEach(updateRepositoryData);
    if (connectedRepositories.length > 0 && !activeRepositoryId) activeRepositoryId = connectedRepositories[0].id;
    renderConnectedRepositories();
  } catch {
    connectedRepositories = [];
  }
}

const nodeData = {
  web: { icon: 'i-grid', iconClass: 'ui-icon', kind: 'Frontend', title: 'Web application', description: 'The customer-facing application. Handles routing, UI state, authentication flows, and API requests.', files: '243', dependencies: '18', endpoints: '38', connections: ['API service', 'Auth service'] },
  api: { icon: 'i-cube', iconClass: 'service-mini', kind: 'Service', title: 'API service', description: 'The core REST API. It owns user, account, and billing workflows for the platform.', files: '168', dependencies: '42', endpoints: '64', connections: ['PostgreSQL', 'Redis', 'Auth service'] },
  auth: { icon: 'i-shield', iconClass: 'ui-icon', kind: 'Identity service', title: 'Auth service', description: 'Verifies JWTs, manages OAuth callback exchanges, and provides service identity.', files: '61', dependencies: '14', endpoints: '9', connections: ['Web application', 'API service', 'Redis'] },
  postgres: { icon: 'i-cube', iconClass: 'service-mini', kind: 'Data store', title: 'PostgreSQL', description: 'Primary relational database for application and billing data.', files: '38', dependencies: '7', endpoints: '0', connections: ['API service', 'Auth service'] },
  redis: { icon: 'i-cube', iconClass: 'service-mini', kind: 'Data store', title: 'Redis', description: 'Low-latency cache for sessions, API response data, and rate limits.', files: '12', dependencies: '4', endpoints: '0', connections: ['API service', 'Auth service'] },
  stripe: { icon: 'i-external', iconClass: 'service-mini', kind: 'External integration', title: 'Stripe', description: 'Payment authorization and invoicing provider called by the checkout and API services.', files: '17', dependencies: '2', endpoints: '6', connections: ['API service', 'checkout-service'] }
};

const graphViews = {
  systems: {
    caption: 'Updated from analyzed repository files',
    lines: '<path d="M190 122 C255 122 242 135 300 135"/><path d="M190 122 C250 122 245 300 300 300"/><path d="M416 135 C485 135 488 112 553 112"/><path d="M416 135 C485 135 488 236 553 236"/><path d="M416 300 C485 300 488 236 553 236"/><path class="dashed" d="M416 300 C470 300 490 362 553 362"/>',
    nodes: {
      web: { title: 'Web application', subtitle: 'Next.js · TypeScript', kind: 'Frontend', description: 'The customer-facing application. Handles routing, UI state, authentication flows, and API requests.', style: 'ui-node', position: ['7%', '82px'] },
      api: { title: 'API service', subtitle: 'Node.js · REST', kind: 'Service', description: 'The core REST API. It owns user, account, and billing workflows for the platform.', style: 'service-node', position: ['39%', '95px'] },
      auth: { title: 'Auth service', subtitle: 'JWT · OAuth 2.0', kind: 'Identity service', description: 'Verifies JWTs, manages OAuth callback exchanges, and provides service identity.', style: 'service-node', position: ['39%', '260px'] },
      postgres: { title: 'PostgreSQL', subtitle: 'Primary database', kind: 'Data store', description: 'Primary relational database for application and billing data.', style: 'data-node', position: ['72%', '73px'] },
      redis: { title: 'Redis', subtitle: 'Session cache', kind: 'Data store', description: 'Low-latency cache for sessions, API response data, and rate limits.', style: 'data-node', position: ['72%', '198px'] },
      stripe: { title: 'Stripe', subtitle: 'Payment provider', kind: 'External integration', description: 'Payment authorization and invoicing provider called by the checkout and API services.', style: 'integration-node', position: ['72%', '324px'] }
    }
  },
  api: {
    caption: 'Request flow from client to payment authorization',
    lines: '<path d="M160 118 C220 118 230 118 290 118"/><path d="M405 118 C465 118 475 118 535 118"/><path d="M650 118 C650 185 590 210 535 250"/><path d="M405 250 C350 250 345 250 290 250"/><path d="M160 250 C120 250 110 190 160 118"/>',
    nodes: {
      web: { title: 'Client request', subtitle: 'POST /v1/checkout', kind: 'API caller', description: 'The web application sends the authenticated checkout request with cart items and payment method.', style: 'ui-node', position: ['5%', '82px'] },
      api: { title: 'Checkout route', subtitle: 'src/routes/checkout.js', kind: 'API endpoint', description: 'The checkout route validates the request and creates an order before authorizing payment.', style: 'service-node', position: ['37%', '82px'] },
      auth: { title: 'JWT verifier', subtitle: 'src/auth/verifyJwt.js', kind: 'Authentication', description: 'Bearer tokens are verified before the checkout request reaches the business workflow.', style: 'service-node', position: ['69%', '82px'] },
      postgres: { title: 'Order store', subtitle: 'src/data/orders.js', kind: 'Persistence', description: 'The order store creates a pending order and records the resulting authorization.', style: 'data-node', position: ['69%', '214px'] },
      redis: { title: 'Payment retry', subtitle: 'src/checkout/retry.js', kind: 'Resilience', description: 'The retry policy retries transient payment gateway failures within a fixed time budget.', style: 'service-node', position: ['37%', '214px'] },
      stripe: { title: 'Gateway adapter', subtitle: 'authorizePayment.js', kind: 'Payment integration', description: 'The payment authorizer calls the configured gateway and returns the authorization result.', style: 'integration-node', position: ['5%', '214px'] }
    }
  },
  data: {
    caption: 'Checkout data entities and their relationships',
    lines: '<path d="M175 115 C255 115 260 115 340 115"/><path d="M455 115 C535 115 540 115 620 115"/><path d="M397 160 C397 222 397 230 397 292"/><path d="M620 160 C570 230 500 255 455 292"/>',
    nodes: {
      web: { title: 'User', subtitle: 'id · email · role', kind: 'Entity', description: 'An authenticated user owns checkout activity and is resolved from the verified JWT subject.', style: 'data-node', position: ['7%', '78px'] },
      api: { title: 'Checkout session', subtitle: 'items · paymentMethod', kind: 'Entity', description: 'The incoming checkout payload holds items and the selected payment method.', style: 'data-node', position: ['39%', '78px'] },
      auth: { title: 'Order', subtitle: 'id · total · status', kind: 'Entity', description: 'An order starts pending and is marked authorized after successful payment authorization.', style: 'data-node', position: ['71%', '78px'] },
      postgres: { title: 'Payment authorization', subtitle: 'id · orderId · status', kind: 'Entity', description: 'The authorization links the payment gateway result back to the order record.', style: 'data-node', position: ['39%', '254px'] },
      redis: { title: 'Order item', subtitle: 'sku · quantity · price', kind: 'Entity', description: 'Each order item contributes to the total passed to the payment gateway.', style: 'data-node', position: ['71%', '254px'] },
      stripe: { title: 'Payment method', subtitle: 'tokenized reference', kind: 'Entity', description: 'Payment methods are token references supplied by the checkout client.', style: 'integration-node', position: ['7%', '254px'] }
    }
  }
};

function renderGraphView(viewName) {
  const view = graphViews[viewName];
  if (!view) return;
  const canvas = document.querySelector('#graph-canvas');
  canvas.querySelector('.graph-lines').innerHTML = view.lines;
  canvas.querySelector('.graph-caption').textContent = view.caption;
  Object.entries(view.nodes).forEach(([id, definition]) => {
    const node = canvas.querySelector(`[data-node="${id}"]`);
    node.className = `graph-node ${definition.style}`;
    node.style.left = definition.position[0];
    node.style.top = definition.position[1];
    node.querySelector('strong').textContent = definition.title;
    node.querySelector('small').textContent = definition.subtitle;
    nodeData[id] = { ...nodeData[id], title: definition.title, kind: definition.kind, description: definition.description };
  });
  selectNode('web');
}

const investigationData = {
  checkout: { title: 'Elevated checkout failures', summary: 'Checkout completion errors increased to 8.4% following deployment <code>v2.14.6</code>.', cause: 'Timeout introduced in the payment authorization path', body: 'The new retry wrapper can exceed the downstream Stripe timeout when the initial authorization is slow.', confidence: '92% confidence' },
  auth: { title: 'Intermittent SSO callback errors', summary: 'SSO callback failures increased after a stricter redirect URI validation rule was merged.', cause: 'Redirect URI normalization differs between identity providers', body: 'The callback handler rejects valid URI variants that include a trailing slash from two configured providers.', confidence: '81% confidence' },
  jobs: { title: 'Delayed analytics job runs', summary: 'The daily conversion aggregation is completing 47 minutes later than its normal schedule.', cause: 'Warehouse queue saturation is delaying the billing transformation', body: 'A backfill from the customer import worker is consuming available warehouse slots during the scheduled run.', confidence: '74% confidence' }
};

function setView(viewName) {
  const target = document.querySelector(`#view-${viewName}`);
  if (!target) return;
  views.forEach((view) => view.classList.toggle('is-visible', view === target));
  navItems.forEach((item) => item.classList.toggle('active', item.dataset.view === viewName));
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
  commandOverlay.classList.add('open');
  commandOverlay.setAttribute('aria-hidden', 'false');
  window.setTimeout(() => commandInput.focus(), 100);
}

function closeCommand() {
  commandOverlay.classList.remove('open');
  commandOverlay.setAttribute('aria-hidden', 'true');
}

function openConnectModal() {
  connectModal.classList.add('open');
  connectModal.setAttribute('aria-hidden', 'false');
  window.setTimeout(() => document.querySelector('#repository-url').focus(), 100);
}

function closeConnectModal() {
  connectModal.classList.remove('open');
  connectModal.setAttribute('aria-hidden', 'true');
}

function openActionModal(title, content, actions = []) {
  actionModalTitle.textContent = title;
  actionModalContent.innerHTML = content;
  actionModalActions.innerHTML = actions.map((action) => `<button class="button ${action.primary ? 'primary' : 'secondary'}" data-modal-action="${action.id}">${action.label}</button>`).join('');
  actionModal.classList.add('open');
  actionModal.setAttribute('aria-hidden', 'false');
}

function closeActionModal() {
  actionModal.classList.remove('open');
  actionModal.setAttribute('aria-hidden', 'true');
}

function setDarkMode(enabled) {
  document.body.classList.toggle('dark-mode', enabled);
  document.querySelector('#dark-mode-toggle').textContent = enabled ? '◑' : '◐';
  document.querySelector('#dark-mode-toggle').setAttribute('aria-label', enabled ? 'Disable dark mode' : 'Enable dark mode');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', enabled ? '#1d2021' : '#fbf1c7');
  try { localStorage.setItem('repoai-dark-mode', enabled ? 'on' : 'off'); } catch { }
}

function selectRepository(repository) {
  const data = repositoryData[repository];
  if (!data) return;
  if (connectedRepositories.some((item) => item.id === repository)) activeRepositoryId = repository;
  const logo = document.querySelector('#detail-logo');
  logo.textContent = data.logo;
  logo.className = `repo-logo ${data.className}`;
  document.querySelector('#detail-title').textContent = data.title;
  document.querySelector('#detail-description').textContent = data.description;
  const metrics = document.querySelectorAll('.detail-metrics strong');
  metrics[0].innerHTML = data.languages;
  metrics[1].textContent = data.endpoints;
  metrics[2].textContent = data.dependencies;
  metrics[3].textContent = data.contributors;
  setView('repositories');
  window.setTimeout(() => document.querySelector('#repository-detail').scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
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
  document.querySelector('#node-connections').innerHTML = data.connections.map((name) => `<button><span class="mini-node service-mini">${name.charAt(0)}</span>${name}<svg><use href="#i-chevron"/></svg></button>`).join('');
}

function selectInvestigation(name) {
  const data = investigationData[name];
  if (!data) return;
  document.querySelectorAll('.investigation-row').forEach((row) => row.classList.toggle('active', row.dataset.investigation === name));
  document.querySelector('#investigation-title').textContent = data.title;
  document.querySelector('#investigation-summary').innerHTML = data.summary;
  document.querySelector('.finding-callout h3').textContent = data.cause;
  document.querySelector('.finding-callout p:not(.eyebrow)').textContent = data.body;
  document.querySelector('.confidence').textContent = data.confidence;
}

function answerFor(question) {
  const normalized = question.toLowerCase();
  if (normalized.includes('checkout') || normalized.includes('payment')) {
    return {
      answer: `<p><strong>Checkout failures are most likely caused by the new authorization retry wrapper.</strong> It was deployed in <code>checkout-service v2.14.6</code> at 10:18 AM, immediately before the error rate for <code>POST /v1/checkout</code> rose from 0.6% to 8.4%.</p><p>The retry sequence can run beyond Stripe's downstream timeout when the initial authorization is slow. The failure is isolated to the payment authorization path; cart creation and order persistence remain healthy.</p><ul><li>Cap retries at the remaining downstream request budget.</li><li>Redeploy the fix as <code>v2.14.7</code> and watch authorization p95 latency.</li></ul>`,
      evidence: [['services/payment/authorization.go', 'Retry behavior changed in PR #184'], ['internal/resilience/retry.go', 'No remaining-time budget is enforced'], ['deployments/v2.14.6', 'Production deployment at 10:18 AM'], ['POST /v1/checkout', 'Error rate increased after deployment']]
    };
  }
  if (normalized.includes('invoice')) {
    return {
      answer: `<p><strong>Customer invoices are created by the billing workflow in the API service.</strong> The <code>POST /v1/invoices</code> endpoint validates the account, creates a pending invoice record, and calls the Stripe invoice adapter.</p><p>Invoice creation is owned by <code>src/billing/createInvoice.ts</code>. The process emits an <code>invoice.created</code> event which is consumed by the email notification worker.</p>`,
      evidence: [['src/billing/createInvoice.ts', 'Primary invoice creation workflow'], ['src/routes/invoices.ts', 'POST /v1/invoices endpoint'], ['adapters/stripe/invoices.ts', 'Stripe invoice adapter'], ['events/invoice.created', 'Notification consumer event']]
    };
  }
  if (normalized.includes('modified') || normalized.includes('recent')) {
    return {
      answer: `<p><strong>Jordan Miles made the most recent checkout-related change.</strong> Pull request <code>#184 Add authorization retry behavior</code> was merged at 10:07 AM and deployed in <code>checkout-service v2.14.6</code>.</p><p>The change touched the retry policy and payment authorization client. Priya Lal approved the pull request, and Theo Ramos performed the production deployment.</p>`,
      evidence: [['PR #184', 'Merged by Jordan Miles at 10:07 AM'], ['services/payment/authorization.go', 'Updated authorization client'], ['internal/resilience/retry.go', 'New retry behavior'], ['deployment v2.14.6', 'Deployed by Theo Ramos']]
    };
  }
  return {
    answer: `<p><strong>JWT verification happens in the Auth service, before requests reach protected API handlers.</strong> The verification middleware extracts the bearer token, allowlists the signing algorithm, validates issuer and audience claims, and attaches the authenticated principal to the request context.</p><p>The web application performs the OAuth callback exchange, while the API service uses the shared verifier for service-to-service requests. There is one security finding: the API service should explicitly allowlist accepted signing algorithms.</p><ul><li>Primary verifier: <code>src/auth/verify.ts</code></li><li>Route middleware: <code>src/middleware/requireAuth.ts</code></li></ul>`,
    evidence: [['src/auth/verify.ts', 'JWT signature and claims verification'], ['src/middleware/requireAuth.ts', 'Protected API route middleware'], ['app/auth/callback/route.ts', 'OAuth callback exchange'], ['security/JWT-2026-07', 'Signing algorithm allowlist finding']]
  };
}

function renderAnswer(question) {
  const trimmedQuestion = question.trim() || 'Where is JWT verified?';
  const result = answerFor(trimmedQuestion);
  document.querySelector('#answer-question').textContent = trimmedQuestion;
  document.querySelector('#answer-content').innerHTML = result.answer;
  document.querySelector('#evidence-grid').innerHTML = result.evidence.map(([source, detail]) => `<button class="evidence-card"><svg><use href="#i-file"/></svg><span><strong>${source}</strong><small>${detail}</small></span></button>`).join('');
  document.querySelector('#search-answer').classList.remove('hidden');
  window.setTimeout(() => document.querySelector('#search-answer').scrollIntoView({ behavior: 'smooth', block: 'start' }), 70);
}

function renderRepositoryAnswer(question, result) {
  lastEvidence = result.evidence;
  document.querySelector('#answer-question').textContent = question;
  document.querySelector('#answer-content').textContent = result.answer;
  document.querySelector('#evidence-grid').innerHTML = result.evidence.map((item, index) => `<button class="evidence-card" data-evidence-index="${index}"><svg><use href="#i-file"/></svg><span><strong>${escapeHtml(item.path)}</strong><small>${escapeHtml(item.functions.join(', ') || item.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`).join(', ') || item.terms.join(', '))}</small></span></button>`).join('');
  document.querySelector('.evidence-heading span').textContent = `Grounded in ${result.evidence.length} source files`;
  document.querySelector('.answer-footer').innerHTML = `<span><i></i>${result.confidence} confidence · ${result.source === 'openai' ? 'OpenAI synthesis' : 'Local evidence synthesis'}</span><span>Analyzed codebase</span>`;
  document.querySelector('#search-answer').classList.remove('hidden');
  if (result.warning) showToast(result.warning);
  window.setTimeout(() => document.querySelector('#search-answer').scrollIntoView({ behavior: 'smooth', block: 'start' }), 70);
}

async function askQuestion(question) {
  const trimmedQuestion = question.trim() || 'Where is JWT verified?';
  if (!activeRepositoryId) return renderAnswer(trimmedQuestion);
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

document.querySelectorAll('.graph-node').forEach((button) => {
  button.addEventListener('click', () => selectNode(button.dataset.node));
});

document.querySelectorAll('.investigation-row[data-investigation]').forEach((button) => {
  button.addEventListener('click', () => selectInvestigation(button.dataset.investigation));
});

document.querySelector('#open-command').addEventListener('click', openCommand);
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
document.querySelectorAll('[data-question]').forEach((button) => {
  button.addEventListener('click', () => {
    const question = button.dataset.question;
    setView('search');
    document.querySelector('#ai-question').value = question;
    window.setTimeout(() => askQuestion(question), 50);
  });
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
    document.querySelector('#investigation-title').textContent = result.title;
    document.querySelector('#investigation-summary').textContent = result.likelyRootCause;
    document.querySelector('.confidence').textContent = `${result.confidence} confidence`;
    showToast('Investigation created from repository evidence');
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector('#generate-docs').addEventListener('click', () => {
  const button = document.querySelector('#generate-docs');
  button.innerHTML = '<svg><use href="#i-check"/></svg>Documentation generated';
  button.disabled = true;
  showToast('Documentation generation complete');
});

document.querySelector('#run-security-scan').addEventListener('click', () => {
  const button = document.querySelector('#run-security-scan');
  button.innerHTML = '<svg><use href="#i-check"/></svg>Scan complete';
  showToast('Security scan completed — no new findings');
});

commandOverlay.addEventListener('click', (event) => { if (event.target === commandOverlay) closeCommand(); });
document.querySelectorAll('[data-command]').forEach((button) => {
  button.addEventListener('click', () => {
    const command = button.dataset.command;
    closeCommand();
    setView(command);
    if (command === 'search') window.setTimeout(() => document.querySelector('#ai-question').focus(), 100);
    if (command === 'investigations') showToast('New investigation created — gathering repository signals');
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
  openActionModal('Notifications', '<ul><li>Repository analysis is up to date.</li><li>Checkout investigation has new evidence.</li><li>Documentation coverage increased after the latest scan.</li></ul>', [{ id: 'close', label: 'Mark as read', primary: true }]);
});

document.querySelector('.workspace-switcher').addEventListener('click', () => {
  openActionModal('Acme, Inc. workspace', '<p>This local workspace contains repositories analyzed by RepoAI. Connect another repository from the Repositories page.</p>', [{ id: 'repositories', label: 'Open repositories', primary: true }]);
});

document.querySelector('#user-menu').addEventListener('click', () => {
  const darkModeLabel = document.body.classList.contains('dark-mode') ? 'Use light mode' : 'Use dark mode';
  openActionModal('Vishal', '<p>Workspace administrator</p><ul><li>Local repository analysis is enabled</li><li>OpenAI synthesis is optional</li></ul>', [{ id: 'toggle-dark', label: darkModeLabel, primary: true }, { id: 'close', label: 'Close' }]);
});

actionModalActions.addEventListener('click', (event) => {
  const button = event.target.closest('[data-modal-action]');
  if (!button) return;
  if (button.dataset.modalAction === 'toggle-dark') setDarkMode(!document.body.classList.contains('dark-mode'));
  if (button.dataset.modalAction === 'repositories') setView('repositories');
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

loadConnectedRepositories();
