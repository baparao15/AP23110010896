# Vehicle Maintenance Scheduler

This backend service solves the vehicle maintenance scheduling problem. It fetches tasks and depot capacity from the AffordMed test server, applies 0/1 knapsack, and returns the best task selection from a local API endpoint.

## What This Service Does

- Gets a fresh Bearer token from the AffordMed auth API
- Fetches vehicle maintenance tasks from the vehicles API
- Fetches depot mechanic-hour budgets from the depots API
- Selects tasks that maximize total impact without exceeding mechanic-hours
- Sends execution logs through the reusable `logging_middleware`
- Exposes a local endpoint for Postman or Insomnia screenshots

## Files

```txt
vehicle_maintenance_scheduler/
  index.js
  package.json
  README.md
```

Shared logger:

```txt
../logging_middleware/index.js
```

## Run

Use Node.js 18 or newer because the code uses the built-in `fetch` API.

```bash
cd vehicle_maintenance_scheduler
npm start
```

The server listens on:

```txt
http://localhost:3000
```

## API Endpoint

```txt
POST http://localhost:3000/schedule
```

Request body:

```json
{}
```

The service automatically fetches the token, vehicles, and depots. You do not need to paste a Bearer token in Postman for the local endpoint.

## Output

The response contains one schedule per depot.

```json
{
  "schedule": [
    {
      "depotId": "1",
      "budget": 60,
      "totalHours": 60,
      "totalImpact": 137,
      "vehicles": [
        {
          "TaskID": "example-id",
          "Duration": 2,
          "Impact": 10
        }
      ]
    }
  ],
  "responseTimeMs": 1415
}
```

## Algorithm

The problem is a 0/1 knapsack problem.

Mapping:

```txt
Task Duration  -> item weight
Task Impact    -> item value
MechanicHours  -> knapsack capacity
```

Goal:

```txt
maximize total Impact while total Duration <= MechanicHours
```

The implementation is in:

```txt
scheduleVehicles(vehicles, budget)
```

The dynamic programming array stores the best result possible for each hour capacity. The loop over hours goes backwards so the same task cannot be selected more than once.

Complexity:

```txt
Time: O(number_of_tasks * mechanic_hours)
Space: O(mechanic_hours)
```

This is efficient for the provided API data and gives an exact optimal answer for each depot budget.

## Logging

The service uses the custom logger only. It does not use `console.log`.

Examples of log calls:

```js
Log("backend", "info", "auth", "fresh token generated")
Log("backend", "info", "service", "fetching vehicles and depots")
Log("backend", "info", "handler", "running knapsack scheduling")
```

The package values are valid backend values from the AffordMed logging rules.
