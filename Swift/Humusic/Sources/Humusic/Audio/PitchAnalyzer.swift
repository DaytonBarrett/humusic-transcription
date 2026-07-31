import Accelerate
import Foundation

/// Ports the original C++ FFT/note-identification pipeline (fixed 30s
/// clip, tempo*16 hand-wavy split count) into something that works on a
/// real, variable-length recording: segments are sized to a true
/// sixteenth note at the given tempo, so the grid means what it says
/// regardless of how long the user actually held record.
enum PitchAnalyzer {
    private static let noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

    static func analyze(samples: [Float], sampleRate: Double, tempoBPM: Int) -> [PitchedNote] {
        guard samples.count >= 128, tempoBPM > 0, sampleRate > 0 else { return [] }

        let sixteenthSeconds = (60.0 / Double(tempoBPM)) / 4.0
        let idealSegmentSamples = max(64, Int((sixteenthSeconds * sampleRate).rounded()))
        let segmentSize = min(idealSegmentSamples, samples.count)
        guard segmentSize >= 64 else { return [] }

        let numSegments = max(1, samples.count / segmentSize)

        var notes: [PitchedNote] = []
        notes.reserveCapacity(numSegments)

        var offset = 0
        for _ in 0..<numSegments {
            let remaining = samples.count - offset
            guard remaining >= 64 else { break }
            let windowLength = min(segmentSize, remaining)
            let (freq, magnitude) = dominantFrequency(
                samples: samples, offset: offset, length: windowLength, sampleRate: sampleRate
            )
            let silenceThreshold: Float = 0.8
            let effectiveFreq = magnitude > silenceThreshold ? freq : 0
            notes.append(noteFor(frequency: effectiveFreq, seconds: sixteenthSeconds))
            offset += windowLength
        }

        return mergeAndQuantize(notes)
    }

    /// Collapses a run of identical-pitch sixteenth-grid slots into a
    /// single note of the nearest standard duration, so the staff reads
    /// as music rather than a wall of sixteenth notes.
    private static func mergeAndQuantize(_ grid: [PitchedNote]) -> [PitchedNote] {
        guard !grid.isEmpty else { return [] }
        var merged: [PitchedNote] = []
        var runLabel = grid[0].label
        var runCount = 0
        var runSeconds: Double = 0
        var runStep = grid[0].step
        var runOctave = grid[0].octave

        func flush() {
            guard runCount > 0 else { return }
            merged.append(
                PitchedNote(step: runStep, octave: runOctave, duration: quantizedDuration(gridCount: runCount), seconds: runSeconds)
            )
        }

        for note in grid {
            if note.label == runLabel {
                runCount += 1
                runSeconds += note.seconds
            } else {
                flush()
                runLabel = note.label
                runStep = note.step
                runOctave = note.octave
                runCount = 1
                runSeconds = note.seconds
            }
        }
        flush()
        return merged
    }

    /// Maps a count of sixteenth-note grid slots to the nearest standard
    /// note value (whole/half/quarter/eighth/sixteenth).
    private static func quantizedDuration(gridCount: Int) -> NoteDuration {
        let candidates: [(NoteDuration, Int)] = [(.sixteenth, 1), (.eighth, 2), (.quarter, 4), (.half, 8), (.whole, 16)]
        return candidates.min { abs($0.1 - gridCount) < abs($1.1 - gridCount) }!.0
    }

    /// Real-input FFT via the classic vDSP split-complex path. Returns the
    /// peak frequency (Hz) in the lower half of the spectrum (the upper
    /// half mirrors it for real input) and its magnitude.
    private static func dominantFrequency(
        samples: [Float], offset: Int, length: Int, sampleRate: Double
    ) -> (Float, Float) {
        let fftLength = 1 << Int(log2(Double(length)))
        guard fftLength >= 8 else { return (0, 0) }
        let log2n = vDSP_Length(log2(Double(fftLength)))

        guard let setup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2)) else { return (0, 0) }
        defer { vDSP_destroy_fftsetup(setup) }

        var window = Array(samples[offset..<(offset + fftLength)])
        let half = fftLength / 2

        var realp = [Float](repeating: 0, count: half)
        var imagp = [Float](repeating: 0, count: half)
        var magnitudes = [Float](repeating: 0, count: half)

        realp.withUnsafeMutableBufferPointer { realBP in
            imagp.withUnsafeMutableBufferPointer { imagBP in
                var split = DSPSplitComplex(realp: realBP.baseAddress!, imagp: imagBP.baseAddress!)
                window.withUnsafeMutableBufferPointer { wp in
                    wp.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: half) { complexPtr in
                        vDSP_ctoz(complexPtr, 2, &split, 1, vDSP_Length(half))
                    }
                }
                vDSP_fft_zrip(setup, &split, 1, log2n, FFTDirection(FFT_FORWARD))
                vDSP_zvmags(&split, 1, &magnitudes, 1, vDSP_Length(half))
            }
        }
        // bin 0 packs DC and Nyquist together in real-FFT format — never a
        // meaningful "pitch", so exclude it from the peak search.
        magnitudes[0] = 0

        var peakValue: Float = 0
        var peakIndex: vDSP_Length = 0
        vDSP_maxvi(magnitudes, 1, &peakValue, &peakIndex, vDSP_Length(magnitudes.count))

        let peakFreq = Float(peakIndex) * Float(sampleRate) / Float(fftLength)
        return (peakFreq, sqrt(max(peakValue, 0)))
    }

    private static func noteFor(frequency: Float, seconds: Double) -> PitchedNote {
        guard frequency > 20 else {
            return PitchedNote(step: nil, octave: nil, duration: .sixteenth, seconds: seconds)
        }
        let midiFloat = 69.0 + 12.0 * log2f(frequency / 440.0)
        let midi = Int(midiFloat.rounded())
        let octave = (midi / 12) - 1
        var noteIndex = midi % 12
        if noteIndex < 0 { noteIndex += 12 }
        return PitchedNote(step: noteNames[noteIndex], octave: octave, duration: .sixteenth, seconds: seconds)
    }
}