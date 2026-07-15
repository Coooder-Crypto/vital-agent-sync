import Foundation
@testable import VitalAgentSync

enum TestFixtures {
    static func dailySummary(date: String = "2026-07-11", steps: Int = 8_123) -> DailyHealthSummary {
        DailyHealthSummary(
            date: date,
            timezone: "Asia/Shanghai",
            provider: "apple_health",
            steps: steps,
            sleep_minutes: 420,
            resting_heart_rate_bpm: 58,
            avg_heart_rate_bpm: 76,
            max_heart_rate_bpm: 142,
            active_energy_kcal: 510,
            basal_energy_kcal: 1_650,
            distance_walking_running_m: 6_200,
            distance_cycling_m: nil,
            flights_climbed: 8,
            exercise_minutes: 46,
            stand_minutes: 720,
            heart_rate_variability_ms: 52,
            walking_heart_rate_average_bpm: 88,
            vo2_max_ml_kg_min: 44,
            oxygen_saturation_percent: 98,
            respiratory_rate_bpm: 14,
            body_temperature_c: nil,
            body_mass_kg: 70,
            body_fat_percentage: 18,
            lean_body_mass_kg: 57,
            body_mass_index: 22,
            workout_minutes: 46,
            workouts: []
        )
    }

    static func syncDetail(
        index: Int = 0,
        deliveryState: SyncDeliveryState? = .receiverAccepted,
        failureCategory: SyncFailureCategory? = nil
    ) -> LastSyncDetail {
        let attemptedAt = Date(timeIntervalSince1970: 1_700_000_000 + Double(index))
        let succeeded = failureCategory == nil
        return LastSyncDetail(
            attemptedAt: attemptedAt,
            completedAt: succeeded ? attemptedAt.addingTimeInterval(1) : nil,
            trigger: "Manual",
            serverURL: "http://127.0.0.1:8787",
            agentName: "Test Agent",
            requestedDateRange: "2026-07-10 - 2026-07-11",
            uploadedDayCount: succeeded ? 2 : 0,
            acceptedSyncID: succeeded ? "sync_test_\(index)" : nil,
            isIdempotent: succeeded ? false : nil,
            deliveryState: succeeded ? deliveryState : nil,
            failureCategory: failureCategory,
            failureMessage: failureCategory == nil ? nil : "Test failure"
        )
    }

    static func relayOnboarding() -> RelayOnboardingPayload {
        RelayOnboardingPayload(
            protocolVersion: "healthlink-e2ee-v1",
            mode: "hosted_relay",
            relay_url: "https://relay.example.com",
            user_id: "usr_test",
            source_device_id: "dev_test",
            agent_name: "Test Agent",
            encryption_public_key: nil,
            encryption_public_key_x25519: Data(repeating: 1, count: 32).base64URLEncodedString(),
            signing_public_key: nil,
            upload_auth_secret: Data(repeating: 2, count: 32).base64URLEncodedString(),
            relay_access_token: Data(repeating: 3, count: 32).base64URLEncodedString(),
            relay_api_token: nil,
            fingerprint: "test-fingerprint",
            requested_scopes: ["health.daily_summary.write"],
            created_at: "2026-07-11T10:00:00+08:00"
        )
    }
}
