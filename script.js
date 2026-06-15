/* ═══════════════════════════════════════════════════════════
   humusic — script.js
   ═══════════════════════════════════════════════════════════ */

'use strict';

/* ──────────────────── Utility ──────────────────── */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

/* ──────────────────── Nav scroll effect ──────────────────── */
const navbar = $('#navbar');
function handleNavScroll() {
  navbar.classList.toggle('scrolled', window.scrollY > 20);
}
window.addEventListener('scroll', handleNavScroll, { passive: true });
handleNavScroll();

/* ──────────────────── Mobile menu ──────────────────── */
const hamburger   = $('#hamburger');
const mobileMenu  = $('#mobileMenu');
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

$$('.mobile-link').forEach(link => link.addEventListener('click', closeMenu));

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && mobileMenu.classList.contains('open')) closeMenu();
});

/* ──────────────────── Footer year ──────────────────── */
const yearEl = $('#footerYear');
if (yearEl) yearEl.textContent = new Date().getFullYear();

/* ══════════════════════════════════════════════════════════
   HERO CANVAS — Multi-layer waveform animation
══════════════════════════════════════════════════════════ */
class HeroWave {
  constructor() {
    this.canvas = $('#heroCanvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.t = 0;
    this.raf = null;
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

  drawWave(phase, freq, amp, alpha, lw, color) {
    const { ctx, W, H } = this;
    const cy = H * 0.52;

    ctx.beginPath();
    ctx.strokeStyle = color || `rgba(109,63,228,${alpha})`;
    ctx.lineWidth   = lw;
    ctx.shadowColor = '#7B50FF';
    ctx.shadowBlur  = lw * 8;

    const step = 4;
    for (let x = 0; x <= W; x += step) {
      const p = x / W;
      // Envelope: ramp in/out so waves fade at edges
      const env = Math.sin(p * Math.PI);
      const y = cy + Math.sin(p * Math.PI * freq + phase) * amp * env;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  drawBars() {
    const { ctx, W, H } = this;
    const cy = H * 0.52;
    const barCount = Math.min(80, Math.floor(W / 16));
    const spacing  = W / barCount;

    for (let i = 0; i < barCount; i++) {
      const x     = i * spacing + spacing / 2;
      const phase = (i / barCount) * Math.PI * 6 + this.t * 0.8;
      const h     = (Math.sin(phase) * 0.5 + 0.5) * 72 + 8;
      const alpha = ((Math.sin(phase) * 0.5 + 0.5) * 0.12 + 0.03);

      const grad = ctx.createLinearGradient(0, cy - h, 0, cy + h);
      grad.addColorStop(0,   `rgba(109,63,228,0)`);
      grad.addColorStop(0.5, `rgba(109,63,228,${alpha})`);
      grad.addColorStop(1,   `rgba(109,63,228,0)`);

      ctx.fillStyle = grad;
      const bw = Math.max(3, spacing * 0.4);
      ctx.beginPath();
      ctx.roundRect
        ? ctx.roundRect(x - bw / 2, cy - h, bw, h * 2, bw / 2)
        : ctx.rect(x - bw / 2, cy - h, bw, h * 2);
      ctx.fill();
    }
  }

  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    // Layer 1 — slow, wide base
    this.drawWave(this.t * 0.5,  5,  90, 0.7, 2.5);
    // Layer 2 — mid freq
    this.drawWave(this.t * 0.8 + 1, 8, 55, 0.45, 1.5);
    // Layer 3 — fast, high freq
    this.drawWave(this.t * 1.2 + 2, 12, 30, 0.25, 1);
    // Gold accent wave
    this.drawWave(this.t * 0.4 + 3, 3, 110, 0.1, 1, `rgba(245,192,0,0.12)`);
    // Frequency bars
    this.drawBars();

    this.t += 0.022;
  }

  animate() {
    this.draw();
    this.raf = requestAnimationFrame(() => this.animate());
  }
}

/* ══════════════════════════════════════════════════════════
   HERO PARTICLES — Floating music note symbols
══════════════════════════════════════════════════════════ */
class HeroParticles {
  constructor() {
    this.container = $('#heroParticles');
    if (!this.container) return;
    this.symbols = ['♩','♪','♫','♬','𝄞','𝄢'];
    this.count    = window.innerWidth < 600 ? 8 : 16;
    this.spawn();
  }

  spawn() {
    for (let i = 0; i < this.count; i++) {
      const el = document.createElement('span');
      el.className     = 'particle';
      el.textContent   = this.symbols[Math.floor(Math.random() * this.symbols.length)];
      el.style.cssText = this.randomStyle();
      this.container.appendChild(el);
    }
  }

  randomStyle() {
    const left    = Math.random() * 100;
    const size    = Math.random() * 1.2 + 0.8;
    const dur     = Math.random() * 20 + 15;
    const delay   = Math.random() * -30;
    const rot     = (Math.random() - 0.5) * 120;
    const opacity = Math.random() * 0.25 + 0.1;
    return `
      left: ${left}%;
      bottom: -60px;
      font-size: ${size}rem;
      --dur-float: ${dur}s;
      --delay: ${delay}s;
      --rot: ${rot}deg;
      opacity: 0;
    `;
  }
}

/* ══════════════════════════════════════════════════════════
   STEP CANVAS 1 — Animated waveform in "How it works"
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

    // Grid lines (subtle)
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth   = 1;
    for (let y = 0; y <= h; y += h / 4) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    for (let x = 0; x <= w; x += w / 8) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }

    // Waveform
    const cy = h / 2;
    [
      { freq: 4, amp: 50, alpha: 0.9, lw: 2.5, speed: 1 },
      { freq: 7, amp: 28, alpha: 0.5, lw: 1.5, speed: 1.4 },
      { freq: 2, amp: 65, alpha: 0.25, lw: 1, speed: 0.6 },
    ].forEach(({ freq, amp, alpha, lw, speed }) => {
      ctx.beginPath();
      ctx.strokeStyle = `rgba(109,63,228,${alpha})`;
      ctx.lineWidth   = lw;
      ctx.shadowColor = '#7B50FF';
      ctx.shadowBlur  = lw * 6;

      for (let x = 0; x <= w; x += 2) {
        const p   = x / w;
        const env = Math.sin(p * Math.PI);
        const y   = cy + Math.sin(p * Math.PI * freq + this.t * speed) * amp * env;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    });

    // Playhead
    const px = (this.t * 12) % w;
    ctx.strokeStyle = 'rgba(245,192,0,0.6)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
    ctx.setLineDash([]);

    // REC badge
    ctx.fillStyle = 'rgba(239,68,68,0.85)';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(8, 8, 44, 18, 4) : ctx.rect(8, 8, 44, 18);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px "Space Mono", monospace';
    ctx.fillText('● REC', 14, 21);

    this.t += 0.03;
  }

  animate() {
    this.draw();
    requestAnimationFrame(() => this.animate());
  }
}

/* ══════════════════════════════════════════════════════════
   STAFF NOTES ANIMATION
══════════════════════════════════════════════════════════ */
class StaffAnimator {
  constructor() {
    this.container = $('#staffNotes');
    if (!this.container) return;
    this.positions = [
      { left: '5%',  top: '-4px' },
      { left: '18%', top: '15px' },
      { left: '31%', top: '-4px' },
      { left: '44%', top: '31px' },
      { left: '57%', top: '15px' },
      { left: '70%', top: '-12px' },
      { left: '82%', top: '23px' },
    ];
    this.idx = 0;
    this.scheduleNext();
  }

  scheduleNext() {
    if (this.idx >= this.positions.length) return;
    setTimeout(() => {
      this.addNote(this.positions[this.idx]);
      this.idx++;
      this.scheduleNext();
    }, 350 + this.idx * 80);
  }

  addNote(pos) {
    const note = document.createElement('div');
    note.className = 'staff-note';
    note.style.left  = pos.left;
    note.style.top   = pos.top;
    note.style.animationDelay = '0s';
    this.container.appendChild(note);

    // Add stem
    const stem = document.createElement('div');
    stem.style.cssText = `
      position:absolute;
      left:${pos.left};
      top:${pos.top};
      width:1.5px;
      height:30px;
      background:var(--primary-lt);
      transform:translateX(12px);
      animation:noteAppear 0.4s ease-out both;
    `;
    this.container.appendChild(stem);
  }
}

/* ══════════════════════════════════════════════════════════
   SCROLL REVEAL — IntersectionObserver
══════════════════════════════════════════════════════════ */
class ScrollReveal {
  constructor() {
    this.elements = $$('.reveal');
    this.observer = new IntersectionObserver(
      (entries) => this.onIntersect(entries),
      { threshold: 0.1, rootMargin: '0px 0px -48px 0px' }
    );
    this.elements.forEach(el => {
      const delay = el.dataset.delay ? parseInt(el.dataset.delay) : 0;
      el.style.transitionDelay = `${delay}ms`;
      this.observer.observe(el);
    });
  }

  onIntersect(entries) {
    entries.forEach(({ target, isIntersecting }) => {
      if (isIntersecting) {
        target.classList.add('visible');
        this.observer.unobserve(target);
      }
    });
  }
}

/* ══════════════════════════════════════════════════════════
   COUNTER ANIMATION
══════════════════════════════════════════════════════════ */
class CounterAnimator {
  constructor() {
    this.counters = $$('.count');
    if (!this.counters.length) return;

    const observer = new IntersectionObserver(
      (entries) => this.onIntersect(entries),
      { threshold: 0.5 }
    );
    this.counters.forEach(el => observer.observe(el));
  }

  onIntersect(entries) {
    entries.forEach(({ target, isIntersecting }) => {
      if (!isIntersecting || target.dataset.done) return;
      target.dataset.done = '1';
      this.animateCounter(target);
    });
  }

  animateCounter(el) {
    const target  = parseInt(el.dataset.target, 10);
    const dur     = 1800;
    const start   = performance.now();

    const tick = (now) => {
      const elapsed  = now - start;
      const progress = Math.min(elapsed / dur, 1);
      // Ease out cubic
      const eased    = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(eased * target);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

/* ══════════════════════════════════════════════════════════
   CONTACT FORM — mailto fallback
══════════════════════════════════════════════════════════ */
class ContactForm {
  constructor() {
    this.form    = $('#contactForm');
    this.success = $('#formSuccess');
    if (!this.form) return;
    this.form.addEventListener('submit', (e) => this.onSubmit(e));
  }

  onSubmit(e) {
    e.preventDefault();
    const data    = new FormData(this.form);
    const name    = data.get('name')    || '';
    const email   = data.get('email')   || '';
    const reason  = data.get('reason')  || 'General question';
    const message = data.get('message') || '';

    // Build mailto link
    const subject = encodeURIComponent(`[humusic] ${reason} — from ${name}`);
    const body    = encodeURIComponent(
      `Hi Dayton,\n\nMy name is ${name} (${email}).\n\nReason: ${reason}\n\n${message}\n\nBest,\n${name}`
    );
    const mailto  = `mailto:daybarrett09@gmail.com?subject=${subject}&body=${body}`;

    // Open mail client
    window.location.href = mailto;

    // Show success after brief delay
    setTimeout(() => {
      this.form.style.display    = 'none';
      this.success.classList.add('show');
    }, 500);
  }
}

/* ══════════════════════════════════════════════════════════
   SMOOTH ANCHOR SCROLL with nav offset
══════════════════════════════════════════════════════════ */
function initSmoothScroll() {
  const NAV_H = 72;
  $$('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const target = $(anchor.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY - NAV_H;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });
}

/* ══════════════════════════════════════════════════════════
   FEATURE CARD stagger reveal
══════════════════════════════════════════════════════════ */
function initFeatureStagger() {
  $$('.feature-card').forEach((card, i) => {
    card.classList.add('reveal');
    card.dataset.delay = String(i * 70);
  });
}

/* ══════════════════════════════════════════════════════════
   HERO HEADLINE — cycling word animation
══════════════════════════════════════════════════════════ */
class WordCycler {
  constructor() {
    this.el    = $('#waveWord');
    if (!this.el) return;
    this.words = ['sound', 'melody', 'humming', 'audio', 'music'];
    this.idx   = 0;
    this.cycle();
  }

  cycle() {
    setInterval(() => {
      this.el.style.opacity = '0';
      this.el.style.transform = 'translateY(-8px)';
      setTimeout(() => {
        this.idx = (this.idx + 1) % this.words.length;
        this.el.textContent = this.words[this.idx];
        this.el.style.opacity = '';
        this.el.style.transform = '';
      }, 350);
    }, 2800);

    // Add transition
    this.el.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
    this.el.style.display = 'inline-block';
  }
}

/* ══════════════════════════════════════════════════════════
   PARALLAX — subtle hero movement on mouse move
══════════════════════════════════════════════════════════ */
function initParallax() {
  const hero = $('#hero');
  if (!hero || window.matchMedia('(max-width: 768px)').matches) return;
  const glow = hero.querySelector('.hero-glow');

  hero.addEventListener('mousemove', (e) => {
    const { clientX, clientY, currentTarget } = e;
    const { width, height } = currentTarget.getBoundingClientRect();
    const dx = ((clientX / width)  - 0.5) * 24;
    const dy = ((clientY / height) - 0.5) * 16;
    if (glow) glow.style.transform = `translate(calc(-50% + ${dx}px), calc(-60% + ${dy}px))`;
  });
}

/* ══════════════════════════════════════════════════════════
   CURSOR GLOW (desktop only)
══════════════════════════════════════════════════════════ */
function initCursorGlow() {
  if (window.matchMedia('(max-width: 1024px)').matches) return;
  if (window.matchMedia('(hover: none)').matches) return;

  const dot = document.createElement('div');
  dot.style.cssText = `
    position:fixed;
    pointer-events:none;
    z-index:9999;
    width:320px;
    height:320px;
    border-radius:50%;
    background:radial-gradient(circle, rgba(109,63,228,0.07) 0%, transparent 70%);
    transform:translate(-50%,-50%);
    transition:left 0.12s ease, top 0.12s ease, opacity 0.4s ease;
    will-change:left,top;
    opacity:0;
  `;
  document.body.appendChild(dot);

  let visible = false;
  document.addEventListener('mousemove', ({ clientX, clientY }) => {
    dot.style.left = `${clientX}px`;
    dot.style.top  = `${clientY}px`;
    if (!visible) { dot.style.opacity = '1'; visible = true; }
  }, { passive: true });
  document.addEventListener('mouseleave', () => { dot.style.opacity = '0'; visible = false; });
}

/* ══════════════════════════════════════════════════════════
   TECH PILL HOVER WAVE — ripple across pills
══════════════════════════════════════════════════════════ */
function initPillRipple() {
  const pills = $$('.tech-pill');
  if (!pills.length) return;

  let i = 0;
  setInterval(() => {
    pills.forEach(p => p.classList.remove('pill-hi'));
    pills[i % pills.length].classList.add('pill-hi');
    i++;
  }, 700);

  // Inject the highlight style
  const s = document.createElement('style');
  s.textContent = `.pill-hi { background:rgba(109,63,228,0.22)!important; border-color:rgba(109,63,228,0.6)!important; color:var(--primary-lt)!important; }`;
  document.head.appendChild(s);
}

/* ══════════════════════════════════════════════════════════
   NAV ACTIVE STATE on scroll
══════════════════════════════════════════════════════════ */
function initNavActive() {
  const sections = $$('section[id]');
  const links    = $$('.nav-links a');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(({ target, isIntersecting }) => {
      if (!isIntersecting) return;
      links.forEach(a => {
        a.style.color = a.getAttribute('href') === `#${target.id}`
          ? 'var(--text)'
          : '';
      });
    });
  }, { threshold: 0.45 });

  sections.forEach(s => observer.observe(s));
}

/* ══════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Canvas + particles
  new HeroWave();
  new HeroParticles();
  new StepWave();
  new StaffAnimator();

  // Stagger feature cards before reveal observer
  initFeatureStagger();

  // Reveal & counter
  new ScrollReveal();
  new CounterAnimator();

  // Interactions
  new ContactForm();
  new WordCycler();
  initSmoothScroll();
  initParallax();
  initCursorGlow();
  initPillRipple();
  initNavActive();

  // Chip entrance animation
  $$('.chip').forEach((chip, i) => {
    chip.style.opacity   = '0';
    chip.style.transform = 'translateY(6px)';
    chip.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    setTimeout(() => {
      chip.style.opacity   = '1';
      chip.style.transform = '';
    }, 1200 + i * 200);
  });
});
