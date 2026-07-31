import AppKit
import SwiftUI
import UniformTypeIdentifiers

@MainActor
final class TranscriptionViewModel: ObservableObject {
    @Published var tempoBPM: Int = 96
    @Published var notes: [PitchedNote] = []
    @Published var isAnalyzing = false
    @Published var errorMessage: String?
    @Published var pieceTitle: String = "Untitled Take"

    let recorder = AudioRecorder()

    var isRecording: Bool { recorder.isRecording }
    var elapsed: TimeInterval { recorder.elapsed }
    var hasTranscription: Bool { !notes.isEmpty }

    func toggleRecording() {
        if recorder.isRecording {
            stopAndAnalyze()
        } else {
            notes = []
            errorMessage = nil
            recorder.start()
        }
    }

    /// Ends the recording immediately, whatever the elapsed time —
    /// there is no fixed 30-second requirement.
    private func stopAndAnalyze() {
        let (samples, sampleRate) = recorder.stop()
        guard !samples.isEmpty else {
            errorMessage = "No audio captured."
            return
        }
        isAnalyzing = true
        Task.detached(priority: .userInitiated) { [tempoBPM] in
            let result = PitchAnalyzer.analyze(samples: samples, sampleRate: sampleRate, tempoBPM: tempoBPM)
            await MainActor.run {
                self.notes = result
                self.isAnalyzing = false
                if result.isEmpty {
                    self.errorMessage = "Couldn't find any pitched material in that take."
                }
            }
        }
    }

    func exportMusicXML(named filename: String) {
        let xml = MusicXMLExporter.build(notes: notes, tempoBPM: tempoBPM, title: pieceTitle)
        let panel = NSSavePanel()
        panel.title = "Export Sheet Music"
        panel.nameFieldStringValue = filename.isEmpty ? "transcription.musicxml" : ensureExtension(filename)
        panel.allowedContentTypes = [UTType(filenameExtension: "musicxml") ?? .xml]
        panel.canCreateDirectories = true

        panel.begin { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            do {
                try xml.write(to: url, atomically: true, encoding: .utf8)
            } catch {
                self?.errorMessage = "Export failed: \(error.localizedDescription)"
            }
        }
    }

    private func ensureExtension(_ name: String) -> String {
        name.lowercased().hasSuffix(".musicxml") || name.lowercased().hasSuffix(".xml")
            ? name
            : name + ".musicxml"
    }
}