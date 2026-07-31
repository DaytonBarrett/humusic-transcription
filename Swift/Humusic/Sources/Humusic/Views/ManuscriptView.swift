import SwiftUI

/// The right-hand stage: a true paper-white manuscript panel holding the
/// staff, sitting on the dark canvas — a deliberate ink-on-paper motif
/// rather than another dark glass card.
struct ManuscriptView: View {
    @ObservedObject var vm: TranscriptionViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionHeader(kicker: "Score · Treble Clef", title: vm.pieceTitle)
                .padding(.leading, 4)

            paper

            if vm.hasTranscription {
                tokenStrip
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var paper: some View {
        Group {
            if vm.hasTranscription {
                StaffView(notes: vm.notes)
                    .padding(.vertical, 28)
                    .padding(.horizontal, 8)
            } else {
                emptyState
            }
        }
        .frame(maxWidth: .infinity)
        .background(Palette.ink)
        .overlay(Rectangle().stroke(Palette.hairlineStrong, lineWidth: 1))
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Nothing transcribed yet")
                .font(Typography.display(17))
                .foregroundStyle(Palette.voidBlack)
            Text("Set a tempo, press Record, and stop whenever you're done — the take is analyzed the moment you stop.")
                .font(Typography.serifBody(13))
                .foregroundStyle(Palette.voidBlack.opacity(0.55))
                .frame(maxWidth: 340, alignment: .leading)
        }
        .padding(40)
        .frame(maxWidth: .infinity, minHeight: 220, alignment: .leading)
    }

    private var tokenStrip: some View {
        VStack(alignment: .leading, spacing: 8) {
            TechnicalLabel(text: "Detected Sequence")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Array(vm.notes.enumerated()), id: \.offset) { _, note in
                        Text(note.label)
                            .font(Typography.mono(10.5, weight: .medium))
                            .foregroundStyle(note.isRest ? Palette.inkDim : Palette.ink)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 5)
                            .overlay(Rectangle().stroke(Palette.hairline, lineWidth: 1))
                    }
                }
            }
        }
        .padding(.leading, 4)
    }
}