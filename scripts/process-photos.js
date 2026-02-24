/**
 * LEHTORE — Photo Processor
 *
 * Run by GitHub Actions when new photos are pushed to photos/uploads/.
 * Generates thumbnails with Sharp and stubs photos.json metadata from EXIF.
 *
 * Usage (locally or in CI):  node scripts/process-photos.js
 */

import sharp      from 'sharp';
import exifr      from 'exifr';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, basename, extname } from 'path';

const ORIGINALS_DIR  = 'photos/uploads';
const THUMBS_DIR     = 'photos/thumbs';
const PHOTOS_JSON    = 'photos.json';
const THUMB_WIDTH    = 1200;          // px, height auto
const THUMB_QUALITY  = 88;            // JPEG quality
const IMAGE_EXTS     = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.heic', '.heif', '.webp']);

/* ── Helpers ───────────────────────────────────────────────────────────────── */
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/\.[^.]+$/, '')           // remove extension
    .replace(/[^a-z0-9]+/g, '-')       // non-alphanum → hyphen
    .replace(/^-+|-+$/g, '');          // trim hyphens
}

function padded(n) {
  return String(n).padStart(2, '0');
}

function formatDate(d) {
  if (!d) return '';
  return `${d.getFullYear()}-${padded(d.getMonth() + 1)}-${padded(d.getDate())}`;
}

/* ── Load existing photos.json ─────────────────────────────────────────────── */
let photosData = { photos: [] };
if (existsSync(PHOTOS_JSON)) {
  try {
    photosData = JSON.parse(readFileSync(PHOTOS_JSON, 'utf8'));
    if (!Array.isArray(photosData.photos)) photosData.photos = [];
  } catch (err) {
    console.warn('⚠  Could not parse photos.json, starting fresh:', err.message);
    photosData = { photos: [] };
  }
}
const knownIds = new Set(photosData.photos.map(p => p.id));

/* ── Ensure directories exist ──────────────────────────────────────────────── */
[ORIGINALS_DIR, THUMBS_DIR].forEach(dir => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    console.log(`  Created ${dir}/`);
  }
});

/* ── Scan originals ────────────────────────────────────────────────────────── */
const files = readdirSync(ORIGINALS_DIR).filter(f => {
  const ext = extname(f).toLowerCase();
  return IMAGE_EXTS.has(ext) && !f.startsWith('.');
});

if (files.length === 0) {
  console.log('No image files found in photos/uploads/. Nothing to do.');
  process.exit(0);
}

let processed = 0;
let skipped   = 0;
const newEntries = [];

/* ── Process each file ─────────────────────────────────────────────────────── */
for (const filename of files) {
  const id = slugify(basename(filename));

  if (knownIds.has(id)) {
    skipped++;
    continue;
  }

  const srcPath   = join(ORIGINALS_DIR, filename);
  const thumbName = `${id}.jpg`;
  const thumbPath = join(THUMBS_DIR, thumbName);

  console.log(`\n  Processing: ${filename}`);

  try {
    /* ── Sharp: generate thumbnail ──────────────────────────────────────────── */
    const image = sharp(srcPath);
    const meta  = await image.metadata();

    await image
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
      .toFile(thumbPath);

    console.log(`    ✓ Thumbnail → ${thumbPath}`);

    /* ── EXIF extraction ──────────────────────────────────────────────────────── */
    let exif = {};
    try {
      exif = await exifr.parse(srcPath, {
        pick: ['DateTimeOriginal', 'Make', 'Model', 'FNumber', 'ExposureTime',
               'ISOSpeedRatings', 'FocalLength', 'GPSLatitude', 'GPSLongitude'],
      }) || {};
    } catch (exifErr) {
      console.log(`    ⚠  EXIF read failed: ${exifErr.message}`);
    }

    /* ── GPS privacy warning ────────────────────────────────────────────────── */
    if (exif.GPSLatitude != null || exif.GPSLongitude != null) {
      console.log(`    ⚠  GPS data detected in ${filename}!`);
      console.log(`       Lat: ${exif.GPSLatitude}, Lon: ${exif.GPSLongitude}`);
      console.log(`       This will NOT be stored in photos.json, but the original file`);
      console.log(`       still contains GPS tags. Strip with: exiftool -gps:all= "${srcPath}"`);
    }

    const make    = exif.Make  || '';
    const model   = exif.Model || '';
    const camera  = [make, model].filter(Boolean).join(' ') || 'Hasselblad X2D II';
    const date    = exif.DateTimeOriginal ? formatDate(new Date(exif.DateTimeOriginal)) : '';

    /* ── Build stub entry ───────────────────────────────────────────────────── */
    const entry = {
      id,
      src:         `photos/uploads/${filename}`,
      thumb:       `photos/thumbs/${thumbName}`,
      title:       '',
      description: '',
      location:    '',
      date,
      category:    'Uncategorized',
      tags:        [],
      camera,
      width:       meta.width  || 0,
      height:      meta.height || 0,
      featured:    false,
    };

    newEntries.push(entry);
    knownIds.add(id);
    processed++;
    console.log(`    ✓ Entry added (fill in title/tags/location in admin)`);
  } catch (err) {
    console.error(`    ✗ Failed to process ${filename}:`, err.message);
  }
}

/* ── Write updated photos.json ─────────────────────────────────────────────── */
if (newEntries.length > 0) {
  photosData.photos = [...photosData.photos, ...newEntries];
  writeFileSync(PHOTOS_JSON, JSON.stringify(photosData, null, 2) + '\n', 'utf8');
  console.log(`\n✅  photos.json updated — ${newEntries.length} new photo(s) added.`);
} else {
  console.log('\n✅  No new photos to add.');
}

console.log(`\nSummary: ${processed} processed, ${skipped} already known.`);
if (newEntries.length > 0) {
  console.log('\nNext steps:');
  console.log('  1. Open admin.html on your site');
  console.log('  2. Fill in title, category, tags, and location for each new photo');
  console.log('  3. Click "Publish to GitHub"');
}
