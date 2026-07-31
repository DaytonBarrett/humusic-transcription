/* ═══════════════════════════════════════════════════════════
   humusic — app.js
   Recorder · monophonic pitch transcriber · engraver · export.

   Pipeline:
     mic → PCM capture (start/stop) → YIN pitch detection per
     tempo-quantized segment → note-name array → duration
     decomposition into ties/measures → VexFlow engraving
     and MusicXML export off the same intermediate form, so the
     printed score and the exported file can never disagree.
   ═══════════════════════════════════════════════════════════ */

'use strict';

const $ = (sel, ctx = document) => ctx.querySelector(sel);

/* ══════════════════════════════════════════════════════════
   MUSIC MATH
   Ported from the C++ engine (main.cpp) so the browser and the
   native transcriber agree on every note name: A4 = 440Hz,
   equal temperament, nearest MIDI note by rounding.
══════════════════════════════════════════════════════════ */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const REST = 'Rest';

function frequencyToNote(freq) {
  if (!freq || freq <= 20) return REST;
  const midiFloat = 69 + 12 * Math.log2(freq / 440);
  const midiNote = Math.round(midiFloat);
  const octave = Math.floor(midiNote / 12) - 1;
  let noteIndex = midiNote % 12;
  if (noteIndex < 0) noteIndex += 12;
  return NOTE_NAMES[noteIndex] + octave;
}

function noteToFrequency(noteName) {
  const m = /^([A-G]#?)(-?\d+)$/.exec(noteName);
  if (!m) return null;
  const idx = NOTE_NAMES.indexOf(m[1]);
  const octave = parseInt(m[2], 10);
  const midi = (octave + 1) * 12 + idx;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/* ══════════════════════════════════════════════════════════
   YIN PITCH DETECTOR
   De Cheveigné & Kawahara's autocorrelation-based estimator —
   far more resistant to octave errors than a raw FFT peak,
   which is why it's the standard choice for monophonic tuners.
   Returns { frequency, clarity } or null when no periodic
   signal is found (silence / noise / unpitched).
══════════════════════════════════════════════════════════ */
function yinDetectPitch(buffer, sampleRate, threshold = 0.1) {
  const half = buffer.length >> 1;
  if (half < 32) return null;

  const yinBuffer = new Float32Array(half);

  // Step 1+2: difference function, cumulative mean normalized.
  yinBuffer[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < half; tau++) {
    let sum = 0;
    for (let j = 0; j < half; j++) {
      const delta = buffer[j] - buffer[j + tau];
      sum += delta * delta;
    }
    runningSum += sum;
    yinBuffer[tau] = runningSum === 0 ? 1 : (sum * tau) / runningSum;
  }

  // Step 3: absolute threshold — first dip below threshold that's a local min.
  let tauEstimate = -1;
  for (let tau = 2; tau < half; tau++) {
    if (yinBuffer[tau] < threshold) {
      while (tau + 1 < half && yinBuffer[tau + 1] < yinBuffer[tau]) tau++;
      tauEstimate = tau;
      break;
    }
  }
  if (tauEstimate === -1) return null;

  // Step 4: parabolic interpolation around the minimum for sub-sample precision.
  const x0 = tauEstimate < 1 ? tauEstimate : tauEstimate - 1;
  const x2 = tauEstimate + 1 < half ? tauEstimate + 1 : tauEstimate;
  let betterTau;
  if (x0 === tauEstimate) {
    betterTau = yinBuffer[tauEstimate] <= yinBuffer[x2] ? tauEstimate : x2;
  } else if (x2 === tauEstimate) {
    betterTau = yinBuffer[tauEstimate] <= yinBuffer[x0] ? tauEstimate : x0;
  } else {
    const s0 = yinBuffer[x0], s1 = yinBuffer[tauEstimate], s2 = yinBuffer[x2];
    const denom = 2 * (2 * s1 - s2 - s0);
    betterTau = denom === 0 ? tauEstimate : tauEstimate + (s2 - s0) / denom;
  }

  return {
    frequency: sampleRate / betterTau,
    clarity: 1 - yinBuffer[tauEstimate],
  };
}

function rms(buffer, start = 0, end = buffer.length) {
  let sum = 0;
  for (let i = start; i < end; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / (end - start));
}

/* ══════════════════════════════════════════════════════════
   FULL-BUFFER SEGMENTATION
   Quantizes the whole recording onto a tempo-derived 16th-note
   grid (same grid unit the C++ engine uses) and runs YIN on a
   context-padded window around each segment, so low notes that
   don't complete a full period inside one grid cell can still
   be resolved accurately.
══════════════════════════════════════════════════════════ */
const SILENCE_RMS = 0.015;
const YIN_THRESHOLD = 0.1;
const MIN_ANALYSIS_WINDOW = 2048;

function analyzeRecording(samples, sampleRate, bpm) {
  const sixteenthDur = 60 / bpm / 4;
  const segmentSamples = Math.max(1, Math.round(sixteenthDur * sampleRate));
  const numSegments = Math.floor(samples.length / segmentSamples);
  const analysisWindow = Math.max(segmentSamples * 3, MIN_ANALYSIS_WINDOW);

  const notes = new Array(numSegments);

  for (let i = 0; i < numSegments; i++) {
    const segStart = i * segmentSamples;
    const segEnd = segStart + segmentSamples;

    if (rms(samples, segStart, segEnd) < SILENCE_RMS) {
      notes[i] = REST;
      continue;
    }

    const center = segStart + segmentSamples / 2;
    let winStart = Math.round(center - analysisWindow / 2);
    let winEnd = winStart + analysisWindow;
    if (winStart < 0) { winEnd -= winStart; winStart = 0; }
    if (winEnd > samples.length) { winStart -= winEnd - samples.length; winEnd = samples.length; }
    winStart = Math.max(0, winStart);

    const result = yinDetectPitch(samples.subarray(winStart, winEnd), sampleRate, YIN_THRESHOLD);
    notes[i] = result ? frequencyToNote(result.frequency) : REST;
  }

  return notes;
}

/* ══════════════════════════════════════════════════════════
   ENGRAVING MODEL
   Turns a flat notes-array (one entry per 16th note) into
   correctly tied, barred durations — not a naive grid of 16th
   notes, but idiomatic values the way a person would notate.
   Both the on-screen score and the MusicXML export are built
   from this single model, so they cannot drift apart.
══════════════════════════════════════════════════════════ */
const UNITS_PER_MEASURE = 16; // 4/4, in 16th-note units

// Largest-to-smallest canonical duration units; greedy decomposition
// over this set is exact for every integer 1..16 (verified by hand:
// 5=4+1, 7=6+1, 9=8+1, 10=8+2, 11=8+3, 13=12+1, 14=12+2, 15=12+3).
const DURATION_STEPS = [
  [16, 'w'], [12, 'hd'], [8, 'h'], [6, 'qd'], [4, 'q'], [3, '8d'], [2, '8'], [1, '16'],
];

// VexFlow token → [MusicXML note-type, dot count, duration in 16ths]
const XML_DURATION = {
  w:  ['whole',   0, 16],
  hd: ['half',    1, 12],
  h:  ['half',    0, 8],
  qd: ['quarter', 1, 6],
  q:  ['quarter', 0, 4],
  '8d': ['eighth', 1, 3],
  '8':  ['eighth', 0, 2],
  '16': ['16th',   0, 1],
};

function decomposeDuration(units) {
  const tokens = [];
  let remaining = units;
  for (const [u, dur] of DURATION_STEPS) {
    while (remaining >= u) { tokens.push(dur); remaining -= u; }
  }
  return tokens;
}

function buildRuns(notesArray) {
  const runs = [];
  for (const note of notesArray) {
    const last = runs[runs.length - 1];
    if (last && last.note === note) last.units++;
    else runs.push({ note, units: 1 });
  }
  return runs;
}

// Splits runs across measure boundaries and decomposes each piece into
// duration tokens, threading `tieToNext` through both within-piece ties
// (e.g. a 5-unit run becomes a tied quarter + 16th) and cross-measure
// ties (a run that spans a barline).
function buildEngravingUnits(runs) {
  const units = [];
  let pos = 0;
  let measureIndex = 0;

  for (const run of runs) {
    let remaining = run.units;
    while (remaining > 0) {
      const avail = UNITS_PER_MEASURE - pos;
      const take = Math.min(remaining, avail);
      const isFinalPieceOfRun = take === remaining;
      const tokens = decomposeDuration(take);

      tokens.forEach((vfDur, idx) => {
        const isFinalToken = idx === tokens.length - 1;
        const tieToNext = run.note !== REST && (!isFinalToken || !isFinalPieceOfRun);
        units.push({ measureIndex, note: run.note, vfDur, tieToNext });
      });

      pos += take;
      remaining -= take;
      if (pos === UNITS_PER_MEASURE) { pos = 0; measureIndex++; }
    }
  }

  // A take almost never stops exactly on a barline, so the last measure is
  // usually short. Fill the remainder with rests: VexFlow formats voices in
  // strict mode and throws IncompleteVoice on any measure that doesn't total
  // four beats, and MusicXML importers expect full measures too.
  if (pos > 0) {
    for (const vfDur of decomposeDuration(UNITS_PER_MEASURE - pos)) {
      units.push({ measureIndex, note: REST, vfDur, tieToNext: false });
    }
  }

  return units;
}

function modelFromNotes(notesArray) {
  const units = buildEngravingUnits(buildRuns(notesArray));
  if (!units.length) return null;
  const numMeasures = units[units.length - 1].measureIndex + 1;
  const groups = Array.from({ length: numMeasures }, () => []);
  units.forEach((u, i) => groups[u.measureIndex].push(i));
  return { units, numMeasures, groups };
}

function noteNameToVexKey(name) {
  const m = /^([A-G]#?)(-?\d+)$/.exec(name);
  return `${m[1].toLowerCase()}/${m[2]}`;
}

/* ══════════════════════════════════════════════════════════
   MUSICXML EXPORT
   Emits MusicXML 4.0 partwise. Element order inside <note>
   follows the DTD sequence (pitch/rest → duration → tie →
   voice → type → dot → accidental → notations); getting that
   order wrong is the usual reason an importer rejects a file.
══════════════════════════════════════════════════════════ */
const XML_DIVISIONS = 4; // divisions per quarter ⇒ one 16th = 1 division

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function splitPitch(name) {
  const m = /^([A-G])(#?)(-?\d+)$/.exec(name);
  return { step: m[1], alter: m[2] === '#' ? 1 : 0, octave: parseInt(m[3], 10) };
}

function buildMusicXML(notesArray, bpm, options = {}) {
  const model = modelFromNotes(notesArray);
  if (!model) return null;

  const { units, numMeasures, groups } = model;
  const title = options.title || 'humusic transcription';
  const today = new Date().toISOString().slice(0, 10);

  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  out.push('<score-partwise version="4.0">');
  out.push(`  <work><work-title>${xmlEscape(title)}</work-title></work>`);
  out.push('  <identification>');
  out.push('    <creator type="composer">humusic</creator>');
  out.push('    <encoding>');
  out.push('      <software>humusic transcriber</software>');
  out.push(`      <encoding-date>${today}</encoding-date>`);
  out.push('    </encoding>');
  out.push('  </identification>');
  out.push('  <part-list>');
  out.push('    <score-part id="P1"><part-name>Transcription</part-name></score-part>');
  out.push('  </part-list>');
  out.push('  <part id="P1">');

  for (let m = 0; m < numMeasures; m++) {
    out.push(`    <measure number="${m + 1}">`);

    if (m === 0) {
      out.push('      <attributes>');
      out.push(`        <divisions>${XML_DIVISIONS}</divisions>`);
      out.push('        <key><fifths>0</fifths><mode>major</mode></key>');
      out.push('        <time><beats>4</beats><beat-type>4</beat-type></time>');
      out.push('        <clef><sign>G</sign><line>2</line></clef>');
      out.push('      </attributes>');
      out.push('      <direction placement="above">');
      out.push('        <direction-type>');
      out.push('          <metronome parentheses="no">');
      out.push('            <beat-unit>quarter</beat-unit>');
      out.push(`            <per-minute>${bpm}</per-minute>`);
      out.push('          </metronome>');
      out.push('        </direction-type>');
      out.push(`        <sound tempo="${bpm}"/>`);
      out.push('      </direction>');
    }

    // Accidentals are per-measure state in common practice notation:
    // show one on the first altered pitch, and a natural when a
    // previously altered step/octave returns. This mirrors what
    // VexFlow draws on screen, keeping file and score identical.
    const measureAccidentals = new Map();

    for (const i of groups[m]) {
      const u = units[i];
      const [xmlType, dots, duration] = XML_DURATION[u.vfDur];
      const tieStop = i > 0 && units[i - 1].tieToNext;
      const tieStart = u.tieToNext;

      out.push('      <note>');

      let accidental = null;
      if (u.note === REST) {
        out.push('        <rest/>');
      } else {
        const { step, alter, octave } = splitPitch(u.note);
        const key = `${step}${octave}`;
        const inEffect = measureAccidentals.has(key) ? measureAccidentals.get(key) : 0;
        if (alter !== inEffect) {
          accidental = alter === 1 ? 'sharp' : 'natural';
          measureAccidentals.set(key, alter);
        }
        out.push('        <pitch>');
        out.push(`          <step>${step}</step>`);
        if (alter !== 0) out.push(`          <alter>${alter}</alter>`);
        out.push(`          <octave>${octave}</octave>`);
        out.push('        </pitch>');
      }

      out.push(`        <duration>${duration}</duration>`);
      if (tieStop)  out.push('        <tie type="stop"/>');
      if (tieStart) out.push('        <tie type="start"/>');
      out.push('        <voice>1</voice>');
      out.push(`        <type>${xmlType}</type>`);
      for (let d = 0; d < dots; d++) out.push('        <dot/>');
      if (accidental) out.push(`        <accidental>${accidental}</accidental>`);

      if (tieStop || tieStart) {
        out.push('        <notations>');
        if (tieStop)  out.push('          <tied type="stop"/>');
        if (tieStart) out.push('          <tied type="start"/>');
        out.push('        </notations>');
      }

      out.push('      </note>');
    }

    if (m === numMeasures - 1) {
      out.push('      <barline location="right"><bar-style>light-heavy</bar-style></barline>');
    }
    out.push('    </measure>');
  }

  out.push('  </part>');
  out.push('</score-partwise>');
  return out.join('\n') + '\n';
}

/* ══════════════════════════════════════════════════════════
   FILE DELIVERY
   In a browser this is a Blob download. Inside the iOS app
   shell, WKWebView ignores the download attribute, so the file
   is written to the app's cache and handed to the native share
   sheet — which is also how a user gets it into Files, iCloud,
   or a notation app on iPadOS.
══════════════════════════════════════════════════════════ */
function isNativeApp() {
  return !!(window.Capacitor
    && typeof window.Capacitor.isNativePlatform === 'function'
    && window.Capacitor.isNativePlatform());
}

async function saveTextFile(filename, text, mimeType) {
  if (isNativeApp()) {
    const plugins = window.Capacitor.Plugins || {};
    const { Filesystem, Share } = plugins;
    if (Filesystem && Share) {
      const written = await Filesystem.writeFile({
        path: filename,
        data: text,
        directory: 'CACHE',
        encoding: 'utf8',
        recursive: true,
      });
      await Share.share({ title: filename, url: written.uri, dialogTitle: 'Export score' });
      return 'shared';
    }
  }

  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}

function timestampSlug() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/* ══════════════════════════════════════════════════════════
   ENGRAVING — VexFlow
══════════════════════════════════════════════════════════ */
function renderScore(notesArray, container) {
  container.innerHTML = '';
  const model = modelFromNotes(notesArray);
  if (!model) return null;

  const { units, numMeasures, groups } = model;
  const VF = window.Vex.Flow;

  // One StaveNote per engraving unit, index-aligned with `units`
  // so ties can be built from real note references afterward.
  const staveNotes = units.map((u) => (
    u.note === REST
      ? new VF.StaveNote({ keys: ['b/4'], duration: `${u.vfDur}r` })
      : new VF.StaveNote({ keys: [noteNameToVexKey(u.note)], duration: u.vfDur })
  ));

  const containerWidth = Math.max(container.clientWidth, 300);
  const idealMeasureWidth = 240;
  const usable = containerWidth - 24;
  const measuresPerRow = Math.max(1, Math.min(numMeasures, Math.floor(usable / idealMeasureWidth)));
  const measureWidth = Math.max(180, Math.floor(usable / measuresPerRow));
  const staveHeight = 108;
  const rowCount = Math.ceil(numMeasures / measuresPerRow);
  const totalWidth = measuresPerRow * measureWidth + 24;
  const totalHeight = rowCount * (staveHeight + 26) + 30;

  const renderer = new VF.Renderer(container, VF.Renderer.Backends.SVG);
  renderer.resize(totalWidth, totalHeight);
  const ctx = renderer.getContext();

  const voices = [];
  for (let m = 0; m < numMeasures; m++) {
    const row = Math.floor(m / measuresPerRow);
    const col = m % measuresPerRow;
    const x = 12 + col * measureWidth;
    const y = 14 + row * (staveHeight + 26);

    const stave = new VF.Stave(x, y, measureWidth);
    if (col === 0) {
      stave.addClef('treble');
      if (m === 0) stave.addTimeSignature('4/4');
    }
    if (m === numMeasures - 1) stave.setEndBarType(VF.Barline.type.END);
    stave.setContext(ctx).draw();

    const notesForMeasure = groups[m].map((i) => staveNotes[i]);
    const voice = new VF.Voice({ num_beats: 4, beat_value: 4 }).setStrict(true);
    voice.addTickables(notesForMeasure);

    new VF.Formatter().joinVoices([voice]).format([voice], measureWidth - 62);
    voice.draw(ctx, stave);

    // beam_rests:false (the default) correctly breaks beam groups at rests.
    VF.Beam.generateBeams(notesForMeasure).forEach((b) => b.setContext(ctx).draw());

    voices.push(voice);
  }

  VF.Accidental.applyAccidentals(voices, 'C');

  // Ties are drawn after every measure is formatted, since a tie reads
  // the final rendered position of both notes — including ties that
  // cross from one measure or system into the next.
  units.forEach((u, i) => {
    if (u.tieToNext && i + 1 < staveNotes.length) {
      new VF.StaveTie({
        first_note: staveNotes[i],
        last_note: staveNotes[i + 1],
        first_indices: [0],
        last_indices: [0],
      }).setContext(ctx).draw();
    }
  });

  return { numMeasures, noteCount: units.filter((u) => u.note !== REST).length };
}

/* ══════════════════════════════════════════════════════════
   RECORDER
   Captures raw PCM via a ScriptProcessorNode (chosen over an
   AudioWorklet so the page also works opened straight from
   disk and inside WKWebView, with no module-fetch step). The
   processor is routed through a zero-gain node before the
   destination — required to keep it pulling audio in all
   browsers, without letting the mic feed back to the speaker.
══════════════════════════════════════════════════════════ */
const MAX_RECORDING_SECONDS = 180;

class Recorder {
  constructor({ onLevel, onTuner, onTick, onAutoStop }) {
    this.onLevel = onLevel;
    this.onTuner = onTuner;
    this.onTick = onTick;
    this.onAutoStop = onAutoStop;
    this.chunks = [];
    this.recording = false;
    this.sampleRate = null;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = new AudioCtx();
    // iOS hands back a suspended context until a user gesture resumes it.
    if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
    this.sampleRate = this.audioCtx.sampleRate;

    this.source = this.audioCtx.createMediaStreamSource(this.stream);

    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.tunerBuffer = new Float32Array(this.analyser.fftSize);
    this.source.connect(this.analyser);

    this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);
    this.mute = this.audioCtx.createGain();
    this.mute.gain.value = 0;
    this.source.connect(this.processor);
    this.processor.connect(this.mute);
    this.mute.connect(this.audioCtx.destination);

    this.chunks = [];
    this.totalSamples = 0;
    this.recording = true;
    this.startedAt = this.audioCtx.currentTime;

    this.processor.onaudioprocess = (e) => {
      if (!this.recording) return;
      const data = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(data));
      this.totalSamples += data.length;
      if (this.totalSamples / this.sampleRate >= MAX_RECORDING_SECONDS) {
        this.onAutoStop?.();
      }
    };

    this._tick();
  }

  _tick() {
    if (!this.recording) return;

    this.analyser.getFloatTimeDomainData(this.tunerBuffer);
    const level = rms(this.tunerBuffer);
    this.onLevel?.(Math.min(1, level * 6));

    if (level > SILENCE_RMS) {
      const result = yinDetectPitch(this.tunerBuffer, this.sampleRate, YIN_THRESHOLD);
      this.onTuner?.(result ? { ...result, note: frequencyToNote(result.frequency) } : null);
    } else {
      this.onTuner?.(null);
    }

    this.onTick?.(this.audioCtx.currentTime - this.startedAt);
    this._raf = requestAnimationFrame(() => this._tick());
  }

  stop() {
    if (!this.recording) return null;
    this.recording = false;
    if (this._raf) cancelAnimationFrame(this._raf);

    this.processor.disconnect();
    this.source.disconnect();
    this.stream.getTracks().forEach((t) => t.stop());
    this.audioCtx.close();

    const merged = new Float32Array(this.totalSamples);
    let offset = 0;
    for (const chunk of this.chunks) { merged.set(chunk, offset); offset += chunk.length; }
    this.chunks = [];

    return { samples: merged, sampleRate: this.sampleRate };
  }
}

/* ══════════════════════════════════════════════════════════
   CONSOLE
══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  const recordBtn   = $('#recordBtn');
  const recordLabel = $('#recordLabel');
  const timerText   = $('#timerText');
  const bpmInput    = $('#bpmInput');
  const levelFill   = $('#levelFill');
  const pitchNote   = $('#pitchNote');
  const centsNeedle = $('#centsNeedle');
  const centsRead   = $('#centsRead');
  const centsTrack  = $('#centsTrack');
  const metaState   = $('#metaState');
  const metaRate    = $('#metaRate');
  const scoreEmpty  = $('#scoreEmpty');
  const scoreMeta   = $('#scoreMeta');
  const scoreContainer = $('#scoreContainer');
  const exportBtn   = $('#exportBtn');
  const clearBtn    = $('#clearBtn');
  const toast       = $('#toast');

  // Links back to the marketing site are meaningless inside the app
  // shell, where this page is the whole bundle.
  if (isNativeApp()) {
    document.documentElement.classList.add('is-native');
    document.querySelectorAll('[data-web-only]').forEach((el) => { el.hidden = true; });
  }

  let toastTimer = null;
  const showToast = (msg, kind = 'info') => {
    toast.textContent = msg;
    toast.dataset.kind = kind;
    toast.classList.add('is-open');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-open'), 4200);
  };

  if (!navigator.mediaDevices?.getUserMedia) {
    recordBtn.disabled = true;
    recordLabel.textContent = 'Unavailable';
    showToast('Microphone capture is not supported in this browser.', 'error');
    return;
  }

  const formatTime = (s) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  const clampBpm = (v) => {
    const n = Math.round(Number(v) || 100);
    return Math.min(240, Math.max(40, n));
  };

  let recorder = null;
  let lastResult = null;

  function setIdle() {
    recordBtn.classList.remove('is-recording');
    recordBtn.setAttribute('aria-label', 'Start recording');
    recordLabel.textContent = 'Record';
    metaState.textContent = 'IDLE';
    levelFill.style.clipPath = 'inset(0 100% 0 0)';
    bpmInput.disabled = false;
    centsTrack.classList.remove('is-live');
    updateTuner(null);
  }

  setIdle();

  recordBtn.addEventListener('click', async () => {
    if (recorder?.recording) {
      const captured = recorder.stop();
      setIdle();
      metaState.textContent = 'ANALYSING';
      recordLabel.textContent = 'Working';
      // Yield a frame so the state paints before the synchronous
      // analysis + engraving work blocks the main thread.
      await new Promise(requestAnimationFrame);
      runTranscription(captured);
      recordLabel.textContent = 'Record';
      return;
    }

    bpmInput.value = clampBpm(bpmInput.value);

    try {
      recorder = new Recorder({
        onLevel: (lvl) => { levelFill.style.clipPath = `inset(0 ${(1 - lvl) * 100}% 0 0)`; },
        onTuner: updateTuner,
        onTick: (t) => { timerText.textContent = formatTime(t); },
        onAutoStop: () => recordBtn.click(),
      });
      await recorder.start();
      recordBtn.classList.add('is-recording');
      recordBtn.setAttribute('aria-label', 'Stop recording');
      recordLabel.textContent = 'Stop';
      metaState.textContent = 'RECORDING';
      metaRate.textContent = `${(recorder.sampleRate / 1000).toFixed(1)}kHz`;
      centsTrack.classList.add('is-live');
      bpmInput.disabled = true;
    } catch (err) {
      console.error(err);
      recorder = null;
      setIdle();
      showToast('Microphone access was blocked. Allow it and try again.', 'error');
    }
  });

  function updateTuner(result) {
    if (!result) {
      pitchNote.textContent = '—';
      centsRead.textContent = '';
      centsNeedle.style.left = '50%';
      centsTrack.classList.remove('is-true');
      return;
    }
    const target = noteToFrequency(result.note);
    const cents = 1200 * Math.log2(result.frequency / target);
    const clamped = Math.max(-50, Math.min(50, cents));
    pitchNote.textContent = result.note;
    centsRead.textContent = `${cents >= 0 ? '+' : '−'}${Math.abs(cents).toFixed(0)}¢`;
    centsNeedle.style.left = `${50 + clamped}%`;
    centsTrack.classList.toggle('is-true', Math.abs(cents) < 8);
  }

  function runTranscription(captured) {
    if (!captured || captured.samples.length === 0) {
      metaState.textContent = 'IDLE';
      showToast('No audio captured — check your microphone and try again.', 'error');
      return;
    }

    const bpm = clampBpm(bpmInput.value);

    try {
      const notes = analyzeRecording(captured.samples, captured.sampleRate, bpm);

      if (notes.length === 0) {
        showToast('Too short to quantize at this tempo. Record longer, or raise the BPM.', 'error');
        return;
      }
      if (notes.every((n) => n === REST)) {
        showToast('No pitched notes detected. Try playing closer to the microphone.', 'error');
        return;
      }

      lastResult = { notes, bpm, seconds: captured.samples.length / captured.sampleRate };

      scoreEmpty.hidden = true;
      scoreContainer.hidden = false;
      const info = renderScore(notes, scoreContainer);

      scoreMeta.textContent =
        `${info.numMeasures} bar${info.numMeasures === 1 ? '' : 's'} · ${info.noteCount} events · ${bpm} bpm · ${lastResult.seconds.toFixed(1)}s`;
      exportBtn.disabled = false;
      clearBtn.disabled = false;
    } catch (err) {
      console.error('Transcription failed:', err);
      lastResult = null;
      scoreContainer.hidden = true;
      scoreEmpty.hidden = false;
      exportBtn.disabled = true;
      clearBtn.disabled = true;
      showToast('Something went wrong transcribing that take. Try again.', 'error');
    } finally {
      metaState.textContent = 'IDLE';
    }
  }

  exportBtn.addEventListener('click', async () => {
    if (!lastResult) return;
    exportBtn.disabled = true;
    try {
      const xml = buildMusicXML(lastResult.notes, lastResult.bpm, {
        title: `humusic transcription — ${lastResult.bpm} bpm`,
      });
      if (!xml) throw new Error('empty score');
      const filename = `humusic-${timestampSlug()}.musicxml`;
      const how = await saveTextFile(filename, xml, 'application/vnd.recordare.musicxml+xml');
      showToast(how === 'shared' ? 'Score ready to share.' : `Exported ${filename}`, 'ok');
    } catch (err) {
      console.error('Export failed:', err);
      showToast('Could not export the score.', 'error');
    } finally {
      exportBtn.disabled = false;
    }
  });

  clearBtn.addEventListener('click', () => {
    lastResult = null;
    scoreContainer.innerHTML = '';
    scoreContainer.hidden = true;
    scoreEmpty.hidden = false;
    scoreMeta.textContent = '';
    exportBtn.disabled = true;
    clearBtn.disabled = true;
  });

  bpmInput.addEventListener('blur', () => { bpmInput.value = clampBpm(bpmInput.value); });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (!lastResult) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      try { renderScore(lastResult.notes, scoreContainer); }
      catch (err) { console.error('Re-render on resize failed:', err); }
    }, 160);
  });
});
