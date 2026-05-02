const http = require("http");
const { Log } = require("../logging_middleware");

const BASE_URL = "http://20.207.122.201/evaluation-service";
const PORT = process.env.PORT || 3000;

// Test server credentials used to generate a fresh Bearer token at runtime.
const authDetails = {
  email: "baparao_pendyala@srmap.edu.in",
  name: "bapa rao pendyala",
  rollNo: "ap23110010896",
  accessCode: "QkbpxH",
  clientID: "cc6913fa-9335-477a-98e4-09798d53b4f1",
  clientSecret: "TxtjhCkWsAePGasA"
};

// Small wrapper for all AffordMed test server API calls.
async function request(path, options = {}) {
  const res = await fetch(BASE_URL + path, options);
  if (!res.ok) throw new Error(path + " failed with " + res.status);
  return res.json();
}

async function getToken() {
  await Log("backend", "info", "auth", "requesting fresh token");

  const data = await request("/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(authDetails)
  });

  const token = data.access_token || data.accessToken || data.token;
  if (!token) throw new Error("auth token not found");

  // The logging middleware reads this token when it posts logs.
  process.env.ACCESS_TOKEN = token;

  await Log("backend", "info", "auth", "fresh token generated");
  return token;
}

async function getData(token) {
  await Log("backend", "info", "service", "fetching vehicles and depots");

  const headers = { Authorization: "Bearer " + token };

  // Vehicles and depots are independent, so they can be fetched together.
  const [vehiclesData, depotsData] = await Promise.all([
    request("/vehicles", { headers }),
    request("/depots", { headers })
  ]);

  // The API returns objects like { vehicles: [...] } and { depots: [...] }.
  const vehicles = Array.isArray(vehiclesData) ? vehiclesData : vehiclesData.vehicles || vehiclesData.data || [];
  const depots = Array.isArray(depotsData) ? depotsData : depotsData.depots || depotsData.data || [];

  await Log("backend", "info", "service", "fetched " + vehicles.length + " vehicles and " + depots.length + " depots");
  return { vehicles, depots };
}

// Reads a number from possible field names so the code works with small API shape changes.
function numberFrom(item, keys, fallback = 0) {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null) {
      const value = Number(item[key]);
      if (!Number.isNaN(value)) return value;
    }
  }
  return fallback;
}

// Reads the first available value from a list of possible field names.
function firstFrom(item, keys, fallback) {
  for (const key of keys) {
    if (item && item[key] !== undefined && item[key] !== null) return item[key];
  }
  return fallback;
}

function depotBudget(depot) {
  return Math.floor(numberFrom(depot, ["MechanicHours", "availableHours", "mechanicHours", "capacity", "hours"], 8));
}

function vehicleDuration(vehicle) {
  return Math.max(1, Math.ceil(numberFrom(vehicle, ["Duration", "duration", "hours"], 1)));
}

function vehicleImpact(vehicle) {
  return numberFrom(vehicle, ["Impact", "impact", "score"], 0);
}

function scheduleVehicles(vehicles, budget) {
  const items = vehicles.map((vehicle) => ({
    vehicle,
    hours: vehicleDuration(vehicle),
    score: vehicleImpact(vehicle)
  }));

  // dp[h] stores the best impact and selected tasks possible within h hours.
  const dp = Array.from({ length: budget + 1 }, () => ({ score: 0, selected: [] }));

  for (const item of items) {
    // Moving backwards keeps this as 0/1 knapsack, so one task is not reused.
    for (let h = budget; h >= item.hours; h--) {
      const nextScore = dp[h - item.hours].score + item.score;

      // Replace the previous best plan only when this task improves impact.
      if (nextScore > dp[h].score) {
        dp[h] = {
          score: nextScore,
          selected: [...dp[h - item.hours].selected, item]
        };
      }
    }
  }

  // Choose the highest impact plan among all hour capacities up to the budget.
  const best = dp.reduce((a, b) => (b.score > a.score ? b : a), dp[0]);

  return {
    totalHours: best.selected.reduce((sum, item) => sum + item.hours, 0),
    totalImpact: best.score,
    vehicles: best.selected.map((item) => item.vehicle)
  };
}

function buildSchedule(vehicles, depots) {
  // Fallback keeps the endpoint usable even if depots API returns no data.
  if (!depots.length) {
    return [{ depotId: "default", budget: 8, ...scheduleVehicles(vehicles, 8) }];
  }

  // Run the knapsack once for each depot budget.
  return depots.map((depot, index) => {
    const depotId = String(firstFrom(depot, ["ID", "id", "depotId", "name"], "depot-" + (index + 1)));
    const budget = depotBudget(depot);

    return {
      depotId,
      budget,
      ...scheduleVehicles(vehicles, budget)
    };
  });
}

// Parses JSON request body from the built-in Node HTTP server.
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", (chunk) => {
      data += chunk;
    });

    req.on("end", () => {
      if (!data) return resolve({});

      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

async function handleSchedule(req, res) {
  const start = Date.now();
  const body = await readBody(req);

  await Log("backend", "info", "handler", "schedule request received");

  const token = await getToken();

  // If custom data is sent in the body, use it. Otherwise fetch from AffordMed APIs.
  const data = body.vehicles && body.depots ? body : await getData(token);

  await Log("backend", "info", "handler", "running knapsack scheduling");

  const schedule = buildSchedule(data.vehicles || [], data.depots || []);
  const responseTime = Date.now() - start;

  await Log("backend", "info", "handler", "schedule created for " + schedule.length + " depots");

  send(res, 200, {
    schedule,
    responseTimeMs: responseTime
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      return send(res, 200, { message: "vehicle maintenance scheduler running" });
    }

    if (req.method === "POST" && req.url === "/schedule") {
      await handleSchedule(req, res);
      return;
    }

    send(res, 404, { error: "not found" });
  } catch (err) {
    await Log("backend", "error", "handler", err.message);
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT);
