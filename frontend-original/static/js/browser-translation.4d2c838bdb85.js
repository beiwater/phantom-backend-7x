(function (window) {
  var STORAGE_KEY = "sc-disable-browser-translation";

  function applyDisableBrowserTranslationAttributes() {
    document.documentElement.setAttribute("translate", "no");
    document.documentElement.classList.add("notranslate");

    if (document.body) {
      document.body.setAttribute("translate", "no");
      document.body.classList.add("notranslate");
    }

    var root = document.getElementById("root");
    if (root) {
      root.setAttribute("translate", "no");
      root.classList.add("notranslate");
    }

    if (!document.querySelector("meta[name='google'][content='notranslate']")) {
      var googleNoTranslate = document.createElement("meta");
      googleNoTranslate.name = "google";
      googleNoTranslate.content = "notranslate";
      document.head.appendChild(googleNoTranslate);
    }
  }

  function maybeApplyDisableBrowserTranslationFromStorage() {
    try {
      if (window.localStorage && window.localStorage.getItem(STORAGE_KEY) === "1") {
        applyDisableBrowserTranslationAttributes();

        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", applyDisableBrowserTranslationAttributes);
        }
      }
    } catch (error) {
      // Ignore storage access failures, the game can still load normally.
    }
  }

  function disableBrowserTranslation() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch (error) {
      // Storage can be unavailable in private or locked-down browsers.
    }

    applyDisableBrowserTranslationAttributes();
  }

  window.simCompaniesBrowserTranslation = {
    STORAGE_KEY: STORAGE_KEY,
    applyDisableBrowserTranslationAttributes: applyDisableBrowserTranslationAttributes,
    maybeApplyDisableBrowserTranslationFromStorage: maybeApplyDisableBrowserTranslationFromStorage,
    disableBrowserTranslation: disableBrowserTranslation,
  };
})(window);
