humusic-iOS-Default-1024x1024@1x 1
Humusic Transcription is a project that converts recorded audio into sheet music written in Western musical notation.

NOTE: APP IS CURRENTLY BEING DEVELOPED AND DOES NOT YET FUNCTION AS INTENDED

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
2. Apply FFT to convert the waveform into a frequency spectrum  
3. Identify spectral peaks (dominant frequencies)  
4. Map detected frequencies to musical notes

fft_example
