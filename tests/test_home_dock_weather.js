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
assert(/requestAnimationFrame/.test(sourceOf("placeAppFocusFrame")) && /clearFocus\(\)/.test(sourceOf("setIdleAmbient")) && /idle-ambient-active #apps-section[\s\S]*?display: none !important/.test(css),
  "focus-frame work is coalesced and the dock selection is cleared in ambient mode");
assert(/html\.glass\.theme-night \.app\.focus \.face[\s\S]*?box-shadow: none !important/.test(css),
  "legacy glass focus styles cannot draw a second box around the active app");
assert.strictEqual(config.weather.place, "Seattle", "the packaged default weather location matches the target device");
assert.strictEqual(config.home.wx_unit, "f", "the packaged home uses Fahrenheit");
assert.strictEqual(config.home.smart_idle.enabled, true, "the scenic ambient screen activates when the home has been idle");
assert(/ctx_hide/.test(js) && /app_hidden/.test(js), "apps remain hideable and recoverable in Home settings");
assert(/\.theme-night \.app\.tile\.focus \.face, \.theme-night \.app\.tile\.focus \.face::after \{ animation: none; \}/.test(css),
  "focused app tiles do not run the expensive perpetual sway/glint animations");
assert(/\.theme-night \.app\.focus \{ transform: translate3d\(0,-0\.375rem,0\) scale\(1\.045\); z-index: 3; \}/.test(css) && /\.app-focus-frame\.on \{ opacity: 1; \}/.test(css),
  "app focus smoothly lifts the tile while a shared focus frame glides between positions");
assert(/function placeAppFocusFrame\([\s\S]*?getBoundingClientRect\(\)/.test(js), "the focus frame tracks only the focused app tile");
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
assert(/\.theme-night \.app\.clear-always \.face[\s\S]*?background: transparent !important/.test(css),
  "the six household apps have no opaque icon tile background");
assert(/GLASS_ICONS \? "\.app \.face:not\(\.tool\):not\(\.word\) > img" : "\.app\.clear-always \.face > img"/.test(js),
  "the six selected apps are cut out even when the optional global glass-icon setting is off");
const paintFocusBlock = js.slice(js.indexOf("  function paintFocus()"), js.indexOf("  // Start on the chosen place", js.indexOf("  function paintFocus()")));
assert(paintFocusBlock.includes("paintTileFocus") && !paintFocusBlock.includes("clearFocus()"),
  "D-pad focus changes update only the old and new tile instead of sweeping the full app list");
assert(/zone === "np" \|\| npControlsFocused/.test(paintFocusBlock) && /npControlsFocused = on && zone === "np"/.test(js),
  "the Now Playing artwork is not rebuilt during ordinary app scrolling");

console.log("Home dock weather and app-library tests passed.");
