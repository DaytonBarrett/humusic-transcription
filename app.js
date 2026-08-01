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
   Groups the per-frame measurements into notes. This is the step
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
// so it has to be found by its attack. At this grid an attack and a swell
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
// material in its own right, not a dropout to be papered over. It is a
// duration rather than a frame count because the frame is now a twelfth of
// a beat: at 200bpm that is 25ms, and two frames of it would be far too
// short a bridge to repair anything.
const MAX_DROPOUT_SECONDS = 0.08;

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
function fillDropouts(frames, maxFillFrames) {
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
    if (audible && end - i <= maxFillFrames && before.voiced && after?.voiced
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

/* ══════════════════════════════════════════════════════════
   THE RHYTHMIC GRID
   One unit is a twelfth of a quarter note. Twelve is the
   smallest number that divides cleanly by both 4 and 3, so the
   same grid measures a sixteenth (3 units) and an eighth-note
   triplet (4 units) exactly, with no rounding either way. A
   sixteenth grid cannot express a triplet at all: a third of a
   beat is 1.33 sixteenths, so triplets were previously rounded
   into a limping 2+1 or 1+2 and written as straight sixteenths.
══════════════════════════════════════════════════════════ */
const UNITS_PER_QUARTER = 12;
const UNITS_PER_BEAT = UNITS_PER_QUARTER; // 4/4 throughout, so a beat is a quarter
const BINARY_OFFSETS = [0, 3, 6, 9];      // sixteenths within a beat
const TRIPLET_OFFSETS = [0, 4, 8];        // eighth-note triplets within a beat

// A beat is only read as a triplet when what was played fits the triplet grid
// better than the straight one, by this much per onset. The margin has to be
// small: the two grids are never far apart. A perfect triplet sits one unit
// off the straight grid at each onset, so that one unit is the entire signal,
// and a measured onset is itself good to about a unit — the pitch window is
// wider than a frame, so a note change smears across the frame that straddles
// it. Demand much more than this and no real triplet is ever found; demand
// much less and straight rhythm sprouts tuplets on measurement noise.
const TRIPLET_MARGIN = 0.35;

// And the fit has to be good in absolute terms, not merely better. Straight
// sixteenths miss the triplet grid by an average of over a unit, so this
// alone rejects them, and it keeps a beat whose onsets are scattered from
// being read as a triplet just because straight fits it even worse.
const TRIPLET_MAX_ERROR = 1;

function nearestOffsetError(position, offsets) {
  let best = Infinity;
  for (const offset of offsets) best = Math.min(best, Math.abs(position - offset));
  return best;
}

/* Returns [{ note, units }] — one entry per note, `units` in twelfths of a
   quarter. Runs rather than a flat per-frame array, because two adjacent
   notes at the same pitch are a distinction a flat array cannot carry. */
function analyzeRecording(samples, sampleRate, bpm) {
  const frameDur = 60 / bpm / UNITS_PER_QUARTER;
  const segmentSamples = Math.max(1, Math.round(frameDur * sampleRate));

  const frames = measureFrames(samples, sampleRate, segmentSamples);
  smoothPitch(frames);
  fillDropouts(frames, Math.max(1, Math.round(MAX_DROPOUT_SECONDS / frameDur)));
  return mergeUnarticulatedRuns(trackNotes(frames));
}

/* ══════════════════════════════════════════════════════════
   BEAT CLASSIFICATION
   Decides, beat by beat, whether what was played divides that
   beat in two or in three, by asking which grid the onsets
   inside it actually landed on. Then it snaps them to whichever
   grid won, so the engraver gets exact durations rather than
   the near-misses a performance produces.

   The decision is per beat rather than per piece because that
   is how triplets occur — a bar of straight eighths with one
   triplet beat in it is ordinary music, and a piece-wide
   setting could not write it down.
══════════════════════════════════════════════════════════ */
function classifyBeats(runs) {
  const totalUnits = runs.reduce((sum, run) => sum + run.units, 0);
  const beatCount = Math.max(1, Math.ceil(totalUnits / UNITS_PER_BEAT));
  const isTriplet = new Array(beatCount).fill(false);

  // Onsets are the run boundaries: where one note stops and the next starts.
  // The very first onset is the downbeat and tells us nothing about how the
  // beat is divided, so it is not evidence either way.
  const onsets = [];
  let at = 0;
  for (const run of runs) {
    if (at > 0) onsets.push(at);
    at += run.units;
  }

  for (let beat = 0; beat < beatCount; beat++) {
    const start = beat * UNITS_PER_BEAT;
    const inside = onsets.filter((o) => o > start && o < start + UNITS_PER_BEAT);
    if (!inside.length) continue; // nothing subdivides this beat

    let binaryError = 0;
    let tripletError = 0;
    for (const onset of inside) {
      const position = onset - start;
      binaryError += nearestOffsetError(position, BINARY_OFFSETS);
      tripletError += nearestOffsetError(position, TRIPLET_OFFSETS);
    }
    isTriplet[beat] = tripletError / inside.length < TRIPLET_MAX_ERROR
      && tripletError + TRIPLET_MARGIN * inside.length < binaryError;
  }

  return isTriplet;
}

// Pulls every run boundary onto the grid its beat was read as — the last one
// included, since a take that stops mid-grid otherwise leaves a length no
// duration can express, and the leftover silently vanishes from the bar.
//
// Runs that collapse to nothing in the process are dropped: a sliver between
// two onsets that snap to the same place was never a note. If that leaves
// nothing at all, the take was shorter than a single grid step, and one step
// of the note that was there beats showing an empty score.
function snapRunsToGrid(runs, isTriplet) {
  const gridFor = (position) => {
    const beat = Math.floor(position / UNITS_PER_BEAT);
    const start = beat * UNITS_PER_BEAT;
    const offsets = isTriplet[beat] ? TRIPLET_OFFSETS : BINARY_OFFSETS;
    // The next downbeat is always a candidate: it closes the last subdivision.
    return offsets.map((offset) => start + offset).concat(start + UNITS_PER_BEAT);
  };

  const snapPosition = (position) => {
    let best = null;
    let bestError = Infinity;
    for (const candidate of gridFor(position)) {
      const error = Math.abs(position - candidate);
      if (error < bestError) { best = candidate; bestError = error; }
    }
    return best;
  };

  const snapped = [];
  let at = 0;
  let cursor = 0;
  for (const run of runs) {
    at += run.units;
    const end = snapPosition(at);
    if (end > cursor) {
      snapped.push({ note: run.note, units: end - cursor, startedByOnset: run.startedByOnset });
      cursor = end;
    }
  }

  if (!snapped.length) {
    const sounded = runs.find((run) => run.note !== REST) || runs[0];
    return [{ note: sounded.note, units: BINARY_OFFSETS[1], startedByOnset: false }];
  }
  return snapped;
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

const AUTO_BASS_MARGIN = 2;

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
  // switch rather than win on a hair: it must save well over two ledger lines
  // per note-length on average. Around middle C the two staves are near
  // enough to symmetric that a bare comparison flips on a single ledger line,
  // which is how a hummed melody sitting just under the treble staff ends up
  // under a bass clef. A real bass line clears this easily — an E2-A2 figure
  // saves five or six — while a voice noodling around G3 does not.
  return trebleCost - bassCost > totalUnits * AUTO_BASS_MARGIN ? CLEFS.bass : CLEFS.treble;
}

/* Which clef to set the line on. Auto reads it from the music, but the
   reading is a judgement call in the register between the staves, and it
   cannot know whether it is listening to a tenor (treble clef, by
   convention) or a cello (bass). So the choice is offered rather than
   imposed, and it defaults to the clef a melody is usually written in. */
const CLEF_MODES = ['treble', 'bass', 'auto'];
const DEFAULT_CLEF_MODE = 'treble';

function resolveClef(runs, mode) {
  if (mode === 'bass') return CLEFS.bass;
  if (mode === 'auto') return chooseClef(runs);
  return CLEFS.treble;
}

/* ══════════════════════════════════════════════════════════
   ENGRAVING MODEL
   Turns the tracker's runs into correctly tied, barred
   durations — not a naive grid of 16th notes, but idiomatic
   values the way a person would notate.
   Both the on-screen score and the MusicXML export are built
   from this single model, so they cannot drift apart.
══════════════════════════════════════════════════════════ */
const UNITS_PER_MEASURE = UNITS_PER_QUARTER * 4; // 4/4

// Largest-to-smallest canonical duration units. Greedy decomposition over
// this set is exact for every multiple of 3 up to a full bar — which is
// every length a straight beat can produce, since the finest straight value
// is a sixteenth at 3 units. Lengths off that lattice are triplet lengths
// and go through the tuplet path below instead.
const DURATION_STEPS = [
  [48, 'w'], [36, 'hd'], [24, 'h'], [18, 'qd'], [12, 'q'], [9, '8d'], [6, '8'], [3, '16'],
];

// Inside a triplet beat the written value is what a reader sees — an eighth —
// while the sounding length is two thirds of it. Three triplet eighths (4
// units each) fill the beat, and two of them merge into a written quarter.
const TRIPLET_STEPS = [[8, 'q'], [4, '8']];

// VexFlow token → [MusicXML note-type, dot count, written length in units]
const XML_DURATION = {
  w:  ['whole',   0, 48],
  hd: ['half',    1, 36],
  h:  ['half',    0, 24],
  qd: ['quarter', 1, 18],
  q:  ['quarter', 0, 12],
  '8d': ['eighth', 1, 9],
  '8':  ['eighth', 0, 6],
  '16': ['16th',   0, 3],
};

function decomposeSteps(units, steps) {
  const tokens = [];
  let remaining = units;
  for (const [u, dur] of steps) {
    while (remaining >= u) { tokens.push(dur); remaining -= u; }
  }
  return tokens;
}

const decomposeDuration = (units) => decomposeSteps(units, DURATION_STEPS);

// Groups the beats into the stretches the engraver can treat as one unit of
// notation. Consecutive straight beats merge, so a half note across two of
// them stays a half note rather than two tied quarters. A triplet beat never
// merges with anything: its contents are written against a different grid,
// and a tuplet bracket cannot span a beat it does not own. Bar lines always
// break a span, since no note may be written through one.
function buildSpans(totalUnits, isTriplet) {
  const spans = [];
  const beats = Math.ceil(totalUnits / UNITS_PER_BEAT);
  for (let beat = 0; beat < beats; beat++) {
    const start = beat * UNITS_PER_BEAT;
    const triplet = !!isTriplet[beat];
    const previous = spans[spans.length - 1];
    if (previous && !triplet && !previous.triplet && start % UNITS_PER_MEASURE !== 0) {
      previous.end = start + UNITS_PER_BEAT;
    } else {
      spans.push({ start, end: start + UNITS_PER_BEAT, triplet });
    }
  }
  return spans;
}

// Splits runs across span boundaries and decomposes each piece into duration
// tokens, threading `tieToNext` through both within-piece ties (a 15-unit run
// becomes a tied dotted quarter + sixteenth) and cross-span ties (a run that
// spans a barline, or that runs from a straight beat into a triplet one).
function buildEngravingUnits(runs, isTriplet) {
  const played = runs.reduce((sum, run) => sum + run.units, 0);

  // A take almost never stops exactly on a barline, so the last measure is
  // usually short. Fill the remainder with rests: VexFlow formats voices in
  // strict mode and throws IncompleteVoice on any measure that doesn't total
  // four beats, and MusicXML importers expect full measures too.
  const shortfall = (UNITS_PER_MEASURE - (played % UNITS_PER_MEASURE)) % UNITS_PER_MEASURE;
  const events = shortfall ? [...runs, { note: REST, units: shortfall }] : runs;

  const spans = buildSpans(played + shortfall, isTriplet);
  const units = [];
  let position = 0;
  let spanIndex = 0;

  for (const run of events) {
    let remaining = run.units;
    while (remaining > 0) {
      while (spanIndex < spans.length - 1 && position >= spans[spanIndex].end) spanIndex++;
      const span = spans[spanIndex];
      const take = Math.min(remaining, span.end - position);
      const isFinalPieceOfRun = take === remaining;

      // A note filling a whole triplet beat is just a quarter note. It is
      // only a tuplet when the beat is actually divided into three.
      const inTuplet = span.triplet && take < UNITS_PER_BEAT;
      const tokens = inTuplet
        ? decomposeSteps(take, TRIPLET_STEPS)
        : decomposeDuration(take);
      const tupletId = inTuplet ? `tuplet-${span.start}` : null;

      tokens.forEach((vfDur, idx) => {
        const isFinalToken = idx === tokens.length - 1;
        const tieToNext = run.note !== REST && (!isFinalToken || !isFinalPieceOfRun);
        units.push({
          measureIndex: Math.floor(position / UNITS_PER_MEASURE),
          note: run.note,
          vfDur,
          tieToNext,
          tupletId,
        });
      });

      position += take;
      remaining -= take;
    }
  }

  return units;
}

function modelFromRuns(runs, clefMode = DEFAULT_CLEF_MODE) {
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

  // Quantizing happens here rather than during analysis because it depends on
  // where beat one is, and beat one is the first note played — which is only
  // known once the leading silence has been trimmed.
  const isTriplet = classifyBeats(played);
  const snapped = snapRunsToGrid(played, isTriplet);

  const units = buildEngravingUnits(snapped, isTriplet);
  if (!units.length) return null;
  const numMeasures = units[units.length - 1].measureIndex + 1;
  const groups = Array.from({ length: numMeasures }, () => []);
  units.forEach((u, i) => groups[u.measureIndex].push(i));
  return {
    units,
    numMeasures,
    groups,
    clef: resolveClef(snapped, clefMode),
    runs: snapped,
    hasTriplets: isTriplet.some(Boolean),
  };
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
// Divisions per quarter. Twelve, matching the grid, so both a sixteenth (3)
// and a triplet eighth (4) come out as whole numbers — MusicXML durations
// must be integers, and a divisions value that cannot express a triplet is
// the usual reason tuplets arrive in a notation program subtly out of time.
const XML_DIVISIONS = UNITS_PER_QUARTER;

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
  const model = modelFromRuns(runs, options.clefMode);
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
      const [xmlType, dots, written] = XML_DURATION[u.vfDur];
      const tieStop = i > 0 && units[i - 1].tieToNext;
      const tieStart = u.tieToNext;

      // A tuplet member is written as one value and sounds as another: three
      // in the time of two, so two thirds of the written length. The grid is
      // twelfths of a quarter precisely so that division stays exact.
      const inTuplet = !!u.tupletId;
      const duration = inTuplet ? (written * 2) / 3 : written;
      const tupletStart = inTuplet && (i === 0 || units[i - 1].tupletId !== u.tupletId);
      const tupletStop = inTuplet
        && (i === units.length - 1 || units[i + 1].tupletId !== u.tupletId);

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
      if (inTuplet) {
        out.push('        <time-modification>');
        out.push('          <actual-notes>3</actual-notes>');
        out.push('          <normal-notes>2</normal-notes>');
        out.push('        </time-modification>');
      }

      if (tieStop || tieStart || tupletStart || tupletStop) {
        out.push('        <notations>');
        if (tieStop)  out.push('          <tied type="stop"/>');
        if (tieStart) out.push('          <tied type="start"/>');
        if (tupletStart) out.push('          <tuplet type="start" bracket="yes"/>');
        if (tupletStop)  out.push('          <tuplet type="stop"/>');
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
function renderScore(runs, container, options = {}) {
  container.innerHTML = '';
  const model = modelFromRuns(runs, options.clefMode);
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

    // Tuplets have to exist before the voice is formatted. Constructing one
    // is what applies the 2/3 tick multiplier to its notes, and without that
    // three triplet eighths count as three straight eighths — the bar then
    // measures four and a half beats and strict formatting rejects it.
    const tuplets = [];
    let group = [];
    let groupId = null;
    const closeGroup = () => {
      if (group.length > 1) {
        tuplets.push(new VF.Tuplet(group, { num_notes: 3, notes_occupied: 2 }));
      }
      group = [];
    };
    groups[m].forEach((i) => {
      const id = units[i].tupletId;
      if (id !== groupId) { closeGroup(); groupId = id; }
      if (id) group.push(staveNotes[i]);
    });
    closeGroup();

    const voice = new VF.Voice({ num_beats: 4, beat_value: 4 }).setStrict(true);
    voice.addTickables(notesForMeasure);

    measures.push({ stave, voice, notes: notesForMeasure, tuplets });
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
  for (const { stave, voice, notes, tuplets } of measures) {
    // beam_rests:false (the default) correctly breaks beam groups at rests.
    const beams = VF.Beam.generateBeams(notes);

    stave.setContext(ctx).draw();
    new VF.Formatter().joinVoices([voice]).format([voice], measureWidth - 62);
    voice.draw(ctx, stave);
    beams.forEach((b) => b.setContext(ctx).draw());
    // Brackets and the 3 are drawn last: a tuplet is positioned from where
    // its notes and their beams ended up, not from where they were asked for.
    tuplets.forEach((t) => t.setContext(ctx).draw());
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
    hasTriplets: model.hasTriplets,
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

function createNoiseBuffer(ctx, seconds) {
  const length = Math.max(1, Math.ceil(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

class Metronome {
  constructor(audioCtx, bpm) {
    this.ctx = audioCtx;
    this.beatDur = 60 / bpm;
    this.noise = createNoiseBuffer(audioCtx, 0.1);
    this.timer = null;
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
   INSTRUMENTS
   Every voice is synthesised from oscillators and noise. Not a
   stylistic choice — the bundle has to run with no network at
   all, and a sampled instrument worth listening to is megabytes
   of audio that would have to be embedded in the page.

   So each one is built from the part of its physics that the
   ear actually uses to name it: a struck string's partials
   decaying at different rates, a plucked string's travelling
   wave, a reed's formants. Cheap models, but recognisable, and
   the whole set costs nothing to ship.
══════════════════════════════════════════════════════════ */

// Exponential ramps cannot touch zero, so silence is this instead.
const SILENT = 0.0001;

/* A cheap plucked string. Karplus-Strong: fill a delay line one period long
   with noise, then read it round and round, averaging neighbouring samples
   each time round. The averaging is a lowpass, so the high partials die
   first and what is left settles into the pitch — which is what a plucked
   string does. It is rendered into a buffer rather than built from nodes
   because a Web Audio feedback loop is quantised to a 128-sample block,
   putting a floor of about 344Hz on the pitch it can express. */
function renderPluckedString(ctx, freq, seconds, damping) {
  const rate = ctx.sampleRate;
  const total = Math.max(2, Math.ceil(seconds * rate));
  const period = Math.max(2, Math.round(rate / freq));
  const buffer = ctx.createBuffer(1, total, rate);
  const y = buffer.getChannelData(0);

  // The excitation is lowpassed noise: raw noise is a click, and a pick is
  // not a click.
  let smoothed = 0;
  for (let i = 0; i < period && i < total; i++) {
    smoothed = 0.6 * smoothed + 0.4 * (Math.random() * 2 - 1);
    y[i] = smoothed;
  }
  for (let i = period; i < total; i++) {
    const previous = i - period - 1 >= 0 ? y[i - period - 1] : y[i - period];
    y[i] = damping * 0.5 * (y[i - period] + previous);
  }
  return buffer;
}

function playGuitar(ctx, out, freq, when, duration) {
  // A plucked string cannot sustain, so a long note is a decaying one and
  // rendering more than a few seconds of it is rendering silence.
  const ring = Math.min(3.2, duration + 1.1);
  const source = ctx.createBufferSource();
  source.buffer = renderPluckedString(ctx, freq, ring, 0.9965);

  // The damping has to finish inside the buffer. Scheduling a release past
  // the end of the rendered string leaves the envelope holding a note that
  // stopped sounding — silence either way, but silence the envelope thinks
  // is still ringing, and any later change to the tail would be a no-op.
  const held = Math.min(duration, Math.max(0.05, ring - 0.3));
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.5, when);
  gain.gain.setValueAtTime(0.5, when + held);
  gain.gain.exponentialRampToValueAtTime(SILENT, when + Math.min(ring, held + 0.28));

  const body = ctx.createBiquadFilter();
  body.type = 'peaking';
  body.frequency.value = 220;   // the box resonance that makes it a guitar
  body.Q.value = 1.1;
  body.gain.value = 4;

  source.connect(body);
  body.connect(gain);
  gain.connect(out);
  source.start(when);
  source.stop(when + ring + 0.05);
}

/* A struck string: partials that start together and decay at their own
   rates, the upper ones first. That difference is most of what separates a
   struck string from a held tone, and the slight sharpness of the upper
   partials — real strings are stiff, so they are not exact multiples — is
   most of what stops it sounding like an organ. */
function playPiano(ctx, out, freq, when, duration) {
  const damped = when + duration;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.42, when);
  master.gain.setValueAtTime(0.42, damped);
  master.gain.exponentialRampToValueAtTime(SILENT, damped + 0.14);
  master.connect(out);

  // Lower notes ring far longer than high ones.
  const base = Math.max(0.45, 3.4 - Math.log2(Math.max(freq, 27.5) / 55) * 0.62);
  const partials = [[1, 1, 1], [2, 0.30, 0.62], [3, 0.13, 0.44], [4, 0.07, 0.32], [6, 0.03, 0.22]];

  for (const [multiple, level, decayScale] of partials) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * multiple * (1 + 0.0007 * multiple * multiple);

    const decay = base * decayScale;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(SILENT, when);
    gain.gain.exponentialRampToValueAtTime(level, when + 0.004);
    gain.gain.exponentialRampToValueAtTime(SILENT, when + 0.004 + decay);

    osc.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(Math.min(when + 0.004 + decay, damped + 0.2) + 0.02);
  }
}

/* Two detuned saws through a filter that closes as the note sounds — the
   plainest subtractive voice there is, and the reference point the other
   three are heard against. */
function playSynth(ctx, out, freq, when, duration) {
  const end = when + duration;
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 4;
  filter.frequency.setValueAtTime(Math.min(11000, freq * 8), when);
  filter.frequency.exponentialRampToValueAtTime(Math.min(11000, Math.max(220, freq * 2.2)), end + 0.05);

  gain.gain.setValueAtTime(SILENT, when);
  gain.gain.exponentialRampToValueAtTime(0.22, when + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.16, Math.max(when + 0.02, end));
  gain.gain.exponentialRampToValueAtTime(SILENT, end + 0.07);

  for (const detune of [-7, 7]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    osc.detune.value = detune;
    osc.connect(filter);
    osc.start(when);
    osc.stop(end + 0.1);
  }

  filter.connect(gain);
  gain.connect(out);
}

/* A reed: a saw for the buzz, two fixed resonances for the nasal colour a
   conical bore gives, a breath layer, and vibrato that arrives a moment
   after the note does — which is how a player uses it, and most of why a
   sustained synthetic tone reads as a person rather than a machine. */
function playSax(ctx, out, freq, when, duration) {
  const end = when + duration;

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = freq;

  const vibrato = ctx.createOscillator();
  vibrato.frequency.value = 5.1;
  const vibratoDepth = ctx.createGain();
  vibratoDepth.gain.setValueAtTime(0, when);
  vibratoDepth.gain.linearRampToValueAtTime(7, when + Math.min(0.4, duration));
  vibrato.connect(vibratoDepth);
  vibratoDepth.connect(osc.detune);

  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = Math.min(9000, freq * 7);
  const formantOne = ctx.createBiquadFilter();
  formantOne.type = 'peaking';
  formantOne.frequency.value = 720;
  formantOne.Q.value = 1.2;
  formantOne.gain.value = 7;
  const formantTwo = ctx.createBiquadFilter();
  formantTwo.type = 'peaking';
  formantTwo.frequency.value = 1800;
  formantTwo.Q.value = 1.5;
  formantTwo.gain.value = 8;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(SILENT, when);
  gain.gain.exponentialRampToValueAtTime(0.24, when + Math.min(0.05, duration * 0.4));
  gain.gain.exponentialRampToValueAtTime(0.21, Math.max(when + 0.06, end));
  gain.gain.exponentialRampToValueAtTime(SILENT, end + 0.09);

  osc.connect(tone);
  tone.connect(formantOne);
  formantOne.connect(formantTwo);
  formantTwo.connect(gain);
  gain.connect(out);

  // Breath: quiet, but its absence is what makes a reed sound synthetic.
  const breath = ctx.createBufferSource();
  breath.buffer = createNoiseBuffer(ctx, Math.max(0.25, duration + 0.2));
  const breathBand = ctx.createBiquadFilter();
  breathBand.type = 'bandpass';
  breathBand.frequency.value = 2400;
  breathBand.Q.value = 0.8;
  const breathGain = ctx.createGain();
  breathGain.gain.setValueAtTime(SILENT, when);
  breathGain.gain.exponentialRampToValueAtTime(0.02, when + 0.04);
  breathGain.gain.exponentialRampToValueAtTime(SILENT, end + 0.06);
  breath.connect(breathBand);
  breathBand.connect(breathGain);
  breathGain.connect(out);

  osc.start(when);
  vibrato.start(when);
  breath.start(when);
  osc.stop(end + 0.12);
  vibrato.stop(end + 0.12);
  breath.stop(end + 0.12);
}

const INSTRUMENTS = {
  synth:  { label: 'Synth',      voice: playSynth },
  piano:  { label: 'Piano',      voice: playPiano },
  guitar: { label: 'Guitar',     voice: playGuitar },
  sax:    { label: 'Saxophone',  voice: playSax },
};

const DEFAULT_INSTRUMENT = 'piano';

/* ══════════════════════════════════════════════════════════
   PLAYBACK
   Plays the transcription — not the recording. The point is to
   hear what was written down, so that a wrong note or a wrong
   rhythm is audible as a wrong note rather than having to be
   read off the staff. It therefore plays the quantized model
   the score is drawn from, triplets and all.

   Voices are booked a fraction of a second ahead on the audio
   clock, like the metronome and for the same reason: a long
   take would otherwise mean thousands of nodes created at once,
   and setTimeout is not a musical instrument.
══════════════════════════════════════════════════════════ */
const PLAYBACK_LOOKAHEAD = 0.2;
const PLAYBACK_TICK_MS = 40;
const PLAYBACK_LEAD_IN = 0.12;

// Notes are released a touch early so that two of the same pitch in a row
// are heard as two notes rather than one long one.
function buildPlaybackSchedule(runs, bpm) {
  const unitSeconds = 60 / bpm / UNITS_PER_QUARTER;
  const notes = [];
  let at = 0;
  for (const run of runs) {
    const span = run.units * unitSeconds;
    if (run.note !== REST) {
      const freq = noteToFrequency(run.note);
      if (freq) notes.push({ freq, start: at, duration: Math.max(0.05, span - Math.min(0.045, span * 0.12)) });
    }
    at += span;
  }
  return { notes, totalSeconds: at };
}

class Player {
  constructor({ onStateChange } = {}) {
    this.onStateChange = onStateChange;
    this.ctx = null;
    this.timer = null;
    this.playing = false;
  }

  async play(runs, bpm, instrumentKey) {
    this.stop();
    const instrument = INSTRUMENTS[instrumentKey] || INSTRUMENTS[DEFAULT_INSTRUMENT];
    const { notes, totalSeconds } = buildPlaybackSchedule(runs, bpm);
    if (!notes.length) return false;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);

    this.notes = notes;
    this.index = 0;
    this.instrument = instrument;
    this.startedAt = this.ctx.currentTime + PLAYBACK_LEAD_IN;
    this.endsAt = this.startedAt + totalSeconds + 0.5;
    this.playing = true;
    this.onStateChange?.(true);

    this._pump();
    this.timer = setInterval(() => this._pump(), PLAYBACK_TICK_MS);
    return true;
  }

  _pump() {
    if (!this.playing || !this.ctx) return;
    const horizon = this.ctx.currentTime + PLAYBACK_LOOKAHEAD;
    while (this.index < this.notes.length && this.startedAt + this.notes[this.index].start < horizon) {
      const note = this.notes[this.index++];
      this.instrument.voice(this.ctx, this.master, note.freq, this.startedAt + note.start, note.duration);
    }
    if (this.index >= this.notes.length && this.ctx.currentTime >= this.endsAt) this.stop();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;

    if (this.ctx) {
      const ctx = this.ctx;
      const master = this.master;
      this.ctx = null;
      this.master = null;
      // Fade before closing. Closing a context on top of sounding voices
      // cuts them mid-cycle, which clicks.
      try {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
        master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.06);
      } catch (err) { /* the context may already be closing */ }
      setTimeout(() => { ctx.close().catch(() => {}); }, 140);
    }

    if (this.playing) {
      this.playing = false;
      this.onStateChange?.(false);
    }
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
  const playBtn     = $('#playBtn');
  const playLabel   = $('#playLabel');
  const voiceSelect = $('#voiceSelect');
  const clefSelect  = $('#clefSelect');
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
    // The mic is about to open; anything still sounding would be recorded.
    player.stop();

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
      const info = renderScore(runs, scoreContainer, { clefMode: clefSelect.value });

      const parts = [
        `${info.numMeasures} bar${info.numMeasures === 1 ? '' : 's'}`,
        `${info.noteCount} events`,
      ];
      if (info.hasTriplets) parts.push('triplets');
      parts.push(info.clef, `${bpm} bpm`, `${lastResult.seconds.toFixed(1)}s`);
      scoreMeta.textContent = parts.join(' · ');

      setPlaybackEnabled(true);
      exportBtn.disabled = false;
      clearBtn.disabled = false;
    } catch (err) {
      console.error('Transcription failed:', err);
      lastResult = null;
      scoreContainer.hidden = true;
      scoreEmpty.hidden = false;
      setPlaybackEnabled(false);
      exportBtn.disabled = true;
      clearBtn.disabled = true;
      showToast('Something went wrong transcribing that take. Try again.', 'error');
    } finally {
      metaState.textContent = 'IDLE';
    }
  }

  /* ── Playback ── */
  const player = new Player({
    onStateChange: (playing) => {
      playBtn.classList.toggle('is-playing', playing);
      playLabel.textContent = playing ? 'Stop' : 'Play';
      playBtn.setAttribute('aria-label', playing ? 'Stop playback' : 'Play the transcription');
    },
  });

  function setPlaybackEnabled(enabled) {
    playBtn.disabled = !enabled;
    voiceSelect.disabled = !enabled;
    clefSelect.disabled = !enabled;
    if (!enabled) player.stop();
  }

  playBtn.addEventListener('click', async () => {
    if (player.playing) { player.stop(); return; }
    if (!lastResult) return;

    // Play what was written down, not what was recorded: the model the score
    // is drawn from, so anything mis-transcribed is audible as such.
    const model = modelFromRuns(lastResult.runs);
    if (!model) { showToast('Nothing to play in that take.', 'error'); return; }

    try {
      await player.play(model.runs, lastResult.bpm, voiceSelect.value);
    } catch (err) {
      console.error('Playback failed:', err);
      player.stop();
      showToast('Could not start playback.', 'error');
    }
  });

  // Changing the clef re-engraves from the same model: only the staff the
  // notes are set on changes, never the notes themselves.
  clefSelect.addEventListener('change', () => {
    if (!lastResult) return;
    try {
      const info = renderScore(lastResult.runs, scoreContainer, { clefMode: clefSelect.value });
      scoreMeta.textContent = scoreMeta.textContent.replace(/(treble|bass)/, info.clef);
    } catch (err) {
      console.error('Re-engraving on clef change failed:', err);
    }
  });

  // Switching voice mid-phrase restarts on the new one rather than finishing
  // the phrase on the old, which is what makes it useful for comparing them.
  voiceSelect.addEventListener('change', async () => {
    if (!player.playing || !lastResult) return;
    const model = modelFromRuns(lastResult.runs);
    if (model) await player.play(model.runs, lastResult.bpm, voiceSelect.value);
  });

  exportBtn.addEventListener('click', async () => {
    if (!lastResult) return;
    exportBtn.disabled = true;
    try {
      const xml = buildMusicXML(lastResult.runs, lastResult.bpm, {
        title: `humusic transcription — ${lastResult.bpm} bpm`,
        clefMode: clefSelect.value,
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
    setPlaybackEnabled(false);
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
      try { renderScore(lastResult.runs, scoreContainer, { clefMode: clefSelect.value }); }
      catch (err) { console.error('Re-render on resize failed:', err); }
    }, 160);
  });
});
