import { Router } from "express";
import { buildRouteSearchResponse } from "../services/mainLogic/routeSearch.js";
import { shapeRouteData } from "../services/mainLogic/shapeRouteData.js";
import { apiCodeToRouteKey } from "../services/mainLogic/transportSelection.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const response = await buildRouteSearchResponse(req.query);

    // 画面と同じ「区間（step）」の並びも返す。
    // results（生の RouteOption）はそのまま残すので、今までの使い方は変わらない
    response.way = shapeRouteData(response.results, {
      departure: req.query.location || "Library",
      arrival: "横浜駅",
      routeKey: apiCodeToRouteKey(req.query.routepattern ?? 1),
    });

    res.set("Cache-Control", "no-store");
    return res.json(response);
  } catch (err) {
    console.error("[Fatal Error]", err);
    next(err);
  }
});

export default router;
