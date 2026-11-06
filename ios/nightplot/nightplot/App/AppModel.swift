import Foundation
import NightplotCore
import Observation

/// What the operator has selected on the capture screen. Session state, never saved.
enum CaptureSelection: Equatable {
    case point(String)
    case run(String)
}

/// Whether the phone can reach the Nightplot server. "Not configured" sends nothing (Req 11.8).
enum ServerStatus: Equatable {
    case notConfigured
    case reachable
    case unreachable(UnreachableReason)
}

/// What happened to an edit.
enum EditOutcome: Equatable {
    /// Applied. `notice` is set when the operator needs to be told something.
    case applied(notice: EditRefusal?)
    /// Refused. The document and history are unchanged.
    case refused(EditRefusal)
    /// Place Point was tapped while it was disabled. Nothing happened (Req 3.8).
    case ignored
}

/// Where the export flow is (Req 12.2).
enum ExportFlowState: Equatable {
    case idle
    /// The gate found problems. Nothing was sent.
    case blocked([ExportBlock])
    /// Some points are far off the front plane. Offers Continue and Cancel.
    case warnNotFlat(offPlaneCount: Int)
    /// The layout could not be built from a document the gate passed.
    case layoutNotPrepared
    case saving
    case finished(SaveState)
}

@MainActor
@Observable
final class AppModel {
    // MARK: - Open capture

    /// The open capture, or nil on the draft list.
    private(set) var document: CaptureDocument?
    private(set) var history = UndoHistory()
    private(set) var activeStringId: String = ""
    private(set) var darkJump = false
    var selection: CaptureSelection?
    private(set) var counts = CaptureCounts()

    /// Latest tracking state and surface hit, written by the AR layer.
    var tracking: TrackingStatus = .notAvailable
    var currentHit: SurfaceHit?
    /// True when the open Capture has points but no saved AR world map. Set by the AR layer.
    /// The Capture can be viewed and exported, but no point can be placed in AR.
    var worldMapMissing = false

    // MARK: - Drafts

    private(set) var drafts: [DraftListEntry] = []
    /// True after a failed draft write until the next write succeeds (Req 13.9).
    private(set) var draftSaveFailed = false

    var draftSaveMessage: String? { draftSaveFailed ? Wording.draftNotSaved : nil }

    // MARK: - Server

    private(set) var serverStatus: ServerStatus = .notConfigured
    private(set) var isCheckingServer = false
    /// Nil until a list has been read. Unknown is not empty.
    private(set) var ledProducts: [LedProductSummary]?
    var addressHost = ""
    var addressPortText = String(ServerAddressInput.defaultPort)
    private(set) var addressError: AddressError?

    // MARK: - Server discovery (Find)

    /// The Find flow's state, read by the server settings screen (Req 11.17 to 11.23).
    private(set) var findState: FindState = .idle
    /// A short note about the server status, e.g. "Found automatically. You can change it."
    /// Cleared on the next save or recheck. Set only when the first-launch auto-find saves.
    private(set) var serverNote: String?

    /// True while a browse-and-probe round is running (Req 11.25). Capture stays usable.
    var isFinding: Bool {
        if case .browsing = findState { return true }
        return false
    }

    /// The resolved rows from the last Find, for the settings screen to list (Req 11.19 to 11.21).
    var foundServers: [FoundServer] {
        if case .done(let found, _) = findState { return found }
        return []
    }

    /// True when the last browse was refused because Local Network permission is denied.
    /// The screen shows the Local Network hint and does not claim no server exists (Req 11.23).
    var localNetworkDenied: Bool {
        if case .localNetworkDenied = findState { return true }
        return false
    }

    // MARK: - Export

    private(set) var exportFlow: ExportFlowState = .idle
    private(set) var propIdNotRecorded = false

    // MARK: - Internals

    @ObservationIgnored private let environment: AppEnvironment
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var serverCheckGeneration = 0
    @ObservationIgnored private var didLaunch = false
    @ObservationIgnored private var saveFlow: SaveFlow?
    @ObservationIgnored private var lastRequest: PropSaveRequest?

    init(environment: AppEnvironment) {
        self.environment = environment
    }

    // MARK: - Derived state

    var canUndo: Bool { history.canUndo }
    var canRedo: Bool { history.canRedo }

    var canPlacePoint: Bool {
        !worldMapMissing && placePointEnabled(tracking: tracking, hit: currentHit)
    }

    var darkJumpEnabled: Bool {
        guard let document else { return false }
        return CaptureEditor.darkJumpEnabled(document: document, activeStringId: activeStringId)
    }

    var closeLoopEnabled: Bool {
        guard let document else { return false }
        return CaptureEditor.closeLoopEnabled(
            document: document, activeStringId: activeStringId, hit: currentHit)
    }

    /// Trace unless the operator accepted a spiral (Req 12.1).
    var exportPath: ExportPath {
        guard let spiral = document?.spiral, spiral.accepted else { return .trace }
        return spiral.keepMeasuredWraps ? .spiralMeasured : .spiralMeanGap
    }

    // MARK: - Launch and server address

    /// Pre-fills the address fields and calls `health()` once when an address is saved.
    /// With no saved address it shows "not configured" and sends nothing (Req 11.5, 11.8).
    func launch() async {
        guard !didLaunch else { return }
        didLaunch = true
        await refreshDrafts()
        guard let saved = environment.addressStore.load() else {
            // No saved address: browse for a server without operator action (Req 11.19).
            // No HTTP is sent unless a Server_Advert resolves (Req 11.9, 11.22).
            await findServers(auto: true)
            return
        }
        addressHost = saved.host
        addressPortText = String(saved.port)
        await checkServer(saved)
    }

    /// Validates the fields. A valid address is stored and checked; an invalid one is not (Req 11.6).
    func saveAddress() async {
        serverNote = nil
        switch ServerAddressInput.validate(host: addressHost, portText: addressPortText) {
        case .failure(let error):
            addressError = error
        case .success(let address):
            addressError = nil
            environment.addressStore.save(address)
            await checkServer(address)
        }
    }

    /// Checks the saved address again. Does nothing when none is saved.
    func recheckServer() async {
        serverNote = nil
        guard let address = environment.addressStore.load() else {
            serverStatus = .notConfigured
            return
        }
        await checkServer(address)
    }

    // MARK: - Server discovery (Find)

    /// Browses the LAN for `_nightplot._tcp` adverts, probes each resolved candidate with
    /// `GET /health`, and records the result in `findState` for the settings screen.
    ///
    /// Req 11.9 reconciliation: no HTTP is sent when the browse resolves nothing (`candidates`
    /// is empty, so zero probes run). When the browse resolves one or more adverts, the app
    /// sends `GET /health` to those LAN hosts only — the single allowed exception during a
    /// browse. These probes use `ServerRoute.health`, so Req 12.10 still holds.
    ///
    /// With `auto: true` (first launch) a single usable row is saved through the same path as
    /// `saveAddress` and the status becomes reachable with a found-automatically note. Zero or
    /// two-plus usable rows save nothing and keep the status not configured, with the resolved
    /// rows kept for the screen. A manual Find (`auto: false`) never auto-saves (Req 11.20, 11.21).
    func findServers(auto: Bool) async {
        serverNote = nil
        findState = .browsing
        let outcome = await environment.browser.browse(window: ServerDiscovery.browseWindow)
        switch outcome {
        case .permissionDenied:
            // Unknown is not empty: a denied permission is distinct from "no server" (Req 11.23).
            findState = .localNetworkDenied
        case .results(let raw):
            let candidates = ServerDiscovery.candidates(raw)
            // Browse resolved nothing: no probe is sent (Req 11.9, 11.22).
            let found = await probe(candidates)
            let autoSaved = auto ? autoSaveIfSingle(found) : nil
            findState = .done(found: found, autoSaved: autoSaved)
        }
    }

    /// Probes each resolved candidate with `GET /health` concurrently, each with its own 5 s
    /// limit inside `ServerClient.health()`. Results are returned in the candidate order.
    private func probe(_ candidates: [AdvertisedServer]) async -> [FoundServer] {
        guard !candidates.isEmpty else { return [] }
        let transport = environment.transport
        return await withTaskGroup(of: (Int, FoundServer).self) { group in
            for (index, server) in candidates.enumerated() {
                group.addTask {
                    let client = ServerClient(
                        address: ServerAddress(host: server.host, port: server.port),
                        transport: transport)
                    let health = await client.health()
                    return (index, FoundServer(server: server, health: health))
                }
            }
            var byIndex: [Int: FoundServer] = [:]
            for await (index, found) in group { byIndex[index] = found }
            return candidates.indices.compactMap { byIndex[$0] }
        }
    }

    /// Saves the one usable row when exactly one is usable, through the same validation and
    /// check path as a typed address. Returns the saved address, or nil when zero or two-plus
    /// rows are usable (Req 11.18, 11.20, 11.21).
    private func autoSaveIfSingle(_ found: [FoundServer]) -> ServerAddress? {
        guard let address = ServerDiscovery.autoPick(found) else { return nil }
        environment.addressStore.save(address)
        addressHost = address.host
        addressPortText = String(address.port)
        addressError = nil
        serverStatus = .reachable
        serverNote = Self.foundAutomaticallyNote
        return address
    }

    /// Saves a row the operator chose on the settings screen, through the typed-address
    /// validation and health check (Req 11.18). Used by the Find UI (task 23.3).
    func useFoundServer(_ server: AdvertisedServer) async {
        serverNote = nil
        switch ServerAddressInput.validate(host: server.host, portText: String(server.port)) {
        case .failure(let error):
            addressError = error
        case .success(let address):
            addressError = nil
            environment.addressStore.save(address)
            addressHost = address.host
            addressPortText = String(address.port)
            await checkServer(address)
        }
    }

    private func checkServer(_ address: ServerAddress) async {
        serverCheckGeneration += 1
        let generation = serverCheckGeneration
        isCheckingServer = true
        let client = environment.client(for: address)
        let result = await client.health()
        // A newer check or address owns the status now.
        guard generation == serverCheckGeneration else { return }
        switch result {
        case .reachable:
            serverStatus = .reachable
            let products = await client.ledProducts()
            guard generation == serverCheckGeneration else { return }
            if case .products(let list) = products { ledProducts = list }
        case .unreachable(let reason):
            serverStatus = .unreachable(reason)
        }
        isCheckingServer = false
    }

    // MARK: - Drafts

    func refreshDrafts() async {
        drafts = await environment.draftStore.list()
    }

    /// Starts a new capture and saves it as a draft.
    func newCapture() {
        open(CaptureDocument.new(draftId: environment.newDraftId(), now: environment.now()))
        scheduleSave()
    }

    /// Opens a draft. Returns the reason it could not be opened, if any (Req 13.6).
    @discardableResult
    func openDraft(_ id: UUID) async -> DraftDecodeError? {
        switch await environment.draftStore.load(id) {
        case .success(let loaded):
            open(loaded)
            return nil
        case .failure(let error):
            return error
        }
    }

    /// Saves the open draft now, then returns to the list.
    func closeCapture() async {
        _ = await flushSave()
        document = nil
        resetSession()
        await refreshDrafts()
    }

    /// Deletes a draft file. Sends no request (Req 13.7).
    func deleteDraft(_ id: UUID) async {
        if document?.draftId == id {
            saveTask?.cancel()
            saveTask = nil
            document = nil
            resetSession()
        }
        try? await environment.draftStore.delete(id)
        await refreshDrafts()
    }

    private func open(_ opened: CaptureDocument) {
        saveTask?.cancel()
        saveTask = nil
        document = opened
        history = UndoHistory()
        activeStringId = opened.capture.strings.first?.id ?? ""
        darkJump = false
        selection = nil
        draftSaveFailed = false
        exportFlow = .idle
        propIdNotRecorded = false
        saveFlow = nil
        lastRequest = nil
        recomputeCounts()
    }

    private func resetSession() {
        history = UndoHistory()
        activeStringId = ""
        darkJump = false
        selection = nil
        counts = CaptureCounts()
        exportFlow = .idle
        propIdNotRecorded = false
        saveFlow = nil
        lastRequest = nil
    }

    // MARK: - Editing

    /// Runs one edit. A success records an undo step and saves the draft. A refusal changes nothing.
    @discardableResult
    func perform(_ edit: CaptureEdit) -> EditOutcome {
        guard let document else { return .refused(.unknownTarget) }
        // Place Point does nothing while it is disabled (Req 3.8).
        if case .placePoint(let hit, _) = edit,
            worldMapMissing || !placePointEnabled(tracking: tracking, hit: hit)
        {
            return .ignored
        }
        let newAnchorId = environment.newAnchorId
        switch CaptureEditor.apply(
            edit, to: document, activeStringId: activeStringId, newAnchorId: { newAnchorId() })
        {
        case .failure(let refusal):
            return .refused(refusal)
        case .success(let result):
            history.record(before: document.capture)
            self.document = result.document
            activeStringId = result.activeStringId
            if Self.isAppend(edit) { darkJump = false }
            changed()
            return .applied(notice: result.notice)
        }
    }

    func undo() {
        guard let document, let previous = history.undo(current: document.capture) else { return }
        restore(previous)
    }

    func redo() {
        guard let document, let next = history.redo(current: document.capture) else { return }
        restore(next)
    }

    private func restore(_ capture: Capture) {
        guard var doc = document else { return }
        doc.capture = capture
        document = doc
        if !capture.strings.contains(where: { $0.id == activeStringId }) {
            activeStringId = capture.strings.first?.id ?? ""
        }
        changed()
    }

    func setActiveString(_ id: String) {
        guard let document, document.capture.strings.contains(where: { $0.id == id }) else { return }
        activeStringId = id
        if !darkJumpEnabled { darkJump = false }
    }

    /// Dark Jump is session state. It cannot be on while the active string has no points (Req 4.6).
    func setDarkJump(_ on: Bool) {
        darkJump = on && darkJumpEnabled
    }

    private static func isAppend(_ edit: CaptureEdit) -> Bool {
        switch edit {
        case .placePoint, .reusePoint, .closeLoop: return true
        default: return false
        }
    }

    // MARK: - Changes that Undo does not touch

    /// Applies a change to the document outside the undo history, then saves the draft.
    func updateWithoutHistory(_ change: (inout CaptureDocument) -> Void) {
        guard var doc = document else { return }
        change(&doc)
        document = doc
        changed()
    }

    func markAnchorsLost(_ anchorIds: some Sequence<String>) {
        guard let document else { return }
        self.document = document.markAnchorsLost(anchorIds)
        changed()
    }

    /// An anchor moved. Updates the point, with no undo step.
    func anchorMoved(anchorId: String, position: Vec3) {
        guard let document else { return }
        self.document = CaptureEditor.anchorMoved(document, anchorId: anchorId, position: position)
        changed()
    }

    func setFlat(_ flat: Bool) {
        updateWithoutHistory { $0.flat = flat }
    }

    func setDepthMode(_ mode: DepthMode?) {
        updateWithoutHistory { $0.depthMode = mode }
    }

    func updateSpiral(_ change: (inout SpiralState) -> Void) {
        updateWithoutHistory { change(&$0.spiral) }
    }

    func setPropId(_ id: String?) {
        updateWithoutHistory { $0.propId = id }
    }

    /// Recounts, drops a selection that no longer exists, stamps the edit time, and saves.
    private func changed() {
        guard var doc = document else { return }
        doc.editedAtMs = Self.milliseconds(environment.now())
        document = doc
        if !darkJumpEnabled { darkJump = false }
        dropStaleSelection()
        recomputeCounts()
        scheduleSave()
    }

    private func recomputeCounts() {
        counts = document.map(CaptureCounter.counts) ?? CaptureCounts()
    }

    private func dropStaleSelection() {
        guard let document, let selection else { return }
        switch selection {
        case .point(let id):
            if !document.capture.points.contains(where: { $0.id == id }) { self.selection = nil }
        case .run(let id):
            if !document.capture.strings.contains(where: { $0.runs.contains { $0.id == id } }) {
                self.selection = nil
            }
        }
    }

    private static func milliseconds(_ date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1000).rounded(.down))
    }

    /// Shown when the first-launch auto-find saved a single healthy server (Req 11.20).
    static let foundAutomaticallyNote = "Found automatically. You can change it."

    // MARK: - Saving the draft

    /// Writes the draft once, 200 ms after the first change in a burst. Later changes in the
    /// window are included because the write reads the latest document (Req 13.1).
    private func scheduleSave() {
        guard saveTask == nil else { return }
        let clock = environment.clock
        saveTask = Task { [weak self] in
            try? await clock.sleep(for: AppEnvironment.saveCoalescing)
            guard !Task.isCancelled, let self else { return }
            self.saveTask = nil
            _ = await self.writeDraft()
        }
    }

    /// Writes the draft now. Returns whether the write succeeded.
    @discardableResult
    func flushSave() async -> Bool {
        saveTask?.cancel()
        saveTask = nil
        return await writeDraft()
    }

    private func writeDraft() async -> Bool {
        guard let doc = document else { return true }
        switch await environment.draftStore.save(doc) {
        case .success:
            draftSaveFailed = false
            return true
        case .failure:
            // The document stays open in memory. The next edit schedules another try (Req 13.9).
            draftSaveFailed = true
            return false
        }
    }

    // MARK: - Export

    /// Gate check, then the not-flat warning, then export and save (Req 12.2).
    func beginExport() async {
        guard let document else { return }
        switch ExportGate.check(document, path: exportPath) {
        case .blocked(let blocks):
            exportFlow = .blocked(blocks)
        case .warnNotFlat(let count):
            exportFlow = .warnNotFlat(offPlaneCount: count)
        case .ready:
            await exportAndSave()
        }
    }

    /// Continue from the not-flat warning.
    func continueExport() async {
        guard case .warnNotFlat = exportFlow else { return }
        await exportAndSave()
    }

    /// Cancel from the not-flat warning, or dismiss a result.
    func cancelExport() {
        if case .saving = exportFlow { return }
        exportFlow = .idle
    }

    /// Props on the server whose layout could not be decoded, by name (Req 14.7).
    /// Empty when no address is saved or the request fails; nothing is sent without an address.
    func unreadableRemoteProps() async -> [RemotePropError] {
        guard let address = environment.addressStore.load() else { return [] }
        let results = await environment.client(for: address).props()
        return results.compactMap { result in
            if case .failure(let error) = result { return error }
            return nil
        }
    }

    /// Reads back again after "Saved, but not confirmed". Sends only the readback GET.
    func retryReadback() async {
        guard let document, let propId = document.propId, let request = lastRequest,
            let flow = flowForSave()
        else { return }
        exportFlow = .saving
        let state = await flow.retryReadback(propId: propId, expected: request)
        await finishExport(flow, state)
    }

    /// After "no longer in the yard": clears the stored id and creates a new Prop.
    func saveAsNewProp() async {
        guard let request = lastRequest, let flow = flowForSave() else { return }
        exportFlow = .saving
        let state = await flow.saveAsNew(request)
        await finishExport(flow, state)
    }

    private func exportAndSave() async {
        guard let document else { return }
        guard case .success(let exported) = LayoutExporter.export(document, path: exportPath) else {
            exportFlow = .layoutNotPrepared
            return
        }
        lastRequest = exported.request
        guard let flow = flowForSave() else {
            exportFlow = .finished(.didNotReach)
            return
        }
        exportFlow = .saving
        let state = await flow.save(exported.request, storedPropId: document.propId)
        await finishExport(flow, state)
    }

    private func finishExport(_ flow: SaveFlow, _ state: SaveState) async {
        propIdNotRecorded = await flow.propIdNotRecorded
        exportFlow = .finished(state)
    }

    /// A save flow on the saved address, or nil when none is saved (nothing is sent).
    private func flowForSave() -> SaveFlow? {
        guard let address = environment.addressStore.load() else { return nil }
        let flow = SaveFlow(
            client: environment.client(for: address),
            persistPropId: { [weak self] id in await self?.persistPropId(id) ?? false })
        saveFlow = flow
        return flow
    }

    /// Writes the id onto the document and the draft file before the readback starts.
    private func persistPropId(_ id: String?) async -> Bool {
        guard document != nil else { return false }
        setPropId(id)
        return await flushSave()
    }
}
