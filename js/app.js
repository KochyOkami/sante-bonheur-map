/* ============================================================
   Carte du Monde — Explorateur & éditeur de royaumes
   Leaflet + CRS.Simple sur une pyramide de tuiles locale.
   ============================================================ */

const CONFIG = {
  tilesUrl: 'tiles/{z}/{x}/{y}.png',
  storageKey: 'worldmap.data.v1',
  tileVersion: 1,               // anti-cache : bumpé à chaque régénération des tuiles
  // Rempli depuis map_meta.json au démarrage :
  width: 10117, height: 10117, tileSize: 256, maxNativeZoom: 6, overZoom: 2,
  world: { originX: -6144, originZ: -8192, blocksPerPixelX: 1.164, blocksPerPixelZ: 1.367 },
};

const PALETTE = ['#e63946','#f4a261','#e9c46a','#2a9d8f','#4ea1ff','#9b5de5','#f15bb5','#00bbf9','#80b918','#ff7b00'];

// Chemin explicite des icônes de marqueur (site autonome)
L.Icon.Default.imagePath = 'vendor/images/';

let map, tileLayer, tileParchment, worldBounds, NZ;
let basemap = 'satellite';
let data = { kingdoms: [], places: [] };
const layers = { zones: null, labels: null, places: null };
const featureLayers = new Map();   // id -> leaflet layer

let editMode = false;
let drawing = null;                 // { kind:'kingdom', latlngs:[], markers:[], line, poly }
let selected = null;                // { kind, id }

/* -------------------- Coordonnées -------------------- */
// pixel image (résolution native) <-> latlng CRS.Simple
function pxToLatLng(px, py) { return map.unproject([px, py], NZ); }
function latLngToPx(ll) { const p = map.project(ll, NZ); return [p.x, p.y]; }
function pxToWorld(px, py) {
  return {
    x: Math.round(CONFIG.world.originX + px * CONFIG.world.blocksPerPixelX),
    z: Math.round(CONFIG.world.originZ + py * CONFIG.world.blocksPerPixelZ),
  };
}

/* -------------------- Persistance (cloud + repli local) -------------------- */
const DB = window.MapDB;                 // fourni par db.js
const CLOUD = !!(DB && DB.cloud);

// Enregistre un élément (création/édition)
function persist(kind, item) {
  const type = kind === 'kingdom' ? 'kingdom' : 'place';
  if (DB) DB.upsert(type, item, data);
}
// Supprime un élément
function persistRemove(id) {
  if (DB) DB.remove(id, data);
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/* -------------------- Init carte -------------------- */
async function init() {
  try {
    const meta = await fetch('map_meta.json').then(r => r.json());
    Object.assign(CONFIG, {
      width: meta.width, height: meta.height,
      tileSize: meta.tileSize, maxNativeZoom: meta.maxNativeZoom,
      tileVersion: meta.version || CONFIG.tileVersion,
    });
    if (meta.world) Object.assign(CONFIG.world, meta.world);
  } catch (e) { console.warn('map_meta.json introuvable, valeurs par défaut utilisées'); }

  NZ = CONFIG.maxNativeZoom;

  map = L.map('map', {
    crs: L.CRS.Simple,
    minZoom: 0,
    maxZoom: NZ + CONFIG.overZoom,
    zoomControl: true,
    attributionControl: false,
    zoomSnap: 1,          // crans entiers : évite les coutures entre tuiles (zoom fractionné)
    zoomDelta: 1,
    wheelPxPerZoomLevel: 120,
  });

  worldBounds = L.latLngBounds(pxToLatLng(0, 0), pxToLatLng(CONFIG.width, CONFIG.height));

  const blackTile = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  // tuile crème pour les bords hors-map en mode parchemin
  const creamTile = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1'%20height='1'%3E%3Crect%20width='1'%20height='1'%20fill='%23f0e8da'/%3E%3C/svg%3E";
  const tileOpts = {
    minZoom: 0, maxNativeZoom: NZ, maxZoom: NZ + CONFIG.overZoom,
    tileSize: CONFIG.tileSize, noWrap: true, bounds: worldBounds,
  };
  tileLayer = L.tileLayer(CONFIG.tilesUrl + '?v=' + CONFIG.tileVersion,
    Object.assign({}, tileOpts, { errorTileUrl: blackTile })).addTo(map);
  tileParchment = L.tileLayer('tiles-parchment/{z}/{x}/{y}.png?v=' + CONFIG.tileVersion,
    Object.assign({}, tileOpts, { errorTileUrl: creamTile }));

  map.fitBounds(worldBounds);
  map.setMaxBounds(worldBounds.pad(0.35));

  // Groupes de calques
  layers.zones = L.layerGroup().addTo(map);
  layers.labels = L.layerGroup().addTo(map);
  layers.places = L.layerGroup().addTo(map);

  // Charge les données (cloud si configuré, sinon cache local / exemple)
  try { data = await DB.loadAll(); } catch (e) { data = { kingdoms: [], places: [] }; }
  if (!data || !data.kingdoms) data = { kingdoms: [], places: [] };
  renderAll();

  // Temps réel : recharge et redessine quand quelqu'un modifie la carte
  if (CLOUD) {
    DB.subscribe(async () => {
      try {
        const fresh = await DB.loadAll();
        if (fresh && fresh.kingdoms) {
          data = fresh;
          renderAll();
          if (selected) openEditPanel(selected.kind, selected.id); // garde le panneau ouvert si possible
        }
      } catch (e) {}
    });
    setStatus('🟢 En ligne — édition partagée');
  } else {
    setStatus('💾 Local (ce navigateur)');
  }

  bindUI();

  // Restaure le fond de carte choisi précédemment
  try {
    const saved = localStorage.getItem('worldmap.basemap');
    if (saved === 'parchment') setBasemap('parchment');
  } catch (e) {}

  // Lecture des coordonnées
  const coordsEl = document.getElementById('coords');
  map.on('mousemove', (e) => {
    const [px, py] = latLngToPx(e.latlng);
    if (px < 0 || py < 0 || px > CONFIG.width || py > CONFIG.height) { coordsEl.textContent = '—'; return; }
    const w = pxToWorld(px, py);
    coordsEl.textContent = `MC ≈ X ${w.x}, Z ${w.z}`;
  });
  map.on('mouseout', () => coordsEl.textContent = '—');
}

/* -------------------- Rendu -------------------- */
function renderAll() {
  layers.zones.clearLayers();
  layers.labels.clearLayers();
  layers.places.clearLayers();
  featureLayers.clear();

  data.kingdoms.forEach(renderKingdom);
  data.places.forEach(renderPlace);
  renderSidebar();
}

function renderKingdom(k) {
  const latlngs = k.points.map(p => pxToLatLng(p[0], p[1]));
  const poly = L.polygon(latlngs, {
    color: k.color, weight: 2.5, fillColor: k.color, fillOpacity: 1,
    bubblingMouseEvents: true,
  });
  poly.on('click', (e) => {
    if (drawing) return;                 // en cours de tracé : laisse ajouter un point
    if (editMode) openEditPanel('kingdom', k.id);
    else L.popup().setLatLng(e.latlng).setContent(popupHtml(k.name, k.desc)).openOn(map);
  });
  poly.addTo(layers.zones);
  // remplissage hachuré (style carte politique)
  const pid = ensureHatch(k.color);
  if (poly._path) poly._path.setAttribute('fill', 'url(#' + pid + ')');

  const label = L.marker(poly.getBounds().getCenter(), {
    icon: L.divIcon({
      className: 'kingdom-label',
      html: '<span style="color:' + k.color + '">' + escapeHtml(k.name) + '</span>',
      iconSize: null,
    }),
    interactive: false,
  });
  label.addTo(layers.labels);

  featureLayers.set(k.id, { poly, label });
}

// Crée (une fois) un motif de hachures diagonales pour une couleur, renvoie son id
function ensureHatch(color) {
  const id = 'hatch_' + color.replace(/[^a-z0-9]/gi, '');
  if (document.getElementById(id)) return id;
  const defs = document.getElementById('hatchDefs').querySelector('defs');
  const ns = 'http://www.w3.org/2000/svg';
  const pat = document.createElementNS(ns, 'pattern');
  pat.setAttribute('id', id);
  pat.setAttribute('patternUnits', 'userSpaceOnUse');
  pat.setAttribute('width', '9'); pat.setAttribute('height', '9');
  pat.setAttribute('patternTransform', 'rotate(45)');
  const rect = document.createElementNS(ns, 'rect');
  rect.setAttribute('width', '9'); rect.setAttribute('height', '9');
  rect.setAttribute('fill', color); rect.setAttribute('fill-opacity', '0.16');
  const line = document.createElementNS(ns, 'line');
  line.setAttribute('x1', '0'); line.setAttribute('y1', '0');
  line.setAttribute('x2', '0'); line.setAttribute('y2', '9');
  line.setAttribute('stroke', color); line.setAttribute('stroke-width', '3');
  line.setAttribute('stroke-opacity', '0.5');
  pat.appendChild(rect); pat.appendChild(line);
  defs.appendChild(pat);
  return id;
}

function renderPlace(p) {
  const marker = L.marker(pxToLatLng(p.px, p.py), { title: p.name, bubblingMouseEvents: true });
  marker.bindTooltip(escapeHtml(p.name), { className: 'place-label', permanent: true, direction: 'top', offset: [0, -34] });
  marker.on('click', (e) => {
    if (drawing) return;
    if (editMode) openEditPanel('place', p.id);
    else L.popup().setLatLng(marker.getLatLng()).setContent(popupHtml(p.name, p.desc)).openOn(map);
  });
  marker.addTo(layers.places);
  featureLayers.set(p.id, { marker });
}

function popupHtml(name, desc) {
  return `<h4>${escapeHtml(name)}</h4>${desc ? `<div class="pdesc">${escapeHtml(desc)}</div>` : ''}`;
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* -------------------- Sidebar -------------------- */
function renderSidebar() {
  const kl = document.getElementById('kingdomList');
  const pl = document.getElementById('placeList');
  document.getElementById('kingdomCount').textContent = data.kingdoms.length;
  document.getElementById('placeCount').textContent = data.places.length;

  kl.innerHTML = '';
  if (!data.kingdoms.length) kl.innerHTML = '<li class="empty">Aucun royaume. Passe en mode éditeur pour en créer.</li>';
  data.kingdoms.forEach(k => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="swatch" style="background:${k.color}"></span><span class="name">${escapeHtml(k.name)}</span>`;
    li.onclick = () => {
      const f = featureLayers.get(k.id);
      if (f) map.flyToBounds(f.poly.getBounds(), { maxZoom: NZ, padding: [40, 40] });
      if (editMode) openEditPanel('kingdom', k.id);
    };
    kl.appendChild(li);
  });

  pl.innerHTML = '';
  if (!data.places.length) pl.innerHTML = '<li class="empty">Aucun lieu.</li>';
  data.places.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="pin">📍</span><span class="name">${escapeHtml(p.name)}</span>`;
    li.onclick = () => {
      map.flyTo(pxToLatLng(p.px, p.py), NZ);
      if (editMode) openEditPanel('place', p.id);
    };
    pl.appendChild(li);
  });
}

/* -------------------- Statut -------------------- */
function setStatus(txt) {
  const el = document.getElementById('status');
  if (el) el.textContent = txt;
}

/* -------------------- Fond de carte (satellite / parchemin) -------------------- */
function setBasemap(name) {
  basemap = name;
  const btn = document.getElementById('btnBasemap');
  if (name === 'parchment') {
    map.removeLayer(tileLayer);
    tileParchment.addTo(map).bringToBack();
    document.body.classList.add('parchment');
    if (btn) btn.textContent = '🛰️ Satellite';
  } else {
    map.removeLayer(tileParchment);
    tileLayer.addTo(map).bringToBack();
    document.body.classList.remove('parchment');
    if (btn) btn.textContent = '🗺️ Parchemin';
  }
  try { localStorage.setItem('worldmap.basemap', name); } catch (e) {}
}

/* -------------------- Verrou mot de passe -------------------- */
const UNLOCK_KEY = 'worldmap.editUnlockUntil';
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function isUnlocked() {
  const pwHash = (window.MAP_CONFIG || {}).editPasswordHash;
  if (!pwHash) return true;                              // pas de mot de passe configuré
  const until = parseInt(localStorage.getItem(UNLOCK_KEY) || '0', 10);
  return Date.now() < until;
}
async function tryUnlock() {
  const cfg = window.MAP_CONFIG || {};
  if (!cfg.editPasswordHash) return true;
  if (isUnlocked()) return true;
  const input = prompt('Code d’édition :');
  if (input == null) return false;
  const h = await sha256(input);
  if (h === cfg.editPasswordHash) {
    const mins = cfg.unlockMinutes || 240;
    localStorage.setItem(UNLOCK_KEY, String(Date.now() + mins * 60000));
    return true;
  }
  showHint('Code incorrect ✖️'); setTimeout(hideHint, 2000);
  return false;
}

/* -------------------- Éditeur -------------------- */
async function setEditMode(on) {
  if (on && !(await tryUnlock())) return;               // demande le code avant d'éditer
  editMode = on;
  document.getElementById('btnEdit').classList.toggle('active', on);
  document.getElementById('editTools').classList.toggle('hidden', !on);
  if (!on) { cancelDrawing(); closeEditPanel(); hideHint(); }
  else showHint('Mode éditeur activé — ajoute un royaume ou un lieu, ou clique un élément pour l’éditer.');
}

function startDrawKingdom() {
  cancelDrawing();
  closeEditPanel();
  drawing = { kind: 'kingdom', latlngs: [], markers: [], line: null, poly: null };
  document.getElementById('btnFinish').classList.remove('hidden');
  document.getElementById('btnCancel').classList.remove('hidden');
  showHint('Clique pour poser les sommets de la frontière. « Terminer » pour fermer la zone (min. 3 points).');
  map.on('click', onDrawClick);
}

function onDrawClick(e) {
  drawing.latlngs.push(e.latlng);
  const m = L.circleMarker(e.latlng, { radius: 4, color: '#fff', weight: 2, fillColor: '#4ea1ff', fillOpacity: 1 }).addTo(map);
  drawing.markers.push(m);
  if (drawing.line) drawing.line.setLatLngs(drawing.latlngs);
  else drawing.line = L.polyline(drawing.latlngs, { color: '#4ea1ff', weight: 2, dashArray: '5,6' }).addTo(map);
}

function finishDrawing() {
  if (!drawing || drawing.kind !== 'kingdom') return;
  if (drawing.latlngs.length < 3) { showHint('Il faut au moins 3 points pour une zone.'); return; }
  const points = drawing.latlngs.map(ll => latLngToPx(ll).map(Math.round));
  const k = { id: uid(), name: 'Nouveau royaume', color: PALETTE[data.kingdoms.length % PALETTE.length], desc: '', points };
  data.kingdoms.push(k);
  cancelDrawing();
  persist('kingdom', k);
  renderAll();
  openEditPanel('kingdom', k.id);
}

function cancelDrawing() {
  map.off('click', onDrawClick);
  document.getElementById('btnFinish').classList.add('hidden');
  document.getElementById('btnCancel').classList.add('hidden');
  if (drawing) {
    drawing.markers.forEach(m => map.removeLayer(m));
    if (drawing.line) map.removeLayer(drawing.line);
    if (drawing.poly) map.removeLayer(drawing.poly);
  }
  drawing = null;
  hideHint();
}

function startAddPlace() {
  cancelDrawing();
  closeEditPanel();
  showHint('Clique sur la carte pour placer le lieu.');
  map.once('click', (e) => {
    const [px, py] = latLngToPx(e.latlng).map(Math.round);
    const p = { id: uid(), name: 'Nouveau lieu', desc: '', px, py };
    data.places.push(p);
    persist('place', p);
    renderAll();
    openEditPanel('place', p.id);
    hideHint();
  });
}

/* -------------------- Panneau d'édition -------------------- */
function openEditPanel(kind, id) {
  selected = { kind, id };
  const item = find(kind, id);
  if (!item) return;
  const panel = document.getElementById('editPanel');
  panel.classList.remove('hidden');
  document.getElementById('editPanelTitle').textContent = kind === 'kingdom' ? 'Éditer le royaume' : 'Éditer le lieu';
  document.getElementById('fName').value = item.name;
  document.getElementById('fDesc').value = item.desc || '';
  const colorRow = document.getElementById('colorRow');
  if (kind === 'kingdom') { colorRow.style.display = ''; document.getElementById('fColor').value = item.color; }
  else colorRow.style.display = 'none';
  document.getElementById('fName').focus();
  document.getElementById('fName').select();
}
function closeEditPanel() {
  document.getElementById('editPanel').classList.add('hidden');
  selected = null;
}
function saveEditPanel() {
  if (!selected) return;
  const item = find(selected.kind, selected.id);
  if (!item) return;
  item.name = document.getElementById('fName').value.trim() || 'Sans nom';
  item.desc = document.getElementById('fDesc').value.trim();
  if (selected.kind === 'kingdom') item.color = document.getElementById('fColor').value;
  persist(selected.kind, item);
  renderAll();
  closeEditPanel();
}
function deleteSelected() {
  if (!selected) return;
  const arr = selected.kind === 'kingdom' ? data.kingdoms : data.places;
  const i = arr.findIndex(x => x.id === selected.id);
  const id = selected.id;
  if (i >= 0) arr.splice(i, 1);
  persistRemove(id);
  renderAll();
  closeEditPanel();
}
function find(kind, id) {
  return (kind === 'kingdom' ? data.kingdoms : data.places).find(x => x.id === id);
}

/* -------------------- Import / Export -------------------- */
function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'carte-royaumes.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (!d.kingdoms || !d.places) throw new Error('format invalide');
      data = d;
      if (DB) DB.replaceAll(data);
      renderAll();
      showHint('Données importées ✔️'); setTimeout(hideHint, 1800);
    } catch (e) { showHint('Fichier invalide ✖️'); setTimeout(hideHint, 2200); }
  };
  reader.readAsText(file);
}

/* -------------------- Hints -------------------- */
let hintTimer;
function showHint(msg) { const h = document.getElementById('hint'); h.textContent = msg; h.classList.remove('hidden'); }
function hideHint() { document.getElementById('hint').classList.add('hidden'); }

/* -------------------- UI bindings -------------------- */
function bindUI() {
  document.getElementById('btnBasemap').onclick = () => setBasemap(basemap === 'satellite' ? 'parchment' : 'satellite');
  document.getElementById('btnEdit').onclick = () => setEditMode(!editMode);
  document.getElementById('btnAddKingdom').onclick = startDrawKingdom;
  document.getElementById('btnAddPlace').onclick = startAddPlace;
  document.getElementById('btnFinish').onclick = finishDrawing;
  document.getElementById('btnCancel').onclick = cancelDrawing;

  document.getElementById('fSave').onclick = saveEditPanel;
  document.getElementById('fDelete').onclick = deleteSelected;
  document.getElementById('fClose').onclick = closeEditPanel;

  document.getElementById('btnExport').onclick = exportData;
  document.getElementById('btnImport').onclick = () => document.getElementById('importFile').click();
  document.getElementById('importFile').onchange = (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; };

  document.getElementById('toggleZones').onchange = (e) => toggleLayer('zones', e.target.checked);
  document.getElementById('toggleLabels').onchange = (e) => toggleLayer('labels', e.target.checked);
  document.getElementById('togglePlaces').onchange = (e) => toggleLayer('places', e.target.checked);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { cancelDrawing(); closeEditPanel(); }
    if (e.key === 'Enter' && drawing) finishDrawing();
  });
}
function toggleLayer(name, on) {
  if (on) map.addLayer(layers[name]); else map.removeLayer(layers[name]);
}

init();
