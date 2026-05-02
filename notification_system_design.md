# Notification System Design

## Stage 1

The notification system should support in-app and real-time notifications for placements, events, and results.

Core actions:

- create notification
- fetch unread notifications
- mark notification as read
- mark all notifications as read
- stream real-time notifications

Suggested APIs:

```txt
POST /notifications
GET /students/{studentId}/notifications?status=unread&limit=20&cursor=
PATCH /students/{studentId}/notifications/{notificationId}/read
PATCH /students/{studentId}/notifications/read-all
GET /students/{studentId}/notifications/stream
```

Create request:

```json
{
  "studentIds": [1042, 1043],
  "type": "Placement",
  "title": "Placement Update",
  "message": "Company hiring notification",
  "priority": 3
}
```

Fetch response:

```json
{
  "notifications": [
    {
      "id": "uuid",
      "type": "Placement",
      "title": "Placement Update",
      "message": "Company hiring notification",
      "isRead": false,
      "createdAt": "2026-05-02T10:00:00Z"
    }
  ],
  "nextCursor": "cursor-value"
}
```

Headers:

```txt
Authorization: Bearer <token>
Content-Type: application/json
```

Real-time updates can use Server-Sent Events or WebSocket. For a simple campus notification feed, SSE is enough because the server mainly pushes updates to the client.

## Stage 2

PostgreSQL is a good persistent storage choice because notifications need reliable writes, filtering, indexes, and transactional behavior.

Tables:

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY,
  type VARCHAR(30) NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE student_notifications (
  id UUID PRIMARY KEY,
  student_id BIGINT NOT NULL,
  notification_id UUID NOT NULL REFERENCES notifications(id),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  delivered_at TIMESTAMP,
  read_at TIMESTAMP
);
```

Useful indexes:

```sql
CREATE INDEX idx_student_unread_created
ON student_notifications (student_id, is_read, id);

CREATE INDEX idx_notifications_created
ON notifications (created_at DESC);
```

As data grows, likely problems are slow unread queries, large fan-out writes, and expensive count queries. These can be handled using pagination, composite indexes, partitioning by time, archiving old records, and background workers for bulk notification delivery.

## Stage 3

Given query:

```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

This is slow because it may scan many rows and sort a large unread set. It also has no limit, so one student with many unread notifications can produce a large response.

Better query:

```sql
SELECT *
FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC
LIMIT 20;
```

Index:

```sql
CREATE INDEX idx_notifications_student_read_created
ON notifications (studentID, isRead, createdAt DESC);
```

Indexing every column is not effective. It increases storage, slows inserts and updates, and many indexes will not be used.

Query to find all students who got a placement notification in the last 7 days:

```sql
SELECT DISTINCT studentID
FROM notifications
WHERE notificationType = 'Placement'
  AND createdAt >= NOW() - INTERVAL '7 days';
```

Supporting index:

```sql
CREATE INDEX idx_notifications_type_created_student
ON notifications (notificationType, createdAt DESC, studentID);
```

## Stage 4

Fetching notifications on every page load creates unnecessary database and network load.

Better options:

- cache unread notification summaries per student for a short TTL
- fetch notifications only when opening the notification panel
- use pagination or cursor-based loading
- push new notifications with SSE or WebSocket
- use ETag or last-seen timestamp to avoid sending unchanged data

Recommended approach:

- show unread count from cache
- fetch the first page only when the inbox opens
- use SSE for new notification events
- invalidate cache when a notification is read or created

Tradeoffs:

- caching improves speed but can show slightly stale data
- SSE is simpler than WebSocket but mostly one-way
- pagination reduces payload size but requires cursor management

## Stage 5

The proposed synchronous `notify_all` implementation is risky because one failed email can delay or interrupt notification delivery for many students. Email sending, database writes, and app pushes should not all block each other in one loop.

Problems:

- slow for 50,000 students
- one failure can affect the whole batch
- no retry strategy
- no partial failure tracking
- email API latency blocks DB and app delivery
- hard to resume after interruption

Better pseudocode:

```txt
function notify_all(student_ids, message):
    campaign_id = create_campaign(message)
    for batch in chunks(student_ids, 1000):
        save_notifications_bulk(campaign_id, batch, message)
        enqueue_email_jobs(campaign_id, batch, message)
        enqueue_push_jobs(campaign_id, batch, message)
    return campaign_id

worker send_email_job:
    try send_email(student_id, message)
    retry with backoff on failure
    record status

worker push_job:
    try push_to_app(student_id, message)
    retry with backoff on failure
    record status
```

Saving to DB should happen first so the notification exists even if email delivery fails. Email and app push can run asynchronously through queues with retries.

## Stage 6

The priority inbox should display the top `n` unread notifications based on type priority and recency.

Priority order:

```txt
Placement > Result > Event
```

Tie breaker:

```txt
newer Timestamp first
```

The implementation is in:

```txt
notification_app_be/index.js
```

API:

```txt
GET /priority-notifications?limit=10
```

The service fetches notifications from:

```txt
GET http://20.207.122.201/evaluation-service/notifications
```

It keeps the top `n` notifications with a min-heap. This is efficient for new incoming notifications because the service only compares the new item with the smallest item currently in the top list.

Complexity:

```txt
Time: O(total_notifications * log n)
Space: O(n)
```

For `n = 10`, memory stays small and each new notification can be processed quickly.
