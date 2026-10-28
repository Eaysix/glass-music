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
        for _ in 0..<5 { if element.isHittable { return }; app.swipeUp() }
        XCTAssertTrue(element.isHittable, app.debugDescription)
    }
    private func assertDock(_ app: XCUIApplication) {
        let open = app.buttons["Abrir reproductor"]
        XCTAssertFalse(app.tabBars.firstMatch.exists, "Native tab bar must not duplicate the glass navigation")
        XCTAssertTrue(open.isHittable)
        for name in ["home", "library", "downloads", "sync", "settings"] {
            let button = app.buttons["nav-" + name]
            XCTAssertTrue(button.isHittable, "Navigation obscured: " + name)
            XCTAssertLessThanOrEqual(open.frame.maxY, button.frame.minY + 1, "Mini player overlaps navigation")
            XCTAssertLessThanOrEqual(button.frame.maxY, app.frame.maxY)
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
}
