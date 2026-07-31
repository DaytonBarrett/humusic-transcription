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
    //exsampleRate rate is example sample rate

    const int   exsampleRate = 494;
    const int totalSamples = 30 * exsampleRate; //30 seconds total
    std::vector<float> audioBuffer(totalSamples);
    int tempo;

    std::cout << "Enter tempo: ";
    std::cin >> tempo;
    std::cout << "Sample division " << tempo * 16 << std::endl;

    const float frequency = 440.0f;
    for (int i = 0; i < totalSamples; i++) {
        audioBuffer[i] = std::sin(2.0f * pi * frequency * i / exsampleRate)
        ;
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
        float peakFreqHz = static_cast<float>(peakBin) * exsampleRate / segmentSize;

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
            int note[some array size] = B7;
        } 
    }
        ??this could work maybe??
    */

  int myArray[numSegments]; // 1. Declare a blank array of size numSegments

    // 2. Loop repeats 5 times, automatically moving from index 0 to 4
    for (int i = 0; i < numSegments; i++) {
        if (audioPtr[0] > 479.82 && audioPtr[0] < 508.35) {
            myArray[i] = 'B4'; // assigns note of B4 at the location in the array
        }
        if (audioPtr[0] > 508.35 && audioPtr[0] < 538.58) {
            myArray[i] = 'C5'; // assigns note of C5 at the location in the array
        }
    } 
}

