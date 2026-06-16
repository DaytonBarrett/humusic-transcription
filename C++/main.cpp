#include <iostream>
#include <vector>
#include <iostream>
#include <armadillo>
#include <portaudio.h>
#include <numeric>
#include <cmath>

int tempo = 120; // default tempo in BPM, can be changed by user input
int *pTP = &tempo; // pointer to tempo variable 

int sample_division () // calculate sample division
{
    int sample_division = pTP[0] * 16; // calculate sample division based on tempo

    std::cout << "Sample division: " << sample_division << std::endl; // print sample division for debugging

    return sample_division;
}
