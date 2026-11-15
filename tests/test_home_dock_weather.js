// Regression tests for home weather visibility, the Ambient dock action, and low-cost app focus.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const js = fs.readFileSync(path.join(__dirname, "..", "tv-home", "web", "app.js"), "utf8").replace(/\r\n/g, "\n");
const css = fs.readFileSync(path.join(__dirname, "..", "tv-home", "web", "app.css"), "utf8").replace(/\r\n/g, "\n");
const html = fs.readFileSync(path.join(__dirname, "..", "tv-home", "web", "index.html"), "utf8");
const mock = fs.readFileSync(path.join(__dirname, "..", "tv-home", "web", "mock.js"), "utf8");
const bridge = fs.readFileSync(path.join(__dirname, "..", "bridge", "server.py"), "utf8");
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config.example.json"), "utf8"));

function sourceOf(name) {
  const re = new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}");
  const found = js.match(re);
  assert(found, name + " is present in app.js");
  return found[0];
}

function mockElement() {
  const classes = new Set();
  return {
    innerHTML: "",
    attributes: {},
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name)
    },
    setAttribute: function (key, value) { this.attributes[key] = value; }
  };
}

const node = mockElement();
const forecastNode = mockElement();
const lookup = id => id === "dock-weather" ? node : id === "idle-forecast" ? forecastNode : null;
let weather = { temp: 21, code: 2, is_day: true };
let expanded = false;
let weatherState = "ready";
const renderDockWeather = new Function("$", "WX_SHOW", "data", "expanded", "WXCFG", "wxText", "wxIcon", "esc", "tempText", "WEATHER_STATE", "t",
  sourceOf("renderDockWeather") + "; return renderDockWeather;")(
    lookup, true, { get weather() { return weather; } }, false,
    { place: "Seattle <home>" }, w => w.code === 2 ? "Partly cloudy" : "Rain", () => "<svg></svg>",
    value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    value => value + "°", weatherState, key => ({ weather_loading: "Weather loading…", weather_unavailable: "Weather unavailable" }[key] || key));

renderDockWeather();
assert(node.classList.contains("on"), "the weather pill is visible when weather is available");
assert(node.innerHTML.includes("21°"), "temperature is shown above the app dock");
assert(node.innerHTML.includes("Partly cloudy"), "weather condition is shown");
assert(node.innerHTML.includes("Seattle &lt;home&gt;"), "the place name is escaped before rendering");
assert.strictEqual(node.attributes["aria-label"], "21°, Partly cloudy, Seattle <home>", "the pill has an accessible spoken label");

weather = null;
weatherState = "unavailable";
renderDockWeather();
assert(node.classList.contains("on"), "the home shows a visible diagnostic pill instead of silently hiding failed weather");
assert(node.innerHTML.includes("Weather unavailable"), "the weather pill explains how to troubleshoot a missing reading");
weather = { temp: 21, code: 2, is_day: true };
expanded = true;
const renderExpanded = new Function("$", "WX_SHOW", "data", "expanded", "WXCFG", "wxText", "wxIcon", "esc", "tempText", "WEATHER_STATE", "t",
  sourceOf("renderDockWeather") + "; return renderDockWeather;")(
    lookup, true, { weather }, expanded, { place: "Seattle" }, () => "Clear", () => "<svg></svg>", String, value => value + "°", "ready", key => key);
renderExpanded();
assert(!node.classList.contains("on"), "the weather pill is hidden while the expanded app library is open");

const forecast = Array.from({ length: 5 }, (_, i) => ({ date: `2026-11-${String(14 + i).padStart(2, "0")}`, high: 63 - i, low: 47 - i, code: [0, 2, 3, 61, 95][i] }));
const renderIdleForecast = new Function("$", "WX_SHOW", "window", "wxIcon", "esc", "tempText",
  sourceOf("renderIdleForecast") + "; return renderIdleForecast;")(
    lookup, true, { I18N: { locale: () => "en-US" } }, w => `<svg data-code="${w.code}"></svg>`, String, value => value + "°");
renderIdleForecast({ forecast });
assert(forecastNode.classList.contains("on"), "the ambient forecast panel is shown when forecast days exist");
assert.strictEqual((forecastNode.innerHTML.match(/idle-forecast-day/g) || []).length, 5, "the forecast box shows five days");
assert(forecastNode.innerHTML.includes("data-code=\"95\""), "each day shows its weather glyph");
assert(forecastNode.innerHTML.includes("63°") && forecastNode.innerHTML.includes("43°"), "the forecast shows daily high and low temperatures");
renderIdleForecast(null);
assert(!forecastNode.classList.contains("on"), "the ambient forecast box hides cleanly if weather is disabled or absent");

assert(html.includes('id="dock-weather"'), "the dock weather region exists in the home page");
assert(html.includes('id="app-focus-frame"'), "the app rail includes a shared focus frame for smooth D-pad movement");
assert(html.indexOf('id="dock-weather"') < html.indexOf('id="grid"'), "dock weather is laid out immediately above the app row");
assert(!/\.theme-night \.dock-weather\.on \{[^}]*position: fixed/.test(css), "dock weather no longer floats over the center of the screen");
assert(html.includes('id="idle-forecast"'), "the ambient screen has a dedicated forecast region");
assert(/\/api\/weather[\s\S]*?temp: 15, code: 2[\s\S]*?forecast: forecast/.test(mock), "the mock preview returns deterministic current and forecast weather without a network call");
assert(/forecast_days=5/.test(js) && /"forecast_days": 5/.test(bridge), "both bridge and offline weather requests load five forecast days");
assert(/"forecast": forecast/.test(bridge), "the bridge weather response includes daily forecast data");
assert(/function ambientItem\(\)[\s\S]*?kind: "ambient"/.test(js), "the dock replaces More apps with an Ambient tile");
assert(/list\.push\(ambientItem\(\)\)/.test(js) && /a\.kind === "ambient"/.test(js),
  "the Ambient tile is present and launches the existing ambient clock");
assert(!/list\.push\(moreItem\(\)\)/.test(js) && !/kind: "more"/.test(js), "the slow All apps entry is not generated anymore");
assert(/GRID_COLS = expanded \? 6 : Math\.max\(1, Math\.min\(12, gridItems\.length, fitCols \|\| 1\)\)/.test(js),
  "the dock wraps to the available TV width instead of clipping a long app row");
assert(/api\("GET", path\)[\s\S]*?weatherDirect\(\)/.test(js) && /WEATHER_CACHE_MAX_AGE/.test(js),
  "weather uses the bridge fallback and retains a recent cached reading");
assert(/async def get_weather_for\(lat, lon, place, timezone_name\)/.test(bridge) && /request\.query\.get\("lat"\)/.test(bridge),
  "the bridge fetches weather for the location selected on the TV");
assert(/function weatherNative\(\)/.test(js) && /TV\.weather\(String\(WXCFG\.lat\)/.test(js) && /window\.__tvWeatherDone/.test(js),
  "offline Android TVs can retrieve weather through the native network stack when WebView fetch fails");
assert(/clearFocus\(\)/.test(sourceOf("setIdleAmbient")) && /idle-ambient-active #apps-section[\s\S]*?display: none !important/.test(css),
  "the dock selection is cleared in ambient mode");
assert(/html\.glass\.theme-night \.app\.focus \.face[\s\S]*?box-shadow: none !important/.test(css),
  "legacy glass focus styles cannot draw a second box around the active app");
assert.strictEqual(config.weather.place, "Vancouver, Washington", "the packaged default weather location matches the user's city");
assert.strictEqual(config.weather.lat, 45.6387, "the Vancouver default latitude is packaged");
assert.strictEqual(config.weather.lon, -122.6615, "the Vancouver default longitude is packaged");
assert(/function weatherDirect\(nativeFallback\)[\s\S]*?TV\.weather && !nativeFallback/.test(js) && /weatherNative\(\)\.catch\(function \(\) \{ return weatherDirect\(true\); \}\)/.test(js),
  "a failed native weather request falls back to the WebView network path instead of declaring weather unavailable");
assert.strictEqual(config.home.wx_unit, "f", "the packaged home uses Fahrenheit");
assert.strictEqual(config.home.smart_idle.enabled, true, "the scenic ambient screen activates when the home has been idle");
assert(/ctx_hide/.test(js) && /app_hidden/.test(js), "apps remain hideable and recoverable in Home settings");
assert(/\.theme-night \.app\.tile\.focus \.face, \.theme-night \.app\.tile\.focus \.face::after \{ animation: none; \}/.test(css),
  "focused app tiles do not run the expensive perpetual sway/glint animations");
assert(/\.theme-night \.app\.focus \{ transform: translate3d\(0,var\(--app-focus-lift\),0\) scale\(var\(--app-focus-scale\)\); \}/.test(css) && /\.app-focus-frame\.on \{ opacity: 1; \}/.test(css),
  "app focus lifts the tile while a shared focus frame glides to the final transform");
assert(/function placeAppFocusFrame\([\s\S]*?getBoundingClientRect\(\)[\s\S]*?focusLiftPx[\s\S]*?height \/ 2/.test(js),
  "the outline's resting-box centre is lifted by the same amount as the tile, so it stays over the icon");
assert(/function paintTileFocus\(el\) \{[\s\S]*?placeAppFocusFrame\(el\);\n    if \(el\) el\.classList\.add\("focus"\);/.test(js),
  "the outline is measured and moved before the tile lifts, so both transitions start in the same frame");
assert(!/requestAnimationFrame\(/.test(sourceOf("placeAppFocusFrame")) && /var settled = el\.classList\.contains\("focus"\)/.test(sourceOf("placeAppFocusFrame")),
  "the outline is placed from the tile's resting box in the same frame and re-measured only when it is already lifted");
assert(/if \(paintedFocusEl === el\) placeAppFocusFrame\(el\);/.test(js),
  "the app drawer re-places the outline after scrolling the focused row into view");
assert(/\.theme-night\.expanded \.app \.label \{[\s\S]*?opacity: 1[\s\S]*?white-space: normal/.test(css) && /grid-auto-rows: 10rem/.test(css),
  "app names are wrapped inside their own app-drawer tile rows");
assert(/background: rgba\(20, 22, 30, 0\.78\)/.test(css) && /Every Night-look app gets its own dark frosted tile/.test(css) && /backdrop-filter: none !important/.test(css),
  "all app tiles use a dark translucent glass appearance without expensive per-icon blur");
assert(/\.settings \.srow\.focus, \.settings \.ssec\.focus[\s\S]*?transform: none !important[\s\S]*?box-shadow: none !important/.test(css) && /scroll-behavior: auto/.test(css),
  "settings focus and list scrolling avoid expensive animation and smooth-scroll lag");
assert(/function setMove\([\s\S]*?focusSettingsRow\(previousRow, oldConfirm, rows\)/.test(js) && /function focusSettingsRow\(/.test(js),
  "settings D-pad scrolling updates focus in place instead of rerendering the entire rows list");
assert(/font-variant-numeric: tabular-nums/.test(css) && /\.idle-date[\s\S]*?width: 88vw[\s\S]*?font-size: 2\.35rem/.test(css) && /\.idle-wx[\s\S]*?margin: 3\.5rem auto 0/.test(css),
  "ambient time and date stay centered, with a clear gap before the weather");
assert(/\.dock-wx-temp \{ font-size: 2\.125rem/.test(css) && /min-height: 4\.125rem/.test(css), "the dock weather pill and temperature are larger and easier to read");
assert(/\.theme-night \.app\.tile \{ transition: transform 140ms cubic-bezier\(\.16,1,\.3,1\)/.test(css) && /\.app-focus-frame \{[\s\S]*?transition: transform 140ms/.test(css),
  "the app highlight and lifted tile use matched, responsive easing for smoother D-pad movement");
assert(/will-change: transform; backface-visibility: hidden/.test(css) && !css.includes("\n.theme-night .app.focus { will-change: transform; }"),
  "every dock tile keeps one promoted layer, so moving focus does not build and tear down a layer per press");
assert(/\.glass-icons \.app \.face img \{ transition: opacity 0\.2s; \}/.test(css),
  "focus changes do not animate the icon's grayscale filter, which re-rasterised every frame of the lift");
assert(/function readFocusMetrics\(\)/.test(js) && /\* focusScale\)/.test(js) && /\+ focusLiftPx - height \/ 2/.test(js) && !/getComputedStyle\(document\.documentElement\)[\s\S]{0,200}?placeAppFocusFrame/.test(js),
  "the outline's scale and lift are read once rather than from the root's computed style on every key press");
assert(/WEATHER_RETRY_STEPS[\s\S]*?scheduleWeatherRetry\(\)/.test(js) && /function scheduleWeatherRetry\(\)[\s\S]*?refreshWeather\(\)/.test(js),
  "a failed weather reading is retried within seconds instead of waiting for the half-hourly refresh");
const validPlace = new Function("isFinite", sourceOf("validPlace") + "; return validPlace;")(isFinite);
assert.strictEqual(validPlace({ place: "Vancouver, Washington", timezone: "America/Los_Angeles" }), null,
  "a place with a name but no coordinates is refused, so the request cannot go out as latitude=undefined");
assert.strictEqual(validPlace({ lat: "abc", lon: 1 }), null, "a place with unreadable coordinates is refused");
assert.deepStrictEqual(validPlace({ name: "Vancouver, Washington", lat: 45.6387, lon: -122.6615, timezone: "America/Los_Angeles" }),
  { lat: 45.6387, lon: -122.6615, place: "Vancouver, Washington", timezone: "America/Los_Angeles" },
  "a place chosen on the TV keeps its name, coordinates and time zone");
assert(/WXCFG = validPlace\(ST\.place\) \|\| validPlace\(CFG\.weather\) \|\| WX_FALLBACK;/.test(js),
  "an unset or incomplete location falls back to the packaged place instead of reporting no weather");
assert(/new AbortController\(\)[\s\S]*?control\.abort\(\)/.test(js),
  "a weather request that never answers is aborted so the retry can run");
assert(/Every Night-look app gets its own dark frosted tile/.test(css) && /html\.theme-night \.app \.face/.test(css),
  "every app icon receives its own dark glass background in the home dock and drawer");
assert(/html\.setting \.settings[\s\S]*?backdrop-filter: none !important/.test(css) && /html\.setting \.set-rows[\s\S]*?mask-image: none !important/.test(css),
  "settings avoids the full-screen blur and scrolling mask that cost GPU time");
assert(js.includes("Keep date and weather in separate, stable regions") && js.includes('$("date").innerHTML = \'<span class="dline">\' + esc(day) + "</span>";'),
  "the main date has no duplicate weather reading beside it");
assert(!css.includes(".date .dline") && !css.includes("date line becomes a small glass pill"),
  "the date is plain text, not enclosed in the legacy glass pill");
assert(/avatar-art/.test(sourceOf("avatarHTML")) && /avatar-photo/.test(sourceOf("avatarHTML")),
  "people receive a portrait fallback and optional real profile image");
const makeAvatarHTML = new Function("esc", "colourOf", sourceOf("avatarHTML") + "; return avatarHTML;")(String, p => p.colour);
const avatarHTML = makeAvatarHTML({ name: "Pat", avatar: "https://images.example.org/pat.jpg", colour: "#ff375f" });
assert(avatarHTML.includes("https://images.example.org/pat.jpg") && avatarHTML.includes("avatar-art"),
  "profile pictures render when a public avatar URL is set and retain a fallback");
assert(/function refreshWeather\(\)[\s\S]*?if \(!WX_SHOW\)/.test(js), "weather refresh is not restricted to the Night theme");
assert(/var w = WX_SHOW && data\.weather/.test(sourceOf("renderDockWeather")), "the weather pill renders whenever a reading is available, in any theme");
assert(/font-size: 17rem/.test(css) && /rgba\(5, 8, 14, 0\.12\)/.test(css), "idle ambient clock is large over the scenic background");
const glassGlyphType = new Function("", sourceOf("glassGlyphType") + "; return glassGlyphType;")();
[
  [{ name: "Streamflix", package: "app.streamflix" }, "streamflix"],
  [{ name: "SmartTube", package: "com.teamsmart.videomanager.tv" }, "smarttube"],
  [{ name: "Instagram", package: "com.instagram.android" }, "instagram"],
  [{ name: "File Manager", package: "app.files" }, "filemanager"],
  [{ name: "Downloader", package: "com.esaba.downloader" }, "downloader"],
  [{ name: "LocalSend", package: "org.localsend.localsend_app" }, "localsend"]
].forEach(([app, expected]) => assert.strictEqual(glassGlyphType(app), expected, app.name + " is recognized for a transparent glyph"));
assert(/html\.theme-night \.app\.clear-always \.face[\s\S]*?background: linear-gradient\(145deg[\s\S]*?rgba\(18, 20, 28, 0\.84\) !important/.test(css),
  "the selected glyph apps keep the same dark glass tile backing as every other app");
assert(/GLASS_ICONS \? "\.app \.face:not\(\.tool\):not\(\.word\) > img" : "\.app\.clear-always \.face > img"/.test(js),
  "the six selected apps are cut out even when the optional global glass-icon setting is off");
const paintFocusBlock = js.slice(js.indexOf("  function paintFocus()"), js.indexOf("  // Start on the chosen place", js.indexOf("  function paintFocus()")));
assert(paintFocusBlock.includes("paintTileFocus") && !paintFocusBlock.includes("clearFocus()"),
  "D-pad focus changes update only the old and new tile instead of sweeping the full app list");
assert(/zone === "np" \|\| npControlsFocused/.test(paintFocusBlock) && /npControlsFocused = on && zone === "np"/.test(js),
  "the Now Playing artwork is not rebuilt during ordinary app scrolling");

console.log("Home dock weather and app-library tests passed.");
