# Demonstration of Fast Fourier Transform applied to a simple sinusoidal signal.
# This script generates a 440 Hz tone and shows how FFT reveals its frequency.
import numpy as np
import matplotlib.pyplot as plt

# Sampling rate (samples per second)
sample_rate = 44100

# Duration of the signal (seconds)
duration = 1

# Create time axis
t = np.linspace(0, duration, sample_rate)

# Create a test signal (A4 note = 440 Hz)
frequency = 440
signal = np.sin(2 * np.pi * frequency * t)

# Perform Fast Fourier Transform
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
