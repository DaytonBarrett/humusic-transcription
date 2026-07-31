/* ═══════════════════════════════════════════════════════════
   humusic — script.js
   Only what the publication needs to work. No decoration.
   ═══════════════════════════════════════════════════════════ */

'use strict';

const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

document.addEventListener('DOMContentLoaded', () => {

  /* ── Colophon year ── */
  const year = $('#footerYear');
  if (year) year.textContent = new Date().getFullYear();

  /* ── Running rule ──
     The keyframe translates by -50%, so the track has to hold
     exactly two copies of the list for the loop to be seamless. */
  const track = $('#tickerTrack');
  if (track) track.innerHTML += track.innerHTML;

  /* ── Navigation drawer ── */
  const toggle = $('#navToggle');
  const drawer = $('#drawer');
  if (toggle && drawer) {
    const setDrawer = (open) => {
      drawer.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    };
    toggle.addEventListener('click', () => setDrawer(drawer.hidden));
    $$('a', drawer).forEach((a) => a.addEventListener('click', () => setDrawer(false)));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !drawer.hidden) setDrawer(false);
    });
  }

  /* ── Anchor scrolling, offset by the sticky masthead ── */
  const masthead = $('#masthead');
  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id === '#') return;
      const target = $(id);
      if (!target) return;
      e.preventDefault();
      if (target.tagName === 'DETAILS') target.open = true;
      const offset = masthead ? masthead.offsetHeight + 12 : 12;
      window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - offset, behavior: 'smooth' });
    });
  });

  /* ── Current-section marker ── */
  const navLinks = $$('.masthead__nav a');
  if (navLinks.length) {
    const byId = new Map(navLinks.map((a) => [a.getAttribute('href').slice(1), a]));
    const io = new IntersectionObserver(
      (entries) => entries.forEach(({ target, isIntersecting }) => {
        const link = byId.get(target.id);
        if (link) link.setAttribute('aria-current', String(isIntersecting));
      }),
      { threshold: 0.25, rootMargin: '-20% 0px -60% 0px' }
    );
    byId.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
  }

  /* ── Enquiry form → pre-filled mail ── */
  const form = $('#contactForm');
  const sent = $('#formSent');
  if (form && sent) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data    = new FormData(form);
      const name    = (data.get('name')    || '').toString().trim();
      const email   = (data.get('email')   || '').toString().trim();
      const reason  = (data.get('reason')  || 'General').toString();
      const message = (data.get('message') || '').toString().trim();

      const subject = encodeURIComponent(`[humusic] ${reason}${name ? ` — ${name}` : ''}`);
      const body    = encodeURIComponent(
        `Hi Dayton,\n\nMy name is ${name || '—'} (${email || '—'}).\nSubject: ${reason}\n\n${message}\n\nBest,\n${name || ''}`
      );
      window.location.href = `mailto:daybarrett09@gmail.com?subject=${subject}&body=${body}`;

      form.hidden = true;
      sent.hidden = false;
    });
  }
});
