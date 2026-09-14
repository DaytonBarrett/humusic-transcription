/* Strummed guitar with known harmony, for the chord reader.

   Voicings are the shapes a guitarist's hand actually makes, not the chord
   spelled upward from its root, and that matters more here than anywhere
   else in the harness: an open G puts a B under the G twice over, a D/F♯
   needs the thumb on the sixth string, and the difference between those two
   facts is the difference between naming a chord and naming its inversion.
   Reading a chord off a tidy root-position triad proves nothing about
   reading one off a guitar. */

const RATE = 44100;

const SHAPES = {
  E:       [40, 47, 52, 56, 59, 64],
  Em:      [40, 47, 52, 55, 59, 64],
  A:       [45, 52, 57, 61, 64],
  Am:      [45, 52, 57, 60, 64],
  D:       [50, 57, 62, 66],
  Dm:      [50, 57, 62, 65],
  G:       [43, 47, 50, 55, 59, 67],
  C:       [48, 52, 55, 60, 64],
  F:       [41, 48, 53, 57, 60, 65],
  E7:      [40, 47, 50, 56, 59, 64],
  A7:      [45, 52, 55, 61, 64],
  D7:      [50, 57, 60, 66],
  G7:      [43, 47, 50, 55, 59, 65],
  Cmaj7:   [48, 52, 55, 59, 64],
  Am7:     [45, 52, 55, 60, 64],
  Dm7:     [50, 57, 60, 65],
  Em7:     [40, 47, 52, 55, 59, 62],
  Fmaj7:   [41, 48, 52, 57, 60],
  Asus4:   [45, 52, 57, 62, 64],
  Dsus4:   [50, 57, 62, 67],
  Bm7b5:   [47, 53, 57, 62],
  'D/F#':  [42, 50, 57, 62, 66],
  'G/B':   [47, 50, 55, 59, 67],
  'C/E':   [40, 48, 52, 55, 60],
  'A/C#':  [49, 52, 57, 61, 64],
};

function seededNoise(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/* Strings sound one after another, twelve milliseconds apart, because that
   is what a strum is — and because a chord whose notes all start at the same
   instant is a keyboard, whose bass note does not decay out from under the
   reading the way a guitar's does. */
function strum(chords, bpm, beatsEach, seed) {
  const span = beatsEach * (60 / bpm);
  const total = Math.ceil((chords.length * span + 0.5) * RATE);
  const out = new Float32Array(total);

  chords.forEach((name, index) => {
    SHAPES[name].forEach((midi, string) => {
      const from = Math.round((index * span + string * 0.012) * RATE);
      const base = midiToHz(midi);
      const ring = Math.min(span * 1.4 * RATE, total - from);
      for (let i = 0; i < ring; i++) {
        const t = i / RATE;
        let sample = 0;
        for (let h = 1; h <= 8; h++) sample += Math.sin(2 * Math.PI * base * h * t) / (h * 1.4);
        out[from + i] += sample * Math.exp(-t / 1.8) * Math.min(1, t / 0.004) * 0.055;
      }
    });
  });

  const hiss = seededNoise(seed);
  for (let i = 0; i < total; i++) out[i] += hiss() * 0.002;
  return out;
}

const PROGRESSIONS = [
  { name: 'I-IV-V-I',      key: 'G', chords: ['G', 'C', 'D', 'G'],            roman: ['I', 'IV', 'V', 'I'] },
  { name: 'vi-IV-I-V',     key: 'C', chords: ['Am', 'Fmaj7', 'C', 'G'],       roman: ['vi', 'IV7', 'I', 'V'] },
  { name: 'I-vi-ii-V',     key: 'C', chords: ['C', 'Am', 'Dm7', 'G7'],        roman: ['I', 'vi', 'ii7', 'V7'] },
  { name: 'ii-V-I',        key: 'D', chords: ['Em', 'A7', 'D', 'D'],          roman: ['ii', 'V7', 'I', 'I'] },
  { name: 'inversions',    key: 'G', chords: ['G', 'D/F#', 'Em', 'G/B'],      roman: ['I', 'V6', 'vi', 'I6'] },
  { name: 'sevenths',      key: 'C', chords: ['Cmaj7', 'Am7', 'Dm7', 'G7'],   roman: ['I7', 'vi7', 'ii7', 'V7'] },
  { name: 'minor key',     key: 'Em', chords: ['Em', 'Am', 'Bm7b5', 'Em'],    roman: ['i', 'iv', 'v7', 'i'] },
  { name: 'suspensions',   key: 'A', chords: ['A', 'Asus4', 'A', 'D'],        roman: ['I', 'Isus4', 'I', 'IV'] },
  { name: 'bass line',     key: 'C', chords: ['C', 'C/E', 'F', 'G'],          roman: ['I', 'I6', 'IV', 'V'] },
  { name: 'no key given',  key: null, expect: 'G', chords: ['G', 'C', 'D', 'G'], roman: ['I', 'IV', 'V', 'I'] },
];

const seedFor = (name) => {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) hash = Math.imul(hash ^ name.charCodeAt(i), 16777619);
  return hash >>> 0;
};

const build = (progression, bpm = 90, beatsEach = 4) => ({
  samples: strum(progression.chords, bpm, beatsEach, seedFor(progression.name)),
  sampleRate: RATE,
  bpm,
  beatsEach,
});

module.exports = { PROGRESSIONS, build };
