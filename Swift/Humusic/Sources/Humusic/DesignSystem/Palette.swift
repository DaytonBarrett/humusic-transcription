import SwiftUI

/// A restrained, monochromatic palette with a single stark accent.
/// No purple/indigo, no glow — flat ink and paper, one signal color.
enum Palette {
    static let voidBlack = Color(red: 0.043, green: 0.043, blue: 0.047)      // #0B0B0C canvas
    static let charcoal = Color(red: 0.078, green: 0.078, blue: 0.086)       // #14141 6 panel base
    static let ink = Color(red: 0.965, green: 0.957, blue: 0.937)           // #F6F4EF primary text (warm paper white)
    static let inkDim = Color(red: 0.62, green: 0.61, blue: 0.60)           // secondary text
    static let hairline = Color.white.opacity(0.14)                        // panel borders
    static let hairlineStrong = Color.white.opacity(0.28)

    /// Signal — the one accent, used sparingly and deliberately.
    static let signal = Color(red: 0.914, green: 0.271, blue: 0.180)        // #E9452E vermillion

    static let staffLine = Color.white.opacity(0.55)
    static let restGlyph = Color.white.opacity(0.35)
}