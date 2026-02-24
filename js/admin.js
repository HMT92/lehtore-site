'use strict';

/* ============================================================
   LEHTORE — Admin Panel
   Loads photos.json from GitHub, lets you edit metadata,
   and publishes changes back via the GitHub Contents API.

   Auth: GitHub Personal Access Token (stored in localStorage)
   Required scope: public_repo (for public repos)
   ============================================================ */

const STORAGE_KEY = 'lehtore-admin-config';
const CATEGORIES  = ['Architecture', 'Travel', 'Nature', 'Street', 'People', 'Other'];

/* ── State ────────────────────────────────────────────────── */
const state = {
  config:    null,   // { owner, repo, branch, token }
  photos:    [],     // current photos.json content
  dirty:     {},     // { [id]: modified photo object }
  sha:       null,   // GitHub file SHA (required for PUT)
  selected:  null,   // currently selected photo id
};

/* ── Init ─────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      state.config = JSON.parse(saved);
      startAdmin();
    } catch {
      showSetup();
    }
  } else {
    showSetup();
  }
});

/* ── Setup Modal ──────────────────────────────────────────── */
function showSetup() {
  document.getElementById('setup-modal').style.display = 'flex';
}

function hideSetup() {
  document.getElementById('setup-modal').style.display = 'none';
}

document.getElementById('setup-form').addEventListener('submit', e => {
  e.preventDefault();
  const owner  = document.getElementById('cfg-owner').value.trim();
  const repo   = document.getElementById('cfg-repo').value.trim();
  const branch = document.getElementById('cfg-branch').value.trim() || 'main';
  const token  = document.getElementById('cfg-token').value.trim();

  if (!owner || !repo || !token) return;

  state.config = { owner, repo, branch, token };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
  hideSetup();
  startAdmin();
});

document.getElementById('sign-out')?.addEventListener('click', () => {
  if (!confirm('Remove saved credentials and sign out?')) return;
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});

/* ── Load from GitHub ─────────────────────────────────────── */
async function startAdmin() {
  showLoading(true);
  try {
    const { content, sha } = await ghGetFile('photos.json');
    state.sha    = sha;
    state.photos = JSON.parse(content).photos || [];
    state.dirty  = {};
    renderGrid();
    updatePublishBtn();
  } catch (err) {
    showToast('Failed to load photos: ' + err.message, 'error');
    console.error(err);
  } finally {
    showLoading(false);
  }
}

async function ghGetFile(path) {
  const { owner, repo, branch, token } = state.config;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });
  if (!res.ok) {
    const msg = await res.json().then(d => d.message).catch(() => res.statusText);
    throw new Error(`GitHub API: ${msg}`);
  }
  const data = await res.json();
  const content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
  return { content, sha: data.sha };
}

/* ── Publish to GitHub ────────────────────────────────────── */
async function publishToGitHub() {
  if (Object.keys(state.dirty).length === 0) {
    showToast('No unsaved changes.', '');
    return;
  }

  const btn = document.getElementById('publish-btn');
  btn.disabled = true;
  btn.textContent = 'Publishing…';

  // Merge dirty changes into photos array
  const merged = state.photos.map(p => state.dirty[p.id] ? state.dirty[p.id] : p);
  const json   = JSON.stringify({ photos: merged }, null, 2);
  const b64    = btoa(unescape(encodeURIComponent(json)));

  try {
    const { owner, repo, branch, token } = state.config;
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/photos.json`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Update photo metadata via admin panel',
        content: b64,
        sha: state.sha,
        branch,
      }),
    });

    if (!res.ok) {
      const msg = await res.json().then(d => d.message).catch(() => res.statusText);
      throw new Error(msg);
    }

    const data   = await res.json();
    state.sha    = data.content.sha;
    state.photos = merged;
    state.dirty  = {};

    // Mark all cards saved
    document.querySelectorAll('.admin-card-status').forEach(d => {
      d.classList.remove('dirty');
      d.classList.add('saved');
    });
    updatePublishBtn();
    showToast('Published! Site will update in ~1 minute.', 'success');
  } catch (err) {
    showToast('Publish failed: ' + err.message, 'error');
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Publish to GitHub';
  }
}

document.getElementById('publish-btn')?.addEventListener('click', publishToGitHub);
document.getElementById('refresh-btn')?.addEventListener('click', startAdmin);

/* ── Grid ─────────────────────────────────────────────────── */
function renderGrid() {
  const grid = document.getElementById('admin-grid');
  if (!grid) return;

  grid.innerHTML = state.photos.map(photo => {
    const thumb = photo.thumb || photo.src || '';
    const title = photo.title || 'Untitled';
    return `
<div class="admin-card" data-id="${photo.id}" title="${esc(title)}">
  <img src="${esc(thumb)}" alt="${esc(title)}" loading="lazy">
  <div class="admin-card-title">${esc(title)}</div>
  <div class="admin-card-status" id="status-${photo.id}"></div>
</div>`;
  }).join('');

  grid.querySelectorAll('.admin-card').forEach(card => {
    card.addEventListener('click', () => selectPhoto(card.dataset.id));
  });

  // Auto-select first
  if (state.photos.length > 0) {
    const firstId = state.photos[0].id;
    if (!state.selected) selectPhoto(firstId);
  }
}

function selectPhoto(id) {
  state.selected = id;
  document.querySelectorAll('.admin-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.id === id);
  });
  renderEditPanel(id);
}

/* ── Edit Panel ───────────────────────────────────────────── */
function renderEditPanel(id) {
  const photo = getPhoto(id);
  if (!photo) return;

  const panel = document.getElementById('edit-panel');
  const thumb = photo.thumb || photo.src || '';

  panel.innerHTML = `
<img class="edit-preview" src="${esc(thumb)}" alt="${esc(photo.title || '')}">

<div>
  <div class="edit-section-title">Basic Info</div>
  <div class="form-group">
    <label class="form-label" for="ef-title">Title</label>
    <input class="form-input" id="ef-title" type="text" value="${esc(photo.title || '')}" placeholder="Untitled">
  </div>
  <div class="form-group">
    <label class="form-label" for="ef-location">Location</label>
    <input class="form-input" id="ef-location" type="text" value="${esc(photo.location || '')}" placeholder="City, Country">
  </div>
  <div class="form-group">
    <label class="form-label" for="ef-date">Date</label>
    <input class="form-input" id="ef-date" type="date" value="${photo.date || ''}">
  </div>
  <div class="form-group">
    <label class="form-label" for="ef-desc">Description</label>
    <textarea class="form-textarea" id="ef-desc" placeholder="Optional caption…">${esc(photo.description || '')}</textarea>
  </div>
</div>

<div>
  <div class="edit-section-title">Classification</div>
  <div class="form-group">
    <label class="form-label" for="ef-category">Category</label>
    <select class="form-select" id="ef-category">
      ${CATEGORIES.map(c =>
        `<option value="${c}"${c === photo.category ? ' selected' : ''}>${c}</option>`
      ).join('')}
    </select>
  </div>
  <div class="form-group">
    <label class="form-label">Tags</label>
    <div class="tag-chips" id="tag-chips">
      ${(photo.tags || []).map(t => tagChipHTML(t)).join('')}
    </div>
    <div style="display:flex;gap:6px;margin-top:4px;">
      <input class="form-input" id="ef-tag-input" type="text" placeholder="Add tag…" style="flex:1">
      <button class="btn btn-secondary" id="ef-tag-add" type="button">Add</button>
    </div>
  </div>
</div>

<div>
  <div class="edit-section-title">Options</div>
  <div class="toggle-row">
    <span class="toggle-label">Featured (pinned to top)</span>
    <label class="toggle-switch">
      <input type="checkbox" id="ef-featured"${photo.featured ? ' checked' : ''}>
      <span class="toggle-track"></span>
    </label>
  </div>
</div>

<div style="display:flex;gap:8px;padding-top:8px;">
  <button class="btn btn-primary" id="ef-save">Save Changes</button>
  <button class="btn btn-secondary" id="ef-reset">Reset</button>
</div>
`;

  // Tag add
  const tagInput = document.getElementById('ef-tag-input');
  document.getElementById('ef-tag-add').addEventListener('click', () => addTag(tagInput.value));
  tagInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput.value); }
  });

  // Tag remove (delegated)
  document.getElementById('tag-chips').addEventListener('click', e => {
    const rm = e.target.closest('.tag-chip-remove');
    if (rm) removeTag(rm.dataset.tag);
  });

  // Save / Reset
  document.getElementById('ef-save').addEventListener('click', () => savePhoto(id));
  document.getElementById('ef-reset').addEventListener('click', () => {
    delete state.dirty[id];
    renderEditPanel(id);
    markCard(id, false);
    updatePublishBtn();
  });
}

function tagChipHTML(tag) {
  return `<span class="tag-chip">${esc(tag)}<span class="tag-chip-remove" data-tag="${esc(tag)}" title="Remove">&times;</span></span>`;
}

function addTag(raw) {
  const tag = raw.trim().toLowerCase().replace(/\s+/g, '-');
  if (!tag) return;
  const photo = getPhoto(state.selected);
  const tags  = [...new Set([...(photo.tags || []), tag])];
  applyDraft({ tags });
  const chips = document.getElementById('tag-chips');
  if (chips) chips.innerHTML = tags.map(tagChipHTML).join('');
  const input = document.getElementById('ef-tag-input');
  if (input) input.value = '';
}

function removeTag(tag) {
  const photo = getPhoto(state.selected);
  const tags  = (photo.tags || []).filter(t => t !== tag);
  applyDraft({ tags });
  const chips = document.getElementById('tag-chips');
  if (chips) chips.innerHTML = tags.map(tagChipHTML).join('');
}

function savePhoto(id) {
  const read = sel => document.getElementById(sel)?.value;
  const draft = {
    title:       read('ef-title'),
    location:    read('ef-location'),
    date:        read('ef-date'),
    description: read('ef-desc'),
    category:    read('ef-category'),
    featured:    document.getElementById('ef-featured')?.checked ?? false,
    // tags already tracked via applyDraft
  };
  applyDraft(draft);
  const saved = state.dirty[id];
  // Update card title in grid
  const cardTitle = document.querySelector(`.admin-card[data-id="${id}"] .admin-card-title`);
  if (cardTitle) cardTitle.textContent = saved.title || 'Untitled';
  markCard(id, true);
  updatePublishBtn();
  showToast('Saved locally. Click "Publish to GitHub" when ready.', '');
}

/* ── Helpers ──────────────────────────────────────────────── */
function getPhoto(id) {
  return state.dirty[id] || state.photos.find(p => p.id === id) || null;
}

function applyDraft(partial) {
  const id    = state.selected;
  const base  = state.dirty[id] || state.photos.find(p => p.id === id) || {};
  state.dirty[id] = { ...base, ...partial };
}

function markCard(id, dirty) {
  const dot = document.getElementById(`status-${id}`);
  if (!dot) return;
  dot.classList.toggle('dirty', dirty);
  dot.classList.remove('saved');
}

function updatePublishBtn() {
  const count = Object.keys(state.dirty).length;
  const badge = document.getElementById('dirty-count');
  const btn   = document.getElementById('publish-btn');
  if (badge) badge.textContent = count > 0 ? `${count} unsaved` : '';
  if (badge) badge.style.display = count > 0 ? '' : 'none';
  if (btn)   btn.disabled = count === 0;
}

function showLoading(on) {
  const el = document.getElementById('admin-loading');
  if (el) el.style.display = on ? 'flex' : 'none';
}

function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `show ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.className = ''; }, 3500);
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
