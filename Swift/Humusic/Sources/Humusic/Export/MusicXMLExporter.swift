import Foundation

/// Builds a MusicXML 4.0 partwise document from transcribed notes —
/// opens directly in MuseScore, Finale, Dorico, etc.
enum MusicXMLExporter {
    static func build(notes: [PitchedNote], tempoBPM: Int, title: String) -> String {
        let divisions = 4 // ticks per quarter note; matches our finest grid (sixteenth = 1 tick)
        let beatsPerMeasure = 4
        let ticksPerMeasure = divisions * beatsPerMeasure

        var xml = """
        <?xml version="1.0" encoding="UTF-8" standalone="no"?>
        <!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
        <score-partwise version="4.0">
          <work>
            <work-title>\(xmlEscape(title))</work-title>
          </work>
          <identification>
            <encoding>
              <software>Humusic</software>
            </encoding>
          </identification>
          <part-list>
            <score-part id="P1">
              <part-name>Voice</part-name>
            </score-part>
          </part-list>
          <part id="P1">

        """

        var measureNumber = 1
        var ticksInMeasure = 0
        var measureBody = ""

        func openMeasureHeaderIfNeeded() -> String {
            var header = "    <measure number=\"\(measureNumber)\">\n"
            if measureNumber == 1 {
                header += """
                      <attributes>
                        <divisions>\(divisions)</divisions>
                        <key><fifths>0</fifths></key>
                        <time><beats>\(beatsPerMeasure)</beats><beat-type>4</beat-type></time>
                        <clef><sign>G</sign><line>2</line></clef>
                      </attributes>

                """
                header += "      <direction placement=\"above\">\n"
                header += "        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>\(tempoBPM)</per-minute></metronome></direction-type>\n"
                header += "        <sound tempo=\"\(tempoBPM)\"/>\n"
                header += "      </direction>\n"
            }
            return header
        }

        var currentHeader = openMeasureHeaderIfNeeded()

        func closeMeasure() {
            xml += currentHeader
            xml += measureBody
            xml += "    </measure>\n"
            measureNumber += 1
            ticksInMeasure = 0
            measureBody = ""
            currentHeader = openMeasureHeaderIfNeeded()
        }

        for note in notes {
            var remainingTicks = note.duration.ticks(divisions: divisions)
            while remainingTicks > 0 {
                let spaceLeft = ticksPerMeasure - ticksInMeasure
                let chunk = min(remainingTicks, spaceLeft)
                measureBody += noteElement(note, ticks: chunk, divisions: divisions)
                ticksInMeasure += chunk
                remainingTicks -= chunk
                if ticksInMeasure >= ticksPerMeasure {
                    closeMeasure()
                }
            }
        }
        if ticksInMeasure > 0 {
            closeMeasure()
        }

        xml += "  </part>\n</score-partwise>\n"
        return xml
    }

    private static func noteElement(_ note: PitchedNote, ticks: Int, divisions: Int) -> String {
        let typeName = closestTypeName(ticks: ticks, divisions: divisions)
        if note.isRest {
            return """
                  <note>
                    <rest/>
                    <duration>\(ticks)</duration>
                    <voice>1</voice>
                    <type>\(typeName)</type>
                  </note>

            """
        }
        let step = String(note.step!.first!)
        let alter = note.isSharp ? "<alter>1</alter>" : ""
        return """
              <note>
                <pitch>
                  <step>\(step)</step>
                  \(alter)
                  <octave>\(note.octave!)</octave>
                </pitch>
                <duration>\(ticks)</duration>
                <voice>1</voice>
                <type>\(typeName)</type>
              </note>

        """
    }

    private static func closestTypeName(ticks: Int, divisions: Int) -> String {
        let quarterTicks = Double(divisions)
        let ratio = Double(ticks) / quarterTicks
        let table: [(String, Double)] = [
            ("16th", 0.25), ("eighth", 0.5), ("quarter", 1), ("half", 2), ("whole", 4),
        ]
        return table.min { abs($0.1 - ratio) < abs($1.1 - ratio) }!.0
    }

    private static func xmlEscape(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }
}