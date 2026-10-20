require("dotenv").config();

const express = require("express");
const axios = require("axios");
const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const MPESA_BASE_URL = process.env.MPESA_ENV === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const adapter = new JSONFile("db.json");
const db = new Low(adapter, {
  contestants: [
    { id: 1, name: "MY KIMMY 1", votes: 0 },
    { id: 2, name: "AFRO SINEMA 2", votes: 0 },
    { id: 3, name: "Contestant 3", votes: 0 },
    { id: 4, name: "Contestant 4", votes: 0 },
    { id: 5, name: "Contestant 5", votes: 0 },
    { id: 6, name: "Contestant 6", votes: 0 },
    { id: 7, name: "Contestant 7", votes: 0 },
    { id: 8, name: "Contestant 8", votes: 0 },
    { id: 9, name: "Contestant 9", votes: 0 },
    { id: 10, name: "Contestant 10", votes: 0 }
  ],
  transactions: []
});

async function loadDb() {
  await db.read();
  if (!db.data) {
    db.data = { contestants: [], transactions: [] };
    await db.write();
  }
}

async function getAccessToken() {
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;

  if (!key || !secret) {
    throw new Error("M-Pesa Consumer Key/Secret are not configured.");
  }

  const auth = Buffer.from(`${key}:${secret}`).toString("base64");
  const url = process.env.MPESA_AUTH_URL ||
    `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`;

  const response = await axios.get(url, {
    headers: { Authorization: `Basic ${auth}` }
  });

  return response.data.access_token;
}


// ---------------- Social account OAuth (Facebook, Instagram, TikTok) ----------------
// OAuth secrets stay on the server. Only approved public profile details are sent to
// the browser; access tokens are never placed in URLs or localStorage.
function socialBaseUrl(req) {
  const configured = process.env.SOCIAL_BASE_URL || process.env.RENDER_EXTERNAL_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = forwardedProto ? String(forwardedProto).split(",")[0] : req.protocol;
  return protocol + "://" + req.get("host");
}
function socialRedirectUri(req, provider) {
  return socialBaseUrl(req) + "/auth/" + provider + "/callback";
}
function setSocialStateCookie(res, provider, state, req) {
  const secure = Boolean(req.secure || String(req.headers["x-forwarded-proto"] || "").includes("https"));
  res.setHeader("Set-Cookie", "ttcm_oauth_" + provider + "=" + encodeURIComponent(state) + "; Max-Age=600; Path=/; HttpOnly; SameSite=Lax" + (secure ? "; Secure" : ""));
}
function readCookie(req, name) {
  const cookies = String(req.headers.cookie || "").split(";").map(part => part.trim());
  const entry = cookies.find(part => part.startsWith(name + "="));
  if (!entry) return "";
  try { return decodeURIComponent(entry.slice(name.length + 1)); } catch { return ""; }
}
function clearSocialStateCookie(res, provider, req) {
  const secure = Boolean(req.secure || String(req.headers["x-forwarded-proto"] || "").includes("https"));
  res.setHeader("Set-Cookie", "ttcm_oauth_" + provider + "=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax" + (secure ? "; Secure" : ""));
}
function safeSocialText(value) {
  return String(value || "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]);
}
function socialResultPage(res, profile, provider) {
  const safeProfileJson = JSON.stringify(profile).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  const label = provider === "facebook" ? "Facebook" : provider === "instagram" ? "Instagram" : "TikTok";
  const html = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Social account connected</title><body style="font-family:Arial,sans-serif;background:#111827;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0"><main style="max-width:520px;margin:20px;padding:28px;border-radius:20px;background:#1f2937;text-align:center"><h1>' + label + ' connection</h1><p>Authorization completed. Returning to tiktokchallengeme…</p><p id="status">Saving approved public profile information on this device.</p><a href="/" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#25f4ee;color:#111827;text-decoration:none;font-weight:bold">Return to tiktokchallengeme</a></main><script>try { const p=' + safeProfileJson + '; localStorage.setItem("tiktokchallengeme_social_' + provider + '", JSON.stringify(p)); document.getElementById("status").textContent = "Connected as " + (p.displayName || p.username || "' + label + ' user") + ". Only approved public profile details were saved in this browser."; } catch(e) { document.getElementById("status").textContent = "Connected. Return to the website to continue."; } setTimeout(() => { window.location.replace("/#social-connections"); }, 1800);</script></body></html>';
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(html);
}
function socialSetupNeeded(res, provider, message, req) {
  const guide = provider === "tiktok" ? "https://developers.tiktok.com/" : "https://developers.facebook.com/apps/";
  const redirect = safeSocialText(socialRedirectUri(req, provider));
  res.status(503).type("html").send('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Social login setup needed</title><body style="font-family:Arial,sans-serif;max-width:720px;margin:40px auto;padding:20px;line-height:1.6"><h1>One-time developer setup needed</h1><p>' + safeSocialText(message) + '</p><p>Create/configure the ' + (provider === "tiktok" ? "TikTok" : provider === "instagram" ? "Instagram through Meta" : "Facebook through Meta") + ' developer app, then add the required credentials to Render environment variables.</p><p>Developer portal: <a href="' + guide + '" rel="noopener">' + guide + '</a></p><p>Register this exact redirect URI: <code>' + redirect + '</code></p><p><a href="/">Return to tiktokchallengeme</a></p></body></html>');
}

app.get("/auth/facebook", (req, res) => {
  const appId = process.env.META_APP_ID;
  if (!appId || !process.env.META_APP_SECRET) return socialSetupNeeded(res, "facebook", "Facebook login is not active yet because META_APP_ID and META_APP_SECRET are not configured.", req);
  const state = crypto.randomBytes(32).toString("hex");
  setSocialStateCookie(res, "facebook", state, req);
  const version = process.env.META_GRAPH_VERSION || "v25.0";
  const url = new URL("https://www.facebook.com/" + version + "/dialog/oauth");
  url.search = new URLSearchParams({ client_id: appId, redirect_uri: socialRedirectUri(req, "facebook"), state, response_type: "code", scope: "public_profile" }).toString();
  res.redirect(url.toString());
});
app.get("/auth/facebook/callback", async (req, res) => {
  const stateCookie = readCookie(req, "ttcm_oauth_facebook");
  clearSocialStateCookie(res, "facebook", req);
  if (!stateCookie || !req.query.state || req.query.state !== stateCookie) return res.status(400).send("Facebook sign-in state check failed. Please try again.");
  if (req.query.error || !req.query.code) return res.status(400).send("Facebook sign-in was cancelled or denied. Return to the website and try again.");
  try {
    const version = process.env.META_GRAPH_VERSION || "v25.0";
    const redirectUri = socialRedirectUri(req, "facebook");
    const tokenResponse = await axios.get("https://graph.facebook.com/" + version + "/oauth/access_token", { params: { client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET, redirect_uri: redirectUri, code: req.query.code } });
    const profileResponse = await axios.get("https://graph.facebook.com/" + version + "/me", { params: { fields: "id,name,picture.type(large)", access_token: tokenResponse.data.access_token } });
    const p = profileResponse.data;
    socialResultPage(res, { provider:"facebook", displayName:p.name || "Facebook user", username:"", profileUrl:"https://www.facebook.com/profile.php?id=" + encodeURIComponent(p.id), avatarUrl:(p.picture && p.picture.data && p.picture.data.url) || "", platformId:p.id }, "facebook");
  } catch (error) {
    console.error("Facebook OAuth error:", error.response && error.response.data || error.message);
    res.status(502).send("Facebook could not complete the connection. Check the Meta app settings and redirect URI, then try again.");
  }
});

app.get("/auth/instagram", (req, res) => {
  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appId || !appSecret) return socialSetupNeeded(res, "instagram", "Instagram login is not active yet. Configure the Instagram API with Instagram Login and add INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET in Render.", req);
  const state = crypto.randomBytes(32).toString("hex");
  setSocialStateCookie(res, "instagram", state, req);
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.search = new URLSearchParams({ client_id: appId, redirect_uri: socialRedirectUri(req, "instagram"), response_type: "code", scope: "instagram_business_basic", state, enable_fb_login: "0", force_authentication: "1" }).toString();
  res.redirect(url.toString());
});
app.get("/auth/instagram/callback", async (req, res) => {
  const stateCookie = readCookie(req, "ttcm_oauth_instagram");
  clearSocialStateCookie(res, "instagram", req);
  if (!stateCookie || !req.query.state || req.query.state !== stateCookie) return res.status(400).send("Instagram sign-in state check failed. Please try again.");
  if (req.query.error || !req.query.code) return res.status(400).send("Instagram sign-in was cancelled or denied. Return to the website and try again.");
  try {
    const appId = process.env.INSTAGRAM_APP_ID;
    const appSecret = process.env.INSTAGRAM_APP_SECRET;
    const redirectUri = socialRedirectUri(req, "instagram");
    const tokenBody = new URLSearchParams({ client_id: appId, client_secret: appSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code: String(req.query.code) });
    const tokenResponse = await axios.post("https://api.instagram.com/oauth/access_token", tokenBody.toString(), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    const profileResponse = await axios.get("https://graph.instagram.com/me", { params: { fields: "id,username,account_type", access_token: tokenResponse.data.access_token } });
    const p = profileResponse.data;
    socialResultPage(res, { provider:"instagram", displayName:p.username || "Instagram user", username:p.username || "", profileUrl:p.username ? "https://www.instagram.com/" + encodeURIComponent(p.username) + "/" : "https://www.instagram.com/", avatarUrl:"", platformId:p.id, accountType:p.account_type || "" }, "instagram");
  } catch (error) {
    console.error("Instagram OAuth error:", error.response && error.response.data || error.message);
    res.status(502).send("Instagram could not complete the connection. Check Instagram API with Instagram Login, the allowed redirect URI, and tester/app review status.");
  }
});

app.get("/auth/tiktok", (req, res) => {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  if (!clientKey || !process.env.TIKTOK_CLIENT_SECRET) return socialSetupNeeded(res, "tiktok", "TikTok Login Kit is not active yet because TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET are not configured.", req);
  const state = crypto.randomBytes(32).toString("hex");
  setSocialStateCookie(res, "tiktok", state, req);
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.search = new URLSearchParams({ client_key: clientKey, response_type: "code", scope: "user.info.basic", redirect_uri: socialRedirectUri(req, "tiktok"), state, disable_auto_auth: "1" }).toString();
  res.redirect(url.toString());
});
app.get("/auth/tiktok/callback", async (req, res) => {
  const stateCookie = readCookie(req, "ttcm_oauth_tiktok");
  clearSocialStateCookie(res, "tiktok", req);
  if (!stateCookie || !req.query.state || req.query.state !== stateCookie) return res.status(400).send("TikTok sign-in state check failed. Please try again.");
  if (req.query.error || !req.query.code) return res.status(400).send("TikTok sign-in was cancelled or denied. Return to the website and try again.");
  try {
    const redirectUri = socialRedirectUri(req, "tiktok");
    const tokenBody = new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY, client_secret: process.env.TIKTOK_CLIENT_SECRET, code: String(req.query.code), grant_type: "authorization_code", redirect_uri: redirectUri });
    const tokenResponse = await axios.post("https://open.tiktokapis.com/v2/oauth/token/", tokenBody.toString(), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    const accessToken = tokenResponse.data.access_token;
    const profileResponse = await axios.get("https://open.tiktokapis.com/v2/user/info/", { params: { fields: "open_id,display_name,avatar_url,profile_deep_link" }, headers: { Authorization: "Bearer " + accessToken } });
    const p = profileResponse.data && profileResponse.data.data && profileResponse.data.data.user || {};
    socialResultPage(res, { provider:"tiktok", displayName:p.display_name || "TikTok user", username:"", profileUrl:p.profile_deep_link || "https://www.tiktok.com/", avatarUrl:p.avatar_url || "", platformId:p.open_id || "" }, "tiktok");
  } catch (error) {
    console.error("TikTok OAuth error:", error.response && error.response.data || error.message);
    res.status(502).send("TikTok could not complete the connection. Check Login Kit, the exact redirect URI, app status, and requested scopes.");
  }
});
// -------------------------------------------------------------------------------

app.get("/api/contestants", async (req, res) => {
  await loadDb();
  res.json(db.data.contestants);
});

app.post("/api/stkpush", async (req, res) => {
  try {
    const { contestantId, phone, votes } = req.body;
    const contestant = db.data.contestants.find(c => c.id === Number(contestantId));
    const voteCount = Number(votes);

    if (!contestant) return res.status(400).json({ error: "Invalid contestant." });
    if (!/^2547\d{8}$/.test(String(phone))) {
      return res.status(400).json({ error: "Use phone format 2547XXXXXXXX." });
    }
    if (!Number.isInteger(voteCount) || voteCount < 1 || voteCount > 100) {
      return res.status(400).json({ error: "Votes must be a whole number from 1 to 100." });
    }

    const amount = voteCount; // KSh 1 per vote
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);

    const shortCode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;
    const callbackUrl = process.env.MPESA_CALLBACK_URL;

    if (!shortCode || !passkey || !callbackUrl) {
      return res.status(503).json({
        error: "M-Pesa is not configured yet. Add the sandbox credentials in environment variables."
      });
    }

    const token = await getAccessToken();
    const password = Buffer.from(`${shortCode}${passkey}${timestamp}`).toString("base64");

    const payload = {
      BusinessShortCode: shortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: shortCode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: `TIKTOKVOTE-${contestant.id}`,
      TransactionDesc: `Vote for ${contestant.name}`
    };

    const response = await axios.post(
      `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
      payload,
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );

    db.data.transactions.push({
      merchantRequestId: response.data.MerchantRequestID,
      checkoutRequestId: response.data.CheckoutRequestID,
      contestantId: contestant.id,
      phoneLast4: phone.slice(-4),
      votes: voteCount,
      amount,
      status: "PENDING",
      createdAt: new Date().toISOString()
    });
    await db.write();

    res.json({
      success: true,
      message: "STK Push sent. Complete the payment on your phone.",
      checkoutRequestId: response.data.CheckoutRequestID
    });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: "Unable to start M-Pesa payment." });
  }
});

app.get("/api/payment/:checkoutRequestId", async (req, res) => {
  await loadDb();
  const tx = db.data.transactions.find(t => t.checkoutRequestId === req.params.checkoutRequestId);
  if (!tx) return res.status(404).json({ error: "Payment not found." });
  res.json({
    status: tx.status,
    votes: tx.votes,
    resultDesc: tx.resultDesc || null,
    receipt: tx.mpesaReceiptNumber || null
  });
});

app.post("/api/mpesa/callback", async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;
    const checkoutRequestId = callback?.CheckoutRequestID;

    if (checkoutRequestId) {
      const tx = db.data.transactions.find(
        t => t.checkoutRequestId === checkoutRequestId
      );

      if (tx) {
        const success = callback.ResultCode === 0;
        tx.status = success ? "PAID" : "FAILED";
        tx.resultCode = callback.ResultCode;
        tx.resultDesc = callback.ResultDesc;

        if (success && !tx.votesApplied) {
          const contestant = db.data.contestants.find(c => c.id === tx.contestantId);
          if (contestant) {
            contestant.votes += tx.votes;
            tx.votesApplied = true;
          }
        }
        await db.write();
      }
    }

    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (error) {
    console.error("Callback error:", error);
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

loadDb().then(() => {
  app.listen(PORT, () => console.log(`tiktokchallengeme running on port ${PORT}`));
});
