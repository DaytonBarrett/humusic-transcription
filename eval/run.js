#!/usr/bin/env node
/* Scores the transcriber against every clip in clips.js.

     node eval/run.js                 score, and compare with the baseline
     node eval/run.js --save          overwrite the baseline with this run
     node eval/run.js --wav out/      write the clips out to listen to
     node eval/run.js --only legato   run the clips whose name contains this

   The baseline is committed, so a change that costs accuracy somewhere shows
   up as a red column here rather than as a complaint months later. */

const fs = require('fs');
const path = require('path');

const { load } = require('./engine');
const { CLIPS, build, toWav } = require('./clips');
const { score } = require('./score');
const { PROGRESSIONS, build: buildHarmony } = require('./harmony');

const BASELINE = path.join(__dirname, 'baseline.json');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => { const at = argv.indexOf(name); return at === -1 ? null : argv[at + 1]; };

const engine = load();
const unitSeconds = (bpm) => 60 / bpm / engine.UNITS_PER_QUARTER;

// The engine returns runs laid end to end — note names and lengths in grid
// units — which is not something a transcription metric can read. Rests are
// dropped rather than scored: a rest is the absence of a note, and counting
// absences as correct inflates every figure on a sparse take.
function runsToNotes(runs, bpm) {
  const unit = unitSeconds(bpm);
  const notes = [];
  let at = 0;
  for (const run of runs) {
    const span = run.units * unit;
    if (run.note !== engine.REST) {
      notes.push({ midi: engine.noteToMidi(run.note), onset: at, offset: at + span });
    }
    at += span;
  }
  return notes;
}

const pct = (n) => (n * 100).toFixed(1).padStart(5);

function delta(now, before) {
  if (before === undefined) return '      ';
  const change = (now - before) * 100;
  if (Math.abs(change) < 0.05) return '     ·';
  return `${change > 0 ? '+' : ''}${change.toFixed(1)}`.padStart(6);
}

const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
const only = value('--only');
const clips = only ? CLIPS.filter((c) => c.name.includes(only)) : CLIPS;

const wavDir = value('--wav');
if (wavDir) fs.mkdirSync(wavDir, { recursive: true });

const results = {};
let totalOnsetPitch = 0;
let totalFull = 0;
let totalOctaves = 0;

console.log('');
console.log('  clip                    COnP        COnPOff      oct   notes    ±cents');
console.log('  ' + '─'.repeat(72));

for (const clip of clips) {
  const { samples, sampleRate, reference } = build(clip);
  if (wavDir) fs.writeFileSync(path.join(wavDir, `${clip.name}.wav`), toWav(samples, sampleRate));

  const runs = engine.quantizeRuns(engine.analyzeRecording(samples, sampleRate, clip.bpm));
  const result = score(reference, runsToNotes(runs, clip.bpm));
  results[clip.name] = result;

  totalOnsetPitch += result.onsetPitch.f;
  totalFull += result.full.f;
  totalOctaves += result.octaveErrors;

  const was = baseline[clip.name];
  console.log(
    `  ${clip.name.padEnd(20)}` +
    `${pct(result.onsetPitch.f)}%${delta(result.onsetPitch.f, was?.onsetPitch.f)}  ` +
    `${pct(result.full.f)}%${delta(result.full.f, was?.full.f)}  ` +
    `${String(result.octaveErrors).padStart(4)}  ` +
    `${String(result.estimateCount).padStart(3)}/${String(result.referenceCount).padEnd(3)}  ` +
    `${result.cents.toFixed(1).padStart(6)}`
  );
}

console.log('  ' + '─'.repeat(72));
const meanOnsetPitch = totalOnsetPitch / clips.length;
const meanFull = totalFull / clips.length;
const wasMean = baseline.__mean;
console.log(
  `  ${'mean'.padEnd(20)}` +
  `${pct(meanOnsetPitch)}%${delta(meanOnsetPitch, wasMean?.onsetPitch)}  ` +
  `${pct(meanFull)}%${delta(meanFull, wasMean?.full)}  ` +
  `${String(totalOctaves).padStart(4)}`
);
console.log('');
console.log('  COnP     onset within 50 ms and pitch within 50 cents');
console.log('  COnPOff  the same, and offset within max(50 ms, 20% of the note)');
console.log('  oct      estimates landing on the right onset an exact octave out');
console.log('');

/* ── Harmony ──

   Scored per chord rather than per reading: what matters is whether the
   chart says G where G was played, not how many of the sixteen readings
   inside that bar agreed. Adjacent readings of the same chord are merged
   first, then the run of chords is compared with what was strummed. */
function chordsPlayed(chords, unitsPerChord) {
  const merged = [];
  for (const entry of chords) {
    const last = merged[merged.length - 1];
    if (last && last.label === entry.label) last.units += entry.units;
    else merged.push({ ...entry });
  }
  // A reading has to hold for a good part of a chord to be one; anything
  // shorter is a hand moving between shapes.
  return merged.filter((entry) => entry.label && entry.units >= unitsPerChord / 3);
}

const spell = (name) => name.replace('#', '♯').replace('b', '♭');

let chordHits = 0;
let romanHits = 0;
let chordTotal = 0;
let keyHits = 0;

console.log('  progression        key    chords                      correct');
console.log('  ' + '─'.repeat(72));

for (const progression of PROGRESSIONS) {
  const { samples, sampleRate, bpm, beatsEach } = buildHarmony(progression);
  const { key, chords } = engine.analyzeHarmony(samples, sampleRate, bpm, progression.key);
  const played = chordsPlayed(chords, beatsEach * engine.UNITS_PER_QUARTER);

  // Two of the same chord in a row are one chord held, not two changes, so
  // the answer is compared against the progression with repeats collapsed —
  // otherwise a correct reading is marked down for not restating a chord
  // that never changed.
  const wanted = [];
  progression.chords.forEach((name, i) => {
    if (wanted.length && wanted[wanted.length - 1].label === name) return;
    wanted.push({ label: name, roman: progression.roman[i] });
  });

  let right = 0;
  wanted.forEach((want, i) => {
    chordTotal++;
    if (played[i] && played[i].label === spell(want.label)) { chordHits++; right++; }
    if (played[i] && played[i].roman === want.roman) romanHits++;
  });
  // For a progression with no key given the detector has to find it; where
  // one is given it has to be honoured rather than overridden.
  if (key && key.id === (progression.key || progression.expect)) keyHits++;

  console.log(
    `  ${progression.name.padEnd(18)} ${String(key ? key.id : '—').padEnd(6)} ` +
    `${played.map((c) => c.label).join(' ').slice(0, 27).padEnd(27)} ` +
    `${right}/${wanted.length}`
  );
}

console.log('  ' + '─'.repeat(72));
console.log(
  `  chords ${((chordHits / chordTotal) * 100).toFixed(0)}%   ` +
  `roman ${((romanHits / chordTotal) * 100).toFixed(0)}%   ` +
  `key ${keyHits}/${PROGRESSIONS.length}`
);
console.log('');

if (flag('--save')) {
  fs.writeFileSync(
    BASELINE,
    JSON.stringify({
      ...results,
      __mean: { onsetPitch: meanOnsetPitch, full: meanFull, octaves: totalOctaves },
      __harmony: { chords: chordHits / chordTotal, roman: romanHits / chordTotal, keys: keyHits },
    }, null, 2)
  );
  console.log(`  baseline written to ${path.relative(process.cwd(), BASELINE)}`);
  console.log('');
}
