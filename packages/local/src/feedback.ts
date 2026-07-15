import { randomUUID } from "node:crypto";
import type { VitalAgentDatabase } from "./database.js";

export type FeedbackInput = {
  source?: string;
  category: string;
  rating?: number;
  note?: string;
  occurred_at?: string;
};

export type FeedbackEvent = {
  id: string;
  source: string;
  category: string;
  rating: number | null;
  note: string | null;
  occurred_at: string;
  created_at: string;
};

export function recordFeedback(database: VitalAgentDatabase, input: FeedbackInput): FeedbackEvent {
  const category = input.category.trim();
  if (!category) {
    throw new Error("Feedback category is required.");
  }
  const source = input.source?.trim() || "agent";
  const now = new Date().toISOString();
  const event: FeedbackEvent = {
    id: `feedback_${randomUUID().replaceAll("-", "")}`,
    source,
    category,
    rating: typeof input.rating === "number" ? Math.max(1, Math.min(Math.round(input.rating), 5)) : null,
    note: input.note?.trim() || null,
    occurred_at: input.occurred_at?.trim() || now,
    created_at: now
  };

  database.sqlite.prepare(`
    insert into feedback_events (
      id,
      source,
      category,
      rating,
      note,
      occurred_at,
      created_at
    ) values (
      @id,
      @source,
      @category,
      @rating,
      @note,
      @occurredAt,
      @createdAt
    )
  `).run({
    id: event.id,
    source: event.source,
    category: event.category,
    rating: event.rating,
    note: event.note,
    occurredAt: event.occurred_at,
    createdAt: event.created_at
  });

  return event;
}

export function listFeedbackEvents(database: VitalAgentDatabase, limit = 20): FeedbackEvent[] {
  const rows = database.sqlite.prepare(`
    select
      id,
      source,
      category,
      rating,
      note,
      occurred_at as occurredAt,
      created_at as createdAt
    from feedback_events
    order by occurred_at desc, created_at desc
    limit ?
  `).all(Math.max(1, Math.min(limit, 100))) as Array<{
    id: string;
    source: string;
    category: string;
    rating: number | null;
    note: string | null;
    occurredAt: string;
    createdAt: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    category: row.category,
    rating: row.rating,
    note: row.note,
    occurred_at: row.occurredAt,
    created_at: row.createdAt
  }));
}
