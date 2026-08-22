# Shipping humusic on iOS

The transcriber is packaged for the App Store with [Capacitor](https://capacitorjs.com),
which wraps the web bundle in a real native project you build and sign in Xcode.

Everything on the web side is already done: the bundle is fully offline (fonts,
notation engine and all assets are vendored), safe-area insets are handled, the
audio context resumes on the user gesture iOS requires, and exports go through
the native share sheet instead of a browser download.

What remains is the part that needs a Mac with Xcode and an Apple Developer
account — it cannot be done from this repo alone.

---

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| macOS + Xcode 16 or newer | Capacitor 8 requires it |
| Node.js 20+ | not currently installed on this machine |
| CocoaPods | `sudo gem install cocoapods` |
| Apple Developer Program | $99/year, required to ship to the store |

## 2. Create the iOS project

```bash
npm install
npm run ios:add      # builds www/ then runs: npx cap add ios
npm run ios:open     # opens ios/App/App.xcworkspace in Xcode
```

`npm run build` alone regenerates `www/` — the bundle Capacitor ships. It copies
`app.html` in as `index.html` so the app opens straight into the transcriber
rather than the marketing site, and it **fails the build if any file references a
remote host**, because an App Store build has to work with no network at all.

After changing any web file:

```bash
npm run ios:sync
```

## 3. Microphone permission — required, app crashes without it

iOS terminates the app the moment it calls `getUserMedia` if this key is
missing. In Xcode open `ios/App/App/Info.plist` and add:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>humusic uses the microphone to record the music you play so it can be transcribed into notation on your device.</string>
```

Write it in plain, specific language. App Review rejects vague purpose strings,
and this one should say the recording is processed on-device, because it is.

## 4. App icon

`ios-assets/AppIcon.appiconset/` holds a store-ready 1024×1024 icon generated
from `images/humusic-icon.png`. It is **square and fully opaque** — the App Store
rejects icons with an alpha channel or with rounded corners baked in, since iOS
applies its own mask.

Copy the folder's contents into
`ios/App/App/Assets.xcassets/AppIcon.appiconset/`, replacing what Capacitor
generated. `ios-assets/_masked-preview.png` shows how it looks once iOS rounds
it, and is not shipped.

`ios-assets/splash-2732.png` is a launch image on the same bone background; wire
it up with `@capacitor/splash-screen` if you want it.

## 5. Before you submit

- **Deployment target** — set it in Xcode (iOS 15+ is a safe floor for Capacitor 8).
- **Version + build number** — must increase on every upload.
- **Screenshots** — required for 6.9" and 6.5" iPhone at minimum.
- **Privacy nutrition label** — in App Store Connect, declare **no data
  collected**. That is accurate: audio never leaves the device, there is no
  account, and there is no analytics SDK in the bundle.
- **Export compliance** — the app uses no encryption beyond HTTPS; answer the
  encryption question accordingly.
- **Test on a real device.** The Simulator does not give you a usable
  microphone, so recording cannot be meaningfully verified there.

## 6. The review risk worth knowing about

**Guideline 4.2 (Minimum Functionality)** is where wrapped web apps get
rejected. This app has a genuine case — it uses the microphone, does real signal
processing on-device, and produces a file through native sharing, none of which
a website could do — but that argument has to be made, not assumed.

Two things that measurably help:

1. Ship the transcriber only, not the marketing site. `www/` is already built
   this way.
2. In App Review notes, state plainly what the app does on-device and that no
   web view of an existing website is being resold.

I cannot promise approval, and nobody can. What is done here is the
engineering side; the review outcome is Apple's call.

---

## Known gaps

- **`ScriptProcessorNode`** is deprecated. It works in WKWebView today and was
  chosen so the page also runs from `file://` with no module loading, but the
  long-term fix is an `AudioWorklet` with a Capacitor-served bundle.
- **Background audio** is not configured. The app is designed to be used in the
  foreground; if you want recording to survive backgrounding, that needs an
  audio session category set natively.
- **Polyphony** — the pitch detector is monophonic by design. Chords will not
  transcribe correctly.
