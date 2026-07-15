import Foundation

@main
struct VitalAgentIOSRelayCryptoFixture {
    static func main() throws {
        guard CommandLine.arguments.count == 3 else {
            throw FixtureError.usage
        }
        let decoder = JSONDecoder()
        let onboarding = try decoder.decode(
            RelayOnboardingPayload.self,
            from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
        )
        let payload = try decoder.decode(
            HealthSyncPayload.self,
            from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))
        )
        var insecureOnboarding = try JSONSerialization.jsonObject(
            with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
        ) as! [String: Any]
        insecureOnboarding["relay_url"] = "http://relay.example.test"
        let insecureRaw = String(
            data: try JSONSerialization.data(withJSONObject: insecureOnboarding),
            encoding: .utf8
        )!
        guard (try? RelayOnboardingPayload(rawValue: insecureRaw)) == nil else {
            throw FixtureError.onboardingPolicy
        }
        var malformedOnboarding = try JSONSerialization.jsonObject(
            with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
        ) as! [String: Any]
        malformedOnboarding["encryption_public_key_x25519"] = Data(repeating: 0, count: 31).base64URLEncodedString()
        let malformedRaw = String(
            data: try JSONSerialization.data(withJSONObject: malformedOnboarding),
            encoding: .utf8
        )!
        guard (try? RelayOnboardingPayload(rawValue: malformedRaw)) == nil else {
            throw FixtureError.onboardingPolicy
        }
        let envelope = try RelayCrypto.encrypt(
            payload: payload,
            onboarding: onboarding,
            sequence: 1_750_000_000_001
        )
        guard let callback = VitalAgentCallbackPolicy.safeCallbackURL(
            rawCallbackURL: "openclaw://healthlink/callback?token=must-not-survive#secret-fragment",
            requestID: "req_123.valid",
            status: "ok"
        ),
              let callbackComponents = URLComponents(url: callback, resolvingAgainstBaseURL: false),
              callbackComponents.fragment == nil,
              callbackComponents.queryItems?.map(\.name) == ["request_id", "status", "source"],
              callbackComponents.queryItems?.first(where: { $0.name == "request_id" })?.value == "req_123.valid",
              VitalAgentCallbackPolicy.safeCallbackURL(
                  rawCallbackURL: "https://example.com/callback",
                  requestID: "req_123",
                  status: "ok"
              ) == nil else {
            throw FixtureError.callbackPolicy
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        FileHandle.standardOutput.write(try encoder.encode(envelope))
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
}

private enum FixtureError: Error {
    case usage
    case callbackPolicy
    case onboardingPolicy
}
