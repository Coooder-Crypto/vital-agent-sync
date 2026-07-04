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

    func uploadCalendarSummary(_ summary: DailyCalendarSummary) async throws {
        try await post(summary, path: "/api/calendar/daily-summary")
    }

    private func post<T: Encodable>(_ payload: T, path: String) async throws {
        let body = try encoder.encode(payload)
        var request = URLRequest(url: endpoint(path))
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")

        let (_, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw GatewayError.invalidServerResponse(-1)
        }
        guard 200..<300 ~= httpResponse.statusCode else {
            throw GatewayError.invalidServerResponse(httpResponse.statusCode)
        }
    }

    private func endpoint(_ path: String) -> URL {
        let base = serverURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return URL(string: base + path)!
    }
}
