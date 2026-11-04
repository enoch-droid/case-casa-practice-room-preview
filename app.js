const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const motionOK = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;

const CHOICES = {
  feedback: {
    host: 'feedbackChoice', value: 'off',
    options: [
      ['off', 'Real interview', 'No help during the interview. Full results at the end.'],
      ['on', 'Coach me as I go', 'A short tip after each answer, plus full results at the end.'],
    ],
  },
  length: {
    host: 'lengthChoice', value: 'full',
    options: [
      ['full', 'Full interview', 'The whole interview, about 25 to 30 minutes.'],
      ['part', 'Just one part', 'Drill one skill in about 6 minutes.'],
    ],
  },
  format: {
    host: 'formatChoice', value: 'interviewer_led',
    options: [
      ['interviewer_led', 'The interviewer', 'You answer one question at a time.'],
      ['candidate_led', 'Me', 'You drive the case and ask for the data you need.'],
    ],
  },
  pressure: {
    host: 'pressureChoice', value: 'neutral',
    options: [
      ['supportive', 'Friendly', 'Patient, with small nudges.'],
      ['neutral', 'Realistic', 'Professional and hard to read.'],
      ['challenging', 'Tough partner', 'Pushes back on weak logic.'],
    ],
  },
};

const S = {
  cases: [], caseId: null, sessionId: null, step: 1,
  state: 'idle', queue: [], speakingNow: false, streamOpen: false, ending: false, discard: false,
  rec: null, finals: '', interim: '', recWanted: false,
  readyAt: 0, firstSpeechAt: 0, lang: 'en-US', offer: null, liveNode: null,
  sectionCount: 1, stageAt: 0, answersInStage: 0, pct: 0,
  voices: { interviewer: null, coach: null }, micFailed: false, currentVoice: null, startedAt: 0,
};

// ---------- navigation ----------

const VIEWS = ['step1', 'step2', 'step3', 'room', 'report', 'results'];

function show(view, step) {
  VIEWS.forEach((v) => { $(v).hidden = v !== view; });
  if (step) {
    S.step = step;
    document.querySelectorAll('#stepper li').forEach((li) => {
      const n = Number(li.dataset.step);
      li.classList.toggle('done', n < step);
      li.classList.toggle('now', n === step);
      if (n === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
  }
  $('navResults').hidden = view === 'room';
  document.body.classList.toggle('in-room', view === 'room');
  scrollTo({ top: 0 });
}

function goTo(n) {
  if (S.step === 3 && n !== 3) stopMicTest();
  if (n === 2) syncStep2();
  if (n === 3) syncStep3();
  show(`step${n}`, n);
}

// ---------- step 1: case ----------

async function init() {
  const [config, cases] = await Promise.all([fetch('/api/config').then((r) => r.json()), fetch('/api/cases').then((r) => r.json())]);
  if (config.preview) {
    showBanner('Preview: the interviewer follows a script and the results are a sample. The live version uses AI.');
    $('exportLink').hidden = true;
  } else if (config.mock) showBanner('Test mode: scripted replies, not a real AI interviewer.');
  else if (!config.hasCredentials) showBanner('The AI service is not set up yet, so interviews will not work.');
  S.cases = cases;
  renderCategories();

  Object.keys(CHOICES).forEach(renderChoices);
  $('name').value = localStorage.getItem('cr_name') || '';
  $('to2').onclick = () => goTo(2);
  $('to3').onclick = () => goTo(3);
  document.querySelectorAll('.back').forEach((b) => { b.onclick = () => goTo(Number(b.dataset.to)); });
  $('start').onclick = startSession;
  $('testVoice').onclick = () => speakOnce('Hello. This is how your interviewer will sound.');
  $('lang').onchange = () => { stopMicTest(); startMicTest(); };
  $('backHome').onclick = () => location.assign('./');
  $('navResults').onclick = openResults;
  $('resultsBack').onclick = () => location.assign('./');

  loadVoices();
  speechSynthesis?.addEventListener?.('voiceschanged', loadVoices);
  goTo(1);
}

function showBanner(text) { $('banner').hidden = false; $('banner').textContent = text; }

const LEVELS = { 1: 'Foundation', 2: 'Intermediate', 3: 'Advanced' };

const levelMark = (level) => {
  const m = el('span', { className: 'level' },
    el('span', { className: 'pips' }, ...[1, 2, 3].map((n) => el('i', { className: n <= level ? 'on' : '' }))),
    LEVELS[level]);
  return m;
};

/** Groups cases by category, ordered by case count with fit last. Each group runs easiest to hardest. */
function renderCategories() {
  const groups = new Map();
  for (const c of S.cases) groups.set(c.category, [...(groups.get(c.category) ?? []), c]);
  const ordered = [...groups].sort(([, a], [, b]) => (a[0].kind === 'fit') - (b[0].kind === 'fit'));

  $('cases').replaceChildren(...ordered.map(([name, list], i) => {
    const sorted = [...list].sort((a, b) => a.level - b.level || a.title.localeCompare(b.title));
    const head = el('button', { className: 'cat-head', type: 'button' },
      el('span', { className: 'cat-index', textContent: String(i + 1).padStart(2, '0') }),
      el('span', { className: 'cat-name', textContent: name }),
      el('span', { className: 'cat-count', textContent: `${sorted.length} ${sorted[0].kind === 'fit' ? 'interview' : sorted.length === 1 ? 'case' : 'cases'}` }),
      el('span', { className: 'cat-arrow', 'aria-hidden': 'true' }));
    const rows = el('div', { className: 'cat-rows' }, ...sorted.map((c) => {
      const row = el('button', { className: 'case-row', type: 'button' },
        el('span', { className: 'case-main' }, el('b', { textContent: c.title }), el('span', { textContent: c.theme })),
        levelMark(c.level));
      row.setAttribute('role', 'radio');
      row.setAttribute('aria-checked', String(c.id === S.caseId));
      row.dataset.id = c.id;
      row.onclick = () => pickCase(c);
      return row;
    }));
    rows.setAttribute('role', 'radiogroup');
    rows.setAttribute('aria-label', name);
    const panel = el('div', { className: 'cat-panel' }, el('div', { className: 'cat-clip' }, rows));
    const box = el('div', { className: 'cat' }, head, panel);
    head.setAttribute('aria-expanded', 'false');
    panel.inert = true;
    head.onclick = () => {
      const open = !box.classList.contains('open');
      document.querySelectorAll('.cat').forEach((x) => {
        x.classList.remove('open');
        x.querySelector('.cat-head').setAttribute('aria-expanded', 'false');
        x.querySelector('.cat-panel').inert = true;
      });
      if (open) {
        box.classList.add('open');
        head.setAttribute('aria-expanded', 'true');
        panel.inert = false;
      }
    };
    return box;
  }));
}

function pickCase(c) {
  S.caseId = c.id;
  document.querySelectorAll('.case-row').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.id === c.id)));
  $('picked').textContent = `Selected: ${c.title}`;
  $('to2').disabled = false;
}

// ---------- step 2: options ----------

function renderChoices(key) {
  const group = CHOICES[key];
  $(group.host).replaceChildren(...group.options.map(([value, title, hint]) => {
    const b = el('button', { className: 'choice', type: 'button' }, el('b', { textContent: title }), el('span', { textContent: hint }));
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(value === group.value));
    b.onclick = () => {
      group.value = value;
      renderChoices(key);
      if (key === 'length') syncStep2();
    };
    return b;
  }));
}

const currentCase = () => S.cases.find((c) => c.id === S.caseId);

function syncStep2() {
  const c = currentCase();
  $('chosenCase').textContent = `${c.title}: ${c.theme}.`;
  $('formatRow').hidden = c.kind === 'fit';
  $('partRow').hidden = CHOICES.length.value !== 'part';
  const current = $('part').value;
  $('part').replaceChildren(...c.drills.map((d) => el('option', { value: String(d.index), textContent: d.name })));
  if ([...$('part').options].some((o) => o.value === current)) $('part').value = current;
}

const label = (key) => CHOICES[key].options.find(([v]) => v === CHOICES[key].value)[1];

// ---------- step 3: mic check ----------

function syncStep3() {
  localStorage.setItem('cr_name', $('name').value.trim());
  const c = currentCase();
  const items = [
    ['Case', c.title],
    ['Feedback', label('feedback')],
    ['Length', CHOICES.length.value === 'part' ? `One part: ${$('part').selectedOptions[0]?.textContent}` : 'Full interview'],
    ['Interviewer', label('pressure')],
  ];
  $('summary').replaceChildren(...items.map(([k, v]) => el('li', {}, el('b', { textContent: k }), v)));
  startMicTest();
}

const mic = { stream: null, ctx: null, raf: 0, rec: null, wanted: false };

async function startMicTest() {
  const status = $('micStatus');
  status.className = 'mic-status';
  status.textContent = 'Starting your microphone…';
  $('micHeard').textContent = '';
  S.micFailed = false;
  if (!Recognition) {
    S.micFailed = true;
    status.className = 'mic-status bad';
    status.textContent = 'This browser cannot do voice. Use Chrome, Edge or Safari, or type your answers.';
    return;
  }
  try {
    mic.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    S.micFailed = true;
    status.className = 'mic-status bad';
    status.textContent = 'Microphone is blocked. Allow it in your browser and reload, or type your answers.';
    return;
  }
  status.textContent = 'Your mic is on. Say something…';
  drawMeter();
  mic.wanted = true;
  listenForTest();
}

function drawMeter() {
  try {
    mic.ctx = new AudioContext();
    const an = mic.ctx.createAnalyser();
    an.fftSize = 512;
    mic.ctx.createMediaStreamSource(mic.stream).connect(an);
    const data = new Uint8Array(an.fftSize);
    const tick = () => {
      an.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      $('micBar').style.width = `${Math.min(100, peak * 2.4)}%`;
      mic.raf = requestAnimationFrame(tick);
    };
    tick();
  } catch { /* the meter is a nicety: the transcription below still proves the mic works */ }
}

function listenForTest() {
  const rec = new Recognition();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = $('lang').value;
  rec.onresult = (e) => {
    const text = [...e.results].map((r) => r[0].transcript).join(' ').trim();
    $('micHeard').textContent = `We heard: "${text}"`;
    $('micStatus').className = 'mic-status ok';
    $('micStatus').textContent = '✓ We can hear you. You\'re ready.';
  };
  rec.onend = () => { if (mic.wanted) { try { listenForTest(); } catch { /* retried on next end */ } } };
  mic.rec = rec;
  try { rec.start(); } catch { /* already running */ }
}

function stopMicTest() {
  mic.wanted = false;
  cancelAnimationFrame(mic.raf);
  try { mic.rec?.stop(); } catch { /* not running */ }
  mic.stream?.getTracks?.().forEach((t) => t.stop());
  mic.ctx?.close().catch(() => {});
  mic.stream = null; mic.ctx = null; mic.rec = null;
  $('micBar').style.width = '0';
}

function loadVoices() {
  const en = (speechSynthesis?.getVoices?.() || []).filter((v) => v.lang?.startsWith('en'));
  const pick = (names) => names.map((n) => en.find((v) => v.name.includes(n))).find(Boolean);
  S.voices.interviewer = pick(['Google UK English Male', 'Daniel', 'Google US English', 'Samantha']) || en[0] || null;
  S.voices.coach = pick(['Google UK English Female', 'Samantha', 'Karen', 'Google US English']) || en[1] || en[0] || null;
}

function speakOnce(text) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = S.voices.interviewer;
  speechSynthesis.speak(u);
}

// ---------- step 4: interview ----------

async function startSession() {
  stopMicTest();
  const c = currentCase();
  S.lang = $('lang').value;
  const part = CHOICES.length.value === 'part' ? Number($('part').value) : null;
  const feedback = CHOICES.feedback.value === 'on';
  const res = await fetch('/api/sessions', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ candidate: $('name').value.trim(), caseId: c.id, format: CHOICES.format.value, pressure: CHOICES.pressure.value, feedback, drillStage: part }),
  });
  if (!res.ok) return showBanner('Could not start the session. Please try again.');
  S.sessionId = (await res.json()).id;

  show('room', 4);
  $('roomTitle').textContent = c.title;
  const sections = part != null ? c.drills.filter((d) => d.index === part) : c.drills;
  $('caseProgress').replaceChildren(...sections.map((d, i) => {
    const li = el('li', { textContent: `${i + 1}. ${d.name}` });
    li.dataset.index = d.index;
    return li;
  }));
  markStage(part ?? sections[0].index);
  $('feedbackRoom').checked = feedback;
  $('feedbackRoom').onchange = () => { if (!$('feedbackRoom').checked && S.offer) chooseCoach(false); };
  S.sectionCount = sections.length;
  $('talk').onclick = primaryAction;
  $('sendTyped').onclick = sendTyped;
  armEndButton();
  document.addEventListener('keydown', onKey);
  // A mouse click on a toggle must not leave it focused, or a later key press could flip it mid-answer.
  document.querySelectorAll('.roombar .toggle').forEach((t) => t.addEventListener('click', (e) => {
    if (e.detail > 0) setTimeout(() => document.activeElement?.blur(), 0);
  }));
  S.startedAt = Date.now();
  S.timer = setInterval(() => {
    const s = Math.floor((Date.now() - S.startedAt) / 1000);
    $('timer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);
  sendTurn('');
}

function markStage(index) {
  const items = [...$('caseProgress').children];
  const at = items.findIndex((li) => Number(li.dataset.index) === index);
  if (at < 0) return; // a surprise pivot has no label of its own: stay on the current one
  items.forEach((li, i) => {
    li.classList.toggle('done', i < at);
    li.classList.toggle('now', i === at);
  });
  if (at > S.stageAt) { S.stageAt = at; S.answersInStage = 0; }
  updateProgress();
}

/** An estimate: completed sections, plus part of the current one that grows with each answer. */
function updateProgress(final = false) {
  const within = Math.min(0.9, 1 - 0.6 ** S.answersInStage);
  const raw = final ? 100 : Math.floor(((S.stageAt + within) / S.sectionCount) * 100);
  S.pct = Math.max(S.pct, Math.min(raw, 100)); // never moves backwards
  $('pct').textContent = `${S.pct}%`;
  $('pctBar').style.width = `${S.pct}%`;
  $('progress').setAttribute('aria-valuenow', S.pct);
}

function armEndButton() {
  const b = $('endBtn');
  let armed = false;
  b.onclick = () => {
    if (armed) return finish();
    armed = true;
    b.textContent = 'Click again to end';
    b.classList.add('danger');
    setTimeout(() => { armed = false; b.textContent = 'End interview'; b.classList.remove('danger'); }, 3500);
  };
}

const STATES = {
  idle: { orb: 'idle', turn: 'listen', label: 'Getting ready', hint: '', btn: '' },
  speaking: { orb: 'speaking', turn: 'listen', label: 'Listen to the interviewer', hint: 'Your mic turns on when they finish.', btn: 'Skip to my answer' },
  offer: { orb: 'idle', turn: 'listen', label: 'Your coach has a tip', hint: 'Would you like to hear it, or carry on with the interview?', btn: '' },
  coach: { orb: 'speaking', turn: 'listen', label: 'Your coach is speaking', hint: 'The interview continues right after this.', btn: 'Skip this tip' },
  waiting: { orb: 'thinking', turn: 'listen', label: 'The interviewer is responding', hint: 'One moment.', btn: '' },
  thinking: { orb: 'listening', turn: 'think', label: 'Take your time to think', hint: 'Silence is fine. Nothing is timing you. Start talking when you\'re ready.', btn: 'Submit' },
  answering: { orb: 'listening', turn: 'speak', label: 'We\'re listening', hint: 'When you\'ve finished, press Submit or Enter.', btn: 'Submit' },
  typing: { orb: 'idle', turn: 'speak', label: 'Your turn', hint: 'Voice is off, so please type your answer below.', btn: '' },
};

function setState(state) {
  S.state = state;
  const v = STATES[state];
  $('orb').dataset.state = v.orb;
  $('stateLabel').textContent = v.label;
  $('stateHint').textContent = v.hint;
  $('talk').textContent = v.btn || 'Please wait';
  $('talk').disabled = !v.btn;
  $('talk').hidden = state === 'offer';
  document.querySelectorAll('#turnGuide li').forEach((li) => {
    const now = li.dataset.turn === v.turn;
    li.classList.toggle('now', now);
    if (now) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
}

const isListening = () => S.state === 'thinking' || S.state === 'answering';

function primaryAction() {
  if (S.offer) return chooseCoach(true);
  if (S.state === 'speaking' || S.state === 'coach') return interrupt();
  if (isListening()) finishAnswer();
}

function onKey(e) {
  if (e.repeat || e.isComposing) return;
  if (e.key === 'Escape' && S.offer) return chooseCoach(false);
  if (e.key !== 'Enter') return;
  if (e.target.id === 'typed') {
    if (!e.shiftKey) { e.preventDefault(); sendTyped(); }
    return;
  }
  // Focused controls keep their native Enter behaviour, including the main button's click.
  if (['TEXTAREA', 'INPUT', 'SELECT', 'BUTTON', 'SUMMARY', 'A'].includes(e.target.tagName)) return;
  e.preventDefault();
  primaryAction();
}

async function sendTurn(text, meta = {}) {
  // The interviewer had already closed the interview when the candidate interrupted.
  if (S.ending) return void finish();
  S.discard = false;
  S.streamOpen = true;
  setState('waiting');
  $('coach').hidden = true;
  try {
    const res = await fetch(`/api/sessions/${S.sessionId}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, feedback: $('feedbackRoom').checked, ...meta }),
    });
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed');
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let cut;
      while ((cut = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        const ev = block.match(/^event: (.*)$/m)?.[1];
        const data = block.match(/^data: (.*)$/m)?.[1];
        if (ev) onEvent(ev, data ? JSON.parse(data) : {});
      }
    }
  } catch {
    onEvent('error', { message: 'Connection lost. Please send your answer again.', restoreText: text || null });
  }
  S.streamOpen = false;
  pump();
}

function onEvent(ev, d) {
  if (ev === 'coach') return offerCoach(d);
  if (ev === 'coach_error') return showBanner(d.message);
  if (ev === 'exhibit') return addExhibit(d);
  if (ev === 'stage') return markStage(d.index);
  if (ev === 'end') { S.ending = true; updateProgress(true); return; }
  if (ev === 'sentence') {
    if (S.discard) return;
    S.queue.push({ text: d.text, voice: 'interviewer' });
    pump();
    return;
  }
  if (ev === 'error') {
    showBanner(d.message);
    if (d.restoreText) {
      $('typed').value = d.restoreText;
      document.querySelector('.typed').open = true;
    }
  }
}

// The tip stays private until asked for. The interviewer's reply waits in the queue meanwhile.
function offerCoach(fb) {
  S.offer = fb;
  const hear = el('button', { className: 'primary', type: 'button', textContent: 'Hear the tip' });
  const skip = el('button', { className: 'ghost', type: 'button', textContent: 'Skip and continue' });
  hear.onclick = () => chooseCoach(true);
  skip.onclick = () => chooseCoach(false);
  const box = $('coach');
  box.dataset.rating = '';
  box.replaceChildren(el('div', { className: 'row center' }, hear, skip), el('p', { className: 'keys', textContent: 'Enter to hear it. Esc to skip.' }));
  box.hidden = false;
  setState('offer');
}

function chooseCoach(hear) {
  const fb = S.offer;
  if (!fb) return;
  S.offer = null;
  const box = $('coach');
  if (hear) {
    box.dataset.rating = fb.rating;
    box.replaceChildren(el('h2', { textContent: 'Coach tip' }), el('p', { textContent: fb.worked }), el('p', { textContent: fb.fix }));
    addLine('Coach', `${fb.worked} ${fb.fix}`);
    if (fb.spoken) S.queue.unshift({ text: fb.spoken, voice: 'coach' });
  } else {
    box.hidden = true;
  }
  pump();
}

function addExhibit(ex) {
  if ($(`ex-${ex.id}`)) return;
  $('noExhibits').hidden = true;
  const box = el('div', { className: 'exhibit', id: `ex-${ex.id}` }, el('h3', { textContent: ex.title }));
  if (ex.columns?.length) {
    box.append(el('table', {},
      el('thead', {}, el('tr', {}, ...ex.columns.map((c) => el('th', { textContent: c, scope: 'col' })))),
      el('tbody', {}, ...ex.rows.map((r) => el('tr', {}, ...r.map((c) => el('td', { textContent: c })))))));
  }
  (ex.lines || []).forEach((t) => box.append(el('p', { textContent: t })));
  $('exhibits').prepend(box);
}

let lastSpeaker = null, lastLine = null;

/** Keeps the newest words in view, unless the reader has scrolled up to reread something. */
function withFollow(change) {
  const box = $('transcript');
  const following = box.scrollHeight - box.scrollTop - box.clientHeight < 70;
  change();
  if (following) box.scrollTo({ top: box.scrollHeight, behavior: motionOK() ? 'smooth' : 'auto' });
}

function newLine(who) {
  lastLine = el('p', { className: `who-${who.toLowerCase()}` }, el('b', { textContent: who }));
  $('transcript').append(lastLine);
  lastSpeaker = who;
}

function addLine(who, text, merge = false) {
  withFollow(() => {
    if (!(merge && lastSpeaker === who && lastLine)) newLine(who);
    lastLine.append(el('span', { className: 'words', textContent: `${text} ` }));
  });
}

/** The candidate's words appear as they are recognised, then settle when submitted. */
function showLive(text) {
  withFollow(() => {
    if (!S.liveNode) {
      newLine('You');
      lastLine.classList.add('is-live');
      S.liveNode = el('span', { className: 'words' });
      lastLine.append(S.liveNode);
    }
    S.liveNode.textContent = text;
  });
}

function settleLive(text) {
  if (!S.liveNode) return addLine('You', text);
  S.liveNode.textContent = text;
  S.liveNode.parentElement.classList.remove('is-live');
  S.liveNode = null;
}

function pump() {
  if (S.speakingNow || S.offer) return;
  // After an interruption the candidate is mid-answer: a stream ending must not disturb that.
  if (isListening()) return;
  const next = S.queue.shift();
  if (!next) {
    if (S.streamOpen) { if (S.state !== 'waiting') setState('waiting'); return; }
    if (S.ending) return void finish();
    becomeReady();
    return;
  }
  setState(next.voice === 'coach' ? 'coach' : 'speaking');
  S.speakingNow = true;
  S.currentVoice = next.voice;
  if (next.voice === 'interviewer') addLine('Interviewer', next.text, true); // appears as it is spoken
  let settled = false;
  const u = new SpeechSynthesisUtterance(next.text);
  u.voice = S.voices[next.voice];
  u.rate = next.voice === 'coach' ? 1.08 : 1.0;
  const done = () => {
    if (settled) return;
    settled = true;
    clearTimeout(watchdog);
    S.speakingNow = false;
    pump();
  };
  // Some browsers never fire `end`, which would otherwise leave the room stuck.
  const watchdog = setTimeout(done, 3000 + next.text.split(/\s+/).length * 600);
  u.onend = done;
  u.onerror = done;
  S.cancelSpeech = done;
  speechSynthesis.speak(u);
}

function interrupt() {
  // Skipping the coach's tip must not lose the interviewer's next question.
  if (S.currentVoice === 'coach') {
    speechSynthesis.cancel();
    S.cancelSpeech?.();
    return;
  }
  S.discard = true;
  S.queue.length = 0;
  S.readyAt = performance.now();
  S.firstSpeechAt = 0;
  setState('thinking'); // set first, so the pump triggered by cancelling leaves the mic alone
  speechSynthesis.cancel();
  S.cancelSpeech?.();
  startListening();
}

function becomeReady() {
  S.readyAt = performance.now();
  S.firstSpeechAt = 0;
  startListening(); // hands-free: the mic opens as soon as the interviewer stops
}

function startListening() {
  if (S.micFailed) return becomeTyping();
  if (!S.readyAt) S.readyAt = performance.now();
  S.finals = ''; S.interim = ''; S.recWanted = true;
  setState('thinking');
  openRecognizer();
}

function becomeTyping() {
  setState('typing');
  document.querySelector('.typed').open = true;
  S.readyAt ||= performance.now();
}

function openRecognizer() {
  const rec = new Recognition();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = S.lang;
  rec.onresult = (e) => {
    if (!S.firstSpeechAt) S.firstSpeechAt = performance.now();
    if (S.state === 'thinking') setState('answering');
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) S.finals += `${r[0].transcript.trim()} `;
      else interim += r[0].transcript;
    }
    S.interim = interim;
    showLive((S.finals + interim).trim());
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      S.recWanted = false;
      S.micFailed = true;
      showBanner('Voice input was blocked. Allow the microphone and reload, or type your answers.');
      becomeTyping();
    }
  };
  // Browsers close the recogniser after a pause. Thinking in silence is allowed, so reopen it.
  rec.onend = () => { if (S.recWanted) { try { openRecognizer(); } catch { /* reopened on the next end */ } } };
  S.rec = rec;
  try { rec.start(); } catch { /* already running */ }
}

function stopRecognizer() {
  S.recWanted = false;
  try { S.rec?.stop(); } catch { /* not running */ }
}

function finishAnswer() {
  if (!isListening()) return;
  const text = `${S.finals}${S.interim}`.trim();
  if (!text) {
    $('stateHint').textContent = 'We haven\'t heard anything yet. Check your mic, or choose "Prefer to type?" below.';
    return;
  }
  stopRecognizer();
  const now = performance.now();
  const thinkMs = S.firstSpeechAt ? S.firstSpeechAt - S.readyAt : null;
  const speakMs = S.firstSpeechAt ? now - S.firstSpeechAt : null;
  settleLive(text);
  S.readyAt = 0;
  S.answersInStage++;
  updateProgress();
  sendTurn(text, { thinkMs, speakMs, inputMode: 'voice' });
}

function sendTyped() {
  const text = $('typed').value.trim();
  if (!text || S.streamOpen || S.state === 'speaking' || S.state === 'coach') return;
  stopRecognizer();
  $('typed').value = '';
  const thinkMs = S.readyAt ? performance.now() - S.readyAt : null;
  if (S.liveNode) { S.liveNode.parentElement.remove(); S.liveNode = null; lastSpeaker = null; }
  addLine('You', text);
  S.readyAt = 0;
  S.answersInStage++;
  updateProgress();
  sendTurn(text, { thinkMs, inputMode: 'typed' });
}

// ---------- step 5: results ----------

async function finish() {
  if (S.finishing) return;
  S.finishing = true;
  stopRecognizer();
  clearInterval(S.timer);
  S.queue.length = 0;
  speechSynthesis.cancel();
  document.removeEventListener('keydown', onKey);
  show('report', 5);
  $('exportLink').href = `/api/sessions/${S.sessionId}/export.md`;
  const orb = el('div', { className: 'orb' });
  orb.dataset.state = 'thinking';
  $('reportBody').replaceChildren(el('div', { className: 'loading' }, orb,
    el('h1', { textContent: 'Reviewing your interview' }),
    el('p', { textContent: 'This usually takes under a minute.' })));
  const res = await fetch(`/api/sessions/${S.sessionId}/end`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ notes: $('notes').value }),
  });
  const body = await res.json();
  if (!res.ok) {
    $('reportBody').replaceChildren(el('h1', { textContent: 'We could not finish your results' }), el('p', { className: 'lead', textContent: body.error }));
    return;
  }
  renderReport(body);
}

function countUp(node, target) {
  if (!motionOK() || !target) { node.textContent = target || 'n/a'; return; }
  const start = performance.now();
  const tick = (t) => {
    const p = Math.min(1, (t - start) / 1100);
    node.textContent = Math.round(target * (1 - (1 - p) ** 3));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const RATING_LABEL = { 0: 'Not observed', 1: 'Below the bar', 2: 'Borderline', 3: 'At the bar', 4: 'Above the bar' };

function renderReport({ report: r, previousScore, modelAnswer, workedNumbers }) {
  let n = 0, delay = 0;
  const sect = (title, ...kids) => {
    const s = el('section', { className: 'sect' },
      el('div', { className: 'sect-head' }, el('span', { textContent: ++n }), el('h2', { textContent: title })), ...kids);
    s.style.animationDelay = `${(delay += 110)}ms`;
    return s;
  };
  const bullets = (items) => el('ul', {}, ...items.map((t) => el('li', { textContent: t })));
  const change = previousScore != null && r.overall_score ? r.overall_score - previousScore : null;
  const scoreNode = el('b', { textContent: '0' });

  const hero = el('div', { className: 'hero view' },
    el('div', { className: 'bigscore' }, scoreNode, r.overall_score ? el('small', { textContent: '/100' }) : ''),
    el('div', {},
      el('p', { className: 'hero-label', textContent: 'Interviewer\'s decision' }),
      el('p', { className: 'verdict', textContent: r.verdict }),
      change != null ? el('span', { className: 'chip', textContent: `${change >= 0 ? '+' : ''}${change} since your last interview` }) : '',
      el('p', { textContent: r.headline })));

  const parts = [hero];
  const bars = [];
  parts.push(sect('How you were rated', ...r.scores.map((s) => {
    const fill = el('i');
    const legacy = s.rating == null;
    bars.push([fill, legacy ? s.score || 0 : s.rating * 25]);
    return el('div', { className: 'score' },
      el('div', {},
        el('div', { className: 'score-head' }, el('b', { textContent: s.dimension }), el('span', { className: `rating r${s.rating ?? ''}`, textContent: legacy ? (s.score ? `${s.score}/100` : 'Not observed') : RATING_LABEL[s.rating] })),
        el('div', { className: 'bar' }, fill),
        el('p', { className: 'ev', textContent: s.evidence }),
        s.advice ? el('p', {}, el('span', { className: 'tag', textContent: 'At the bar' }), s.advice) : ''));
  })));
  if (r.question_reviews?.length) {
    parts.push(sect('Question by question', ...r.question_reviews.map((q) => el('div', { className: 'qreview' },
      el('div', { className: 'q-level', title: 'Level reached, out of 3' }, el('small', { textContent: 'Level' }), `${q.level}`),
      el('div', {},
        el('b', { textContent: q.question }),
        el('p', {}, el('span', { className: 'tag', textContent: 'Covered' }), q.covered),
        el('p', {}, el('span', { className: 'tag', textContent: 'For the next level' }), q.missing))))));
  }
  if (r.priorities?.length) parts.push(sect('What would change the decision', bullets(r.priorities)));
  if (r.strengths?.length) parts.push(sect('Strengths to keep', bullets(r.strengths)));
  if (modelAnswer) {
    parts.push(sect('What a strong answer looks like', el('p', { textContent: modelAnswer }),
      el('details', {}, el('summary', { textContent: 'See the worked numbers' }), el('p', { className: 'worked', textContent: workedNumbers }))));
  }
  parts.push(sect('Your next drill', el('p', { textContent: r.next_drill })));

  $('reportBody').replaceChildren(...parts);
  countUp(scoreNode, r.overall_score);
  requestAnimationFrame(() => requestAnimationFrame(() => bars.forEach(([f, v]) => { f.style.width = `${v}%`; })));
}

// ---------- my results ----------

async function openResults() {
  stopMicTest();
  const rows = await fetch('/api/sessions').then((r) => r.json());
  const titles = Object.fromEntries(S.cases.map((c) => [c.id, c.title]));
  show('results');
  $('resultsLead').textContent = rows.length ? 'Open any past interview to see your score and transcript.' : 'Your finished interviews will appear here.';
  $('history').replaceChildren(...rows.map((r) => {
    const b = el('button', { type: 'button' },
      el('span', { textContent: `${titles[r.case_id] || r.case_id}${r.candidate && r.candidate !== 'Candidate' ? `, ${r.candidate}` : ''}` }),
      el('small', { textContent: `${new Date(r.started_at).toLocaleDateString()} · ${r.answers} answers${r.has_report ? '' : ' · no results'}` }));
    b.onclick = () => showStored(r.id);
    return el('li', {}, b);
  }));
}

async function showStored(id) {
  const d = await fetch(`/api/sessions/${id}`).then((r) => r.json());
  show('report');
  S.sessionId = id;
  $('exportLink').href = `/api/sessions/${id}/export.md`;
  if (d.session.report) renderReport({ ...d, report: d.session.report });
  else $('reportBody').replaceChildren(el('h1', { textContent: d.session.case_title }), el('p', { className: 'lead', textContent: 'This interview ended before results were created.' }));
  const log = el('section', { className: 'sect' }, el('h2', { textContent: 'Transcript' }), ...d.turns.map((t) => {
    let text = t.text, who = t.role === 'candidate' ? 'You' : 'Interviewer';
    if (t.role === 'coach') { const f = JSON.parse(t.text); who = 'Coach'; text = `${f.worked} ${f.fix}`; }
    const meta = t.role === 'candidate' ? `${t.input_mode === 'typed' ? 'typed' : 'spoken'}${t.think_ms != null ? `, paused ${Math.round(t.think_ms / 1000)}s` : ''}${t.speak_ms != null ? `, spoke ${Math.round(t.speak_ms / 1000)}s` : ''}, ${t.words} words, coach tips ${t.feedback_on ? 'on' : 'off'}` : '';
    return el('div', { className: 'report-turn' }, el('b', { textContent: `${who}: ` }), text, meta ? el('small', { textContent: meta }) : '');
  }));
  $('reportBody').append(log);
}

init();
