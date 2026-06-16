/* ═══════════════════════════════════════════════════════════
   humusic — script.js
   Only functional animations. Every effect serves a purpose.
   ═══════════════════════════════════════════════════════════ */

'use strict';

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

/* ──────────────────── Nav scroll state ──────────────────── */
const navbar = $('#navbar');
function onScroll() {
  navbar.classList.toggle('scrolled', window.scrollY > 24);
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ──────────────────── Mobile menu ──────────────────── */
const hamburger  = $('#hamburger');
const mobileMenu = $('#mobileMenu');
const mobileClose = $('#mobileClose');

function openMenu() {
  mobileMenu.classList.add('open');
  mobileMenu.setAttribute('aria-hidden', 'false');
  hamburger.setAttribute('aria-expanded', 'true');
  hamburger.classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeMenu() {
  mobileMenu.classList.remove('open');
  mobileMenu.setAttribute('aria-hidden', 'true');
  hamburger.setAttribute('aria-expanded', 'false');
  hamburger.classList.remove('active');
  document.body.style.overflow = '';
}

hamburger.addEventListener('click', openMenu);
mobileClose.addEventListener('click', closeMenu);
$$('.mobile-link').forEach(l => l.addEventListener('click', closeMenu));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && mobileMenu.classList.contains('open')) closeMenu();
});

/* ──────────────────── Footer year ──────────────────── */
const yearEl = $('#footerYear');
if (yearEl) yearEl.textContent = new Date().getFullYear();

/* ══════════════════════════════════════════════════════════
   HERO CANVAS — waveform audio visualization
   Colors calibrated to match amber design system
══════════════════════════════════════════════════════════ */
class HeroWave {
  constructor() {
    this.canvas = $('#heroCanvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.t   = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize(), { passive: true });
    this.animate();
  }

  resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.W = this.canvas.width;
    this.H = this.canvas.height;
  }

  drawWave(phase, freq, amp, alpha, lw, r, g, b) {
    const { ctx, W, H } = this;
    const cy = H * 0.52;
    ctx.beginPath();
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.lineWidth   = lw;

    for (let x = 0; x <= W; x += 3) {
      const p   = x / W;
      const env = Math.sin(p * Math.PI);
      const y   = cy + Math.sin(p * Math.PI * freq + phase) * amp * env;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  drawBars() {
    const { ctx, W, H } = this;
    const cy       = H * 0.52;
    const barCount = Math.min(72, Math.floor(W / 18));
    const spacing  = W / barCount;

    for (let i = 0; i < barCount; i++) {
      const x     = i * spacing + spacing / 2;
      const phase = (i / barCount) * Math.PI * 6 + this.t * 0.7;
      const h     = (Math.sin(phase) * 0.5 + 0.5) * 64 + 6;
      const alpha = (Math.sin(phase) * 0.5 + 0.5) * 0.08 + 0.02;

      const grad = ctx.createLinearGradient(0, cy - h, 0, cy + h);
      grad.addColorStop(0,   `rgba(196,123,56,0)`);
      grad.addColorStop(0.5, `rgba(196,123,56,${alpha})`);
      grad.addColorStop(1,   `rgba(196,123,56,0)`);

      ctx.fillStyle = grad;
      const bw = Math.max(2, spacing * 0.35);
      ctx.fillRect(x - bw / 2, cy - h, bw, h * 2);
    }
  }

  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    // Layer 1 — slow, wide  (amber)
    this.drawWave(this.t * 0.5,  5,  80, 0.55, 2,   196, 123, 56);
    // Layer 2 — mid         (amber, lighter)
    this.drawWave(this.t * 0.8 + 1, 8, 44, 0.30, 1.5, 217, 149,  80);
    // Layer 3 — fast, thin  (amber, very faint)
    this.drawWave(this.t * 1.3 + 2, 13, 26, 0.15, 1,   196, 123, 56);
    // Accent — slow, very subtle (warm grey)
    this.drawWave(this.t * 0.3 + 4, 3, 100, 0.07, 1,   216, 212, 206);
    // Vertical bars
    this.drawBars();

    this.t += 0.020;
  }

  animate() {
    this.draw();
    requestAnimationFrame(() => this.animate());
  }
}

/* ══════════════════════════════════════════════════════════
   HERO PARTICLES — minimal floating note symbols
══════════════════════════════════════════════════════════ */
class HeroParticles {
  constructor() {
    this.container = $('#heroParticles');
    if (!this.container) return;
    this.symbols = ['♩','♪','♫','♬'];
    this.count   = window.innerWidth < 600 ? 6 : 12;
    this.spawn();
  }

  spawn() {
    for (let i = 0; i < this.count; i++) {
      const el = document.createElement('span');
      el.className   = 'particle';
      el.textContent = this.symbols[Math.floor(Math.random() * this.symbols.length)];
      el.style.cssText = `
        left: ${Math.random() * 100}%;
        bottom: -40px;
        font-size: ${Math.random() * 0.7 + 0.75}rem;
        --dur-float: ${Math.random() * 22 + 14}s;
        --delay: ${Math.random() * -28}s;
        --rot: ${(Math.random() - 0.5) * 90}deg;
      `;
      this.container.appendChild(el);
    }
  }
}

/* ══════════════════════════════════════════════════════════
   STEP CANVAS — live waveform in step 1 visualization
══════════════════════════════════════════════════════════ */
class StepWave {
  constructor() {
    this.canvas = $('#stepCanvas1');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.t   = 0;
    this.w   = this.canvas.width;
    this.h   = this.canvas.height;
    this.animate();
  }

  draw() {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);

    // Subtle grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth   = 1;
    for (let y = 0; y <= h; y += h / 4) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    const cy = h / 2;
    const waves = [
      { freq: 4,  amp: 46, alpha: 0.8, lw: 2,   speed: 1.0 },
      { freq: 7,  amp: 26, alpha: 0.45, lw: 1.5, speed: 1.35 },
      { freq: 2,  amp: 58, alpha: 0.18, lw: 1,   speed: 0.55 },
    ];

    waves.forEach(({ freq, amp, alpha, lw, speed }) => {
      ctx.beginPath();
      ctx.strokeStyle = `rgba(196,123,56,${alpha})`;
      ctx.lineWidth   = lw;

      for (let x = 0; x <= w; x += 2) {
        const p   = x / w;
        const env = Math.sin(p * Math.PI);
        const y   = cy + Math.sin(p * Math.PI * freq + this.t * speed) * amp * env;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    });

    // Playhead — communicates active recording
    const px = (this.t * 11) % w;
    ctx.strokeStyle = 'rgba(196,123,56,0.5)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
    ctx.setLineDash([]);

    // REC indicator
    ctx.fillStyle = 'rgba(180, 50, 50, 0.82)';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(8, 8, 44, 17, 3) : ctx.rect(8, 8, 44, 17);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 8px "Space Mono", monospace';
    ctx.fillText('● REC', 13, 20);

    this.t += 0.028;
  }

  animate() {
    this.draw();
    requestAnimationFrame(() => this.animate());
  }
}

/* ══════════════════════════════════════════════════════════
   STAFF NOTES — reveals output notation in step 3
══════════════════════════════════════════════════════════ */
class StaffAnimator {
  constructor() {
    this.container = $('#staffNotes');
    if (!this.container) return;
    this.positions = [
      { left: '4%',  top: '-3px' },
      { left: '17%', top: '14px' },
      { left: '30%', top: '-3px' },
      { left: '43%', top: '30px' },
      { left: '56%', top: '14px' },
      { left: '69%', top: '-11px' },
      { left: '81%', top: '22px' },
    ];
    this.idx = 0;
    this.next();
  }

  next() {
    if (this.idx >= this.positions.length) return;
    setTimeout(() => {
      const pos  = this.positions[this.idx];
      const note = document.createElement('div');
      note.className = 'staff-note';
      note.style.left = pos.left;
      note.style.top  = pos.top;
      this.container.appendChild(note);
      this.idx++;
      this.next();
    }, 400 + this.idx * 90);
  }
}

/* ══════════════════════════════════════════════════════════
   SCROLL REVEAL — IntersectionObserver
══════════════════════════════════════════════════════════ */
class ScrollReveal {
  constructor() {
    this.els = $$('.reveal');
    this.io  = new IntersectionObserver(
      entries => entries.forEach(({ target, isIntersecting }) => {
        if (!isIntersecting) return;
        target.classList.add('visible');
        this.io.unobserve(target);
      }),
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );
    this.els.forEach(el => {
      const delay = parseInt(el.dataset.delay || '0', 10);
      el.style.transitionDelay = `${delay}ms`;
      this.io.observe(el);
    });
  }
}

/* ══════════════════════════════════════════════════════════
   COUNTER ANIMATION — stats count up when entering view
══════════════════════════════════════════════════════════ */
class CounterAnimator {
  constructor() {
    const els = $$('.count');
    if (!els.length) return;
    const io = new IntersectionObserver(
      entries => entries.forEach(({ target, isIntersecting }) => {
        if (!isIntersecting || target.dataset.done) return;
        target.dataset.done = '1';
        this.run(target);
      }),
      { threshold: 0.6 }
    );
    els.forEach(el => io.observe(el));
  }

  run(el) {
    const target = parseInt(el.dataset.target, 10);
    const dur    = 1600;
    const start  = performance.now();

    const tick = now => {
      const t = Math.min((now - start) / dur, 1);
      // ease-out cubic
      el.textContent = Math.round((1 - Math.pow(1 - t, 3)) * target);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

/* ══════════════════════════════════════════════════════════
   CONTACT FORM — opens mailto with pre-filled content
══════════════════════════════════════════════════════════ */
class ContactForm {
  constructor() {
    this.form    = $('#contactForm');
    this.success = $('#formSuccess');
    if (!this.form) return;
    this.form.addEventListener('submit', e => this.onSubmit(e));
  }

  onSubmit(e) {
    e.preventDefault();
    const data    = new FormData(this.form);
    const name    = data.get('name')    || '';
    const email   = data.get('email')   || '';
    const reason  = data.get('reason')  || 'General question';
    const message = data.get('message') || '';

    const subject = encodeURIComponent(`[humusic] ${reason} — from ${name}`);
    const body    = encodeURIComponent(
      `Hi Dayton,\n\nMy name is ${name} (${email}).\nReason: ${reason}\n\n${message}\n\nBest,\n${name}`
    );

    window.location.href = `mailto:daybarrett09@gmail.com?subject=${subject}&body=${body}`;

    setTimeout(() => {
      this.form.style.display = 'none';
      this.success.classList.add('show');
    }, 400);
  }
}

/* ══════════════════════════════════════════════════════════
   HERO WORD CYCLER — cycles descriptive words in headline
══════════════════════════════════════════════════════════ */
class WordCycler {
  constructor() {
    this.el    = $('#waveWord');
    if (!this.el) return;
    this.words = ['sound', 'melody', 'humming', 'audio', 'music'];
    this.idx   = 0;
    this.el.style.transition = 'opacity 280ms ease, transform 280ms ease';
    this.el.style.display    = 'inline-block';
    setInterval(() => this.cycle(), 2600);
  }

  cycle() {
    this.el.style.opacity   = '0';
    this.el.style.transform = 'translateY(-6px)';
    setTimeout(() => {
      this.idx = (this.idx + 1) % this.words.length;
      this.el.textContent = this.words[this.idx];
      this.el.style.opacity   = '';
      this.el.style.transform = '';
    }, 290);
  }
}

/* ══════════════════════════════════════════════════════════
   SMOOTH SCROLL — respects nav height offset
══════════════════════════════════════════════════════════ */
function initSmoothScroll() {
  $$('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const target = $(a.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY - 64;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });
}

/* ══════════════════════════════════════════════════════════
   NAV ACTIVE STATE — highlights current section link
══════════════════════════════════════════════════════════ */
function initNavHighlight() {
  const sections = $$('section[id]');
  const links    = $$('.nav-links a');
  const io = new IntersectionObserver(
    entries => entries.forEach(({ target, isIntersecting }) => {
      if (!isIntersecting) return;
      links.forEach(a => {
        a.style.color = a.getAttribute('href') === `#${target.id}`
          ? 'var(--text-1)'
          : '';
      });
    }),
    { threshold: 0.45 }
  );
  sections.forEach(s => io.observe(s));
}

/* ══════════════════════════════════════════════════════════
   FEATURE CARD STAGGER — applies delays before reveal
══════════════════════════════════════════════════════════ */
function initFeatureStagger() {
  $$('.feature-card').forEach((card, i) => {
    card.classList.add('reveal');
    card.dataset.delay = String(i * 65);
  });
}

/* ══════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  new HeroWave();
  new HeroParticles();
  new StepWave();
  new StaffAnimator();

  initFeatureStagger();

  new ScrollReveal();
  new CounterAnimator();
  new ContactForm();
  new WordCycler();

  initSmoothScroll();
  initNavHighlight();
});
