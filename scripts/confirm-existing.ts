/** Follow the confirmation link for the already-registered test account and verify login. */
const SUPABASE_URL = "https://acecxckmvlaxygbvubub.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjZWN4Y2ttdmxheHlnYnZ1YnViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5MzI2MzksImV4cCI6MjA5ODUwODYzOX0.T1B7jnNAmDeB8pWGq4cmmct6Fa7mS-oJjW2szcUlxBE";

const EMAIL = "makerstest1783449343293@web-library.net";
const PASSWORD = "TestAgent!7726Pass";
const VERIFY_URL =
  "https://email.auth.lovable.cloud/c/eJw80UuuozoYBODVmJmR-f3AHjC4UpRtRP4fTlAIcMEkJ7tvoW6dSY1Kn0oqHsSQSCND10frXLIuNY-BkQkADZeQHcbMDjwQWkcMxDY14wAGgulN30XrXWrJ9j7m0huG4h2yciYf9dFOyzvjJC1Ny8HNNDxqXXdl_1NwVXDNJPRDz9d7yj_fO74PPLDdjzVj3qWl5awc9aHg-u7OkG0sX2Wvm_C4CdVbXZS9_DXBn6o_XQ_X_z8y6_2xfLZjnmXTr3wf6XdNXlcFoS5PmZW9RI4QQ4kJmRjZBuGIgVLqIEsisIlsoCDZcpYSPCFG8V06ie8qyl728T4fa_OPv71k3_NdbiMPlnzvSyza9KXTTpzRWBJqjMUQdL1xlptteOWnbHuVvf7-YCFZ5cxHUE8jbnn7trPUpg4IiSmGrLmLpJ1xXiMEp50lH3OXkVia9wB_AgAA__-S8pRv";

async function main() {
  let current: string | null = VERIFY_URL;
  for (let hop = 0; hop < 8 && current; hop++) {
    const res: Response = await fetch(current, { redirect: "manual" });
    const location = res.headers.get("location");
    console.log(`hop ${hop}: ${res.status} ${current.slice(0, 80)}`);
    console.log(`   -> ${location || "(end)"}`);
    if (!location) break;
    if (location.startsWith("http://localhost")) {
      console.log("reached app redirect, confirmation done");
      break;
    }
    current = new URL(location, current).toString();
  }

  const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const loginJson = await loginRes.json();
  console.log("\nlogin check:", loginRes.ok ? `OK user=${loginJson.user?.id}` : `FAILED ${JSON.stringify(loginJson)}`);
  console.log("\n=== CREDENTIALS ===");
  console.log("email:", EMAIL);
  console.log("password:", PASSWORD);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
