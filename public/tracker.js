/**
 * First-party source tracker MVP
 * Embed: <script src="https://YOUR_DOMAIN/tracker.js?site_id=YOUR_SITE_ID"></script>
 *
 * Captures: landing_url, referrer, utm_*, gclid, fbclid, yclid, ttclid, visitor_id
 * Persists: visitor_id in first-party cookie (1 year), sends to backend
 * First-touch: first visit (no cookie); Last-touch: every visit
 *
 * Transport: pixel-only (temporary for Safari/incognito stability).
 */
(function () {
  "use strict";

  if (typeof window !== "undefined" && window.__AS_TRACKER_LOADED__) return;
  if (typeof window !== "undefined") window.__AS_TRACKER_LOADED__ = true;

  var script = document.currentScript;
  if (!script || !script.src) {
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var s = scripts[i];
      if (s.src && s.src.indexOf("tracker.js") !== -1) {
        script = s;
        break;
      }
    }
  }
  if (!script || !script.src) return;

  var scriptUrl;
  try {
    scriptUrl = new URL(script.src);
  } catch (e) {
    return;
  }

  var siteId = (script && script.getAttribute("data-project-id")) || scriptUrl.searchParams.get("site_id");
  var ingestKey = (script && script.getAttribute("data-ingest-key")) || scriptUrl.searchParams.get("ingest_key");
  if (!siteId) return;

  console.log("[as-tracker] tracker initialized", { site_id: siteId });

  var apiBase = scriptUrl.origin;
  var pixelEndpoint = apiBase + "/api/tracking/source/pixel";
  var cookieName = "as_visitor";
  var cookieMaxAge = 365 * 24 * 60 * 60;

  function getQueryParam(name) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name) || "";
  }

  function getOrCreateVisitorId() {
    try {
      var match = document.cookie.match(new RegExp("(?:^|; )" + cookieName + "=([^;]*)"));
      var id = match ? decodeURIComponent(match[1]) : null;
      if (!id || id.length < 10) {
        id = "v_" + Math.random().toString(36).slice(2) + "_" + Date.now().toString(36);
        document.cookie =
          cookieName + "=" + encodeURIComponent(id) + "; path=/; max-age=" + cookieMaxAge + "; SameSite=Lax";
      }
      return id;
    } catch (e) {
      return "v_" + Math.random().toString(36).slice(2) + "_" + Date.now().toString(36);
    }
  }

  function isFirstVisit() {
    try {
      return !document.cookie.match(new RegExp("(?:^|; )" + cookieName + "="));
    } catch (e) {
      return true;
    }
  }

  var firstVisit = isFirstVisit();
  var visitorId = getOrCreateVisitorId();
  if (!visitorId || visitorId.length < 10) {
    visitorId = "v_" + Math.random().toString(36).slice(2) + "_" + Date.now().toString(36);
  }

  try {
    if (typeof window !== "undefined") window.boardiqVisitorId = visitorId;
    try { localStorage.setItem("boardiq_visitor_id", visitorId); } catch (e) {}
  } catch (e) {}

  function getSessionId() {
    try {
      var key = "boardiq_session_id";
      var s = sessionStorage.getItem(key);
      if (!s) {
        s = "s_" + Math.random().toString(36).slice(2) + "_" + Date.now().toString(36);
        sessionStorage.setItem(key, s);
      }
      return s;
    } catch (e) { return ""; }
  }

  function getFbCookie(name) {
    try {
      var match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
      return match ? decodeURIComponent(match[1]) : "";
    } catch (e) { return ""; }
  }

  var sessionId = getSessionId();
  var fbp = getFbCookie("_fbp");
  var fbc = getFbCookie("_fbc");

  var clickId = getQueryParam("bqcid") || "";
  if (clickId) try { sessionStorage.setItem("boardiq_click_id", clickId); } catch (e) {}
  if (!clickId) try { clickId = sessionStorage.getItem("boardiq_click_id") || ""; } catch (e) {}
  var visitId = "bqvid_" + Math.random().toString(36).slice(2) + "_" + Date.now().toString(36);

  var payload = {
    visitor_id: visitorId,
    site_id: siteId,
    session_id: sessionId,
    page_url: window.location.href,
    landing_url: window.location.href,
    referrer: document.referrer || "",
    utm_source: getQueryParam("utm_source"),
    utm_medium: getQueryParam("utm_medium"),
    utm_campaign: getQueryParam("utm_campaign"),
    utm_content: getQueryParam("utm_content"),
    utm_term: getQueryParam("utm_term"),
    fbclid: getQueryParam("fbclid"),
    gclid: getQueryParam("gclid"),
    ttclid: getQueryParam("ttclid"),
    yclid: getQueryParam("yclid"),
    fbp: fbp || undefined,
    fbc: fbc || undefined,
    touch_type: firstVisit ? "first" : "last",
    click_id: clickId || undefined,
    visit_id: visitId,
  };

  console.log("[as-tracker] payload snapshot", payload);

  // Send on EVERY page load - no gate on UTM/referrer/click IDs. Direct visits must be recorded.
  var params = new URLSearchParams();
  params.set("visitor_id", visitorId);
  params.set("site_id", siteId);
  params.set("landing_url", (payload.landing_url || "").slice(0, 500));
  params.set("referrer", (payload.referrer || "").slice(0, 500));
  params.set("touch_type", payload.touch_type);
  params.set("_ts", String(Date.now()));
  if (payload.utm_source) params.set("utm_source", payload.utm_source);
  if (payload.utm_medium) params.set("utm_medium", payload.utm_medium);
  if (payload.utm_campaign) params.set("utm_campaign", payload.utm_campaign);
  if (payload.utm_content) params.set("utm_content", payload.utm_content);
  if (payload.utm_term) params.set("utm_term", payload.utm_term);
  if (payload.gclid) params.set("gclid", payload.gclid);
  if (payload.fbclid) params.set("fbclid", payload.fbclid);
  if (payload.yclid) params.set("yclid", payload.yclid);
  if (payload.ttclid) params.set("ttclid", payload.ttclid);
  if (payload.session_id) params.set("session_id", payload.session_id);
  if (payload.fbp) params.set("fbp", payload.fbp);
  if (payload.fbc) params.set("fbc", payload.fbc);
  if (payload.click_id) params.set("click_id", payload.click_id);
  params.set("visit_id", payload.visit_id);
  if (ingestKey) params.set("ingest_key", ingestKey);

  var pixelUrl = pixelEndpoint + "?" + params.toString();
  console.log("[as-tracker] pixel URL built", { url: pixelUrl.slice(0, 150) + (pixelUrl.length > 150 ? "..." : "") });

  var img = new Image(1, 1);
  img.src = pixelUrl;

  console.log("[as-tracker] pixel beacon sent");

  if (typeof window !== "undefined") {
    function sleep(ms) { return new Promise(function(resolve) { setTimeout(resolve, ms); }); }
    function buildConversionIdempotency(eventName) {
      var key = "boardiq_conv_" + eventName + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
      return key;
    }
    async function postConversionWithRetry(payload, options) {
      var endpoint = apiBase + "/api/tracking/conversion";
      var maxAttempts = (options && options.maxAttempts) || 3;
      var baseDelay = (options && options.baseDelayMs) || 300;
      var idem = payload.external_event_id || buildConversionIdempotency(payload.event_name || "event");
      payload.external_event_id = payload.external_event_id || idem;
      for (var attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          var res = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-BoardIQ-Key": ingestKey || "",
              "X-BoardIQ-Idempotency-Token": idem,
            },
            body: JSON.stringify(payload),
            keepalive: true,
            credentials: "omit",
          });
          if (res.ok) return true;
          if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
        } catch (e) {
          // Continue retry loop below.
        }
        if (attempt < maxAttempts) {
          await sleep(baseDelay * Math.pow(2, attempt - 1));
        }
      }
      if (navigator && typeof navigator.sendBeacon === "function") {
        try {
          var blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
          return navigator.sendBeacon(endpoint, blob);
        } catch (e2) {}
      }
      return false;
    }

    window.BoardIQ = {
      getVisitorId: function() { return getOrCreateVisitorId(); },
      getSessionId: function() { return getSessionId(); },
      getClickId: function() {
        var q = getQueryParam("bqcid");
        if (q) return q;
        try { return sessionStorage.getItem("boardiq_click_id") || ""; } catch (e) { return ""; }
      },
      trackConversion: function(eventName, data) {
        if (!ingestKey || !siteId) return Promise.resolve(false);
        var d = data || {};
        var payload = {
          project_id: siteId,
          event_name: eventName,
          event_time: new Date().toISOString(),
          visitor_id: (d.visitor_id || window.boardiqVisitorId || ""),
          session_id: (d.session_id || getSessionId() || ""),
          click_id: (d.click_id || window.BoardIQ.getClickId() || ""),
          value: d.value != null ? d.value : undefined,
          currency: d.currency || undefined,
          user_external_id: d.user_external_id || undefined,
          external_event_id: d.external_event_id || undefined,
          utm_source: d.utm_source || getQueryParam("utm_source") || undefined,
          utm_medium: d.utm_medium || getQueryParam("utm_medium") || undefined,
          utm_campaign: d.utm_campaign || getQueryParam("utm_campaign") || undefined,
          utm_content: d.utm_content || getQueryParam("utm_content") || undefined,
          utm_term: d.utm_term || getQueryParam("utm_term") || undefined,
          fbclid: d.fbclid || getQueryParam("fbclid") || undefined,
          gclid: d.gclid || getQueryParam("gclid") || undefined,
          ttclid: d.ttclid || getQueryParam("ttclid") || undefined,
          yclid: d.yclid || getQueryParam("yclid") || undefined,
          fbp: d.fbp || getFbCookie("_fbp") || undefined,
          fbc: d.fbc || getFbCookie("_fbc") || undefined,
          referrer: d.referrer || document.referrer || undefined,
          metadata: d.metadata || {},
        };
        return postConversionWithRetry(payload, d.retry_options || undefined);
      },
    };
  }
})();
