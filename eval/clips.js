/* Synthetic takes with exact ground truth.

   Every clip here exists to provoke one specific failure, because an
   aggregate score over "some music" tells you the detector got worse
   without telling you where. A real recording cannot do this job: its
   ground truth is somebody's opinion about where a note began, to a
   tolerance looser than the thing being measured.

   Notes are written in beats, so a clip reads like the bar it represents
   and lands exactly on the grid the quantizer is going to fit it to. Any
   accuracy lost is the detector's, not the fixture's. */

const RATE = 44100;

/* Noise has to be the same noise every run, or the harness cannot answer
   the only question it exists to answer. Two runs of the same engine would
   differ by more than most real changes do, and a genuine regression would
   be indistinguishable from a bad roll. Seeded per clip, so adding a clip
   does not reshuffle the ones already there. */
function seededNoise(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

const seedFor = (name) => {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) hash = Math.imul(hash ^ name.charCodeAt(i), 16777619);
  return hash >>> 0;
};

/* Harmonic amplitudes, relative to the fundamental.

   `hollow` is the octave trap, and the only one that needs explaining: a
   tone whose fundamental is absent but whose upper partials are all present
   still sounds at the missing fundamental — the ear reconstructs it from
   the spacing. Spectral peak-picking reports the loudest partial and is
   wrong by an octave or a twelfth; autocorrelation reads the spacing and
   gets it right, which is exactly the claim this harness is here to keep
   honest. A phone speaker playing back a low note is doing this to you.

   `release` is how long the note rings past its written length, and it is
   per-timbre for the same reason — it is a fact about the instrument rather
   than a knob. A singer or a reed player stops the note and what is left is
   the room; a plucked string goes on sounding under the notes that follow
   it, which is what makes the repeated-note and long-decay clips hard.
   Giving everything a plucked string's overhang would stack every note onto
   the one before it and test beating between notes instead of the thing
   being measured. */
const TIMBRES = {
  voice:  { partials: [1, 0.5, 0.32, 0.2, 0.12, 0.07], attack: 0.02,  decay: 0.9, release: 0.05 },
  reed:   { partials: [1, 0.15, 0.6, 0.1, 0.35, 0.08, 0.2], attack: 0.012, decay: 0.6, release: 0.04 },
  pluck:  { partials: [1, 0.7, 0.45, 0.3, 0.22, 0.15, 0.1], attack: 0.004, decay: 3.6, release: 0.6 },
  hollow: { partials: [0, 0.6, 0.75, 0.5, 0.4, 0.25, 0.15], attack: 0.015, decay: 0.9, release: 0.05 },
};

const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/* A note list, in beats, into samples.

   Phase runs continuously across the whole clip rather than restarting per
   note. That is what makes `legato: true` mean anything: with no re-attack
   and no phase discontinuity there is no energy step at the boundary, which
   is the case an amplitude-only onset detector cannot see however it is
   tuned. */
function render(notes, bpm, timbre, options = {}, seed = 1) {
  const { vibratoCents = 0, vibratoHz = 5.5, legato = false, noise = 0.0015 } = options;
  const { partials, attack, decay, release } = TIMBRES[timbre];
  const beat = 60 / bpm;
  const tail = 0.35;
  const total = Math.ceil((notes[notes.length - 1].start + notes[notes.length - 1].beats) * beat * RATE + tail * RATE);
  const out = new Float32Array(total);

  const phases = new Float32Array(partials.length);

  for (const note of notes) {
    const from = Math.round(note.start * beat * RATE);
    const held = note.beats * beat;
    // A plucked note rings past its written length; a sung one is released.
    const sounding = held + (legato ? 0 : release);
    const span = Math.round(sounding * RATE);
    const base = midiToHz(note.midi);

    if (!legato) phases.fill(0);

    for (let i = 0; i < span; i++) {
      const t = i / RATE;
      const vibrato = vibratoCents
        ? Math.pow(2, (vibratoCents / 1200) * Math.sin(2 * Math.PI * vibratoHz * t))
        : 1;

      let sample = 0;
      for (let p = 0; p < partials.length; p++) {
        if (!partials[p]) continue;
        phases[p] += (2 * Math.PI * base * vibrato * (p + 1)) / RATE;
        sample += partials[p] * Math.sin(phases[p]);
      }

      // Attack ramp, then an exponential fall, then a fade over the last
      // few milliseconds so a stopped note does not end on a click.
      const rise = Math.min(1, t / attack);
      const fall = Math.exp(-t / decay);
      const fade = i > span - 0.008 * RATE ? (span - i) / (0.008 * RATE) : 1;
      const gain = legato ? rise * fade : rise * fall * fade;

      const at = from + i;
      if (at < total) out[at] += sample * gain * 0.22;
    }
  }

  if (noise) {
    const hiss = seededNoise(seed);
    for (let i = 0; i < total; i++) out[i] += hiss() * noise;
  }
  return out;
}

// Shorthand: notes laid end to end, each `beats` long, from a list of
// [midi, beats] pairs. Most clips are a straight run of notes.
function sequence(pairs) {
  let at = 0;
  return pairs.map(([midi, beats]) => {
    const note = { midi, start: at, beats };
    at += beats;
    return note;
  });
}

const scale = (root, beats) => sequence([0, 2, 4, 5, 7, 9, 11, 12].map((step) => [root + step, beats]));

const CLIPS = [
  {
    name: 'scale-quarters',
    what: 'Clean C major scale, quarter notes. If this is not perfect nothing else matters.',
    bpm: 100,
    notes: scale(60, 1),
    timbre: 'voice',
  },
  {
    name: 'scale-eighths',
    what: 'The same scale at twice the speed — shorter notes, less to measure each one from.',
    bpm: 100,
    notes: scale(60, 0.5),
    timbre: 'voice',
  },
  {
    name: 'sustain-vibrato',
    what: 'Held notes with 70 cents of vibrato. A sustain that wobbles across a semitone boundary must stay one note.',
    bpm: 84,
    notes: sequence([[67, 2], [69, 2], [65, 4]]),
    timbre: 'voice',
    options: { vibratoCents: 70 },
  },
  {
    name: 'legato-steps',
    what: 'Slurred steps: pitch moves, level does not. Nothing for an amplitude-only onset detector to find.',
    bpm: 96,
    notes: sequence([[62, 1], [64, 1], [65, 1], [67, 1], [65, 1], [64, 1], [62, 2]]),
    timbre: 'reed',
    options: { legato: true },
  },
  {
    name: 'low-register',
    what: 'Bass line around C2–C3, where the analysis window holds fewest periods. The classic octave-error ground.',
    bpm: 76,
    notes: sequence([[36, 1], [43, 1], [40, 1], [36, 1], [38, 2], [36, 2]]),
    timbre: 'pluck',
  },
  {
    name: 'missing-fundamental',
    what: 'Upper partials only. Sounds at the written pitch; peak-picking reports an octave up.',
    bpm: 90,
    notes: sequence([[55, 1], [57, 1], [59, 1], [60, 1]]),
    timbre: 'hollow',
  },
  {
    name: 'repeated-note',
    what: 'One pitch struck six times. Every boundary here is an onset and nothing else.',
    bpm: 108,
    notes: sequence([[64, 0.5], [64, 0.5], [64, 1], [64, 0.5], [64, 0.5], [64, 1]]),
    timbre: 'pluck',
  },
  {
    name: 'long-decay',
    what: 'Whole notes on a decaying timbre. The tail must not be read as silence and punched out as a rest.',
    bpm: 60,
    notes: sequence([[60, 4], [64, 4]]),
    timbre: 'pluck',
  },
  {
    name: 'triplets',
    what: 'Two beats of eighth-note triplets between straight quarters — the reason the grid is twelfths.',
    bpm: 96,
    notes: sequence([
      [60, 1], [62, 1 / 3], [64, 1 / 3], [65, 1 / 3], [67, 1 / 3], [65, 1 / 3], [64, 1 / 3], [62, 1],
    ]),
    timbre: 'voice',
  },
  {
    name: 'mixed-rhythm',
    what: 'Dotted values and sixteenths in one bar — the durations the consolidator has to recover.',
    bpm: 88,
    notes: sequence([[67, 1.5], [69, 0.5], [71, 0.25], [72, 0.25], [71, 0.5], [69, 1]]),
    timbre: 'voice',
  },
  {
    name: 'wide-leaps',
    what: 'Octave-and-a-half leaps in both directions. A pitch tracker that smooths too hard will not follow.',
    bpm: 84,
    notes: sequence([[60, 1], [79, 1], [62, 1], [77, 1], [64, 2]]),
    timbre: 'voice',
  },
  {
    name: 'breathy-sustain',
    what: 'Held notes under heavy breath noise. The periodicity is there but shallow — where a fixed detection threshold gives out.',
    bpm: 80,
    notes: sequence([[64, 2], [67, 2], [65, 2], [62, 2]]),
    timbre: 'voice',
    options: { vibratoCents: 45, noise: 0.055 },
  },
  {
    name: 'noisy-room',
    what: 'The scale again with a poor signal-to-noise ratio — a phone on a table across the room.',
    bpm: 100,
    notes: scale(60, 1),
    timbre: 'voice',
    options: { noise: 0.04 },
  },
  {
    name: 'quiet-take',
    what: 'The same scale recorded far too softly. Thresholds that are absolute rather than relative fail here.',
    bpm: 100,
    notes: scale(60, 1),
    timbre: 'voice',
    options: { gain: 0.1 },
  },
];

// Audio plus the reference the audio was built from, in seconds.
function build(clip) {
  const samples = render(clip.notes, clip.bpm, clip.timbre, clip.options, seedFor(clip.name));
  if (clip.options?.gain) for (let i = 0; i < samples.length; i++) samples[i] *= clip.options.gain;

  const beat = 60 / clip.bpm;
  const reference = clip.notes.map((note) => ({
    midi: note.midi,
    onset: note.start * beat,
    offset: (note.start + note.beats) * beat,
  }));

  return { samples, sampleRate: RATE, reference };
}

function toWav(samples, sampleRate) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + samples.length * 2, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    bytes.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return bytes;
}

module.exports = { CLIPS, build, toWav, RATE };
