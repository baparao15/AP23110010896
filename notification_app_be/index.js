const http = require("http");
const { Log } = require("../logging_middleware");

const BASE_URL = "http://20.207.122.201/evaluation-service";
const PORT = process.env.PORT || 3001;

const authDetails = {
  email: "baparao_pendyala@srmap.edu.in",
  name: "bapa rao pendyala",
  rollNo: "ap23110010896",
  accessCode: "QkbpxH",
  clientID: "cc6913fa-9335-477a-98e4-09798d53b4f1",
  clientSecret: "TxtjhCkWsAePGasA"
};

// Higher number means higher priority in the inbox.
const typeWeight = {
  placement: 3,
  result: 2,
  event: 1
};

async function request(path, options = {}) {
  const res = await fetch(BASE_URL + path, options);
  if (!res.ok) throw new Error(path + " failed with " + res.status);
  return res.json();
}

async function getToken() {
  await Log("backend", "info", "auth", "requesting fresh token for notifications");

  const data = await request("/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(authDetails)
  });

  const token = data.access_token || data.accessToken || data.token;
  if (!token) throw new Error("auth token not found");

  // The logger reads this token while sending logs to the protected log API.
  process.env.ACCESS_TOKEN = token;

  await Log("backend", "info", "auth", "fresh token generated for notifications");
  return token;
}

async function getNotifications(token) {
  await Log("backend", "info", "service", "fetching notifications");

  const data = await request("/notifications", {
    headers: { Authorization: "Bearer " + token }
  });

  // The test server currently returns { notifications: [...] }.
  const notifications = Array.isArray(data) ? data : data.notifications || data.data || [];

  await Log("backend", "info", "service", "fetched " + notifications.length + " notifications");
  return notifications;
}

function priorityOf(item) {
  const type = String(item.Type || item.type || "").toLowerCase();
  const time = new Date(item.Timestamp || item.timestamp || item.createdAt || 0).getTime() || 0;

  return {
    weight: typeWeight[type] || 0,
    time
  };
}

function better(a, b) {
  const pa = priorityOf(a);
  const pb = priorityOf(b);

  // First compare notification type, then use recency as tie-breaker.
  if (pa.weight !== pb.weight) return pa.weight > pb.weight;
  return pa.time > pb.time;
}

function worse(a, b) {
  return better(b, a);
}

function topNotifications(items, limit) {
  const heap = [];

  function up(index) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!worse(heap[index], heap[parent])) break;

      [heap[index], heap[parent]] = [heap[parent], heap[index]];
      index = parent;
    }
  }

  function down(index) {
    while (true) {
      let smallest = index;
      const left = index * 2 + 1;
      const right = index * 2 + 2;

      if (left < heap.length && worse(heap[left], heap[smallest])) smallest = left;
      if (right < heap.length && worse(heap[right], heap[smallest])) smallest = right;
      if (smallest === index) break;

      [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
      index = smallest;
    }
  }

  for (const item of items) {
    if (heap.length < limit) {
      heap.push(item);
      up(heap.length - 1);
    } else if (better(item, heap[0])) {
      // Keep only the best N items instead of sorting the full list every time.
      heap[0] = item;
      down(0);
    }
  }

  // Final sort makes the API response show highest priority first.
  return heap.sort((a, b) => (better(a, b) ? -1 : 1));
}

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

async function handlePriority(req, res) {
  const start = Date.now();

  await Log("backend", "info", "handler", "priority notification request received");

  const url = new URL(req.url, "http://localhost:" + PORT);
  const limit = Math.max(1, Number(url.searchParams.get("limit") || 10));

  const token = await getToken();
  const notifications = await getNotifications(token);
  const top = topNotifications(notifications, limit);
  const responseTime = Date.now() - start;

  await Log("backend", "info", "handler", "priority notifications created");

  send(res, 200, {
    count: top.length,
    notifications: top,
    responseTimeMs: responseTime
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      return send(res, 200, { message: "notification app running" });
    }

    if (req.method === "GET" && req.url.startsWith("/priority-notifications")) {
      await handlePriority(req, res);
      return;
    }

    send(res, 404, { error: "not found" });
  } catch (err) {
    await Log("backend", "error", "handler", err.message);
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT);
