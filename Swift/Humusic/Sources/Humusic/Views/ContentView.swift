import SwiftUI

struct ContentView: View {
    @StateObject private var vm = TranscriptionViewModel()

    var body: some View {
        HStack(spacing: 0) {
            RecordingRail(vm: vm)
            HairlineVDivider()
            ManuscriptView(vm: vm)
        }
        .frame(minWidth: 920, minHeight: 560)
        .background(Palette.voidBlack)
        .preferredColorScheme(.dark)
    }
}