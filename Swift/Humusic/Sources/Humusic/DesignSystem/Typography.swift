import SwiftUI

/// Pairs a sharp serif for editorial headlines with a clean mono for
/// technical labels — the two-voice system used throughout the app.
enum Typography {
    static func display(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }

    static func serifBody(_ size: CGFloat = 15) -> Font {
        .system(size: size, weight: .regular, design: .serif)
    }

    static func mono(_ size: CGFloat = 11, weight: Font.Weight = .medium) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
}

/// A tracked-out uppercase technical label, e.g. "REC · 00:14" or "TEMPO".
struct TechnicalLabel: View {
    let text: String
    var size: CGFloat = 11
    var color: Color = Palette.inkDim

    var body: some View {
        Text(text.uppercased())
            .font(Typography.mono(size))
            .tracking(1.6)
            .foregroundStyle(color)
    }
}

extension View {
    /// Loose letter-spacing for mono technical labels.
    func technicalTracking(_ value: CGFloat = 1.6) -> some View {
        self.tracking(value)
    }
}