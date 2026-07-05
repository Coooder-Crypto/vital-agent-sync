import EventKit
import Foundation

final class CalendarService {
    private let store = EKEventStore()
    private let calendar = Calendar.current

    func requestAuthorization() async throws {
        if #available(iOS 17.0, *) {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                store.requestFullAccessToEvents { granted, error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else if granted {
                        continuation.resume()
                    } else {
                        continuation.resume(throwing: EKError(.eventStoreNotAuthorized))
                    }
                }
            }
        } else {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                store.requestAccess(to: .event) { granted, error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else if granted {
                        continuation.resume()
                    } else {
                        continuation.resume(throwing: EKError(.eventStoreNotAuthorized))
                    }
                }
            }
        }
    }

    func buildDailySummary(for date: Date) throws -> DailyCalendarSummary {
        try ensureAuthorized()

        let interval = dayInterval(for: date)
        let predicate = store.predicateForEvents(withStart: interval.start, end: interval.end, calendars: nil)
        let events = store.events(matching: predicate)
            .filter { !$0.isAllDay }
            .sorted { $0.startDate < $1.startDate }

        let busyIntervals = merge(events.map { event in
            DateInterval(start: max(event.startDate, interval.start), end: min(event.endDate, interval.end))
        })

        let busyMinutes = busyIntervals.reduce(0) { partial, interval in
            partial + Int((interval.duration / 60.0).rounded())
        }

        let freeWindows = computeFreeWindows(busyIntervals: busyIntervals, on: date)
            .filter { $0.duration >= 30 * 60 }
            .map {
                FreeWindow(
                    start: ISO8601DateFormatter.gatewayDateTime.string(from: $0.start),
                    end: ISO8601DateFormatter.gatewayDateTime.string(from: $0.end)
                )
            }

        let now = Date()
        let nextEvent = events.first { $0.endDate > now }.map {
            RedactedCalendarEvent(
                starts_at: ISO8601DateFormatter.gatewayDateTime.string(from: $0.startDate),
                duration_minutes: Int(($0.endDate.timeIntervalSince($0.startDate) / 60.0).rounded()),
                title_redacted: true
            )
        }

        return DailyCalendarSummary(
            date: DateFormatter.gatewayDate.string(from: date),
            timezone: TimeZone.current.identifier,
            provider: "apple_calendar",
            busy_minutes: busyMinutes,
            free_windows: freeWindows,
            next_event: nextEvent
        )
    }

    private func ensureAuthorized() throws {
        let status = EKEventStore.authorizationStatus(for: .event)
        if #available(iOS 17.0, *) {
            guard status == .fullAccess else {
                throw EKError(.eventStoreNotAuthorized)
            }
        } else {
            guard status == .authorized else {
                throw EKError(.eventStoreNotAuthorized)
            }
        }
    }

    private func dayInterval(for date: Date) -> DateInterval {
        let start = calendar.startOfDay(for: date)
        let end = calendar.date(byAdding: .day, value: 1, to: start)!
        return DateInterval(start: start, end: end)
    }

    private func computeFreeWindows(busyIntervals: [DateInterval], on date: Date) -> [DateInterval] {
        let dayStart = calendar.startOfDay(for: date)
        let windowStart = calendar.date(bySettingHour: 6, minute: 0, second: 0, of: dayStart)!
        let windowEnd = calendar.date(bySettingHour: 23, minute: 0, second: 0, of: dayStart)!

        var cursor = windowStart
        var free: [DateInterval] = []

        for busy in busyIntervals {
            guard busy.end > windowStart, busy.start < windowEnd else {
                continue
            }

            let boundedStart = max(busy.start, windowStart)
            let boundedEnd = min(busy.end, windowEnd)
            guard boundedEnd > boundedStart else {
                continue
            }

            let boundedBusy = DateInterval(start: boundedStart, end: boundedEnd)
            if boundedBusy.start > cursor {
                free.append(DateInterval(start: cursor, end: boundedBusy.start))
            }
            cursor = max(cursor, boundedBusy.end)
        }

        if cursor < windowEnd {
            free.append(DateInterval(start: cursor, end: windowEnd))
        }

        return free
    }

    private func merge(_ intervals: [DateInterval]) -> [DateInterval] {
        let sorted = intervals
            .filter { $0.end > $0.start }
            .sorted { $0.start < $1.start }

        var merged: [DateInterval] = []
        for interval in sorted {
            guard let last = merged.last else {
                merged.append(interval)
                continue
            }

            if interval.start <= last.end {
                merged.removeLast()
                merged.append(DateInterval(start: last.start, end: max(last.end, interval.end)))
            } else {
                merged.append(interval)
            }
        }
        return merged
    }
}
