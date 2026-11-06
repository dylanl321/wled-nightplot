import Foundation

/// Operator-facing strings for saving a Prop to Nightplot (Req 12.7, 15.1, 15.2, 15.3).
///
/// Vocabulary follows `AGENTS.md`: Prop, Lights, and Segments keep their Nightplot meanings, and
/// "string" means a physical light string. Controls and statuses about saving never use the words
/// Attach, Apply, Preview, or Hardware Done. The only places those words may appear are the two
/// negating statements in `negatingStatements`; a wording scan checks every other string.
public enum Wording {
    // MARK: Controls

    /// The confirm control on the export screen.
    public static let saveControl = "Save to Nightplot"
    /// Title of the front-on check screen. It is not called "Preview" (Req 15.2).
    public static let checkScreenTitle = "Check the drawing"
    public static let saveAsNewPropControl = "Save as new Prop"
    public static let cancelControl = "Cancel"
    public static let retryCheckControl = "Retry check"
    public static let continueControl = "Continue"

    // MARK: Honesty statements

    /// Always shown on the same screen as `saveControl` (Req 15.3). Negates the banned words.
    public static let honestyStatement =
        "Saving puts this Prop in Nightplot as a design. It does not attach it to a controller, does not Apply, and does not light anything."

    /// Confirmed-save statement that follows the server's message (Req 12.7).
    public static let confirmedStatement =
        "Saved in Nightplot as a design. It is not attached to a controller, and nothing was sent to a controller."

    // MARK: Progress

    public static let sending = "Saving to Nightplot…"
    public static let readingBack = "Checking what Nightplot saved…"

    // MARK: Results

    public static let didNotReach = "The save did not reach the server."
    public static let goneFromYard = "This Prop is no longer in the yard."
    public static let createdWithoutId = "Saved, but not confirmed: the server did not return a Prop id."
    public static let readbackFailed = "Saved, but not confirmed: the check could not be completed."
    public static let propIdNotRecorded =
        "This phone could not record the Prop id. Saving again may create a second Prop."
    public static let layoutNotPrepared = "This Prop could not be prepared for saving."
    public static let draftNotSaved = "This draft was not saved. Your changes are still open."

    // MARK: Parts named by a readback mismatch (Req 12.6)

    public static let partPropMissing = "the Prop"
    public static let partLabel = "the label"
    public static let partStringIds = "the string ids"
    public static let partEdgeIds = "the edge ids"

    /// "Saved, but not confirmed: <part> came back different." The missing-Prop case reads naturally
    /// with the same sentence, so all four parts share one shape.
    public static func notConfirmedMismatch(part: String) -> String {
        "Saved, but not confirmed: \(part) came back different."
    }

    /// Server `message` when present, otherwise `HTTP <status>` (Req 12.8).
    public static func rejected(message: String?, status: Int) -> String {
        if let message, !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return message
        }
        return "HTTP \(status)"
    }

    /// Confirmed result: the server's message (if any), then the confirmed statement (Req 12.7).
    public static func confirmed(serverMessage: String?) -> String {
        if let serverMessage, !serverMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return serverMessage + "\n" + confirmedStatement
        }
        return confirmedStatement
    }

    // MARK: Scan support

    /// The two statements allowed to contain a banned word. Both only negate it.
    public static let negatingStatements: [String] = [honestyStatement, confirmedStatement]

    /// Every save-related string that is not a negating statement. None may contain a banned word.
    public static let savingStrings: [String] = [
        saveControl, checkScreenTitle, saveAsNewPropControl, cancelControl, retryCheckControl,
        continueControl, sending, readingBack, didNotReach, goneFromYard, createdWithoutId,
        readbackFailed, propIdNotRecorded, layoutNotPrepared, draftNotSaved,
        partPropMissing, partLabel, partStringIds, partEdgeIds,
        notConfirmedMismatch(part: partLabel),
        notConfirmedMismatch(part: partStringIds),
        notConfirmedMismatch(part: partEdgeIds),
        notConfirmedMismatch(part: partPropMissing),
        rejected(message: nil, status: 400),
    ]

    /// Words that must not appear on a saving control, status, or confirmation (Req 15.2).
    public static let bannedWords: [String] = ["Attach", "Apply", "Preview", "Hardware Done"]
}
