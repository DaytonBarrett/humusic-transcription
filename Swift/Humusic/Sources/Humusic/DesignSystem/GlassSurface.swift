import SwiftUI

/// A hand-tuned glass panel: real Liquid Glass on macOS 26+, a flat
/// translucent material fallback otherwise. Always a fine 1px hairline
/// border, never a drop shadow.
struct GlassSurface<S: Shape>: ViewModifier {
    var shape: S
    var tint: Color? = nil
    var borderColor: Color = Palette.hairline

    func body(content: Content) -> some View {
        if #available(macOS 26.0, *) {
            content
                .background {
                    if let tint {
                        shape.fill(.clear).glassEffect(.regular.tint(tint), in: shape)
                    } else {
                        shape.fill(.clear).glassEffect(.regular, in: shape)
                    }
                }
                .overlay(shape.stroke(borderColor, lineWidth: 1))
        } else {
            content
                .background(shape.fill(.ultraThinMaterial))
                .background(shape.fill(Palette.charcoal.opacity(0.4)))
                .overlay(shape.stroke(borderColor, lineWidth: 1))
        }
    }
}

extension View {
    func glassPanel<S: Shape>(_ shape: S, tint: Color? = nil, border: Color = Palette.hairline) -> some View {
        modifier(GlassSurface(shape: shape, tint: tint, borderColor: border))
    }

    /// Sharp-cornered glass — the house shape. No uniform 8/12px rounding.
    func editorialGlass(cornerRadius: CGFloat = 2, tint: Color? = nil) -> some View {
        glassPanel(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous), tint: tint)
    }
}

/// A single fine rule, used instead of shadows to separate content.
struct HairlineDivider: View {
    var color: Color = Palette.hairline
    var body: some View {
        Rectangle().fill(color).frame(height: 1)
    }
}

struct HairlineVDivider: View {
    var color: Color = Palette.hairline
    var body: some View {
        Rectangle().fill(color).frame(width: 1)
    }
}