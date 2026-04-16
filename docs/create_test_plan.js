const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, BorderStyle, WidthType, ShadingType } = require("docx");
const fs = require("fs");

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };
const headerShading = { fill: "1C1C1E", type: ShadingType.CLEAR };
const headerRun = (text) => new TextRun({ text, bold: true, color: "FFFFFF", font: "Arial", size: 20 });
const cellRun = (text) => new TextRun({ text, font: "Arial", size: 20 });

function makeTable(rows, colWidths) {
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: tableWidth, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: rows.map((row, rowIdx) =>
      new TableRow({
        children: row.map((cell, colIdx) =>
          new TableCell({
            borders,
            width: { size: colWidths[colIdx], type: WidthType.DXA },
            margins: cellMargins,
            shading: rowIdx === 0 ? headerShading : undefined,
            children: [new Paragraph({ children: [rowIdx === 0 ? headerRun(cell) : cellRun(cell)] })]
          })
        )
      })
    )
  });
}

function testTable(tests) {
  const colWidths = [600, 5500, 1200, 2060];
  const rows = [["#", "Test", "Result", "Notes"], ...tests.map(t => [t[0], t[1], "", ""])];
  return makeTable(rows, colWidths);
}

const spacer = new Paragraph({ spacing: { after: 200 }, children: [] });

const sections = [{
  properties: {
    page: {
      size: { width: 12240, height: 15840 },
      margin: { top: 1200, right: 1200, bottom: 1200, left: 1200 }
    }
  },
  children: [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "MyNaavi V50 Build 85", font: "Arial", size: 36, bold: true, color: "5DCAA5" })] }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "End-to-End Test Plan", font: "Arial", size: 28, bold: true })] }),
    new Paragraph({ children: [cellRun("For each test, write PASS / FAIL / PARTIAL and any notes.")] }),
    spacer,
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "1. Sign In & Startup", font: "Arial", size: 26, bold: true })] }),
    testTable([["1.1","Open app \u2014 sign-in screen appears"],["1.2","Sign in with Google \u2014 lands on main screen"],["1.3","Header shows logo + MyNaavi (white + teal)"],["1.4","Settings page shows V50 (build 85)"]]),
    spacer,
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "2. Tap-to-Talk", font: "Arial", size: 26, bold: true })] }),
    testTable([["2.1","Tap mic, say \u201CWhat\u2019s on my calendar today?\u201D \u2014 Naavi responds"],["2.2","Tap mic, say \u201CWhat\u2019s the weather?\u201D \u2014 Naavi responds"],["2.3","Tap mic, say \u201CRemember that my dentist is Dr. Smith\u201D \u2014 confirmed"],["2.4","Tap mic, say \u201CWhat do you know about me?\u201D \u2014 lists memories"],["2.5","Response appears as text on screen"],["2.6","Response is spoken aloud (TTS)"],["2.7","No \u201CSay yes to send\u201D in tap-to-talk text or voice"]]),
    spacer,
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "3. WhatsApp \u2014 Tap-to-Talk", font: "Arial", size: 26, bold: true })] }),
    testTable([["3.1","Send a WhatsApp to [name] saying hi \u2014 draft card appears"],["3.2","Draft shows correct recipient name and phone number"],["3.3","Draft shows correct message body"],["3.4","Tap Send \u2014 message sends"],["3.5","Message received on recipient\u2019s phone"],["3.6","No infinite loop after tapping Send"],["3.7","Sender name on WhatsApp \u2014 Robert or correct name?"]]),
    spacer,
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "4. WhatsApp \u2014 Hands-Free Voice Confirm", font: "Arial", size: 26, bold: true })] }),
    testTable([["4.1","Activate hands-free \u2014 hear \u201CI\u2019m listening\u201D"],["4.2","Say \u201CSend a WhatsApp to [name] saying hello\u201D \u2014 draft appears"],["4.3","Naavi speaks the draft summary"],["4.4","Wait 5 seconds, say \u201Cyes\u201D \u2014 message sends"],["4.5","Hear \u201CSent.\u201D spoken clearly (no clipping)"],["4.6","Message received on recipient\u2019s phone"],["4.7","Draft card updates to sent state"],["4.8","No infinite loop"]]),
    spacer,
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "5. Voice Edit (\u201CChange\u201D)", font: "Arial", size: 26, bold: true })] }),
    testTable([["5.1","After draft appears, say \u201Cchange\u201D \u2014 Naavi asks what to change"],["5.2","Say new message \u2014 draft updates with new body"],["5.3","Wait 5 seconds, say \u201Cyes\u201D \u2014 updated message sends"],["5.4","Say \u201Ccancel\u201D \u2014 draft cancelled, hear \u201COK, cancelled.\u201D"]]),
    spacer,
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "6. Voice Confirm \u2014 Edge Cases", font: "Arial", size: 26, bold: true })] }),
    testTable([["6.1","Say \u201Cyes\u201D immediately (before 5s) \u2014 what happens?"],["6.2","Say \u201Csend\u201D instead of \u201Cyes\u201D \u2014 does it work?"],["6.3","Say \u201Cgo ahead\u201D \u2014 does it work?"],["6.4","Say nothing for 30 seconds \u2014 auto-cancel + spoken message?"],["6.5","Say something random like \u201Cbanana\u201D \u2014 treated as edit?"]]),
    spacer,
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "7. Calendar", font: "Arial", size: 26, bold: true })] }),
    testTable([["7.1","What\u2019s on my calendar today? \u2014 lists events"],["7.2","Create an event called Lunch with Ali tomorrow at noon \u2014 event created"],["7.3","Verify event appears in Google Calendar"],["7.4","Delete the Lunch with Ali event \u2014 event deleted"],["7.5","What\u2019s my schedule for this week? \u2014 responds"]]),
    spacer,
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "8. Contacts & Lookup", font: "Arial", size: 26, bold: true })] }),
    testTable([["8.1","What\u2019s Wael\u2019s phone number? \u2014 finds from memory/contacts"],["8.2","Say a phone number \u2014 Naavi identifies the contact"],["8.3","Send a WhatsApp to [unknown name] \u2014 how does it handle?"]]),
    spacer,
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "9. Lists", font: "Arial", size: 26, bold: true })] }),
    testTable([["9.1","Create a list called Groceries \u2014 list created"],["9.2","Add milk and eggs to Groceries \u2014 items added"],["9.3","What\u2019s on my Groceries list? \u2014 reads items"],["9.4","Remove milk from Groceries \u2014 item removed"]]),
    spacer,
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "10. Google Tasks", font: "Arial", size: 26, bold: true })] }),
    testTable([["10.1","What are my tasks? \u2014 lists tasks from brief"],["10.2","Tasks appear in daily brief"]]),
    spacer,
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "11. Knowledge / Memory", font: "Arial", size: 26, bold: true })] }),
    testTable([["11.1","Remember that I take vitamin D every morning \u2014 saved"],["11.2","What do you remember about my health? \u2014 recalls"],["11.3","Forget that I take vitamin D \u2014 deleted"]]),
    spacer,
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "12. Navigation & Travel Time", font: "Arial", size: 26, bold: true })] }),
    testTable([["12.1","How long to drive to [destination]? \u2014 shows travel time"],["12.2","Travel time card appears on screen"]]),
    spacer,
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "13. Hands-Free Mode \u2014 General", font: "Arial", size: 26, bold: true })] }),
    testTable([["13.1","Tap hands-free button \u2014 hear \u201CI\u2019m listening\u201D"],["13.2","Say a question \u2014 Naavi responds, then resumes listening"],["13.3","Say \u201Cgoodbye\u201D \u2014 hands-free deactivates"],["13.4","Idle 60 seconds \u2014 pauses with \u201CTap Resume when you need me\u201D"],["13.5","Tap Resume \u2014 hands-free restarts"],["13.6","Multiple back-to-back commands \u2014 all handled"],["13.7","TTS and mic don\u2019t overlap"]]),
    spacer,
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "14. Push Notifications", font: "Arial", size: 26, bold: true })] }),
    testTable([["14.1","Receive a push notification"],["14.2","Tap notification \u2014 opens app"]]),
    spacer,
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "15. Settings", font: "Arial", size: 26, bold: true })] }),
    testTable([["15.1","Settings page loads"],["15.2","Version shows V50 (build 85)"],["15.3","Sign out works"]]),
    spacer,
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "16. Notes", font: "Arial", size: 26, bold: true })] }),
    testTable([["16.1","My Notes screen loads"],["16.2","Notes saved via \u201Cremember\u201D appear here"]]),
    spacer,
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Summary", font: "Arial", size: 26, bold: true })] }),
    makeTable([
      ["Area","Pass","Fail","Partial","Total"],
      ["Sign in","","","","4"],["Tap-to-talk","","","","7"],["WhatsApp tap","","","","7"],
      ["WhatsApp voice","","","","8"],["Voice edit","","","","4"],["Voice edge cases","","","","5"],
      ["Calendar","","","","5"],["Contacts","","","","3"],["Lists","","","","4"],
      ["Tasks","","","","2"],["Memory","","","","3"],["Navigation","","","","2"],
      ["Hands-free","","","","7"],["Push","","","","2"],["Settings","","","","3"],
      ["Notes","","","","2"],["TOTAL","","","","66"],
    ], [3000, 1200, 1200, 1200, 1200]),
  ]
}];

const doc = new Document({
  styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
  sections
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("C:\\Users\\waela\\OneDrive\\Desktop\\Naavi\\docs\\TEST_PLAN_V50_BUILD85.docx", buffer);
  console.log("Done - file saved");
});
