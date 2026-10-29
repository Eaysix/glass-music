import XCTest
final class GlassMusicUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false; XCUIDevice.shared.orientation = .portrait }
    override func tearDownWithError() throws { XCUIDevice.shared.orientation = .portrait }
    private func launch(resetAppearance: Bool = false) -> XCUIApplication {
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing-fixtures"] + (resetAppearance ? ["--ui-testing-reset-appearance"] : []); app.launch(); return app
    }
    private func startSong(_ app: XCUIApplication) {
        XCTAssertTrue(app.buttons["nav-library"].waitForExistence(timeout: 15))
        app.buttons["nav-library"].tap()
        let songs = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "play-song-"))
        XCTAssertTrue(songs.firstMatch.waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertEqual(songs.count, 2, app.debugDescription)
        songs.firstMatch.tap()
        XCTAssertTrue(app.buttons["Abrir reproductor"].waitForExistence(timeout: 10))
    }
    private func snapshot(_ app: XCUIApplication, _ title: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = title; attachment.lifetime = .keepAlways; add(attachment)
    }
    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<5 {
            let limit = app.buttons["Abrir reproductor"]
            if element.isHittable && (!limit.exists || !limit.isHittable || element.frame.maxY <= limit.frame.minY) { return }
            // Start within the scroll content, above the persistent player/dock.
            let player = app.buttons["Abrir reproductor"]
            let bottom = player.exists && player.isHittable ? player.frame.minY : app.frame.maxY - 100
            let startY = min(bottom - 30, app.frame.midY + 100)
            let endY = max(app.frame.minY + 100, startY - app.frame.height * 0.4)
            let origin = app.coordinate(withNormalizedOffset: .zero)
            origin.withOffset(CGVector(dx: app.frame.midX, dy: startY)).press(forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: app.frame.midX, dy: endY)))
        }
        XCTAssertTrue(element.isHittable, app.debugDescription)
    }
    private func assertDock(_ app: XCUIApplication) {
        let open = app.buttons["Abrir reproductor"]
        XCTAssertFalse(app.tabBars.firstMatch.exists, "Native tab bar must not duplicate the glass navigation")
        XCTAssertTrue(open.isHittable)
        let playerFrame = open.frame
        let screenFrame = app.frame
        for name in ["home", "library", "downloads", "sync", "settings"] {
            let button = app.buttons["nav-" + name]
            XCTAssertTrue(button.isHittable, "Navigation obscured: " + name)
            let frame = button.frame
            XCTAssertLessThanOrEqual(playerFrame.maxY, frame.minY + 1, "Mini player overlaps navigation")
            XCTAssertLessThanOrEqual(frame.maxY, screenFrame.maxY)
        }
    }
    func testOfflineLibraryAndPlayer() throws {
        let app = launch(); startSong(app)
        app.buttons["Abrir reproductor"].tap()
        XCTAssertTrue(app.buttons["Mostrar letra"].waitForExistence(timeout: 5))
        snapshot(app, "Glass Music · Portada")
        app.buttons["Mostrar letra"].tap()
        XCTAssertTrue(app.buttons["Editar letra"].exists)
        snapshot(app, "Glass Music · Letra")
        app.buttons["Cerrar reproductor"].tap()
        assertDock(app)
    }
    func testSeekingToEndResetsTimelineOnNextSong() throws {
        let app = launch(resetAppearance: true); startSong(app)
        app.buttons["Abrir reproductor"].tap()
        let timeline = app.sliders["Posición de reproducción"]
        XCTAssertTrue(timeline.waitForExistence(timeout: 5))
        // Synthetic fixtures last 16 seconds. Seek to the exact boundary.
        timeline.adjust(toNormalizedSliderPosition: 1)
        let advanced = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            app.staticTexts["Otro momento"].exists && app.staticTexts["player-elapsed"].label.hasPrefix("0:0")
        }, object: app)
        wait(for: [advanced], timeout: 10)
        // The fresh timeline must still accept a subsequent seek.
        timeline.adjust(toNormalizedSliderPosition: 0.5)
        let midpoint = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            ["0:07", "0:08", "0:09", "0:10"].contains(app.staticTexts["player-elapsed"].label)
        }, object: app)
        wait(for: [midpoint], timeout: 3)
        snapshot(app, "Glass Music · Barra reiniciada después de adelantar al final")
    }
    func testLocalSyncScreenDoesNotRequireAnAccount() throws {
        let app = launch()
        app.buttons["nav-sync"].tap()
        XCTAssertTrue(app.staticTexts["Tu música viaja por tu Wi-Fi"].exists)
        app.buttons["Vincular mi PC"].firstMatch.tap()
        XCTAssertTrue(app.textViews["Código de vinculación"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Cancelar"].exists)
    }
    func testPlayerLeavesAllNavigationAccessibleInPortraitAndLandscape() throws {
        let app = launch(resetAppearance: true); startSong(app)
        for name in ["home", "downloads", "sync", "settings", "library"] {
            app.buttons["nav-" + name].tap(); assertDock(app)
        }
        app.buttons["nav-home"].tap()
        let importButton = app.buttons["import-local-music"]
        reveal(importButton, in: app)
        XCTAssertLessThanOrEqual(importButton.frame.maxY, app.buttons["Abrir reproductor"].frame.minY + 1, "Last home action is covered by the player")
        snapshot(app, "Glass Music · Inicio y navegación")
        XCUIDevice.shared.orientation = .landscapeLeft
        assertDock(app)
        snapshot(app, "Glass Music · Navegación horizontal")
    }
    func testPersonalizationPersistsAndLargeHUDKeepsNavigationVisible() throws {
        let app = launch(resetAppearance: true); startSong(app)
        app.buttons["nav-settings"].tap()
        let name = app.textFields["profile-name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5)); name.tap(); name.typeText("Mi iPhone\n")
        let accent = app.buttons["accent-BDA9FA"]; reveal(accent, in: app); accent.tap()
        let large = app.segmentedControls["hud-size"].buttons["Grande"]; reveal(large, in: app); large.tap()
        assertDock(app)
        snapshot(app, "Glass Music · Personalización")
        app.terminate()
        app.launchArguments = ["--ui-testing-fixtures"]; app.launch()
        app.buttons["nav-settings"].tap()
        XCTAssertEqual(app.textFields["profile-name"].value as? String, "Mi iPhone")
        let selected = app.staticTexts["selected-accent"]; reveal(selected, in: app)
        XCTAssertEqual(selected.label, "#BDA9FA")
        reveal(app.segmentedControls["hud-size"], in: app)
        XCTAssertTrue(app.segmentedControls["hud-size"].buttons["Grande"].isSelected)
        assertDock(app)
    }
    func testLyricsMarkingAndLocalStatsAndPlaylistCreation() throws {
        let app = launch(resetAppearance: true); startSong(app)
        app.buttons["Abrir reproductor"].tap()
        let editor = app.buttons["Editar letra"]; reveal(editor, in: app); editor.tap()
        let text = app.textViews["Letra y tiempos LRC"]
        XCTAssertTrue(text.waitForExistence(timeout: 5)); text.tap()
        let title = app.staticTexts["lyrics-song-title"].label
        let old = text.value as? String ?? ""
        if old.isEmpty { text.typeText("Uno dos\nOtra línea") }
        app.segmentedControls.buttons["Palabras"].tap()
        XCTAssertEqual(app.staticTexts["lyrics-song-title"].label, title, "Editor must stay attached to its original song")
        let transport = app.buttons["lyrics-transport"]
        XCTAssertTrue(transport.waitForExistence(timeout: 5))
        if transport.label == "Reproducir" { transport.tap() }
        let seek = app.sliders["Escuchar desde"]
        if seek.exists { seek.adjust(toNormalizedSliderPosition: 0) }
        let mark = app.buttons["Marcar palabra y seguir"]
        XCTAssertTrue(mark.exists)
        if !mark.isEnabled { transport.tap() }
        mark.tap()
        snapshot(app, "Glass Music · Marcar palabras")
        app.buttons["Cancelar"].tap()
        app.buttons["Cerrar reproductor"].tap()
        app.buttons["nav-home"].tap()
        let stats = app.buttons["Tu música en números"]; reveal(stats, in: app); stats.tap()
        XCTAssertTrue(app.staticTexts["Tus 5 canciones más escuchadas"].waitForExistence(timeout: 5))
        snapshot(app, "Glass Music · Estadísticas")
        app.buttons["Listo"].tap()
        let create = app.buttons["Crear playlist local"]; reveal(create, in: app); create.tap()
        let name = app.textFields["Nombre de la playlist"]
        XCTAssertTrue(name.waitForExistence(timeout: 5)); name.tap(); name.typeText("Mi playlist")
        let selection = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "playlist-select-")).firstMatch
        selection.tap()
        snapshot(app, "Glass Music · Crear playlist")
        app.buttons["Guardar"].tap()
        XCTAssertTrue(app.buttons["nav-home"].waitForExistence(timeout: 5))
        let created = app.staticTexts["Mi playlist"].firstMatch; reveal(created, in: app); created.tap()
        let delete = app.buttons["Eliminar playlist"].firstMatch
        XCTAssertTrue(delete.waitForExistence(timeout: 5)); delete.tap()
        let namedConfirmation = app.buttons.matching(identifier: "confirm-delete-playlist").firstMatch
        let matches = app.buttons.matching(identifier: "Eliminar playlist")
        // Older system action sheets may expose only the action title.
        let confirm = namedConfirmation.exists ? namedConfirmation : matches.element(boundBy: max(0, matches.count - 1))
        XCTAssertTrue(confirm.waitForExistence(timeout: 5)); confirm.tap()
        let home = app.scrollViews["home-content"].firstMatch
        let returnedHome = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in home.exists && home.isHittable }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [returnedHome], timeout: 8), .completed)
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["nav-home"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Mi playlist"].exists, "Deleted playlists must stay deleted after restart")
        app.buttons["nav-downloads"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "play-song-")).firstMatch.waitForExistence(timeout: 5), "Deleting a playlist must preserve downloaded audio")
        snapshot(app, "Glass Music · Canciones conservadas al eliminar playlist")
    }

}
