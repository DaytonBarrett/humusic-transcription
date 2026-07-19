#include <iostream>
#include <string>
#include <vector>
#include <iostream>
#include <numeric>
#include <cmath>
#include <armadillo>
#define pi 3.14159265358979323846


int main() {
    
    //generate audio -> will be changed later to read from recording

    const int   sampleRate = 44100;
    const int totalSamples = 30 * sampleRate; //30 seconds total
    std::vector<float> audioBuffer(totalSamples);
    int tempo;

    std::cout << "Enter tempo: ";
    std::cin >> tempo;
    std::cout << "Sample division " << tempo * 16 << std::endl;

    const float frequency = 440.0f;
    for (int i = 0; i < totalSamples; i++) {
        audioBuffer[i] = std::sin(2.0f * pi * frequency * i / sampleRate);
    }

    //split audio into segments based on tempo

    int numSplits = tempo * 16; 
    int numSegments = numSplits + 1;
    int segmentSize = totalSamples / numSegments;

    std::cout << "Audio created with " << totalSamples << " samples.\n";
    std::cout << "Splitting " << numSplits << " times into " << numSegments << " segments.\n";
    std::cout << "Each segment will be " << segmentSize << " samples long.\n\n";

    //move pointer through audio (left to right) and print out segment info

    float* audioPtr = audioBuffer.data();
    
    for (int i = 0; i < numSegments; i++) {
        
        int currentSampleIndex = audioPtr - audioBuffer.data();
    
    std::cout << "Segment" << (i + 1) << "starts at sample index: " << currentSampleIndex << "\n";
    std::cout << "Audio value at current sample index: " << audioPtr[0] << "\n";

    //using ffts to analyze the segments

    arma::fvec segmentView(audioPtr, segmentSize, /*copy_aux_mem=*/false);

    std::vector<arma::cx_vec> segmentFFTs(numSegments);
    
    arma::cx_fvec spectrum = arma::fft(segmentView);

    segmentFFTs[i] = arma::conv_to<arma::cx_vec>::from(spectrum);

    arma::fvec magnitudes = arma::abs(spectrum);
        arma::uword peakBin = magnitudes.index_max();
        float peakFreqHz = static_cast<float>(peakBin) * sampleRate / segmentSize;

    std::cout << "FFT size: " << spectrum.n_elem
                   << " | peak bin: " << peakBin
                   << " | approx peak freq: " << peakFreqHz << " Hz\n\n";


    audioPtr += segmentSize; //move pointer to next segment

    }

/* Note identification
fix this later, but basically the point of this section is to define a range that can be used to identify what note the frequency played is in.
may need to be changed later in order to improve the accuracy of the note identification as well as to define the note the frequency is as a variable that can be used throughout transcription, not just once?
 for (int i = 0; i < numSegments; i++) {
    if (audioPtr[0] > 3951.07 && audioPtr[0] < 4186.01) {
        std::cout << "Note is B7"
        int note = B7;
    } 
 }
    ??this could work maybe??
*/



if (audioPtr[0] > 3951.07 && audioPtr[0] < 4186.01) {
    std::cout << "Note is B7";
}

if (audioPtr[0] > 4186.01 && audioPtr[0] < 4434.92) {
    std::cout << "Note is C8";
}

if (audioPtr[0] > 4186.01 && audioPtr[0] < 4434.92) {
    std::cout << "Note is C8";
}

if (audioPtr[0] > 4434.92 && audioPtr[0] < 4698.64) {
    std::cout << "Note is C#";
    return 0;
}

