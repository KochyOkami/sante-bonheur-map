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

/* ------------------------------------------------------------
   Carte isométrique Dynmap (servie en direct par le serveur MC).
   Ces valeurs sont recopiées telles quelles depuis /up/configuration
   du serveur Dynmap (monde "world", carte "iso", perspective
   iso_SE_60_hires). Si la config Dynmap change côté serveur, il faut
   les remettre à jour ici, sinon les tuiles se décalent.
   ------------------------------------------------------------ */
const DYNMAP = {
  prefix: 'iso',
  world: 'world',
  fmt: 'jpg',
  tileSize: 128,          // 128 << tilescale
  tilescale: 0,
  mapzoomin: 1,
  mapzoomout: 8,
  maxZoom: 9,             // mapzoomin + mapzoomout
  markerY: 64,            // hauteur supposée pour projeter les tracés (sealevel = 63)
  worldtomap: [11.31370849898476, 0.0, -11.313708498984761,
               -9.797958971132713, 7.999999999999999, -9.797958971132712,
               -4.8074067159589095e-17, 0.9999999999999999, -4.8074067159589095e-17],
  maptoworld: [0.044194173824159216, -0.05103103630798288, 0.408248290463863,
               0.0, -3.469446951953614e-18, 1.0000000000000002,
               -0.04419417382415922, -0.05103103630798287, 0.40824829046386296],
};

// Chemin explicite des icônes de marqueur (site autonome)
L.Icon.Default.imagePath = 'vendor/images/';

let map, tileLayer, tileParchment, tileIso, worldBounds, NZ;
let ISO_DZ = 1.5;          // écart de zoom entre l'espace satellite et l'espace iso (calculé au démarrage)
let basemap = 'satellite';
let data = { kingdoms: [], places: [] };
const layers = { zones: null, labels: null, places: null };
const featureLayers = new Map();   // id -> leaflet layer

let editMode = false;
let drawing = null;                 // { kind:'kingdom', latlngs:[], markers:[], line, poly }
let selected = null;                // { kind, id }

/* -------------------- Coordonnées --------------------
   Les éléments sont stockés en pixels image (px, py). Selon le fond
   affiché, ces pixels se projettent dans deux espaces latlng différents :
   - satellite / parchemin : vue du dessus, 1 px = 1 bloc ;
   - iso : projection isométrique de Dynmap.
   Tout passe par pxToLatLng / latLngToPx, donc changer de fond suffit
   à replacer correctement royaumes et lieux.                            */

// pixel image <-> coordonnées Minecraft (sans arrondi : doit rester réversible)
function pxToWorldExact(px, py) {
  return {
    x: CONFIG.world.originX + px * CONFIG.world.blocksPerPixelX,
    z: CONFIG.world.originZ + py * CONFIG.world.blocksPerPixelZ,
  };
}
function worldToPx(x, z) {
  return [
    (x - CONFIG.world.originX) / CONFIG.world.blocksPerPixelX,
    (z - CONFIG.world.originZ) / CONFIG.world.blocksPerPixelZ,
  ];
}
function pxToWorld(px, py) {
  const w = pxToWorldExact(px, py);
  return { x: Math.round(w.x), z: Math.round(w.z) };
}

// Projection isométrique Dynmap (transcrite de web/js/hdmap.js : HDProjection)
function worldToIsoLatLng(x, z, y) {
  const w = DYNMAP.worldtomap, s = 1 << DYNMAP.mapzoomout;
  if (y == null) y = DYNMAP.markerY;
  const lat = w[3] * x + w[4] * y + w[5] * z;
  const lng = w[0] * x + w[1] * y + w[2] * z;
  return L.latLng(-(((128 << DYNMAP.tilescale) - lat) / s), lng / s);
}
function isoLatLngToWorld(ll, y) {
  const p = DYNMAP.maptoworld, s = 1 << DYNMAP.mapzoomout;
  if (y == null) y = DYNMAP.markerY;
  const lat = (128 << DYNMAP.tilescale) + ll.lat * s;
  const lng = ll.lng * s;
  return { x: p[0] * lng + p[1] * lat + p[2] * y, z: p[6] * lng + p[7] * lat + p[8] * y };
}

// pixel image (résolution native) <-> latlng CRS.Simple, selon le fond courant
function pxToLatLng(px, py) {
  if (basemap === 'iso') { const w = pxToWorldExact(px, py); return worldToIsoLatLng(w.x, w.z); }
  return map.unproject([px, py], NZ);
}
function latLngToPx(ll) {
  if (basemap === 'iso') { const w = isoLatLngToWorld(ll); return worldToPx(w.x, w.z); }
  const p = map.project(ll, NZ);
  return [p.x, p.y];
}

// Boîte englobante de la carte dans l'espace courant (4 coins : en iso le carré est tourné)
function computeWorldBounds() {
  const corners = [[0, 0], [CONFIG.width, 0], [CONFIG.width, CONFIG.height], [0, CONFIG.height]];
  return L.latLngBounds(corners.map(c => pxToLatLng(c[0], c[1])));
}

// Écart de zoom à appliquer en passant d'un espace à l'autre (l'iso est ~2,8x plus grand)
function zoomDelta(from, to) {
  return (to === 'iso' ? -ISO_DZ : 0) - (from === 'iso' ? -ISO_DZ : 0);
}
function maxZoomFor(name) { return name === 'iso' ? DYNMAP.maxZoom : NZ + CONFIG.overZoom; }
// Zoom de confort quand on centre sur un élément
function focusZoom() { return basemap === 'iso' ? Math.round(NZ - ISO_DZ) : NZ; }

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

/* -------------------- Couche de tuiles Dynmap --------------------
   Dynmap ne sert pas des tuiles {z}/{x}/{y} classiques : le nom du
   fichier est calculé par hdmap.js (getTileName + getTileInfo). On
   reproduit exactement ce calcul, sinon rien ne s'affiche.          */
const DynmapTileLayer = L.TileLayer.extend({
  getTileUrl: function (coords) {
    const izoom = DYNMAP.maxZoom - coords.z;                 // options.zoomReverse de Dynmap
    const zoomoutlevel = Math.max(0, izoom - DYNMAP.mapzoomin);
    const scale = 1 << zoomoutlevel;
    const x = scale * coords.x;
    const scaledx = x >> 5;                                  // calculé AVANT l'inversion (comme Dynmap)
    const y = -(scale * coords.y);                           // Y inversé sur les cartes HD
    const scaledy = y >> 5;
    const zp = zoomoutlevel === 0 ? '' : 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'.substr(0, zoomoutlevel) + '_';
    return this.options.baseUrl + '/tiles/' + DYNMAP.world + '/' + DYNMAP.prefix +
           '/' + scaledx + '_' + scaledy + '/' + zp + x + '_' + y + '.' + DYNMAP.fmt;
  },
});

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

  // Écart d'échelle entre les deux espaces : combien d'unités latlng vaut un bloc
  // dans chacun. L'espace iso est ~2,83x plus grand, soit 1,5 niveau de zoom.
  const isoUnitPerBlock = Math.abs(DYNMAP.worldtomap[0]) / (1 << DYNMAP.mapzoomout);
  const satUnitPerBlock = (1 / CONFIG.world.blocksPerPixelX) / (1 << NZ);
  ISO_DZ = Math.log2(isoUnitPerBlock / satUnitPerBlock);

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

  // Fond isométrique servi en direct par le serveur Minecraft (facultatif :
  // sans dynmapUrl configurée, le bouton ne propose que satellite/parchemin).
  const dynUrl = ((window.MAP_CONFIG || {}).dynmapUrl || '').replace(/\/+$/, '');
  if (dynUrl) {
    // Emprise de la carte projetée en iso : évite de demander des tuiles
    // très au-delà de la zone rendue (Dynmap est borné à +/-5120 blocs).
    const isoCorners = [[0, 0], [CONFIG.width, 0], [CONFIG.width, CONFIG.height], [0, CONFIG.height]]
      .map(c => { const w = pxToWorldExact(c[0], c[1]); return worldToIsoLatLng(w.x, w.z); });
    tileIso = new DynmapTileLayer('', {
      baseUrl: dynUrl,
      minZoom: 0, maxNativeZoom: DYNMAP.mapzoomout, maxZoom: DYNMAP.maxZoom,
      tileSize: DYNMAP.tileSize, noWrap: true,
      bounds: L.latLngBounds(isoCorners),
      errorTileUrl: blackTile,     // zones non rendues : Dynmap renvoie 404
      keepBuffer: 4,
    });
  }

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
    if (saved && saved !== 'satellite' && basemapCycle().includes(saved)) setBasemap(saved);
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

/* -------------------- Édition des sommets d'un royaume -------------------- */
let vLayer = null;              // calque des poignées
let vEdit = null;              // { id }

function startVertexEdit(id) {
  stopVertexEdit();
  vEdit = { id };
  if (!vLayer) vLayer = L.layerGroup();
  vLayer.addTo(map);
  drawHandles();
}
function stopVertexEdit() {
  vEdit = null;
  if (vLayer) vLayer.clearLayers();
}
function drawHandles() {
  if (!vEdit) return;
  vLayer.clearLayers();
  const k = find('kingdom', vEdit.id);
  if (!k) return;
  const poly = () => (featureLayers.get(k.id) || {}).poly;
  const refresh = () => { const p = poly(); if (p) p.setLatLngs(k.points.map(pt => pxToLatLng(pt[0], pt[1]))); };

  // poignées de sommet (déplaçables ; clic = supprimer)
  k.points.forEach((pt, i) => {
    const m = L.marker(pxToLatLng(pt[0], pt[1]), {
      icon: L.divIcon({ className: 'vhandle', iconSize: [14, 14] }),
      draggable: true, keyboard: false, zIndexOffset: 1000,
    });
    let dragged = false;
    m.on('dragstart', () => { dragged = true; });
    m.on('drag', (e) => { const q = latLngToPx(e.latlng).map(Math.round); k.points[i] = q; refresh(); });
    m.on('dragend', () => { persist('kingdom', k); drawMidsOnly(); setTimeout(() => dragged = false, 50); });
    m.on('click', (e) => {
      L.DomEvent.stop(e);
      if (dragged) return;
      if (k.points.length <= 3) { showHint('Un royaume garde au moins 3 points.'); setTimeout(hideHint, 1600); return; }
      k.points.splice(i, 1); persist('kingdom', k); rerenderKingdom(k); drawHandles();
    });
    vLayer.addLayer(m);
  });
  drawMidsOnly();
}
function drawMidsOnly() {
  if (!vEdit) return;
  // enlève les anciens milieux
  vLayer.getLayers().filter(l => l._isMid).forEach(l => vLayer.removeLayer(l));
  const k = find('kingdom', vEdit.id); if (!k) return;
  k.points.forEach((pt, i) => {
    const nxt = k.points[(i + 1) % k.points.length];
    const mid = [Math.round((pt[0] + nxt[0]) / 2), Math.round((pt[1] + nxt[1]) / 2)];
    const m = L.marker(pxToLatLng(mid[0], mid[1]), {
      icon: L.divIcon({ className: 'vhandle mid', iconSize: [12, 12] }),
      keyboard: false, zIndexOffset: 900,
    });
    m._isMid = true;
    m.on('click', (e) => {
      L.DomEvent.stop(e);
      k.points.splice(i + 1, 0, mid); persist('kingdom', k); rerenderKingdom(k); drawHandles();
    });
    vLayer.addLayer(m);
  });
}
// redessine un seul royaume (poly + label) sans tout reconstruire
function rerenderKingdom(k) {
  const f = featureLayers.get(k.id);
  if (f) { layers.zones.removeLayer(f.poly); layers.labels.removeLayer(f.label); }
  renderKingdom(k);
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
      if (f) map.flyToBounds(f.poly.getBounds(), { maxZoom: focusZoom(), padding: [40, 40] });
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
      map.flyTo(pxToLatLng(p.px, p.py), focusZoom());
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

/* -------------------- Fond de carte (satellite / parchemin / iso) -------------------- */
const BASEMAP_LABEL = {
  satellite: '🛰️ Satellite',
  parchment: '🗺️ Parchemin',
  iso: '⛰️ Isométrique',
};
// Fonds proposés par le bouton (l'iso n'apparaît que si dynmapUrl est configurée)
function basemapCycle() {
  return ['satellite', 'parchment'].concat(tileIso ? ['iso'] : []);
}
function nextBasemap() {
  const cyc = basemapCycle();
  return cyc[(cyc.indexOf(basemap) + 1) % cyc.length];
}

function setBasemap(name) {
  if (name === 'iso' && !tileIso) name = 'satellite';
  const from = basemap;
  const keepZoom = map.getZoom();
  // On retient la position courante en pixels image : les deux fonds n'ont pas
  // le même espace latlng, un simple setView(getCenter()) sauterait ailleurs.
  const keep = latLngToPx(map.getCenter());

  basemap = name;
  stopVertexEdit();

  [tileLayer, tileParchment, tileIso].forEach(l => { if (l && map.hasLayer(l)) map.removeLayer(l); });
  const layer = name === 'iso' ? tileIso : (name === 'parchment' ? tileParchment : tileLayer);
  layer.addTo(map).bringToBack();

  document.body.classList.toggle('parchment', name === 'parchment');
  document.body.classList.toggle('iso', name === 'iso');

  // Changement d'espace de coordonnées : bornes, zoom max et recentrage
  map.setMaxBounds(null);
  map.setMaxZoom(maxZoomFor(name));
  worldBounds = computeWorldBounds();
  const z = Math.max(0, Math.min(maxZoomFor(name), Math.round(keepZoom + zoomDelta(from, name))));
  map.setView(pxToLatLng(keep[0], keep[1]), z, { animate: false });
  map.setMaxBounds(worldBounds.pad(0.35));

  const btn = document.getElementById('btnBasemap');
  if (btn) {
    const nxt = nextBasemap();
    btn.textContent = BASEMAP_LABEL[nxt];
    btn.title = 'Fond affiché : ' + BASEMAP_LABEL[name].replace(/^\S+\s/, '') + ' — cliquer pour passer en ' +
                BASEMAP_LABEL[nxt].replace(/^\S+\s/, '');
  }

  renderAll();   // les royaumes et lieux se reprojettent dans le nouvel espace
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
  // édition des sommets pour un royaume
  if (kind === 'kingdom' && editMode) {
    startVertexEdit(id);
    showHint('Glisse un point pour le déplacer · clic sur un point = supprimer · clic sur un point creux = ajouter');
  } else stopVertexEdit();
}
function closeEditPanel() {
  document.getElementById('editPanel').classList.add('hidden');
  selected = null;
  stopVertexEdit();
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
  document.getElementById('btnBasemap').onclick = () => setBasemap(nextBasemap());
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
