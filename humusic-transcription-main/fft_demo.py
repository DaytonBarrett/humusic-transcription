import numpy as np
import matplotlib.pyplot as plt
from scipy import signal
import sounddevice as sd
from scipy.io.wavfile import write
import tkinter as tk
import threading


fs = 44100
recording = False
audio_data = []
stream = None

def callback(indata, frames, time, status):
    if recording:
        audio_data.append(indata.copy())

def start_recording():
    global recording, audio_data, stream
    audio_data = []
    recording = True
    status_label.config(text="Recording...", fg="red")
    start_btn.config(state=tk.DISABLED)
    stop_btn.config(state=tk.NORMAL)
    stream = sd.InputStream(samplerate=fs, channels=1, callback=callback, device=3)
    stream.start()

def stop_recording():
    global recording, stream
    recording = False
    stream.stop()
    stream.close()
    status_label.config(text="Processing...", fg="orange")
    stop_btn.config(state=tk.DISABLED)
    # Run analyze in a thread so GUI doesn't freeze
    threading.Thread(target=analyze_audio).start()

def analyze_audio():
    if not audio_data:
        status_label.config(text="No audio recorded!", fg="red")
        return

    # Combine all recorded chunks
    signal = np.concatenate(audio_data, axis=0).flatten()

    # Remove DC offset
    signal = signal - np.mean(signal)
    
    print(f"Signal length: {len(signal)}")
    print(f"Signal max: {np.max(signal)}")
    print(f"Signal min: {np.min(signal)}")
    print(f"Signal mean: {np.mean(signal)}")
    
    # Save as WAV
    write('/Users/daytonbarrett/Desktop/output.wav', fs, signal)

    # FFT
    fft_result = np.fft.fft(signal)
    freqs = np.fft.fftfreq(len(fft_result), 1 / fs)

    # Only positive frequencies
    positive_freqs = freqs[:len(freqs)//2]
    magnitude = np.abs(fft_result[:len(fft_result)//2])

    # Ignore everything below 50 Hz (filters out DC offset and rumble)
    min_freq_index = np.searchsorted(positive_freqs, 50)
    magnitude[:min_freq_index] = 0

    # Dominant frequency
    dominant_freq = positive_freqs[np.argmax(magnitude)]

    # Update GUI label
    status_label.config(text=f"Dominant frequency: {dominant_freq:.2f} Hz", fg="green")
    start_btn.config(state=tk.NORMAL)

    # Schedule plot on main thread
    window.after(0, lambda: show_plot(positive_freqs, magnitude, dominant_freq))

def show_plot(positive_freqs, magnitude, dominant_freq):
    plt.figure(figsize=(12, 5))
    plt.plot(positive_freqs, magnitude)
    plt.xlabel("Frequency (Hz)")
    plt.ylabel("Magnitude")
    plt.title(f"FFT Frequency Spectrum (Dominant: {dominant_freq:.2f} Hz)")
    plt.xlim(0, 5000)
    plt.savefig('/Users/daytonbarrett/Desktop/fft_example.png')
    plt.show()

# --- Build GUI ---
window = tk.Tk()
window.title("Hummusic")
window.geometry("300x200")
window.resizable(False, False)

title_label = tk.Label(window, text="Hummusic", font=("Helvetica", 20, "bold"))
title_label.pack(pady=10)

status_label = tk.Label(window, text="Press Start to record", font=("Helvetica", 12))
status_label.pack(pady=5)

start_btn = tk.Button(window, text="Start", font=("Helvetica", 14), bg="green", fg="white",
                      width=10, command=start_recording)
start_btn.pack(pady=5)

stop_btn = tk.Button(window, text="Stop", font=("Helvetica", 14), bg="red", fg="white",
                     width=10, command=stop_recording, state=tk.DISABLED)
stop_btn.pack(pady=5)

window.mainloop()
