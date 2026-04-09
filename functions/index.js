const functions = require("firebase-functions/v2");
const admin = require("firebase-admin");
admin.initializeApp();

exports.nightlyKasaSync = functions.scheduler.onSchedule(
  { schedule: "0 0 * * *", timeZone: "Europe/Istanbul", region: "europe-west1" },
  async () => {
    const db = admin.database();
    const snap = await db.ref("liveRates").once("value");
    const live = snap.val();
    if (live) {
      const kasaRates = {};
      ["EUR", "USD", "GBP", "CHF"].forEach((k) => { if (live[k]) kasaRates[k] = live[k]; });
      kasaRates.updatedAt = new Date().toISOString();
      await db.ref("kasaRates").set(kasaRates);
      console.log("kasaRates güncellendi:", kasaRates);
    }
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const oldSnap = await db.ref("kasaFisler").orderByChild("date").endAt(weekAgo).once("value");
    const updates = {};
    oldSnap.forEach((child) => { updates[child.key] = null; });
    if (Object.keys(updates).length > 0) {
      await db.ref("kasaFisler").update(updates);
      console.log("Eski fişler silindi:", Object.keys(updates).length);
    }
  }
);
