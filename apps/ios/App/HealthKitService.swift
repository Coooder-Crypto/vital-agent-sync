import Foundation
import HealthKit

final class HealthKitService: @unchecked Sendable {
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
                    continuation.resume(throwing: GatewayError.healthPermissionRequired)
                }
            }
        }
    }

    func earliestAvailableSampleDate() async throws -> Date? {
        guard isAvailable else {
            throw GatewayError.healthKitUnavailable
        }

        let sampleTypes = requiredReadTypes().compactMap { $0 as? HKSampleType }
        return try await withThrowingTaskGroup(of: Date?.self) { group in
            for sampleType in sampleTypes {
                group.addTask {
                    try await self.earliestSampleDate(for: sampleType)
                }
            }

            var earliestDate: Date?
            for try await date in group {
                guard let date else {
                    continue
                }
                earliestDate = earliestDate.map { min($0, date) } ?? date
            }
            return earliestDate
        }
    }

    func buildDailySummary(for date: Date) async throws -> DailyHealthSummary {
        guard let summary = try await buildDailySummaries(for: [date]).first else {
            throw GatewayError.healthPermissionRequired
        }
        return summary
    }

    func buildDailySummaries(for dates: [Date]) async throws -> [DailyHealthSummary] {
        guard isAvailable else {
            throw GatewayError.healthKitUnavailable
        }

        let normalizedDates = Array(Set(dates.map { calendar.startOfDay(for: $0) })).sorted()
        guard let firstDate = normalizedDates.first,
              let lastDate = normalizedDates.last,
              let queryEnd = calendar.date(byAdding: .day, value: 1, to: lastDate) else {
            return []
        }

        async let quantityValues = quantityValuesByDay(
            from: firstDate,
            to: queryEnd
        )
        async let sleepValues = sleepMinutesByDay(
            for: normalizedDates,
            from: firstDate,
            to: queryEnd
        )
        async let workoutValues = workoutsByDay(
            for: normalizedDates,
            from: firstDate,
            to: queryEnd
        )

        let quantities = try await quantityValues
        let sleep = try await sleepValues
        let workouts = try await workoutValues

        return normalizedDates.map { date in
            let workoutSummaries = workouts[date] ?? []
            let workoutMinutes = workoutSummaries.reduce(0) { $0 + $1.duration_minutes }

            return DailyHealthSummary(
                date: DateFormatter.gatewayDate.string(from: date),
                timezone: TimeZone.current.identifier,
                provider: "apple_health",
                steps: value(.steps, on: date, in: quantities).map { Int($0.rounded()) },
                sleep_minutes: sleep?[date],
                resting_heart_rate_bpm: roundedValue(.restingHeartRate, on: date, in: quantities),
                avg_heart_rate_bpm: roundedValue(.averageHeartRate, on: date, in: quantities),
                max_heart_rate_bpm: roundedValue(.maxHeartRate, on: date, in: quantities),
                active_energy_kcal: roundedValue(.activeEnergy, on: date, in: quantities),
                basal_energy_kcal: roundedValue(.basalEnergy, on: date, in: quantities),
                distance_walking_running_m: roundedValue(.walkingRunningDistance, on: date, in: quantities),
                distance_cycling_m: roundedValue(.cyclingDistance, on: date, in: quantities),
                flights_climbed: value(.flightsClimbed, on: date, in: quantities).map { Int($0.rounded()) },
                exercise_minutes: value(.exerciseMinutes, on: date, in: quantities).map { Int($0.rounded()) },
                stand_minutes: value(.standMinutes, on: date, in: quantities).map { Int($0.rounded()) },
                heart_rate_variability_ms: roundedValue(.heartRateVariability, on: date, in: quantities),
                walking_heart_rate_average_bpm: roundedValue(.walkingHeartRateAverage, on: date, in: quantities),
                vo2_max_ml_kg_min: roundedValue(.vo2Max, on: date, in: quantities),
                oxygen_saturation_percent: roundedValue(.oxygenSaturation, on: date, in: quantities),
                respiratory_rate_bpm: roundedValue(.respiratoryRate, on: date, in: quantities),
                body_temperature_c: roundedValue(.bodyTemperature, on: date, in: quantities),
                body_mass_kg: roundedValue(.bodyMass, on: date, in: quantities),
                body_fat_percentage: roundedValue(.bodyFatPercentage, on: date, in: quantities),
                lean_body_mass_kg: roundedValue(.leanBodyMass, on: date, in: quantities),
                body_mass_index: roundedValue(.bodyMassIndex, on: date, in: quantities),
                workout_minutes: workoutMinutes,
                workouts: workoutSummaries
            )
        }
    }

    private var heartRateUnit: HKUnit {
        HKUnit.count().unitDivided(by: .minute())
    }

    private func requiredReadTypes() -> [HKObjectType] {
        var types: [HKObjectType] = [
            HKObjectType.workoutType()
        ]

        QuantityMetric.allCases
            .compactMap { HKObjectType.quantityType(forIdentifier: $0.identifier) }
            .forEach { types.append($0) }

        if let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            types.append(sleepType)
        }

        return types
    }

    private func earliestSampleDate(for sampleType: HKSampleType) async throws -> Date? {
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: sampleType,
                predicate: nil,
                limit: 1,
                sortDescriptors: [sort]
            ) { _, samples, error in
                if let error {
                    if Self.isNoDataError(error) {
                        continuation.resume(returning: nil)
                    } else {
                        continuation.resume(throwing: error)
                    }
                    return
                }
                continuation.resume(returning: samples?.first?.startDate)
            }
            store.execute(query)
        }
    }

    private func quantityValuesByDay(
        from start: Date,
        to end: Date
    ) async throws -> [QuantityMetric: [Date: Double]] {
        try await withThrowingTaskGroup(of: (QuantityMetric, [Date: Double]).self) { group in
            for metric in QuantityMetric.allCases {
                group.addTask {
                    (
                        metric,
                        try await self.statisticsValuesByDay(
                            metric: metric,
                            from: start,
                            to: end
                        )
                    )
                }
            }

            var values: [QuantityMetric: [Date: Double]] = [:]
            for try await (metric, dailyValues) in group {
                values[metric] = dailyValues
            }
            return values
        }
    }

    private func statisticsValuesByDay(
        metric: QuantityMetric,
        from start: Date,
        to end: Date
    ) async throws -> [Date: Double] {
        guard let type = HKQuantityType.quantityType(forIdentifier: metric.identifier) else {
            return [:]
        }

        let predicate = HKQuery.predicateForSamples(
            withStart: start,
            end: end,
            options: .strictStartDate
        )
        var interval = DateComponents()
        interval.day = 1

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsCollectionQuery(
                quantityType: type,
                quantitySamplePredicate: predicate,
                options: metric.statisticsOptions,
                anchorDate: start,
                intervalComponents: interval
            )
            query.initialResultsHandler = { _, collection, error in
                if let error {
                    if Self.isNoDataError(error) {
                        continuation.resume(returning: [:])
                    } else {
                        continuation.resume(throwing: error)
                    }
                    return
                }

                var values: [Date: Double] = [:]
                collection?.enumerateStatistics(
                    from: start,
                    to: end.addingTimeInterval(-1)
                ) { statistics, _ in
                    guard let quantity = metric.quantity(from: statistics) else {
                        return
                    }
                    let day = self.calendar.startOfDay(for: statistics.startDate)
                    values[day] = quantity.doubleValue(for: metric.unit) * metric.scale
                }
                continuation.resume(returning: values)
            }
            store.execute(query)
        }
    }

    private func sleepMinutesByDay(
        for dates: [Date],
        from start: Date,
        to end: Date
    ) async throws -> [Date: Int]? {
        guard let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
            return nil
        }

        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: type,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: nil
            ) { _, samples, error in
                if let error {
                    if Self.isNoDataError(error) {
                        continuation.resume(returning: nil)
                    } else {
                        continuation.resume(throwing: error)
                    }
                    return
                }

                var minutesByDay = Dictionary(uniqueKeysWithValues: dates.map { ($0, 0.0) })
                for sample in samples as? [HKCategorySample] ?? [] where Self.isAsleep(sample.value) {
                    for date in dates {
                        guard let dayEnd = self.calendar.date(byAdding: .day, value: 1, to: date) else {
                            continue
                        }
                        let boundedStart = max(sample.startDate, date)
                        let boundedEnd = min(sample.endDate, dayEnd)
                        guard boundedEnd > boundedStart else {
                            continue
                        }
                        minutesByDay[date, default: 0] += boundedEnd.timeIntervalSince(boundedStart) / 60
                    }
                }
                continuation.resume(
                    returning: minutesByDay.mapValues { Int($0.rounded()) }
                )
            }
            store.execute(query)
        }
    }

    private func workoutsByDay(
        for dates: [Date],
        from start: Date,
        to end: Date
    ) async throws -> [Date: [WorkoutSummary]] {
        let type = HKObjectType.workoutType()
        let predicate = HKQuery.predicateForSamples(
            withStart: start,
            end: end,
            options: .strictStartDate
        )
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let includedDates = Set(dates)

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: type,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [sort]
            ) { _, samples, error in
                if let error {
                    if Self.isNoDataError(error) {
                        continuation.resume(returning: [:])
                    } else {
                        continuation.resume(throwing: error)
                    }
                    return
                }

                var workoutsByDay: [Date: [WorkoutSummary]] = [:]
                for workout in samples as? [HKWorkout] ?? [] {
                    let date = self.calendar.startOfDay(for: workout.startDate)
                    guard includedDates.contains(date) else {
                        continue
                    }
                    workoutsByDay[date, default: []].append(
                        WorkoutSummary(
                            id: workout.uuid.uuidString,
                            type: workout.workoutActivityType.gatewayName,
                            started_at: ISO8601DateFormatter.gatewayDateTime.string(from: workout.startDate),
                            duration_minutes: Int((workout.duration / 60).rounded()),
                            active_energy_kcal: workout.totalEnergyBurned?
                                .doubleValue(for: .kilocalorie())
                                .rounded(toPlaces: 1),
                            avg_heart_rate_bpm: nil
                        )
                    )
                }
                continuation.resume(returning: workoutsByDay)
            }
            store.execute(query)
        }
    }

    private func value(
        _ metric: QuantityMetric,
        on date: Date,
        in values: [QuantityMetric: [Date: Double]]
    ) -> Double? {
        values[metric]?[date]
    }

    private func roundedValue(
        _ metric: QuantityMetric,
        on date: Date,
        in values: [QuantityMetric: [Date: Double]]
    ) -> Double? {
        value(metric, on: date, in: values)?.rounded(toPlaces: 1)
    }

    private static func isAsleep(_ value: Int) -> Bool {
        value == HKCategoryValueSleepAnalysis.asleepCore.rawValue
            || value == HKCategoryValueSleepAnalysis.asleepDeep.rawValue
            || value == HKCategoryValueSleepAnalysis.asleepREM.rawValue
            || value == HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue
    }

    private static func isNoDataError(_ error: Error) -> Bool {
        let nsError = error as NSError
        return nsError.domain == HKErrorDomain && nsError.code == HKError.Code.errorNoData.rawValue
    }

    private enum QuantityMetric: CaseIterable, Hashable, Sendable {
        case steps
        case activeEnergy
        case basalEnergy
        case walkingRunningDistance
        case cyclingDistance
        case flightsClimbed
        case exerciseMinutes
        case standMinutes
        case restingHeartRate
        case averageHeartRate
        case maxHeartRate
        case heartRateVariability
        case walkingHeartRateAverage
        case vo2Max
        case oxygenSaturation
        case respiratoryRate
        case bodyTemperature
        case bodyMass
        case bodyFatPercentage
        case leanBodyMass
        case bodyMassIndex

        var identifier: HKQuantityTypeIdentifier {
            switch self {
            case .steps:
                return .stepCount
            case .activeEnergy:
                return .activeEnergyBurned
            case .basalEnergy:
                return .basalEnergyBurned
            case .walkingRunningDistance:
                return .distanceWalkingRunning
            case .cyclingDistance:
                return .distanceCycling
            case .flightsClimbed:
                return .flightsClimbed
            case .exerciseMinutes:
                return .appleExerciseTime
            case .standMinutes:
                return .appleStandTime
            case .restingHeartRate:
                return .restingHeartRate
            case .averageHeartRate, .maxHeartRate:
                return .heartRate
            case .heartRateVariability:
                return .heartRateVariabilitySDNN
            case .walkingHeartRateAverage:
                return .walkingHeartRateAverage
            case .vo2Max:
                return .vo2Max
            case .oxygenSaturation:
                return .oxygenSaturation
            case .respiratoryRate:
                return .respiratoryRate
            case .bodyTemperature:
                return .bodyTemperature
            case .bodyMass:
                return .bodyMass
            case .bodyFatPercentage:
                return .bodyFatPercentage
            case .leanBodyMass:
                return .leanBodyMass
            case .bodyMassIndex:
                return .bodyMassIndex
            }
        }

        var unit: HKUnit {
            switch self {
            case .steps, .flightsClimbed, .bodyMassIndex:
                return .count()
            case .activeEnergy, .basalEnergy:
                return .kilocalorie()
            case .walkingRunningDistance, .cyclingDistance:
                return .meter()
            case .exerciseMinutes, .standMinutes:
                return .minute()
            case .restingHeartRate, .averageHeartRate, .maxHeartRate,
                 .walkingHeartRateAverage, .respiratoryRate:
                return HKUnit.count().unitDivided(by: .minute())
            case .heartRateVariability:
                return .secondUnit(with: .milli)
            case .vo2Max:
                return HKUnit(from: "mL/kg*min")
            case .oxygenSaturation, .bodyFatPercentage:
                return .percent()
            case .bodyTemperature:
                return .degreeCelsius()
            case .bodyMass, .leanBodyMass:
                return .gramUnit(with: .kilo)
            }
        }

        var statisticsOptions: HKStatisticsOptions {
            switch self {
            case .steps, .activeEnergy, .basalEnergy, .walkingRunningDistance,
                 .cyclingDistance, .flightsClimbed, .exerciseMinutes, .standMinutes:
                return .cumulativeSum
            case .maxHeartRate:
                return .discreteMax
            default:
                return .discreteAverage
            }
        }

        var scale: Double {
            switch self {
            case .oxygenSaturation, .bodyFatPercentage:
                return 100
            default:
                return 1
            }
        }

        func quantity(from statistics: HKStatistics) -> HKQuantity? {
            if statisticsOptions.contains(.cumulativeSum) {
                return statistics.sumQuantity()
            }
            if statisticsOptions.contains(.discreteMax) {
                return statistics.maximumQuantity()
            }
            return statistics.averageQuantity()
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
        let divisor = pow(10, Double(places))
        return (self * divisor).rounded() / divisor
    }
}
