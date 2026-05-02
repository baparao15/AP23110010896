# Notification App Backend

This backend service implements Stage 6 of the Campus Notifications Microservice. It fetches notifications from the AffordMed test server and returns the top priority notifications for a priority inbox.

## What This Service Does

- Gets a fresh Bearer token from the AffordMed auth API
- Fetches notifications from the Notification API
- Ranks notifications by type priority and recency
- Returns the top `n` notifications, defaulting to top 10
- Uses a small min-heap to avoid sorting all notifications for every update
- Sends logs through the shared `logging_middleware`

## Files

```txt
notification_app_be/
  index.js
  package.json
  README.md
```

Related design document:

```txt
../notification_system_design.md
```

## Run

Use Node.js 18 or newer.

```bash
cd notification_app_be
npm start
```

The server listens on:

```txt
http://localhost:3001
```

## API Endpoint

```txt
GET http://localhost:3001/priority-notifications
```

Optional limit:

```txt
GET http://localhost:3001/priority-notifications?limit=10
```

Do not use Postman Authorization for the local endpoint. The service fetches the AffordMed token internally.

## Priority Rule

Notifications are ranked by type first:

```txt
Placement > Result > Event
```

If two notifications have the same type, the newer notification comes first using `Timestamp`.

## Output

Example response:

```json
{
  "count": 10,
  "notifications": [
    {
      "ID": "example-id",
      "Type": "Placement",
      "Message": "Company hiring",
      "Timestamp": "2026-05-02 10:00:00"
    }
  ],
  "responseTimeMs": 250
}
```

## Efficient Top 10 Logic

The code uses a min-heap of size `n`.

For every notification:

- if the heap has fewer than `n` items, insert it
- otherwise compare it with the weakest item in the heap
- if the new item is better, replace the weakest item

Complexity:

```txt
Time: O(total_notifications * log n)
Space: O(n)
```

For top 10, this keeps memory small and supports new incoming notifications efficiently.

## Logging

The service logs important lifecycle events:

```js
Log("backend", "info", "auth", "requesting fresh token for notifications")
Log("backend", "info", "service", "fetching notifications")
Log("backend", "info", "handler", "priority notifications created")
```

The service uses valid backend package values and does not use `console.log`.
