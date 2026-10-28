import XCTest
final class GlassMusicUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    func testOfflineLibraryAndPlayer() throws {
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing-fixtures"]; app.launch()
        XCTAssertTrue(app.tabBars.buttons["Biblioteca"].waitForExistence(timeout: 15))
        app.tabBars.buttons["Biblioteca"].tap()
        let songs = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "play-song-"))
        XCTAssertTrue(songs.firstMatch.waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertEqual(songs.count, 2, app.debugDescription)
        songs.firstMatch.tap()
        XCTAssertTrue(app.buttons["Abrir reproductor"].waitForExistence(timeout: 10))
        app.buttons["Abrir reproductor"].tap()
        XCTAssertTrue(app.buttons["Mostrar letra"].waitForExistence(timeout: 5))
        app.buttons["Mostrar letra"].tap()
        XCTAssertTrue(app.buttons["Editar letra"].exists)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "Glass Music iPhone"; attachment.lifetime = .keepAlways; add(attachment)
    }
    func testLocalSyncScreenDoesNotRequireAnAccount() throws {
        let app = XCUIApplication(); app.launch()
        app.tabBars.buttons["Sincronizar"].tap()
        XCTAssertTrue(app.staticTexts["Tu música viaja por tu Wi-Fi"].exists)
        app.buttons["Vincular mi PC"].firstMatch.tap()
        XCTAssertTrue(app.textViews["Código de vinculación"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Cancelar"].exists)
    }
}
