/* ═══════════════════════════════════════════════════════════
   humusic — app.js
   Recorder · monophonic pitch transcriber · engraver · export.

   Pipeline:
     mic → PCM capture (start/stop) → YIN pitch measurement per
     tempo-quantized segment → note tracking (the measurements
     grouped into notes, and only then named) → duration
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

// Kept as a float: rounding to a note name is the last step of transcription,
// never an intermediate one. A held note wanders either side of a semitone
// boundary, and rounding each measurement in isolation turns that wander into
// a stream of alternating note names — which is a rhythm error, not a pitch
// error, because every change of name starts a new note.
function frequencyToMidi(freq) {
  return !freq || freq <= 20 ? null : 69 + 12 * Math.log2(freq / 440);
}

function midiToNoteName(midi) {
  const midiNote = Math.round(midi);
  const octave = Math.floor(midiNote / 12) - 1;
  let noteIndex = midiNote % 12;
  if (noteIndex < 0) noteIndex += 12;
  return NOTE_NAMES[noteIndex] + octave;
}

function frequencyToNote(freq) {
  const midi = frequencyToMidi(freq);
  return midi === null ? REST : midiToNoteName(midi);
}

function noteToMidi(noteName) {
  const m = /^([A-G]#?)(-?\d+)$/.exec(noteName);
  if (!m) return null;
  return (parseInt(m[2], 10) + 1) * 12 + NOTE_NAMES.indexOf(m[1]);
}

function noteToFrequency(noteName) {
  const midi = noteToMidi(noteName);
  return midi === null ? null : 440 * Math.pow(2, (midi - 69) / 12);
}

// Where a note sits on the staff, counted in diatonic steps rather than
// semitones. C#4 and C4 share a line — an accidental moves the pitch but not
// the notehead — and it is lines, not semitones, that ledger lines are drawn
// for, so staff geometry has to be reasoned about in this scale.
const STAFF_STEPS = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

function noteToStaffStep(noteName) {
  const m = /^([A-G])#?(-?\d+)$/.exec(noteName);
  return m ? parseInt(m[2], 10) * 7 + STAFF_STEPS[m[1]] : null;
}

/* ══════════════════════════════════════════════════════════
   YIN PITCH DETECTOR
   De Cheveigné & Kawahara's autocorrelation-based estimator —
   far more resistant to octave errors than a raw FFT peak,
   which is why it's the standard choice for monophonic tuners.
   Returns { frequency, clarity } or null when no periodic
   signal is found (silence / noise / unpitched).

   The lag search is bounded to the musical range rather than
   running to half the window. Lags longer than the lowest note
   we accept cannot be a melody — they are room rumble and
   handling noise, and letting YIN dip into them is one way a
   held note picks up a stray sub-audible reading mid-sustain.
══════════════════════════════════════════════════════════ */
function yinDetectPitch(buffer, sampleRate, threshold = 0.1, minFreq = MIN_PITCH_HZ, maxFreq = MAX_PITCH_HZ) {
  const half = buffer.length >> 1;
  if (half < 32) return null;

  const maxTau = Math.min(half - 1, Math.floor(sampleRate / minFreq));
  const minTau = Math.max(2, Math.ceil(sampleRate / maxFreq));
  if (maxTau <= minTau) return null;

  const yinBuffer = new Float32Array(maxTau + 1);

  // Step 1+2: difference function, cumulative mean normalized. The running
  // sum has to start at tau=1 even though the search starts later — the
  // normalization is defined over every lag up to the current one.
  yinBuffer[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
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
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (yinBuffer[tau] < threshold) {
      while (tau + 1 <= maxTau && yinBuffer[tau + 1] < yinBuffer[tau]) tau++;
      tauEstimate = tau;
      break;
    }
  }
  if (tauEstimate === -1) return null;

  // Step 4: parabolic interpolation around the minimum for sub-sample precision.
  const x0 = tauEstimate < 1 ? tauEstimate : tauEstimate - 1;
  const x2 = tauEstimate + 1 <= maxTau ? tauEstimate + 1 : tauEstimate;
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
   grid (same grid unit the C++ engine uses) and runs YIN over
   each segment.

   The analysis window is centred on the segment and kept short:
   wide enough to hold several periods of a low note, no wider.
   A window that spans a note boundary straddles the notes on
   either side of the onset, and YIN locks onto a bogus long
   period across the seam — which is how a clean melody picks up
   spurious very low notes and late-sounding onsets.

   What comes out is one *measurement* per 16th, not one note
   name per 16th. Naming happens later, per note, once the
   measurements have been grouped.
══════════════════════════════════════════════════════════ */
const YIN_THRESHOLD = 0.1;

// Voicing. The floor is absolute — a quiet room never reaches it — but the
// working threshold also scales with the take, so a soft recording is not
// read as silence and a loud one does not promote its own room tone into
// notes. The hysteresis matters more than either number: a note that has
// started stays voiced down to a far lower level than it took to start it.
// Without that, the natural decay of a held note dips under a fixed floor
// and punches a rest through the middle of the note, splitting it in two.
const SILENCE_RMS = 0.015;
const VOICED_PEAK_RATIO = 0.06;
const RELEASE_RATIO = 0.45;

// E1 sits below a bass guitar's low string and C7 above a soprano's top, so
// a reading outside this range is a detection error rather than a melody.
const MIN_PITCH_MIDI = 28;
const MAX_PITCH_MIDI = 96;
const MIN_PITCH_HZ = 440 * Math.pow(2, (MIN_PITCH_MIDI - 69) / 12);
const MAX_PITCH_HZ = 440 * Math.pow(2, (MAX_PITCH_MIDI - 69) / 12);

// 46ms holds two periods of the lowest note we accept; past ~93ms the window
// starts crossing note boundaries at ordinary tempos without buying accuracy.
const MIN_ANALYSIS_SECONDS = 0.046;
const MAX_ANALYSIS_SECONDS = 0.093;

/* One entry per 16th. `midi` is a float — or null where nothing pitched was
   found — and `strong`/`audible` are the two sides of the voicing hysteresis:
   `strong` is loud enough to begin a note, `audible` only loud enough to keep
   one going. `filled` marks a frame bridged across a dropout rather than
   measured, which the onset test has to know about. */
function measureFrames(samples, sampleRate, segmentSamples) {
  const numSegments = Math.floor(samples.length / segmentSamples);
  const frames = new Array(numSegments);

  let peak = 0;
  for (let i = 0; i < numSegments; i++) {
    const energy = rms(samples, i * segmentSamples, (i + 1) * segmentSamples);
    if (energy > peak) peak = energy;
    frames[i] = { energy, midi: null, voiced: false, filled: false, audible: false, strong: false };
  }

  const onThreshold = Math.max(SILENCE_RMS, peak * VOICED_PEAK_RATIO);
  const offThreshold = onThreshold * RELEASE_RATIO;

  const analysisWindow = Math.min(
    Math.round(sampleRate * MAX_ANALYSIS_SECONDS),
    Math.max(segmentSamples, Math.round(sampleRate * MIN_ANALYSIS_SECONDS)),
  );

  for (let i = 0; i < numSegments; i++) {
    // Below the release threshold nothing can be voiced however it sounds,
    // so there is no reason to pay for YIN over silence.
    if (frames[i].energy < offThreshold) continue;
    frames[i].audible = true;
    frames[i].strong = frames[i].energy >= onThreshold;

    const center = i * segmentSamples + segmentSamples / 2;
    let winStart = Math.round(center - analysisWindow / 2);
    let winEnd = winStart + analysisWindow;
    if (winStart < 0) { winEnd -= winStart; winStart = 0; }
    if (winEnd > samples.length) { winStart -= winEnd - samples.length; winEnd = samples.length; }
    winStart = Math.max(0, winStart);

    const result = yinDetectPitch(samples.subarray(winStart, winEnd), sampleRate, YIN_THRESHOLD);
    const midi = result ? frequencyToMidi(result.frequency) : null;
    if (midi !== null && midi >= MIN_PITCH_MIDI && midi <= MAX_PITCH_MIDI) frames[i].midi = midi;
  }

  let sounding = false;
  for (const frame of frames) {
    frame.voiced = frame.midi !== null && (sounding ? frame.audible : frame.strong);
    sounding = frame.voiced;
  }

  return frames;
}

/* ══════════════════════════════════════════════════════════
   NOTE TRACKING
   Groups the per-16th measurements into notes. This is the step
   that decides rhythm: every group boundary is a new note, so
   anything that fragments a group writes a held note out as a
   run of short ones.

   Three defences, in order — a median filter for single-frame
   slips, gap filling for momentary dropouts, and a pitch
   reference with hysteresis so a note is only ended by a real
   move away from where it has been sitting, not by the wobble
   of a voice sustaining across a semitone boundary.
══════════════════════════════════════════════════════════ */

// A note struck again at the same pitch has no pitch change to find it by,
// so it has to be found by its attack. On a 16th grid an attack and a swell
// out of a dip look much alike in energy alone, so the test is deliberately
// narrow: the sound must have all but stopped — down where only the release
// hysteresis was still holding the note open — and then come back loud. That
// misses a re-articulation played legato over a still-sounding note, which
// writes two notes as one held note. The opposite mistake is the one worth
// avoiding: reading every swell as an attack shatters held notes, which is
// exactly the failure this tracker exists to prevent.
const ONSET_RISE_RATIO = 2.5;

// How far the pitch must move from where the note has been sitting before
// it counts as a different note. Comfortably wider than vibrato (±50 cents
// is a wide operatic wobble) and comfortably inside a semitone.
const NEW_NOTE_SEMITONES = 0.7;

// A stretch this long with sound but no measurable pitch is unpitched
// material in its own right, not a dropout to be papered over.
const MAX_DROPOUT_FRAMES = 2;

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

// Where a note is sitting, in MIDI floats. The median fixes the centre and
// shrugs off a stray frame; averaging the frames near it then recovers the
// precision a median discards — vibrato is symmetric about the pitch, so the
// frames either side of centre carry real information, and on an even number
// of frames a bare median also leans on the upper of the two middle values.
// That lean is enough to name a note a semitone sharp when it only had four
// frames to go on.
function centrePitch(pitches) {
  const centre = median(pitches);
  let sum = 0;
  let n = 0;
  for (const p of pitches) {
    if (Math.abs(p - centre) < 0.5) { sum += p; n++; }
  }
  return n ? sum / n : centre;
}

// Three-wide median over the pitch track. An octave slip or a transient at
// the attack shows up as one frame unlike both its neighbours, and a median
// removes exactly that while leaving real note boundaries where they are —
// at a boundary the window reads (old, new, new), whose median is new.
function smoothPitch(frames) {
  const raw = frames.map((f) => (f.voiced ? f.midi : null));
  for (let i = 1; i < frames.length - 1; i++) {
    if (raw[i - 1] === null || raw[i] === null || raw[i + 1] === null) continue;
    frames[i].midi = median([raw[i - 1], raw[i], raw[i + 1]]);
  }
}

// Bridges gaps where the note went on sounding but no pitch came back — a
// consonant, a bow change, noise smeared over the measurement. Energy is the
// test, and it is the honest one: if the sound continued at the same pitch
// either side, the note continued. A gap that actually falls silent is left
// alone, because a 16th of silence is a rest and the score should show it.
function fillDropouts(frames) {
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].voiced) continue;
    let end = i;
    let audible = true;
    while (end < frames.length && !frames[end].voiced) {
      if (!frames[end].audible) audible = false;
      end++;
    }

    const before = frames[i - 1];
    const after = frames[end];
    if (audible && end - i <= MAX_DROPOUT_FRAMES && before.voiced && after?.voiced
        && Math.abs(before.midi - after.midi) < NEW_NOTE_SEMITONES) {
      for (let k = i; k < end; k++) {
        frames[k].voiced = true;
        frames[k].filled = true;
        frames[k].midi = (before.midi + after.midi) / 2;
      }
    }
    i = end - 1;
  }
}

function trackNotes(frames) {
  const runs = [];
  let pitches = null; // MIDI floats of the note being tracked
  let units = 0;
  let startedByOnset = false;

  const flush = () => {
    if (!pitches) return;
    // The note is named once, from the middle of everything measured across
    // it — so a note that drifts or wobbles over a boundary still resolves
    // to the single pitch it was heard as, rather than to whichever side of
    // the boundary each individual 16th happened to land on.
    runs.push({ note: midiToNoteName(centrePitch(pitches)), units, startedByOnset });
    pitches = null;
  };

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];

    if (!frame.voiced) {
      flush();
      const last = runs[runs.length - 1];
      if (last && last.note === REST) last.units++;
      else runs.push({ note: REST, units: 1, startedByOnset: false });
      continue;
    }

    const previous = frames[i - 1];
    // A filled gap is a dip by definition, so the recovery out of one always
    // looks like an attack. Exempt it, or every bridged dropout re-splits
    // the note the bridge just repaired.
    const onset = !!previous && previous.voiced && !previous.filled
      && !previous.strong && frame.strong
      && frame.energy > previous.energy * ONSET_RISE_RATIO;

    let boundary = onset || pitches === null;
    if (!boundary && Math.abs(frame.midi - centrePitch(pitches)) >= NEW_NOTE_SEMITONES) {
      // One frame away from the reference is a slip; two in a row is a new
      // note. Only ask for that confirmation while there is a voiced frame
      // left to ask — at the end of a phrase there is nothing to confirm with.
      const next = frames[i + 1];
      boundary = !next || !next.voiced
        || Math.abs(next.midi - centrePitch(pitches)) >= NEW_NOTE_SEMITONES;
    }

    if (boundary) {
      flush();
      pitches = [];
      units = 0;
      startedByOnset = onset;
    }
    pitches.push(frame.midi);
    units++;
  }

  flush();
  return runs;
}

// Two runs that were split on pitch but round to the same name were never
// two notes — the reference simply drifted far enough to trip the boundary
// inside one long note. Runs that begin on a real attack are kept apart:
// that is a repeated note, and it has to stay two notes on the page.
function mergeUnarticulatedRuns(runs) {
  const merged = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.note === run.note && !run.startedByOnset) last.units += run.units;
    else merged.push({ ...run });
  }
  return merged;
}

/* Returns [{ note, units }] — one entry per note, `units` counted in 16ths.
   Runs rather than a flat per-16th array, because two adjacent notes at the
   same pitch are a distinction a flat array cannot carry. */
function analyzeRecording(samples, sampleRate, bpm) {
  const sixteenthDur = 60 / bpm / 4;
  const segmentSamples = Math.max(1, Math.round(sixteenthDur * sampleRate));

  const frames = measureFrames(samples, sampleRate, segmentSamples);
  smoothPitch(frames);
  fillDropouts(frames);
  return mergeUnarticulatedRuns(trackNotes(frames));
}

/* ══════════════════════════════════════════════════════════
   CLEF SELECTION
   A fixed treble clef pushes a bass line or a low male voice
   far below the staff, where it reads as a thicket of ledger
   lines. So the clef is chosen from the line itself — but by
   counting the ledger lines each staff would actually cost,
   which is the thing a reader pays for, rather than by asking
   which staff's centre line the median pitch sits nearer.

   Measuring from the centre lines is what put treble melodies
   on a bass clef. Those centres are B4 and D3, so the midpoint
   between them lands exactly on middle C, and any line whose
   median sits at or below C4 tipped to bass — even a melody
   running C4 up to A4, which is treble music by any reading.
   Centre distance also ignores range entirely: it cannot tell
   a line that sits on middle C from one that merely passes
   through it on the way up.
══════════════════════════════════════════════════════════ */
const CLEFS = {
  // bottomLine/topLine are the outer staff lines in diatonic steps — E4 and
  // F5 for treble, G2 and A3 for bass. restKey places rests in the middle of
  // that staff, which is where a copyist centres them.
  treble: {
    vex: 'treble', label: 'treble', restKey: 'b/4', xmlSign: 'G', xmlLine: 2,
    bottomLine: noteToStaffStep('E4'), topLine: noteToStaffStep('F5'),
  },
  bass: {
    vex: 'bass', label: 'bass', restKey: 'd/3', xmlSign: 'F', xmlLine: 4,
    bottomLine: noteToStaffStep('G2'), topLine: noteToStaffStep('A3'),
  },
};

// Ledger lines a note needs on a given staff. A note in the space beyond a
// ledger line still needs that line drawn, which is why this floors the
// half-steps rather than rounding them.
function ledgerLines(step, clef) {
  if (step > clef.topLine) return Math.floor((step - clef.topLine) / 2);
  if (step < clef.bottomLine) return Math.floor((clef.bottomLine - step) / 2);
  return 0;
}

function chooseClef(runs) {
  let trebleCost = 0;
  let bassCost = 0;
  let totalUnits = 0;

  // Each note counts for its length, so a line is judged by where it
  // actually sits rather than by a flurry of passing notes — and a one-16th
  // octave slip cannot drag the whole staff with it.
  for (const run of runs) {
    if (run.note === REST) continue;
    const step = noteToStaffStep(run.note);
    if (step === null) continue;
    trebleCost += ledgerLines(step, CLEFS.treble) * run.units;
    bassCost += ledgerLines(step, CLEFS.bass) * run.units;
    totalUnits += run.units;
  }
  if (!totalUnits) return CLEFS.treble;

  // Treble is the default for a single melodic line, so bass has to earn the
  // switch rather than win on a hair: it must save more than one ledger line
  // per sixteenth on average. Around middle C the two staves are near enough
  // to symmetric that a bare comparison flips on one ledger line, which is
  // how a hummed B3 — a note most people would read in treble — ends up
  // under a bass clef.
  return trebleCost - bassCost > totalUnits ? CLEFS.bass : CLEFS.treble;
}

/* ══════════════════════════════════════════════════════════
   ENGRAVING MODEL
   Turns the tracker's runs into correctly tied, barred
   durations — not a naive grid of 16th notes, but idiomatic
   values the way a person would notate.
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

function modelFromRuns(runs) {
  // Bar 1 beat 1 is the first note played. The silence around the take only
  // records how long it took to start after pressing Record and how long it
  // took to reach Stop; writing it as rests would push the whole line off
  // the beat it was played on and hang empty bars off the end.
  let first = 0;
  while (first < runs.length && runs[first].note === REST) first++;
  let last = runs.length;
  while (last > first && runs[last - 1].note === REST) last--;
  const played = runs.slice(first, last);
  if (!played.length) return null;

  const units = buildEngravingUnits(played);
  if (!units.length) return null;
  const numMeasures = units[units.length - 1].measureIndex + 1;
  const groups = Array.from({ length: numMeasures }, () => []);
  units.forEach((u, i) => groups[u.measureIndex].push(i));
  return { units, numMeasures, groups, clef: chooseClef(played) };
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

function buildMusicXML(runs, bpm, options = {}) {
  const model = modelFromRuns(runs);
  if (!model) return null;

  const { units, numMeasures, groups, clef } = model;
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
      out.push(`        <clef><sign>${clef.xmlSign}</sign><line>${clef.xmlLine}</line></clef>`);
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
function renderScore(runs, container) {
  container.innerHTML = '';
  const model = modelFromRuns(runs);
  if (!model) return null;

  const { units, numMeasures, groups, clef } = model;
  const VF = window.Vex.Flow;

  // One StaveNote per engraving unit, index-aligned with `units`
  // so ties can be built from real note references afterward.
  // StaveNote needs the clef too — it decides the staff line each
  // key lands on, so omitting it draws bass pitches at treble heights.
  const staveNotes = units.map((u) => (
    u.note === REST
      ? new VF.StaveNote({ keys: [clef.restKey], duration: `${u.vfDur}r`, clef: clef.vex })
      : new VF.StaveNote({ keys: [noteNameToVexKey(u.note)], duration: u.vfDur, clef: clef.vex })
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

  // Pass 1: lay out every measure, but draw nothing yet. Accidentals have to
  // be applied across the whole line before anything is formatted — they are
  // modifiers, so they widen the notes they sit on, and a modifier added to a
  // note that has already been drawn never appears at all.
  const measures = [];
  for (let m = 0; m < numMeasures; m++) {
    const row = Math.floor(m / measuresPerRow);
    const col = m % measuresPerRow;
    const x = 12 + col * measureWidth;
    const y = 14 + row * (staveHeight + 26);

    const stave = new VF.Stave(x, y, measureWidth);
    if (col === 0) {
      stave.addClef(clef.vex);
      if (m === 0) stave.addTimeSignature('4/4');
    }
    if (m === numMeasures - 1) stave.setEndBarType(VF.Barline.type.END);

    const notesForMeasure = groups[m].map((i) => staveNotes[i]);
    const voice = new VF.Voice({ num_beats: 4, beat_value: 4 }).setStrict(true);
    voice.addTickables(notesForMeasure);

    measures.push({ stave, voice, notes: notesForMeasure });
  }

  // applyAccidentals reads one voice as one measure, which is exactly how the
  // MusicXML export tracks them, so the page and the file agree on every
  // sharp and every courtesy natural.
  VF.Accidental.applyAccidentals(measures.map((entry) => entry.voice), 'C');

  // Pass 2: beam, format, draw — in that order, and the order is the point.
  // A StaveNote draws its own stem only while it has no beam, and Beam.draw
  // draws stems for the notes it owns. Beaming after the voice is drawn
  // leaves both behind: two stems on every beamed note, plus the flags the
  // note drew when it still thought it was unbeamed.
  for (const { stave, voice, notes } of measures) {
    // beam_rests:false (the default) correctly breaks beam groups at rests.
    const beams = VF.Beam.generateBeams(notes);

    stave.setContext(ctx).draw();
    new VF.Formatter().joinVoices([voice]).format([voice], measureWidth - 62);
    voice.draw(ctx, stave);
    beams.forEach((b) => b.setContext(ctx).draw());
  }

  // Ties are drawn after every measure is formatted, since a tie reads the
  // final rendered position of both notes.
  //
  // A tie can only be one curve while both its notes are on the same system.
  // Across a system break the two ends are metres apart on the page, and a
  // single curve between them is drawn as a long diagonal rule straight
  // across the score. Notation splits it instead: a stub trailing off the
  // end of one system and another arriving at the start of the next, which
  // is exactly what VexFlow draws when one end is left unset.
  const rowOfUnit = (i) => Math.floor(units[i].measureIndex / measuresPerRow);
  const drawTie = (firstNote, lastNote) => new VF.StaveTie({
    first_note: firstNote,
    last_note: lastNote,
    first_indices: [0],
    last_indices: [0],
  }).setContext(ctx).draw();

  units.forEach((u, i) => {
    if (!u.tieToNext || i + 1 >= staveNotes.length) return;
    if (rowOfUnit(i) === rowOfUnit(i + 1)) {
      drawTie(staveNotes[i], staveNotes[i + 1]);
    } else {
      drawTie(staveNotes[i], undefined);
      drawTie(undefined, staveNotes[i + 1]);
    }
  });

  return {
    numMeasures,
    noteCount: units.filter((u) => u.note !== REST).length,
    clef: clef.label,
  };
}

/* ══════════════════════════════════════════════════════════
   METRONOME
   Clicks on the audio clock, not on setTimeout: a timer fired
   from the main thread drifts under layout and GC, and a click
   track that drifts is worse than none. A short scheduler runs
   ahead of the playhead and books each beat at an exact time.

   The click is a filtered noise burst rather than a tone, and
   that is deliberate. Echo cancellation is off during capture,
   so without headphones the click bleeds into the microphone.
   Noise has no periodicity for YIN to lock onto, so a bleeding
   click is read as unpitched and ignored; a sine would have
   been transcribed as a note.
══════════════════════════════════════════════════════════ */
const METRONOME_LOOKAHEAD = 0.15; // seconds of click track booked ahead
const METRONOME_TICK_MS = 40;     // scheduler wake-up interval
const BEATS_PER_BAR = 4;          // the engraver is 4/4 throughout

class Metronome {
  constructor(audioCtx, bpm) {
    this.ctx = audioCtx;
    this.beatDur = 60 / bpm;
    this.noise = Metronome._noiseBuffer(audioCtx);
    this.timer = null;
  }

  static _noiseBuffer(ctx, seconds = 0.1) {
    const length = Math.ceil(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  start(startTime) {
    this.nextBeat = startTime;
    this.beat = 0;
    this._pump();
    this.timer = setInterval(() => this._pump(), METRONOME_TICK_MS);
  }

  _pump() {
    while (this.nextBeat < this.ctx.currentTime + METRONOME_LOOKAHEAD) {
      this._click(this.nextBeat, this.beat % BEATS_PER_BAR === 0);
      this.nextBeat += this.beatDur;
      this.beat++;
    }
  }

  // Downbeats sit higher and louder so the bar is audible, not just the pulse.
  _click(when, isDownbeat) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;

    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = isDownbeat ? 2600 : 1700;
    band.Q.value = 1.4;

    const gain = this.ctx.createGain();
    const peak = isDownbeat ? 0.5 : 0.26;
    // Ramps are exponential, so they cannot start or land on exactly zero.
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);

    source.connect(band);
    band.connect(gain);
    gain.connect(this.ctx.destination);
    source.start(when);
    source.stop(when + 0.08);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
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
  constructor({ onLevel, onTuner, onTick, onAutoStop, bpm, useMetronome }) {
    this.onLevel = onLevel;
    this.onTuner = onTuner;
    this.onTick = onTick;
    this.onAutoStop = onAutoStop;
    this.bpm = bpm;
    this.useMetronome = useMetronome;
    this.chunks = [];
    this.recording = false;
    this.sampleRate = null;
    this.metronome = null;
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

    // Beat one lands on the moment capture opened, so the click and the
    // sixteenth grid the take is quantized against are the same grid.
    if (this.useMetronome) {
      this.metronome = new Metronome(this.audioCtx, this.bpm);
      this.metronome.start(this.startedAt);
    }

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

    // Silence the click before the context closes, or already-booked
    // clicks fire into a closing context.
    this.metronome?.stop();
    this.metronome = null;

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
  const metronomeToggle = $('#metronomeToggle');
  const metronomeState  = $('#metronomeState');
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
    metronomeToggle.disabled = false;
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
        bpm: clampBpm(bpmInput.value),
        useMetronome: metronomeToggle.checked,
      });
      await recorder.start();
      recordBtn.classList.add('is-recording');
      recordBtn.setAttribute('aria-label', 'Stop recording');
      recordLabel.textContent = 'Stop';
      metaState.textContent = 'RECORDING';
      metaRate.textContent = `${(recorder.sampleRate / 1000).toFixed(1)}kHz`;
      centsTrack.classList.add('is-live');
      bpmInput.disabled = true;
      metronomeToggle.disabled = true;
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
      const runs = analyzeRecording(captured.samples, captured.sampleRate, bpm);

      if (runs.length === 0) {
        showToast('Too short to quantize at this tempo. Record longer, or raise the BPM.', 'error');
        return;
      }
      if (runs.every((r) => r.note === REST)) {
        showToast('No pitched notes detected. Try playing closer to the microphone.', 'error');
        return;
      }

      lastResult = { runs, bpm, seconds: captured.samples.length / captured.sampleRate };

      scoreEmpty.hidden = true;
      scoreContainer.hidden = false;
      const info = renderScore(runs, scoreContainer);

      scoreMeta.textContent =
        `${info.numMeasures} bar${info.numMeasures === 1 ? '' : 's'} · ${info.noteCount} events · ${info.clef} · ${bpm} bpm · ${lastResult.seconds.toFixed(1)}s`;
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
      const xml = buildMusicXML(lastResult.runs, lastResult.bpm, {
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

  const syncMetronomeLabel = () => {
    metronomeState.textContent = metronomeToggle.checked ? 'On' : 'Off';
  };
  metronomeToggle.addEventListener('change', syncMetronomeLabel);
  syncMetronomeLabel();

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (!lastResult) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      try { renderScore(lastResult.runs, scoreContainer); }
      catch (err) { console.error('Re-render on resize failed:', err); }
    }, 160);
  });
});
