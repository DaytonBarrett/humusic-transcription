/* Note-level transcription metrics, following mir_eval.transcription.

   A note counts as correct when its onset is within 50 ms, its pitch within
   50 cents, and — for the stricter figure — its offset within the greater of
   50 ms and a fifth of the reference note's length. Those are mir_eval's
   defaults, so the numbers here can be compared with published ones.

   Pairing is a maximum bipartite matching rather than a walk down the list.
   Greedy pairing flatters a detector that fragments: the first estimate near
   a reference note claims it, the other pieces find nothing to pair with and
   are counted once as false positives, when a matching that considered them
   together would have used the better one and charged for the rest. */

const ONSET_TOLERANCE = 0.05;
const PITCH_TOLERANCE_CENTS = 50;
const OFFSET_RATIO = 0.2;
const OFFSET_FLOOR = 0.05;

// Kuhn's algorithm. Each reference note takes an estimate, displacing an
// earlier claim whenever the displaced one can find somewhere else to go.
function maximumMatching(candidates, estimateCount) {
  const takenBy = new Array(estimateCount).fill(-1);

  const assign = (ref, seen) => {
    for (const est of candidates[ref]) {
      if (seen[est]) continue;
      seen[est] = true;
      if (takenBy[est] === -1 || assign(takenBy[est], seen)) {
        takenBy[est] = ref;
        return true;
      }
    }
    return false;
  };

  let matched = 0;
  for (let ref = 0; ref < candidates.length; ref++) {
    if (assign(ref, new Array(estimateCount).fill(false))) matched++;
  }

  const pairs = [];
  takenBy.forEach((ref, est) => { if (ref !== -1) pairs.push([ref, est]); });
  return { matched, pairs };
}

const centsApart = (a, b) => Math.abs(a - b) * 100;

function pairUp(reference, estimate, admit) {
  const candidates = reference.map((ref) =>
    estimate.reduce((keep, est, index) => {
      if (admit(ref, est)) keep.push(index);
      return keep;
    }, []));
  return maximumMatching(candidates, estimate.length);
}

function prf(matched, referenceCount, estimateCount) {
  const precision = estimateCount ? matched / estimateCount : 0;
  const recall = referenceCount ? matched / referenceCount : 0;
  const f = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f };
}

function score(reference, estimate) {
  const onsetClose = (ref, est) => Math.abs(ref.onset - est.onset) <= ONSET_TOLERANCE;
  const pitchClose = (ref, est) => centsApart(ref.midi, est.midi) <= PITCH_TOLERANCE_CENTS;
  const offsetClose = (ref, est) =>
    Math.abs(ref.offset - est.offset) <= Math.max(OFFSET_FLOOR, OFFSET_RATIO * (ref.offset - ref.onset));

  const onsetPitch = pairUp(reference, estimate, (r, e) => onsetClose(r, e) && pitchClose(r, e));
  const full = pairUp(reference, estimate, (r, e) => onsetClose(r, e) && pitchClose(r, e) && offsetClose(r, e));

  /* Octave errors are counted against a looser pairing — onset alone — on
     purpose. An estimate an octave out fails the pitch test and so never
     appears in the matching above; it is simply a miss and a false positive,
     indistinguishable from having heard nothing at all. Those are not the
     same failure to a musician, and only one of them is the failure this
     detector is judged on. */
  const byOnset = pairUp(reference, estimate, onsetClose);
  let octaveErrors = 0;
  let centsError = 0;
  let inTune = 0;
  for (const [ref, est] of byOnset.pairs) {
    const semitones = estimate[est].midi - reference[ref].midi;
    const rounded = Math.round(semitones);
    if (rounded !== 0 && rounded % 12 === 0) octaveErrors++;
    if (Math.abs(rounded) === 0) { centsError += Math.abs(semitones) * 100; inTune++; }
  }

  return {
    onsetPitch: prf(onsetPitch.matched, reference.length, estimate.length),
    full: prf(full.matched, reference.length, estimate.length),
    octaveErrors,
    referenceCount: reference.length,
    estimateCount: estimate.length,
    cents: inTune ? centsError / inTune : 0,
  };
}

module.exports = { score };
