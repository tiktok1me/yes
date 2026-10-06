require("dotenv").config();

const express = require("express");
const axios = require("axios");
const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const adapter = new JSONFile("db.json");
const db = new Low(adapter, {
  contestants: [
    { id: 1, name: "Contestant 1", votes: 0 },
    { id: 2, name: "Contestant 2", votes: 0 },
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
    "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";

  const response = await axios.get(url, {
    headers: { Authorization: `Basic ${auth}` }
  });

  return response.data.access_token;
}

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
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
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