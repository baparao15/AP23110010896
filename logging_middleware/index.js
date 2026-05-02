const LOG_URL = process.env.LOG_URL || "http://20.207.122.201/evaluation-service/logs";

async function Log(stack, level, packageName, message) {
  const token = process.env.ACCESS_TOKEN || "";

  try {
    await fetch(LOG_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {})
      },
      body: JSON.stringify({
        stack,
        level,
        package: packageName,
        message
      })
    });
  } catch (_) {
    // Logging must never stop the main API flow.
  }
}

module.exports = { Log };
