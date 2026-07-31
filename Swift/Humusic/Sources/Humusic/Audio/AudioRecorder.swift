import AVFoundation
import Combine

/// Captures mono microphone audio until the user explicitly stops it —
/// no fixed-length window. Publishes elapsed time for the UI's live
/// timecode readout.
@MainActor
final class AudioRecorder: ObservableObject {
    @Published private(set) var isRecording = false
    @Published private(set) var elapsed: TimeInterval = 0
    @Published var lastError: String?

    private let engine = AVAudioEngine()
    private var samples: [Float] = []
    private var sampleRate: Double = 44_100
    private var startedAt: Date?
    private var tickTask: Task<Void, Never>?

    var recordedSampleRate: Double { sampleRate }

    func start() {
        guard !isRecording else { return }
        samples.removeAll(keepingCapacity: true)
        lastError = nil

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        sampleRate = format.sampleRate > 0 ? format.sampleRate : 44_100

        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let channel = buffer.floatChannelData?[0] else { return }
            let frameCount = Int(buffer.frameLength)
            let chunk = Array(UnsafeBufferPointer(start: channel, count: frameCount))
            Task { @MainActor [weak self] in
                self?.samples.append(contentsOf: chunk)
            }
        }

        do {
            engine.prepare()
            try engine.start()
        } catch {
            lastError = "Could not start microphone: \(error.localizedDescription)"
            return
        }

        isRecording = true
        startedAt = Date()
        elapsed = 0
        tickTask = Task { [weak self] in
            while let self, self.isRecording {
                try? await Task.sleep(nanoseconds: 50_000_000)
                guard self.isRecording, let startedAt = self.startedAt else { return }
                self.elapsed = Date().timeIntervalSince(startedAt)
            }
        }
    }

    /// Stops capture immediately, at whatever length the user chose,
    /// and hands back the recorded samples for analysis.
    @discardableResult
    func stop() -> (samples: [Float], sampleRate: Double) {
        guard isRecording else { return (samples, sampleRate) }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        tickTask?.cancel()
        tickTask = nil
        isRecording = false
        return (samples, sampleRate)
    }
}