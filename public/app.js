/**
 * Chuba - Titan Tracker - Frontend Application
 */

const API_BASE = '/api';

// Item name cache for display
const itemNameCache = new Map();

/**
 * Get display name for an item (sync version for template rendering)
 * Falls back to the raw item name if not cached
 */
function getItemDisplayName(itemTemplate) {
  if (!itemTemplate) return 'Unknown Item';

  // Check cache first
  if (itemNameCache.has(itemTemplate)) {
    return escapeHtml(itemNameCache.get(itemTemplate));
  }

  // Return the template name cleaned up (remove path, remove extension)
  let name = itemTemplate;
  if (name.includes('/')) {
    name = name.split('/').pop();
  }
  if (name.endsWith('.iff')) {
    name = name.slice(0, -4);
  }
  // Convert underscores to spaces and title case
  name = name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return escapeHtml(name);
}

/**
 * Async function to fetch and cache item display name from server
 */
async function fetchItemDisplayName(itemTemplate) {
  if (!itemTemplate || itemNameCache.has(itemTemplate)) return;

  try {
    const result = await apiGet(`/items/by-template/${encodeURIComponent(itemTemplate)}`);
    if (result.success && result.data) {
      itemNameCache.set(itemTemplate, result.data.displayName || result.data.stringName || result.data.name);
    }
  } catch (e) {
    // Ignore errors, will use fallback
  }
}

// ===== State =====
let currentView = 'dashboard';
let currentUser = null;
let isAdmin = false;
let adminLevel = 0;
let resources = [];
let schematics = [];
let categories = [];

// Pagination state
const PAGE_SIZE = 25;
let resourcePagination = { page: 1, total: 0, data: [] };
let schematicPagination = { page: 1, total: 0, data: [] };
// Items uses itemsCurrentPage, itemsPageSize, itemsTotalCount defined in items section

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', () => {
  checkSession();
  initLoginForm();
  initNavigation();

  // Set up search handlers (with null checks)
  const resourceSearchInput = document.getElementById('resourceSearch');
  if (resourceSearchInput) {
    resourceSearchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') searchResources();
    });
  }

  const schematicSearchInput = document.getElementById('schematicSearch');
  if (schematicSearchInput) {
    schematicSearchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') searchSchematics();
    });
  }

  // Quest search handler
  const questSearchInput = document.getElementById('questSearch');
  if (questSearchInput) {
    questSearchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') loadQuests();
    });
  }
});

// ===== Authentication =====
async function checkSession() {
  try {
    const result = await apiGet('/auth/session');

    if (result.data?.authenticated) {
      currentUser = result.data.username;
      isAdmin = result.data.isAdmin;
      adminLevel = result.data.adminLevel || 0;
      showMainApp();
    } else {
      showLoginScreen();
    }
  } catch (error) {
    console.error('Session check failed', error);
    showLoginScreen();
  }
}

function showLoginScreen() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('mainApp').classList.add('hidden');
}

function showMainApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('mainApp').classList.remove('hidden');

  // Update user display
  document.getElementById('currentUser').textContent = currentUser;

  // Show admin elements if user is admin
  if (isAdmin) {
    document.body.classList.add('is-admin');
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
  } else {
    document.body.classList.remove('is-admin');
  }

  // Load initial data
  checkHealth();
  loadDashboard();
}

function initLoginForm() {
  const form = document.getElementById('loginForm');
  if (!form) {
    console.error('[Login] Login form not found');
    return;
  }

  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    e.stopPropagation();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');


    errorEl.textContent = '';
    btn.classList.add('loading');
    btn.disabled = true;

    try {
      const result = await apiPost('/auth/login', { username, password });

      if (result.success) {
        currentUser = result.data.username;
        isAdmin = result.data.isAdmin;
        adminLevel = result.data.adminLevel || 0;
        showMainApp();
        showToast(`Welcome, ${currentUser}!`, 'success');
      } else {
        errorEl.textContent = result.error || 'Login failed';
      }
    } catch (error) {
      console.error('[Login] Error:', error);
      errorEl.textContent = error.message || 'Login failed';
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }

    return false;
  });
}

async function logout() {
  try {
    await apiPost('/auth/logout', {});
  } catch (error) {
    console.error('Logout error', error);
  }

  currentUser = null;
  isAdmin = false;
  document.body.classList.remove('is-admin');
  showLoginScreen();

  // Clear form
  document.getElementById('username').value = '';
  document.getElementById('password').value = '';
  document.getElementById('loginError').textContent = '';
}

// ===== Navigation =====
function initNavigation() {
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => {
    if (btn.id === 'lookupDropdownBtn') return; // handled below
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view) switchView(view);
    });
  });

  // Profile (username) button
  const profileBtn = document.getElementById('currentUser');
  if (profileBtn && profileBtn.dataset.view) {
    profileBtn.addEventListener('click', () => switchView(profileBtn.dataset.view));
  }

  // Lookup dropdown toggle
  const dropdownBtn = document.getElementById('lookupDropdownBtn');
  const dropdownMenu = document.getElementById('lookupDropdownMenu');
  if (dropdownBtn && dropdownMenu) {
    dropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const visible = dropdownMenu.style.display !== 'none';
      dropdownMenu.style.display = visible ? 'none' : 'block';
    });
    // Dropdown items
    dropdownMenu.querySelectorAll('.nav-dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        const view = item.dataset.view;
        dropdownMenu.style.display = 'none';
        if (view) switchView(view);
      });
    });
    // Close dropdown when clicking elsewhere
    document.addEventListener('click', () => {
      dropdownMenu.style.display = 'none';
    });
  }
}

function switchView(view) {
  // Check admin access for admin view
  if (view === 'admin' && !isAdmin) {
    showToast('Admin access required', 'error');
    return;
  }

  currentView = view;

  const lookupViews = ['playerLookup', 'cityLookup'];
  const isLookup = lookupViews.includes(view);

  // Update nav buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.id === 'lookupDropdownBtn') {
      btn.classList.toggle('active', isLookup);
    } else {
      btn.classList.toggle('active', btn.dataset.view === view);
    }
  });
  const profileNavBtn = document.getElementById('currentUser');
  if (profileNavBtn) profileNavBtn.classList.toggle('active', view === 'profile');

  // Update views
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === `${view}View`);
  });

  // Load view data
  switch (view) {
    case 'dashboard':
      loadDashboard();
      break;
    case 'resources':
      loadAllResources();
      break;
    case 'schematics':
      loadAllSchematics();
      break;
    case 'items':
      loadItemsView();
      break;
    case 'quests':
      loadQuestsView();
      break;
    case 'terrain':
      initTerrainView();
      break;
    case 'admin':
      loadAdminPanel();
      break;
    case 'playerLookup':
      // Initial load handled by user search
      break;
    case 'cityLookup':
      loadCities();
      break;
    case 'profile':
      loadProfileView();
      break;
  }
}

// ===== API Functions =====
async function apiGet(endpoint) {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      credentials: 'include',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`API Error: ${endpoint}`, error);
    throw error;
  }
}

async function apiPost(endpoint, data) {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `HTTP ${response.status}`);
    }
    return result;
  } catch (error) {
    console.error(`API Error: ${endpoint}`, error);
    throw error;
  }
}

async function apiPut(endpoint, data) {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `HTTP ${response.status}`);
    }
    return result;
  } catch (error) {
    console.error(`API Error: ${endpoint}`, error);
    throw error;
  }
}

async function apiDelete(endpoint) {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `HTTP ${response.status}`);
    }
    return result;
  } catch (error) {
    console.error(`API Error: ${endpoint}`, error);
    throw error;
  }
}

async function checkHealth() {
  const indicator = document.getElementById('statusIndicator');
  const dot = indicator.querySelector('.status-dot');
  const text = indicator.querySelector('.status-text');

  try {
    const health = await apiGet('/health');
    dot.classList.remove('error');
    dot.classList.add('connected');
    text.textContent = 'Connected';
  } catch (error) {
    dot.classList.remove('connected');
    dot.classList.add('error');
    text.textContent = 'Disconnected';
  }
}

// ===== Dashboard =====
let playerCountChart = null;

async function loadDashboard() {
  loadStats();
  loadRecentResources();
  loadResourceClasses();
  loadServerStatus();
  loadDashboardChart(24);
}

async function loadServerStatus() {
  try {
    const result = await apiGet('/status/current');
    const data = result.data;

    const badge = document.getElementById('serverStatusBadge');
    const playerEl = document.getElementById('dashPlayerCount');
    const highestEl = document.getElementById('dashHighestCount');
    const updatedEl = document.getElementById('dashLastUpdated');

    if (!data) {
      badge.textContent = 'Unknown';
      badge.style.background = 'var(--bg-tertiary)';
      badge.style.color = 'var(--text-secondary)';
      return;
    }

    const playerCount = data.player_count;
    const highest = data.highest_player_count;

    if (playerCount != null && playerCount > 0) {
      badge.textContent = 'Online';
      badge.style.background = '#0d3320';
      badge.style.color = '#4ade80';
    } else if (playerCount === 0) {
      badge.textContent = 'Online';
      badge.style.background = '#0d3320';
      badge.style.color = '#4ade80';
    } else {
      badge.textContent = 'Offline';
      badge.style.background = '#3d1519';
      badge.style.color = '#f87171';
    }

    playerEl.textContent = playerCount != null ? String(playerCount) : '-';
    highestEl.textContent = highest != null ? String(highest) : '-';

    if (data.timestamp) {
      const date = new Date(data.timestamp);
      updatedEl.textContent = formatTimeAgo(date);
    }
  } catch (error) {
    console.error('[Dashboard] Failed to load server status:', error);
  }
}

async function loadDashboardChart(hours = 24) {
  // Highlight active button
  ['24', '168', '720'].forEach(h => {
    const btn = document.getElementById(`chartBtn${h === '24' ? '24h' : h === '168' ? '7d' : '30d'}`);
    if (btn) btn.style.opacity = (String(hours) === h) ? '1' : '0.5';
  });

  try {
    const result = await apiGet(`/status/history?hours=${hours}`);
    const data = result.data || [];

    const canvas = document.getElementById('playerCountChart');
    if (!canvas) return;

    const labels = data.map(d => {
      const date = new Date(d.timestamp);
      if (hours <= 24) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (hours <= 168) return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit' });
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    });
    const playerCounts = data.map(d => d.player_count);
    const peakCounts = data.map(d => d.highest_player_count);

    if (playerCountChart) {
      playerCountChart.destroy();
    }

    if (typeof Chart === 'undefined') {
      canvas.parentElement.innerHTML = '<p style="color: var(--text-secondary); padding: 16px; text-align: center;">Chart.js not loaded</p>';
      return;
    }

    playerCountChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Players Online',
            data: playerCounts,
            borderColor: '#60a5fa',
            backgroundColor: 'rgba(96, 165, 250, 0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: data.length > 100 ? 0 : 2,
          },
          {
            label: 'Peak',
            data: peakCounts,
            borderColor: '#facc15',
            backgroundColor: 'transparent',
            borderDash: [4, 4],
            tension: 0.3,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
          tooltip: { backgroundColor: '#1e293b', titleColor: '#e2e8f0', bodyColor: '#cbd5e1' },
        },
        scales: {
          x: {
            ticks: {
              color: '#64748b',
              maxTicksLimit: 12,
              font: { size: 10 },
            },
            grid: { color: 'rgba(100,116,139,0.15)' },
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#64748b', font: { size: 10 } },
            grid: { color: 'rgba(100,116,139,0.15)' },
          },
        },
      },
    });
  } catch (error) {
    console.error('[Dashboard] Failed to load chart data:', error);
  }
}

async function loadStats() {
  try {
    const [healthStats, schematicsList] = await Promise.all([
      apiGet('/health/stats'),
      apiGet('/schematics?limit=1000')
    ]);

    const stats = healthStats.data;

    document.getElementById('totalResources').textContent =
      stats.resources?.total?.toLocaleString() || '0';
    document.getElementById('activeResources').textContent =
      stats.resources?.active?.toLocaleString() || '0';
    document.getElementById('totalSchematics').textContent =
      schematicsList.count?.toLocaleString() || '0';

    // Last poll time
    const lastPoll = stats.recentPolls?.[0];
    if (lastPoll?.completed_at) {
      const date = new Date(lastPoll.completed_at);
      document.getElementById('lastPoll').textContent = formatTimeAgo(date);
    } else {
      document.getElementById('lastPoll').textContent = 'Never';
    }
  } catch (error) {
    console.error('Failed to load stats', error);
  }
}

async function loadRecentResources() {
  const tbody = document.querySelector('#recentResourcesTable tbody');
  tbody.innerHTML = '<tr><td colspan="10" class="loading"><span class="spinner"></span> Loading...</td></tr>';

  try {
    const result = await apiGet('/resources?active=true&limit=20');

    if (!result.data || result.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No active resources found</td></tr>';
      return;
    }

    tbody.innerHTML = result.data.map(resource => `
      <tr class="clickable-row" onclick="openResourceModal('${resource.id}')" title="Click to view details">
        <td><span class="resource-name">${escapeHtml(resource.name)}</span></td>
        <td>
          <span class="resource-class-cell">
            <img src="/images/${escapeHtml(resource.classIcon || 'default.png')}" alt="" class="resource-icon" onerror="this.src='/images/default.png'">
            <span class="slot-tag" title="${escapeHtml(resource.class)}">${escapeHtml(resource.className || resource.class)}</span>
          </span>
        </td>
        <td class="stat-cell ${getStatClass(resource.stats.OQ)}">${resource.stats.OQ || '-'}</td>
        <td class="stat-cell ${getStatClass(resource.stats.CD)}">${resource.stats.CD || '-'}</td>
        <td class="stat-cell ${getStatClass(resource.stats.DR)}">${resource.stats.DR || '-'}</td>
        <td class="stat-cell ${getStatClass(resource.stats.HR)}">${resource.stats.HR || '-'}</td>
        <td class="stat-cell ${getStatClass(resource.stats.MA)}">${resource.stats.MA || '-'}</td>
        <td class="stat-cell ${getStatClass(resource.stats.PE)}">${resource.stats.PE || '-'}</td>
        <td class="stat-cell ${getStatClass(resource.stats.SR)}">${resource.stats.SR || '-'}</td>
        <td class="stat-cell ${getStatClass(resource.stats.UT)}">${resource.stats.UT || '-'}</td>
      </tr>
    `).join('');
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">Failed to load resources</td></tr>';
  }
}

async function loadResourceClasses() {
  const grid = document.getElementById('resourceClassGrid');
  grid.innerHTML = '<div class="loading"><span class="spinner"></span> Loading...</div>';

  try {
    const result = await apiGet('/health/stats');
    const byClass = result.data?.resources?.byClass || [];

    if (byClass.length === 0) {
      grid.innerHTML = '<div class="empty-state">No resource classes found</div>';
      return;
    }

    // Fetch class info for icons
    let classInfoMap = {};
    try {
      const classesResult = await apiGet('/resources/classes');
      if (classesResult.data) {
        classesResult.data.forEach(c => {
          classInfoMap[c.enumName] = c;
        });
      }
    } catch (e) {
      console.warn('Could not fetch resource class info', e);
    }

    grid.innerHTML = byClass.slice(0, 20).map(cls => {
      const classInfo = classInfoMap[cls.resource_class] || {};
      const icon = classInfo.icon || 'default.png';
      const displayName = classInfo.stringName || cls.resource_class;
      return `
        <div class="class-card" onclick="filterByClass('${escapeHtml(cls.resource_class)}')">
          <div class="class-card-header">
            <img src="/images/${escapeHtml(icon)}" alt="" class="resource-icon-lg" onerror="this.src='/images/default.png'">
            <div class="class-card-name" title="${escapeHtml(cls.resource_class)}">${escapeHtml(displayName)}</div>
          </div>
          <div class="class-card-count">
            <span class="class-card-active">${cls.active_count || 0} active</span> / ${cls.count} total
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    grid.innerHTML = '<div class="empty-state">Failed to load resource classes</div>';
  }
}

function filterByClass(resourceClass) {
  switchView('resources');
  document.getElementById('resourceSearch').value = '';
  loadResourcesByClass(resourceClass);
}

// ===== Resources =====
async function loadAllResources(page = 1) {
  const activeOnly = document.getElementById('activeOnlyFilter').checked;
  const tbody = document.querySelector('#resourcesTable tbody');
  tbody.innerHTML = '<tr><td colspan="12" class="loading"><span class="spinner"></span> Loading...</td></tr>';

  try {
    // Fetch all resources to enable client-side pagination
    const result = await apiGet(`/resources?active=${activeOnly}&limit=1000`);
    const allResources = result.data || [];

    resourcePagination.data = allResources;
    resourcePagination.total = allResources.length;
    resourcePagination.page = page;

    renderResourcesPage();
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty-state">Failed to load resources</td></tr>';
    hideResourcePagination();
  }
}

function renderResourcesPage() {
  const start = (resourcePagination.page - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageData = resourcePagination.data.slice(start, end);

  renderResourcesTable(pageData);
  updateResourcePagination();
}

function updateResourcePagination() {
  const totalPages = Math.ceil(resourcePagination.total / PAGE_SIZE);
  const paginationDiv = document.getElementById('resourcePagination');
  const pageInfo = document.getElementById('resourcePageInfo');
  const prevBtn = document.getElementById('resourcePrevBtn');
  const nextBtn = document.getElementById('resourceNextBtn');
  const resultCount = document.getElementById('resourceResultCount');

  if (resourcePagination.total <= PAGE_SIZE) {
    paginationDiv.style.display = 'none';
  } else {
    paginationDiv.style.display = 'flex';
    pageInfo.textContent = `Page ${resourcePagination.page} of ${totalPages}`;
    prevBtn.disabled = resourcePagination.page <= 1;
    nextBtn.disabled = resourcePagination.page >= totalPages;
  }

  resultCount.textContent = `${resourcePagination.total} resources`;
}

function hideResourcePagination() {
  document.getElementById('resourcePagination').style.display = 'none';
  document.getElementById('resourceResultCount').textContent = '';
}

function changeResourcePage(delta) {
  const totalPages = Math.ceil(resourcePagination.total / PAGE_SIZE);
  const newPage = resourcePagination.page + delta;

  if (newPage >= 1 && newPage <= totalPages) {
    resourcePagination.page = newPage;
    renderResourcesPage();
    // Scroll to top of table
    document.getElementById('resourcesTable').scrollIntoView({ behavior: 'smooth' });
  }
}

async function searchResources() {
  const query = document.getElementById('resourceSearch').value.trim();
  const activeOnly = document.getElementById('activeOnlyFilter').checked;
  const tbody = document.querySelector('#resourcesTable tbody');

  if (!query) {
    loadAllResources();
    return;
  }

  tbody.innerHTML = '<tr><td colspan="12" class="loading"><span class="spinner"></span> Searching...</td></tr>';

  try {
    const result = await apiGet(`/resources?search=${encodeURIComponent(query)}&active=${activeOnly}&limit=500`);
    const allResources = result.data || [];

    resourcePagination.data = allResources;
    resourcePagination.total = allResources.length;
    resourcePagination.page = 1;

    renderResourcesPage();
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty-state">Search failed</td></tr>';
    hideResourcePagination();
  }
}

async function loadResourcesByClass(resourceClass) {
  const activeOnly = document.getElementById('activeOnlyFilter').checked;
  const tbody = document.querySelector('#resourcesTable tbody');
  tbody.innerHTML = '<tr><td colspan="12" class="loading"><span class="spinner"></span> Loading...</td></tr>';

  try {
    const result = await apiGet(`/resources?class=${encodeURIComponent(resourceClass)}&active=${activeOnly}&limit=500`);
    const allResources = result.data || [];

    resourcePagination.data = allResources;
    resourcePagination.total = allResources.length;
    resourcePagination.page = 1;

    renderResourcesPage();
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty-state">Failed to load resources</td></tr>';
    hideResourcePagination();
  }
}

// ===== Advanced Stat Filters =====
let currentStatFilters = {};

function toggleAdvancedFilters() {
  const filtersDiv = document.getElementById('advancedFilters');
  filtersDiv.classList.toggle('hidden');
}

function clearAdvancedFilters() {
  currentStatFilters = {};
  document.querySelectorAll('.stat-filter-item select.stat-operator').forEach(sel => {
    sel.value = '';
  });
  document.querySelectorAll('.stat-filter-item input.stat-value').forEach(input => {
    input.value = '';
  });
  document.querySelectorAll('.stat-filter-item').forEach(item => {
    item.classList.remove('active');
  });
  document.getElementById('activeFiltersCount').textContent = '';
}

function getAdvancedFilters() {
  const filters = {};
  const stats = ['OQ', 'CD', 'DR', 'FL', 'HR', 'MA', 'PE', 'SR', 'UT'];

  stats.forEach(stat => {
    const operator = document.querySelector(`.stat-operator[data-stat="${stat}"]`)?.value;
    const value = document.querySelector(`.stat-value[data-stat="${stat}"]`)?.value;

    if (operator && value) {
      filters[stat] = { operator, value: parseInt(value, 10) };
      // Highlight active filter
      const item = document.querySelector(`.stat-filter-item:has([data-stat="${stat}"])`);
      if (item) item.classList.add('active');
    }
  });

  return filters;
}

function applyStatFilter(resource, filters) {
  for (const [stat, filter] of Object.entries(filters)) {
    const statValue = resource.stats?.[stat];
    if (statValue === undefined || statValue === null) continue;

    switch (filter.operator) {
      case '>':
        if (!(statValue > filter.value)) return false;
        break;
      case '>=':
        if (!(statValue >= filter.value)) return false;
        break;
      case '<':
        if (!(statValue < filter.value)) return false;
        break;
      case '<=':
        if (!(statValue <= filter.value)) return false;
        break;
      case '=':
        if (statValue !== filter.value) return false;
        break;
    }
  }
  return true;
}

async function applyAdvancedFilters() {
  const activeOnly = document.getElementById('activeOnlyFilter').checked;
  const tbody = document.querySelector('#resourcesTable tbody');

  // Clear active highlights first
  document.querySelectorAll('.stat-filter-item').forEach(item => {
    item.classList.remove('active');
  });

  currentStatFilters = getAdvancedFilters();
  const filterCount = Object.keys(currentStatFilters).length;

  if (filterCount === 0) {
    document.getElementById('activeFiltersCount').textContent = '';
    loadAllResources();
    return;
  }

  document.getElementById('activeFiltersCount').textContent = `${filterCount} filter${filterCount > 1 ? 's' : ''} active`;

  tbody.innerHTML = '<tr><td colspan="12" class="loading"><span class="spinner"></span> Filtering...</td></tr>';

  try {
    // Fetch more resources to filter client-side
    const result = await apiGet(`/resources?active=${activeOnly}&limit=1000`);
    let resources = result.data || [];

    // Apply client-side stat filters
    resources = resources.filter(resource => applyStatFilter(resource, currentStatFilters));

    resourcePagination.data = resources;
    resourcePagination.total = resources.length;
    resourcePagination.page = 1;

    renderResourcesPage();
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty-state">Failed to apply filters</td></tr>';
    hideResourcePagination();
  }
}

function renderResourcesTable(data) {
  const tbody = document.querySelector('#resourcesTable tbody');

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty-state">No resources found</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(resource => `
    <tr class="clickable-row" onclick="openResourceModal('${resource.id}')" title="Click to view details">
      <td><span class="resource-name">${escapeHtml(resource.name)}</span></td>
      <td>
        <span class="resource-class-cell">
          <img src="/images/${escapeHtml(resource.classIcon || 'default.png')}" alt="" class="resource-icon" onerror="this.src='/images/default.png'">
          <span class="slot-tag" title="${escapeHtml(resource.class)}">${escapeHtml(resource.className || resource.class)}</span>
        </span>
      </td>
      <td class="stat-cell ${getStatClass(resource.stats.OQ)}">${resource.stats.OQ || '-'}</td>
      <td class="stat-cell ${getStatClass(resource.stats.CD)}">${resource.stats.CD || '-'}</td>
      <td class="stat-cell ${getStatClass(resource.stats.DR)}">${resource.stats.DR || '-'}</td>
      <td class="stat-cell ${getStatClass(resource.stats.FL)}">${resource.stats.FL || '-'}</td>
      <td class="stat-cell ${getStatClass(resource.stats.HR)}">${resource.stats.HR || '-'}</td>
      <td class="stat-cell ${getStatClass(resource.stats.MA)}">${resource.stats.MA || '-'}</td>
      <td class="stat-cell ${getStatClass(resource.stats.PE)}">${resource.stats.PE || '-'}</td>
      <td class="stat-cell ${getStatClass(resource.stats.SR)}">${resource.stats.SR || '-'}</td>
      <td class="stat-cell ${getStatClass(resource.stats.UT)}">${resource.stats.UT || '-'}</td>
      <td>
        <span class="status-badge ${resource.isActive ? 'active' : 'inactive'}">
          ${resource.isActive ? 'Active' : 'Inactive'}
        </span>
      </td>
    </tr>
  `).join('');
}

// ===== Schematics =====
async function loadAllSchematics() {
  const grid = document.getElementById('schematicsGrid');
  grid.innerHTML = '<div class="loading"><span class="spinner"></span> Loading schematics...</div>';

  try {
    const [schematicsResult, categoriesResult] = await Promise.all([
      apiGet('/schematics?limit=100'),
      apiGet('/schematics/categories')
    ]);

    schematics = schematicsResult.data || [];
    categories = categoriesResult.data || [];

    // Populate category filter
    const categorySelect = document.getElementById('categoryFilter');
    categorySelect.innerHTML = '<option value="">All Categories</option>' +
      categories.map(cat => `<option value="${escapeHtml(cat.category)}">${escapeHtml(cat.category)} (${cat.count})</option>`).join('');

    renderSchematicsGrid(schematics);
  } catch (error) {
    grid.innerHTML = '<div class="empty-state">Failed to load schematics</div>';
  }
}

async function searchSchematics() {
  const query = document.getElementById('schematicSearch').value.trim();
  const grid = document.getElementById('schematicsGrid');

  if (!query) {
    renderSchematicsGrid(schematics);
    return;
  }

  grid.innerHTML = '<div class="loading"><span class="spinner"></span> Searching...</div>';

  try {
    const result = await apiGet(`/schematics?search=${encodeURIComponent(query)}`);
    renderSchematicsGrid(result.data || []);
  } catch (error) {
    grid.innerHTML = '<div class="empty-state">Search failed</div>';
  }
}

function filterSchematicsByCategory() {
  const category = document.getElementById('categoryFilter').value;

  if (!category) {
    renderSchematicsGrid(schematics);
  } else {
    const filtered = schematics.filter(s => s.category === category);
    renderSchematicsGrid(filtered);
  }
}

function renderSchematicsGrid(data) {
  const grid = document.getElementById('schematicsGrid');

  if (!data || data.length === 0) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">No schematics found</div></div>';
    return;
  }

  grid.innerHTML = data.map(schematic => `
    <div class="schematic-card" onclick="openSchematicModal('${escapeHtml(schematic.id)}')">
      <div class="schematic-card-header">
        <div class="schematic-card-name">${escapeHtml(schematic.name)}</div>
        <div class="schematic-card-category">${escapeHtml(schematic.category || 'Uncategorized')}</div>
      </div>
      <div class="schematic-card-complexity">Complexity: ${schematic.complexity || 0}</div>
      ${schematic.craftingStation ? `<div class="schematic-card-complexity">${escapeHtml(schematic.craftingStation)}</div>` : ''}
    </div>
  `).join('');
}

// ===== Admin Panel =====
async function loadAdminPanel() {
  if (!isAdmin) return;

  document.getElementById('adminLevelBadge').textContent = `${currentUser} (Level ${adminLevel})`;
  loadAdminStats();
  loadAdminConfig();
  loadAdminErrors();
  loadAdminLogs();
  loadColumnSettings();
  loadItemCategories();
  loadResourceTreeStats();
  loadTemplateNameStats();
  loadPathConfig();
  loadWaypointAdminStats();
}

async function loadAdminStats() {
  const container = document.getElementById('adminStats');
  container.innerHTML = '<div class="loading"><span class="spinner"></span> Loading...</div>';

  try {
    const result = await apiGet('/admin/stats');
    const data = result.data;

    container.innerHTML = `
      <div class="admin-stat-item">
        <div class="admin-stat-label">Resources</div>
        <div class="admin-stat-value">${data.tables?.resources?.toLocaleString() || 0}</div>
      </div>
      <div class="admin-stat-item">
        <div class="admin-stat-label">Schematics</div>
        <div class="admin-stat-value">${data.tables?.schematics?.toLocaleString() || 0}</div>
      </div>
      <div class="admin-stat-item">
        <div class="admin-stat-label">History</div>
        <div class="admin-stat-value">${data.tables?.resourceHistory?.toLocaleString() || 0}</div>
      </div>
      <div class="admin-stat-item">
        <div class="admin-stat-label">Poll Logs</div>
        <div class="admin-stat-value">${data.tables?.pollLog?.toLocaleString() || 0}</div>
      </div>
      <div class="admin-stat-item">
        <div class="admin-stat-label">DB Size</div>
        <div class="admin-stat-value">${data.database?.sizeFormatted || '-'}</div>
      </div>
      <div class="admin-stat-item">
        <div class="admin-stat-label">Uptime</div>
        <div class="admin-stat-value">${formatUptime(data.uptime)}</div>
      </div>
      <div class="admin-stat-item">
        <div class="admin-stat-label">Sessions</div>
        <div class="admin-stat-value">${data.sessions?.activeSessions || 0}</div>
      </div>
      <div class="admin-stat-item">
        <div class="admin-stat-label">Memory (Heap)</div>
        <div class="admin-stat-value">${formatBytes(data.memory?.heapUsed)}</div>
      </div>
    `;
  } catch (error) {
    container.innerHTML = '<div class="empty-state">Failed to load stats</div>';
  }
}

async function loadAdminConfig() {
  const container = document.getElementById('configDisplay');
  container.innerHTML = '<div class="loading"><span class="spinner"></span> Loading...</div>';

  try {
    const result = await apiGet('/admin/config');
    const config = result.data;

    container.innerHTML = `
      <div class="config-section">
        <div class="config-section-title">Oracle Database</div>
        <div class="config-item">
          <span class="config-key">User</span>
          <span class="config-value">${escapeHtml(config.oracle?.user)}</span>
        </div>
        <div class="config-item">
          <span class="config-key">Connection</span>
          <span class="config-value">${escapeHtml(config.oracle?.connectionString)}</span>
        </div>
        <div class="config-item">
          <span class="config-key">Pool</span>
          <span class="config-value">${config.oracle?.poolMin} - ${config.oracle?.poolMax}</span>
        </div>
      </div>
      
      <div class="config-section">
        <div class="config-section-title">Local Database</div>
        <div class="config-item">
          <span class="config-key">Path</span>
          <span class="config-value">${escapeHtml(config.localDb?.path)}</span>
        </div>
      </div>
      
      <div class="config-section">
        <div class="config-section-title">Polling</div>
        <div class="config-item">
          <span class="config-key">Interval</span>
          <span class="config-value">${config.polling?.intervalMinutes} minutes</span>
        </div>
      </div>
      
      <div class="config-section">
        <div class="config-section-title">API</div>
        <div class="config-item">
          <span class="config-key">Host</span>
          <span class="config-value">${escapeHtml(config.api?.host)}:${config.api?.port}</span>
        </div>
      </div>
      
      <div class="config-section">
        <div class="config-section-title">Alerts</div>
        <div class="config-item">
          <span class="config-key">Discord</span>
          <span class="config-value">${config.alerts?.enableDiscord ? 'Enabled' : 'Disabled'}</span>
        </div>
      </div>
    `;
  } catch (error) {
    container.innerHTML = '<div class="empty-state">Failed to load config</div>';
  }
}

async function loadAdminErrors() {
  const tbody = document.querySelector('#adminErrorsTable tbody');
  const badge = document.getElementById('errorSummaryBadge');
  const category = document.getElementById('errorCategoryFilter')?.value || 'all';

  tbody.innerHTML = '<tr><td colspan="5" class="loading"><span class="spinner"></span> Loading errors...</td></tr>';

  try {
    const result = await apiGet(`/admin/errors?category=${category}&limit=100`);
    const { errors, summary } = result.data;

    // Update badge
    if (summary.total > 0) {
      badge.className = 'error-badge has-errors';
      badge.textContent = `⚠️ ${summary.total} errors`;
    } else {
      badge.className = 'error-badge no-errors';
      badge.textContent = '✓ No errors';
    }

    if (!errors || errors.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No errors recorded</td></tr>';
      return;
    }

    tbody.innerHTML = errors.map(err => `
      <tr>
        <td style="white-space: nowrap;">${formatTimeAgo(new Date(err.timestamp))}</td>
        <td><span class="error-category-badge ${err.category}">${err.category}</span></td>
        <td class="error-file-path" title="${escapeHtml(err.file || '-')}">${escapeHtml(truncatePath(err.file))}</td>
        <td class="error-message" title="${escapeHtml(err.message)}">${escapeHtml(err.message)}</td>
        <td>
          <button class="btn btn-sm error-details-btn" onclick="showErrorDetail('${escapeHtml(err.id)}')">View</button>
        </td>
      </tr>
    `).join('');

    // Store errors for detail view
    window._adminErrors = errors;
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Failed to load errors</td></tr>';
  }
}

function truncatePath(filePath) {
  if (!filePath) return '-';
  // Get last 2 path segments
  const parts = filePath.replace(/\\/g, '/').split('/');
  if (parts.length <= 2) return filePath;
  return '.../' + parts.slice(-2).join('/');
}

function showErrorDetail(errorId) {
  const errors = window._adminErrors || [];
  const error = errors.find(e => e.id === errorId);

  if (!error) {
    showToast('Error not found', 'error');
    return;
  }

  const modal = document.getElementById('errorModal');
  const title = document.getElementById('errorModalTitle');
  const body = document.getElementById('errorModalBody');

  title.textContent = `Error: ${error.category}`;
  body.innerHTML = `
    <div class="error-detail-section">
      <h4>Timestamp</h4>
      <div class="error-detail-content">${new Date(error.timestamp).toLocaleString()}</div>
    </div>
    
    <div class="error-detail-section">
      <h4>Category</h4>
      <div class="error-detail-content"><span class="error-category-badge ${error.category}">${error.category}</span></div>
    </div>
    
    ${error.file ? `
    <div class="error-detail-section">
      <h4>File</h4>
      <div class="error-detail-content file-path">${escapeHtml(error.file)}</div>
    </div>
    ` : ''}
    
    <div class="error-detail-section">
      <h4>Error Message</h4>
      <div class="error-detail-content error-msg">${escapeHtml(error.message)}</div>
    </div>
    
    ${error.details ? `
    <div class="error-detail-section">
      <h4>Details / Stack Trace</h4>
      <div class="error-detail-content stack-trace">${escapeHtml(error.details)}</div>
    </div>
    ` : ''}
  `;

  modal.classList.add('open');
}

async function clearAdminErrors() {
  const category = document.getElementById('errorCategoryFilter')?.value || 'all';

  if (!confirm(`Clear all ${category === 'all' ? '' : category + ' '}errors?`)) return;

  try {
    await fetch(`${API_BASE}/admin/errors?category=${category}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    showToast('Errors cleared', 'success');
    loadAdminErrors();
  } catch (error) {
    showToast('Failed to clear errors: ' + error.message, 'error');
  }
}

async function loadAdminLogs() {
  const tbody = document.querySelector('#adminLogsTable tbody');
  tbody.innerHTML = '<tr><td colspan="8" class="loading"><span class="spinner"></span> Loading...</td></tr>';

  try {
    const result = await apiGet('/admin/logs?limit=20');
    const logs = result.data || [];

    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No logs found</td></tr>';
      return;
    }

    tbody.innerHTML = logs.map(log => `
      <tr>
        <td><span class="slot-tag">${escapeHtml(log.poll_type)}</span></td>
        <td><span class="status-badge ${log.status === 'success' ? 'active' : 'inactive'}">${log.status}</span></td>
        <td>${log.resources_processed || 0}</td>
        <td>${log.new_resources || 0}</td>
        <td>${log.updated_resources || 0}</td>
        <td>${log.despawned_resources || 0}</td>
        <td>${log.error_message ? `<span style="color: var(--danger)">${escapeHtml(log.error_message.substring(0, 50))}</span>` : '-'}</td>
        <td>${formatTimeAgo(new Date(log.completed_at))}</td>
      </tr>
    `).join('');
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Failed to load logs</td></tr>';
  }
}

// ===== Admin Actions =====
async function adminPollResources() {
  showToast('Polling resources...', 'info');
  try {
    const result = await apiPost('/admin/poll/resources', {});
    showToast(`Polled ${result.data?.processed || 0} resources (${result.data?.new || 0} new)`, 'success');
    loadAdminStats();
    loadAdminErrors();
    loadAdminLogs();
  } catch (error) {
    showToast('Failed to poll resources: ' + error.message, 'error');
  }
}

async function adminPollSchematics() {
  showToast('Syncing schematics...', 'info');
  try {
    const result = await apiPost('/admin/poll/schematics', {});
    showToast(`Synced schematics (${result.data?.added || 0} added, ${result.data?.errors || 0} errors)`, 'success');
    loadAdminStats();
    loadAdminErrors();
    loadAdminLogs();
  } catch (error) {
    showToast('Failed to sync schematics: ' + error.message, 'error');
  }
}

async function adminLoadItemStats() {
  showToast('Reloading item stats from disk...', 'info');
  try {
    const result = await apiPost('/items/load-stats', {});
    const data = result.data || {};
    showToast(`Loaded stats: ${data.itemStats || 0} item, ${data.armorStats || 0} armor, ${data.weaponStats || 0} weapon`, 'success');
    loadItemStats();
  } catch (error) {
    showToast('Failed to load item stats: ' + error.message, 'error');
  }
}

async function clearHistory() {
  if (!confirm('Are you sure you want to clear all history and logs?')) return;

  try {
    await apiPost('/admin/clear-history', {});
    showToast('History and logs cleared', 'success');
    loadAdminStats();
    loadAdminLogs();
  } catch (error) {
    showToast('Failed to clear history: ' + error.message, 'error');
  }
}

async function clearResources() {
  if (!confirm('Are you sure you want to clear ALL resources? This cannot be undone!')) return;

  try {
    await apiPost('/admin/clear-resources', {});
    showToast('All resources cleared', 'success');
    loadAdminStats();
  } catch (error) {
    showToast('Failed to clear resources: ' + error.message, 'error');
  }
}

async function adminSyncItems() {
  showToast('Syncing items from master_item...', 'info');
  try {
    const result = await apiPost('/admin/sync/items', {});
    showToast(`Synced ${result.data?.found || 0} items (${result.data?.added || 0} added, ${result.data?.errors || 0} errors)`, 'success');
    loadAdminStats();
    loadAdminErrors();
  } catch (error) {
    showToast('Failed to sync items: ' + error.message, 'error');
  }
}

function confirmNukeDatabase() {
  const modal = document.getElementById('confirmModal');
  document.getElementById('confirmModalTitle').textContent = '⚠️ Nuke Database';
  document.getElementById('confirmModalMessage').innerHTML = `
    <p style="margin-bottom: 16px;">This will <strong>permanently delete</strong> all data including:</p>
    <ul style="margin-left: 20px; margin-bottom: 16px;">
      <li>All resources and history</li>
      <li>All schematics</li>
      <li>All cached matches</li>
      <li>All logs</li>
    </ul>
    <p style="color: var(--danger);">This action cannot be undone!</p>
  `;

  const confirmBtn = document.getElementById('confirmModalAction');
  confirmBtn.textContent = '💥 Nuke Database';
  confirmBtn.onclick = nukeDatabase;

  modal.classList.add('open');
}

async function nukeDatabase() {
  closeModal('confirmModal');
  showToast('Nuking database...', 'warning');

  try {
    await apiPost('/admin/nuke-database', { confirm: 'NUKE' });
    showToast('Database nuked and recreated', 'success');
    loadAdminStats();
    loadAdminLogs();
  } catch (error) {
    showToast('Failed to nuke database: ' + error.message, 'error');
  }
}

// ===== Cartographer Admin =====
async function loadWaypointAdminStats() {
  const container = document.getElementById('waypointAdminStats');
  if (!container) return;

  try {
    const result = await apiGet('/waypoints/stats');
    if (result.success && result.data) {
      const stats = result.data;
      const bySource = {};
      for (const s of (stats.bySource || [])) {
        bySource[s.source] = s.count;
      }
      container.innerHTML = `
        <div>Total waypoints: <strong>${stats.total}</strong></div>
        <div>Server (canonical): <strong>${bySource.oracle || 0}</strong></div>
        <div>Local (user-created): <strong>${bySource.local || 0}</strong></div>
        <div>Planets: <strong>${(stats.byPlanet || []).length}</strong></div>
      `;
    }
  } catch (error) {
    container.textContent = 'Failed to load stats';
  }

  // Also load creation toggle state
  loadWaypointCreationStatus();
}

async function loadWaypointCreationStatus() {
  const statusEl = document.getElementById('waypointCreationStatus');
  const btn = document.getElementById('toggleWaypointCreationBtn');
  if (!statusEl) return;

  try {
    const result = await apiGet('/waypoints/settings/creation');
    if (result.success) {
      const enabled = result.data.enabled;
      statusEl.innerHTML = `Waypoint creation is currently <strong style="color: ${enabled ? 'var(--success, #4caf50)' : 'var(--danger, #f44336)'};">${enabled ? 'ENABLED' : 'DISABLED'}</strong>`;
      if (btn) {
        btn.textContent = enabled ? 'Disable Waypoint Creation' : 'Enable Waypoint Creation';
      }
    }
  } catch (error) {
    statusEl.textContent = 'Could not load creation status';
  }
}

async function adminImportWaypoints() {
  showToast('Importing waypoints from Oracle...', 'info');
  try {
    const result = await apiPost('/waypoints/sync', {});
    const data = result.data || {};
    showToast(`Imported: ${data.added || 0} new, ${data.updated || 0} updated, ${data.removed || 0} removed`, 'success');
    loadWaypointAdminStats();
  } catch (error) {
    showToast('Failed to import waypoints: ' + error.message, 'error');
  }
}

async function adminClearWaypoints() {
  if (!confirm('Clear all LOCAL (user-created) waypoints? Server waypoints will be preserved. This cannot be undone!')) return;

  try {
    const result = await apiPost('/waypoints/clear', { includeOracle: false });
    showToast(`Cleared ${result.data?.deleted || 0} local waypoints (server waypoints preserved)`, 'success');
    loadWaypointAdminStats();
    // Refresh map if loaded
    if (mapCurrentPlanet) loadMapWaypoints(mapCurrentPlanet);
  } catch (error) {
    showToast('Failed to clear waypoints: ' + error.message, 'error');
  }
}

async function adminPruneDuplicateWaypoints() {
  showToast('Pruning duplicate waypoints...', 'info');
  try {
    const result = await apiPost('/admin/waypoints/prune-duplicates', {});
    const data = result.data || {};
    showToast(result.message || `Pruned ${data.deleted || 0} duplicate(s) in ${data.groupsPruned || 0} location(s)`, 'success');
    loadWaypointAdminStats();
    if (mapCurrentPlanet) loadMapWaypoints(mapCurrentPlanet);
  } catch (error) {
    showToast('Failed to prune waypoints: ' + error.message, 'error');
  }
}

async function adminToggleWaypointCreation() {
  try {
    // Get current state and flip it
    const current = await apiGet('/waypoints/settings/creation');
    const newState = !(current.data?.enabled);

    await apiPost('/waypoints/settings/creation', { enabled: newState });
    showToast(`Waypoint creation ${newState ? 'enabled' : 'disabled'}`, 'success');
    loadWaypointCreationStatus();
  } catch (error) {
    showToast('Failed to toggle waypoint creation: ' + error.message, 'error');
  }
}

// ===== Resource Tree Admin =====
async function loadResourceTreeStats() {
  const container = document.getElementById('resourceTreeStats');
  container.innerHTML = '<div class="loading"><span class="spinner"></span> Loading...</div>';

  try {
    const result = await apiGet('/admin/resource-tree/stats');
    const stats = result.data || {};

    container.innerHTML = `
      <div class="admin-stat-item">
        <div class="admin-stat-label">Total Classes</div>
        <div class="admin-stat-value">${stats.totalClasses?.toLocaleString() || 0}</div>
      </div>
      <div class="admin-stat-item">
        <div class="admin-stat-label">Root Classes</div>
        <div class="admin-stat-value">${stats.rootClasses?.toLocaleString() || 0}</div>
      </div>
      <div class="admin-stat-item">
        <div class="admin-stat-label">Leaf Classes</div>
        <div class="admin-stat-value">${stats.leafClasses?.toLocaleString() || 0}</div>
      </div>
      <div class="admin-stat-item">
        <div class="admin-stat-label">Max Depth</div>
        <div class="admin-stat-value">${stats.maxDepth || 0}</div>
      </div>
    `;
  } catch (error) {
    container.innerHTML = '<div class="empty-state">Failed to load resource tree stats</div>';
  }
}

async function adminReloadResourceTree() {
  showToast('Reloading resource tree...', 'info');
  try {
    const result = await apiPost('/admin/resource-tree/reload', {});
    showToast(`Resource tree reloaded: ${result.data?.totalClasses || 0} classes`, 'success');
    loadResourceTreeStats();
  } catch (error) {
    showToast('Failed to reload resource tree: ' + error.message, 'error');
  }
}

async function adminSyncResourceTreeDb() {
  showToast('Syncing resource tree to database...', 'info');
  try {
    const result = await apiPost('/admin/resource-tree/sync-db', {});
    showToast(`Synced ${result.data?.inserted || 0} classes to database`, 'success');
  } catch (error) {
    showToast('Failed to sync resource tree: ' + error.message, 'error');
  }
}

async function testResourceClassInfo() {
  const input = document.getElementById('testResourceClass');
  const resultDiv = document.getElementById('resourceClassTestResult');
  const className = input.value.trim();

  if (!className) {
    showToast('Please enter a resource class name', 'warning');
    return;
  }

  resultDiv.style.display = 'block';
  resultDiv.innerHTML = '<div class="loading"><span class="spinner"></span> Testing...</div>';

  try {
    const result = await apiGet(`/admin/resource-tree/test/${encodeURIComponent(className)}`);
    const info = result.data || {};

    resultDiv.innerHTML = `
      <div class="config-section">
        <div class="config-item">
          <span class="config-key">Enum Name</span>
          <span class="config-value">${escapeHtml(info.enumName || '-')}</span>
        </div>
        <div class="config-item">
          <span class="config-key">Display Name</span>
          <span class="config-value">${escapeHtml(info.displayName || '-')}</span>
        </div>
        <div class="config-item">
          <span class="config-key">String Name</span>
          <span class="config-value">${escapeHtml(info.stringName || '-')}</span>
        </div>
        <div class="config-item">
          <span class="config-key">Icon</span>
          <span class="config-value">
            <img src="/images/${escapeHtml(info.icon || 'default.png')}" class="resource-icon" onerror="this.src='/images/default.png'">
            ${escapeHtml(info.icon || '-')}
          </span>
        </div>
        <div class="config-item">
          <span class="config-key">Parent</span>
          <span class="config-value">${escapeHtml(info.parent || 'none')}</span>
        </div>
        <div class="config-item">
          <span class="config-key">Depth</span>
          <span class="config-value">${info.depth || 0}</span>
        </div>
      </div>
    `;
  } catch (error) {
    resultDiv.innerHTML = `<div class="empty-state">Error: ${escapeHtml(error.message)}</div>`;
  }
}

// ===== Template Names Admin =====
async function loadTemplateNameStats() {
  const container = document.getElementById('templateNameStats');
  container.innerHTML = '<div class="loading"><span class="spinner"></span> Loading...</div>';

  try {
    const result = await apiGet('/admin/template-names/stats');
    const stats = result.data || {};

    container.innerHTML = `
      <div class="admin-stat-item">
        <div class="admin-stat-label">Total Cached</div>
        <div class="admin-stat-value">${stats.total?.toLocaleString() || 0}</div>
      </div>
      <div class="admin-stat-item">
        <div class="admin-stat-label">With Names</div>
        <div class="admin-stat-value">${stats.withNames?.toLocaleString() || 0}</div>
      </div>
      <div class="admin-stat-item">
        <div class="admin-stat-label">Without Names</div>
        <div class="admin-stat-value">${stats.withoutNames?.toLocaleString() || 0}</div>
      </div>
    `;
  } catch (error) {
    container.innerHTML = '<div class="empty-state">Failed to load template name stats</div>';
  }
}

async function adminCacheTemplateNames() {
  showToast('Caching template names...', 'info');
  try {
    const result = await apiPost('/admin/template-names/cache-all', {});
    const data = result.data || {};
    showToast(`Cached ${data.cached || 0} names (${data.skipped || 0} skipped, ${data.errors || 0} errors)`, 'success');
    loadTemplateNameStats();
  } catch (error) {
    showToast('Failed to cache template names: ' + error.message, 'error');
  }
}

// ===== Path Configuration Admin =====
async function loadPathConfig() {
  const container = document.getElementById('pathConfigDisplay');
  container.innerHTML = '<div class="loading"><span class="spinner"></span> Loading paths...</div>';

  try {
    const result = await apiGet('/admin/paths');
    const paths = result.data || {};

    let html = '';

    for (const [section, sectionPaths] of Object.entries(paths)) {
      html += `<div class="config-section">
        <div class="config-section-title">${escapeHtml(section.charAt(0).toUpperCase() + section.slice(1))}</div>`;

      for (const [name, info] of Object.entries(sectionPaths)) {
        const statusClass = info.exists ? 'path-exists' : 'path-missing';
        const statusIcon = info.exists ? '✓' : '✗';
        html += `
          <div class="config-item">
            <span class="config-key">${escapeHtml(name)}</span>
            <span class="config-value path-value ${statusClass}" title="${escapeHtml(info.path || 'Not configured')}">
              <span class="path-status">${statusIcon}</span>
              ${escapeHtml(truncatePathMiddle(info.path) || 'Not configured')}
            </span>
          </div>`;
      }

      html += '</div>';
    }

    container.innerHTML = html;
  } catch (error) {
    container.innerHTML = `<div class="empty-state">Failed to load paths: ${escapeHtml(error.message)}</div>`;
  }
}

function truncatePathMiddle(path, maxLen = 50) {
  if (!path) return null;
  if (path.length <= maxLen) return path;
  const half = Math.floor((maxLen - 3) / 2);
  return path.substring(0, half) + '...' + path.substring(path.length - half);
}

// ===== Status Poll Admin =====
async function adminPollStatus() {
  showToast('Polling server status...', 'info');
  try {
    const result = await apiPost('/status/poll', {});
    if (result.success) {
      const data = result.data || {};
      showToast(`Status polled: ${data.players_online ?? '-'} players online`, 'success');
    } else {
      showToast('Status poll returned no data', 'warning');
    }
  } catch (error) {
    showToast('Failed to poll status: ' + error.message, 'error');
  }
}

// ===== Quest Reload Admin =====
async function adminReloadQuests() {
  showToast('Reloading quests from files...', 'info');
  try {
    const result = await apiGet('/quests/reload');
    if (result.success) {
      showToast(result.message || 'Quests reloaded', 'success');
    } else {
      showToast('Quest reload returned an error', 'warning');
    }
  } catch (error) {
    showToast('Failed to reload quests: ' + error.message, 'error');
  }
}

// ===== STF Test Admin =====
async function adminTestStf() {
  const fileInput = document.getElementById('stfTestFile');
  const keyInput = document.getElementById('stfTestKey');
  const resultDiv = document.getElementById('stfTestResult');

  const file = (fileInput?.value || '').trim();
  const key = (keyInput?.value || '').trim();

  if (!file || !key) {
    showToast('Please enter both a file and key to test', 'warning');
    return;
  }

  resultDiv.style.display = 'block';
  resultDiv.innerHTML = '<div class="loading"><span class="spinner"></span> Resolving...</div>';

  try {
    const result = await apiGet(`/admin/test-stf?file=${encodeURIComponent(file)}&key=${encodeURIComponent(key)}`);
    const data = result.data || {};

    let sampleHtml = '';
    if (data.sampleEntries && data.sampleEntries.length > 0) {
      sampleHtml = `
        <div class="config-section" style="margin-top: 8px;">
          <div class="config-section-title">Sample Entries (first ${data.sampleEntries.length})</div>
          ${data.sampleEntries.slice(0, 10).map(e => `
            <div class="config-item">
              <span class="config-key">${escapeHtml(e.key)}</span>
              <span class="config-value">${escapeHtml(e.value || '(empty)')}</span>
            </div>
          `).join('')}
        </div>`;
    }

    resultDiv.innerHTML = `
      <div class="config-section">
        <div class="config-section-title">Resolution Result</div>
        <div class="config-item">
          <span class="config-key">Query</span>
          <span class="config-value">@${escapeHtml(file)}:${escapeHtml(key)}</span>
        </div>
        <div class="config-item">
          <span class="config-key">Resolved</span>
          <span class="config-value" style="color: var(--success); font-weight: 600;">${escapeHtml(data.resolvedValue || '(null)')}</span>
        </div>
        <div class="config-item">
          <span class="config-key">File Exists</span>
          <span class="config-value">${data.fileExists ? '✓ Yes' : '✗ No'}</span>
        </div>
        <div class="config-item">
          <span class="config-key">File Size</span>
          <span class="config-value">${data.fileSize ? formatBytes(data.fileSize) : '-'}</span>
        </div>
        <div class="config-item">
          <span class="config-key">Total Keys</span>
          <span class="config-value">${data.totalKeys ?? '-'}</span>
        </div>
      </div>
      ${sampleHtml}
    `;
  } catch (error) {
    resultDiv.innerHTML = `<div class="empty-state">Error: ${escapeHtml(error.message)}</div>`;
  }
}

// ===== Modals =====
async function openResourceModal(resourceId) {
  const modal = document.getElementById('resourceModal');
  const title = document.getElementById('resourceModalTitle');
  const body = document.getElementById('resourceModalBody');

  title.textContent = 'Loading...';
  body.innerHTML = '<div class="loading"><span class="spinner"></span> Loading resource details...</div>';
  modal.classList.add('open');

  try {
    const result = await apiGet(`/resources/${resourceId}`);
    const resource = result.data;

    title.textContent = resource.name;
    body.innerHTML = renderResourceDetail(resource);
  } catch (error) {
    body.innerHTML = '<div class="empty-state">Failed to load resource details</div>';
  }
}

function renderResourceDetail(resource) {
  const stats = resource.stats || {};
  const statNames = ['OQ', 'CD', 'DR', 'FL', 'HR', 'MA', 'PE', 'SR', 'UT', 'CR', 'ER'];
  const statColors = {
    OQ: 'var(--stat-oq)',
    CD: 'var(--stat-cd)',
    DR: 'var(--stat-dr)',
    FL: 'var(--stat-fl)',
    HR: 'var(--stat-hr)',
    MA: 'var(--stat-ma)',
    PE: 'var(--stat-pe)',
    SR: 'var(--stat-sr)',
    UT: 'var(--stat-ut)',
    CR: 'var(--stat-cr)',
    ER: 'var(--stat-er)'
  };

  return `
    <div class="resource-detail">
      <div class="resource-info">
        <div class="resource-info-item">
          <span class="resource-info-label">Resource Class</span>
          <span class="resource-info-value resource-class-cell">
            <img src="/images/${escapeHtml(resource.classIcon || 'default.png')}" alt="" class="resource-icon-lg" onerror="this.src='/images/default.png'">
            <span title="${escapeHtml(resource.class)}">${escapeHtml(resource.className || resource.class)}</span>
          </span>
        </div>
        <div class="resource-info-item">
          <span class="resource-info-label">Status</span>
          <span class="status-badge ${resource.isActive ? 'active' : 'inactive'}">
            ${resource.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>
        ${resource.planet ? `
        <div class="resource-info-item">
          <span class="resource-info-label">Planet</span>
          <span class="resource-info-value">${escapeHtml(resource.planet)}</span>
        </div>
        ` : ''}
        <div class="resource-info-item">
          <span class="resource-info-label">Resource ID</span>
          <span class="resource-info-value" style="font-family: 'JetBrains Mono', monospace; font-size: 0.85rem;">${resource.id}</span>
        </div>
      </div>
      
      <h3 style="margin-bottom: 12px;">Stats</h3>
      <div class="resource-stats-grid">
        ${statNames.map(stat => {
          const value = stats[stat] || 0;
          if (value === 0) return '';
          return `
            <div class="resource-stat-item">
              <div class="resource-stat-name">${stat}</div>
              <div class="resource-stat-value" style="color: ${statColors[stat]}">${value}</div>
              <div class="resource-stat-bar">
                <div class="resource-stat-bar-fill" style="width: ${value / 10}%; background: ${statColors[stat]}"></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      
      ${resource.usedInSchematics && resource.usedInSchematics.length > 0 ? `
        <h3 style="margin-top: 20px; margin-bottom: 12px;">Best For Schematics</h3>
        <div class="schematic-slots">
          ${resource.usedInSchematics.slice(0, 5).map(s => `
            <div class="slot-card" style="cursor: pointer;" onclick="closeModal('resourceModal'); openSchematicModal('${escapeHtml(s.schematicId)}')">
              <div class="slot-name">${escapeHtml(s.schematicName)}</div>
              <div class="slot-resource-class">Slot: ${escapeHtml(s.slotName || 'Slot ' + s.slotIndex)}</div>
              <div class="best-resource-score">Score: ${s.score}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

async function openSchematicModal(schematicId) {
  const modal = document.getElementById('schematicModal');
  const title = document.getElementById('schematicModalTitle');
  const body = document.getElementById('schematicModalBody');

  // Clear previous schematic's model viewer so we don't show stale model
  if (window.currentSchematicViewer) {
    try {
      window.currentSchematicViewer.dispose();
    } catch (e) {
      console.warn('[Schematic Modal] Dispose previous viewer:', e);
    }
    window.currentSchematicViewer = null;
  }

  title.textContent = 'Loading...';
  body.innerHTML = '<div class="loading"><span class="spinner"></span> Loading schematic details...</div>';
  modal.classList.add('open');

  try {
    const [schematicResult, bestResourcesResult] = await Promise.all([
      apiGet(`/schematics/${schematicId}`),
      apiGet(`/schematics/${schematicId}/best-resources`)
    ]);

    const schematic = schematicResult.data;
    const bestResources = bestResourcesResult.data;

    title.textContent = schematic.name;
    body.innerHTML = renderSchematicDetail(schematic, bestResources);

    // Initialize 3D model viewer if container exists and Three.js is loaded
    if (typeof SWGModelViewer !== 'undefined') {
      const viewerContainer = document.getElementById('schematicModelViewer');
      if (viewerContainer) {
        console.log('[Schematic Modal] Initializing 3D model viewer');
        window.currentSchematicViewer = new SWGModelViewer(viewerContainer, {
          width: 320,
          height: 320,
          autoRotate: true,
          loadTextures: true
        });
        window.currentSchematicViewer.loadSchematicModel(schematicId);
      }

      // Initialize mini model viewers for template ingredient slots
      initializeSlotModelViewers();
    }
  } catch (error) {
    body.innerHTML = '<div class="empty-state">Failed to load schematic details</div>';
  }
}

function renderSchematicDetail(schematic, bestResources) {
  const slots = bestResources?.slots || schematic.slots || [];

  return `
    <div class="schematic-detail">
      <div class="schematic-detail-header">
        <div class="schematic-info-column">
          ${schematic.description ? `
          <div class="schematic-description">
            <p>${escapeHtml(schematic.description)}</p>
          </div>
          ` : ''}
          <div class="resource-info">
            <div class="resource-info-item">
              <span class="resource-info-label">Category</span>
              <span class="resource-info-value">${escapeHtml(schematic.category || 'Uncategorized')}</span>
            </div>
            <div class="resource-info-item">
              <span class="resource-info-label">Complexity</span>
              <span class="resource-info-value">${schematic.complexity || 0}</span>
            </div>
            ${schematic.craftingStation ? `
            <div class="resource-info-item">
              <span class="resource-info-label">Crafting Station</span>
              <span class="resource-info-value">${escapeHtml(schematic.craftingStation)}</span>
            </div>
            ` : ''}
            ${bestResources?.overallScore ? `
            <div class="resource-info-item">
              <span class="resource-info-label">Overall Score</span>
              <span class="resource-info-value" style="color: var(--success); font-size: 1.25rem;">${bestResources.overallScore}</span>
            </div>
            ` : ''}
          </div>
        </div>
        <div class="schematic-model-column">
          <div id="schematicModelViewer" class="model-viewer-container">
            <div class="model-loading">Loading 3D model...</div>
          </div>
        </div>
      </div>
      
      <section class="schematic-slots-section" aria-label="Ingredient slots">
        <h3 class="schematic-slots-title">Ingredient Slots</h3>
        <div class="schematic-slots">
          ${slots.map(slot => renderSlotCard(slot)).join('')}
        </div>
      </section>
    </div>
  `;
}

function renderSlotCard(slot) {
  const weights = slot.weights || {};
  const weightEntries = Object.entries(weights).filter(([_, w]) => w > 0);
  const resourceClass = slot.resourceClass || slot.resource_class;
  const resourceClassName = slot.resourceClassName || resourceClass;
  const resourceClassIcon = slot.resourceClassIcon || 'default.png';
  const isTemplateSlot = slot.isTemplateSlot || false;
  const templatePath = slot.templatePath;

  // Generate unique ID for this slot's model viewer
  const slotViewerId = `slot-model-${slot.index || slot.slotIndex || Math.random().toString(36).substr(2, 9)}`;

  const hasBest = !!(slot.bestActive || slot.bestHistorical);
  return `
    <article class="slot-card ${hasBest ? 'slot-card-has-best' : ''}">
      <div class="slot-card-main">
        <header class="slot-header">
          <span class="slot-name">${escapeHtml(slot.slotName || slot.name || 'Slot ' + (slot.slotIndex + 1))}</span>
          <span class="slot-quantity">×${slot.quantity || 1}</span>
        </header>
        ${isTemplateSlot && templatePath ? `
          <div class="slot-ingredient-model">
            <div id="${slotViewerId}" class="slot-model-viewer" data-template="${escapeHtml(templatePath)}">
              <div class="model-loading-mini">Loading...</div>
            </div>
          </div>
        ` : ''}
        <div class="slot-resource-class">
          <span class="resource-class-cell">
            <img src="/images/${escapeHtml(resourceClassIcon)}" alt="" class="resource-icon" onerror="this.src='/images/default.png'">
            <strong title="${escapeHtml(resourceClass)}">${escapeHtml(resourceClassName)}</strong>
          </span>
          ${isTemplateSlot ? '<span class="slot-type-badge">Component</span>' : ''}
        </div>
        ${weightEntries.length > 0 ? `
          <div class="slot-weights">
            ${weightEntries.map(([stat, weight]) => `
              <span class="weight-tag">${stat}: ${(weight * 100).toFixed(0)}%</span>
            `).join('')}
          </div>
        ` : ''}
      </div>
      ${slot.bestActive || slot.bestHistorical ? `
        <aside class="slot-best-resources">
          <span class="slot-best-heading">Best fit</span>
          ${slot.bestActive?.resourceId ? `
            <div class="best-resource">
              <span class="best-resource-label">Active</span>
              <span class="best-resource-name" onclick="closeModal('schematicModal'); openResourceModal('${slot.bestActive.resourceId}')">${escapeHtml(slot.bestActive.resourceName || slot.bestActive.resourceId)}</span>
              <span class="best-resource-score">${slot.bestActive.score}</span>
            </div>
          ` : '<div class="best-resource"><span class="best-resource-inactive">No active resources</span></div>'}
          ${slot.bestHistorical?.resourceId && slot.bestHistorical.resourceId !== slot.bestActive?.resourceId ? `
            <div class="best-resource">
              <span class="best-resource-label">Historical ${!slot.bestHistorical.isActive ? '(inactive)' : ''}</span>
              <span class="best-resource-name ${!slot.bestHistorical.isActive ? 'best-resource-inactive' : ''}" onclick="closeModal('schematicModal'); openResourceModal('${slot.bestHistorical.resourceId}')">${escapeHtml(slot.bestHistorical.resourceName || slot.bestHistorical.resourceId)}</span>
              <span class="best-resource-score ${!slot.bestHistorical.isActive ? 'best-resource-inactive' : ''}">${slot.bestHistorical.score}</span>
            </div>
          ` : ''}
        </aside>
      ` : ''}
    </article>
  `;
}

// Store slot model viewers for cleanup
window.slotModelViewers = window.slotModelViewers || [];

/**
 * Initialize mini 3D model viewers for template ingredient slots
 */
function initializeSlotModelViewers() {
  // Clean up existing slot viewers
  for (const viewer of window.slotModelViewers) {
    try {
      viewer.dispose();
    } catch (e) {
      // Ignore disposal errors
    }
  }
  window.slotModelViewers = [];

  // Find all slot model viewer containers
  const slotViewers = document.querySelectorAll('.slot-model-viewer[data-template]');

  for (const container of slotViewers) {
    const templatePath = container.dataset.template;
    if (!templatePath) continue;

    console.log('[Slot Model] Initializing viewer for template:', templatePath);

    try {
      const viewer = new SWGModelViewer(container, {
        width: container.offsetWidth || 100,
        height: 80,
        autoRotate: true,
        loadTextures: true,
        backgroundColor: 0x16213e
      });

      // Load the template model
      viewer.loadTemplateModel(templatePath).then(() => console.log('[Slot Model] Loaded template model:', templatePath)).catch(err => {
        console.warn('[Slot Model] Failed to load template model:', templatePath, err);
        container.innerHTML = '<div class="model-loading-mini">Model unavailable</div>';
      });

      window.slotModelViewers.push(viewer);
    } catch (error) {
      console.warn('[Slot Model] Failed to create viewer:', error);
      container.innerHTML = '<div class="model-loading-mini">Model unavailable</div>';
    }
  }
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('open');
}

// Close modal on escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal.open').forEach(modal => {
      modal.classList.remove('open');
    });
  }
});

// ===== Toast Notifications =====
function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ===== Utility Functions =====
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getStatClass(value) {
  if (!value || value === 0) return 'low';
  if (value >= 900) return 'high';
  if (value >= 600) return 'medium';
  return 'low';
}

function formatTimeAgo(date) {
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);

  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatUptime(seconds) {
  if (!seconds) return '-';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  return `${hours}h ${minutes}m`;
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '-';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatBytes(bytes) {
  if (!bytes) return '-';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ===== Item Lookup =====
let itemsCurrentPage = 0;
let itemsPageSize = 50;
let itemsTotalCount = 0;
let itemsCurrentFilters = {};

async function loadItemsView() {
  loadItemStats();
  loadItemCategories();
}

async function loadItemStats() {
  try {
    const result = await apiGet('/items/stats');
    const stats = result.data;

    document.getElementById('totalItems').textContent = stats.total?.toLocaleString() || '0';
    document.getElementById('weaponCount').textContent = stats.byType?.WEAPON?.toLocaleString() || '0';
    document.getElementById('armorCount').textContent = stats.byType?.ARMOR?.toLocaleString() || '0';
    document.getElementById('itemCount').textContent = stats.byType?.ITEM?.toLocaleString() || '0';
  } catch (error) {
    console.error('Failed to load item stats', error);
  }
}

async function loadItemCategories() {
  try {
    const result = await apiGet('/items/categories');
    const categories = result.data || [];

    // Populate visibility dropdown in admin
    const visibilitySelect = document.getElementById('itemVisibilityCategory');
    if (visibilitySelect) {
      visibilitySelect.innerHTML = '<option value="">Select category...</option>' +
        categories.map(c => `<option value="${escapeHtml(c.category)}">${escapeHtml(c.category)} (${c.count})</option>`).join('');
    }
  } catch (error) {
    console.error('Failed to load item categories', error);
  }
}

async function searchItemsUI() {
  const query = document.getElementById('itemSearch').value.trim();

  if (!query || query.length < 2) {
    showToast('Enter at least 2 characters to search', 'warning');
    return;
  }

  const tbody = document.querySelector('#itemsTable tbody');
  tbody.innerHTML = '<tr><td colspan="8" class="loading"><span class="spinner"></span> Searching...</td></tr>';

  try {
    const result = await apiGet(`/items/search?q=${encodeURIComponent(query)}&limit=100`);
    renderItemsTable(result.data || []);
    document.getElementById('itemResultCount').textContent = `${result.count || 0} results`;
    hidePagination();
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Search failed</td></tr>';
  }
}

async function filterItemsByType() {
  const type = document.getElementById('itemTypeFilter').value;
  itemsCurrentFilters.type = type;
  itemsCurrentPage = 0;
  loadItemsFiltered();
}

async function sortItemsUI() {
  const sortBy = document.getElementById('itemSortBy').value;
  itemsCurrentFilters.sortBy = sortBy;
  itemsCurrentFilters.sortOrder = 'DESC';
  loadItemsFiltered();
}

async function loadItemsFiltered() {
  const tbody = document.querySelector('#itemsTable tbody');
  tbody.innerHTML = '<tr><td colspan="8" class="loading"><span class="spinner"></span> Loading...</td></tr>';

  try {
    const params = new URLSearchParams({
      limit: itemsPageSize,
      offset: itemsCurrentPage * itemsPageSize,
      ...itemsCurrentFilters,
    });

    const result = await apiGet(`/items?${params}`);
    itemsTotalCount = result.pagination?.total || 0;

    renderItemsTable(result.data || []);
    document.getElementById('itemResultCount').textContent = `${itemsTotalCount} items`;
    updatePagination();
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Failed to load items</td></tr>';
  }
}

async function loadAllItems() {
  itemsCurrentFilters = {};
  itemsCurrentPage = 0;
  document.getElementById('itemSearch').value = '';
  document.getElementById('itemTypeFilter').value = '';
  loadItemsFiltered();
}

async function loadItemsByType(itemType) {
  itemsCurrentFilters = { type: itemType };
  itemsCurrentPage = 0;
  document.getElementById('itemTypeFilter').value = itemType;
  loadItemsFiltered();
}

function loadItemsPage(direction) {
  const newPage = itemsCurrentPage + direction;
  const maxPage = Math.ceil(itemsTotalCount / itemsPageSize) - 1;

  if (newPage >= 0 && newPage <= maxPage) {
    itemsCurrentPage = newPage;
    loadItemsFiltered();
  }
}

function updatePagination() {
  const pagination = document.getElementById('itemPagination');
  const pageInfo = document.getElementById('itemPageInfo');
  const prevBtn = document.getElementById('itemPrevBtn');
  const nextBtn = document.getElementById('itemNextBtn');

  const maxPage = Math.ceil(itemsTotalCount / itemsPageSize) - 1;

  if (itemsTotalCount > itemsPageSize) {
    pagination.style.display = 'flex';
    pageInfo.textContent = `Page ${itemsCurrentPage + 1} of ${maxPage + 1}`;
    prevBtn.disabled = itemsCurrentPage <= 0;
    nextBtn.disabled = itemsCurrentPage >= maxPage;
  } else {
    pagination.style.display = 'none';
  }
}

function hidePagination() {
  document.getElementById('itemPagination').style.display = 'none';
}

function renderItemsTable(items) {
  const tbody = document.querySelector('#itemsTable tbody');

  if (!items || items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No items found</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(item => {
    // Truncate template name for display
    const templateShort = item.templateName ?
      (item.templateName.length > 30 ? '...' + item.templateName.slice(-27) : item.templateName) : '-';

    // Use displayName (string_name) if available, otherwise fall back to name
    const displayName = item.displayName || item.name || 'Unknown';

    // Truncate description for tooltip
    const descTooltip = item.description ? item.description.substring(0, 100) : '';

    return `
      <tr>
        <td>
          <strong>${escapeHtml(displayName)}</strong>
          ${item.description ? `<div style="font-size: 0.75rem; color: var(--text-muted); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(descTooltip)}">${escapeHtml(item.description.substring(0, 50))}${item.description.length > 50 ? '...' : ''}</div>` : ''}
        </td>
        <td title="${escapeHtml(item.templateName || '')}" style="font-family: monospace; font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(templateShort)}</td>
        <td><span class="slot-tag">${escapeHtml(item.category || '-')}</span></td>
        <td><span class="item-type-badge ${(item.itemType || '').toLowerCase()}">${item.typeLabel || item.itemType || '-'}</span></td>
        <td class="stat-cell">${item.tier || '-'}</td>
        <td class="stat-cell">${item.requiredLevel || '-'}</td>
        <td class="stat-cell">${item.value ? item.value.toLocaleString() : '-'}</td>
        <td>
          <button class="btn btn-sm btn-icon" onclick="openItemModal(${item.id})" title="View Details">🔍</button>
        </td>
      </tr>
    `;
  }).join('');
}

async function openItemModal(itemId) {
  const modal = document.getElementById('itemModal');
  const title = document.getElementById('itemModalTitle');
  const body = document.getElementById('itemModalBody');

  title.textContent = 'Loading...';
  body.innerHTML = '<div class="loading"><span class="spinner"></span> Loading item details...</div>';
  modal.classList.add('open');

  try {
    const result = await apiGet(`/items/${itemId}`);
    const item = result.data;

    // Use displayName for modal title
    title.textContent = item.displayName || item.name || 'Unknown Item';
    body.innerHTML = renderItemDetail(item);
  } catch (error) {
    body.innerHTML = '<div class="empty-state">Failed to load item details</div>';
  }
}

function renderItemDetail(item) {
  const typeClass = (item.itemType || '').toLowerCase();
  const hasWeaponStats = item.weaponStats && (item.weaponStats.minDamage || item.weaponStats.maxDamage);
  const hasArmorStats = item.armorStats && (item.armorStats.protection || item.armorStats.hitPoints);
  const hasItemStats = item.itemStats && (item.itemStats.skillMods?.length || item.itemStats.buffName);

  let html = `
    <div class="item-detail">
      ${item.description ? `
      <div style="margin-bottom: 16px; padding: 12px; background: var(--bg-primary); border-radius: 8px; border-left: 3px solid var(--accent-primary);">
        <p style="color: var(--text-secondary); margin: 0; font-style: italic;">${escapeHtml(item.description)}</p>
      </div>
      ` : ''}
      <div class="resource-info">
        <div class="resource-info-item">
          <span class="resource-info-label">Type</span>
          <span class="item-type-badge ${typeClass}">${item.typeLabel || item.itemType || 'Unknown'}</span>
        </div>
        <div class="resource-info-item">
          <span class="resource-info-label">Category</span>
          <span class="resource-info-value">${escapeHtml(item.category || '-')}</span>
        </div>
        ${item.type ? `
        <div class="resource-info-item">
          <span class="resource-info-label">Type Enum</span>
          <span class="resource-info-value">${escapeHtml(item.type)}</span>
        </div>
        ` : ''}
        ${item.tier ? `
        <div class="resource-info-item">
          <span class="resource-info-label">Tier</span>
          <span class="resource-info-value">${item.tier}</span>
        </div>
        ` : ''}
        ${item.requiredLevel ? `
        <div class="resource-info-item">
          <span class="resource-info-label">Required Level</span>
          <span class="resource-info-value">${item.requiredLevel}</span>
        </div>
        ` : ''}
        ${item.unique ? `
        <div class="resource-info-item">
          <span class="resource-info-label">Unique</span>
          <span class="status-badge active">Yes</span>
        </div>
        ` : ''}
        ${item.hasDetailedStats ? `
        <div class="resource-info-item">
          <span class="resource-info-label">Stats Data</span>
          <span class="status-badge active">✓ Found</span>
        </div>
        ` : ''}
      </div>
  `;

  // ===== WEAPON STATS =====
  if (hasWeaponStats) {
    const ws = item.weaponStats;
    html += `
      <div class="item-stats-section">
        <h3>⚔️ Weapon Stats</h3>
        <div class="item-stats-row">
          ${ws.minDamage || ws.maxDamage ? `
          <div class="item-stat">
            <div class="item-stat-label">Damage</div>
            <div class="item-stat-value damage">${ws.minDamage || 0} - ${ws.maxDamage || 0}</div>
          </div>
          ` : ''}
          ${ws.attackSpeed ? `
          <div class="item-stat">
            <div class="item-stat-label">Attack Speed</div>
            <div class="item-stat-value speed">${ws.attackSpeed.toFixed(2)}s</div>
          </div>
          ` : ''}
          ${ws.actualDps || ws.calculatedDps ? `
          <div class="item-stat">
            <div class="item-stat-label">DPS</div>
            <div class="item-stat-value dps">${(ws.actualDps || ws.calculatedDps || 0).toFixed(1)}</div>
          </div>
          ` : ''}
          ${ws.accuracy ? `
          <div class="item-stat">
            <div class="item-stat-label">Accuracy</div>
            <div class="item-stat-value">${ws.accuracy}</div>
          </div>
          ` : ''}
          ${ws.damageType ? `
          <div class="item-stat">
            <div class="item-stat-label">Damage Type</div>
            <div class="item-stat-value">${escapeHtml(ws.damageType)}</div>
          </div>
          ` : ''}
          ${ws.woundChance ? `
          <div class="item-stat">
            <div class="item-stat-label">Wound Chance</div>
            <div class="item-stat-value">${(ws.woundChance * 100).toFixed(1)}%</div>
          </div>
          ` : ''}
          ${ws.hitPoints ? `
          <div class="item-stat">
            <div class="item-stat-label">Hit Points</div>
            <div class="item-stat-value">${ws.hitPoints}</div>
          </div>
          ` : ''}
          ${ws.specialAttackCost ? `
          <div class="item-stat">
            <div class="item-stat-label">Special Cost</div>
            <div class="item-stat-value">${ws.specialAttackCost}</div>
          </div>
          ` : ''}
        </div>
        ${ws.elementalType && ws.elementalType !== 'none' ? `
        <div class="item-stats-row" style="margin-top: 12px;">
          <div class="item-stat">
            <div class="item-stat-label">Elemental Type</div>
            <div class="item-stat-value">${escapeHtml(ws.elementalType)}</div>
          </div>
          <div class="item-stat">
            <div class="item-stat-label">Elemental Damage</div>
            <div class="item-stat-value damage">${ws.elementalDamage || 0}</div>
          </div>
        </div>
        ` : ''}
        ${ws.minRangeDistance || ws.maxRangeDistance ? `
        <div class="item-stats-row" style="margin-top: 12px;">
          <div class="item-stat">
            <div class="item-stat-label">Range</div>
            <div class="item-stat-value">${ws.minRangeDistance || 0}m - ${ws.maxRangeDistance || 0}m</div>
          </div>
        </div>
        ` : ''}
        ${ws.skillMods && ws.skillMods.length > 0 ? `
        <div style="margin-top: 12px;">
          <h4 style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 8px;">Skill Modifiers</h4>
          <div class="config-display">
            ${ws.skillMods.map(mod => `
              <div class="config-item">
                <span class="config-key">${escapeHtml(mod.skill)}</span>
                <span class="config-value" style="color: ${mod.value >= 0 ? 'var(--success)' : 'var(--danger)'}">
                  ${mod.value >= 0 ? '+' : ''}${mod.value}
                </span>
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}
        ${ws.procEffect ? `
        <div style="margin-top: 12px;">
          <h4 style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 8px;">Proc Effect</h4>
          <code style="font-size: 0.75rem; color: var(--accent-secondary);">${escapeHtml(ws.procEffect)}</code>
        </div>
        ` : ''}
      </div>
    `;
  }

  // ===== ARMOR STATS =====
  if (hasArmorStats) {
    const as = item.armorStats;
    html += `
      <div class="item-stats-section">
        <h3>🛡️ Armor Stats</h3>
        <div class="item-stats-row">
          ${as.armorLevel ? `
          <div class="item-stat">
            <div class="item-stat-label">Armor Level</div>
            <div class="item-stat-value">${escapeHtml(as.armorLevel)}</div>
          </div>
          ` : ''}
          ${as.armorCategory ? `
          <div class="item-stat">
            <div class="item-stat-label">Category</div>
            <div class="item-stat-value">${escapeHtml(as.armorCategory)}</div>
          </div>
          ` : ''}
          ${as.protection ? `
          <div class="item-stat">
            <div class="item-stat-label">Protection</div>
            <div class="item-stat-value armor">${(as.protection * 100).toFixed(0)}%</div>
          </div>
          ` : ''}
          ${as.hitPoints ? `
          <div class="item-stat">
            <div class="item-stat-label">Hit Points</div>
            <div class="item-stat-value">${as.hitPoints}</div>
          </div>
          ` : ''}
          ${as.sockets ? `
          <div class="item-stat">
            <div class="item-stat-label">Sockets</div>
            <div class="item-stat-value">${as.sockets}</div>
          </div>
          ` : ''}
          ${as.conditionMultiplier && as.conditionMultiplier !== 1 ? `
          <div class="item-stat">
            <div class="item-stat-label">Condition Multi</div>
            <div class="item-stat-value">${as.conditionMultiplier.toFixed(2)}x</div>
          </div>
          ` : ''}
        </div>
        ${as.skillMods && as.skillMods.length > 0 ? `
        <div style="margin-top: 12px;">
          <h4 style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 8px;">Skill Modifiers</h4>
          <div class="config-display">
            ${as.skillMods.map(mod => `
              <div class="config-item">
                <span class="config-key">${escapeHtml(mod.skill)}</span>
                <span class="config-value" style="color: ${mod.value >= 0 ? 'var(--success)' : 'var(--danger)'}">
                  ${mod.value >= 0 ? '+' : ''}${mod.value}
                </span>
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}
        ${as.buffName ? `
        <div style="margin-top: 12px;">
          <h4 style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 8px;">Buff</h4>
          <span class="slot-tag">${escapeHtml(as.buffName)}</span>
          ${as.requiredLevelForEffect ? `<span style="color: var(--text-muted); margin-left: 8px;">(Req. Level ${as.requiredLevelForEffect})</span>` : ''}
        </div>
        ` : ''}
        ${as.reactiveEffect ? `
        <div style="margin-top: 12px;">
          <h4 style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 8px;">Reactive Effect</h4>
          <code style="font-size: 0.75rem; color: var(--accent-secondary);">${escapeHtml(as.reactiveEffect)}</code>
        </div>
        ` : ''}
      </div>
    `;
  }

  // ===== ITEM STATS (Consumables, Buffs, etc.) =====
  if (hasItemStats) {
    const is = item.itemStats;
    html += `
      <div class="item-stats-section">
        <h3>✨ Item Effects</h3>
        ${is.buffName ? `
        <div class="item-stats-row">
          <div class="item-stat" style="flex: 2;">
            <div class="item-stat-label">Buff</div>
            <div class="item-stat-value">${escapeHtml(is.buffName)}</div>
          </div>
          ${is.reuseTime ? `
          <div class="item-stat">
            <div class="item-stat-label">Reuse Time</div>
            <div class="item-stat-value">${formatDuration(is.reuseTime)}</div>
          </div>
          ` : ''}
          ${is.coolDownGroup ? `
          <div class="item-stat">
            <div class="item-stat-label">Cooldown Group</div>
            <div class="item-stat-value">${escapeHtml(is.coolDownGroup)}</div>
          </div>
          ` : ''}
        </div>
        ` : ''}
        ${is.requiredLevelForEffect ? `
        <div class="item-stats-row" style="margin-top: 8px;">
          <div class="item-stat">
            <div class="item-stat-label">Required Level for Effect</div>
            <div class="item-stat-value">${is.requiredLevelForEffect}</div>
          </div>
        </div>
        ` : ''}
        ${is.skillMods && is.skillMods.length > 0 ? `
        <div style="margin-top: 12px;">
          <h4 style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 8px;">Skill Modifiers</h4>
          <div class="config-display">
            ${is.skillMods.map(mod => `
              <div class="config-item">
                <span class="config-key">${escapeHtml(mod.skill)}</span>
                <span class="config-value" style="color: ${mod.value >= 0 ? 'var(--success)' : 'var(--danger)'}">
                  ${mod.value >= 0 ? '+' : ''}${mod.value}
                </span>
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}
        ${is.attributeBonus ? `
        <div style="margin-top: 12px;">
          <h4 style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 8px;">Attribute Bonus</h4>
          <code style="font-size: 0.75rem; color: var(--success);">${escapeHtml(is.attributeBonus)}</code>
        </div>
        ` : ''}
        ${is.clientEffect ? `
        <div style="margin-top: 12px;">
          <h4 style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 8px;">Visual Effect</h4>
          <code style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(is.clientEffect)}</code>
        </div>
        ` : ''}
      </div>
    `;
  }

  // Core Stats Section (from master_item)
  const coreStats = [];
  if (item.value) coreStats.push({ label: 'Value', value: `${item.value.toLocaleString()} credits` });
  if (item.charges) coreStats.push({ label: 'Charges', value: item.charges });
  if (item.version) coreStats.push({ label: 'Version', value: item.version });
  if (item.canReverseEngineer) coreStats.push({ label: 'Reverse Engineer', value: 'Yes' });

  if (coreStats.length > 0) {
    html += `
      <div class="item-stats-section">
        <h3>📊 General Stats</h3>
        <div class="item-stats-row">
          ${coreStats.map(stat => `
            <div class="item-stat">
              <div class="item-stat-label">${stat.label}</div>
              <div class="item-stat-value">${stat.value}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Requirements
  if (item.requiredSkill) {
    html += `
      <div class="item-stats-section">
        <h3>📋 Requirements</h3>
        <div class="config-display">
          <div class="config-item">
            <span class="config-key">Required Skill</span>
            <span class="config-value">${escapeHtml(item.requiredSkill)}</span>
          </div>
        </div>
      </div>
    `;
  }

  // Scripts
  if (item.scripts) {
    html += `
      <div class="item-stats-section">
        <h3>📜 Scripts</h3>
        <code style="font-size: 0.75rem; color: var(--text-muted); word-break: break-all; display: block; padding: 8px; background: var(--bg-primary); border-radius: 4px;">${escapeHtml(item.scripts)}</code>
      </div>
    `;
  }

  // Creation Objvars
  if (item.creationObjvars) {
    html += `
      <div class="item-stats-section">
        <h3>⚙️ Creation Objvars</h3>
        <code style="font-size: 0.75rem; color: var(--text-muted); word-break: break-all; display: block; padding: 8px; background: var(--bg-primary); border-radius: 4px; max-height: 150px; overflow-y: auto;">${escapeHtml(item.creationObjvars)}</code>
      </div>
    `;
  }

  // String References
  if (item.stringName || item.stringDetail) {
    html += `
      <div class="item-stats-section">
        <h3>📝 String References</h3>
        <div class="config-display">
          ${item.stringName ? `
          <div class="config-item">
            <span class="config-key">String Name</span>
            <span class="config-value">${escapeHtml(item.stringName)}</span>
          </div>
          ` : ''}
          ${item.stringDetail ? `
          <div class="config-item">
            <span class="config-key">String Detail</span>
            <span class="config-value">${escapeHtml(item.stringDetail)}</span>
          </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  // Additional Data (raw_data JSON)
  if (item.additionalData && Object.keys(item.additionalData).length > 0) {
    html += `
      <div class="item-stats-section">
        <h3>📋 Additional Properties</h3>
        <div class="config-display">
          ${Object.entries(item.additionalData).map(([key, value]) => `
            <div class="config-item">
              <span class="config-key">${escapeHtml(key)}</span>
              <span class="config-value">${escapeHtml(String(value))}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Comments
  if (item.comments) {
    html += `
      <div class="item-stats-section">
        <h3>💬 Comments</h3>
        <p style="color: var(--text-secondary);">${escapeHtml(item.comments)}</p>
      </div>
    `;
  }

  // Template path
  if (item.templateName) {
    html += `
      <div class="item-stats-section">
        <h3>📁 Template</h3>
        <code style="font-size: 0.75rem; color: var(--accent-secondary); word-break: break-all; display: block; padding: 8px; background: var(--bg-primary); border-radius: 4px;">${escapeHtml(item.templateName)}</code>
      </div>
    `;
  }

  html += '</div>';

  return html;
}

// ===== Admin Item Management =====
async function loadColumnSettings() {
  const container = document.getElementById('columnSettingsContainer');
  if (!container) return;

  container.innerHTML = '<div class="loading"><span class="spinner"></span> Loading...</div>';

  try {
    const result = await apiGet('/items/columns');
    const columns = result.data || [];

    if (columns.length === 0) {
      container.innerHTML = '<p class="empty-state">No column settings found. Sync items first.</p>';
      return;
    }

    container.innerHTML = columns.map(col => `
      <div class="config-item" style="display: flex; align-items: center; justify-content: space-between; padding: 8px;">
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
          <input type="checkbox" ${col.visible ? 'checked' : ''} 
            onchange="toggleColumnVisibility('${escapeHtml(col.column_name)}', this.checked)"
            style="cursor: pointer;">
          <span>${escapeHtml(col.display_name || col.column_name)}</span>
        </label>
        <span style="color: var(--text-muted); font-size: 0.75rem; font-family: monospace;">${escapeHtml(col.column_name)}</span>
      </div>
    `).join('');
  } catch (error) {
    container.innerHTML = '<p class="empty-state">Failed to load column settings</p>';
  }
}

async function toggleColumnVisibility(columnName, visible) {
  try {
    await fetch(`${API_BASE}/items/columns/${columnName}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ visible }),
    });
    showToast(`Column ${columnName} ${visible ? 'shown' : 'hidden'}`, 'success');
  } catch (error) {
    showToast('Failed to update column visibility', 'error');
  }
}

async function hideItemsFiltered() {
  const category = document.getElementById('itemVisibilityCategory')?.value;
  const itemType = document.getElementById('itemVisibilityType')?.value;

  if (!category && !itemType) {
    showToast('Select a category or type first', 'warning');
    return;
  }

  try {
    const result = await fetch(`${API_BASE}/items/hide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ category, itemType, hidden: true }),
    });
    const data = await result.json();
    showToast(`Hidden ${data.data?.affected || 0} items`, 'success');
    loadItemStats();
  } catch (error) {
    showToast('Failed to hide items', 'error');
  }
}

async function showItemsFiltered() {
  const category = document.getElementById('itemVisibilityCategory')?.value;
  const itemType = document.getElementById('itemVisibilityType')?.value;

  if (!category && !itemType) {
    showToast('Select a category or type first', 'warning');
    return;
  }

  try {
    const result = await fetch(`${API_BASE}/items/hide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ category, itemType, hidden: false }),
    });
    const data = await result.json();
    showToast(`Shown ${data.data?.affected || 0} items`, 'success');
    loadItemStats();
  } catch (error) {
    showToast('Failed to show items', 'error');
  }
}

// Add item search keypress handler
document.addEventListener('DOMContentLoaded', () => {
  const itemSearchInput = document.getElementById('itemSearch');
  if (itemSearchInput) {
    itemSearchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') searchItemsUI();
    });
  }
});

// ===== Cartographer (2D Waypoint Map) =====
let mapInitialized = false;
let mapPlanets = [];
let mapCurrentPlanet = null;
let mapWaypoints = [];
let mapImage = null;
let mapCanvas = null;
let mapCtx = null;
let mapContainer = null;
let mapHoveredWaypoint = null;
let mapSelectedWaypoint = null;
let mapSize = 0; // current canvas pixel size (always square)
let mapCreationEnabled = true; // toggled by admin
let mapSearchFilter = '';       // current waypoint search filter
let mapSearchDebounceTimer = null;
let mapWaypointPage = 0;       // current waypoint list page (0-based)
const WAYPOINTS_PER_PAGE = 10;

// Player overlay (admin only)
let mapShowPlayers = false;     // whether to show player markers
let mapPlayerLocations = [];    // array of { name, x, y, z }
let _mapPlayerLoadingPlanet = null; // prevent duplicate fetches
let mapPlayerPage = 0;          // current page (0-based)
const MAP_PLAYERS_PER_PAGE = 10;
let mapFocusedPlayer = null;    // player obj when clicked (locked focus)
let mapHoveredPlayer = null;    // player obj when hovered (temporary)

// Zoom state
let mapZoom = 1;              // 1 = full map, 2 = 2x zoom, etc.
let mapPanX = 0;              // pan offset in world meters from center
let mapPanZ = 0;              // pan offset in world meters from center
let mapIsPanning = false;     // true while dragging
let mapPanStartX = 0;         // mouse start position for drag
let mapPanStartY = 0;
let mapPanStartWorldX = 0;    // world offset at drag start
let mapPanStartWorldZ = 0;
const MAP_ZOOM_STEPS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96, 100];
let mapZoomIndex = 0;

// Map config: 16km = 16384m, center of image is world 0,0
const MAP_WORLD_SIZE = 16384; // meters total (-8192 to +8192)
const MAP_IMG_PIXELS = 4096;  // source image resolution (4K)
const MAP_FRAME_SIZE = 1024;  // max canvas CSS frame size in pixels

// Waypoint color palette (matches SWG waypoint colors)
const WAYPOINT_COLORS = {
  0: { name: 'Blue',   hex: '#4a90d9', rgb: [74, 144, 217] },
  1: { name: 'Green',  hex: '#4caf50', rgb: [76, 175, 80] },
  2: { name: 'Orange', hex: '#ff9800', rgb: [255, 152, 0] },
  3: { name: 'Yellow', hex: '#ffeb3b', rgb: [255, 235, 59] },
  4: { name: 'Purple', hex: '#ab47bc', rgb: [171, 71, 188] },
  5: { name: 'White',  hex: '#ffffff', rgb: [255, 255, 255] },
  6: { name: 'Red',    hex: '#f44336', rgb: [244, 67, 54] },
};

/**
 * Resize canvas to be the largest square that fits inside the container.
 * Canvas logical pixel size = CSS pixel size, so there is no scaling mismatch.
 * Browser zoom changes the CSS pixel dimensions which triggers ResizeObserver;
 * we just re-fit and re-draw -- the map never shifts or moves.
 */
function resizeMapCanvas() {
  if (!mapContainer || !mapCanvas) return;

  const cw = mapContainer.clientWidth;
  const ch = mapContainer.clientHeight;
  // Frame stays at most 1024 CSS pixels, or smaller if the container is smaller
  const side = Math.floor(Math.min(cw, ch, MAP_FRAME_SIZE));

  if (side === mapSize) return; // no change
  mapSize = side;

  mapCanvas.width = side;
  mapCanvas.height = side;
  mapCanvas.style.width = side + 'px';
  mapCanvas.style.height = side + 'px';

  drawMap();
}

/**
 * Convert game-world X,Z to canvas pixel coordinates.
 * Accounts for zoom level and pan offset.
 * World 0,0 = center of canvas at zoom 1. North is up.
 */
function worldToPixel(worldX, worldZ) {
  const viewSize = MAP_WORLD_SIZE / mapZoom;
  const viewHalf = viewSize / 2;
  // World coords relative to the viewport's top-left corner
  const px = ((worldX - mapPanX) + viewHalf) / viewSize * mapSize;
  const py = (viewHalf - (worldZ - mapPanZ)) / viewSize * mapSize;
  return { x: px, y: py };
}

/**
 * Convert canvas pixel coordinates to game-world X,Z.
 * Accounts for zoom level and pan offset.
 */
function pixelToWorld(px, py) {
  const viewSize = MAP_WORLD_SIZE / mapZoom;
  const half = viewSize / 2;
  const worldX = (px / mapSize) * viewSize - half + mapPanX;
  const worldZ = half - (py / mapSize) * viewSize + mapPanZ;
  return { x: Math.round(worldX), z: Math.round(worldZ) };
}

/**
 * Convert mouse event position to canvas pixel coordinates.
 * Because canvas logical size === CSS size, this is a simple offset calc.
 */
function mouseToCanvas(e) {
  const rect = mapCanvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

/**
 * Clamp the pan offset so the viewport stays within the 16km map bounds.
 */
function clampPan() {
  const half = MAP_WORLD_SIZE / 2;
  const viewHalf = (MAP_WORLD_SIZE / mapZoom) / 2;
  const maxPan = half - viewHalf;
  mapPanX = Math.max(-maxPan, Math.min(maxPan, mapPanX));
  mapPanZ = Math.max(-maxPan, Math.min(maxPan, mapPanZ));
}

function updateZoomLabel() {
  const el = document.getElementById('mapZoomLevel');
  if (el) el.textContent = mapZoom === 1 ? '1x' : mapZoom + 'x';
}

function mapZoomIn() {
  if (mapZoomIndex < MAP_ZOOM_STEPS.length - 1) {
    mapZoomIndex++;
    mapZoom = MAP_ZOOM_STEPS[mapZoomIndex];
    clampPan();
    updateZoomLabel();
    drawMap();
  }
}

function mapZoomOut() {
  if (mapZoomIndex > 0) {
    mapZoomIndex--;
    mapZoom = MAP_ZOOM_STEPS[mapZoomIndex];
    clampPan();
    updateZoomLabel();
    drawMap();
  }
}

function mapZoomReset() {
  mapZoomIndex = 0;
  mapZoom = 1;
  mapPanX = 0;
  mapPanZ = 0;
  updateZoomLabel();
  drawMap();
}

/**
 * Handle mouse wheel zoom on the map canvas.
 * Zooms toward the cursor position.
 */
function onMapWheel(e) {
  e.preventDefault();
  // Get world coordinates under cursor before zoom
  const { x: cx, y: cy } = mouseToCanvas(e);
  const worldBefore = pixelToWorld(cx, cy);

  if (e.deltaY < 0) {
    // Scroll up = zoom in
    if (mapZoomIndex < MAP_ZOOM_STEPS.length - 1) mapZoomIndex++;
  } else {
    // Scroll down = zoom out
    if (mapZoomIndex > 0) mapZoomIndex--;
  }
  mapZoom = MAP_ZOOM_STEPS[mapZoomIndex];

  // Adjust pan so the world point under cursor stays in the same place
  const worldAfter = pixelToWorld(cx, cy);
  mapPanX += worldBefore.x - worldAfter.x;
  mapPanZ += worldBefore.z - worldAfter.z;
  clampPan();
  updateZoomLabel();
  drawMap();
}

/**
 * Start panning on middle-click or right-click drag (also left-drag when zoomed).
 */
function onMapPanStart(e) {
  // Allow panning with middle button, or left button when zoomed in
  if (e.button === 1 || (e.button === 0 && mapZoom > 1 && e.shiftKey)) {
    e.preventDefault();
    mapIsPanning = true;
    mapPanStartX = e.clientX;
    mapPanStartY = e.clientY;
    mapPanStartWorldX = mapPanX;
    mapPanStartWorldZ = mapPanZ;
    mapCanvas.style.cursor = 'grabbing';
  }
}

function onMapPanMove(e) {
  if (!mapIsPanning) return;
  const dx = e.clientX - mapPanStartX;
  const dy = e.clientY - mapPanStartY;
  // Convert pixel drag to world units
  const viewSize = MAP_WORLD_SIZE / mapZoom;
  mapPanX = mapPanStartWorldX - (dx / mapSize) * viewSize;
  mapPanZ = mapPanStartWorldZ + (dy / mapSize) * viewSize;
  clampPan();
  drawMap();
}

function onMapPanEnd(e) {
  if (mapIsPanning) {
    mapIsPanning = false;
    mapCanvas.style.cursor = 'crosshair';
  }
}

function initTerrainView() {
  if (mapInitialized) {
    // Already initialized, just refresh waypoints for current planet
    if (mapCurrentPlanet) loadMapWaypoints(mapCurrentPlanet);
    return;
  }
  mapInitialized = true;

  console.log('[Map] Initializing cartographer');

  mapCanvas = document.getElementById('mapCanvas');
  mapCtx = mapCanvas.getContext('2d');
  mapContainer = document.getElementById('mapContainer');

  // Initial sizing
  resizeMapCanvas();

  // Re-fit on any container size change (including browser zoom)
  const resizeObserver = new ResizeObserver(() => resizeMapCanvas());
  resizeObserver.observe(mapContainer);

  // Load planet list and creation setting
  loadMapPlanets();
  fetchMapCreationSetting();

  // Set up canvas event listeners
  mapCanvas.addEventListener('mousemove', onMapMouseMove);
  mapCanvas.addEventListener('mouseleave', () => {
    document.getElementById('mapCoordTooltip').style.display = 'none';
  });
  mapCanvas.addEventListener('click', onMapClick);
  mapCanvas.addEventListener('dblclick', onMapDoubleClick);

  // Zoom & pan listeners
  mapCanvas.addEventListener('wheel', onMapWheel, { passive: false });
  mapCanvas.addEventListener('mousedown', onMapPanStart);
  mapCanvas.addEventListener('mousemove', onMapPanMove);
  mapCanvas.addEventListener('mouseup', onMapPanEnd);
  mapCanvas.addEventListener('mouseleave', onMapPanEnd);
  // Prevent context menu on canvas for right-click pan
  mapCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

async function loadMapPlanets() {
  try {
    console.log('[Map] Loading planet list...');
    const result = await apiGet('/waypoints/planets');
    if (!result.success) {
      console.warn('[Map] Planets API returned success=false');
      return;
    }

    mapPlanets = result.data;
    console.log('[Map] Got', mapPlanets.length, 'planets');

    const select = document.getElementById('mapPlanetSelect');
    select.innerHTML = '';
    for (const planet of mapPlanets) {
      const option = document.createElement('option');
      option.value = planet.name;
      option.textContent = planet.displayName;
      select.appendChild(option);
    }

    select.addEventListener('change', () => {
      loadMapPlanet(select.value);
    });

    // Load first planet
    if (mapPlanets.length > 0) {
      loadMapPlanet(mapPlanets[0].name);
    }
  } catch (error) {
    console.error('[Map] Failed to load planets:', error);
  }
}

async function loadMapPlanet(planetName) {
  mapCurrentPlanet = planetName;

  // Reset zoom and search when changing planets
  mapZoomIndex = 0;
  mapZoom = 1;
  mapPanX = 0;
  mapPanZ = 0;
  mapSearchFilter = '';
  mapWaypointPage = 0;
  mapPlayerLocations = [];
  mapPlayerPage = 0;
  mapFocusedPlayer = null;
  mapHoveredPlayer = null;
  _mapPlayerLoadingPlanet = null;
  renderMapPlayerList();
  const searchInput = document.getElementById('waypointSearchInput');
  if (searchInput) searchInput.value = '';
  updateZoomLabel();

  const planetInfo = mapPlanets.find(p => p.name === planetName);
  const infoEl = document.getElementById('mapPlanetInfo');
  if (planetInfo) {
    infoEl.innerHTML = `
      <div style="font-weight: 600; font-size: 1rem; margin-bottom: 4px;">${escapeHtml(planetInfo.displayName)}</div>
      <div>Map: ${(planetInfo.mapSize / 1000).toFixed(0)}km x ${(planetInfo.mapSize / 1000).toFixed(0)}km</div>
      <div style="margin-top: 4px; font-size: 0.8rem; color: var(--text-secondary);">Click map to place waypoint. Double-click waypoint to edit.</div>
    `;
  }

  // Load map image
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    mapImage = img;
    drawMap();
  };
  img.onerror = () => {
    console.warn('[Map] Map image not found for', planetName);
    mapImage = null;
    drawMap();
  };
  img.src = `/images/ui_map_${planetName}.png`;

  // Load waypoints
  await loadMapWaypoints(planetName);

  // Reload player overlay if active
  if (mapShowPlayers) {
    loadMapPlayerLocations(planetName);
  }
}

async function loadMapWaypoints(planetName) {
  console.log('[Map] Loading waypoints for', planetName);
  const countEl = document.getElementById('waypointCount');
  if (countEl) countEl.textContent = '...';

  try {
    const result = await apiGet(`/waypoints?planet=${encodeURIComponent(planetName)}`);
    console.log('[Map] Waypoint response:', result.success, 'count:', (result.data || []).length);
    if (result.success) {
      mapWaypoints = result.data || [];
      if (countEl) countEl.textContent = mapWaypoints.length;
      renderWaypointList();
      drawMap();
    } else {
      console.warn('[Map] Waypoint API returned success=false');
      mapWaypoints = [];
      if (countEl) countEl.textContent = '0';
      renderWaypointList();
    }
  } catch (error) {
    console.error('[Map] Failed to load waypoints:', error);
    mapWaypoints = [];
    if (countEl) countEl.textContent = '!';
    renderWaypointList();
  }
}

/**
 * Draw the full map: background image + grid overlay + waypoint markers.
 * Accounts for zoom and pan: only the visible portion of the map is drawn.
 */
function drawMap() {
  if (!mapCtx || mapSize === 0) return;

  const S = mapSize; // shorthand
  const ctx = mapCtx;
  ctx.clearRect(0, 0, S, S);

  // Calculate the source rectangle from the full-resolution image to draw.
  // At zoom 1 the full image is shown. At zoom 2, half the image fills the canvas.
  const half = MAP_WORLD_SIZE / 2;
  const viewSize = MAP_WORLD_SIZE / mapZoom; // meters visible
  const viewHalf = viewSize / 2;

  // Viewport bounds in world coords
  const viewLeft   = mapPanX - viewHalf;
  const viewRight  = mapPanX + viewHalf;
  const viewTop    = mapPanZ + viewHalf; // north = +Z = top
  const viewBottom = mapPanZ - viewHalf;

  // Convert world viewport to image pixel coords (0..4096 source image)
  const imgScale = MAP_IMG_PIXELS / MAP_WORLD_SIZE;
  const sx = (viewLeft + half) * imgScale;
  const sy = (half - viewTop) * imgScale;
  const sw = viewSize * imgScale;
  const sh = viewSize * imgScale;

  // Draw background
  if (mapImage) {
    ctx.drawImage(mapImage, sx, sy, sw, sh, 0, 0, S, S);
  } else {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, S, S);
  }

  // Grid lines every 2km (2048m)
  const gridWorldStep = 2048;
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;

  // Vertical grid lines
  const firstGridX = Math.ceil((viewLeft) / gridWorldStep) * gridWorldStep;
  for (let wx = firstGridX; wx < viewRight; wx += gridWorldStep) {
    const p = worldToPixel(wx, 0);
    ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, S); ctx.stroke();
  }
  // Horizontal grid lines
  const firstGridZ = Math.ceil((viewBottom) / gridWorldStep) * gridWorldStep;
  for (let wz = firstGridZ; wz < viewTop; wz += gridWorldStep) {
    const p = worldToPixel(0, wz);
    ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(S, p.y); ctx.stroke();
  }

  // Center crosshair (world 0,0) -- only if visible
  const origin = worldToPixel(0, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  if (origin.x >= 0 && origin.x <= S) {
    ctx.beginPath(); ctx.moveTo(origin.x, 0); ctx.lineTo(origin.x, S); ctx.stroke();
  }
  if (origin.y >= 0 && origin.y <= S) {
    ctx.beginPath(); ctx.moveTo(0, origin.y); ctx.lineTo(S, origin.y); ctx.stroke();
  }

  // Draw waypoints (filtered by search)
  const visibleWaypoints = getFilteredWaypoints();
  for (const wp of visibleWaypoints) {
    const pos = worldToPixel(wp.x, wp.z);
    const colorInfo = WAYPOINT_COLORS[wp.color] || WAYPOINT_COLORS[0];
    const isHovered = mapHoveredWaypoint && mapHoveredWaypoint.waypoint_id === wp.waypoint_id;
    const isSelected = mapSelectedWaypoint && mapSelectedWaypoint.waypoint_id === wp.waypoint_id;

    drawWaypointMarker(ctx, pos.x, pos.y, colorInfo, wp.name, isHovered || isSelected);
  }

  // Draw player location markers (admin overlay)
  if (mapShowPlayers && mapPlayerLocations.length > 0) {
    const activePlayer = _getActiveMapPlayer();

    if (activePlayer) {
      // Only draw the hovered/focused player
      const pos = worldToPixel(activePlayer.x, activePlayer.z);
      if (pos.x >= -30 && pos.x <= S + 30 && pos.y >= -30 && pos.y <= S + 30) {
        drawPlayerMarker(ctx, pos.x, pos.y, activePlayer.name, true);
      }
    } else {
      // No active player — draw all on the current page as small dots
      const start = mapPlayerPage * MAP_PLAYERS_PER_PAGE;
      const pageItems = mapPlayerLocations.slice(start, start + MAP_PLAYERS_PER_PAGE);
      for (const player of pageItems) {
        const pos = worldToPixel(player.x, player.z);
        if (pos.x < -20 || pos.x > S + 20 || pos.y < -20 || pos.y > S + 20) continue;
        drawPlayerMarker(ctx, pos.x, pos.y, player.name, false);
      }
    }
  }
}

/**
 * Draw a single waypoint marker with diamond shape and label
 */
function drawWaypointMarker(ctx, cx, cy, colorInfo, label, highlighted) {
  const size = highlighted ? 10 : 7;

  ctx.save();

  // Outer glow when highlighted
  if (highlighted) {
    ctx.shadowColor = colorInfo.hex;
    ctx.shadowBlur = 12;
  }

  // Diamond shape
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx + size * 0.7, cy);
  ctx.lineTo(cx, cy + size);
  ctx.lineTo(cx - size * 0.7, cy);
  ctx.closePath();

  ctx.fillStyle = colorInfo.hex;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.shadowBlur = 0;

  // Label
  if (label) {
    ctx.font = `${highlighted ? 'bold ' : ''}11px Vera, Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const text = label.length > 20 ? label.substring(0, 18) + '...' : label;
    const metrics = ctx.measureText(text);

    // Label background
    const pad = 3;
    const lx = cx - metrics.width / 2 - pad;
    const ly = cy - size - 16;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(lx, ly, metrics.width + pad * 2, 14);

    // Label text
    ctx.fillStyle = '#fff';
    ctx.fillText(text, cx, cy - size - 4);
  }

  ctx.restore();
}

/**
 * Find waypoint near a canvas pixel position
 */
function findWaypointAtPixel(px, py, threshold = 12) {
  for (const wp of getFilteredWaypoints()) {
    const pos = worldToPixel(wp.x, wp.z);
    const dx = pos.x - px;
    const dy = pos.y - py;
    if (Math.sqrt(dx * dx + dy * dy) <= threshold) {
      return wp;
    }
  }
  return null;
}

function onMapMouseMove(e) {
  if (mapIsPanning) return; // don't update tooltip while panning

  const { x, y } = mouseToCanvas(e);
  const world = pixelToWorld(x, y);

  // Update coordinate tooltip
  const tooltip = document.getElementById('mapCoordTooltip');
  tooltip.style.display = 'block';
  tooltip.style.left = (e.clientX - mapCanvas.getBoundingClientRect().left + 14) + 'px';
  tooltip.style.top = (e.clientY - mapCanvas.getBoundingClientRect().top - 10) + 'px';

  // Show zoom hint when zoomed in
  const zoomHint = mapZoom > 1 ? ' [Shift+drag to pan]' : '';
  const wp = findWaypointAtPixel(x, y);
  if (wp) {
    tooltip.textContent = `${wp.name} (${Math.round(wp.x)}, ${Math.round(wp.z)})`;
    mapCanvas.style.cursor = 'pointer';
  } else {
    tooltip.textContent = `${world.x}, ${world.z}${zoomHint}`;
    mapCanvas.style.cursor = mapZoom > 1 ? 'grab' : 'crosshair';
  }

  // Hover highlight
  const prevHovered = mapHoveredWaypoint;
  mapHoveredWaypoint = wp;
  if (prevHovered !== mapHoveredWaypoint) {
    drawMap();
  }
}

function onMapClick(e) {
  // Don't trigger click after panning
  if (e.shiftKey && mapZoom > 1) return;

  const { x, y } = mouseToCanvas(e);
  const wp = findWaypointAtPixel(x, y);

  if (wp) {
    // Select waypoint
    mapSelectedWaypoint = wp;
    highlightWaypointInList(wp.waypoint_id);
    drawMap();
  } else if (mapCreationEnabled) {
    // Click on empty space: create waypoint at that position
    const world = pixelToWorld(x, y);
    openWaypointModal(null, world.x, world.z);
  } else {
    mapSelectedWaypoint = null;
    drawMap();
  }
}

function onMapDoubleClick(e) {
  const { x, y } = mouseToCanvas(e);
  const wp = findWaypointAtPixel(x, y);

  if (wp) {
    if (wp.source === 'oracle') {
      // Server waypoints are read-only
      showToast(`"${wp.name}" is a server waypoint (read-only)`, 'warning');
    } else {
      // Edit local waypoint
      openWaypointModal(wp);
    }
  }
}

/**
 * Get waypoints filtered by the current search query
 */
function getFilteredWaypoints() {
  if (!mapSearchFilter) return mapWaypoints;
  const q = mapSearchFilter.toLowerCase();
  return mapWaypoints.filter(wp =>
    (wp.name && wp.name.toLowerCase().includes(q)) ||
    (wp.waypoint_id && String(wp.waypoint_id).includes(q))
  );
}

/**
 * Debounced search input handler for waypoints
 */
function onWaypointSearchInput(value) {
  clearTimeout(mapSearchDebounceTimer);
  mapSearchDebounceTimer = setTimeout(() => {
    mapSearchFilter = (value || '').trim();
    mapWaypointPage = 0;
    renderWaypointList();
    drawMap();
  }, 200);
}

// ===== Player Map Overlay (Admin) =====

function toggleMapPlayers(checked) {
  mapShowPlayers = !!checked;
  const card = document.getElementById('mapPlayerCard');

  if (mapShowPlayers && mapCurrentPlanet) {
    if (card) card.style.display = '';
    loadMapPlayerLocations(mapCurrentPlanet);
  } else {
    mapPlayerLocations = [];
    mapPlayerPage = 0;
    mapFocusedPlayer = null;
    mapHoveredPlayer = null;
    if (card) card.style.display = 'none';
    drawMap();
  }
}

async function loadMapPlayerLocations(planetName) {
  if (_mapPlayerLoadingPlanet === planetName) return;
  _mapPlayerLoadingPlanet = planetName;

  try {
    const result = await apiGet(`/players/by-planet?planet=${encodeURIComponent(planetName)}`);
    if (mapCurrentPlanet === planetName) {
      mapPlayerLocations = result.data || [];
      mapPlayerPage = 0;
      mapFocusedPlayer = null;
      mapHoveredPlayer = null;
      renderMapPlayerList();
      drawMap();
    }
  } catch (error) {
    console.error('[Map] Failed to load player locations:', error);
    mapPlayerLocations = [];
    renderMapPlayerList();
  } finally {
    if (_mapPlayerLoadingPlanet === planetName) {
      _mapPlayerLoadingPlanet = null;
    }
  }
}

/** Get the currently active (hovered or focused) player, or null */
function _getActiveMapPlayer() {
  return mapHoveredPlayer || mapFocusedPlayer || null;
}

/** Render the paginated player list in the sidebar card */
function renderMapPlayerList() {
  const container = document.getElementById('mapPlayerList');
  const countEl = document.getElementById('mapPlayerCount');
  if (!container) return;

  const total = mapPlayerLocations.length;
  if (countEl) countEl.textContent = total;

  if (total === 0) {
    container.innerHTML = '<p style="color: var(--text-secondary); font-size: 0.85rem; padding: 8px 16px;">No players on this planet</p>';
    return;
  }

  const totalPages = Math.ceil(total / MAP_PLAYERS_PER_PAGE);
  if (mapPlayerPage >= totalPages) mapPlayerPage = totalPages - 1;
  if (mapPlayerPage < 0) mapPlayerPage = 0;

  const start = mapPlayerPage * MAP_PLAYERS_PER_PAGE;
  const pageItems = mapPlayerLocations.slice(start, start + MAP_PLAYERS_PER_PAGE);

  const activePlayer = _getActiveMapPlayer();

  let html = '';
  for (let i = 0; i < pageItems.length; i++) {
    const p = pageItems[i];
    const globalIdx = start + i;
    const isActive = activePlayer && activePlayer.characterObjectId === p.characterObjectId;
    html += `
      <div class="map-player-row ${isActive ? 'map-player-row--active' : ''}"
           onmouseenter="onMapPlayerHover(${globalIdx})"
           onmouseleave="onMapPlayerHoverEnd()"
           onclick="onMapPlayerClick(${globalIdx})">
        <span class="map-player-row-dot"></span>
        <span class="map-player-row-name">${escapeHtml(p.name)}</span>
        <span class="map-player-row-coords">${Math.round(p.x)}, ${Math.round(p.z)}</span>
      </div>
    `;
  }

  // Pagination controls
  if (totalPages > 1) {
    html += `
      <div class="map-player-pagination">
        <button class="btn btn-sm" ${mapPlayerPage === 0 ? 'disabled' : ''} onclick="mapPlayerPagePrev()">&laquo;</button>
        <span>${mapPlayerPage + 1} / ${totalPages}</span>
        <button class="btn btn-sm" ${mapPlayerPage >= totalPages - 1 ? 'disabled' : ''} onclick="mapPlayerPageNext()">&raquo;</button>
      </div>
    `;
  }

  container.innerHTML = html;
}

function mapPlayerPagePrev() {
  if (mapPlayerPage > 0) {
    mapPlayerPage--;
    mapFocusedPlayer = null;
    mapHoveredPlayer = null;
    renderMapPlayerList();
    drawMap();
  }
}

function mapPlayerPageNext() {
  const totalPages = Math.ceil(mapPlayerLocations.length / MAP_PLAYERS_PER_PAGE);
  if (mapPlayerPage < totalPages - 1) {
    mapPlayerPage++;
    mapFocusedPlayer = null;
    mapHoveredPlayer = null;
    renderMapPlayerList();
    drawMap();
  }
}

function onMapPlayerHover(idx) {
  if (idx >= 0 && idx < mapPlayerLocations.length) {
    mapHoveredPlayer = mapPlayerLocations[idx];
    renderMapPlayerList();
    drawMap();
  }
}

function onMapPlayerHoverEnd() {
  mapHoveredPlayer = null;
  renderMapPlayerList();
  drawMap();
}

function onMapPlayerClick(idx) {
  if (idx >= 0 && idx < mapPlayerLocations.length) {
    const clicked = mapPlayerLocations[idx];
    // Toggle: click again to deselect
    if (mapFocusedPlayer && mapFocusedPlayer.characterObjectId === clicked.characterObjectId) {
      mapFocusedPlayer = null;
    } else {
      mapFocusedPlayer = clicked;
    }
    renderMapPlayerList();
    drawMap();
  }
}

/**
 * Draw a single player marker on the map — glowing circle with name label.
 * @param {boolean} [enlarged=false] - draw larger for active/focused state
 */
function drawPlayerMarker(ctx, cx, cy, name, enlarged) {
  const radius = enlarged ? 7 : 5;

  ctx.save();

  // Outer glow
  ctx.shadowColor = '#00e5ff';
  ctx.shadowBlur = enlarged ? 22 : 14;

  // Glowing circle
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#00e5ff';
  ctx.fill();

  // Inner bright core
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.45, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Outer ring
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
  ctx.strokeStyle = enlarged ? 'rgba(0, 229, 255, 0.6)' : 'rgba(0, 229, 255, 0.35)';
  ctx.lineWidth = enlarged ? 2 : 1.5;
  ctx.stroke();

  // Name label
  if (name) {
    const fontSize = enlarged ? 12 : 10;
    ctx.font = `${enlarged ? 'bold ' : ''}${fontSize}px Vera, Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const text = name.length > 18 ? name.substring(0, 16) + '..' : name;
    const metrics = ctx.measureText(text);
    const pad = 3;
    const lx = cx - metrics.width / 2 - pad;
    const ly = cy - radius - 14;

    // Label background
    ctx.fillStyle = 'rgba(0, 40, 50, 0.85)';
    const bgWidth = metrics.width + pad * 2;
    const bgHeight = fontSize + 3;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(lx, ly, bgWidth, bgHeight, 3);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    } else {
      ctx.fillRect(lx, ly, bgWidth, bgHeight);
    }

    // Label text
    ctx.fillStyle = '#00e5ff';
    ctx.fillText(text, cx, cy - radius - 3);
  }

  ctx.restore();
}

/**
 * Render the waypoint sidebar list (paginated)
 */
function renderWaypointList() {
  const container = document.getElementById('waypointList');
  const countEl = document.getElementById('waypointCount');
  const filtered = getFilteredWaypoints();

  if (filtered.length === 0) {
    let msg;
    if (mapSearchFilter) {
      msg = `No waypoints matching "${escapeHtml(mapSearchFilter)}"`;
    } else {
      msg = 'No waypoints on this planet. Click the map to add one.';
      if (isAdmin) {
        msg += `<br><button class="btn btn-sm" style="margin-top: 8px;" onclick="syncWaypointsFromMap()">Sync from Oracle</button>`;
      }
    }
    container.innerHTML = `<p style="color: var(--text-secondary); font-size: 0.85rem; padding: 8px;">${msg}</p>`;
    if (countEl) countEl.textContent = mapSearchFilter ? `${filtered.length}/${mapWaypoints.length}` : '0';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / WAYPOINTS_PER_PAGE));
  if (mapWaypointPage >= totalPages) mapWaypointPage = totalPages - 1;
  if (mapWaypointPage < 0) mapWaypointPage = 0;
  const start = mapWaypointPage * WAYPOINTS_PER_PAGE;
  const pageItems = filtered.slice(start, start + WAYPOINTS_PER_PAGE);

  if (countEl) {
    countEl.textContent = mapSearchFilter ? `${filtered.length}/${mapWaypoints.length}` : String(filtered.length);
  }

  let html = pageItems.map(wp => {
    const color = WAYPOINT_COLORS[wp.color] || WAYPOINT_COLORS[0];
    const isOracle = wp.source === 'oracle';
    const sourceLabel = isOracle
      ? '<span style="color: var(--accent-secondary); font-size: 0.65rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">SERVER</span>'
      : '<span style="color: var(--text-muted); font-size: 0.65rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">LOCAL</span>';
    const actionButtons = isOracle
      ? ''
      : `<div style="display: flex; gap: 2px; flex-shrink: 0;">
          <button class="btn btn-sm" style="padding: 2px 6px; font-size: 0.7rem;" onclick="event.stopPropagation(); openWaypointModal(getWaypointById_local('${escapeHtml(wp.waypoint_id)}'))" title="Edit">Edit</button>
          <button class="btn btn-sm" style="padding: 2px 6px; font-size: 0.7rem; color: #f66;" onclick="event.stopPropagation(); confirmDeleteWaypoint('${escapeHtml(wp.waypoint_id)}', '${escapeHtml(wp.name)}')" title="Delete">X</button>
        </div>`;
    return `
      <div class="waypoint-list-item" data-id="${escapeHtml(wp.waypoint_id)}"
           style="display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 6px; cursor: pointer; transition: background 0.15s;"
           onmouseenter="this.style.background='var(--bg-primary)'; hoverWaypointFromList('${escapeHtml(wp.waypoint_id)}')"
           onmouseleave="this.style.background='transparent'; unhoverWaypointFromList()"
           onclick="selectWaypointFromList('${escapeHtml(wp.waypoint_id)}')">
        <div style="width: 10px; height: 10px; transform: rotate(45deg); background: ${color.hex}; flex-shrink: 0;"></div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 0.85rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(wp.name)}</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); font-family: var(--font-mono);">${Math.round(wp.x)}, ${Math.round(wp.z)} ${sourceLabel}</div>
        </div>
        ${actionButtons}
      </div>
    `;
  }).join('');

  if (totalPages > 1) {
    html += `
      <div class="waypoint-pagination">
        <button class="btn btn-sm" ${mapWaypointPage === 0 ? 'disabled' : ''} onclick="waypointPagePrev()">&laquo;</button>
        <span>${mapWaypointPage + 1} / ${totalPages}</span>
        <button class="btn btn-sm" ${mapWaypointPage >= totalPages - 1 ? 'disabled' : ''} onclick="waypointPageNext()">&raquo;</button>
      </div>
    `;
  }

  container.innerHTML = html;
}

function waypointPagePrev() {
  if (mapWaypointPage > 0) {
    mapWaypointPage--;
    renderWaypointList();
  }
}

function waypointPageNext() {
  const filtered = getFilteredWaypoints();
  const totalPages = Math.max(1, Math.ceil(filtered.length / WAYPOINTS_PER_PAGE));
  if (mapWaypointPage < totalPages - 1) {
    mapWaypointPage++;
    renderWaypointList();
  }
}

function getWaypointById_local(waypointId) {
  return mapWaypoints.find(w => w.waypoint_id === waypointId) || null;
}

function hoverWaypointFromList(waypointId) {
  mapHoveredWaypoint = mapWaypoints.find(w => w.waypoint_id === waypointId) || null;
  drawMap();
}

function unhoverWaypointFromList() {
  mapHoveredWaypoint = null;
  drawMap();
}

function selectWaypointFromList(waypointId) {
  mapSelectedWaypoint = mapWaypoints.find(w => w.waypoint_id === waypointId) || null;
  drawMap();
}

function highlightWaypointInList(waypointId) {
  // Scroll the waypoint into view in the sidebar
  const el = document.querySelector(`.waypoint-list-item[data-id="${waypointId}"]`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    el.style.background = 'var(--bg-primary)';
    setTimeout(() => { el.style.background = 'transparent'; }, 1500);
  }
}

/**
 * Open the waypoint add/edit modal
 * @param {Object|null} waypoint - Existing waypoint to edit, or null for new
 * @param {number} [defaultX] - Default X coordinate for new waypoint
 * @param {number} [defaultZ] - Default Z coordinate for new waypoint
 */
function openWaypointModal(waypoint, defaultX, defaultZ) {
  const isEdit = waypoint !== null && waypoint !== undefined;

  document.getElementById('waypointModalTitle').textContent = isEdit ? 'Edit Waypoint' : 'Add Waypoint';
  document.getElementById('waypointEditId').value = isEdit ? waypoint.waypoint_id : '';
  document.getElementById('waypointEditName').value = isEdit ? waypoint.name : 'Waypoint';
  document.getElementById('waypointEditX').value = isEdit ? Math.round(waypoint.x) : (defaultX || 0);
  document.getElementById('waypointEditY').value = isEdit ? Math.round(waypoint.y) : 0;
  document.getElementById('waypointEditZ').value = isEdit ? Math.round(waypoint.z) : (defaultZ || 0);
  document.getElementById('waypointEditColor').value = isEdit ? waypoint.color : 0;

  document.getElementById('waypointModal').classList.add('open');
  document.getElementById('waypointEditName').focus();
  document.getElementById('waypointEditName').select();
}

function addWaypointPrompt() {
  if (!mapCreationEnabled) {
    showToast('Waypoint creation is currently disabled', 'warning');
    return;
  }
  openWaypointModal(null, 0, 0);
}

async function syncWaypointsFromMap() {
  showToast('Syncing waypoints from Oracle...', 'info');
  try {
    const result = await apiPost('/waypoints/sync', {});
    const data = result.data || {};
    showToast(`Waypoint sync: ${data.added || 0} added, ${data.updated || 0} updated, ${data.removed || 0} removed`, 'success');
    // Reload current planet's waypoints
    if (mapCurrentPlanet) {
      await loadMapWaypoints(mapCurrentPlanet);
    }
  } catch (error) {
    showToast('Waypoint sync failed: ' + error.message, 'error');
  }
}

async function fetchMapCreationSetting() {
  try {
    const result = await apiGet('/waypoints/settings/creation');
    if (result.success) {
      mapCreationEnabled = result.data.enabled;
    }
  } catch (error) {
    // Default to enabled if we can't reach the server
    mapCreationEnabled = true;
  }
}

async function saveWaypoint() {
  const id = document.getElementById('waypointEditId').value;
  const name = document.getElementById('waypointEditName').value.trim() || 'Waypoint';
  const x = parseFloat(document.getElementById('waypointEditX').value) || 0;
  const y = parseFloat(document.getElementById('waypointEditY').value) || 0;
  const z = parseFloat(document.getElementById('waypointEditZ').value) || 0;
  const color = parseInt(document.getElementById('waypointEditColor').value) || 0;

  try {
    if (id) {
      // Update existing
      await apiPut(`/waypoints/${encodeURIComponent(id)}`, { name, x, y, z, color });
      showToast('Waypoint updated', 'success');
    } else {
      // Create new
      await apiPost('/waypoints', { name, planet: mapCurrentPlanet, x, y, z, color });
      showToast('Waypoint created', 'success');
    }

    closeModal('waypointModal');
    await loadMapWaypoints(mapCurrentPlanet);
  } catch (error) {
    showToast('Failed to save waypoint: ' + error.message, 'error');
  }
}

async function confirmDeleteWaypoint(waypointId, waypointName) {
  if (!confirm(`Delete waypoint "${waypointName}"?`)) return;

  try {
    await apiDelete(`/waypoints/${encodeURIComponent(waypointId)}`);
    showToast('Waypoint deleted', 'success');
    await loadMapWaypoints(mapCurrentPlanet);
  } catch (error) {
    showToast('Failed to delete waypoint: ' + error.message, 'error');
  }
}

// ===== Quest Functions =====
let questsCurrentPage = 1;
let questsPageSize = 25;
let questsTotalCount = 0;
let questTypes = [];
let questCategories = [];

/**
 * Initialize and load the quests view
 */
async function loadQuestsView() {
  console.log('[Quests] Loading quests view');

  // Load quest types and categories for filters
  await loadQuestFilters();

  // Load quests
  await loadQuests();
}

/**
 * Load quest filter options (types and categories)
 */
async function loadQuestFilters() {
  try {
    // Load quest types
    const typesResult = await apiGet('/quests/types');
    if (typesResult.success) {
      questTypes = typesResult.data;
      const typeSelect = document.getElementById('questTypeFilter');
      typeSelect.innerHTML = '<option value="">All Types</option>' +
        questTypes.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    }

    // Update stats
    document.getElementById('questTypesCount').textContent = questTypes.length;

    // Load categories count (via a quick search)
    const categoriesResult = await apiGet('/quests/categories');
    if (categoriesResult.success) {
      questCategories = categoriesResult.data;
      document.getElementById('questCategoriesCount').textContent = questCategories.length;
    }
  } catch (error) {
    console.error('[Quests] Failed to load filters:', error);
  }
}

/**
 * Load quests with current filters
 */
async function loadQuests() {
  const tableBody = document.getElementById('questTableBody');
  tableBody.innerHTML = '<tr><td colspan="6" class="loading">Loading quests...</td></tr>';

  try {
    const search = document.getElementById('questSearch').value;
    const levelRange = document.getElementById('questLevelFilter').value;
    const type = document.getElementById('questTypeFilter').value;

    let params = new URLSearchParams();
    if (search) params.append('search', search);
    if (type) params.append('type', type);

    // Parse level range
    if (levelRange) {
      const [minLevel, maxLevel] = levelRange.split('-').map(Number);
      if (minLevel) params.append('minLevel', minLevel);
      if (maxLevel) params.append('maxLevel', maxLevel);
    }

    params.append('limit', questsPageSize);
    params.append('offset', (questsCurrentPage - 1) * questsPageSize);

    const result = await apiGet(`/quests?${params.toString()}`);

    if (result.success) {
      questsTotalCount = result.total;
      document.getElementById('totalQuestsCount').textContent = result.total.toLocaleString();
      document.getElementById('questResultCount').textContent = `${result.count} of ${result.total} quests`;

      renderQuestTable(result.data);
      updateQuestPagination();
    } else {
      tableBody.innerHTML = `<tr><td colspan="6" class="error">Failed to load quests: ${result.error}</td></tr>`;
    }
  } catch (error) {
    console.error('[Quests] Failed to load quests:', error);
    tableBody.innerHTML = `<tr><td colspan="6" class="error">Error: ${error.message}</td></tr>`;
  }
}

/**
 * Render quest table rows
 */
function renderQuestTable(quests) {
  const tableBody = document.getElementById('questTableBody');

  if (!quests || quests.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-secondary);">No quests found</td></tr>';
    return;
  }

  tableBody.innerHTML = quests.map(quest => {
    // Use resolved value if available, otherwise fall back to key or questName
    const title = quest.title?.value || quest.title?.key || quest.questName;
    const category = quest.category?.value || quest.category?.key || '-';
    const rewards = formatQuestRewardsSummary(quest.rewards);

    return `
      <tr onclick="openQuestModal('${escapeHtml(quest.questName)}')" style="cursor: pointer;">
        <td><span class="level-badge">${quest.level || '-'}</span></td>
        <td>
          <div class="quest-name">${escapeHtml(title)}</div>
          <div class="quest-id" style="font-size: 0.8em; color: var(--text-secondary);">${escapeHtml(quest.questName)}</div>
        </td>
        <td><span class="type-badge type-${(quest.type || 'unknown').toLowerCase()}">${escapeHtml(quest.type || 'Unknown')}</span></td>
        <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(category)}</td>
        <td>${rewards}</td>
        <td>
          <button class="btn btn-sm" onclick="event.stopPropagation(); openQuestModal('${escapeHtml(quest.questName)}')">View</button>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Format quest rewards for table display
 */
function formatQuestRewardsSummary(rewards) {
  if (!rewards || rewards.length === 0) {
    return '<span style="color: var(--text-secondary);">-</span>';
  }

  const parts = [];

  for (const reward of rewards) {
    switch (reward.type) {
      case 'credits':
        parts.push(`💰 ${reward.value.toLocaleString()}`);
        break;
      case 'experience':
        parts.push(`⭐ ${reward.value.toLocaleString()} XP`);
        break;
      case 'faction':
        parts.push(`🏛️ +${reward.value}`);
        break;
      case 'loot':
      case 'item':
      case 'weapon':
      case 'armor':
        parts.push(`🎁 Item`);
        break;
      case 'exclusive_choice':
        parts.push(`🎲 Choice`);
        break;
      case 'badge':
        parts.push(`🏆 Badge`);
        break;
    }
  }

  return parts.slice(0, 3).join(' ') + (parts.length > 3 ? ' ...' : '');
}

/**
 * Update quest pagination controls
 */
function updateQuestPagination() {
  const pagination = document.getElementById('questPagination');
  const totalPages = Math.ceil(questsTotalCount / questsPageSize);

  if (totalPages <= 1) {
    pagination.style.display = 'none';
    return;
  }

  pagination.style.display = 'flex';
  document.getElementById('questPageInfo').textContent = `Page ${questsCurrentPage} of ${totalPages}`;
  document.getElementById('questPrevBtn').disabled = questsCurrentPage <= 1;
  document.getElementById('questNextBtn').disabled = questsCurrentPage >= totalPages;
}

/**
 * Navigate quest pages
 */
function loadQuestsPage(delta) {
  questsCurrentPage += delta;
  if (questsCurrentPage < 1) questsCurrentPage = 1;
  loadQuests();
}

/**
 * Open quest detail modal
 */
async function openQuestModal(questName) {
  console.log('[Quests] Opening quest modal:', questName);

  const modal = document.getElementById('questModal');
  const title = document.getElementById('questModalTitle');
  const body = document.getElementById('questModalBody');

  title.textContent = 'Loading...';
  body.innerHTML = '<div class="loading">Loading quest details...</div>';
  modal.classList.add('open');

  try {
    const result = await apiGet(`/quests/${encodeURIComponent(questName)}`);

    if (result.success && result.data) {
      const quest = result.data;
      // Use resolved value if available, otherwise key or questName
      title.textContent = quest.title?.value || quest.title?.key || quest.questName;
      body.innerHTML = renderQuestModalContent(quest);
    } else {
      body.innerHTML = `<div class="error">Failed to load quest: ${result.error}</div>`;
    }
  } catch (error) {
    console.error('[Quests] Failed to load quest:', error);
    body.innerHTML = `<div class="error">Error: ${error.message}</div>`;
  }
}

/**
 * Render quest modal content
 */
function renderQuestModalContent(quest) {
  const rewards = renderQuestRewards(quest.rewards);
  const penalties = renderQuestPenalties(quest.penalties);
  const tasks = renderQuestTasks(quest.tasks);
  const prerequisites = renderQuestPrerequisites(quest);

  // Helper to get display value from string ref (prefer value, fall back to key)
  const getDisplayValue = (ref, fallback = 'Unknown') => {
    if (!ref) return fallback;
    if (ref.value) return ref.value;
    if (ref.key) return ref.key;
    if (ref.raw && !ref.raw.startsWith('@')) return ref.raw;
    return fallback;
  };

  const titleDisplay = getDisplayValue(quest.title, quest.questName);
  const categoryDisplay = getDisplayValue(quest.category, 'Uncategorized');
  const descriptionDisplay = getDisplayValue(quest.description, null);

  return `
    <div class="quest-detail">
      <!-- Quest Header Info -->
      <div class="quest-header-info" style="display: flex; gap: 16px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border-color);">
        <div class="quest-level-display" style="display: flex; flex-direction: column; align-items: center; padding: 16px; background: var(--bg-tertiary); border-radius: 8px; min-width: 80px;">
          <span style="font-size: 2rem; font-weight: bold; color: var(--accent-primary);">${quest.level || '?'}</span>
          <span style="font-size: 0.75rem; color: var(--text-secondary);">Level</span>
        </div>
        <div style="flex: 1;">
          <h3 style="margin: 0 0 8px 0;">${escapeHtml(titleDisplay)}</h3>
          <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px;">
            <span class="type-badge type-${(quest.type || 'unknown').toLowerCase()}">${escapeHtml(quest.type || 'Unknown')}</span>
            ${quest.tier ? `<span class="tier-badge">Tier ${quest.tier}</span>` : ''}
            ${quest.allowRepeats ? '<span class="badge badge-info">Repeatable</span>' : ''}
            ${quest.grantGcw ? '<span class="badge badge-warning">GCW</span>' : ''}
          </div>
          <div style="color: var(--text-secondary); font-size: 0.85rem;">
            <strong>Category:</strong> ${escapeHtml(categoryDisplay)}
          </div>
          <div style="color: var(--text-secondary); font-size: 0.85rem;">
            <strong>Quest ID:</strong> <code>${escapeHtml(quest.questId)}</code>
          </div>
        </div>
      </div>

      <!-- Quest Description -->
      <div class="quest-section" style="margin-bottom: 24px;">
        <h4 style="margin: 0 0 8px 0; color: var(--text-secondary);">📖 Description</h4>
        <div class="quest-description" style="background: var(--bg-tertiary); padding: 16px; border-radius: 8px; line-height: 1.6;">
          ${descriptionDisplay ? escapeHtml(descriptionDisplay) : '<em>No description available</em>'}
        </div>
      </div>

      ${prerequisites}

      <!-- Rewards Section -->
      ${rewards}

      <!-- Penalties Section -->
      ${penalties}

      <!-- Completion Summary -->
      ${quest.completionSummary?.value || quest.completionSummary?.key ? `
        <div class="quest-section" style="margin-bottom: 24px;">
          <h4 style="margin: 0 0 8px 0; color: var(--text-secondary);">✅ Completion Summary</h4>
          <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 8px;">
            ${escapeHtml(quest.completionSummary.value || quest.completionSummary.key)}
          </div>
        </div>
      ` : ''}

      <!-- Tasks Section -->
      ${tasks}
    </div>
  `;
}

/**
 * Render quest rewards section
 */
function renderQuestRewards(rewards) {
  if (!rewards || rewards.length === 0) {
    return '';
  }

  const rewardItems = rewards.map(reward => {
    switch (reward.type) {
      case 'credits':
        return `<div class="reward-item"><span class="reward-icon">💰</span><span>${reward.value.toLocaleString()} Credits</span></div>`;
      case 'experience':
        return `<div class="reward-item"><span class="reward-icon">⭐</span><span>${reward.value.toLocaleString()} ${reward.experienceType || 'XP'}</span></div>`;
      case 'faction':
        return `<div class="reward-item"><span class="reward-icon">🏛️</span><span>+${reward.value} ${reward.faction} Faction Standing</span></div>`;
      case 'loot':
        return `<div class="reward-item"><span class="reward-icon">🎁</span><span>${reward.count}x ${getItemDisplayName(reward.item)}</span></div>`;
      case 'item':
        return `<div class="reward-item"><span class="reward-icon">📦</span><span>${reward.count}x ${getItemDisplayName(reward.item)}</span></div>`;
      case 'weapon':
        return `<div class="reward-item"><span class="reward-icon">⚔️</span><span>Weapon: ${getItemDisplayName(reward.item)}</span></div>`;
      case 'armor':
        return `<div class="reward-item"><span class="reward-icon">🛡️</span><span>Armor: ${getItemDisplayName(reward.item)}</span></div>`;
      case 'badge':
        return `<div class="reward-item"><span class="reward-icon">🏆</span><span>Badge: ${reward.badge}</span></div>`;
      case 'exclusive_choice':
        return `
          <div class="reward-item reward-choice">
            <span class="reward-icon">🎲</span>
            <div>
              <strong>Choose one:</strong>
              <ul style="margin: 4px 0 0 20px; padding: 0;">
                ${reward.options.map(opt => `<li>${opt.count}x ${getItemDisplayName(opt.item)}</li>`).join('')}
              </ul>
            </div>
          </div>
        `;
      default:
        return `<div class="reward-item"><span class="reward-icon">📋</span><span>${reward.display || 'Unknown reward'}</span></div>`;
    }
  }).join('');

  return `
    <div class="quest-section" style="margin-bottom: 24px;">
      <h4 style="margin: 0 0 8px 0; color: var(--text-secondary);">🎁 Rewards</h4>
      <div class="rewards-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px;">
        ${rewardItems}
      </div>
    </div>
  `;
}

/**
 * Render quest penalties section
 */
function renderQuestPenalties(penalties) {
  if (!penalties || penalties.length === 0) {
    return '';
  }

  const penaltyItems = penalties.map(penalty => {
    return `<div class="penalty-item" style="color: #f66;"><span class="penalty-icon">⚠️</span><span>${penalty.display}</span></div>`;
  }).join('');

  return `
    <div class="quest-section" style="margin-bottom: 24px;">
      <h4 style="margin: 0 0 8px 0; color: #f66;">⚠️ Penalties</h4>
      <div style="background: rgba(255,100,100,0.1); padding: 12px; border-radius: 8px;">
        ${penaltyItems}
      </div>
    </div>
  `;
}

/**
 * Render quest prerequisites section
 */
function renderQuestPrerequisites(quest) {
  const hasPrereqs = quest.prerequisiteQuests && quest.prerequisiteQuests.length > 0;
  const hasExclusions = quest.exclusionQuests && quest.exclusionQuests.length > 0;

  if (!hasPrereqs && !hasExclusions) {
    return '';
  }

  return `
    <div class="quest-section" style="margin-bottom: 24px;">
      <h4 style="margin: 0 0 8px 0; color: var(--text-secondary);">🔗 Requirements</h4>
      <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 8px;">
        ${hasPrereqs ? `
          <div style="margin-bottom: 8px;">
            <strong>Prerequisite Quests:</strong>
            <ul style="margin: 4px 0 0 20px;">
              ${quest.prerequisiteQuests.map(q => `<li><a href="#" onclick="openQuestModal('${escapeHtml(q)}'); return false;">${escapeHtml(q)}</a></li>`).join('')}
            </ul>
          </div>
        ` : ''}
        ${hasExclusions ? `
          <div>
            <strong>Exclusive With:</strong>
            <ul style="margin: 4px 0 0 20px;">
              ${quest.exclusionQuests.map(q => `<li><a href="#" onclick="openQuestModal('${escapeHtml(q)}'); return false;">${escapeHtml(q)}</a></li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

/**
 * Render quest tasks section
 */
function renderQuestTasks(tasks) {
  if (!tasks || tasks.length === 0) {
    return `
      <div class="quest-section">
        <h4 style="margin: 0 0 8px 0; color: var(--text-secondary);">📋 Tasks</h4>
        <p style="color: var(--text-secondary);">No task data available</p>
      </div>
    `;
  }

  const visibleTasks = tasks.filter(t => t.visible);

  const taskItems = tasks.map((task, index) => {
    const isVisible = task.visible;
    const hasWaypoint = task.waypoint && task.waypoint.planet;

    return `
      <div class="task-item" style="padding: 12px; background: var(--bg-tertiary); border-radius: 8px; margin-bottom: 8px; ${!isVisible ? 'opacity: 0.6;' : ''}">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span class="task-index" style="background: var(--accent-primary); color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;">${index}</span>
              <span class="task-type" style="background: var(--bg-secondary); padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;">${escapeHtml(task.type || 'unknown')}</span>
              ${!isVisible ? '<span style="color: var(--text-secondary); font-size: 0.75rem;">(Hidden)</span>' : ''}
            </div>
            <div class="task-name" style="font-weight: 500;">${escapeHtml(task.title?.value || task.name || 'Unnamed Task')}</div>
            ${task.description?.value ? `<div style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 4px;">${escapeHtml(task.description.value)}</div>` : ''}
          </div>
        </div>
        
        ${hasWaypoint ? `
          <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-color);">
            <span style="color: var(--text-secondary);">📍 Waypoint:</span>
            <span>${escapeHtml(task.waypoint.planet)} (${task.waypoint.x}, ${task.waypoint.y}, ${task.waypoint.z})</span>
            ${task.waypoint.name ? `- <em>${escapeHtml(task.waypoint.name)}</em>` : ''}
          </div>
        ` : ''}
        
        ${task.timer ? `
          <div style="margin-top: 4px; color: var(--text-secondary);">
            <span>⏱️ Timer: ${task.timer} seconds</span>
          </div>
        ` : ''}
        
        ${task.grantQuestOnComplete ? `
          <div style="margin-top: 4px; color: var(--text-secondary);">
            <span>➡️ Grants: <a href="#" onclick="openQuestModal('${escapeHtml(task.grantQuestOnComplete)}'); return false;">${escapeHtml(task.grantQuestOnComplete)}</a></span>
          </div>
        ` : ''}
        
        ${task.waves && task.waves.length > 0 ? `
          <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-color);">
            <strong style="font-size: 0.85rem;">Combat Waves:</strong>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 4px; margin-top: 4px;">
              ${task.waves.map(wave => `
                <div style="background: var(--bg-secondary); padding: 4px 8px; border-radius: 4px; font-size: 0.8rem;">
                  Wave ${wave.wave}: ${escapeHtml(wave.primaryTarget)}${wave.numGuards > 0 ? ` (+${wave.numGuards} guards)` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
        
        ${task.subTasks && task.subTasks.length > 0 ? `
          <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-color);">
            <strong style="font-size: 0.85rem;">Sub-tasks:</strong>
            <ul style="margin: 4px 0 0 20px; font-size: 0.85rem;">
              ${task.subTasks.map(st => `<li>${escapeHtml(st.taskName)} (${escapeHtml(st.questName)})</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  return `
    <div class="quest-section">
      <h4 style="margin: 0 0 8px 0; color: var(--text-secondary);">📋 Tasks (${visibleTasks.length} visible / ${tasks.length} total)</h4>
      <div class="tasks-list">
        ${taskItems}
      </div>
    </div>
  `;
}

// ===== City Lookup =====
let allCitiesData = [];

async function loadCities() {
  const container = document.getElementById('cityResults');
  container.innerHTML = '<p style="text-align: center; padding: 20px; color: var(--text-secondary);"><span class="spinner"></span> Loading cities from Oracle...</p>';

  try {
    const result = await apiGet('/cities');
    allCitiesData = result.data || [];
    renderCityTable(allCitiesData);
  } catch (error) {
    container.innerHTML = `<p style="color: var(--accent-danger); padding: 16px;">Failed to load cities: ${escapeHtml(error.message)}</p>`;
  }
}

function filterCityTable(query) {
  if (!query || !query.trim()) {
    renderCityTable(allCitiesData);
    return;
  }
  const q = query.toLowerCase();
  const filtered = allCitiesData.filter(c =>
    (c.name && c.name.toLowerCase().includes(q)) ||
    (c.planet && c.planet.toLowerCase().includes(q)) ||
    (c.mayorName && c.mayorName.toLowerCase().includes(q))
  );
  renderCityTable(filtered);
}

function renderCityTable(cities) {
  const container = document.getElementById('cityResults');

  if (cities.length === 0) {
    container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">No cities found</p>';
    return;
  }

  container.innerHTML = `
    <div class="table-container">
      <table class="data-table">
        <thead>
          <tr>
            <th>City Name</th>
            <th>Planet</th>
            <th>Mayor</th>
            <th>Coordinates</th>
            <th>Radius</th>
            <th>Taxes (I/P/S)</th>
          </tr>
        </thead>
        <tbody>
          ${cities.map(city => `
            <tr style="cursor: default;">
              <td style="font-weight: 600;">${escapeHtml(city.name)}</td>
              <td>${escapeHtml(city.planet)}</td>
              <td>${escapeHtml(city.mayorName)}</td>
              <td style="font-family: var(--font-mono); font-size: 0.8rem;">${Math.round(city.x)}, ${Math.round(city.z)}</td>
              <td>${city.radius}m</td>
              <td style="font-family: var(--font-mono); font-size: 0.8rem;">${city.incomeTax}% / ${city.propertyTax}% / ${city.salesTax}%</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <p style="color: var(--text-secondary); font-size: 0.8rem; padding: 8px 0;">${cities.length} cities total</p>
  `;
}

// ===== Player Lookup =====

// Cache of objvar key mappings for display (loaded from admin settings)
let _objvarMappingsCache = null;

async function _getObjvarMappings() {
  if (_objvarMappingsCache) return _objvarMappingsCache;
  try {
    const result = await apiGet('/admin/objvar-mappings');
    const rows = result.data || [];
    const map = {};
    for (const row of rows) {
      map[row.objvar_name] = row.display_label;
    }
    _objvarMappingsCache = map;
    return map;
  } catch (_) {
    return {};
  }
}

function _resolveObjvarLabel(name, mappings) {
  if (mappings && mappings[name]) return mappings[name];
  // Auto-humanize: take last segment after ".", title-case
  const segments = name.split('.');
  const last = segments[segments.length - 1];
  return last.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^\s+/, '').replace(/\b\w/g, l => l.toUpperCase());
}

// Track last opened player for admin modal
let _lastPlayerDetail = null;

async function searchPlayers() {
  const input = document.getElementById('playerSearchInput');
  const query = input ? input.value.trim() : '';
  const container = document.getElementById('playerSearchResults');

  if (query.length < 2) {
    container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">Enter at least 2 characters to search</p>';
    return;
  }

  container.innerHTML = '<p style="text-align: center; padding: 20px; color: var(--text-secondary);"><span class="spinner"></span> Searching...</p>';

  try {
    const result = await apiGet(`/players/search?q=${encodeURIComponent(query)}`);
    const players = result.data || [];

    if (players.length === 0) {
      container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">No players found</p>';
      return;
    }

    container.innerHTML = `
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Planet</th>
              <th>Coordinates</th>
              <th>Credits (Cash/Bank)</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${players.map(p => `
              <tr>
                <td style="font-weight: 600;">${escapeHtml(p.name)}</td>
                <td>${escapeHtml(p.planet)}</td>
                <td style="font-family: var(--font-mono); font-size: 0.8rem;">${Math.round(p.x)}, ${Math.round(p.z)}</td>
                <td style="font-family: var(--font-mono); font-size: 0.8rem;">${(p.cash || 0).toLocaleString()} / ${(p.bank || 0).toLocaleString()}</td>
                <td style="display: flex; gap: 4px; align-items: center;">
                  <button class="btn btn-sm" onclick="openPlayerDetail('${p.characterObjectId}', '${escapeHtml(p.name)}')">Details</button>
                  ${isAdmin ? `<button class="btn-admin-action" onclick="openAdminCharModal('${p.characterObjectId}', '${escapeHtml(p.name)}', '${p.stationId || ''}')">ADMIN</button>` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <p style="color: var(--text-secondary); font-size: 0.8rem; padding: 8px 0;">${players.length} results</p>
    `;
  } catch (error) {
    container.innerHTML = `<p style="color: var(--accent-danger); padding: 16px;">Search failed: ${escapeHtml(error.message)}</p>`;
  }
}

async function loadProfileView() {
  const container = document.getElementById('profileCharactersList');
  if (!container) return;
  container.innerHTML = '<p style="text-align: center; padding: 20px; color: var(--text-secondary);"><span class="spinner"></span> Loading your characters...</p>';

  try {
    const result = await apiGet('/players/my-characters');
    const players = result.data || [];

    if (players.length === 0) {
      container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">No characters found for your account.</p>';
      return;
    }

    container.innerHTML = `
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Planet</th>
              <th>Coordinates</th>
              <th>Credits (Cash/Bank)</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${players.map(p => `
              <tr>
                <td style="font-weight: 600;">${escapeHtml(p.name)}</td>
                <td>${escapeHtml(p.planet)}</td>
                <td style="font-family: var(--font-mono); font-size: 0.8rem;">${Math.round(p.x)}, ${Math.round(p.z)}</td>
                <td style="font-family: var(--font-mono); font-size: 0.8rem;">${(p.cash || 0).toLocaleString()} / ${(p.bank || 0).toLocaleString()}</td>
                <td style="display: flex; gap: 4px; align-items: center;">
                  <button class="btn btn-sm" onclick="openPlayerDetail('${p.characterObjectId}', '${escapeHtml(p.name)}')">Details</button>
                  ${isAdmin ? `<button class="btn-admin-action" onclick="openAdminCharModal('${p.characterObjectId}', '${escapeHtml(p.name)}', '${p.stationId || ''}')">ADMIN</button>` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <p style="color: var(--text-secondary); font-size: 0.8rem; padding: 8px 0;">${players.length} character(s)</p>
    `;
  } catch (error) {
    const status = error.message && error.message.includes('401') ? 'Please log in again.' : (error.message || 'Failed to load characters.');
    container.innerHTML = `<p style="color: var(--accent-danger); padding: 16px;">${escapeHtml(status)}</p>`;
  }
}

async function openPlayerDetail(charId, name) {
  const modal = document.getElementById('playerDetailModal');
  const nameEl = document.getElementById('playerDetailName');
  const body = document.getElementById('playerDetailBody');

  nameEl.textContent = name || 'Player Details';
  body.innerHTML = '<div style="text-align: center; padding: 20px;"><span class="spinner"></span> Loading player data...</div>';
  modal.style.display = 'flex';

  // Build parallel fetch list: details + inventory + objvars (if admin)
  const fetches = [
    apiGet(`/players/${charId}`),
    apiGet(`/players/${charId}/inventory`),
  ];
  if (isAdmin) {
    fetches.push(apiGet(`/players/${charId}/objvars`));
    fetches.push(_getObjvarMappings());
  }

  try {
    const results = await Promise.all(fetches);
    const detailResult = results[0];
    const inventoryResult = results[1];
    const objvarResult = isAdmin ? results[2] : null;
    const mappings = isAdmin ? results[3] : {};

    const player = detailResult.data;
    const inventory = inventoryResult.data || [];
    const totalItems = inventoryResult.totalItems || 0;
    const objvars = objvarResult?.data || [];

    // Cache player for admin modal
    _lastPlayerDetail = player;

    let html = '';

    // ---- Collapsible: Character Info ----
    if (player) {
      html += `
        <div class="card" style="margin-bottom: 16px;">
          <div class="collapsible-header" onclick="toggleCollapsible(this)">
            <h2 style="font-size: 1rem;">Character Info</h2>
            <span class="collapsible-toggle">&#9660;</span>
          </div>
          <div class="collapsible-body">
            <div class="card-body" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.85rem; padding-top: 0;">
              <div><strong>Name:</strong> ${escapeHtml(player.name)}</div>
              <div><strong>Station ID:</strong> ${player.stationId || '-'}</div>
              <div><strong>Planet:</strong> ${escapeHtml(player.planet)}</div>
              <div><strong>Coordinates:</strong> <span style="font-family: var(--font-mono);">${Math.round(player.x)}, ${Math.round(player.y)}, ${Math.round(player.z)}</span></div>
              <div><strong>Cash:</strong> ${(player.cash || 0).toLocaleString()}</div>
              <div><strong>Bank:</strong> ${(player.bank || 0).toLocaleString()}</div>
              ${player.templateId ? `<div><strong>Template ID:</strong> ${player.templateId}</div>` : ''}
            </div>
          </div>
        </div>
      `;
    }

    // ---- Collapsible: Inventory tree ----
    html += `
      <div class="card" style="margin-bottom: 16px;">
        <div class="collapsible-header" onclick="toggleCollapsible(this)">
          <h2 style="font-size: 1rem;">Inventory</h2>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="color: var(--text-secondary); font-size: 0.8rem;">${totalItems} objects</span>
            <span class="collapsible-toggle">&#9660;</span>
          </div>
        </div>
        <div class="collapsible-body">
          <div class="card-body" style="max-height: 400px; overflow-y: auto; padding: 8px;">
            ${inventory.length > 0 ? renderInventoryTree(inventory, 0) : '<p style="color: var(--text-secondary);">No inventory items found</p>'}
          </div>
        </div>
      </div>
    `;

    // ---- Collapsible: Object Information (objvars, admin only) ----
    if (isAdmin && objvars.length > 0) {
      html += `
        <div class="card" style="margin-bottom: 16px;">
          <div class="collapsible-header" onclick="toggleCollapsible(this)">
            <h2 style="font-size: 1rem;">Object Information</h2>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="color: var(--text-secondary); font-size: 0.8rem;">${objvars.length} variables</span>
              <span class="collapsible-toggle">&#9660;</span>
            </div>
          </div>
          <div class="collapsible-body">
            <div class="card-body" style="max-height: 400px; overflow-y: auto; padding: 0;">
              <table class="objvar-table">
                <thead>
                  <tr>
                    <th>Variable Name</th>
                    <th>Label</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  ${objvars.map(ov => `
                    <tr>
                      <td>${escapeHtml(ov.name)}</td>
                      <td>${escapeHtml(_resolveObjvarLabel(ov.name, mappings))}</td>
                      <td>${escapeHtml(ov.value)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    body.innerHTML = html;
  } catch (error) {
    body.innerHTML = `<p style="color: var(--accent-danger); padding: 16px;">Failed to load player data: ${escapeHtml(error.message)}</p>`;
  }
}

function toggleCollapsible(headerEl) {
  const body = headerEl.nextElementSibling;
  const toggle = headerEl.querySelector('.collapsible-toggle');
  if (body.classList.contains('collapsed')) {
    body.classList.remove('collapsed');
    if (toggle) toggle.classList.remove('collapsed');
  } else {
    body.classList.add('collapsed');
    if (toggle) toggle.classList.add('collapsed');
  }
}

function renderInventoryTree(items, depth) {
  if (!items || items.length === 0) return '';

  return items.map(item => {
    const indent = depth * 16;
    const hasChildren = item.children && item.children.length > 0;
    const icon = hasChildren ? '&#128230;' : '&#128196;';
    const childrenHtml = hasChildren ? renderInventoryTree(item.children, depth + 1) : '';
    const nameDisplay = item.name || 'Unknown Object';
    const idDisplay = item.objectId ? ` <span style="color: var(--text-muted); font-size: 0.7rem; font-family: var(--font-mono);">#${item.objectId}</span>` : '';

    return `
      <div style="padding: 3px 0;">
        <div style="padding-left: ${indent}px; display: flex; align-items: center; gap: 4px; font-size: 0.82rem; ${hasChildren ? 'font-weight: 600;' : ''}">
          <span>${icon}</span>
          <span>${escapeHtml(nameDisplay)}</span>
          ${idDisplay}
          ${hasChildren ? `<span style="color: var(--text-muted); font-size: 0.7rem;">(${item.children.length})</span>` : ''}
        </div>
        ${childrenHtml}
      </div>
    `;
  }).join('');
}

function closePlayerModal() {
  document.getElementById('playerDetailModal').style.display = 'none';
}

// ===== Admin Character Actions Modal =====

function openAdminCharModal(charId, name, stationId) {
  const modal = document.getElementById('adminCharModal');
  const nameEl = document.getElementById('adminCharModalName');
  const body = document.getElementById('adminCharModalBody');

  nameEl.textContent = name || 'Character';
  modal.style.display = 'flex';

  body.innerHTML = `
    <!-- Rename -->
    <div class="admin-action-group">
      <h3>Rename Character</h3>
      <div class="admin-action-row">
        <div class="field-group" style="flex: 1;">
          <label>New Name</label>
          <input type="text" id="adminRenameInput" placeholder="Enter new name" value="${escapeHtml(name)}">
        </div>
        <button class="btn btn-primary btn-sm" onclick="adminDoRename('${charId}')">Rename</button>
      </div>
    </div>

    <!-- Move -->
    <div class="admin-action-group">
      <h3>Move Character</h3>
      <div class="admin-action-row">
        <div class="field-group">
          <label>Planet</label>
          <select id="adminMovePlanet">
            <option value="tatooine">Tatooine</option>
            <option value="naboo">Naboo</option>
            <option value="corellia">Corellia</option>
            <option value="rori">Rori</option>
            <option value="talus">Talus</option>
            <option value="yavin4">Yavin IV</option>
            <option value="endor">Endor</option>
            <option value="lok">Lok</option>
            <option value="dantooine">Dantooine</option>
            <option value="dathomir">Dathomir</option>
            <option value="kashyyyk">Kashyyyk</option>
            <option value="mustafar">Mustafar</option>
          </select>
        </div>
        <div class="field-group" style="flex: 0 0 80px;">
          <label>X</label>
          <input type="number" id="adminMoveX" placeholder="0" value="0">
        </div>
        <div class="field-group" style="flex: 0 0 80px;">
          <label>Y</label>
          <input type="number" id="adminMoveY" placeholder="0" value="0">
        </div>
        <div class="field-group" style="flex: 0 0 80px;">
          <label>Z</label>
          <input type="number" id="adminMoveZ" placeholder="0" value="0">
        </div>
        <button class="btn btn-primary btn-sm" onclick="adminDoMove('${charId}')">Move</button>
      </div>
    </div>

    <!-- Change Race -->
    <div class="admin-action-group">
      <h3>Change Race</h3>
      <div class="admin-action-row">
        <div class="field-group" style="flex: 1;">
          <label>Template ID</label>
          <input type="number" id="adminRaceTemplate" placeholder="Template ID">
        </div>
        <button class="btn btn-primary btn-sm" onclick="adminDoRace('${charId}')">Change</button>
      </div>
    </div>

    <!-- Lock Account -->
    <div class="admin-action-group admin-action-group--danger">
      <h3>Lock / Unlock Account</h3>
      <p style="font-size: 0.8rem; color: var(--text-secondary); margin: 0 0 10px 0;">
        Station ID: <strong style="font-family: var(--font-mono);">${escapeHtml(stationId || 'unknown')}</strong>
      </p>
      <div class="admin-action-row">
        <button class="btn btn-sm" style="background: var(--accent-danger); color: #fff;" onclick="adminDoLock('${charId}', '${stationId}', true)">Lock Account</button>
        <button class="btn btn-sm" onclick="adminDoLock('${charId}', '${stationId}', false)">Unlock Account</button>
      </div>
    </div>
  `;
}

function closeAdminCharModal() {
  document.getElementById('adminCharModal').style.display = 'none';
}

async function adminDoRename(charId) {
  const input = document.getElementById('adminRenameInput');
  const newName = input?.value?.trim();
  if (!newName) { showToast('Name cannot be empty', 'warning'); return; }

  try {
    const result = await apiPost(`/players/${charId}/rename`, { newName });
    if (result.success) {
      showToast(result.message || 'Character renamed', 'success');
    } else {
      showToast(result.error || 'Rename failed', 'error');
    }
  } catch (error) {
    showToast('Rename failed: ' + error.message, 'error');
  }
}

async function adminDoMove(charId) {
  const planet = document.getElementById('adminMovePlanet')?.value;
  const x = parseFloat(document.getElementById('adminMoveX')?.value) || 0;
  const y = parseFloat(document.getElementById('adminMoveY')?.value) || 0;
  const z = parseFloat(document.getElementById('adminMoveZ')?.value) || 0;

  try {
    const result = await apiPost(`/players/${charId}/move`, { planet, x, y, z });
    if (result.success) {
      showToast(result.message || 'Character moved', 'success');
    } else {
      showToast(result.error || 'Move failed', 'error');
    }
  } catch (error) {
    showToast('Move failed: ' + error.message, 'error');
  }
}

async function adminDoRace(charId) {
  const templateId = parseInt(document.getElementById('adminRaceTemplate')?.value);
  if (isNaN(templateId)) { showToast('Template ID must be a number', 'warning'); return; }

  try {
    const result = await apiPost(`/players/${charId}/race`, { templateId });
    if (result.success) {
      showToast(result.message || 'Race changed', 'success');
    } else {
      showToast(result.error || 'Race change failed', 'error');
    }
  } catch (error) {
    showToast('Race change failed: ' + error.message, 'error');
  }
}

async function adminDoLock(charId, stationId, locked) {
  if (!stationId || stationId === 'unknown') {
    showToast('Cannot determine station ID for this character', 'error');
    return;
  }

  const action = locked ? 'lock' : 'unlock';
  if (!confirm(`Are you sure you want to ${action} this account (Station ID: ${stationId})?`)) return;

  try {
    const result = await apiPost(`/players/${charId}/lock`, { locked, stationId });
    if (result.success) {
      showToast(result.message || `Account ${action}ed`, 'success');
    } else {
      showToast(result.error || `${action} failed`, 'error');
    }
  } catch (error) {
    showToast(`Account ${action} failed: ` + error.message, 'error');
  }
}

// ===== Objvar Key Mappings (Admin Panel) =====

async function loadObjvarMappings() {
  const container = document.getElementById('objvarMappingsList');
  if (!container) return;
  container.innerHTML = '<div class="loading"><span class="spinner"></span> Loading...</div>';

  try {
    const result = await apiGet('/admin/objvar-mappings');
    const rows = result.data || [];

    // Invalidate client cache so next player detail load picks up changes
    _objvarMappingsCache = null;

    if (rows.length === 0) {
      container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 12px; font-size: 0.85rem;">No mappings defined yet</p>';
      return;
    }

    container.innerHTML = `
      <div class="mapping-row" style="font-weight: 700; background: var(--bg-tertiary); position: sticky; top: 0;">
        <span class="mapping-name" style="color: var(--text-secondary);">Objvar Name</span>
        <span class="mapping-label" style="color: var(--text-secondary);">Display Label</span>
        <span class="mapping-category">Category</span>
        <span style="flex: 0 0 42px;"></span>
      </div>
      ${rows.map(row => `
        <div class="mapping-row">
          <span class="mapping-name">${escapeHtml(row.objvar_name)}</span>
          <span class="mapping-label">${escapeHtml(row.display_label)}</span>
          <span class="mapping-category">${escapeHtml(row.category || 'General')}</span>
          <button class="mapping-delete" onclick="deleteObjvarMapping(${row.id})" title="Delete">&times;</button>
        </div>
      `).join('')}
    `;
  } catch (error) {
    container.innerHTML = `<p style="color: var(--accent-danger); padding: 12px; font-size: 0.85rem;">Failed to load: ${escapeHtml(error.message)}</p>`;
  }
}

async function addObjvarMapping() {
  const nameInput = document.getElementById('objvarMapName');
  const labelInput = document.getElementById('objvarMapLabel');
  const catInput = document.getElementById('objvarMapCategory');

  const objvarName = nameInput?.value?.trim();
  const displayLabel = labelInput?.value?.trim();
  const category = catInput?.value?.trim() || 'General';

  if (!objvarName || !displayLabel) {
    showToast('Both objvar name and display label are required', 'warning');
    return;
  }

  try {
    const result = await apiPost('/admin/objvar-mappings', { objvarName, displayLabel, category });
    if (result.success) {
      showToast(result.message || 'Mapping saved', 'success');
      nameInput.value = '';
      labelInput.value = '';
      loadObjvarMappings();
    } else {
      showToast(result.error || 'Failed to save mapping', 'error');
    }
  } catch (error) {
    showToast('Failed to save mapping: ' + error.message, 'error');
  }
}

async function deleteObjvarMapping(id) {
  if (!confirm('Delete this mapping?')) return;

  try {
    const result = await apiDelete(`/admin/objvar-mappings/${id}`);
    if (result.success) {
      showToast('Mapping deleted', 'success');
      loadObjvarMappings();
    } else {
      showToast(result.error || 'Failed to delete mapping', 'error');
    }
  } catch (error) {
    showToast('Failed to delete: ' + error.message, 'error');
  }
}

// ===== LOCATION_SCENE to Planet Mapping (Admin) =====

async function loadLocationSceneMappings() {
  const container = document.getElementById('locationSceneMappingsList');
  if (!container) return;
  container.innerHTML = '<div class="loading"><span class="spinner"></span> Loading...</div>';

  try {
    const result = await apiGet('/admin/location-scene-mappings');
    const rows = result.data || [];
    const planets = result.planets || [];

    const select = document.getElementById('locationScenePlanetSelect');
    if (select && planets.length > 0) {
      select.innerHTML = planets.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    }

    if (rows.length === 0) {
      container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 12px; font-size: 0.85rem;">No mappings. Add LOCATION_SCENE (int) and planet.</p>';
      return;
    }

    container.innerHTML = `
      <div class="mapping-row" style="font-weight: 700; background: var(--bg-tertiary); position: sticky; top: 0;">
        <span class="mapping-name" style="color: var(--text-secondary);">LOCATION_SCENE</span>
        <span class="mapping-label" style="color: var(--text-secondary);">Planet</span>
        <span style="flex: 0 0 42px;"></span>
      </div>
      ${rows.map(row => `
        <div class="mapping-row">
          <span class="mapping-name">${escapeHtml(String(row.location_scene))}</span>
          <span class="mapping-label">${escapeHtml(row.planet)}</span>
          <button class="mapping-delete" onclick="deleteLocationSceneMapping(${row.id})" title="Delete">&times;</button>
        </div>
      `).join('')}
    `;
  } catch (error) {
    container.innerHTML = `<p style="color: var(--accent-danger); padding: 12px; font-size: 0.85rem;">Failed: ${escapeHtml(error.message)}</p>`;
  }
}

async function addLocationSceneMapping() {
  const input = document.getElementById('locationSceneInput');
  const select = document.getElementById('locationScenePlanetSelect');
  const locationScene = input?.value?.trim();
  const planet = select?.value?.trim();

  if (!locationScene || locationScene === '') {
    showToast('LOCATION_SCENE is required', 'warning');
    return;
  }
  const sceneNum = parseInt(locationScene, 10);
  if (isNaN(sceneNum)) {
    showToast('LOCATION_SCENE must be a number', 'warning');
    return;
  }
  if (!planet) {
    showToast('Planet is required', 'warning');
    return;
  }

  try {
    const result = await apiPost('/admin/location-scene-mappings', { locationScene: sceneNum, planet });
    if (result.success) {
      showToast(result.message || 'Mapping saved', 'success');
      input.value = '';
      loadLocationSceneMappings();
    } else {
      showToast(result.error || 'Failed to save mapping', 'error');
    }
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

async function deleteLocationSceneMapping(idOrScene) {
  if (!confirm('Delete this LOCATION_SCENE mapping?')) return;
  try {
    const result = await apiDelete(`/admin/location-scene-mappings/${idOrScene}`);
    if (result.success) {
      showToast('Mapping deleted', 'success');
      loadLocationSceneMappings();
    } else {
      showToast(result.error || 'Failed to delete', 'error');
    }
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

// Periodic health check
setInterval(checkHealth, 30000);

