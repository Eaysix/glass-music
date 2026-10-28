import Foundation
import Security

final class DeviceKeychain {
    private static func query(_ server: String) -> [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.eaysix.glassmusic.link", kSecAttrAccount as String: server] }
    static func save(_ token: String, for server: String) throws {
        let base = query(server)
        let values: [String: Any] = [kSecValueData as String: Data(token.utf8), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let result = SecItemUpdate(base as CFDictionary, values as CFDictionary)
        if result == errSecItemNotFound {
            guard SecItemAdd(base.merging(values) { _, new in new } as CFDictionary, nil) == errSecSuccess else { throw AppError.message("No se pudo guardar la vinculación de forma segura.") }; return
        }
        guard result == errSecSuccess else { throw AppError.message("No se pudo actualizar la vinculación.") }
    }
    static func read(_ server: String) throws -> String {
        var q = query(server); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &value) == errSecSuccess, let data = value as? Data, let token = String(data: data, encoding: .utf8) else { throw AppError.message("Vuelve a vincular este iPhone con tu PC.") }
        return token
    }
    static func remove(_ server: String) { SecItemDelete(query(server) as CFDictionary) }
}
final class CertificatePin: NSObject, URLSessionDelegate, URLSessionTaskDelegate {
    let host: String
    let fingerprint: String
    let port: Int
    init(host: String, fingerprint: String, port: Int) { self.host = host; self.fingerprint = fingerprint.lowercased(); self.port = port }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              challenge.protectionSpace.host == host,
              let trust = challenge.protectionSpace.serverTrust,
              let certificates = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let leaf = certificates.first,
              digest(SecCertificateCopyData(leaf) as Data) == fingerprint else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        // The exact certificate is trusted once via the PC's QR, never an arbitrary self-signed server.
        completionHandler(.useCredential, URLCredential(trust: trust))
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard request.url?.scheme == "https", request.url?.host == host, (request.url?.port ?? 443) == port else { completionHandler(nil); return }
        completionHandler(request)
    }
}
final class LANClient {
    let link: Link
    private let token: String?
    private let session: URLSession
    init(link: Link, token: String?) {
        self.link = link; self.token = token
        let config = URLSessionConfiguration.ephemeral
        config.allowsCellularAccess = false
        config.allowsExpensiveNetworkAccess = false
        config.allowsConstrainedNetworkAccess = false
        config.waitsForConnectivity = false
        config.timeoutIntervalForRequest = 25
        config.timeoutIntervalForResource = 1800
        config.urlCache = nil
        config.httpCookieStorage = nil
        session = URLSession(configuration: config, delegate: CertificatePin(host: link.host, fingerprint: link.fingerprint, port: link.port), delegateQueue: nil)
    }
    deinit { session.invalidateAndCancel() }
    private func request(_ path: String, body: Data? = nil) -> URLRequest {
        var request = URLRequest(url: link.baseURL.appendingPathComponent("v1/" + path))
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.allowsCellularAccess = false
        if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let body { request.httpMethod = "POST"; request.httpBody = body; request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        return request
    }
    private func verify(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            if code == 401 || code == 403 { throw AppError.message("La PC rechazó la vinculación. Genera un QR nuevo.") }
            if code == 404 { throw AppError.message("El archivo ya no está disponible en la PC.") }
            throw AppError.message("La PC no pudo completar la solicitud (\(code)).")
        }
    }
    func json<T: Decodable>(_ path: String, body: Data? = nil) async throws -> T {
        let (data, response) = try await session.data(for: request(path, body: body)); try verify(response)
        return try JSONDecoder().decode(T.self, from: data)
    }
    func image(_ path: String) async throws -> Data { let (data, response) = try await session.data(for: request(path)); try verify(response); guard data.count <= 20 * 1024 * 1024 else { throw AppError.message("La portada es demasiado grande.") }; return data }
    func audio(_ song: Song, resumeFile: URL) async throws -> URL {
        do {
            let result: (URL, URLResponse)
            if let resume = try? Data(contentsOf: resumeFile) { result = try await session.download(resumeFrom: resume) }
            else {
                var req = request("file/" + song.id)
                if let revision = song.fileRevision { req.setValue("\"\(revision)\"", forHTTPHeaderField: "If-Match") }
                result = try await session.download(for: req)
            }
            let (temporary, response) = result
            try verify(response)
            let destination = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try FileManager.default.moveItem(at: temporary, to: destination)
            try? FileManager.default.removeItem(at: resumeFile)
            return destination
        } catch {
            if let resume = (error as NSError).userInfo[NSURLSessionDownloadTaskResumeData] as? Data { try? resume.write(to: resumeFile, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
            else { try? FileManager.default.removeItem(at: resumeFile) }
            throw error
        }
    }
    static func pair(_ code: PairingCode, name: String) async throws -> Link {
        let temporary = Link(serverId: code.serverId, host: code.host, port: code.port, fingerprint: code.fingerprint, deviceId: "")
        let client = LANClient(link: temporary, token: nil)
        let payload = try JSONSerialization.data(withJSONObject: ["secret": code.secret, "deviceName": name])
        let response: PairResponse = try await client.json("pair", body: payload)
        guard response.serverId == code.serverId else { throw AppError.message("La identidad de la PC no coincide con el QR.") }
        try DeviceKeychain.save(response.token, for: response.serverId)
        return Link(serverId: response.serverId, host: code.host, port: code.port, fingerprint: code.fingerprint, deviceId: response.deviceId)
    }
}
