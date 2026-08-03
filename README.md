<img width="3039" height="1350" alt="humusic  (2)" src="https://github.com/user-attachments/assets/257cab3b-641a-4ca6-b516-80c4a67c7f12" />


Humusic Transcription is a project that converts recorded audio into sheet music written in Western musical notation.

NOTE: The web transcriber (`app.html`) works today. The C++ program is still in development.

The goal of this project is to analyze an audio signal, detect its frequencies, and translate those frequencies into musical notes.

This project explores how digital signal processing techniques, particularly the Fast Fourier Transform (FFT), can be applied to real-world audio problems.

## Motivation
Transcribing musical ideas into notation can be difficult, especially for musicians without strong transcription skills. Many people can sing or play musical ideas, but struggle to write them down.
This project aims to reduce that barrier by allowing users to record audio and automatically detect the notes being sung or played.

## How It Works
Audio signals exist in the time domain, representing amplitude over time.
To detect musical notes, the signal must be converted into the frequency domain. This project uses the Fast Fourier Transform (FFT) to transform the signal and identify dominant frequencies.

The process:
1. Record or load an audio signal
2. Split the recording into samples dependent on the tempo and size of the recording
4. Apply FFT to convert the waveform into a frequency spectrum  
5. Identify spectral peaks (dominant frequencies)  
6. Map detected frequencies to musical notes

## Repository layout

| Path | What it is |
|---|---|
| `index.html`, `style.css`, `script.js` | The publication — project site |
| `app.html`, `app.css`, `app.js` | The transcriber — record, engrave, export |
| `base.css` | Shared design system: palette, type, rules, glass |
| `vendor/` | VexFlow engraving engine and self-hosted fonts |
| `C++/main.cpp` | The original native FFT transcriber |
| `scripts/build-www.py` | Builds `www/`, the bundle shipped inside the iOS app |

## The web transcriber

Open `app.html` in a browser — no server, no build step, no network.

Set a tempo, record a single melodic line, and the transcription is engraved on
the page in common notation and can be exported as MusicXML 4.0.

The browser version does not use FFT peak-picking like the C++ program. It uses
the **YIN autocorrelation estimator**, which resolves the fundamental directly
and is far less prone to the octave errors that spectral peak-picking produces.
Note naming still follows the same equal-temperament formula as `main.cpp`
(`69 + 12·log₂(f/440)`, A4 = 440 Hz), so both transcribers agree on every note.

Rhythm is quantized against a grid of **twelfths of a beat** derived from the
tempo, then consolidated into idiomatic durations — dotted values, ties across
barlines — rather than being written out as a wall of sixteenths. Twelve is the
smallest division that divides cleanly by both four and three, so a sixteenth
(3 units) and an eighth-note triplet (4 units) are both measured exactly. On a
sixteenth grid a triplet cannot be represented at all — a third of a beat is
1.33 sixteenths — so triplets used to come out as a limping 2+1.

Each beat is then read as straight or as a triplet on its own, from where the
onsets inside it actually landed, and only when the triplet reading fits
distinctly better. Straight rhythm is the default and stays that way: the two
grids are never far apart, so the test has to be decided but conservative.

Pitch is measured once per frame but *named* once per note, which is what
keeps a held note whole. Every change of note name starts a new note, so a
sustain that wobbles across a semitone boundary — an ordinary amount of
vibrato on a note sung slightly sharp — would otherwise be written as a stream
of alternating sixteenths. The measurements are median-filtered, brief
dropouts inside a sustain are bridged, and a note ends only when the pitch
genuinely leaves where it has been sitting or a fresh attack arrives.

### Playback

The engraved line can be played back as a **piano, plucked guitar, saxophone or
plain synth**. What sounds is the quantized model the score is drawn from — not
the recording — so a mis-transcribed note is audible as a wrong note rather than
having to be spotted on the staff.

Every voice is synthesised from oscillators and noise at the moment it sounds.
That is a constraint rather than a preference: the bundle has to run with no
network, and a sampled instrument worth listening to would be megabytes of audio
embedded in the page. So each one is built from the part of its physics the ear
uses to name it — a struck string's partials decaying at different rates, a
plucked string's travelling wave (Karplus–Strong, rendered into a buffer because
a Web Audio feedback loop is quantised to 128 samples and so cannot go below
about 344 Hz), a reed's formants and breath.

### Revising a transcription

A detector is not a copyist. It mishears an octave, splits a held note on a bow
change, writes a sixteenth where a triplet was played — so what it produces is a
first draft, and every part of it can be corrected afterwards. Tapping any note
or rest on the staff opens it for revision: **pitch** by semitone or octave,
**length** from a keyboard of every value the grid can express, and whether the
event sounds at all. **Tempo** is set separately from the tempo the take was
recorded to, because the rhythm was written down in beats — marking a score
faster or slower changes the metronome mark, the playback and the exported
MusicXML, and moves not one notehead.

Lengthening a note takes its time from what follows and shortening gives it back
as a rest, so the bar lines never move. Rippling would be simpler to implement
and worse to use: in strict 4/4 it drags every later note off the beat it was
played on, and re-fitting the whole line to the grid afterwards is exactly the
guesswork the correction was made to undo. Values that cannot be written at that
point in the bar — a triplet eighth inside a beat already divided into
sixteenths, which no tuplet bracket can express — are shown struck through
rather than accepted and then silently mangled.

### The library

Scores are kept on the device and listed in a catalogue you can reopen, rename,
export or delete. What is stored is the run list — note names and lengths in
grid units — and never the audio. That is a whole take in a few hundred bytes
rather than a few megabytes, it survives being reopened at a different tempo,
and it keeps the App Store privacy label honest: recording the microphone to
disk would be the first thing to make *no data collected* untrue.

**Limitations worth knowing:** the detector is monophonic, so chords will not
transcribe correctly; everything is written in 4/4; the tempo is taken from you
rather than inferred from the audio; triplet detection covers eighth-note
triplets within a beat, not duplets, quintuplets or triplets spanning two beats;
and the library lives in `localStorage`, so it is per-device and goes with the
app rather than with an account.

## iOS

The transcriber is packaged with Capacitor. See [IOS.md](IOS.md) for the build,
the required microphone permission, and what still needs a Mac with Xcode.

