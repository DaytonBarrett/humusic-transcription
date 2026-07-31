import SwiftUI

/// House button: flat, sharp-cornered, hairline border, signal-colored
/// fill only when primary. No pill shapes, no soft shadow.
struct EditorialButtonStyle: ButtonStyle {
    var primary: Bool = false
    var destructive: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        let fg: Color = primary || destructive ? Palette.voidBlack : Palette.ink
        let bg: Color = destructive ? Palette.signal : (primary ? Palette.ink : Color.clear)

        HStack(spacing: 8) {
            configuration.label
        }
        .font(Typography.mono(11, weight: .semibold))
        .technicalTracking(1.2)
        .foregroundStyle(fg)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(bg)
        .overlay(
            Rectangle()
                .stroke(primary || destructive ? Color.clear : Palette.hairlineStrong, lineWidth: 1)
        )
        .opacity(configuration.isPressed ? 0.68 : 1)
        .scaleEffect(configuration.isPressed ? 0.985 : 1)
        .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
    }
}

/// A section header: mono kicker over a serif title, left-aligned,
/// with a short signal-colored rule — the recurring editorial motif.
struct SectionHeader: View {
    let kicker: String
    let title: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Rectangle().fill(Palette.signal).frame(width: 18, height: 2)
                TechnicalLabel(text: kicker)
            }
            Text(title)
                .font(Typography.display(22))
                .foregroundStyle(Palette.ink)
        }
    }
}

/// Numeric readout used for tempo / timecode — mono, tabular.
struct ReadoutField: View {
    @Binding var value: Int
    var range: ClosedRange<Int>
    var label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TechnicalLabel(text: label)
            HStack(spacing: 14) {
                stepButton("−") { value = max(range.lowerBound, value - 1) }
                Text("\(value)")
                    .font(Typography.display(30, weight: .medium))
                    .foregroundStyle(Palette.ink)
                    .frame(minWidth: 64, alignment: .center)
                    .monospacedDigit()
                stepButton("+") { value = min(range.upperBound, value + 1) }
            }
        }
    }

    private func stepButton(_ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(symbol)
                .font(Typography.mono(14, weight: .semibold))
                .frame(width: 26, height: 26)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Palette.inkDim)
        .overlay(Rectangle().stroke(Palette.hairline, lineWidth: 1))
    }
}

/// Small square status dot + mono caption, e.g. "● REC 00:14".
struct StatusChip: View {
    let text: String
    var active: Bool = false

    var body: some View {
        HStack(spacing: 7) {
            Circle()
                .fill(active ? Palette.signal : Palette.inkDim)
                .frame(width: 6, height: 6)
            TechnicalLabel(text: text, color: active ? Palette.ink : Palette.inkDim)
        }
    }
}