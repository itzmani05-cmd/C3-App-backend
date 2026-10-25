// Which websites may call the API from a browser. The mobile app is not a browser and sends no Origin header, so it is
// never affected. Set CORS_ORIGINS to a comma-separated list of allowed sites, for example
// "https://c3institute.in,https://www.c3institute.in". Pages served from the developer's own machine are always allowed.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const parseOrigins = (value) =>
  String(value || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return true;
  return LOCAL_ORIGIN.test(origin) || allowedOrigins.includes(origin);
}

function buildCorsOptions(env = process.env) {
  const allowedOrigins = parseOrigins(env.CORS_ORIGINS);
  return {
    // A blocked origin simply gets no CORS headers, so the browser refuses to read the response.
    origin: (origin, callback) => callback(null, isOriginAllowed(origin, allowedOrigins)),
  };
}

module.exports = { parseOrigins, isOriginAllowed, buildCorsOptions };
