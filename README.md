<img width="3039" height="1350" alt="humusic" src="https://github.com/user-attachments/assets/ac66c266-5edd-470b-8741-467758412868" />

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
| `ios-assets/` | App Store icon and splash generated from the app icon |
| `IOS.md` | How to build, sign and submit the iOS app |

## The web transcriber

Open `app.html` in a browser — no server, no build step, no network.

Set a tempo, record a single melodic line, and the transcription is engraved on
the page in common notation and can be exported as MusicXML 4.0.

The browser version does not use FFT peak-picking like the C++ program. It uses
the **YIN autocorrelation estimator**, which resolves the fundamental directly
and is far less prone to the octave errors that spectral peak-picking produces.
Note naming still follows the same equal-temperament formula as `main.cpp`
(`69 + 12·log₂(f/440)`, A4 = 440 Hz), so both transcribers agree on every note.

Rhythm is quantized against a sixteenth-note grid derived from the tempo, then
consolidated into idiomatic durations — dotted values, ties across barlines —
rather than being written out as a wall of sixteenths.

**Limitations worth knowing:** the detector is monophonic, so chords will not
transcribe correctly; everything is written in 4/4 and treble clef; and the
tempo is taken from you rather than inferred from the audio.

## iOS

The transcriber is packaged with Capacitor. See [IOS.md](IOS.md) for the build,
the required microphone permission, and what still needs a Mac with Xcode.

