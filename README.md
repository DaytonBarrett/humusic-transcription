# humusic-transcription

Humusic Transcription is a project that converts recorded audio into sheet music written in Western musical notation.

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
5. Output a sequence of notes for transcription

## Technologies

- Python  
- NumPy  
- SciPy  
- Matplotlib  

## Goals

This project is also intended to strengthen my understanding of:

- Fast Fourier Transforms
- Digital signal processing
- Applying calculus and mathematics to real problems
- Building a complete audio analysis pipeline

## Future Development

- Improved pitch detection
- MIDI / MusicXML export
- Real-time transcription
- Performance optimization (possibly using C++)

## Example of an Image of the FFT Graph that is used for pitch analysis
*Note, this image does NOT have any audio input; however, this is an example of the graph that the FFT transforms pitch into.*
<img width="640" height="480" alt="fft_example" src="https://github.com/user-attachments/assets/4107b57b-b3ba-4b89-b6a8-b08257026e99" />

