# humusic — Website

**Audio to Sheet Music** · by Dayton Barrett

---

## 🚀 Getting Started with GitHub Pages

### 1. Create a GitHub repository

1. Go to [github.com](https://github.com) and create a **new repository**.
2. Name it `humusic` (or anything you'd like — the URL will be `yourusername.github.io/reponame`).
3. Set visibility to **Public** (required for free GitHub Pages).

### 2. Upload the files

Upload the following files into the **root** of your repository:

```
/
├── index.html
├── style.css
├── script.js
└── README.md
```

You can do this by:
- Dragging files into the GitHub web interface, or
- Using Git from your terminal:

```bash
git clone https://github.com/YOUR_USERNAME/humusic.git
cd humusic
# Copy website files here, then:
git add .
git commit -m "Initial commit"
git push origin main
```

### 3. Enable GitHub Pages

1. Go to your repository on GitHub.
2. Click **Settings** → **Pages** (in the left sidebar).
3. Under **Source**, select `Deploy from a branch`.
4. Choose branch: **main** and folder: **/ (root)**.
5. Click **Save**.

Your site will be live at:
```
https://YOUR_USERNAME.github.io/humusic/
```
(May take 1–3 minutes to deploy.)

---

## 📧 Contact Form Setup

The contact form currently opens the visitor's email client with a pre-filled message to `daybarrett09@gmail.com`.

**Optional — Use Formspree for in-browser form submission:**

1. Sign up at [formspree.io](https://formspree.io)
2. Create a new form and copy your form endpoint URL
3. In `script.js`, find the `ContactForm` class and replace the mailto approach with:

```javascript
fetch('https://formspree.io/f/YOUR_FORM_ID', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, email, reason, message })
})
.then(() => {
  this.form.style.display = 'none';
  this.success.classList.add('show');
});
```

---

## 📁 File Structure

```
/
├── index.html     — Main HTML (all sections)
├── style.css      — All styles and animations
├── script.js      — Canvas, scroll reveal, particles, counter
└── README.md      — This file
```

---

## ✨ Features

- **Animated hero canvas** — Multi-layer sine waveform
- **Floating music note particles** — ♩ ♪ ♫ ♬ drift upward
- **Scroll reveal animations** — Elements fade in on scroll
- **Animated counters** — Stats count up when visible
- **Cycling word animation** — Hero headline rotates words
- **Cursor glow effect** — Subtle radial gradient follows mouse
- **Sticky glass nav** — Frosted glass on scroll
- **Step canvas** — Live waveform in "How It Works"
- **Staff animation** — Notes appear on music staff
- **Mobile responsive** — Fully responsive down to 320px
- **Marquee band** — Scrolling music workflow ticker
- **Keyboard accessible** — Focus styles, ARIA labels

---

## 🖋 Contact

**Dayton Barrett** — Founder & Lead Developer, humusic  
📧 [daybarrett09@gmail.com](mailto:daybarrett09@gmail.com)
