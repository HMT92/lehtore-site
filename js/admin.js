'use strict';

/* ============================================================
   LEHTORE — Admin Panel
   - Load / edit / publish photos.json via GitHub Contents API
   - Upload new photos directly (triggers GitHub Action)
   - Delete photos (removes from JSON + deletes files from repo)

   Auth: GitHub Personal Access Token stored in localStorage
   Required scope: public_repo (for public repos)
   ============================================================ */

const STORAGE_KEY = 'lehtore-admin-config';
const CATEGORIES  = ['Architecture', 'Travel', 'Nature', 'Street', 'People', 'Other', 'Uncategorized'];

/* ── State ────────────────────────────────────────────────── */
const state = {
  config:         null,   // { owner, repo, branch, token }
  photos:         [],     // current photos array
  dirty:          {},     // { [id]: modified photo object }
  pendingDeletes: [],     // [ photo objects ] to remove on publish
  sha:            null,   // photos.json SHA for GitHub API
  selected:       null,   // currently selected photo id
  siteConfig:     null,   // site-config.json content
  configSha:      null,   // site-config.json SHA
};

/* ── Init ─────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try { state.config = JSON.parse(saved); startAdmin(); }
    catch { showSetup(); }
  } else {
    showSetup();
  }

  // Upload button → hidden file input
  document.getElementById('upload-btn')?.addEventListener('click', () => {
    document.getElementById('upload-input').click();
  });
  document.getElementById('upload-input')?.addEventListener('change', e => {
    const files = Array.from(e.target.files);
    if (files.length) uploadPhotos(files);
    e.target.value = '';
  });

  // Drag-and-drop on the grid
  const grid = document.getElementById('admin-grid');
  grid?.addEventListener('dragover', e => { e.preventDefault(); grid.classList.add('drag-over'); });
  grid?.addEventListener('dragleave', () => grid.classList.remove('drag-over'));
  grid?.addEventListener('drop', e => {
    e.preventDefault();
    grid.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length) uploadPhotos(files);
  });
});

/* ── Setup Modal ──────────────────────────────────────────── */
function showSetup() { document.getElementById('setup-modal').style.display = 'flex'; }
function hideSetup() { document.getElementById('setup-modal').style.display = 'none'; }

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

/* ── GitHub API helpers ───────────────────────────────────── */
function apiUrl(path) {
  const { owner, repo } = state.config;
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
}
function authHeaders() {
  return {
    Authorization: `token ${state.config.token}`,
    Accept: 'application/vnd.github.v3+json',
  };
}

async function ghGetFile(path) {
  const res = await fetch(`${apiUrl(path)}?ref=${state.config.branch}`, { headers: authHeaders() });
  if (!res.ok) {
    const msg = await res.json().then(d => d.message).catch(() => res.statusText);
    throw new Error(`GitHub: ${msg}`);
  }
  const data    = await res.json();
  const content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
  return { content, sha: data.sha };
}

async function ghPutFile(path, content, sha, message) {
  const b64 = btoa(unescape(encodeURIComponent(content)));
  const body = { message, content: b64, branch: state.config.branch };
  if (sha) body.sha = sha;
  const res = await fetch(apiUrl(path), {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.json().then(d => d.message).catch(() => res.statusText);
    throw new Error(`GitHub: ${msg}`);
  }
  return res.json();
}

async function ghDeleteFile(path, message) {
  // Fetch SHA first
  let sha;
  try {
    const res = await fetch(`${apiUrl(path)}?ref=${state.config.branch}`, { headers: authHeaders() });
    if (!res.ok) return; // file may not exist (e.g. external URL photo)
    const data = await res.json();
    sha = data.sha;
  } catch { return; }

  await fetch(apiUrl(path), {
    method: 'DELETE',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha, branch: state.config.branch }),
  });
}

async function ghUploadBinary(path, arrayBuffer, message) {
  // Convert ArrayBuffer to base64
  const bytes  = new Uint8Array(arrayBuffer);
  let binary   = '';
  const chunk  = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const b64 = btoa(binary);

  const body = { message, content: b64, branch: state.config.branch };
  const res = await fetch(apiUrl(path), {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.json().then(d => d.message).catch(() => res.statusText);
    throw new Error(`GitHub: ${msg}`);
  }
  return res.json();
}

/* ── Load from GitHub ─────────────────────────────────────── */
async function startAdmin() {
  showLoading(true);
  try {
    const { content, sha } = await ghGetFile('photos.json');
    state.sha            = sha;
    state.photos         = JSON.parse(content).photos || [];
    state.dirty          = {};
    state.pendingDeletes = [];
    renderGrid();
    updatePublishBtn();
  } catch (err) {
    showToast('Failed to load: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

/* ── Upload photos ────────────────────────────────────────── */
async function uploadPhotos(files) {
  for (const file of files) {
    showToast(`Uploading ${file.name}…`, '');
    try {
      const buf = await file.arrayBuffer();
      await ghUploadBinary(
        `photos/uploads/${file.name}`,
        buf,
        `Upload ${file.name} via admin panel`
      );
      showToast(`${file.name} uploaded. GitHub Action will process it (~2 min). Click Refresh.`, 'success');
    } catch (err) {
      showToast(`Upload failed: ${err.message}`, 'error');
    }
  }
}

/* ── Delete photo ─────────────────────────────────────────── */
function markForDelete(id) {
  const photo = state.photos.find(p => p.id === id);
  if (!photo) return;
  if (!confirm(`Remove "${photo.title || photo.id}" from the gallery?\n\nThis will also delete the image files from the repository.`)) return;

  state.pendingDeletes.push(photo);
  state.photos = state.photos.filter(p => p.id !== id);
  delete state.dirty[id];
  state.selected = null;

  renderGrid();
  // Show empty edit panel
  document.getElementById('edit-panel').innerHTML = `
    <div class="edit-panel-empty">
      <p style="color:var(--accent);font-size:13px;">Photo marked for deletion.</p>
      <p style="font-size:12px;color:var(--text-faint);">Click <strong>Publish to GitHub</strong> to confirm removal.</p>
    </div>`;
  updatePublishBtn();
}

/* ── Publish to GitHub ────────────────────────────────────── */
document.getElementById('publish-btn')?.addEventListener('click', publishToGitHub);
document.getElementById('refresh-btn')?.addEventListener('click', startAdmin);
document.getElementById('settings-btn')?.addEventListener('click', showSettingsPanel);

async function publishToGitHub() {
  const hasEdits   = Object.keys(state.dirty).length > 0;
  const hasDeletes = state.pendingDeletes.length > 0;
  if (!hasEdits && !hasDeletes) { showToast('No changes to publish.', ''); return; }

  const btn = document.getElementById('publish-btn');
  btn.disabled = true;
  btn.textContent = 'Publishing…';

  try {
    // 1. Delete files for removed photos (non-external URLs only)
    for (const photo of state.pendingDeletes) {
      const isLocal = p => p && !p.startsWith('http');
      if (isLocal(photo.src))   await ghDeleteFile(photo.src,   `Remove ${photo.id} upload`);
      if (isLocal(photo.thumb)) await ghDeleteFile(photo.thumb, `Remove ${photo.id} thumbnail`);
    }

    // 2. Merge edits and save photos.json
    if (hasEdits || hasDeletes) {
      const merged = state.photos.map(p => state.dirty[p.id] ?? p);
      const json   = JSON.stringify({ photos: merged }, null, 2);

      // Re-fetch SHA in case it changed during file deletions
      const { sha } = await ghGetFile('photos.json');
      const result  = await ghPutFile('photos.json', json, sha, 'Update photo metadata via admin panel');

      state.sha            = result.content.sha;
      state.photos         = merged;
      state.dirty          = {};
      state.pendingDeletes = [];
    }

    renderGrid();
    updatePublishBtn();
    showToast('Published! Site updates in ~1 minute.', 'success');
  } catch (err) {
    showToast('Publish failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Publish to GitHub';
  }
}

/* ── Grid ─────────────────────────────────────────────────── */
function renderGrid() {
  const grid = document.getElementById('admin-grid');
  if (!grid) return;

  if (state.photos.length === 0 && state.pendingDeletes.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--text-faint);font-size:13px;">
      No photos yet. Drag images here or click Upload to add photos.
    </div>`;
    return;
  }

  grid.innerHTML = state.photos.map(photo => {
    const thumb   = photo.thumb || photo.src || '';
    const title   = photo.title || photo.id;
    const isDirty = !!state.dirty[photo.id];
    return `
<div class="admin-card${state.selected === photo.id ? ' selected' : ''}" data-id="${photo.id}" title="${esc(title)}">
  <img src="${esc(thumb)}" alt="${esc(title)}" loading="lazy">
  <div class="admin-card-title">${esc(title)}</div>
  <div class="admin-card-status${isDirty ? ' dirty' : ''}" id="status-${photo.id}"></div>
</div>`;
  }).join('');

  grid.querySelectorAll('.admin-card').forEach(card => {
    card.addEventListener('click', () => selectPhoto(card.dataset.id));
  });

  if (state.selected && state.photos.find(p => p.id === state.selected)) {
    selectPhoto(state.selected);
  }
}

function selectPhoto(id) {
  state.selected = id;
  document.querySelectorAll('.admin-card').forEach(c =>
    c.classList.toggle('selected', c.dataset.id === id)
  );
  renderEditPanel(id);
}

/* ── Edit Panel ───────────────────────────────────────────── */
function renderEditPanel(id) {
  const photo = getPhoto(id);
  if (!photo) return;

  const panel = document.getElementById('edit-panel');
  const thumb = photo.thumb || photo.src || '';

  panel.innerHTML = `
<img class="edit-preview" src="${esc(thumb)}" alt="">

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
      ${CATEGORIES.map(c => `<option value="${c}"${c === photo.category ? ' selected' : ''}>${c}</option>`).join('')}
    </select>
  </div>
  <div class="form-group">
    <label class="form-label">Tags</label>
    <div class="tag-chips" id="tag-chips">
      ${(photo.tags || []).map(tagChipHTML).join('')}
    </div>
    <div style="display:flex;gap:6px;margin-top:6px;">
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

<div style="display:flex;gap:8px;padding-top:8px;flex-wrap:wrap;">
  <button class="btn btn-secondary" id="ef-reset">Revert</button>
  <button class="btn btn-danger" id="ef-delete" style="margin-left:auto;">Delete Photo</button>
</div>
`;

  // Auto-save: stage changes immediately as the user types
  function autoSave() {
    const val = sel => document.getElementById(sel)?.value ?? '';
    applyDraft({
      title:       val('ef-title'),
      location:    val('ef-location'),
      date:        val('ef-date'),
      description: val('ef-desc'),
      category:    val('ef-category'),
      featured:    document.getElementById('ef-featured')?.checked ?? false,
    });
    const cardTitle = document.querySelector(`.admin-card[data-id="${id}"] .admin-card-title`);
    const newTitle  = document.getElementById('ef-title')?.value || id;
    if (cardTitle) cardTitle.textContent = newTitle;
    markCard(id, true);
    updatePublishBtn();
  }

  ['ef-title', 'ef-location', 'ef-date', 'ef-desc', 'ef-category'].forEach(fid => {
    document.getElementById(fid)?.addEventListener('input', autoSave);
  });
  document.getElementById('ef-featured')?.addEventListener('change', autoSave);

  const tagInput = document.getElementById('ef-tag-input');
  document.getElementById('ef-tag-add').addEventListener('click', () => addTag(tagInput.value));
  tagInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput.value); } });
  document.getElementById('tag-chips').addEventListener('click', e => {
    const rm = e.target.closest('.tag-chip-remove');
    if (rm) removeTag(rm.dataset.tag);
  });
  document.getElementById('ef-reset').addEventListener('click', () => {
    delete state.dirty[id];
    renderEditPanel(id);
    markCard(id, false);
    updatePublishBtn();
  });
  document.getElementById('ef-delete').addEventListener('click', () => markForDelete(id));
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

/* ── Site Settings ────────────────────────────────────────── */
async function showSettingsPanel() {
  // Load current config from GitHub if not yet loaded
  if (!state.siteConfig) {
    try {
      const { content, sha } = await ghGetFile('site-config.json');
      state.siteConfig = JSON.parse(content);
      state.configSha  = sha;
    } catch {
      state.siteConfig = { siteName: 'LEHTORE', heroEyebrow: 'Photography', heroTagline: [], showHeroTagline: false, showScrollIndicator: false };
      state.configSha  = null;
    }
  }

  const cfg = state.siteConfig;
  const panel = document.getElementById('edit-panel');

  panel.innerHTML = `
<div>
  <div class="edit-section-title">Site Settings</div>

  <div class="form-group">
    <label class="form-label" for="cfg-sitename">Site Name (wordmark)</label>
    <input class="form-input" id="cfg-sitename" type="text" value="${esc(cfg.siteName || '')}">
  </div>

  <div class="form-group">
    <label class="form-label" for="cfg-eyebrow">Hero Eyebrow Text</label>
    <input class="form-input" id="cfg-eyebrow" type="text" value="${esc(cfg.heroEyebrow || '')}" placeholder="Photography">
    <p class="form-hint">Small label that appears above the site name on the landing page.</p>
  </div>

  <div class="toggle-row">
    <span class="toggle-label">Show Tagline</span>
    <label class="toggle-switch">
      <input type="checkbox" id="cfg-show-tagline"${cfg.showHeroTagline ? ' checked' : ''}>
      <span class="toggle-track"></span>
    </label>
  </div>

  <div class="form-group" id="tagline-fields" style="${cfg.showHeroTagline ? '' : 'opacity:0.4;pointer-events:none'}">
    <label class="form-label">Tagline Items</label>
    <p class="form-hint" style="margin-bottom:8px;">One item per line (e.g. "Architecture").</p>
    <textarea class="form-textarea" id="cfg-tagline" rows="4">${(cfg.heroTagline || []).join('\n')}</textarea>
  </div>

  <div class="toggle-row">
    <span class="toggle-label">Show Scroll Indicator</span>
    <label class="toggle-switch">
      <input type="checkbox" id="cfg-show-scroll"${cfg.showScrollIndicator ? ' checked' : ''}>
      <span class="toggle-track"></span>
    </label>
  </div>
</div>

<div style="display:flex;gap:8px;padding-top:8px;">
  <button class="btn btn-primary" id="cfg-save-btn">Save &amp; Publish</button>
  <button class="btn btn-secondary" id="cfg-cancel-btn">Cancel</button>
</div>
`;

  // Toggle tagline field opacity
  document.getElementById('cfg-show-tagline').addEventListener('change', e => {
    document.getElementById('tagline-fields').style.cssText =
      e.target.checked ? '' : 'opacity:0.4;pointer-events:none';
  });

  document.getElementById('cfg-cancel-btn').addEventListener('click', () => {
    state.siteConfig = null; // reset so it reloads next time
    if (state.photos.length > 0 && state.selected) {
      renderEditPanel(state.selected);
    } else {
      panel.innerHTML = `<div class="edit-panel-empty"><p style="font-size:13px;color:var(--text-faint);">Select a photo to edit</p></div>`;
    }
  });

  document.getElementById('cfg-save-btn').addEventListener('click', saveSettings);
}

async function saveSettings() {
  const taglineRaw = document.getElementById('cfg-tagline')?.value || '';
  const newConfig = {
    siteName:            document.getElementById('cfg-sitename')?.value.trim()  || 'LEHTORE',
    heroEyebrow:         document.getElementById('cfg-eyebrow')?.value.trim()   || 'Photography',
    heroTagline:         taglineRaw.split('\n').map(s => s.trim()).filter(Boolean),
    showHeroTagline:     document.getElementById('cfg-show-tagline')?.checked   ?? false,
    showScrollIndicator: document.getElementById('cfg-show-scroll')?.checked    ?? false,
  };

  const btn = document.getElementById('cfg-save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const json   = JSON.stringify(newConfig, null, 2);
    const result = await ghPutFile('site-config.json', json, state.configSha, 'Update site config via admin panel');
    state.siteConfig = newConfig;
    state.configSha  = result.content.sha;
    showToast('Settings saved! Site updates in ~1 minute.', 'success');
  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save & Publish';
  }
}

/* ── Helpers ──────────────────────────────────────────────── */
function getPhoto(id) {
  return state.dirty[id] || state.photos.find(p => p.id === id) || null;
}
function applyDraft(partial) {
  const id   = state.selected;
  const base = state.dirty[id] || state.photos.find(p => p.id === id) || {};
  state.dirty[id] = { ...base, ...partial };
}
function markCard(id, dirty) {
  const dot = document.getElementById(`status-${id}`);
  if (!dot) return;
  dot.classList.toggle('dirty', dirty);
  dot.classList.remove('saved');
}
function updatePublishBtn() {
  const count  = Object.keys(state.dirty).length + state.pendingDeletes.length;
  const badge  = document.getElementById('dirty-count');
  const btn    = document.getElementById('publish-btn');
  if (badge) { badge.textContent = count > 0 ? `${count} unsaved` : ''; badge.style.display = count > 0 ? '' : 'none'; }
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
  toast._t = setTimeout(() => { toast.className = ''; }, 4000);
}
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
