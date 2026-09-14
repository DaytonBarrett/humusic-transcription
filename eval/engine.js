/* Loads app.js into a V8 context and hands back the transcription engine.

   The transcriber is a browser script, not a module: it declares everything
   at the top level and wires the console up on DOMContentLoaded. Nothing in
   the analysis path touches the DOM, so a handful of inert stubs is enough
   to get the file evaluated, after which every `function` declaration is a
   property of the context and every `const` is reachable by evaluating its
   name in the same context.

   Loading the real file rather than a copy of the algorithms is the whole
   point. A harness that scores its own reimplementation measures nothing. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'app.js');

const inert = () => {};
const nothing = { addEventListener: inert, removeEventListener: inert, classList: { add: inert, remove: inert, toggle: inert }, style: {}, dataset: {} };

function load() {
  const context = vm.createContext({
    console,
    document: {
      addEventListener: inert,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => nothing,
      createElementNS: () => nothing,
    },
    window: { addEventListener: inert },
    navigator: { userAgent: 'node' },
    localStorage: { getItem: () => null, setItem: inert, removeItem: inert },
  });

  vm.runInContext(fs.readFileSync(APP, 'utf8'), context, { filename: 'app.js' });

  const read = (name) => vm.runInContext(name, context);
  return {
    analyzeRecording: context.analyzeRecording,
    quantizeRuns: context.quantizeRuns,
    noteToMidi: context.noteToMidi,
    analyzeHarmony: context.analyzeHarmony,
    romanNumeral: context.romanNumeral,
    REST: read('REST'),
    UNITS_PER_QUARTER: read('UNITS_PER_QUARTER'),
  };
}

module.exports = { load };
