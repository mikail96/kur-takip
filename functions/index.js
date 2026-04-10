const functions = require("firebase-functions/v2");
const admin = require("firebase-admin");
const https = require("https");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  databaseURL: "https://ramex-kasa-default-rtdb.europe-west1.firebasedatabase.app"
});

const MARJ_ORAN = 0.10;
const WORKER_URL = "https://kur-proxy.mikailaymaz1.workers.dev";

function fetchTCMB() {
  return new Promise((resolve, reject) => {
    https.get(WORKER_URL, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function parseRates(xml) {
  const rates = {};
  const kodlar = ["EUR", "USD", "GBP", "CHF"];
  kodlar.forEach((kod) => {
    const regex = new RegExp('<Currency[^>]*Kod="' + kod + '"[^>]*>[\\s\\S]*?<BanknoteBuying>([^<]+)<\\/BanknoteBuying>', "i");
    const match = xml.match(regex);
    if (match && match[1]) {
      const val = parseFloat(match[1].replace(",", "."));
      if (val > 0) rates[kod] = val;
    }
  });
  return rates;
}

// Her gün 16:00 (TCMB 15:30'da günceller) → TCMB'den çek, liveRates'e yaz
exports.fetchLiveRates = functions.scheduler.onSchedule(
  {
    schedule: "0 16 * * 1-5",
    timeZone: "Europe/Istanbul",
    region: "europe-west1",
    timeoutSeconds: 120
  },
  async () => {
    const db = admin.database();
    try {
      const xml = await fetchTCMB();
      const rates = parseRates(xml);
      if (rates.EUR) {
        rates.updatedAt = new Date().toISOString();
        await db.ref("liveRates").set(rates);
        console.log("liveRates güncellendi:", JSON.stringify(rates));
      } else {
        console.log("TCMB verisi alınamadı");
      }
    } catch (e) {
      console.error("TCMB fetch hatası:", e.message);
    }
  }
);

// Her gece 00:00 → liveRates'ten kasaRates'e kopyala (marjlı) + eski fişleri sil
exports.nightlyKasaSync = functions.scheduler.onSchedule(
  {
    schedule: "0 0 * * *",
    timeZone: "Europe/Istanbul",
    region: "europe-west1",
    timeoutSeconds: 120
  },
  async () => {
    const db = admin.database();
    try {
      const snap = await db.ref("liveRates").once("value");
      const live = snap.val();
      if (live) {
        const kasaRates = {};
        ["EUR", "USD", "GBP", "CHF"].forEach((k) => {
          if (live[k]) kasaRates[k] = +(live[k] * (1 - MARJ_ORAN)).toFixed(4);
        });
        kasaRates.updatedAt = new Date().toISOString();
        await db.ref("kasaRates").set(kasaRates);
        console.log("kasaRates güncellendi:", JSON.stringify(kasaRates));
      } else {
        console.log("liveRates boş");
      }
    } catch (e) {
      console.error("kasaRates hatası:", e.message);
    }
    try {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const oldSnap = await db.ref("kasaFisler").orderByChild("date").endAt(weekAgo).once("value");
      const updates = {};
      oldSnap.forEach((child) => { updates[child.key] = null; });
      if (Object.keys(updates).length > 0) {
        await db.ref("kasaFisler").update(updates);
        console.log("Eski fişler silindi:", Object.keys(updates).length);
      }
    } catch (e) {
      console.error("Fiş silme hatası:", e.message);
    }
  }
);
