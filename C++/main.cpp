#include <iostream>
#include <string>
#include <vector>
#include <numeric>
#include <cmath>
#include <armadillo>
#include <portaudio.h>

#define pi 3.14159265358979323846

// ---------------------------------------------------------------------
// Standard 12-tone note names, used with a MIDI note number to build
// a full note name like "A4" or "C#5".
// ---------------------------------------------------------------------
const std::vector<std::string> NOTE_NAMES = {
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"
};

// ---------------------------------------------------------------------
// This is the generalized version of the range-checking idea 
//(e.g. "if freq is between 479.82 and 508.35 -> B4").
// Instead of hand-typing a frequency range for every note in every
// octave, we compute the nearest note mathematically using the
// standard equal-temperament formula, with A4 = 440 Hz as the anchor:
//
//     midiNote = 69 + 12 * log2(freq / 440)
//
// Rounding to the nearest integer MIDI note is mathematically
// equivalent to picking whichever named note's frequency range the
// peak falls into -- the boundaries between notes sit at the
// geometric mean of their frequencies
// ---------------------------------------------------------------------
std::string frequencyToNote(float freq) {
    if (freq <= 20.0f) {
        return "Rest"; // treat near-silence / sub-audible as no note
    }

    float midiFloat = 69.0f + 12.0f * std::log2(freq / 440.0f);
    int midiNote = static_cast<int>(std::round(midiFloat));

    int octave = (midiNote / 12) - 1;
    int noteIndex = midiNote % 12;
    if (noteIndex < 0) noteIndex += 12; // guard against negative modulo

    return NOTE_NAMES[noteIndex] + std::to_string(octave);
}

// ---------------------------------------------------------------------
// Records `totalSamples` mono float samples from the default input
// device (microphone) at `sampleRate` using PortAudio, blocking until
// the recording is complete.
// ---------------------------------------------------------------------
std::vector<float> recordAudio(int sampleRate, int totalSamples) {
    std::vector<float> buffer(totalSamples, 0.0f);
    PaStream* stream = nullptr;
    PaError err;

    err = Pa_Initialize();
    if (err != paNoError) {
        std::cerr << "PortAudio init error: " << Pa_GetErrorText(err) << "\n";
        return buffer;
    }

    err = Pa_OpenDefaultStream(
        &stream,
        1,              // 1 input channel (mono)
        0,              // 0 output channels
        paFloat32,      // sample format
        sampleRate,
        256,            // frames per buffer
        nullptr,        // no callback -> blocking Pa_ReadStream below
        nullptr
    );
    if (err != paNoError) {
        std::cerr << "PortAudio open stream error: " << Pa_GetErrorText(err) << "\n";
        Pa_Terminate();
        return buffer;
    }

    err = Pa_StartStream(stream);
    if (err != paNoError) {
        std::cerr << "PortAudio start stream error: " << Pa_GetErrorText(err) << "\n";
        Pa_Terminate();
        return buffer;
    }

    std::cout << "Recording for " << (totalSamples / static_cast<float>(sampleRate))
               << " seconds... play/sing now!\n";

    err = Pa_ReadStream(stream, buffer.data(), totalSamples);
    if (err != paNoError && err != paInputOverflowed) {
        std::cerr << "PortAudio read stream error: " << Pa_GetErrorText(err) << "\n";
    }

    std::cout << "Recording complete.\n\n";

    Pa_StopStream(stream);
    Pa_CloseStream(stream);
    Pa_Terminate();

    return buffer;
}

int main() {

    const int sampleRate = 44100; // realistic mic sample rate (was 494 - too low, caused aliasing)
    const int totalSamples = 30 * sampleRate; // 30 seconds total

    int tempo;
    std::cout << "Enter tempo (BPM): ";
    std::cin >> tempo;

    if (tempo <= 0) {
        std::cerr << "Tempo must be positive.\n";
        return 1;
    }

    std::cout << "Sample division " << tempo * 16 << std::endl;

    // ---- capture real audio from the microphone ----
    std::vector<float> audioBuffer = recordAudio(sampleRate, totalSamples);

    // ---- split audio into segments based on tempo ----
    int numSplits = tempo * 16;
    int numSegments = numSplits + 1;
    int segmentSize = totalSamples / numSegments;

    if (segmentSize < 64) {
        std::cerr << "Segment size too small for a useful FFT at this tempo.\n";
        return 1;
    }

    std::cout << "Audio captured with " << totalSamples << " samples.\n";
    std::cout << "Splitting " << numSplits << " times into " << numSegments << " segments.\n";
    std::cout << "Each segment will be " << segmentSize << " samples long.\n\n";

    // ---- move pointer through audio (left to right), analyze each segment ----
    float* audioPtr = audioBuffer.data();

    std::vector<float> peakFreqs(numSegments); // peak frequency found in each segment

    for (int i = 0; i < numSegments; i++) {

        int currentSampleIndex = static_cast<int>(audioPtr - audioBuffer.data());

        std::cout << "Segment " << (i + 1) << " starts at sample index: " << currentSampleIndex << "\n";

        // FFT on this segment
        arma::fvec segmentView(audioPtr, segmentSize, /*copy_aux_mem=*/false);
        arma::cx_fvec spectrum = arma::fft(segmentView);

        arma::fvec magnitudes = arma::abs(spectrum);
        arma::uword peakBin = magnitudes.index_max();
        float peakMagnitude = magnitudes(peakBin);

        // Only trust the FFT peak past the halfway point of the spectrum is
        // a mirror image for real input, so only look at the first half.
        arma::uword halfSize = magnitudes.n_elem / 2;
        if (peakBin >= halfSize) {
            peakBin = magnitudes.subvec(0, halfSize - 1).index_max();
            peakMagnitude = magnitudes(peakBin);
        }

        float peakFreqHz = static_cast<float>(peakBin) * sampleRate / segmentSize;

        // very quiet segments are treated as silence rather than a "note"
        const float silenceThreshold = 1.0f;
        peakFreqs[i] = (peakMagnitude > silenceThreshold) ? peakFreqHz : 0.0f;

        std::cout << "  FFT size: " << spectrum.n_elem
                   << " | peak bin: " << peakBin
                   << " | approx peak freq: " << peakFreqs[i] << " Hz\n\n";

        audioPtr += segmentSize; // move pointer to next segment
    }

    // ---- Note identification ----
    // Uses each segment's stored peak frequency (peakFreqs[i]) rather than
    // re-reading raw sample values, and covers every octave via
    // frequencyToNote() instead of a hand-written range per note.
    std::vector<std::string> myArray(numSegments);

    for (int i = 0; i < numSegments; i++) {
        myArray[i] = frequencyToNote(peakFreqs[i]);
    }

    // ---- print final transcription ----
    std::cout << "=== Transcribed notes ===\n";
    for (int i = 0; i < numSegments; i++) {
        std::cout << "Segment " << (i + 1) << ": " << myArray[i] << "\n";
    }

    return 0;
}