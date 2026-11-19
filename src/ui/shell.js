// The app around the finder: top tabs, the mission survey, the close-up that pops out of the globe, the street
// view, and presenter notes. It drives the mission steps (flow.js) instead of showing them:
//   Moon        flow step 2: the globe, the best regions, and the chosen region's map as a pop-out card
//   Site        flow step 3: the region's map full size, map layers and the rover's drive
//   Street view the street view (public/Street-view/) at the landing spot, as its own page
//   Ride        flow step 5: the rover's-eye ride along the planned drive, with the credits roll
//   Learn       the education pages (education/)
// The mission questions are the Mission step's own, not a copy: mission-questions.js (data/missions.json profiles).
import missions from '../../data/missions.json';
import { formatDuration } from '../mission.js';
import { clear, h } from './dom.js';
import { TAB_STEPS, tabOfStep } from './flow-state.js';
import { RIDE_FAILED } from './flow.js';
import { GROUPS, choiceRow, dateRow, durationRow, groupSummary } from './mission-questions.js';

const $ = (id) => document.getElementById(id);

const picture = (src) => (/^https?:/.test(src) ? src : `${import.meta.env.BASE_URL}${src}`);

export function createShell({ app, flow, finder, globe, getMission, setMission }) {
  const regions = missions.regions;
  let tab = 'moon';

  // ---- top bar ---------------------------------------------------------------------------------------------
  const tabs = { moon: $('tabMoon'), site: $('tabSite'), street: $('tabStreet'), ride: $('tabRide') };
  tabs.moon.onclick = () => show('moon');
  tabs.site.onclick = () => show('site');
  tabs.street.onclick = () => show('street');
  tabs.ride.onclick = () => show('ride');
  $('changeMission').onclick = () => openSurvey();
  $('notesBtn').onclick = () => ($('notes').hidden = !$('notes').hidden);
  addEventListener('keydown', (e) => {
    if ((e.key === 'n' || e.key === 'N') && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) $('notes').hidden = !$('notes').hidden;
  });

  function markTabs() {
    for (const [k, el] of Object.entries(tabs)) el.setAttribute('aria-current', k === tab ? 'page' : 'false');
    app.dataset.tab = tab;
  }

  async function show(next) {
    if (next !== 'street') closeStreet();
    if (next === 'moon') {
      if (flow.getStep() < 2) return openSurvey();
      await flow.go(TAB_STEPS.moon);
    } else if (next === 'site') {
      if (flow.getStep() < 2) return openSurvey();
      await flow.go(TAB_STEPS.site);
      if (flow.getStep() !== TAB_STEPS.site) return flash('Pick a region with room to land first.');
    } else if (next === 'street') {
      if (!openStreet()) return;
    } else if (next === 'ride') {
      if (flow.getStep() < 2) return openSurvey();
      // The ride follows the planned drive, so it opens from the drive's own view (the Site tab).
      if (flow.getStep() < TAB_STEPS.site) await flow.go(TAB_STEPS.site);
      // No drive yet (the Moon tab plans one for its pop-out, but only once it has been on screen): plan the
      // finder's own suggestion, so the ride is one click from any tab.
      if (flow.getStep() === TAB_STEPS.site && !finder.getRoute()?.targets?.length) finder.suggestDrive();
      const why = await flow.ride();
      if (why) {
        syncTab();
        return why === RIDE_FAILED ? undefined : flash(why);
      }
    }
    tab = next;
    markTabs();
    drawSummary();
  }
  let flashTimer = 0;
  function flash(text) {
    const el = $('status');
    el.hidden = false;
    el.textContent = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (el.hidden = true), 4000);
  }

  // ---- mission summary (left panel, one line) ---------------------------------------------------------------
  function drawSummary() {
    const m = getMission();
    const v = finder.values;
    const saved = /profile=(\w+)/.exec(location.hash)?.[1];
    const profile = missions.profiles.find((p) => p.id === (saved ?? answer.profile)) ?? missions.profiles[0];
    const day = m.start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    clear($('missionLine')).append(
      h('div', { class: 'eyebrow' }, 'Your mission'),
      h('div', { class: 'mission-name' }, profile.id === 'custom' ? 'Custom mission' : profile.blurb),
      h('div', { class: 'mission-sub' }, `lands ${day} · ${formatDuration(m.durationHours)} · slopes under ${v.maxLandingSlopeDeg}°`),
      h('button', { type: 'button', class: 'primary change', onClick: () => openSurvey() }, 'Change mission'),
      h(
        'details',
        { class: 'more' },
        h('summary', {}, 'Mission details'),
        h(
          'ul',
          { class: 'chips' },
          GROUPS.filter((group) => !group.date)
            .flatMap((group) => groupSummary(group, (def) => v[def.key], m.start).map((said) => `${group.title.toLowerCase()}: ${said}`))
            .map((t) => h('li', {}, t)),
        ),
      ),
    );
  }

  // ---- mission questions (the old Mission step, as a short series of cards) -------------------------------------
  let q = 0;
  // The draft: nothing is applied to the app until "Find regions that fit".
  const answer = { profile: 'nasa', start: null, hours: 336, values: {} };
  const draftOf = (def) => (def.on === 'mission' ? answer.hours : answer.values[def.key]);
  const draft = (def, value) => {
    if (def.on === 'mission') answer.hours = value;
    else answer.values[def.key] = value;
    drawSurvey();
  };
  function openSurvey() {
    const m = getMission();
    // before the first search, start from the Pre-set mission's own date (data/missions.json), not the app's default
    const preset = missions.profiles.find((p) => p.id === 'nasa');
    const first = flow.getStep() < 2;
    answer.start = first ? new Date(preset.mission.start) : new Date(m.start);
    answer.hours = first ? preset.mission.durationHours : m.durationHours;
    answer.values = first ? { ...preset.finder } : { ...finder.values };
    q = 0;
    $('survey').hidden = false;
    drawSurvey();
  }
  const choose = (id) => {
    const profile = missions.profiles.find((p) => p.id === id);
    answer.profile = id;
    answer.values = { ...profile.finder };
    if (id === 'nasa') { answer.start = new Date(profile.mission.start); answer.hours = profile.mission.durationHours; }
    drawSurvey();
  };
  function missionCard(profile) {
    return h(
      'button',
      { type: 'button', class: 'profile-card', 'aria-pressed': String(answer.profile === profile.id), onClick: () => choose(profile.id) },
      profile.pictures?.length
        ? h('span', { class: 'pics' }, profile.pictures.map((pic) => h('img', { src: picture(pic.src), alt: pic.alt, title: pic.credit, style: `flex: ${pic.width ?? 100} 1 0; object-position: ${pic.position ?? '50% 50%'}` })))
        : null,
      h('strong', {}, profile.name),
      h('span', {}, profile.blurb),
    );
  }
  function drawSurvey() {
    const preset = answer.profile !== 'custom';
    const pages = [
      () => [
        h('h3', { class: 'poster-title' }, h('span', {}, 'Plan'), ' ', h('span', {}, 'a mission')),
        h('div', { class: 'profile-cards' }, missions.profiles.map(missionCard)),
        preset
          ? h('ul', { class: 'facts' }, missions.profiles.find((p) => p.id === answer.profile).facts.map((f) => h('li', { title: missions.sources[f.source]?.title ?? '' }, f.text)))
          : h('p', {}, 'Next: the mission, the lander and the rover.'),
      ],
    ];
    if (!preset) {
      for (const group of GROUPS) {
        pages.push(() => [
          h('h3', {}, group.title),
          group.date ? dateRow(answer.start, (start) => { answer.start = start; drawSurvey(); }) : null,
          ...group.choices.map((def) => (def.slider ? durationRow : choiceRow)(def, draftOf(def), (value) => draft(def, value))),
        ]);
      }
    }
    q = Math.min(q, pages.length - 1);
    clear($('surveyDots')).append(...pages.map((_, i) => h('i', { class: i <= q ? 'on' : '' })));
    $('surveyCount').textContent = pages.length > 1 ? `Step ${q + 1} of ${pages.length}` : 'Your mission';
    clear($('surveyBody')).append(...pages[q]().flat().filter(Boolean));
    $('surveyBack').style.visibility = q ? 'visible' : 'hidden';
    $('surveyNext').textContent = q === pages.length - 1 ? 'Find regions that fit →' : 'Next';
    $('surveyNext').onclick = () => (q < pages.length - 1 ? (q++, drawSurvey()) : finishSurvey());
    $('surveyBack').onclick = () => q > 0 && (q--, drawSurvey());
  }
  $('surveyClose').onclick = () => {
    if (flow.getStep() >= 2) $('survey').hidden = true;
    else finishSurvey(); // first visit: closing it runs the Pre-set mission
  };
  async function finishSurvey() {
    flow.debug.useProfile(answer.profile);
    Object.assign(finder.values, answer.values);
    finder.drawForm();
    setMission({ start: answer.start, durationHours: answer.hours });
    $('survey').hidden = true;
    closeStreet();
    if (flow.getStep() === 2) await flow.go(1); // a changed mission searches again
    await flow.go(2);
    tab = 'moon';
    markTabs();
    drawSummary();
  }

  // ---- the close-up that pops out of the globe (Moon tab) ---------------------------------------------------
  $('popOpen').onclick = () => show('site');
  $('popStand').onclick = () => show('street');
  const suggested = { result: null, since: 0, done: false };
  /** The pop-out is small: zoom its map in on the drive (the full map is one click away under "Open site"). */
  const MAP_MARGIN = 12; // src/finder/map-view.js MARGIN
  function zoomPopToRoute(result) {
    const canvas = $('finderCanvas');
    const path = finder.getRoute()?.plan?.path;
    if (!result || !path?.length) return void (canvas.style.transform = '');
    const n = result.n;
    let r0 = n, r1 = 0, c0 = n, c1 = 0;
    for (const i of path) { const r = Math.floor(i / n), c = i % n; r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); }
    const W = canvas.clientWidth, H = canvas.clientHeight, size = Math.min(W, H) - 2 * MAP_MARGIN, bx = (W - size) / 2, by = (H - size) / 2;
    const px = (c) => bx + ((c + 0.5) / n) * size, py = (r) => by + ((r + 0.5) / n) * size;
    const span = Math.max(px(c1) - px(c0), py(r1) - py(r0), 1);
    const s = Math.min(2.6, Math.max(1, (0.6 * Math.min(W, H)) / span));
    const cx = (px(c0) + px(c1)) / 2, cy = (py(r0) + py(r1)) / 2;
    const tx = Math.min(0, Math.max(W - s * W, W / 2 - s * cx)), ty = Math.min(0, Math.max(H - s * H, H / 2 - s * cy));
    canvas.style.transformOrigin = '0 0';
    canvas.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(3)})`;
  }
  /** Keep the tabs in step with what is on screen (a reload or a saved address can land on any view). */
  function syncTab() {
    const want = tabOfStep(flow.getStep());
    if (tab === 'street' || !want || want === tab) return;
    tab = want;
    markTabs();
    drawSummary();
  }
  flow.listenStep(syncTab);
  function drawLead() {
    requestAnimationFrame(drawLead);
    const svg = $('leadLine');
    const region = flow.getRegion?.();
    if (tab !== 'moon' || flow.getStep() !== 2 || !region || $('finder').hidden) {
      $('finderCanvas').style.transform = '';
      return void (svg.innerHTML = '');
    }
    // The pop-out shows the rover's drive too: plan one (the finder's own "Suggest a drive") when a region opens.
    const result = finder.getResult?.();
    if (result && result !== suggested.result) { suggested.result = result; suggested.since = Date.now(); suggested.done = false; }
    // keep trying for a while: the drive can only be planned once the region and the rover's reach are ready
    if (result && Date.now() - suggested.since < 15000 && !finder.getRoute()?.targets?.length) {
      if (finder.suggestDrive()) suggested.done = true;
    }
    zoomPopToRoute(result);
    const p = globe.debug.screenOf(region.lat, region.lon);
    const card = $('finder').getBoundingClientRect();
    const stage = $('stage').getBoundingClientRect();
    if (!p) return void (svg.innerHTML = '');
    const x2 = card.left - stage.left, y2 = card.bottom - stage.top - 60;
    svg.innerHTML = `<path d="M${p.x},${p.y} C${p.x + 90},${p.y - 30} ${x2 - 80},${y2} ${x2},${y2}" fill="none" stroke="#ff6a3d" stroke-width="1.5" stroke-dasharray="5 4"/><circle cx="${p.x}" cy="${p.y}" r="13" fill="none" stroke="#ff6a3d" stroke-width="1.5"/>`;
    $('popTitle').textContent = region.name;
  }
  requestAnimationFrame(drawLead);

  // ---- street view, inside the app ---------------------------------------------------------------------------
  // The street view opens as its own page (same tab), with the app's top bar: VR can only start from a top-level
  // page with some browsers and emulators, and this keeps "Enter VR" one click. Moon / Site there come back here
  // (the address keeps the mission, region and route, so the app restores itself).
  function openStreet() {
    const start = finder.getRoute()?.start;
    const region = flow.getRegion?.();
    if (!start) {
      flash('Pick a region with room to land first: the street view opens at its landing spot.');
      return false;
    }
    // No summary numbers are passed any more: the street view shows no numbers panel when it is opened from the
    // app (Daniel, 2026-11-15).
    const q = new URLSearchParams({
      lat: start.lat.toFixed(5),
      lon: start.lon.toFixed(5),
      name: region ? `${region.name} · landing spot` : 'Landing spot',
      start: getMission().start.toISOString(),
      app: location.pathname + location.search + location.hash,
    });
    if (location.search.includes('vr-test')) q.set('vr-test', '');
    location.href = `/Street-view/index.html?${q}`;
    return false; // this page is leaving
  }
  function closeStreet() {
    $('svWrap').hidden = true;
    app.classList.remove('street-open');
  }

  // ---- layout of the Moon tab: the regions list moves into its own card on the right; the globe loses its grid --
  {
    const section = $('regions').closest('section');
    const card = h('div', { class: 'regions-card panel-card', id: 'regionsCard' });
    $('stage').append(card);
    card.append(section);
    section.querySelector('.step-title').textContent = 'Best regions';
    globe.setOption('grid', false);
  }

  // ---- start ------------------------------------------------------------------------------------------------
  // A saved address (a reload, a shared link, coming back from the street view page) goes straight back; a first
  // visit starts with the survey. flow.savedStep says which: by now the address itself has been rewritten.
  const begin = () => {
    if (flow.getStep() >= 2) {
      tab = tabOfStep(flow.getStep());
      markTabs();
      drawSummary();
    } else {
      openSurvey();
      markTabs();
    }
  };
  if (flow.savedStep < 2) setTimeout(begin, 300);
  else {
    // Going back walks through the earlier views on the way to the saved one. Keep them off the screen until it
    // is there: about a second with kept searches, 4 seconds at most (a slow search then shows its progress).
    app.classList.add('restoring');
    const lift = () => app.classList.remove('restoring');
    flow.ready.finally(lift);
    setTimeout(lift, 4000);
    // The Moon tab comes first and the tabs follow from there (syncTab). If it never comes, start with the survey.
    const began = Date.now();
    const wait = () => (flow.getStep() >= 2 || Date.now() - began > 20000 ? begin() : setTimeout(wait, 100));
    wait();
  }
  return { show, openSurvey };
}
