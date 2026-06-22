import Foundation
import HealthKit

final class HealthKitService {
    private let store = HKHealthStore()
    private let calendar = Calendar.current

    var isAvailable: Bool {
        HKHealthStore.isHealthDataAvailable()
    }

    func requestAuthorization() async throws {
        guard isAvailable else {
            throw GatewayError.healthKitUnavailable
        }

        let readTypes = Set(requiredReadTypes())
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            store.requestAuthorization(toShare: [], read: readTypes) { success, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if success {
                    continuation.resume()
                } else {
                    continuation.resume(throwing: GatewayError.healthKitUnavailable)
                }
            }
        }
    }

    func buildDailySummary(for date: Date) async throws -> DailyHealthSummary {
        guard isAvailable else {
            throw GatewayError.healthKitUnavailable
        }

        async let steps = cumulativeQuantity(.stepCount, unit: .count(), for: date)
        async let activeEnergy = cumulativeQuantity(.activeEnergyBurned, unit: .kilocalorie(), for: date)
        async let restingHeartRate = averageQuantity(.restingHeartRate, unit: heartRateUnit, for: date)
        async let averageHeartRate = averageQuantity(.heartRate, unit: heartRateUnit, for: date)
        async let maxHeartRate = maxQuantity(.heartRate, unit: heartRateUnit, for: date)
        async let sleepMinutes = sleepMinutes(for: date)
        async let workouts = workouts(for: date)

        let workoutSummaries = try await workouts
        let workoutMinutes = workoutSummaries.reduce(0) { $0 + $1.duration_minutes }

        return DailyHealthSummary(
            date: DateFormatter.gatewayDate.string(from: date),
            timezone: TimeZone.current.identifier,
            provider: "apple_health",
            steps: try await steps.map { Int($0.rounded()) },
            sleep_minutes: try await sleepMinutes,
            resting_heart_rate_bpm: try await restingHeartRate?.rounded(toPlaces: 1),
            avg_heart_rate_bpm: try await averageHeartRate?.rounded(toPlaces: 1),
            max_heart_rate_bpm: try await maxHeartRate?.rounded(toPlaces: 1),
            active_energy_kcal: try await activeEnergy?.rounded(toPlaces: 1),
            workout_minutes: workoutMinutes,
            workouts: workoutSummaries
        )
    }

    private var heartRateUnit: HKUnit {
        HKUnit.count().unitDivided(by: .minute())
    }

    private func requiredReadTypes() -> [HKObjectType] {
        var types: [HKObjectType] = [
            HKObjectType.workoutType()
        ]

        [
            HKQuantityTypeIdentifier.stepCount,
            .activeEnergyBurned,
            .heartRate,
            .restingHeartRate
        ].compactMap { HKObjectType.quantityType(forIdentifier: $0) }.forEach { types.append($0) }

        if let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            types.append(sleepType)
        }

        return types
    }

    private func dayInterval(for date: Date) -> DateInterval {
        let start = calendar.startOfDay(for: date)
        let end = calendar.date(byAdding: .day, value: 1, to: start)!
        return DateInterval(start: start, end: end)
    }

    private func dayPredicate(for date: Date) -> NSPredicate {
        let interval = dayInterval(for: date)
        return HKQuery.predicateForSamples(withStart: interval.start, end: interval.end, options: .strictStartDate)
    }

    private func cumulativeQuantity(_ identifier: HKQuantityTypeIdentifier, unit: HKUnit, for date: Date) async throws -> Double? {
        guard let type = HKQuantityType.quantityType(forIdentifier: identifier) else {
            return nil
        }
        return try await statisticsQuantity(type: type, unit: unit, options: .cumulativeSum, for: date)
    }

    private func averageQuantity(_ identifier: HKQuantityTypeIdentifier, unit: HKUnit, for date: Date) async throws -> Double? {
        guard let type = HKQuantityType.quantityType(forIdentifier: identifier) else {
            return nil
        }
        return try await statisticsQuantity(type: type, unit: unit, options: .discreteAverage, for: date)
    }

    private func maxQuantity(_ identifier: HKQuantityTypeIdentifier, unit: HKUnit, for date: Date) async throws -> Double? {
        guard let type = HKQuantityType.quantityType(forIdentifier: identifier) else {
            return nil
        }
        return try await statisticsQuantity(type: type, unit: unit, options: .discreteMax, for: date)
    }

    private func statisticsQuantity(type: HKQuantityType, unit: HKUnit, options: HKStatisticsOptions, for date: Date) async throws -> Double? {
        try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: dayPredicate(for: date), options: options) { _, result, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                let quantity: HKQuantity?
                if options.contains(.cumulativeSum) {
                    quantity = result?.sumQuantity()
                } else if options.contains(.discreteAverage) {
                    quantity = result?.averageQuantity()
                } else if options.contains(.discreteMax) {
                    quantity = result?.maximumQuantity()
                } else {
                    quantity = nil
                }
                continuation.resume(returning: quantity?.doubleValue(for: unit))
            }
            store.execute(query)
        }
    }

    private func sleepMinutes(for date: Date) async throws -> Int? {
        guard let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
            return nil
        }

        let interval = dayInterval(for: date)
        let predicate = HKQuery.predicateForSamples(withStart: interval.start, end: interval.end, options: [])

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                let minutes = (samples as? [HKCategorySample] ?? []).reduce(0.0) { partial, sample in
                    guard Self.isAsleep(sample.value) else {
                        return partial
                    }
                    let boundedStart = max(sample.startDate, interval.start)
                    let boundedEnd = min(sample.endDate, interval.end)
                    guard boundedEnd > boundedStart else {
                        return partial
                    }
                    return partial + boundedEnd.timeIntervalSince(boundedStart) / 60.0
                }
                continuation.resume(returning: Int(minutes.rounded()))
            }
            store.execute(query)
        }
    }

    private static func isAsleep(_ value: Int) -> Bool {
        value == HKCategoryValueSleepAnalysis.asleepCore.rawValue
            || value == HKCategoryValueSleepAnalysis.asleepDeep.rawValue
            || value == HKCategoryValueSleepAnalysis.asleepREM.rawValue
            || value == HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue
    }

    private func workouts(for date: Date) async throws -> [WorkoutSummary] {
        let type = HKObjectType.workoutType()
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(sampleType: type, predicate: dayPredicate(for: date), limit: HKObjectQueryNoLimit, sortDescriptors: [sort]) { _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                let workouts = (samples as? [HKWorkout] ?? []).map { workout in
                    WorkoutSummary(
                        id: workout.uuid.uuidString,
                        type: workout.workoutActivityType.gatewayName,
                        started_at: ISO8601DateFormatter.gatewayDateTime.string(from: workout.startDate),
                        duration_minutes: Int((workout.duration / 60.0).rounded()),
                        active_energy_kcal: workout.totalEnergyBurned?.doubleValue(for: .kilocalorie()).rounded(toPlaces: 1),
                        avg_heart_rate_bpm: nil
                    )
                }
                continuation.resume(returning: workouts)
            }
            store.execute(query)
        }
    }
}

extension HKWorkoutActivityType {
    var gatewayName: String {
        switch self {
        case .traditionalStrengthTraining:
            return "traditional_strength_training"
        case .functionalStrengthTraining:
            return "functional_strength_training"
        case .walking:
            return "walking"
        case .running:
            return "running"
        case .cycling:
            return "cycling"
        case .swimming:
            return "swimming"
        case .yoga:
            return "yoga"
        case .mindAndBody:
            return "mind_and_body"
        default:
            return "activity_\(rawValue)"
        }
    }
}

extension Double {
    func rounded(toPlaces places: Int) -> Double {
        let divisor = pow(10.0, Double(places))
        return (self * divisor).rounded() / divisor
    }
}
