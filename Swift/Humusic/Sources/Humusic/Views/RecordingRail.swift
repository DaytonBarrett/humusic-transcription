import SwiftUI

/// The left-hand control rail — identity, transport, tempo, export.
/// Deliberately plain against the canvas; glass is reserved for the
/// interactive control clusters, not used as a generic panel backing.
struct RecordingRail: View {
    @ObservedObject var vm: TranscriptionViewModel
    @State private var filename: String = "Untitled Take"

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            HairlineDivider().padding(.top, 22).padding(.bottom, 26)
            transport
            HairlineDivider().padding(.vertical, 26)
            ReadoutField(value: $vm.tempoBPM, range: 30...240, label: "Tempo · BPM")
            Spacer(minLength: 32)
            exportBlock
        }
        .padding(24)
        .frame(width: 328, alignment: .leading)
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            Image("BrandMarkWhite", bundle: .module)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 30, height: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text("Humusic")
                    .font(Typography.display(21, weight: .semibold))
                    .foregroundStyle(Palette.ink)
                TechnicalLabel(text: "Ear → Ink")
            }
        }
    }

    private var transport: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Button {
                    vm.toggleRecording()
                } label: {
                    HStack(spacing: 8) {
                        Circle()
                            .fill(vm.isRecording ? Palette.voidBlack : Palette.signal)
                            .frame(width: 7, height: 7)
                        Text(vm.isRecording ? "Stop" : "Record")
                    }
                }
                .buttonStyle(EditorialButtonStyle(primary: !vm.isRecording, destructive: vm.isRecording))

                if vm.isAnalyzing {
                    ProgressView().controlSize(.small).tint(Palette.inkDim)
                }
            }

            StatusChip(
                text: vm.isRecording ? "Recording · \(formattedElapsed)" : (vm.hasTranscription ? "Captured · \(formattedElapsed)" : "Ready"),
                active: vm.isRecording
            )

            if let error = vm.errorMessage {
                Text(error)
                    .font(Typography.mono(10.5))
                    .foregroundStyle(Palette.signal)
                    .fixedSize(horizontal: false, vertical: true)
            }

            TechnicalLabel(text: "Stops on your mark — no fixed clip length.", color: Palette.inkDim.opacity(0.85))
                .font(Typography.mono(9.5))
        }
    }

    private var exportBlock: some View {
        VStack(alignment: .leading, spacing: 12) {
            TechnicalLabel(text: "Title")
            TextField("", text: $vm.pieceTitle)
                .textFieldStyle(.plain)
                .font(Typography.serifBody(15))
                .foregroundStyle(Palette.ink)
                .padding(.vertical, 8)
                .overlay(alignment: .bottom) { HairlineDivider() }

            TechnicalLabel(text: "Filename").padding(.top, 6)
            TextField("transcription", text: $filename)
                .textFieldStyle(.plain)
                .font(Typography.mono(13))
                .foregroundStyle(Palette.ink)
                .padding(.vertical, 8)
                .overlay(alignment: .bottom) { HairlineDivider() }

            Button {
                vm.exportMusicXML(named: filename)
            } label: {
                HStack(spacing: 8) {
                    Text("Export MusicXML")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(EditorialButtonStyle(primary: true))
            .disabled(!vm.hasTranscription)
            .opacity(vm.hasTranscription ? 1 : 0.35)
            .padding(.top, 6)

            TechnicalLabel(text: "Opens in MuseScore, Finale, Dorico", color: Palette.inkDim.opacity(0.8))
                .font(Typography.mono(9.5))
        }
    }

    private var formattedElapsed: String {
        let t = vm.elapsed
        let m = Int(t) / 60
        let s = Int(t) % 60
        let cs = Int((t - t.rounded(.down)) * 100)
        return String(format: "%02d:%02d.%02d", m, s, cs)
    }
}