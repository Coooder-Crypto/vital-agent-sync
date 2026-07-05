import Foundation

final class GatewayAPIClient {
    private let serverURL: URL
    private let apiToken: String
    private let encoder: JSONEncoder

    init(serverURL: URL, apiToken: String) {
        self.serverURL = serverURL
        self.apiToken = apiToken
        self.encoder = JSONEncoder()
        self.encoder.outputFormatting = [.sortedKeys]
    }

    func uploadHealthSummary(_ summary: DailyHealthSummary) async throws {
        try await post(summary, path: "/api/health/daily-summary")
    }

    func uploadHealthSync(_ payload: HealthSyncPayload) async throws -> HealthSyncResponse {
        try await post(payload, path: "/health/sync")
    }

    func revokeDevice(deviceID: String) async throws -> DeviceRevokeResponse {
        struct EmptyPayload: Encodable {}
        return try await post(EmptyPayload(), path: "/devices/\(deviceID)/revoke")
    }

    static func confirmPairing(link: PairingLink, deviceName: String, acceptedScopes: [String]) async throws -> PairConfirmResponse {
        let payload = PairConfirmRequest(
            pairing_code: link.pairingCode,
            device_name: deviceName,
            device_platform: "ios",
            accepted_scopes: acceptedScopes
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]

        var request = URLRequest(url: endpoint(baseURL: link.serverURL, path: "/pair/confirm"))
        request.httpMethod = "POST"
        request.httpBody = try encoder.encode(payload)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch let error as URLError {
            throw GatewayError.fromURL(error)
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            throw GatewayError.invalidServerResponse(-1)
        }
        guard 200..<300 ~= httpResponse.statusCode else {
            throw GatewayError.invalidServerResponse(httpResponse.statusCode)
        }

        return try JSONDecoder().decode(PairConfirmResponse.self, from: data)
    }

    static func getPairingStatus(link: PairingLink) async throws -> PairingStatusResponse {
        var components = URLComponents(url: endpoint(baseURL: link.serverURL, path: "/pair/status/\(link.pairingCode)"), resolvingAgainstBaseURL: false)
        components?.percentEncodedQuery = nil
        guard let url = components?.url else {
            throw GatewayError.invalidPairingURL
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(from: url)
        } catch let error as URLError {
            throw GatewayError.fromURL(error)
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            throw GatewayError.invalidServerResponse(-1)
        }
        guard 200..<300 ~= httpResponse.statusCode else {
            throw GatewayError.invalidServerResponse(httpResponse.statusCode)
        }

        return try JSONDecoder().decode(PairingStatusResponse.self, from: data)
    }

    static func checkReceiver(serverURL: URL) async throws -> ReceiverHealthStatus {
        let url = endpoint(baseURL: serverURL, path: "/health/status")
        let request = URLRequest(url: url, timeoutInterval: 2)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch let error as URLError {
            throw GatewayError.fromURL(error)
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            throw GatewayError.invalidServerResponse(-1)
        }
        guard 200..<300 ~= httpResponse.statusCode else {
            throw GatewayError.invalidServerResponse(httpResponse.statusCode)
        }

        return try JSONDecoder().decode(ReceiverHealthStatus.self, from: data)
    }

    private func post<T: Encodable>(_ payload: T, path: String) async throws {
        let _: EmptyResponse = try await post(payload, path: path)
    }

    private func post<T: Encodable, R: Decodable>(_ payload: T, path: String) async throws -> R {
        let body = try encoder.encode(payload)
        var request = URLRequest(url: endpoint(path))
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch let error as URLError {
            throw GatewayError.fromURL(error)
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            throw GatewayError.invalidServerResponse(-1)
        }
        guard 200..<300 ~= httpResponse.statusCode else {
            throw GatewayError.invalidServerResponse(httpResponse.statusCode)
        }

        if R.self == EmptyResponse.self {
            return EmptyResponse() as! R
        }
        return try JSONDecoder().decode(R.self, from: data)
    }

    private func endpoint(_ path: String) -> URL {
        Self.endpoint(baseURL: serverURL, path: path)
    }

    private static func endpoint(baseURL: URL, path: String) -> URL {
        let base = baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return URL(string: base + path)!
    }
}

private struct EmptyResponse: Decodable {}
