/**
 * Register a confirmed test account:
 *  1. create a disposable inbox on mail.tm
 *  2. sign up on Supabase with it
 *  3. poll the inbox for the confirmation email and follow the verify link
 * Prints the credentials at the end.
 */
const SUPABASE_URL = "https://acecxckmvlaxygbvubub.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjZWN4Y2ttdmxheHlnYnZ1YnViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5MzI2MzksImV4cCI6MjA5ODUwODYzOX0.T1B7jnNAmDeB8pWGq4cmmct6Fa7mS-oJjW2szcUlxBE";
const PASSWORD = "TestAgent!7726Pass";

const MAILTM = "https://api.mail.tm";

async function mailtmJson(path: string, init?: RequestInit) {
  const res = await fetch(`${MAILTM}${path}`, init);
  if (!res.ok) throw new Error(`mail.tm ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  // 1. disposable inbox
  const domains = (await mailtmJson("/domains")) as { "hydra:member": Array<{ domain: string }> };
  const domain = domains["hydra:member"][0]?.domain;
  if (!domain) throw new Error("no mail.tm domain available");
  const requestedEmail = `makerstest${Date.now()}@${domain}`;
  const account = (await mailtmJson("/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: requestedEmail, password: PASSWORD }),
  })) as { address: string };
  // mail.tm may normalize the address; use exactly what it stored.
  const email = account.address;
  console.log("mail.tm account:", email);
  let tokenRes: { token: string } | null = null;
  for (let attempt = 0; attempt < 5 && !tokenRes; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      tokenRes = (await mailtmJson("/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: email, password: PASSWORD }),
      })) as { token: string };
    } catch (err) {
      console.log(`token attempt ${attempt + 1} failed: ${(err as Error).message.slice(0, 120)}`);
    }
  }
  if (!tokenRes) throw new Error("could not get mail.tm token");
  console.log("inbox created:", email);

  // 2. Supabase signup
  const signupRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      data: { full_name: "Test Agent" },
      options: { email_redirect_to: "http://localhost:8080/" },
    }),
  });
  const signupJson = await signupRes.json();
  if (!signupRes.ok) throw new Error(`signup failed: ${JSON.stringify(signupJson)}`);
  console.log("signup ok, user id:", signupJson.id || signupJson.user?.id);

  // 3. poll inbox for the confirmation email
  const authHeaders = { Authorization: `Bearer ${tokenRes.token}` };
  let verifyUrl: string | null = null;
  for (let attempt = 0; attempt < 30 && !verifyUrl; attempt++) {
    await new Promise((r) => setTimeout(r, 4000));
    const messages = (await mailtmJson("/messages", { headers: authHeaders })) as {
      "hydra:member": Array<{ id: string; subject: string }>;
    };
    const msg = messages["hydra:member"][0];
    if (!msg) {
      process.stdout.write(".");
      continue;
    }
    console.log(`\nemail received: "${msg.subject}"`);
    const full = (await mailtmJson(`/messages/${msg.id}`, { headers: authHeaders })) as {
      text?: string;
      html?: string[];
    };
    const body = `${full.text || ""}\n${(full.html || []).join("\n")}`;
    const match =
      body.match(/https:\/\/[^\s"'<>\])]+\/verify[^\s"'<>\])]*/i) ||
      body.match(/https:\/\/email\.auth\.lovable\.cloud\/c\/[^\s"'<>\])]+/i);
    verifyUrl = match ? match[0].replace(/&amp;/g, "&") : null;
    if (!verifyUrl) console.log("no verify link found in body:\n", body.slice(0, 1500));
  }
  if (!verifyUrl) throw new Error("confirmation email never arrived");
  console.log("verify url:", verifyUrl.slice(0, 120), "...");

  // 4. follow the link chain (tracking redirect -> Supabase /verify -> app)
  let current: string | null = verifyUrl;
  for (let hop = 0; hop < 6 && current; hop++) {
    const res: Response = await fetch(current, { redirect: "manual" });
    const location = res.headers.get("location");
    console.log(`hop ${hop}: ${res.status} ${current.slice(0, 90)} -> ${location?.slice(0, 90) || "(end)"}`);
    if (!location) break;
    if (location.startsWith("http://localhost")) {
      console.log("reached app redirect, confirmation done");
      break;
    }
    current = new URL(location, current).toString();
  }

  // 5. prove the login works
  const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const loginJson = await loginRes.json();
  console.log("login check:", loginRes.ok ? `OK user=${loginJson.user?.id}` : `FAILED ${JSON.stringify(loginJson)}`);

  console.log("\n=== CREDENTIALS ===");
  console.log("email:", email);
  console.log("password:", PASSWORD);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
