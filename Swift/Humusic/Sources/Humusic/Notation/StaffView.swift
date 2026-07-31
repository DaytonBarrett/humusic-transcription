import SwiftUI

/// A hand-built treble-clef staff renderer — no notation library. Draws
/// lines, ledger lines, noteheads, stems, flags, and barlines directly
/// with Canvas so the sheet music matches the app's own drawn-ink voice
/// rather than borrowing a generic engraving font.
///
/// Colors are parameters, not hardcoded: this is meant to sit on the
/// manuscript paper panel (dark ink on a light page), not the dark canvas.
struct StaffView: View {
    let notes: [PitchedNote]
    var lineGap: CGFloat = 13
    var noteSpacing: CGFloat = 34
    var inkColor: Color = Color(red: 0.06, green: 0.06, blue: 0.07)
    var staffLineColor: Color = Color(red: 0.06, green: 0.06, blue: 0.07).opacity(0.55)
    var dimColor: Color = Color(red: 0.06, green: 0.06, blue: 0.07).opacity(0.45)
    var accentColor: Color = Palette.signal

    var body: some View {
        let contentWidth = max(CGFloat(notes.count) * noteSpacing + 140, 400)
        ScrollView(.horizontal, showsIndicators: false) {
            Canvas { context, size in
                draw(context: context, size: CGSize(width: contentWidth, height: size.height))
            }
            .frame(width: contentWidth, height: 6 * lineGap * 2 + 40)
        }
    }

    private func draw(context: GraphicsContext, size: CGSize) {
        let midY = size.height / 2
        let leftInset: CGFloat = 56
        let staffShading = GraphicsContext.Shading.color(staffLineColor)

        for i in -2...2 {
            let y = midY - CGFloat(i) * lineGap
            var path = Path()
            path.move(to: CGPoint(x: leftInset - 24, y: y))
            path.addLine(to: CGPoint(x: size.width - 8, y: y))
            context.stroke(path, with: staffShading, lineWidth: 1)
        }

        context.draw(
            Text("𝄞").font(.system(size: lineGap * 6.6)).foregroundStyle(inkColor),
            at: CGPoint(x: leftInset - 46, y: midY + lineGap * 0.6),
            anchor: .center
        )

        var x: CGFloat = leftInset + 30
        var quarterAccum: Double = 0

        for (index, note) in notes.enumerated() {
            if quarterAccum == 0, index > 0 {
                var bar = Path()
                bar.move(to: CGPoint(x: x - noteSpacing / 2, y: midY - 2 * lineGap))
                bar.addLine(to: CGPoint(x: x - noteSpacing / 2, y: midY + 2 * lineGap))
                context.stroke(bar, with: staffShading, lineWidth: 1)
            }

            if note.isRest {
                drawRest(context: context, note: note, x: x, midY: midY)
            } else {
                drawNote(context: context, note: note, x: x, midY: midY)
            }

            quarterAccum += note.duration.fraction * 4.0
            x += noteSpacing
            if quarterAccum >= 4.0 { quarterAccum = 0 }
        }

        var closing = Path()
        closing.move(to: CGPoint(x: x - noteSpacing / 2 + 6, y: midY - 2 * lineGap))
        closing.addLine(to: CGPoint(x: x - noteSpacing / 2 + 6, y: midY + 2 * lineGap))
        context.stroke(closing, with: staffShading, lineWidth: 1.6)
    }

    private func drawRest(context: GraphicsContext, note: PitchedNote, x: CGFloat, midY: CGFloat) {
        let w: CGFloat = note.duration == .whole ? 14 : (note.duration == .half ? 12 : 8)
        let rect = CGRect(x: x - w / 2, y: midY - 3, width: w, height: 5)
        context.fill(Path(roundedRect: rect, cornerRadius: 1), with: .color(dimColor))
        context.draw(
            Text(restLabel(note.duration)).font(Typography.mono(8)).foregroundStyle(dimColor),
            at: CGPoint(x: x, y: midY + lineGap * 2.6),
            anchor: .center
        )
    }

    private func restLabel(_ d: NoteDuration) -> String {
        switch d {
        case .whole: return "𝄻"
        case .half: return "𝄼"
        case .quarter: return "𝄽"
        case .eighth: return "𝄾"
        case .sixteenth: return "𝄿"
        }
    }

    private func drawNote(context: GraphicsContext, note: PitchedNote, x: CGFloat, midY: CGFloat) {
        guard let step = note.staffStep else { return }
        let y = midY - CGFloat(step) * (lineGap / 2)
        let stemUp = step < 0
        let headW: CGFloat = lineGap * 1.15
        let headH: CGFloat = lineGap * 0.82
        let open = note.duration == .whole || note.duration == .half

        if step > 4 {
            var s = 6
            while s <= step {
                let ly = midY - CGFloat(s) * (lineGap / 2)
                var p = Path()
                p.move(to: CGPoint(x: x - headW * 0.85, y: ly))
                p.addLine(to: CGPoint(x: x + headW * 0.85, y: ly))
                context.stroke(p, with: .color(staffLineColor), lineWidth: 1)
                s += 2
            }
        } else if step < -4 {
            var s = -6
            while s >= step {
                let ly = midY - CGFloat(s) * (lineGap / 2)
                var p = Path()
                p.move(to: CGPoint(x: x - headW * 0.85, y: ly))
                p.addLine(to: CGPoint(x: x + headW * 0.85, y: ly))
                context.stroke(p, with: .color(staffLineColor), lineWidth: 1)
                s -= 2
            }
        }

        var headPath = Path(ellipseIn: CGRect(x: -headW / 2, y: -headH / 2, width: headW, height: headH))
        let transform = CGAffineTransform(rotationAngle: -0.35).translatedBy(x: x, y: y)
        headPath = headPath.applying(transform)
        if open {
            context.stroke(headPath, with: .color(inkColor), lineWidth: 1.6)
        } else {
            context.fill(headPath, with: .color(inkColor))
        }

        if note.isSharp {
            context.draw(
                Text("♯").font(Typography.mono(12, weight: .semibold)).foregroundStyle(accentColor),
                at: CGPoint(x: x - headW, y: y),
                anchor: .center
            )
        }

        guard note.duration != .whole else { return }

        let stemX = x + (stemUp ? headW / 2 - 1 : -headW / 2 + 1)
        let stemTopY = stemUp ? y - lineGap * 3 : y
        let stemBottomY = stemUp ? y : y + lineGap * 3
        var stemPath = Path()
        stemPath.move(to: CGPoint(x: stemX, y: stemTopY))
        stemPath.addLine(to: CGPoint(x: stemX, y: stemBottomY))
        context.stroke(stemPath, with: .color(inkColor), lineWidth: 1.4)

        let flagCount = note.duration == .eighth ? 1 : (note.duration == .sixteenth ? 2 : 0)
        for i in 0..<flagCount {
            let flagOriginY = stemUp ? stemTopY + CGFloat(i) * 6 : stemBottomY - CGFloat(i) * 6
            var flag = Path()
            if stemUp {
                flag.move(to: CGPoint(x: stemX, y: flagOriginY))
                flag.addCurve(
                    to: CGPoint(x: stemX + 10, y: flagOriginY + 12),
                    control1: CGPoint(x: stemX + 9, y: flagOriginY + 1),
                    control2: CGPoint(x: stemX + 11, y: flagOriginY + 7)
                )
                flag.addCurve(
                    to: CGPoint(x: stemX, y: flagOriginY + 8),
                    control1: CGPoint(x: stemX + 4, y: flagOriginY + 11),
                    control2: CGPoint(x: stemX + 1, y: flagOriginY + 9)
                )
            } else {
                flag.move(to: CGPoint(x: stemX, y: flagOriginY))
                flag.addCurve(
                    to: CGPoint(x: stemX + 10, y: flagOriginY - 12),
                    control1: CGPoint(x: stemX + 9, y: flagOriginY - 1),
                    control2: CGPoint(x: stemX + 11, y: flagOriginY - 7)
                )
                flag.addCurve(
                    to: CGPoint(x: stemX, y: flagOriginY - 8),
                    control1: CGPoint(x: stemX + 4, y: flagOriginY - 11),
                    control2: CGPoint(x: stemX + 1, y: flagOriginY - 9)
                )
            }
            flag.closeSubpath()
            context.fill(flag, with: .color(inkColor))
        }
    }
}