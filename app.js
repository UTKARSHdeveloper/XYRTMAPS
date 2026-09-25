const CONFIG = window.APP_CONFIG || {};

const state = {
  map: null,
  Route: null,
  routes: [],
  scoredRoutes: [],
  polylines: [],
  currentPosition: null,
  selectedIndex: 0,
};

const $ = (id) => document.getElementById(id);
const els = {
  origin: $('origin'), destination: $('destination'), locateBtn: $('locateBtn'), routeBtn: $('routeBtn'),
  avoidTolls: $('avoidTolls'), avoidHighways: $('avoidHighways'), status: $('status'), loading: $('loading'),
  errorBox: $('errorBox'), decisionPanel: $('decisionPanel'), decisionHeadline: $('decisionHeadline'),
  decisionReason: $('decisionReason'), decisionBadges: $('decisionBadges'), routesPanel: $('routesPanel'), routeList: $('routeList'),
};

function setStatus(message, type = '') {
  els.status.textContent = message;
  els.status.className = `status ${type}`.trim();
}
function showError(message) { els.errorBox.textContent = message; els.errorBox.classList.remove('hidden'); }
function clearError() { els.errorBox.textContent = ''; els.errorBox.classList.add('hidden'); }
function setLoading(on) { els.loading.classList.toggle('hidden', !on); els.routeBtn.disabled = on; }
function fmtDistance(m) { return Number.isFinite(m) ? (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`) : '—'; }
function fmtTime(ms) {
  if (!Number.isFinite(ms)) return '—';
  const min = Math.max(1, Math.round(ms / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}m`;
}
function esc(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function analyzeRoute(route, index) {
  const duration = Number(route.durationMillis || 0);
  const staticDuration = Number(route.staticDurationMillis || duration);
  const distance = Number(route.distanceMeters || 0);
  const trafficDelayMs = Math.max(0, duration - staticDuration);
  const trafficRatio = staticDuration > 0 ? trafficDelayMs / staticDuration : 0;
  const avgSpeedKmh = duration > 0 ? (distance / 1000) / (duration / 3600000) : 0;

  let maneuverPenalty = 0;
  let uTurns = 0, merges = 0, turns = 0, hardManeuvers = 0;
  const steps = [];

  for (const leg of route.legs || []) {
    for (const step of leg.steps || []) {
      const maneuver = String(step.maneuver || '').toUpperCase();
      const instruction = String(step.instructions || '');
      steps.push({ maneuver, instruction, distanceMeters: Number(step.distanceMeters || 0) });

      if (/U.?TURN/.test(maneuver)) { uTurns++; maneuverPenalty += 120; }
      else if (maneuver.includes('MERGE')) { merges++; maneuverPenalty += 18; }
      else if (maneuver.includes('ROUNDABOUT')) { turns++; maneuverPenalty += 10; }
      else if (maneuver.includes('LEFT') || maneuver.includes('RIGHT')) { turns++; maneuverPenalty += 4; }

      if (maneuver.includes('SHARP') || maneuver.includes('HAIRPIN')) { hardManeuvers++; maneuverPenalty += 40; }
    }
  }

  // Travel time remains dominant. Maneuver penalties discourage routes that are
  // awkward to execute without allowing a small convenience penalty to override
  // a large real-world traffic advantage.
  const scoreSeconds = duration / 1000 + maneuverPenalty;
  const trafficClass = trafficRatio >= 0.55 ? 'Heavy traffic' : trafficRatio >= 0.25 ? 'Moderate traffic' : 'Free-flowing';

  return {
    index, route, duration, staticDuration, distance, trafficDelayMs, trafficRatio, avgSpeedKmh,
    maneuverPenalty, uTurns, merges, turns, hardManeuvers, steps, scoreSeconds, trafficClass,
  };
}

function scoreRoutes(routes) {
  const parsed = routes.map(analyzeRoute);
  const fastest = Math.min(...parsed.map(r => r.scoreSeconds));
  return parsed
    .map(r => {
      const timeGap = r.scoreSeconds - fastest;
      let confidence = 92 - Math.min(25, r.trafficRatio * 28) - Math.min(12, r.uTurns * 6);
      confidence = Math.max(55, Math.round(confidence));
      return { ...r, timeGap, confidence };
    })
    .sort((a, b) => a.scoreSeconds - b.scoreSeconds);
}

function reasons(item, selected) {
  const list = [];
  if (item.avgSpeedKmh > 0) list.push(`averages about ${Math.round(item.avgSpeedKmh)} km/h`);
  if (item.trafficDelayMs >= 60000) list.push(`traffic adds about ${fmtTime(item.trafficDelayMs)}`);
  else list.push('has relatively low traffic delay');
  if (item.uTurns) list.push(`contains ${item.uTurns} U-turn${item.uTurns > 1 ? 's' : ''}`);
  if (item.hardManeuvers) list.push(`${item.hardManeuvers} difficult maneuver${item.hardManeuvers > 1 ? 's' : ''}`);
  if (item.index !== selected.index && item.timeGap > 60) list.push(`about ${fmtTime(item.timeGap * 1000)} slower than the selected route`);
  return list.slice(0, 3);
}

function clearPolylines() {
  for (const p of state.polylines) p.setMap(null);
  state.polylines = [];
}

function drawRoutes(scored, selected) {
  clearPolylines();
  // Alternatives first; selected route last so it stays visually dominant.
  const ordered = [...scored].sort((a, b) => Number(a.index === selected.index) - Number(b.index === selected.index));
  for (const item of ordered) {
    const isSelected = item.index === selected.index;
    const polylines = item.route.createPolylines({
      polylineOptions: {
        map: state.map,
        strokeOpacity: isSelected ? 0.95 : 0.38,
        strokeWeight: isSelected ? 6 : 4,
      },
    });
    state.polylines.push(...polylines);
  }
  if (selected.route.viewport) state.map.fitBounds(selected.route.viewport, 56);
}

function renderDecision(selected, scored) {
  els.decisionPanel.classList.remove('hidden');
  els.routesPanel.classList.remove('hidden');
  const why = reasons(selected, selected);
  els.decisionHeadline.textContent = `Route ${selected.index + 1} selected`;
  els.decisionReason.textContent = why.length
    ? `Lowest current route cost because it ${why.join(', ')}.`
    : 'Lowest current predicted travel cost.';
  els.decisionBadges.innerHTML = [
    `${fmtTime(selected.duration)} ETA`, fmtDistance(selected.distance), `${Math.round(selected.avgSpeedKmh)} km/h avg`, `${selected.confidence}% confidence`
  ].map(x => `<span class="badge">${esc(x)}</span>`).join('');

  els.routeList.innerHTML = scored.map(item => {
    const active = item.index === selected.index;
    const reason = reasons(item, selected)[0] || item.trafficClass;
    return `<button class="route-card ${active ? 'active' : ''}" data-index="${item.index}">
      <div class="route-card-top"><div><div class="route-name">Route ${item.index + 1}${active ? ' · recommended' : ''}</div><div class="route-desc">${esc(item.route.description || 'Alternative route')}</div></div><div class="route-time">${fmtTime(item.duration)}</div></div>
      <div class="route-metrics"><span>${fmtDistance(item.distance)}</span><span>${Math.round(item.avgSpeedKmh)} km/h</span><span>${esc(item.trafficClass)}</span></div>
      <div class="route-reason">${esc(reason)}</div>
    </button>`;
  }).join('');

  els.routeList.querySelectorAll('.route-card').forEach(card => card.addEventListener('click', () => {
    const chosen = scored.find(r => r.index === Number(card.dataset.index));
    if (!chosen) return;
    state.selectedIndex = chosen.index;
    drawRoutes(scored, chosen);
    renderDecision(chosen, scored);
  }));
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation is not supported by this browser.'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      e => reject(new Error(`Location access failed (${e.code}). Allow location access and try again.`)),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
    );
  });
}

async function useCurrentLocation() {
  try {
    clearError(); setStatus('Getting your current location…');
    state.currentPosition = await getPosition();
    els.origin.value = 'Current location';
    state.map.setCenter(state.currentPosition); state.map.setZoom(15);
    setStatus('Current location ready.');
  } catch (e) { showError(e.message); setStatus('Location unavailable.', 'error'); }
}

async function resolveOrigin() {
  const value = els.origin.value.trim();
  if (!value || value.toLowerCase() === 'current location') {
    if (!state.currentPosition) state.currentPosition = await getPosition();
    return state.currentPosition;
  }
  return value;
}

async function calculateRoutes() {
  clearError();
  const destination = els.destination.value.trim();
  if (!destination) { showError('Enter a destination first.'); els.destination.focus(); return; }

  setLoading(true); setStatus('Analyzing live traffic and route alternatives…');
  try {
    const origin = await resolveOrigin();
    const request = {
      origin,
      destination,
      travelMode: 'DRIVING',
      routingPreference: 'TRAFFIC_AWARE',
      computeAlternativeRoutes: true,
      departureTime: new Date(),
      routeModifiers: { avoidTolls: els.avoidTolls.checked, avoidHighways: els.avoidHighways.checked },
      fields: ['path', 'viewport', 'durationMillis', 'staticDurationMillis', 'distanceMeters', 'routeLabels', 'description', 'legs', 'legs.steps'],
    };

    const response = await state.Route.computeRoutes(request);
    if (!response?.routes?.length) throw new Error('Google returned no drivable route for this trip.');

    state.routes = response.routes;
    state.scoredRoutes = scoreRoutes(response.routes);
    const selected = state.scoredRoutes[0];
    state.selectedIndex = selected.index;
    drawRoutes(state.scoredRoutes, selected);
    renderDecision(selected, state.scoredRoutes);
    setStatus(`Analyzed ${state.scoredRoutes.length} route candidate${state.scoredRoutes.length === 1 ? '' : 's'}.`);
  } catch (e) {
    console.error(e);
    showError(e?.message || 'Route calculation failed. Check your Google Maps setup and try again.');
    setStatus('Route calculation failed.', 'error');
  } finally { setLoading(false); }
}

async function init() {
  if (!CONFIG.GOOGLE_MAPS_API_KEY || CONFIG.GOOGLE_MAPS_API_KEY.includes('YOUR_')) {
    throw new Error('Add your Google Maps Platform browser key to config.js before using the app.');
  }

  await new Promise((resolve, reject) => {
    if (window.google?.maps) return resolve();
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(CONFIG.GOOGLE_MAPS_API_KEY)}&v=weekly`;
    script.async = true; script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Google Maps failed to load. Check API enablement, billing, key restrictions and the deployed domain.'));
    document.head.appendChild(script);
  });

  const [{ Map }, { Route }] = await Promise.all([
    google.maps.importLibrary('maps'),
    google.maps.importLibrary('routes'),
  ]);
  state.Route = Route;
  state.map = new Map($('map'), {
    center: { lat: 28.6139, lng: 77.2090 }, zoom: 12,
    streetViewControl: false, mapTypeControl: false, fullscreenControl: false,
  });
}

els.locateBtn.addEventListener('click', () => void useCurrentLocation());
els.routeBtn.addEventListener('click', () => void calculateRoutes());
els.destination.addEventListener('keydown', e => { if (e.key === 'Enter') void calculateRoutes(); });

(async () => {
  try { await init(); setStatus('Map ready. Enter a destination.'); }
  catch (e) { console.error(e); showError(e.message); setStatus('Setup required.', 'error'); }
})();
