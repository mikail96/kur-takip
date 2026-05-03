const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { logger } = require("firebase-functions");

initializeApp();

const KASA_MARGIN = 0.9; // TCMB efektif alış × 0.9

exports.nightlyKasaSync = onSchedule(
  { schedule: "0 0 * * *", timeZone: "Europe/Istanbul", region: "europe-west1" },
  async () => {
    const db = getDatabase();

    // 1) Mevcut kasaRates'i previousKasaRates'e yedekle (gün sonu 02:00 grace için)
    try {
      const prevSnap = await db.ref("kasaRates").once("value");
      const prevKasa = prevSnap.val();
      if (prevKasa && typeof prevKasa === "object") {
        await db.ref("previousKasaRates").set(prevKasa);
        logger.info("previousKasaRates yedeklendi", prevKasa);
      }
    } catch (e) {
      logger.warn("previousKasaRates yedek alınamadı:", e.message);
    }

    // 2) liveRates -> kasaRates  (× 0.9 marjı uygulanır)
    const snap = await db.ref("liveRates").once("value");
    const live = snap.val();
    if (live) {
      const kasaRates = {};
      ["EUR", "USD", "GBP", "CHF"].forEach((k) => {
        if (typeof live[k] === "number" && live[k] > 0) {
          // 4 ondalık yuvarlama
          kasaRates[k] = Math.round(live[k] * KASA_MARGIN * 10000) / 10000;
        }
      });
      kasaRates.updatedAt = new Date().toISOString();
      await db.ref("kasaRates").set(kasaRates);
      logger.info("kasaRates güncellendi (×0.9)", kasaRates);
    }

    // 3) 7 günden eski kasaFisler (mevcut davranış)
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const oldSnap = await db.ref("kasaFisler").orderByChild("date").endAt(weekAgo).once("value");
    const updates = {};
    oldSnap.forEach((child) => { updates[child.key] = null; });
    if (Object.keys(updates).length > 0) {
      await db.ref("kasaFisler").update(updates);
      logger.info("Eski fişler silindi:", Object.keys(updates).length);
    }

    // 4) 7 günden eski gunSonuRaporlar
    try {
      const oldGsSnap = await db.ref("gunSonuRaporlar").orderByChild("date").endAt(weekAgo).once("value");
      const gsUpdates = {};
      oldGsSnap.forEach((child) => { gsUpdates[child.key] = null; });
      if (Object.keys(gsUpdates).length > 0) {
        await db.ref("gunSonuRaporlar").update(gsUpdates);
        logger.info("Eski gün sonu raporları silindi:", Object.keys(gsUpdates).length);
      }
    } catch (e) {
      logger.warn("gunSonuRaporlar temizliği başarısız:", e.message);
    }
  }
);
