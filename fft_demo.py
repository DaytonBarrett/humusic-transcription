import numpy as np
import matplotlib.pyplot as plt
import pyaudio
import wave
import time
import sys

# Audio/Mic input
import sounddevice as sd
from scipy.io.wavfile import write

fs = 44100  # Sample rate
seconds = 3  # Duration of recording

myrecording = sd.rec(int(seconds * fs), samplerate=fs, channels=1)
sd.wait()  # Wait until recording is finished
write('/Users/daytonbarrett/Desktop/output.wav', fs, myrecording) # Save as WAV file

# Sampling rate (samples per second)
sample_rate = 44100

# Duration of the signal (seconds)
duration = 1

# Create time axis
t = np.linspace(0, duration, sample_rate)

# Create a test signal (A4 note = 440 Hz)
frequency = 440
signal = np.sin(2 * np.pi * frequency * t)

# Fast Fourier Transform
fft_result = np.fft.fft(signal)

# Get frequency bins
freqs = np.fft.fftfreq(len(fft_result), 1 / sample_rate)

# Only keep the positive frequencies
positive_freqs = freqs[:len(freqs)//2]
magnitude = np.abs(fft_result[:len(fft_result)//2])

# Plot frequency spectrum
plt.plot(positive_freqs, magnitude)
plt.xlabel("Frequency (Hz)")
plt.ylabel("Magnitude")
plt.title("FFT Frequency Spectrum of 440 Hz Signal")

# Save the image for analysis
plt.savefig("/Users/daytonbarrett/Desktop/fft_example.png")

# Show the plot
plt.show()
