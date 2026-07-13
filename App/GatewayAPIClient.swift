import Foundation

final class GatewayAPIClient {
    private let serverURL: URL
    private let apiToken: String
    private let directTransportPublicKey: String

    init(serverURL: URL, apiToken: String, directTransportPublicKey: String) {
        self.serverURL = serverURL
        self.apiToken = apiToken
        self.directTransportPublicKey = directTransportPublicKey
    }

    func uploadHealthSync(_ payload: HealthSyncPayload) async throws -> HealthSyncResponse {
        try await postDirect(
            DirectHealthSyncRequest(device_token: apiToken, payload: payload),
            purpose: .healthSync
        )
    }

    static func uploadRelayEnvelope(
        _ envelope: RelayEncryptedEnvelope,
        relayURL: URL,
        relayAccessToken: String,
        relayAPIToken: String?
    ) async throws -> RelayEnvelopePostResponse {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let body = try encoder.encode(envelope)
        var request = URLRequest(url: endpoint(baseURL: relayURL, path: "/v1/envelopes"))
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(relayAccessToken)", forHTTPHeaderField: "Authorization")
        if let relayAPIToken = relayAPIToken?.trimmingCharacters(in: .whitespacesAndNewlines),
           !relayAPIToken.isEmpty {
            request.setValue(relayAPIToken, forHTTPHeaderField: "X-HealthLink-Relay-API-Key")
        }

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
        return try JSONDecoder().decode(RelayEnvelopePostResponse.self, from: data)
    }

    func revokeDevice(deviceID: String) async throws -> DeviceRevokeResponse {
        try await postDirect(
            DirectDeviceRevokeRequest(device_token: apiToken, device_id: deviceID),
            purpose: .deviceRevoke
        )
    }

    static func confirmPairing(link: PairingLink, deviceName: String, acceptedScopes: [String]) async throws -> PairConfirmResponse {
        let payload = PairConfirmRequest(
            pairing_code: link.pairingCode,
            device_name: deviceName,
            device_platform: "ios",
            accepted_scopes: acceptedScopes
        )
        return try await postDirect(
            payload,
            purpose: .pairingConfirm,
            serverURL: link.serverURL,
            directTransportPublicKey: link.directTransportPublicKey
        )
    }

    static func getPairingStatus(link: PairingLink) async throws -> PairingStatusResponse {
        try await postDirect(
            DirectPairingStatusRequest(pairing_code: link.pairingCode),
            purpose: .pairingStatus,
            serverURL: link.serverURL,
            directTransportPublicKey: link.directTransportPublicKey
        )
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

    private func postDirect<T: Encodable, R: Decodable>(
        _ payload: T,
        purpose: DirectTransportPurpose
    ) async throws -> R {
        try await Self.postDirect(
            payload,
            purpose: purpose,
            serverURL: serverURL,
            directTransportPublicKey: directTransportPublicKey
        )
    }

    private static func postDirect<T: Encodable, R: Decodable>(
        _ payload: T,
        purpose: DirectTransportPurpose,
        serverURL: URL,
        directTransportPublicKey: String
    ) async throws -> R {
        let exchange = try DirectTransportCrypto.makeRequest(
            purpose: purpose,
            payload: payload,
            receiverPublicKey: directTransportPublicKey
        )
        var request = URLRequest(url: endpoint(baseURL: serverURL, path: "/v1/direct"))
        request.httpMethod = "POST"
        request.httpBody = try canonicalJSONData(exchange.envelope)
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
        let responseEnvelope = try JSONDecoder().decode(DirectEncryptedEnvelope.self, from: data)
        return try DirectTransportCrypto.decryptResponse(responseEnvelope, exchange: exchange, as: R.self)
    }

    private static func endpoint(baseURL: URL, path: String) -> URL {
        let base = baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return URL(string: base + path)!
    }
}

private struct DirectPairingStatusRequest: Encodable {
    let pairing_code: String
}

private struct DirectHealthSyncRequest: Encodable {
    let device_token: String
    let payload: HealthSyncPayload
}

private struct DirectDeviceRevokeRequest: Encodable {
    let device_token: String
    let device_id: String
}
