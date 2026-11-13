(() => {
  'use strict';
  const MI = 1609.344, NOTE = 'Video may not include every part of this flight; the section over your location might not have been filmed or kept.';
  const $ = id => document.getElementById(id);
  const map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([39.6, -85.85], 10);
  // Base maps that work without a Referer (file:// offline copy) and without a key. OSM's own tile servers block Referer-less requests.
  const ESRI = 'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, HERE, Garmin, USGS, Maxar, Earthstar Geographics, &copy; OpenStreetMap contributors, and the GIS User Community';
  const street = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: ESRI }).addTo(map);   // CARTO answers 'API key required' without a Referer, so Esri everywhere
  const sat = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 19, attribution: ESRI }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: ESRI })]);
  const topo = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: ESRI });
  const bestLayer = L.layerGroup();
  window.PPCMAP = { map, bestLayer };   // for testing
  L.control.layers({ 'Street map': street, 'Satellite': sat, 'Topographic': topo }, { 'Best-of photos (Lightroom picks)': bestLayer }, { position: 'topright', collapsed: false }).addTo(map);
  let FL = [], ZONES = [], pick = null, pickMarker = null, circle = null, resLayer = L.layerGroup().addTo(map), hiLayer = L.layerGroup().addTo(map), phLayer = L.layerGroup().addTo(map), lastHits = [], selId = null;
  const yearsOn = new Set();

  // ---------- data
  (window.FLIGHTS_DATA ? Promise.resolve(window.FLIGHTS_DATA) : fetch('data/flights.json').then(r => r.json())).then(D => {   // offline build sets FLIGHTS_DATA via data/flights.js
    ZONES = D.zones || [];
    if (ZONES.length) document.getElementById('privacy').textContent = ' For privacy, a few private areas are left out of the tracks and photos.';
    FL = D.flights.map(f => {
      const segs = f.s.map(s => {
        const n = s.length / 4, t = new Float64Array(n), la = new Float64Array(n), lo = new Float64Array(n), ag = new Float32Array(n);
        let T = 0, A = 0, O = 0;
        for (let i = 0; i < n; i++) {
          T += s[4*i]; A += s[4*i+1]; O += s[4*i+2];
          t[i] = T; la[i] = A / 1e5; lo[i] = O / 1e5; ag[i] = s[4*i+3] < 0 ? NaN : s[4*i+3] * 10;
        }
        return { t, la, lo, ag };
      });
      let s0 = 90, n0 = -90, w0 = 180, e0 = -180;
      for (const g of segs) for (let i = 0; i < g.la.length; i++) { if (g.la[i] < s0) s0 = g.la[i]; if (g.la[i] > n0) n0 = g.la[i]; if (g.lo[i] < w0) w0 = g.lo[i]; if (g.lo[i] > e0) e0 = g.lo[i]; }
      const pp = (f.pp || []).map(p => ({ t: p[0], la: p[1] / 1e5, lo: p[2] / 1e5, id: p[3], hi: !!p[4] })).filter(p => !inZone(p.la, p.lo));
      const bp = (f.bp || []).map(p => ({ t: p[0], la: p[1] / 1e5, lo: p[2] / 1e5, r: p[3], pk: p[4], hd: p[5], agl: p[6], sub: p[7] || [], u: p[8] })).filter(p => !inZone(p.la, p.lo));
      return Object.assign(f, { y: +f.d.slice(0, 4), segs, pp, bp, bb: [s0, w0, n0, e0] });
    });
    FL.forEach(f => f.bp.forEach(p => bestPin(p, f, bestLayer, 4)));
    const yrs = [...new Set(FL.map(f => f.y))].sort();
    yrs.forEach(y => yearsOn.add(y));
    $('years').innerHTML = yrs.map(y => `<label><input type="checkbox" value="${y}" checked>${y}</label>`).join('');
    $('years').addEventListener('change', e => { const y = +e.target.value; e.target.checked ? yearsOn.add(y) : yearsOn.delete(y); e.target.parentNode.classList.toggle('off', !e.target.checked); run(); });
    setStatus(`<b>${FL.length}</b> GPS-tracked flights loaded. Search an address or tap the map.`);
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('lat') && h.get('lon')) setPick(+h.get('lat'), +h.get('lon'), true);
  }).catch(() => setStatus('Could not load the flight data. Please reload the page.'));

  // ---------- helpers
  const setStatus = h => { $('status').innerHTML = h; };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hav = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 2 * 6371000 * Math.asin(Math.sqrt(x)); };
  const inZone = (la, lo) => ZONES.length > 0 && ZONES.some(z => hav(la, lo, z[0], z[1]) < z[2] * MI);
  const fmtDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const fmtTime = t => new Date(t * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  const fmtDist = m => { const mi = m / MI; return mi < 0.1 ? `${Math.round(m * 3.281 / 10) * 10} ft` : `${mi.toFixed(2)} mi`; };

  // closest approach of flight f to (la0, lo0), in meters (equirectangular around the pick)
  function closest(f, la0, lo0, rM) {
    const kx = 111320 * Math.cos(la0 * Math.PI / 180), ky = 110540, pad = rM / ky * 1.2, padx = rM / kx * 1.2;
    if (la0 < f.bb[0] - pad || la0 > f.bb[2] + pad || lo0 < f.bb[1] - padx || lo0 > f.bb[3] + padx) return null;
    let best = { d: Infinity };
    for (const g of f.segs) {
      const n = g.la.length;
      let px = (g.lo[0] - lo0) * kx, py = (g.la[0] - la0) * ky;
      if (n === 1) { const d = Math.hypot(px, py); if (d < best.d) best = { d, t: g.t[0], ag: g.ag[0], la: g.la[0], lo: g.lo[0] }; continue; }
      for (let i = 1; i < n; i++) {
        const qx = (g.lo[i] - lo0) * kx, qy = (g.la[i] - la0) * ky, dx = qx - px, dy = qy - py, L2 = dx * dx + dy * dy;
        let u = L2 > 0 ? -(px * dx + py * dy) / L2 : 0; u = u < 0 ? 0 : u > 1 ? 1 : u;
        const d = Math.hypot(px + u * dx, py + u * dy);
        if (d < best.d) best = { d, t: g.t[i-1] + u * (g.t[i] - g.t[i-1]), ag: g.ag[i-1] + u * (g.ag[i] - g.ag[i-1]), la: g.la[i-1] + u * (g.la[i] - g.la[i-1]), lo: g.lo[i-1] + u * (g.lo[i] - g.lo[i-1]) };
        px = qx; py = qy;
      }
    }
    return best.d <= rM ? best : null;
  }

  function setPick(la, lo, fit) {
    pick = [la, lo];
    if (!pickMarker) pickMarker = L.marker(pick).addTo(map); else pickMarker.setLatLng(pick);
    history.replaceState(null, '', `#lat=${la.toFixed(5)}&lon=${lo.toFixed(5)}`);
    run(fit);
  }

  function run(fit) {
    if (!pick || !FL.length) return;
    const rM = +$('radius').value * MI;
    if (circle) circle.remove();
    circle = L.circle(pick, { radius: rM, color: '#2f5fb3', weight: 1.5, fillOpacity: 0.06 }).addTo(map);
    if (fit) map.fitBounds(circle.getBounds(), { maxZoom: 15, padding: [20, 20] });
    resLayer.clearLayers(); hiLayer.clearLayers(); phLayer.clearLayers(); $('results').innerHTML = ''; selId = null;
    if (inZone(pick[0], pick[1])) { lastHits = []; setStatus('No flight data shown for this area.'); return; }
    const t0 = performance.now();
    lastHits = [];
    for (const f of FL) { if (!yearsOn.has(f.y)) continue; const c = closest(f, pick[0], pick[1], rM); if (c) lastHits.push({ f, c }); }
    lastHits.sort((a, b) => b.c.t - a.c.t);
    const ms = Math.round(performance.now() - t0);
    const r = $('radius').selectedOptions[0].textContent;
    setStatus(lastHits.length ? `<b>${lastHits.length}</b> flight${lastHits.length > 1 ? 's' : ''} passed within ${r}, newest first. Tap one to see its track.` : `No tracked flights passed within ${r} of this spot${yearsOn.size < new Set(FL.map(f => f.y)).size ? ' in the selected years' : ''}.`);
    $('status').dataset.ms = ms;
    const frag = document.createDocumentFragment();
    lastHits.forEach(({ f, c }) => {
      const li = document.createElement('li'); li.dataset.id = f.id;
      const ht = !(f.agl && isFinite(c.ag)) ? 'height not available' : c.ag < 100 ? 'under 100 ft up' : `about ${(Math.round(c.ag / 50) * 50).toLocaleString()} ft up`;
      const vids = f.v.map(v => `<div class="vid">🎥 <a href="${esc(v.u)}" target="_blank" rel="noopener">${esc(v.t)}</a>${v.c === 'low' ? ' <span class="conf">(possible match)</span>' : ''}<span class="note">${NOTE}</span></div>`).join('');
      const near = f.pp.filter(p => hav(p.la, p.lo, pick[0], pick[1]) <= rM).sort((a, b) => hav(a.la, a.lo, pick[0], pick[1]) - hav(b.la, b.lo, pick[0], pick[1]));
      near.slice(0, 60).forEach(p => photoPin(p, phLayer, 5));
      let ph = '';
      if (near.length) ph += `<div class="photos">📷 <b>${near.length} photo${near.length > 1 ? 's' : ''} taken within ${$('radius').selectedOptions[0].textContent}</b>: ` +
        near.slice(0, 6).map(p => `<a href="${photoUrl(p.id)}" target="_blank" rel="noopener">${fmtTime(p.t)}</a> (${fmtDist(hav(p.la, p.lo, pick[0], pick[1]))})`).join(' · ') + (near.length > 6 ? ` · +${near.length - 6} more on the map` : '') + '</div>';
      if ((f.ph || []).length) ph += `<div class="photos">Facebook photo post${f.ph.length > 1 ? 's' : ''} from this flight: ` + f.ph.slice(0, 4).map(p => `<a href="${esc(p.u)}" target="_blank" rel="noopener">${fmtDate(p.pd)}</a> (${p.n} photo${p.n > 1 ? 's' : ''})`).join(' · ') + (f.ph.length > 4 ? ` · +${f.ph.length - 4} more` : '') + '</div>';
      if (f.lr) ph += `<div class="photos lr">🖼️ ${f.lr.n.toLocaleString()} photo${f.lr.n > 1 ? 's' : ''} in Scott's photo library from this flight` + (f.lr.np ? ` (${f.lr.np} posted)` : '') + (f.bp.length ? `, ${f.bp.length} best-of shown on the map when selected` : '') +
        (f.lr.lab ? ` · ${esc(f.lr.lab)}` : '') + (f.lr.sub.length ? `<br><span class="note">Possible subjects (a guess from the camera's direction): ${f.lr.sub.map(esc).join(', ')}</span>` : '') + '</div>';
      li.innerHTML = `<div class="r1"><span>${fmtDate(f.d)}</span><span>${fmtDist(c.d)} away</span></div>
        <div class="r2">Closest about ${fmtTime(c.t)} ET · ${ht}</div>
        <div class="r2">${esc(f.ac)} · ${esc(f.n)}</div>${vids}${ph}`;
      li.addEventListener('click', e => { if (e.target.tagName !== 'A') select(f.id); });
      frag.appendChild(li);
      f.segs.forEach(g => L.polyline([...g.la].map((a, i) => [a, g.lo[i]]), { color: '#2f5fb3', weight: 1.5, opacity: 0.35, interactive: false }).addTo(resLayer));
    });
    $('results').appendChild(frag);
  }

  function select(id) {
    const h = lastHits.find(x => x.f.id === id); if (!h) return;
    selId = id; hiLayer.clearLayers();
    document.querySelectorAll('#results li').forEach(li => li.classList.toggle('sel', li.dataset.id === id));
    const lines = h.f.segs.map(g => L.polyline([...g.la].map((a, i) => [a, g.lo[i]]), { color: '#f28c18', weight: 4, opacity: 0.95 }).addTo(hiLayer));
    L.circleMarker([h.c.la, h.c.lo], { radius: 6, color: '#b3261e', fillColor: '#fff', fillOpacity: 1, weight: 3 }).bindTooltip(`Closest: ${fmtDist(h.c.d)}, about ${fmtTime(h.c.t)} ET`).addTo(hiLayer);
    h.f.pp.forEach(p => photoPin(p, hiLayer, 3.5));
    h.f.bp.forEach(p => bestPin(p, h.f, hiLayer, 5));
    const b = L.featureGroup(lines).getBounds().extend(pick);
    map.fitBounds(b, { padding: [24, 24], maxZoom: 14 });
    if (window.innerWidth < 800) $('map').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function photoUrl(id) { return 'https://www.facebook.com/photo.php?fbid=' + encodeURIComponent(id); }
  function photoPin(p, layer, r) {
    L.circleMarker([p.la, p.lo], { radius: r, color: '#7b2cbf', weight: 1.5, fillColor: '#c77dff', fillOpacity: 0.9 })
      .bindPopup(`📷 Photo taken about ${fmtTime(p.t)} ET, ${new Date(p.t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })}<br><a href="${photoUrl(p.id)}" target="_blank" rel="noopener">Open on Facebook</a>`).addTo(layer);
  }

  function bestPin(p, f, layer, r) {
    const d = new Date(p.t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
    const bits = [p.hd ? `camera facing ${esc(p.hd)}` : '', p.agl >= 0 ? (p.agl < 100 ? 'under 100 ft up' : `about ${(Math.round(p.agl / 50) * 50).toLocaleString()} ft up`) : ''].filter(Boolean).join(', ');
    L.circleMarker([p.la, p.lo], { radius: r, color: '#9a6b00', weight: 1.5, fillColor: '#ffc93c', fillOpacity: 0.95 })
      .bindPopup(`⭐ Best-of photo (${p.pk ? 'pick' : p.r + '★'}), about ${fmtTime(p.t)} ET, ${d}<br>Aircraft position when taken${bits ? ' · ' + bits : ''}` +
        (p.sub.length ? `<br><i>Possible subjects (guess): ${p.sub.map(esc).join(', ')}</i>` : '') +
        (p.u ? `<br><a href="${esc(p.u)}" target="_blank" rel="noopener">Open on Facebook</a>` : '<br>Not posted online') + `<br><span style="color:#666">${esc(f.ac)} flight, ${fmtDate(f.d)}</span>`).addTo(layer);
  }

  // ---------- inputs
  map.on('click', e => setPick(e.latlng.lat, e.latlng.lng, false));
  $('radius').addEventListener('change', () => run(true));
  let lastQ = 0; const cache = new Map();
  $('search').addEventListener('submit', async e => {
    e.preventDefault();
    const q = $('q').value.trim(); if (!q) return;
    if (cache.has(q)) { const r = cache.get(q); return r ? setPick(r[0], r[1], true) : setStatus('No match for that address. Try adding the town, or tap the map.'); }
    const wait = 1100 - (Date.now() - lastQ); if (wait > 0) await new Promise(r => setTimeout(r, wait));   // geocoder etiquette: at most 1 request per second
    lastQ = Date.now(); $('go').disabled = true; setStatus('Searching…');
    let hit = null, ok = false;
    try {   // 1) Photon (komoot): keyless, CORS-open, works from file://; biased to central Indiana, US results preferred
      const r = await fetch('https://photon.komoot.io/api/?limit=5&lang=en&lat=39.6&lon=-85.9&q=' + encodeURIComponent(q));
      if (r.ok) { ok = true; const j = await r.json(); const fs = (j.features || []); const f = fs.find(x => x.properties && x.properties.countrycode === 'US') || fs[0];
        if (f) hit = [f.geometry.coordinates[1], f.geometry.coordinates[0]]; }
    } catch (_) {}
    if (!hit) try {   // 2) fallback: Nominatim
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&viewbox=-88.2,42.0,-80.5,37.7&q=' + encodeURIComponent(q));
      if (r.ok) { ok = true; const j = await r.json(); if (j[0]) hit = [+j[0].lat, +j[0].lon]; }
    } catch (_) {}
    $('go').disabled = false;
    if (hit) { cache.set(q, hit); setPick(hit[0], hit[1], true); }
    else setStatus(ok ? 'No match for that address. Try adding the town, or tap the map.' : 'Address search is unavailable right now. You can still tap the map.');
  });
  $('loc').addEventListener('click', () => {
    if (!navigator.geolocation) return setStatus('Your browser does not share location. Tap the map instead.');
    setStatus('Finding your location…');
    navigator.geolocation.getCurrentPosition(p => setPick(p.coords.latitude, p.coords.longitude, true), () => setStatus('Could not get your location. Search an address or tap the map.'), { enableHighAccuracy: true, timeout: 10000 });
  });
  window.__site = { setPick, select, hits: () => lastHits };
})();
