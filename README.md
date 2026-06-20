<img width="3039" height="1350" alt="humusic" src="https://github.com/user-attachments/assets/ac66c266-5edd-470b-8741-467758412868" />

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
2. Split the recording into samples dependent on the tempo and size of the recording
4. Apply FFT to convert the waveform into a frequency spectrum  
5. Identify spectral peaks (dominant frequencies)  
6. Map detected frequencies to musical notes

