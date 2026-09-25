import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const api = axios.create({ baseURL: API, withCredentials: true, timeout: 30000 });

// Share one refresh request between all API calls that fail together. Without
// this, a page that loads several widgets can retry some requests before the
// refresh cookie has actually been renewed and show a wall of 401 errors.
let refreshPromise = null;
api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry && !original.url.includes("/auth/")) {
      original._retry = true;
      try {
        if (!refreshPromise) refreshPromise = api.post("/auth/refresh").finally(() => { refreshPromise = null; });
        await refreshPromise;
        return api(original);
      } catch (e) { /* Preserve the original unauthorized response. */ }
    }
    return Promise.reject(error);
  }
);

export default api;

export const peso = (n) =>
  `₱${Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const num = (n) => Number(n || 0).toLocaleString("en-PH");

export const fmtDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
  } catch { return iso; }
};

export const fmtDay = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium" }); }
  catch { return iso; }
};

export function apiError(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((e) => e?.msg || JSON.stringify(e)).join(" ");
  if (detail?.msg) return detail.msg;
  return String(detail);
}
