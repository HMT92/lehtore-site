'use strict';

/* ============================================================
   LEHTORE — Gallery Logic
   Handles: photo loading, masonry render, filtering, sorting,
            lightbox (zoom/pan), keyboard nav, scroll animations
   ============================================================ */

const state = {
  photos:   [],
  filtered: [],
  activeCategory: 'all',
  activeTags: new Set(),
  sort: 'newest',
  lb: { open: false, index: 0 },
};

const els = {};

/* ── Init ─────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  cacheEls();
  initHeroAnimation();

  state.photos = await loadPhotos();

  document.getElementById('preloader').classList.add('hidden');

  if (state.photos.length === 0) {
    showEmptyState('No photos yet. Add photos via GitHub to get started.');
    return;
  }

  buildFilters();
  applyFiltersAndSort();
  renderGallery();
  initControls();
  initLightbox();
  initKeyboard();
  initScrollObserver();
  handleHashOpen();
});

function cacheEls() {
  const get = id => document.getElementById(id);
  els.gallery     = get('gallery');
  els.emptyState  = get('empty-state');
  els.filterPills = get('filter-pills');
  els.tagFilter   = get('tag-filter');
  els.sortSelect  = get('sort-select');
  els.lightbox    = get('lightbox');
  els.lbImage     = get('lb-image');
  els.lbTitle     = get('lb-title');
  els.lbLocation  = get('lb-location');
  els.lbDate      = get('lb-date');
  els.lbCamera    = get('lb-camera');
  els.lbCategory  = get('lb-category');
  els.lbTags      = get('lb-tags');
  els.lbDesc      = get('lb-desc');
  els.lbCounter   = get('lb-counter');
  els.lbClose     = get('lb-close');
  els.lbPrev      = get('lb-prev');
  els.lbNext      = get('lb-next');
}

/* ── Data ─────────────────────────────────────────────────── */
async function loadPhotos() {
  try {
    const res = await fetch('photos.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.photos) ? data.photos : [];
  } catch (err) {
    console.error('Failed to load photos.json:', err);
    return [];
  }
}

/* ── Hero Animation ───────────────────────────────────────── */
function initHeroAnimation() {
  const nameEl = document.querySelector('.hero-name');
  if (nameEl) {
    const text = nameEl.textContent;
    nameEl.innerHTML = text.split('').map((ch, i) =>
      `<span class="hero-char" style="animation-delay:${(i * 0.045).toFixed(3)}s">${ch === ' ' ? '&nbsp;' : ch}</span>`
    ).join('');
  }

  const delayOffset = 0.75;
  document.querySelectorAll('.hero-animate').forEach((el, i) => {
    el.style.animationDelay = `${(delayOffset + i * 0.15).toFixed(2)}s`;
  });
}

/* ── Filters ──────────────────────────────────────────────── */
function buildFilters() {
  const categories = ['all', ...new Set(
    state.photos.map(p => p.category).filter(Boolean)
  )];

  els.filterPills.innerHTML = categories.map(cat => {
    const count = cat === 'all'
      ? state.photos.length
      : state.photos.filter(p => p.category === cat).length;
    return `<button class="pill${cat === 'all' ? ' active' : ''}" data-category="${cat}">
      ${cat}
      <span class="pill-count">${count}</span>
    </button>`;
  }).join('');

  const allTags = [...new Set(state.photos.flatMap(p => p.tags || []))].sort();
  if (els.tagFilter && allTags.length) {
    els.tagFilter.innerHTML =
      '<option value="">All tags</option>' +
      allTags.map(t => `<option value="${t}">${t}</option>`).join('');
    els.tagFilter.style.display = '';
  } else if (els.tagFilter) {
    els.tagFilter.style.display = 'none';
  }
}

function initControls() {
  els.filterPills.addEventListener('click', e => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    state.activeCategory = pill.dataset.category;
    transitionGallery();
  });

  if (els.tagFilter) {
    els.tagFilter.addEventListener('change', e => {
      state.activeTags = e.target.value ? new Set([e.target.value]) : new Set();
      transitionGallery();
    });
  }

  if (els.sortSelect) {
    els.sortSelect.addEventListener('change', e => {
      state.sort = e.target.value;
      transitionGallery();
    });
  }
}

function applyFiltersAndSort() {
  let photos = [...state.photos];

  if (state.activeCategory !== 'all') {
    photos = photos.filter(p => p.category === state.activeCategory);
  }
  if (state.activeTags.size > 0) {
    photos = photos.filter(p =>
      [...state.activeTags].every(tag => (p.tags || []).includes(tag))
    );
  }

  switch (state.sort) {
    case 'newest':
      photos.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      break;
    case 'oldest':
      photos.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      break;
    case 'title':
      photos.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      break;
  }

  // Featured float to top
  const featured = photos.filter(p => p.featured);
  const rest     = photos.filter(p => !p.featured);
  state.filtered = [...featured, ...rest];
}

/* ── Gallery Render ───────────────────────────────────────── */
function transitionGallery() {
  const cards = els.gallery.querySelectorAll('.photo-card');
  cards.forEach(c => {
    c.style.opacity = '0';
    c.style.transform = 'translateY(10px)';
  });
  setTimeout(() => {
    applyFiltersAndSort();
    renderGallery();
  }, 280);
}

function renderGallery() {
  if (state.filtered.length === 0) {
    els.gallery.innerHTML = '';
    showEmptyState(
      state.photos.length === 0
        ? 'No photos yet. Upload via GitHub to get started.'
        : 'No photos match these filters.'
    );
    return;
  }
  hideEmptyState();

  els.gallery.innerHTML = state.filtered.map(cardHTML).join('');

  // Staggered entrance
  const cards = els.gallery.querySelectorAll('.photo-card');
  cards.forEach((card, i) => {
    card.style.transitionDelay = `${Math.min(i * 0.035, 0.45).toFixed(3)}s`;
  });

  cards.forEach(card => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.index, 10);
      openLightbox(idx);
    });
  });

  initScrollObserver();
}

function cardHTML(photo, index) {
  const thumb    = photo.thumb || photo.src;
  const title    = photo.title    || 'Untitled';
  const location = photo.location || '';
  const category = photo.category || '';
  const aspect   = photo.width && photo.height
    ? `width="${photo.width}" height="${photo.height}"`
    : '';

  return `
<div class="photo-card${photo.featured ? ' featured' : ''}"
     data-index="${index}"
     data-id="${photo.id || ''}">
  <div class="card-img-wrap">
    <img src="${thumb}" alt="${esc(title)}" loading="lazy" ${aspect}>
  </div>
  <div class="card-overlay">
    ${category ? `<span class="card-category">${esc(category)}</span>` : ''}
    <div class="card-info">
      <h3 class="card-title">${esc(title)}</h3>
      ${location ? `<p class="card-location">${esc(location)}</p>` : ''}
    </div>
  </div>
</div>`;
}

/* ── Scroll Observer ──────────────────────────────────────── */
function initScrollObserver() {
  const cards = els.gallery.querySelectorAll('.photo-card:not(.observed)');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.04, rootMargin: '0px 0px -40px 0px' });

  cards.forEach(c => {
    c.classList.add('observed');
    observer.observe(c);
  });
}

/* ── Empty State ──────────────────────────────────────────── */
function showEmptyState(msg) {
  if (!els.emptyState) return;
  const msgEl = els.emptyState.querySelector('.empty-msg');
  if (msgEl) msgEl.textContent = msg;
  els.emptyState.style.display = 'flex';
}
function hideEmptyState() {
  if (els.emptyState) els.emptyState.style.display = 'none';
}

/* ── Lightbox ─────────────────────────────────────────────── */
const zoom = { scale: 1, panX: 0, panY: 0, dragging: false, lastX: 0, lastY: 0 };

function initLightbox() {
  els.lbClose.addEventListener('click', closeLightbox);
  els.lbPrev.addEventListener('click', () => navigate(-1));
  els.lbNext.addEventListener('click', () => navigate(1));

  // Click backdrop to close
  els.lightbox.addEventListener('click', e => {
    if (e.target === els.lightbox) closeLightbox();
  });

  // Swipe support
  let touchStartX = 0;
  els.lightbox.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  els.lightbox.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) navigate(dx < 0 ? 1 : -1);
  }, { passive: true });

  initZoom();
}

function openLightbox(index) {
  state.lb.open  = true;
  state.lb.index = index;
  loadLbPhoto();
  els.lightbox.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  state.lb.open = false;
  els.lightbox.classList.remove('open');
  document.body.style.overflow = '';
  history.replaceState(null, '', location.pathname);
  resetZoom();
}

function navigate(dir) {
  const next = state.lb.index + dir;
  if (next < 0 || next >= state.filtered.length) return;
  state.lb.index = next;
  loadLbPhoto();
  resetZoom();
}

function loadLbPhoto() {
  const photo = state.filtered[state.lb.index];
  if (!photo) return;

  els.lbImage.classList.add('loading');
  els.lbImage.onload = () => els.lbImage.classList.remove('loading');
  els.lbImage.src = photo.src || photo.thumb || '';
  els.lbImage.alt = photo.title || '';

  setText(els.lbTitle,    photo.title    || 'Untitled');
  setText(els.lbLocation, photo.location || '');
  setText(els.lbDate,     photo.date     ? fmtDate(photo.date) : '');
  setText(els.lbCamera,   photo.camera   || '');
  setText(els.lbCategory, photo.category || '');
  setText(els.lbCounter,  `${state.lb.index + 1} / ${state.filtered.length}`);

  if (els.lbTags) {
    els.lbTags.innerHTML = (photo.tags || [])
      .map(t => `<span class="lb-tag">${esc(t)}</span>`).join('');
  }
  if (els.lbDesc) {
    els.lbDesc.textContent = photo.description || '';
    els.lbDesc.style.display = photo.description ? '' : 'none';
  }

  updateNavBtns();

  if (photo.id) history.replaceState(null, '', `#${photo.id}`);
}

function updateNavBtns() {
  const { index } = state.lb;
  const last = state.filtered.length - 1;
  els.lbPrev.style.opacity = index === 0    ? '0.25' : '1';
  els.lbNext.style.opacity = index === last ? '0.25' : '1';
  els.lbPrev.style.pointerEvents = index === 0    ? 'none' : '';
  els.lbNext.style.pointerEvents = index === last ? 'none' : '';
}

function handleHashOpen() {
  const hash = location.hash.slice(1);
  if (!hash) return;
  const idx = state.filtered.findIndex(p => p.id === hash);
  if (idx !== -1) openLightbox(idx);
}

/* ── Zoom / Pan ───────────────────────────────────────────── */
function initZoom() {
  const container = document.getElementById('lb-image-container');
  if (!container) return;

  function applyTransform() {
    els.lbImage.style.transform =
      `translate(${zoom.panX}px, ${zoom.panY}px) scale(${zoom.scale})`;
  }

  // Wheel zoom
  container.addEventListener('wheel', e => {
    e.preventDefault();
    const delta  = e.deltaY < 0 ? 0.18 : -0.18;
    zoom.scale   = Math.min(6, Math.max(1, zoom.scale + delta));
    if (zoom.scale === 1) { zoom.panX = 0; zoom.panY = 0; }
    applyTransform();
    container.style.cursor = zoom.scale > 1 ? 'grab' : 'default';
  }, { passive: false });

  // Double-click reset
  container.addEventListener('dblclick', () => resetZoom());

  // Drag to pan
  container.addEventListener('mousedown', e => {
    if (zoom.scale <= 1) return;
    zoom.dragging = true;
    zoom.lastX = e.clientX;
    zoom.lastY = e.clientY;
    container.style.cursor = 'grabbing';
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!zoom.dragging) return;
    zoom.panX += e.clientX - zoom.lastX;
    zoom.panY += e.clientY - zoom.lastY;
    zoom.lastX = e.clientX;
    zoom.lastY = e.clientY;
    applyTransform();
  });
  window.addEventListener('mouseup', () => {
    if (!zoom.dragging) return;
    zoom.dragging = false;
    container.style.cursor = zoom.scale > 1 ? 'grab' : 'default';
  });

  // Pinch zoom (touch)
  let initDist = 0, initScale = 1;
  container.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      initDist  = pinchDist(e.touches);
      initScale = zoom.scale;
    }
  }, { passive: true });
  container.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      zoom.scale = Math.min(6, Math.max(1, initScale * pinchDist(e.touches) / initDist));
      applyTransform();
    }
  }, { passive: true });
}

function resetZoom() {
  zoom.scale = 1; zoom.panX = 0; zoom.panY = 0; zoom.dragging = false;
  if (els.lbImage) els.lbImage.style.transform = '';
  const c = document.getElementById('lb-image-container');
  if (c) c.style.cursor = 'default';
}

function pinchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

/* ── Keyboard ─────────────────────────────────────────────── */
function initKeyboard() {
  document.addEventListener('keydown', e => {
    if (!state.lb.open) return;
    if (e.key === 'Escape')      closeLightbox();
    if (e.key === 'ArrowLeft')   navigate(-1);
    if (e.key === 'ArrowRight')  navigate(1);
  });
}

/* ── Helpers ──────────────────────────────────────────────── */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function setText(el, val) { if (el) el.textContent = val; }
function fmtDate(d) {
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  } catch { return d; }
}
