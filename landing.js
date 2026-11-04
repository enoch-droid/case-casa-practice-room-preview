// Scroll reveals and the hero's looping interview demo. Everything is readable without this script.
document.documentElement.classList.add('js');
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

const seen = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); seen.unobserve(e.target); }
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach((n) => seen.observe(n));

const SCRIPT = [
  { t: 0, orb: 'speaking', state: 'Listen to the interviewer', pct: 25 },
  { t: 1, orb: 'listening', state: 'Take your time to think', pct: 25 },
  { t: 2, orb: 'listening', state: 'We\'re listening', pct: 35, who: 'you', name: 'You', say: 'I\'d split it into volume, price and cost. My hypothesis is that fewer people are coming through the doors.' },
  { t: 0, orb: 'speaking', state: 'Listen to the interviewer', pct: 50, who: 'interviewer', name: 'Interviewer', say: 'Good. Here are the numbers. What does the data tell you?' },
  { t: 1, orb: 'listening', state: 'Take your time to think', pct: 50 },
  { t: 2, orb: 'listening', state: 'We\'re listening', pct: 62, who: 'you', name: 'You', say: 'Admissions fell 20 percent. Higher prices hid part of it, so volume is the real problem.' },
  { t: 0, orb: 'speaking', state: 'Listen to the interviewer', pct: 75, who: 'interviewer', name: 'Interviewer', say: 'The CEO wants to launch a subscription. Does it add to profit?' },
];

const log = document.getElementById('demoLog');
const FIRST = log.innerHTML;
let i = 0;
function step() {
  if (i === SCRIPT.length) { i = 0; log.innerHTML = FIRST; }
  const s = SCRIPT[i++];
  document.getElementById('demoOrb').dataset.state = s.orb;
  document.getElementById('demoState').textContent = s.state;
  document.getElementById('demoPct').textContent = s.pct;
  document.getElementById('demoBar').style.width = `${s.pct}%`;
  document.querySelectorAll('.demo .turn-guide li').forEach((li) => li.classList.toggle('now', Number(li.dataset.t) === s.t));
  if (s.say) {
    const p = document.createElement('p');
    p.className = `who-${s.who}`;
    const b = document.createElement('b');
    b.textContent = s.name;
    p.append(b, s.say);
    log.append(p);
  }
  setTimeout(step, s.say ? 4200 : 2600);
}
if (calm) document.querySelector('.demo .turn-guide li').classList.add('now');
else step();
