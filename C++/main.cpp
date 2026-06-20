#include <iostream>
#include <string>
#include <vector>
#include <iostream>
#include <numeric>
#include <cmath>

int main() {
    
    const int   sampleRate = 44100;
    const int totalSamples = 30 * sampleRate; //30 seconds total
    std::vector<float> audioBuffer(totalSamples);
    int tempo;

    std::cout << "Enter tempo: ";
    std::cin >> tempo;
    std::cout << "Sample division " << tempo * 16 << std::endl;

    const float pi = 3.141592653f;
    const float frequency = 440.0f;
    for (int i = 0; i < totalSamples; i++) {
        audioBuffer[i] = std::sin(2.0f * pi * frequency * i / sampleRate);
    }

    return 0;
}

