import Foundation

enum NoteDuration: String, CaseIterable {
    case whole, half, quarter, eighth, sixteenth

    /// Fraction of a whole note.
    var fraction: Double {
        switch self {
        case .whole: return 1.0
        case .half: return 0.5
        case .quarter: return 0.25
        case .eighth: return 0.125
        case .sixteenth: return 0.0625
        }
    }

    /// MusicXML <type> value.
    var xmlType: String { rawValue }

    /// Divisions-per-quarter-note-relative duration, given `divisions`
    /// ticks per quarter note.
    func ticks(divisions: Int) -> Int {
        Int((fraction * 4.0 * Double(divisions)).rounded())
    }
}

struct PitchedNote: Identifiable, Equatable {
    let id = UUID()
    /// nil == rest
    let step: String?       // "C", "C#", ... (sharps only, matches analyzer)
    let octave: Int?
    let duration: NoteDuration
    let seconds: Double

    var isRest: Bool { step == nil }

    var label: String {
        guard let step, let octave else { return "Rest" }
        return "\(step)\(octave)"
    }

    /// Staff position: 0 = middle line (B4 on treble clef), positive = up.
    /// Used by StaffView to place noteheads without re-deriving pitch math.
    var staffStep: Int? {
        guard let step, let octave else { return nil }
        let letterIndex: [String: Int] = ["C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6]
        let bareLetter = String(step.first!)
        guard let li = letterIndex[bareLetter] else { return nil }
        // Diatonic position relative to B4 (treble clef middle line).
        let absoluteDiatonic = (octave * 7) + li
        let b4Diatonic = (4 * 7) + 6
        return absoluteDiatonic - b4Diatonic
    }

    var isSharp: Bool { (step?.count ?? 0) > 1 }
}