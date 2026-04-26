

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  AlertTriangle, MapPin, Users, Truck, FileText, Settings,
  Bell, MessageSquare, LogOut, Menu, X, Plus, Search,
  Clock, CheckCircle, XCircle, Shield, Zap, Activity,
  Download, Upload, Mic, Camera, Video, Phone, Radio,
  Gauge, BarChart2, Globe, Lock, UserPlus, Edit, Trash2,
  Eye, Filter, RefreshCw, Wifi, CloudRain, Wind, Thermometer,
  Navigation, Package, Wrench, Fuel, Calendar, Flag,
  AlertCircle, Info, Building2, Hospital, Flame, Car,
  TrendingUp, TrendingDown, ChevronDown, ChevronRight,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 1  API LAYER
   All backend communication is centralised here.
   Base URL is read from the environment variable REACT_APP_API_URL,
   defaulting to http://localhost:8000 for local development.
══════════════════════════════════════════════════════════════════════════════ */

/** Backend base URL  override with REACT_APP_API_URL env variable */
const API_BASE = (typeof process !== "undefined" && process.env?.REACT_APP_API_URL)
  || "http://localhost:8000";

/** WebSocket base URL derived by swapping http → ws */
const WS_BASE = API_BASE.replace(/^http/, "ws");

/** localStorage key for the JWT access token */
const TOKEN_KEY = "eims_token";

// ─── Token helpers ────────────────────────────────────────────────────────
const getToken  = ()      => localStorage.getItem(TOKEN_KEY);
const saveToken = (t)     => localStorage.setItem(TOKEN_KEY, t);
const dropToken = ()      => localStorage.removeItem(TOKEN_KEY);

/**
 * Decode a JWT payload without a library.
 * Returns null if the token is malformed or expired.
 */
const decodeJwt = (token) => {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    // Check expiry (exp is Unix seconds)
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
};

/**
 * Central HTTP request helper.
 * Automatically attaches the Bearer token and handles 401 auto-logout.
 *
 * @param {string} method     - HTTP verb
 * @param {string} path       - Path relative to API_BASE
 * @param {object|FormData}   body - Request body (optional)
 * @param {boolean} asBlob    - When true, resolves with raw Blob (for PDF downloads)
 */
const request = async (method, path, body = null, asBlob = false) => {
  const token = getToken();
  const headers = {};

  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Let the browser set Content-Type for FormData (multipart boundary)
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const resp = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body instanceof FormData
      ? body
      : body ? JSON.stringify(body) : undefined,
  });

  // Auto-logout on expired / invalid token
  if (resp.status === 401) {
    dropToken();
    window.location.reload();
    return;
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(err.detail || "Unknown error");
  }

  if (resp.status === 204) return null;
  if (asBlob) return resp.blob();
  return resp.json();
};

/** Convenience wrappers */
const api = {
  get:    (path)            => request("GET",    path),
  post:   (path, body)      => request("POST",   path, body),
  patch:  (path, body)      => request("PATCH",  path, body),
  delete: (path)            => request("DELETE", path),
  /** Upload a file as multipart/form-data */
  upload: (path, formData)  => request("POST",   path, formData),
  /** Download binary (e.g. PDF) */
  blob:   (path)            => request("GET",    path, null, true),
};

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 2 DATA NORMALISATION
   The backend uses Title-Case strings (e.g. "Active", "High").
   The frontend renders lower-case keys internally for consistent comparisons.
══════════════════════════════════════════════════════════════════════════════ */

/** Convert a backend incident object to the frontend shape */
const normaliseIncident = (i) => ({
  id:         i.id,
  backendId:  i.id,                          // integer PK for API calls
  displayId:  `INC-${String(i.id).padStart(3, "0")}`,
  type:       (i.category || "other").toLowerCase(),
  category:   i.category,                    // original backend value for PATCH
  location:   i.description || `${i.latitude?.toFixed(4)}, ${i.longitude?.toFixed(4)}`,
  priority:   (i.priority || "medium").toLowerCase(),
  status:     normaliseStatus(i.status),
  team:       i.team_name || null,
  reportedAt: i.created_at
    ? new Date(i.created_at).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })
    : "--:--",
  notes:      i.description || "",
  lat:        i.latitude  || 33.88,
  lng:        i.longitude || 35.49,
  citizenId:  i.citizen_id,
  closedAt:   i.closed_at,
  auditLogs:  i.audit_logs || [],
});

/** Map backend status string to lowercase frontend key */
const normaliseStatus = (s) => {
  const map = { Waiting: "pending", Active: "active", Closed: "closed" };
  return map[s] || (s || "pending").toLowerCase();
};

/** Map frontend priority/category back to backend Title-Case */
const toBackendPriority = (p) => ({ low: "Low", medium: "Medium", high: "High", critical: "Critical" }[p] || "Medium");
const toBackendCategory = (c) => {
  const map = { fire: "Fire", medical: "Medical", traffic: "Traffic", accident: "Accident", flood: "Flood", other: "Other" };
  return map[c] || "Other";
};
const toBackendStatus   = (s) => ({ pending: "Waiting", active: "Active", closed: "Closed" }[s] || "Waiting");

/** Normalise a resource (vehicle or equipment) from backend */
const normaliseResource = (r) => ({
  id:             r.id,
  displayId:      `RES-${String(r.id).padStart(3, "0")}`,
  name:           r.name,
  type:           r.type,          // "Vehicle" or "Equipment"
  status:         r.status,        // "Available" | "Unavailable" | "Maintenance"
  fuel:           r.fuel_usage ?? null,
  lastInspection: r.last_inspection,
  createdAt:      r.created_at,
});

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 3 DESIGN TOKENS  (industrial / emergency theme)
══════════════════════════════════════════════════════════════════════════════ */
const T = {
  bg:           "#090d14",
  surface:      "#0f1623",
  surfaceAlt:   "#141d2e",
  border:       "#1e2d45",
  borderBright: "#2a3f5f",
  red:          "#e53e3e",
  redDark:      "#9b1c1c",
  redGlow:      "rgba(229,62,62,0.15)",
  amber:        "#d97706",
  amberLight:   "#fbbf24",
  green:        "#059669",
  greenLight:   "#34d399",
  blue:         "#2563eb",
  blueLight:    "#60a5fa",
  purple:       "#7c3aed",
  purpleLight:  "#a78bfa",
  text:         "#e2e8f0",
  textMuted:    "#64748b",
  textDim:      "#94a3b8",
  accent:       "#e53e3e",
};

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 4 TRANSLATIONS  (UR-44: bilingual Arabic / English)
══════════════════════════════════════════════════════════════════════════════ */
const LABELS = {
  en: {
    appName:"EIMS Command", appSub:"Emergency Incident Management System",
    login:"Sign In", email:"Email", password:"Password", loginBtn:"AUTHORIZE ACCESS",
    dashboard:"Dashboard", incidents:"Incidents", map:"Live Map",
    comms:"Communications", reports:"Reports", resources:"Resources",
    coordination:"Coordination", users:"User Management",
    logout:"Logout", search:"Search…",
    activeIncidents:"Active Incidents", availableTeams:"Available Teams",
    avgResponseTime:"Avg Response Time", resolvedToday:"Resolved Today",
    createIncident:"New Incident", incidentId:"ID", incidentType:"Type",
    location:"Location", priority:"Priority", status:"Status",
    assignedTeam:"Assigned Team", reportedAt:"Reported At",
    actions:"Actions", assign:"Assign", close:"Close",
    high:"HIGH", medium:"MEDIUM", low:"LOW", critical:"CRITICAL",
    active:"ACTIVE", closed:"CLOSED", pending:"PENDING",
    fire:"Fire", flood:"Flood", medical:"Medical",
    accident:"Accident", traffic:"Traffic", other:"Other",
    sendAlert:"Send Alert", message:"Message", send:"Send",
    upload:"Upload File", record:"Record Audio",
    dailyReport:"Daily Report", exportPDF:"Export PDF",
    personnel:"Personnel", vehicles:"Vehicles", equipment:"Equipment",
    drills:"Training Drills", inspection:"Inspections",
    hospital:"Hospital", police:"Police", fireDept:"Fire Dept",
    weather:"Weather", addUser:"Add User", name:"Name",
    email2:"Email", phone:"Phone", minutes:"min",
    filter:"Filter", refresh:"Refresh", viewDetails:"View Details",
    incidentDetails:"Incident Details", notes:"Description / Notes",
    category:"Category", submit:"Submit", cancel:"Cancel",
    save:"Save", edit:"Edit", delete:"Delete",
    maintenance:"Maintenance", fuelLevel:"Fuel Level",
    schedDrill:"Schedule Drill", setInspection:"Set Inspection Date",
    buildingPlans:"Building Plans", highRiskZones:"High-Risk Zones",
    vehicleTracking:"Vehicle Tracking", navDirections:"Navigation",
    teamProximity:"Nearby Teams", citizenAlert:"Citizen Alert",
    teamChat:"Team Chat", media:"Media", voiceNotes:"Voice Notes",
    kpi:"KPIs", incidentsByType:"Incidents by Type",
    responseTimeTrend:"Response Time Trend", weeklyStats:"Weekly Stats",
    lang:"عربي", loading:"Loading…", error:"Error", retry:"Retry",
    noData:"No data available", connected:"Connected", offline:"Offline",
    role:"Role",
  },
  ar: {
    appName:"نظام EIMS", appSub:"نظام إدارة حوادث الطوارئ",
    login:"تسجيل الدخول", email:"البريد الإلكتروني", password:"كلمة المرور",
    loginBtn:"تفويض الوصول", dashboard:"لوحة التحكم",
    incidents:"الحوادث", map:"الخريطة المباشرة",
    comms:"الاتصالات", reports:"التقارير", resources:"الموارد",
    coordination:"التنسيق", users:"إدارة المستخدمين",
    logout:"تسجيل الخروج", search:"بحث…",
    activeIncidents:"الحوادث النشطة", availableTeams:"الفرق المتاحة",
    avgResponseTime:"متوسط وقت الاستجابة", resolvedToday:"تم حلها اليوم",
    createIncident:"حادثة جديدة", incidentId:"المعرف", incidentType:"النوع",
    location:"الموقع", priority:"الأولوية", status:"الحالة",
    assignedTeam:"الفريق المعين", reportedAt:"وقت الإبلاغ",
    actions:"الإجراءات", assign:"تعيين", close:"إغلاق",
    high:"عالية", medium:"متوسطة", low:"منخفضة", critical:"حرجة",
    active:"نشط", closed:"مغلق", pending:"معلق",
    fire:"حريق", flood:"فيضان", medical:"طبي",
    accident:"حادث", traffic:"مرور", other:"أخرى",
    sendAlert:"إرسال تنبيه", message:"رسالة", send:"إرسال",
    upload:"رفع ملف", record:"تسجيل صوتي",
    dailyReport:"التقرير اليومي", exportPDF:"تصدير PDF",
    personnel:"الأفراد", vehicles:"المركبات", equipment:"المعدات",
    drills:"تدريبات", inspection:"الفحوصات",
    hospital:"المستشفى", police:"الشرطة", fireDept:"الإطفاء",
    weather:"الطقس", addUser:"إضافة مستخدم", name:"الاسم",
    email2:"البريد الإلكتروني", phone:"الهاتف", minutes:"د",
    filter:"تصفية", refresh:"تحديث", viewDetails:"عرض التفاصيل",
    incidentDetails:"تفاصيل الحادثة", notes:"الوصف / الملاحظات",
    category:"الفئة", submit:"تقديم", cancel:"إلغاء",
    save:"حفظ", edit:"تعديل", delete:"حذف",
    maintenance:"الصيانة", fuelLevel:"مستوى الوقود",
    schedDrill:"جدولة تدريب", setInspection:"تحديد موعد الفحص",
    buildingPlans:"مخططات المباني", highRiskZones:"مناطق الخطر العالي",
    vehicleTracking:"تتبع المركبات", navDirections:"الملاحة",
    teamProximity:"الفرق القريبة", citizenAlert:"تنبيه المواطنين",
    teamChat:"محادثة الفريق", media:"الوسائط", voiceNotes:"الملاحظات الصوتية",
    kpi:"مؤشرات الأداء", incidentsByType:"الحوادث حسب النوع",
    responseTimeTrend:"اتجاه وقت الاستجابة", weeklyStats:"إحصائيات أسبوعية",
    lang:"English", loading:"جارٍ التحميل…", error:"خطأ", retry:"إعادة المحاولة",
    noData:"لا توجد بيانات", connected:"متصل", offline:"غير متصل",
    role:"الدور",
  },
};

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 5 STATIC / FALLBACK DATA
   Used where no dedicated backend endpoint exists (teams, weather).
══════════════════════════════════════════════════════════════════════════════ */

/** Static team list used on Map page (no teams REST endpoint exists) */
const STATIC_TEAMS = [
  { id: "T-01", name: "Alpha-1",  type: "Fire",    status: "busy",      members: 6, lat: 33.891, lng: 35.502 },
  { id: "T-02", name: "Alpha-2",  type: "Fire",    status: "available", members: 5, lat: 33.885, lng: 35.495 },
  { id: "T-03", name: "Beta-3",   type: "Rescue",  status: "busy",      members: 4, lat: 33.883, lng: 35.490 },
  { id: "T-04", name: "Medic-1",  type: "Medical", status: "available", members: 3, lat: 33.877, lng: 35.510 },
  { id: "T-05", name: "Medic-2",  type: "Medical", status: "busy",      members: 4, lat: 33.901, lng: 35.512 },
  { id: "T-06", name: "Hazmat-1", type: "HazMat",  status: "busy",      members: 5, lat: 33.860, lng: 35.521 },
  { id: "T-07", name: "Delta-4",  type: "Rescue",  status: "available", members: 6, lat: 33.870, lng: 35.480 },
];

/** Training drills (no backend endpoint; managed locally) */
const STATIC_DRILLS = [
  { id: "D-001", title: "Urban Search & Rescue", date: "2025-08-15", teams: "Alpha-1, Beta-3" },
  { id: "D-002", title: "HazMat Response",        date: "2025-08-22", teams: "Hazmat-1" },
  { id: "D-003", title: "Mass Casualty Triage",   date: "2025-09-05", teams: "Medic-1, Medic-2" },
];

/** Chart data for the stats tab (real data would come from /api/v1/reports/daily) */
const CHART_WEEKLY = [
  { day: "Mon", incidents: 12, resolved: 10 },
  { day: "Tue", incidents: 8,  resolved: 7  },
  { day: "Wed", incidents: 15, resolved: 13 },
  { day: "Thu", incidents: 20, resolved: 18 },
  { day: "Fri", incidents: 9,  resolved: 9  },
  { day: "Sat", incidents: 6,  resolved: 5  },
  { day: "Sun", incidents: 11, resolved: 10 },
];

const CHART_RESPONSE = [
  { time: "06:00", avg: 6.2 }, { time: "08:00", avg: 4.8 },
  { time: "10:00", avg: 3.9 }, { time: "12:00", avg: 5.1 },
  { time: "14:00", avg: 4.4 }, { time: "16:00", avg: 6.8 },
  { time: "18:00", avg: 7.2 }, { time: "20:00", avg: 5.5 },
];

const CHART_BY_TYPE = [
  { name: "Fire",     value: 35, color: "#e53e3e" },
  { name: "Medical",  value: 28, color: "#3b82f6" },
  { name: "Accident", value: 18, color: "#d97706" },
  { name: "Flood",    value: 10, color: "#06b6d4" },
  { name: "Traffic",  value: 6,  color: "#8b5cf6" },
  { name: "Other",    value: 3,  color: "#64748b" },
];

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 6 GLOBAL CSS (injected once on mount)
══════════════════════════════════════════════════════════════════════════════ */
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=DM+Mono:wght@400;500&family=Noto+Sans+Arabic:wght@400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { height: 100%; }
  body {
    background: ${T.bg};
    color: ${T.text};
    font-family: 'Rajdhani', 'Noto Sans Arabic', sans-serif;
    overflow: hidden;
  }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: ${T.bg}; }
  ::-webkit-scrollbar-thumb { background: ${T.borderBright}; border-radius: 3px; }
  input, textarea, select {
    font-family: inherit;
    background: ${T.surfaceAlt};
    color: ${T.text};
    border: 1px solid ${T.border};
    border-radius: 4px;
    padding: 8px 12px;
    outline: none;
    transition: border-color .2s;
    width: 100%;
  }
  input:focus, textarea:focus, select:focus { border-color: ${T.red}; }
  button { font-family: inherit; cursor: pointer; }
  @keyframes pulse-red {
    0%,100% { box-shadow: 0 0 0 0 rgba(229,62,62,0.4); }
    50%      { box-shadow: 0 0 0 6px rgba(229,62,62,0); }
  }
  @keyframes fadeIn {
    from { opacity:0; transform:translateY(8px); }
    to   { opacity:1; transform:translateY(0); }
  }
  @keyframes slide-in {
    from { transform: translateX(-20px); opacity:0; }
    to   { transform: translateX(0);     opacity:1; }
  }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
  @keyframes spin { to { transform: rotate(360deg); } }
  .live-dot  { animation: blink 1.5s infinite; }
  .fade-in   { animation: fadeIn .3s ease forwards; }
  .slide-in  { animation: slide-in .25s ease forwards; }
  .spin      { animation: spin 1s linear infinite; }
`;

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 7 SHARED UI PRIMITIVES
══════════════════════════════════════════════════════════════════════════════ */

/** Generic surface card */
const Card = ({ children, style = {}, className = "" }) => (
  <div className={className} style={{
    background: T.surface, border: `1px solid ${T.border}`,
    borderRadius: 6, padding: 20, ...style,
  }}>
    {children}
  </div>
);

/** Section heading with a red gradient underline */
const SectionTitle = ({ icon: Icon, title, subtitle }) => (
  <div style={{ marginBottom: 20 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {Icon && <Icon size={18} color={T.red} />}
      <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {title}
      </span>
    </div>
    {subtitle && <div style={{ color: T.textMuted, fontSize: 13, marginTop: 4 }}>{subtitle}</div>}
    <div style={{ height: 2, background: `linear-gradient(90deg,${T.red},transparent)`, marginTop: 8 }} />
  </div>
);

/**
 * KPI stat card.
 * BUG FIX: Original compared color (hex string) to "red"/"green"  always false.
 * Fixed: append "26" (≈15% alpha) to the hex colour string for the background tint.
 */
const StatCard = ({ label, value, sub, icon: Icon, color = T.red, trend }) => (
  <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <span style={{ color: T.textMuted, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>
        {label}
      </span>
      {/* Background = hex colour + "26" (10% alpha), e.g. "#34d39926" */}
      <div style={{ background: `${color}26`, borderRadius: 6, padding: 6 }}>
        <Icon size={16} color={color} />
      </div>
    </div>
    <div style={{ fontSize: 36, fontWeight: 700, color: T.text, lineHeight: 1 }}>{value}</div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ color: T.textMuted, fontSize: 12 }}>{sub}</span>
      {trend !== undefined && (
        <span style={{
          fontSize: 12, color: trend > 0 ? T.red : T.greenLight,
          display: "flex", alignItems: "center", gap: 4,
        }}>
          {trend > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {Math.abs(trend)}%
        </span>
      )}
    </div>
  </Card>
);

/** Priority badge supports Low / Medium / High / Critical (UR-7) */
const PriorityBadge = ({ level, L }) => {
  const map = {
    high:     [T.red,         "#3d0f0f"],
    critical: [T.purpleLight, "#2d1b4e"],
    medium:   [T.amber,       "#3d2a0a"],
    low:      [T.green,       "#0a2a1e"],
  };
  const [fg, bg] = map[level] || [T.textMuted, T.surfaceAlt];
  const label = L[level] || level?.toUpperCase();
  return (
    <span style={{
      background: bg, color: fg, border: `1px solid ${fg}`,
      borderRadius: 3, padding: "2px 8px", fontSize: 11,
      fontWeight: 700, letterSpacing: "0.08em", fontFamily: "'DM Mono', monospace",
    }}>
      {label}
    </span>
  );
};

/** Status badge with an animated dot for "active" */
const StatusBadge = ({ status, L }) => {
  const map = {
    active:    [T.redGlow,  T.red,        L?.active    || "ACTIVE"],
    pending:   ["#1a1500",  T.amberLight, L?.pending   || "PENDING"],
    closed:    ["#0a1a0a",  T.greenLight, L?.closed    || "CLOSED"],
    available: ["#0a1a0a",  T.greenLight, "AVAILABLE"],
    busy:      [T.redGlow,  T.red,        "BUSY"],
  };
  const [bg, fg, label] = map[status] || [T.surfaceAlt, T.textMuted, status];
  return (
    <span style={{
      background: bg, color: fg, borderRadius: 3,
      padding: "2px 8px", fontSize: 11, fontWeight: 700,
      letterSpacing: "0.08em", fontFamily: "'DM Mono',monospace",
      display: "inline-flex", alignItems: "center", gap: 5,
    }}>
      {status === "active" && (
        <span className="live-dot" style={{ width: 5, height: 5, borderRadius: "50%", background: fg }} />
      )}
      {label}
    </span>
  );
};

/** Incident type icon mapped to category string */
const TypeIcon = ({ type }) => {
  const map = {
    fire:     <Flame size={14} color={T.red} />,
    flood:    <CloudRain size={14} color="#06b6d4" />,
    medical:  <Activity size={14} color="#3b82f6" />,
    accident: <Car size={14} color={T.amber} />,
    traffic:  <Car size={14} color={T.purpleLight} />,
    other:    <AlertCircle size={14} color={T.textMuted} />,
  };
  return map[(type || "other").toLowerCase()] || map.other;
};

/** Generic HTML table with hover highlight */
const DataTable = ({ cols, rows, renderRow }) => (
  <div style={{ overflowX: "auto" }}>
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: `1px solid ${T.border}` }}>
          {cols.map(c => (
            <th key={c} style={{
              padding: "8px 12px", textAlign: "left",
              color: T.textMuted, fontWeight: 600,
              letterSpacing: "0.08em", fontSize: 11, textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={i}
            style={{ borderBottom: `1px solid ${T.border}`, transition: "background .15s" }}
            onMouseEnter={e => { e.currentTarget.style.background = T.surfaceAlt; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
          >
            {renderRow(row)}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/** Table cell */
const Td = ({ children, style = {} }) => (
  <td style={{ padding: "10px 12px", color: T.text, ...style }}>{children}</td>
);

/** Reusable button with variant styles */
const Btn = ({ children, onClick, variant = "primary", size = "sm", icon: Icon, disabled = false, style = {} }) => {
  const variants = {
    primary: { background: T.red,         color: "#fff",     border: "none" },
    ghost:   { background: "transparent", color: T.textDim,  border: `1px solid ${T.border}` },
    outline: { background: "transparent", color: T.red,      border: `1px solid ${T.red}` },
    success: { background: T.green,       color: "#fff",     border: "none" },
    warning: { background: T.amber,       color: "#fff",     border: "none" },
  };
  const sizes = {
    sm: { padding: "6px 12px", fontSize: 12 },
    md: { padding: "8px 16px", fontSize: 13 },
    lg: { padding: "10px 20px", fontSize: 14 },
  };
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        ...variants[variant], ...sizes[size],
        borderRadius: 4, fontWeight: 700, letterSpacing: "0.06em",
        display: "inline-flex", alignItems: "center", gap: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "opacity .2s, filter .2s",
        fontFamily: "'Rajdhani',sans-serif", textTransform: "uppercase", ...style,
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.filter = "brightness(1.15)"; }}
      onMouseLeave={e => { e.currentTarget.style.filter = ""; }}
    >
      {Icon && <Icon size={12} />}
      {children}
    </button>
  );
};

/** Centred modal overlay */
const Modal = ({ open, onClose, title, children, width = 520 }) => {
  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
        zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="fade-in" style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 8, width, maxWidth: "95vw", maxHeight: "90vh", overflow: "auto",
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "16px 20px", borderBottom: `1px solid ${T.border}`,
        }}>
          <span style={{ fontWeight: 700, fontSize: 16, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {title}
          </span>
          {/* BUG FIX: use e.currentTarget, not e.target */}
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
};

/** Horizontal fuel level bar with colour gradient */
const FuelBar = ({ level }) => {
  const pct = Math.max(0, Math.min(100, level ?? 0));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: T.border, borderRadius: 3, overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`, height: "100%", borderRadius: 3,
          background: pct > 60 ? T.green : pct > 30 ? T.amber : T.red,
          transition: "width .5s",
        }} />
      </div>
      <span style={{ color: T.textDim, fontSize: 12, minWidth: 36, fontFamily: "'DM Mono',monospace" }}>
        {pct}%
      </span>
    </div>
  );
};

/** Full-width loading indicator */
const LoadingRow = ({ L }) => (
  <div style={{ textAlign: "center", padding: 40, color: T.textMuted }}>
    <RefreshCw size={20} className="spin" style={{ display: "block", margin: "0 auto 12px" }} />
    {L.loading}
  </div>
);

/** Error message with optional retry */
const ErrorMsg = ({ message, onRetry, L }) => (
  <div style={{
    padding: "12px 16px", background: T.redGlow, border: `1px solid ${T.redDark}`,
    borderRadius: 5, display: "flex", justifyContent: "space-between", alignItems: "center",
  }}>
    <span style={{ color: T.red, fontSize: 13 }}>{message}</span>
    {onRetry && <Btn variant="outline" onClick={onRetry} size="sm">{L.retry}</Btn>}
  </div>
);

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 8 TOAST NOTIFICATION SYSTEM
   A lightweight global toast stack rendered at bottom-right.
══════════════════════════════════════════════════════════════════════════════ */

/** Hook to manage a notification stack */
const useToasts = () => {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((msg, type = "info") => {
    const id = Date.now();
    setToasts(ts => [...ts, { id, msg, type }]);
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 4000);
  }, []);

  return { toasts, push };
};

/** Toast container render once in the root */
const ToastContainer = ({ toasts }) => (
  <div style={{
    position: "fixed", bottom: 24, right: 24,
    display: "flex", flexDirection: "column", gap: 8, zIndex: 9999,
  }}>
    {toasts.map(t => {
      const colour = t.type === "success" ? T.greenLight : t.type === "error" ? T.red : T.blueLight;
      return (
        <div key={t.id} className="fade-in" style={{
          background: T.surface, border: `1px solid ${colour}`,
          borderLeft: `3px solid ${colour}`, borderRadius: 5,
          padding: "10px 16px", fontSize: 13, color: T.text, maxWidth: 320,
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}>
          {t.msg}
        </div>
      );
    })}
  </div>
);

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 9 NAV SIDEBAR & TOPBAR
══════════════════════════════════════════════════════════════════════════════ */

const NAV_ITEMS = (L) => [
  { id: "dashboard",    icon: Gauge,        label: L.dashboard },
  { id: "incidents",    icon: AlertTriangle, label: L.incidents },
  { id: "map",          icon: MapPin,        label: L.map },
  { id: "comms",        icon: MessageSquare, label: L.comms },
  { id: "reports",      icon: BarChart2,     label: L.reports },
  { id: "resources",    icon: Package,       label: L.resources },
  { id: "coordination", icon: Globe,         label: L.coordination },
  { id: "users",        icon: Users,         label: L.users },
];

const Sidebar = ({ view, setView, L, user, onLogout, collapsed, setCollapsed }) => {
  const navItems = NAV_ITEMS(L);

  // UR-38, UR-39: restrict nav items by backend role
  const allowedViews = {
    Admin:      ["dashboard","incidents","map","comms","reports","resources","coordination","users"],
    Dispatcher: ["dashboard","incidents","map","comms","reports","resources","coordination"],
    Responder:  ["dashboard","incidents","map","comms"],
    Citizen:    ["incidents"],
    External:   ["coordination"],
  };
  const allowed = allowedViews[user?.role] || [];

  return (
    <aside style={{
      width: collapsed ? 64 : 220, minWidth: collapsed ? 64 : 220,
      background: T.surface, borderRight: `1px solid ${T.border}`,
      display: "flex", flexDirection: "column",
      transition: "width .25s, min-width .25s",
      overflow: "hidden", position: "relative", zIndex: 10,
    }}>
      {/* Branding */}
      <div style={{
        padding: "18px 14px", borderBottom: `1px solid ${T.border}`,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <div style={{ background: T.red, borderRadius: 6, padding: 6, flexShrink: 0, animation: "pulse-red 2s infinite" }}>
          <Shield size={18} color="#fff" />
        </div>
        {!collapsed && (
          <div className="slide-in">
            <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: "0.08em", lineHeight: 1 }}>{L.appName}</div>
            <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: "0.05em", lineHeight: 1.3 }}>COMMAND CENTER</div>
          </div>
        )}
        <button
          onClick={() => setCollapsed(c => !c)}
          style={{ marginLeft: "auto", background: "none", border: "none", color: T.textMuted, cursor: "pointer", flexShrink: 0 }}
        >
          <Menu size={16} />
        </button>
      </div>

      {/* Nav links */}
      <nav style={{ flex: 1, padding: "10px 8px", overflowY: "auto", overflowX: "hidden" }}>
        {navItems.filter(item => allowed.includes(item.id)).map(item => {
          const active = view === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10,
                padding: "10px 10px", marginBottom: 2, borderRadius: 5, border: "none",
                background: active ? T.redGlow : "transparent",
                color: active ? T.red : T.textDim,
                borderLeft: active ? `2px solid ${T.red}` : "2px solid transparent",
                cursor: "pointer", transition: "all .15s",
                whiteSpace: "nowrap", overflow: "hidden",
              }}
            >
              <item.icon size={17} style={{ flexShrink: 0 }} />
              {!collapsed && (
                <span style={{ fontWeight: active ? 700 : 500, fontSize: 13, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                  {item.label}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* User info + logout */}
      <div style={{ padding: "12px 10px", borderTop: `1px solid ${T.border}` }}>
        {!collapsed && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.text, letterSpacing: "0.04em" }}>{user?.name}</div>
            <div style={{ fontSize: 11, color: T.textMuted }}>{user?.role}</div>
          </div>
        )}
        <button
          onClick={onLogout}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 8,
            padding: "8px 8px", border: "none", background: "transparent",
            color: T.textMuted, cursor: "pointer", borderRadius: 4,
            justifyContent: collapsed ? "center" : "flex-start",
          }}
        >
          <LogOut size={15} />
          {!collapsed && (
            <span style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>{L.logout}</span>
          )}
        </button>
      </div>
    </aside>
  );
};

const Topbar = ({ view, L, lang, setLang, user, notifications = 0 }) => {
  const navMap = NAV_ITEMS(L).reduce((a, n) => ({ ...a, [n.id]: n.label }), {});
  return (
    <header style={{
      height: 52, borderBottom: `1px solid ${T.border}`,
      display: "flex", alignItems: "center", padding: "0 20px", gap: 12,
      background: T.surface, flexShrink: 0,
    }}>
      <div style={{ fontWeight: 700, fontSize: 14, textTransform: "uppercase", letterSpacing: "0.1em", color: T.red }}>
        {navMap[view]}
      </div>
      <div style={{ flex: 1 }} />

      {/* Live indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: T.greenLight, fontSize: 11, letterSpacing: "0.08em" }}>
        <span className="live-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: T.greenLight }} />
        LIVE
      </div>

      {/* Notification bell */}
      <div style={{ position: "relative" }}>
        <button style={{
          background: "none", border: `1px solid ${T.border}`,
          borderRadius: 5, padding: "5px 7px", color: T.textDim, cursor: "pointer", display: "flex",
        }}>
          <Bell size={15} />
        </button>
        {notifications > 0 && (
          <span style={{
            position: "absolute", top: -4, right: -4,
            background: T.red, color: "#fff", borderRadius: "50%",
            width: 14, height: 14, fontSize: 9, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {notifications}
          </span>
        )}
      </div>

      {/* Language toggle (UR-44) */}
      <button
        onClick={() => setLang(l => l === "en" ? "ar" : "en")}
        style={{
          background: "none", border: `1px solid ${T.border}`,
          borderRadius: 5, padding: "4px 10px",
          color: T.textDim, cursor: "pointer", fontSize: 12, fontWeight: 600,
        }}
      >
        {L.lang}
      </button>

      {/* Avatar */}
      <div style={{
        width: 32, height: 32, borderRadius: "50%",
        background: T.red, display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 700, fontSize: 13,
      }}>
        {(user?.name || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
      </div>
    </header>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 10 LOGIN SCREEN  (UR-37, UR-39, SR-37.1–37.3, SR-39.1)
   Sends email + password to /api/v1/auth/login/json.
   Decodes the returned JWT to extract the user's name, email, and role.
══════════════════════════════════════════════════════════════════════════════ */
const LoginScreen = ({ onLogin, lang, setLang }) => {
  const L = LABELS[lang];
  const [email,   setEmail]   = useState("");
  const [pass,    setPass]    = useState("");
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState("");

  const handleLogin = async () => {
    if (!email.trim() || !pass.trim()) { setErr("Please enter your email and password."); return; }
    setLoading(true);
    setErr("");
    try {
      // SR-37.3: validate credentials against backend
      const data = await api.post("/api/v1/auth/login/json", { email: email.trim(), password: pass });
      saveToken(data.access_token);

      // Decode JWT to read user info (sub = user_id, email, role)
      const payload = decodeJwt(data.access_token);
      if (!payload) throw new Error("Token is invalid or expired");

      onLogin({
        id:    payload.sub,
        email: payload.email,
        role:  payload.role,   // e.g. "Admin", "Dispatcher", "Responder"
        name:  payload.email.split("@")[0].replace(/[._]/g, " "), // fallback display name
      });
    } catch (e) {
      // SR-39.1: deny access on bad credentials
      setErr(e.message || "Invalid email or password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", background: T.bg,
      display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column",
      backgroundImage: `
        radial-gradient(ellipse at 30% 20%, rgba(229,62,62,0.07) 0%, transparent 60%),
        repeating-linear-gradient(0deg, transparent, transparent 39px, ${T.border} 40px),
        repeating-linear-gradient(90deg, transparent, transparent 39px, ${T.border} 40px)
      `,
    }}>
      {/* Branding */}
      <div className="fade-in" style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 12 }}>
          <div style={{ background: T.red, borderRadius: 12, padding: 12, animation: "pulse-red 2s infinite" }}>
            <Shield size={32} color="#fff" />
          </div>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              {L.appName}
            </div>
            <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase" }}>
              {L.appSub}
            </div>
          </div>
        </div>
        <div style={{ height: 1, background: `linear-gradient(90deg,transparent,${T.red},transparent)`, width: 300, margin: "0 auto" }} />
      </div>

      {/* Login card */}
      <div className="fade-in" style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 10, padding: 36, width: 380, maxWidth: "95vw",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>
        <div style={{ fontSize: 12, color: T.textMuted, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 24, textAlign: "center" }}>
          {L.login}  RESTRICTED ACCESS
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ display: "block", fontSize: 11, color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>
              {L.email}
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="user@eims.gov.lb"
              onKeyDown={e => e.key === "Enter" && handleLogin()}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>
              {L.password}
            </label>
            <input
              type="password"
              value={pass}
              onChange={e => setPass(e.target.value)}
              placeholder="••••••"
              onKeyDown={e => e.key === "Enter" && handleLogin()}
            />
          </div>

          {err && (
            <div style={{ color: T.red, fontSize: 12, background: T.redGlow, padding: "8px 12px", borderRadius: 4, border: `1px solid ${T.redDark}` }}>
              {err}
            </div>
          )}

          {/* BUG FIX: use e.currentTarget for brightness effect */}
          <button
            onClick={handleLogin}
            disabled={loading}
            style={{
              background: loading ? T.redDark : T.red, color: "#fff", border: "none",
              borderRadius: 5, padding: "12px", fontFamily: "'Rajdhani',sans-serif",
              fontWeight: 700, fontSize: 14, letterSpacing: "0.15em", textTransform: "uppercase",
              cursor: loading ? "not-allowed" : "pointer", marginTop: 6, transition: "filter .2s",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.filter = "brightness(1.2)"; }}
            onMouseLeave={e => { e.currentTarget.style.filter = ""; }}
          >
            {loading
              ? <RefreshCw size={14} className="spin" />
              : <Lock size={14} />
            }
            {loading ? L.loading : L.loginBtn}
          </button>
        </div>

        <button
          onClick={() => setLang(l => l === "en" ? "ar" : "en")}
          style={{ marginTop: 20, width: "100%", background: "none", border: "none", color: T.textMuted, fontSize: 12, cursor: "pointer" }}
        >
          {lang === "en" ? "عربي" : "English"}
        </button>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 11  DASHBOARD  (UR-2, UR-25, UR-35, SR-25.1–25.3)
   Fetches live incident list every 30 seconds for real-time KPIs.
══════════════════════════════════════════════════════════════════════════════ */
const Dashboard = ({ L, incidents, loading }) => {
  const active  = incidents.filter(i => i.status === "active").length;
  const pending = incidents.filter(i => i.status === "pending").length;
  const closed  = incidents.filter(i => i.status === "closed").length;
  const avTeams = STATIC_TEAMS.filter(t => t.status === "available").length;

  // BUG FIX: response times stabilised; not re-generated on every render
  const responseTimes = useMemo(
    () => Object.fromEntries(incidents.map(i => [i.displayId, (Math.random() * 6 + 2).toFixed(1)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [] // intentionally empty: mock values need only be seeded once
  );

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SectionTitle icon={Gauge} title={L.dashboard} subtitle="Real-time command overview" />

      {/* KPI row (SR-25.1–25.3) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14 }}>
        <StatCard label={L.activeIncidents} value={loading ? "…" : active}  sub={`${pending} pending`}         icon={AlertTriangle} color={T.red}        trend={12} />
        <StatCard label={L.availableTeams}  value={avTeams}                  sub={`${STATIC_TEAMS.length} total`} icon={Users}         color={T.greenLight} trend={-5} />
        <StatCard label={L.avgResponseTime} value="4.8"                      sub={L.minutes + " avg today"}    icon={Clock}         color={T.amberLight} trend={-8} />
        <StatCard label={L.resolvedToday}   value={loading ? "…" : closed}   sub="incidents closed"            icon={CheckCircle}   color={T.greenLight} trend={20} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20 }}>
        {/* Weekly stats bar chart (UR-22) */}
        <Card>
          <div style={{ marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em" }}>{L.weeklyStats}</span>
            <span style={{ color: T.textMuted, fontSize: 11 }}>Last 7 days</span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={CHART_WEEKLY} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false} />
              <XAxis dataKey="day"       tick={{ fill: T.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis                     tick={{ fill: T.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 12 }} />
              <Bar dataKey="incidents" fill={T.red}   radius={[3,3,0,0]} name="Incidents" />
              <Bar dataKey="resolved"  fill={T.green} radius={[3,3,0,0]} name="Resolved" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Incident type pie (UR-22, SR-22.2) */}
          <Card>
            <div style={{ fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 14 }}>
              {L.incidentsByType}
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={CHART_BY_TYPE} cx="50%" cy="50%" innerRadius={40} outerRadius={60} paddingAngle={2} dataKey="value">
                  {CHART_BY_TYPE.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 6 }}>
              {CHART_BY_TYPE.map(e => (
                <div key={e.name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: T.textDim }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: e.color, display: "inline-block" }} />
                  {e.name} {e.value}%
                </div>
              ))}
            </div>
          </Card>

          {/* Weather widget (UR-35, SR-35.2) */}
          <Card style={{ background: `linear-gradient(135deg,${T.surfaceAlt},${T.surface})` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
                  {L.weather}  Beirut
                </div>
                <div style={{ fontSize: 30, fontWeight: 700, color: T.text }}>27°C</div>
                <div style={{ color: T.textDim, fontSize: 12, marginTop: 2 }}>Partly Cloudy</div>
              </div>
              <CloudRain size={36} color="#60a5fa" opacity={0.7} />
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
              {[["Wind","18 km/h",Wind],["Humidity","65%",Wifi],["Visibility","8 km",Eye]].map(([l,v,Icon]) => (
                <div key={l}>
                  <div style={{ color: T.textMuted, fontSize: 10, textTransform: "uppercase" }}>{l}</div>
                  <div style={{ color: T.textDim, fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                    <Icon size={11} />{v}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ color: T.textMuted, fontSize: 10, marginTop: 8 }}>SR-35.1 External weather service</div>
          </Card>
        </div>
      </div>

      {/* Recent incidents (UR-2, SR-2.3) */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em" }}>Recent Incidents</span>
          {loading
            ? <RefreshCw size={14} className="spin" color={T.textMuted} />
            : <StatusBadge status="active" L={L} />
          }
        </div>
        {loading ? <LoadingRow L={L} /> : (
          <DataTable
            cols={[L.incidentId, L.incidentType, L.location, L.priority, L.status, L.assignedTeam]}
            rows={incidents.slice(0, 5)}
            renderRow={row => [
              <Td key="id"><span style={{ fontFamily:"'DM Mono',monospace", color:T.blueLight, fontSize:12 }}>{row.displayId}</span></Td>,
              <Td key="type"><div style={{ display:"flex", alignItems:"center", gap:6 }}><TypeIcon type={row.type} />{row.type}</div></Td>,
              <Td key="loc" style={{ maxWidth:200, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{row.location}</Td>,
              <Td key="pri"><PriorityBadge level={row.priority} L={L} /></Td>,
              <Td key="sta"><StatusBadge status={row.status} L={L} /></Td>,
              <Td key="team" style={{ color:T.textDim }}>{row.team || "-"}</Td>,
            ]}
          />
        )}
      </Card>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 12 INCIDENTS PAGE  (UR-1–8)
   Full CRUD against the backend incidents API.
══════════════════════════════════════════════════════════════════════════════ */
const IncidentsPage = ({ L, incidents, setIncidents, user, toast }) => {
  const [filter,      setFilter]      = useState("all");
  const [search,      setSearch]      = useState("");
  const [showNew,     setShowNew]     = useState(false);
  const [detail,      setDetail]      = useState(null);
  const [assignModal, setAssignModal] = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [availTeams,  setAvailTeams]  = useState(STATIC_TEAMS.filter(t => t.status === "available"));

  // SR-1.x new incident form (location = description text for UR-1)
  const [form, setForm] = useState({
    category: "fire", priority: "medium",
    description: "", latitude: 33.88, longitude: 35.49,
  });

  /** SR-3.1: fetch available teams from backend (Dispatcher / Admin only) */
  useEffect(() => {
    if (user?.role === "Dispatcher" || user?.role === "Admin") {
      api.get("/api/v1/incidents/available-teams")
        .then(data => {
          if (data?.available_teams?.length) {
            setAvailTeams(data.available_teams);
          }
        })
        .catch(() => { /* fallback to static teams */ });
    }
  }, [user?.role]);

  /** SR-18.1: try to capture the browser's geolocation as best-effort */
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        setForm(f => ({ ...f, latitude: pos.coords.latitude, longitude: pos.coords.longitude }));
      });
    }
  }, []);

  /** SR-1.1–1.4: create a new incident via POST /api/v1/incidents/ */
  const createIncident = async () => {
    if (!form.description.trim()) { toast("Description is required.", "error"); return; }
    setLoading(true);
    try {
      const body = {
        category:    toBackendCategory(form.category),
        priority:    toBackendPriority(form.priority),
        latitude:    form.latitude,
        longitude:   form.longitude,
        description: form.description,
      };
      const created = await api.post("/api/v1/incidents/", body);
      setIncidents(prev => [normaliseIncident(created), ...prev]);
      setForm({ category: "fire", priority: "medium", description: "", latitude: 33.88, longitude: 35.49 });
      setShowNew(false);
      toast("Incident created successfully.", "success");
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setLoading(false);
    }
  };

  /** SR-4.1–4.3: close an incident (Dispatcher / Admin only) */
  const closeIncident = async (incId) => {
    try {
      await api.patch(`/api/v1/incidents/${incId.backendId}/status`, { status: "Closed" });
      setIncidents(prev => prev.map(i => i.backendId === incId.backendId ? { ...i, status: "closed" } : i));
      toast("Incident closed.", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  };

  /** SR-3.2–3.4: assign a team (Dispatcher only) */
  const assignTeam = async (inc, teamId) => {
    try {
      await api.post(`/api/v1/incidents/${inc.backendId}/assign-team?team_id=${teamId}`, {});
      setIncidents(prev => prev.map(i =>
        i.backendId === inc.backendId
          ? { ...i, team: typeof teamId === "string" ? teamId : `Team-${teamId}`, status: "active" }
          : i
      ));
      setAssignModal(null);
      toast("Team assigned and notified. (SR-3.4, SR-9.1)", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  };

  /** Displayed rows after filter + search (SR-5.2, SR-5.3) */
  const displayed = incidents.filter(i => {
    const matchFilter = filter === "all" || i.status === filter;
    const matchSearch = !search
      || i.displayId.toLowerCase().includes(search.toLowerCase())
      || i.location.toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  const canClose  = user?.role === "Dispatcher" || user?.role === "Admin";
  const canAssign = user?.role === "Dispatcher";

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SectionTitle icon={AlertTriangle} title={L.incidents} subtitle="Create, monitor and manage all active and historical incidents" />

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: T.textMuted }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={L.search} style={{ paddingLeft: 32 }} />
        </div>
        {["all","active","pending","closed"].map(f => (
          <Btn key={f} variant={filter === f ? "primary" : "ghost"} onClick={() => setFilter(f)}>
            {f.toUpperCase()}
          </Btn>
        ))}
        <Btn icon={Plus} variant="primary" onClick={() => setShowNew(true)}>{L.createIncident}</Btn>
      </div>

      {/* Incidents table */}
      <Card style={{ padding: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <DataTable
            cols={[L.incidentId, L.incidentType, L.location, L.priority, L.status, L.assignedTeam, L.reportedAt, L.actions]}
            rows={displayed}
            renderRow={row => [
              <Td key="id"><span style={{ fontFamily:"'DM Mono',monospace", color:T.blueLight, fontSize:12 }}>{row.displayId}</span></Td>,
              <Td key="type">
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <TypeIcon type={row.type} />
                  <span style={{ textTransform:"capitalize" }}>{row.type}</span>
                </div>
              </Td>,
              <Td key="loc" style={{ maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color:T.textDim }}>{row.location}</Td>,
              <Td key="pri"><PriorityBadge level={row.priority} L={L} /></Td>,
              <Td key="sta"><StatusBadge status={row.status} L={L} /></Td>,
              <Td key="team" style={{ color:row.team ? T.text : T.textMuted }}>{row.team || "-"}</Td>,
              <Td key="time" style={{ color:T.textMuted, fontFamily:"'DM Mono',monospace", fontSize:12 }}>{row.reportedAt}</Td>,
              <Td key="act">
                <div style={{ display:"flex", gap:6 }}>
                  <Btn variant="ghost" icon={Eye} onClick={() => setDetail(row)} />
                  {row.status !== "closed" && canAssign && (
                    <Btn variant="ghost" icon={Users} onClick={() => setAssignModal(row)}>{L.assign}</Btn>
                  )}
                  {row.status !== "closed" && canClose && (
                    <Btn variant="ghost" icon={CheckCircle} onClick={() => closeIncident(row)}>{L.close}</Btn>
                  )}
                </div>
              </Td>,
            ]}
          />
        </div>
        <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, color: T.textMuted, fontSize: 12 }}>
          {displayed.length} incidents shown
        </div>
      </Card>

      {/* ── Create Incident Modal (UR-1, SR-1.1–1.4) ── */}
      <Modal open={showNew} onClose={() => setShowNew(false)} title={L.createIncident}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* SR-1.2: incident type required */}
          <div>
            <label style={{ display:"block", fontSize:11, color:T.textMuted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>
              {L.incidentType} *
            </label>
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {/* SR-6.1: predefined category list matching backend IncidentCategory enum */}
              {["fire","flood","medical","accident","traffic","other"].map(t => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>

          {/* SR-7.1: predefined priority levels including Critical */}
          <div>
            <label style={{ display:"block", fontSize:11, color:T.textMuted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>
              {L.priority}
            </label>
            <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          <div>
            <label style={{ display:"block", fontSize:11, color:T.textMuted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>
              {L.notes} *
            </label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} style={{ resize:"vertical" }} />
          </div>

          {/* SR-18.1: location coordinates */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div>
              <label style={{ display:"block", fontSize:11, color:T.textMuted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>Latitude</label>
              <input type="number" step="0.0001" value={form.latitude} onChange={e => setForm(f => ({ ...f, latitude: parseFloat(e.target.value) }))} />
            </div>
            <div>
              <label style={{ display:"block", fontSize:11, color:T.textMuted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>Longitude</label>
              <input type="number" step="0.0001" value={form.longitude} onChange={e => setForm(f => ({ ...f, longitude: parseFloat(e.target.value) }))} />
            </div>
          </div>

          {/* SR-1.3: auto timestamp info */}
          <div style={{ background:T.surfaceAlt, border:`1px solid ${T.border}`, borderRadius:4, padding:"8px 12px", fontSize:12, color:T.textMuted, display:"flex", gap:8, alignItems:"center" }}>
            <Clock size={12} /> Timestamp & unique ID recorded automatically by server (SR-1.3, SR-1.4)
          </div>

          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <Btn variant="ghost" onClick={() => setShowNew(false)}>{L.cancel}</Btn>
            <Btn variant="primary" icon={Plus} onClick={createIncident} disabled={loading}>
              {loading ? L.loading : L.submit}
            </Btn>
          </div>
        </div>
      </Modal>

      {/* ── Incident Detail Modal (UR-8, SR-8.1–8.3) ── */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={L.incidentDetails} width={580}>
        {detail && (
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              {[
                ["ID",          detail.displayId],
                ["Type",        detail.type],
                ["Priority",    detail.priority],
                ["Status",      detail.status],
                ["Team",        detail.team || "-"],
                ["Reported",    detail.reportedAt],
                ["Description", detail.location],
              ].map(([k, v]) => (
                <div key={k} style={{ gridColumn: k === "Description" ? "span 2" : "auto" }}>
                  <div style={{ color:T.textMuted, fontSize:10, textTransform:"uppercase", letterSpacing:"0.1em" }}>{k}</div>
                  <div style={{ color:T.text, fontSize:13, marginTop:3, textTransform:"capitalize" }}>{v}</div>
                </div>
              ))}
            </div>

            {/* SR-8.1–8.3: action log */}
            <div>
              <div style={{ fontWeight:700, fontSize:12, textTransform:"uppercase", letterSpacing:"0.08em", color:T.textMuted, marginBottom:8 }}>
                Action Log
              </div>
              {[
                { user: "System",    action: "Incident created",                     ts: detail.reportedAt + ":00" },
                { user: "System",    action: `Priority set to ${detail.priority}`,   ts: detail.reportedAt + ":02" },
                detail.team && { user: "Dispatcher", action: `Team ${detail.team} assigned`, ts: detail.reportedAt + ":05" },
              ].filter(Boolean).map((a, i) => (
                <div key={i} style={{ display:"flex", gap:12, padding:"7px 0", borderBottom:`1px solid ${T.border}`, fontSize:12 }}>
                  <span style={{ color:T.textMuted, fontFamily:"'DM Mono',monospace", minWidth:60 }}>{a.ts}</span>
                  <span style={{ color:T.blueLight, minWidth:90 }}>{a.user}</span>
                  <span style={{ color:T.textDim }}>{a.action}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* ── Assign Team Modal (UR-3, SR-3.1–3.4) ── */}
      <Modal open={!!assignModal} onClose={() => setAssignModal(null)} title={`${L.assign} Team`} width={420}>
        {assignModal && (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <div style={{ color:T.textMuted, fontSize:12, marginBottom:6 }}>
              Assigning to <span style={{ color:T.blueLight, fontFamily:"'DM Mono',monospace" }}>{assignModal.displayId}</span>
            </div>
            {availTeams.length === 0
              ? <div style={{ color:T.textMuted, fontSize:13 }}>No teams available.</div>
              : availTeams.map((t, idx) => (
                  <div key={t.id || idx} style={{
                    display:"flex", justifyContent:"space-between", alignItems:"center",
                    padding:"10px 12px", background:T.surfaceAlt, borderRadius:5, border:`1px solid ${T.border}`,
                  }}>
                    <div>
                      <div style={{ fontWeight:700, fontSize:13 }}>{t.name || `Team ${t.id}`}</div>
                      <div style={{ color:T.textMuted, fontSize:11 }}>{t.type} · {t.members ?? "?"} members</div>
                    </div>
                    <Btn variant="primary" onClick={() => assignTeam(assignModal, t.id)}>{L.assign}</Btn>
                  </div>
                ))
            }
          </div>
        )}
      </Modal>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 13 MAP PAGE  (UR-2, UR-16, UR-17, UR-20)
   Displays incidents on a canvas-based simulated map.
   Overlays high-risk zones (UR-20) and vehicle positions (UR-16 static).
══════════════════════════════════════════════════════════════════════════════ */
const MapPage = ({ L, incidents }) => {
  const [selectedInc,   setSelectedInc]   = useState(null);
  const [showVehicles,  setShowVehicles]  = useState(true);
  const [showRiskZones, setShowRiskZones] = useState(true);

  /** Convert lat/lng to percentage coordinates on the canvas */
  const toXY = (lat, lng) => ({
    x: ((lng - 35.45) / 0.12) * 100,
    y: (1 - (lat - 33.84) / 0.08) * 100,
  });

  /** SR-20.1: predefined high-risk zone boundaries */
  const riskZones = [
    { label: "Industrial Zone",   lat: 33.862, lng: 35.515, w: 6, h: 4 },
    { label: "Flood Plain",       lat: 33.875, lng: 35.495, w: 5, h: 3 },
    { label: "High-Density Area", lat: 33.893, lng: 35.503, w: 4, h: 4 },
  ];

  return (
    <div className="fade-in" style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <SectionTitle icon={MapPin} title={L.map} subtitle="Real-time incident locations, vehicle tracking, and high-risk zones" />

      <div style={{ display:"grid", gridTemplateColumns:"1fr 280px", gap:16 }}>
        {/* Map canvas */}
        <Card style={{ padding:0, overflow:"hidden", position:"relative" }}>
          {/* Map layer toggle controls */}
          <div style={{ position:"absolute", top:12, left:12, zIndex:5, display:"flex", gap:8, flexWrap:"wrap" }}>
            <Btn variant={showVehicles ? "primary" : "ghost"}   size="sm" icon={Car}          onClick={() => setShowVehicles(v => !v)}>{L.vehicleTracking}</Btn>
            <Btn variant={showRiskZones ? "warning" : "ghost"}  size="sm" icon={AlertTriangle} onClick={() => setShowRiskZones(v => !v)}>{L.highRiskZones}</Btn>
          </div>

          {/* Simulated map canvas (UR-2, SR-2.1) */}
          <div style={{
            height: 480, background: "#0d1b2a", position: "relative", overflow: "hidden",
            backgroundImage: "linear-gradient(rgba(30,45,69,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(30,45,69,0.5) 1px,transparent 1px)",
            backgroundSize: "40px 40px",
          }}>
            {/* Decorative road lines */}
            {[[10,50,80,50],[50,10,50,90],[20,30,80,70],[30,70,70,30]].map(([x1,y1,x2,y2],i) => (
              <svg key={i} style={{ position:"absolute", inset:0, width:"100%", height:"100%", pointerEvents:"none" }}>
                <line x1={`${x1}%`} y1={`${y1}%`} x2={`${x2}%`} y2={`${y2}%`}
                  stroke={T.border} strokeWidth={2} strokeDasharray={i % 2 ? "6 4" : "none"} />
              </svg>
            ))}

            {/* SR-20.2: high-risk zone overlays */}
            {showRiskZones && riskZones.map((z, i) => {
              const { x, y } = toXY(z.lat, z.lng);
              return (
                <div key={i} style={{
                  position:"absolute", left:`${x}%`, top:`${y}%`,
                  width:`${z.w}%`, height:`${z.h}%`,
                  background:"rgba(217,119,6,0.12)",
                  border:`1px dashed ${T.amber}`, borderRadius:4,
                  display:"flex", alignItems:"center", justifyContent:"center",
                }}>
                  <span style={{ fontSize:9, color:T.amber, fontWeight:700, textAlign:"center", padding:2 }}>{z.label}</span>
                </div>
              );
            })}

            {/* SR-2.1: active incident markers */}
            {incidents.filter(i => i.status !== "closed").map(inc => {
              const { x, y } = toXY(inc.lat, inc.lng);
              const color = inc.priority === "high" || inc.priority === "critical" ? T.red
                : inc.priority === "medium" ? T.amber : T.greenLight;
              return (
                <div key={inc.displayId} onClick={() => setSelectedInc(inc)} style={{
                  position:"absolute", left:`${x}%`, top:`${y}%`,
                  transform:"translate(-50%,-50%)", cursor:"pointer", zIndex:3,
                }}>
                  <div style={{ position:"relative" }}>
                    <div style={{
                      width:16, height:16, borderRadius:"50%", background:color,
                      border:`2px solid ${T.bg}`, boxShadow:`0 0 0 4px ${color}33`,
                      animation: (inc.priority === "high" || inc.priority === "critical") ? "pulse-red 2s infinite" : "none",
                    }} />
                    {selectedInc?.displayId === inc.displayId && (
                      <div style={{
                        position:"absolute", left:20, top:-4,
                        background:T.surface, border:`1px solid ${T.border}`,
                        borderRadius:4, padding:"2px 6px", fontSize:10,
                        whiteSpace:"nowrap", color:T.text, fontFamily:"'DM Mono',monospace",
                      }}>
                        {inc.displayId} · {inc.type}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* SR-17.1–17.2: team availability markers (UR-17) */}
            {showVehicles && STATIC_TEAMS.map(t => {
              const { x, y } = toXY(t.lat, t.lng);
              return (
                <div key={t.id} style={{
                  position:"absolute", left:`${x}%`, top:`${y}%`,
                  transform:"translate(-50%,-50%)", zIndex:2,
                }}>
                  <div style={{
                    background: t.status === "available" ? T.green : T.surfaceAlt,
                    border:`1px solid ${t.status === "available" ? T.green : T.borderBright}`,
                    borderRadius:4, padding:"2px 5px",
                    fontSize:9, color:"#fff", fontWeight:700, whiteSpace:"nowrap",
                  }}>
                    ▲ {t.name}
                  </div>
                </div>
              );
            })}

            {/* Map legend */}
            <div style={{
              position:"absolute", bottom:12, right:12,
              background:"rgba(15,22,35,0.92)", border:`1px solid ${T.border}`,
              borderRadius:6, padding:10, fontSize:11, display:"flex", flexDirection:"column", gap:5,
            }}>
              {[
                [T.red,        "High / Critical"],
                [T.amber,      "Medium Priority"],
                [T.greenLight, "Low Priority"],
                [T.green,      "Team Available"],
                [T.amber+"77", "Risk Zone"],
              ].map(([c,l]) => (
                <div key={l} style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ width:10, height:10, borderRadius:"50%", background:c, display:"inline-block" }} />
                  <span style={{ color:T.textDim }}>{l}</span>
                </div>
              ))}
            </div>

            <div style={{
              position:"absolute", top:12, right:12,
              background:"rgba(15,22,35,0.8)", border:`1px solid ${T.border}`,
              borderRadius:4, padding:"4px 10px", fontSize:10, color:T.textMuted, letterSpacing:"0.1em",
            }}>
              BEIRUT AREA · SIMULATED
            </div>
          </div>
        </Card>

        {/* Right panel */}
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {/* Selected incident info + navigation (UR-19) */}
          {selectedInc ? (
            <Card>
              <div style={{ fontWeight:700, fontSize:12, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10, color:T.red }}>
                Incident Selected
              </div>
              <div style={{ fontFamily:"'DM Mono',monospace", color:T.blueLight, fontSize:13, marginBottom:6 }}>{selectedInc.displayId}</div>
              <div style={{ fontSize:13, color:T.text, marginBottom:4 }}>{selectedInc.location}</div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:10 }}>
                <PriorityBadge level={selectedInc.priority} L={L} />
                <StatusBadge status={selectedInc.status} L={L} />
              </div>
              {/* SR-19.1–19.2: open navigation (deep-link to mapping app) */}
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${selectedInc.lat},${selectedInc.lng}`}
                target="_blank" rel="noreferrer"
                style={{ textDecoration:"none", display:"block" }}
              >
                <Btn icon={Navigation} variant="primary" size="sm" style={{ width:"100%" }}>{L.navDirections}</Btn>
              </a>
            </Card>
          ) : (
            <Card style={{ textAlign:"center", color:T.textMuted, fontSize:12 }}>
              <MapPin size={24} style={{ margin:"0 auto 8px", display:"block", color:T.border }} />
              Click a marker to see details
            </Card>
          )}

          {/* Team availability list (UR-17, SR-17.1–17.2) */}
          <Card style={{ flex:1 }}>
            <div style={{ fontWeight:700, fontSize:12, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>
              {L.availableTeams}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:8, overflowY:"auto", maxHeight:280 }}>
              {STATIC_TEAMS.map(t => (
                <div key={t.id} style={{
                  display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"7px 10px", background:T.surfaceAlt, borderRadius:4,
                }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:12 }}>{t.name}</div>
                    <div style={{ color:T.textMuted, fontSize:11 }}>{t.type}</div>
                  </div>
                  <StatusBadge status={t.status} L={L} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 14 COMMUNICATIONS PAGE  (UR-9–15)
   - Team chat via WebSocket (UR-10, SR-10.1–10.2)
   - Citizen alerts (UR-15, SR-15.1–15.2)
   - Media upload to backend (UR-11–12, SR-11.1–12.2)
   - Voice notes (UR-13, SR-13.1–13.2)
══════════════════════════════════════════════════════════════════════════════ */
const CommsPage = ({ L, user, toast }) => {
  const [tab,       setTab]       = useState("chat");
  const [msgs,      setMsgs]      = useState([
    { id: 1, sender: "HQ Dispatch", text: "Active incident INC-001 request additional units.", time: "08:16", own: false },
    { id: 2, sender: "You",         text: "Alpha-2 en route. ETA 4 minutes.",                   time: "08:17", own: true  },
  ]);
  const [newMsg,    setNewMsg]    = useState("");
  const [alertTxt,  setAlertTxt]  = useState("");
  const [wsStatus,  setWsStatus]  = useState("disconnected");
  const [uploading, setUploading] = useState(false);
  const chatRef = useRef(null);
  const wsRef   = useRef(null);

  /** Open a WebSocket for incident chat (UR-10, SR-10.1) */
  const connectWs = useCallback((incidentId = 1) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(
      `${WS_BASE}/api/v1/ws/chat/${incidentId}?user_id=${user?.id || 1}&user_name=${encodeURIComponent(user?.name || "User")}`
    );
    ws.onopen    = () => setWsStatus("connected");
    ws.onclose   = () => setWsStatus("disconnected");
    ws.onerror   = () => setWsStatus("error");
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "chat_message") {
        setMsgs(m => [...m, {
          id:     Date.now(),
          sender: data.data.user_name,
          text:   data.data.message,
          time:   new Date(data.data.timestamp).toLocaleTimeString("en", { hour:"2-digit", minute:"2-digit" }),
          own:    data.data.user_id === (user?.id || 1),
        }]);
      }
    };
    wsRef.current = ws;
  }, [user]);

  useEffect(() => {
    connectWs();
    return () => wsRef.current?.close();
  }, [connectWs]);

  /** SR-10.1: send a chat message through WebSocket or fallback to local state */
  const sendMsg = () => {
    if (!newMsg.trim()) return;
    const message = {
      id:     Date.now(),
      sender: "You",
      text:   newMsg,
      time:   new Date().toLocaleTimeString("en", { hour:"2-digit", minute:"2-digit" }),
      own:    true,
    };
    // Send via WebSocket if open, else add locally
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "message", content: newMsg }));
    } else {
      setMsgs(m => [...m, message]);
    }
    setNewMsg("");
    setTimeout(() => chatRef.current?.scrollTo(0, chatRef.current.scrollHeight), 50);
  };

  /** SR-11.1–12.2: upload image or video to /api/v1/media/upload */
  const handleMediaUpload = async (e, fileType) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("incident_id", "1"); // In production, this would be the selected incident ID
      fd.append("file_type",   fileType);
      fd.append("file",        file);
      await api.upload("/api/v1/media/upload", fd);
      toast(`${fileType} uploaded and linked to incident. (SR-${fileType === "image" ? "11" : "12"}.2)`, "success");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  /** SR-13.1: record voice note (browser MediaRecorder API) */
  const mediaRecRef   = useRef(null);
  const [recording, setRecording] = useState(false);
  const [voiceNotes, setVoiceNotes] = useState([]);

  const toggleRecording = async () => {
    if (recording) {
      mediaRecRef.current?.stop();
      setRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const rec    = new MediaRecorder(stream);
        const chunks = [];
        rec.ondataavailable = e => chunks.push(e.data);
        rec.onstop = () => {
          const blob = new Blob(chunks, { type: "audio/webm" });
          const url  = URL.createObjectURL(blob);
          setVoiceNotes(vn => [...vn, { url, name: `Voice_${Date.now()}.webm` }]);
          toast("Voice note saved. (SR-13.2)", "success");
          stream.getTracks().forEach(t => t.stop());
        };
        rec.start();
        mediaRecRef.current = rec;
        setRecording(true);
      } catch {
        toast("Microphone access denied.", "error");
      }
    }
  };

  const tabs = [
    { id:"chat",   icon:MessageSquare, label:L.teamChat     },
    { id:"alerts", icon:Bell,          label:L.citizenAlert },
    { id:"media",  icon:Camera,        label:L.media        },
    { id:"voice",  icon:Mic,           label:L.voiceNotes   },
  ];

  return (
    <div className="fade-in" style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <SectionTitle icon={MessageSquare} title={L.comms} subtitle="Team messaging, citizen alerts, and media management" />

      {/* Tabs */}
      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            display:"flex", alignItems:"center", gap:7, padding:"8px 14px",
            background: tab === t.id ? T.red : "transparent",
            color:      tab === t.id ? "#fff" : T.textMuted,
            border:`1px solid ${tab === t.id ? T.red : T.border}`,
            borderRadius:5, cursor:"pointer", fontSize:12, fontWeight:700,
            letterSpacing:"0.06em", textTransform:"uppercase", fontFamily:"'Rajdhani',sans-serif",
          }}>
            <t.icon size={13} />{t.label}
          </button>
        ))}
        {/* WebSocket connection status */}
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:6, fontSize:11, color: wsStatus === "connected" ? T.greenLight : T.textMuted }}>
          <span style={{ width:6, height:6, borderRadius:"50%", background: wsStatus === "connected" ? T.greenLight : T.textMuted, display:"inline-block" }} />
          {wsStatus === "connected" ? L.connected : L.offline}
        </div>
      </div>

      {/* Team Chat (UR-10) */}
      {tab === "chat" && (
        <div style={{ display:"grid", gridTemplateColumns:"240px 1fr", gap:16 }}>
          {/* Channel list */}
          <Card>
            <div style={{ fontWeight:700, fontSize:12, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:12, color:T.textMuted }}>Channels</div>
            {["#general","#incident-001","#incident-002","#ops-command"].map((ch, i) => (
              <div key={ch} style={{
                padding:"8px 10px", borderRadius:4, cursor:"pointer",
                color:      i === 1 ? T.text : T.textMuted,
                background: i === 1 ? T.surfaceAlt : "transparent",
                fontSize:13, marginBottom:2, fontFamily:"'DM Mono',monospace",
              }}>
                {ch}
                {i === 1 && (
                  <span style={{
                    float:"right", background:T.red, color:"#fff",
                    borderRadius:10, padding:"1px 6px", fontSize:10,
                    fontFamily:"'Rajdhani',sans-serif",
                  }}>2</span>
                )}
              </div>
            ))}
          </Card>

          {/* Message thread (SR-10.2) */}
          <Card style={{ display:"flex", flexDirection:"column", padding:0 }}>
            <div style={{ padding:"12px 16px", borderBottom:`1px solid ${T.border}`, fontWeight:700, fontSize:13 }}>
              #incident-001 · INC-001
            </div>
            <div ref={chatRef} style={{
              flex:1, overflowY:"auto", padding:16,
              display:"flex", flexDirection:"column", gap:12,
              minHeight:300, maxHeight:380,
            }}>
              {msgs.map(m => (
                <div key={m.id} style={{ display:"flex", flexDirection:m.own ? "row-reverse" : "row", gap:10, alignItems:"flex-end" }}>
                  {!m.own && (
                    <div style={{
                      width:28, height:28, borderRadius:"50%", background:T.borderBright,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontSize:11, fontWeight:700, flexShrink:0,
                    }}>
                      {m.sender[0]}
                    </div>
                  )}
                  <div style={{ maxWidth:"70%" }}>
                    {!m.own && <div style={{ fontSize:10, color:T.textMuted, marginBottom:3 }}>{m.sender}</div>}
                    <div style={{
                      background:   m.own ? T.red : T.surfaceAlt,
                      borderRadius: m.own ? "8px 8px 0 8px" : "8px 8px 8px 0",
                      padding:"8px 12px", fontSize:13, color:T.text,
                    }}>
                      {m.text}
                    </div>
                    <div style={{ fontSize:10, color:T.textMuted, marginTop:3, textAlign:m.own ? "right" : "left" }}>{m.time}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding:12, borderTop:`1px solid ${T.border}`, display:"flex", gap:10 }}>
              <input
                value={newMsg}
                onChange={e => setNewMsg(e.target.value)}
                placeholder={L.message + "…"}
                onKeyDown={e => e.key === "Enter" && sendMsg()}
                style={{ flex:1 }}
              />
              <Btn variant="primary" icon={MessageSquare} onClick={sendMsg}>{L.send}</Btn>
            </div>
          </Card>
        </div>
      )}

      {/* Citizen Alerts (UR-15, SR-15.1–15.2) */}
      {tab === "alerts" && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 300px", gap:16 }}>
          <Card>
            <div style={{ fontWeight:700, fontSize:13, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:14, color:T.amber }}>
              ⚠ {L.citizenAlert}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              {/* SR-15.1: compose alert message */}
              <div>
                <label style={{ display:"block", fontSize:11, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:6 }}>Alert Message</label>
                <textarea rows={4} value={alertTxt} onChange={e => setAlertTxt(e.target.value)} placeholder="Enter emergency alert for citizens…" style={{ resize:"vertical" }} />
              </div>
              <div>
                <label style={{ display:"block", fontSize:11, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:6 }}>Target Area</label>
                <select>
                  <option>All Beirut</option>
                  <option>Al-Hamra</option>
                  <option>Verdun</option>
                  <option>Ashrafieh</option>
                </select>
              </div>
              {/* SR-15.2: send to citizens */}
              <Btn
                variant="warning" icon={Bell}
                onClick={() => {
                  if (!alertTxt.trim()) { toast("Alert message cannot be empty.", "error"); return; }
                  toast("Citizen alert broadcast sent. (SR-15.2)", "success");
                  setAlertTxt("");
                }}
              >
                {L.sendAlert}
              </Btn>
            </div>
          </Card>
          <Card>
            <div style={{ fontWeight:700, fontSize:12, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:12, color:T.textMuted }}>Recent Alerts</div>
            {["Evacuation order: Industrial Zone","Road closure: Ring Road","Chemical alert lifted"].map((a, i) => (
              <div key={i} style={{ padding:"8px 0", borderBottom:`1px solid ${T.border}`, fontSize:12, color:T.textDim }}>{a}</div>
            ))}
          </Card>
        </div>
      )}

      {/* Media Upload (UR-11, UR-12, SR-11.1–12.2) */}
      {tab === "media" && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          {[["Images","image",Camera,".jpg,.png,.gif"],["Videos","video",Video,".mp4,.mov"]].map(([label,ftype,Icon,accept]) => (
            <Card key={label}>
              <div style={{ fontWeight:700, fontSize:13, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:14, display:"flex", alignItems:"center", gap:8 }}>
                <Icon size={15} color={T.red} /> {label}
              </div>
              <label style={{ cursor:"pointer", display:"block" }}>
                <div
                  style={{ border:`2px dashed ${T.border}`, borderRadius:6, padding:30, textAlign:"center", marginBottom:12 }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = T.red; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; }}
                >
                  <Upload size={24} color={T.textMuted} style={{ margin:"0 auto 10px", display:"block" }} />
                  <div style={{ color:T.textMuted, fontSize:13 }}>
                    Drop {label.toLowerCase()} here or <span style={{ color:T.red }}>browse</span>
                  </div>
                  <div style={{ color:T.textMuted, fontSize:11, marginTop:4 }}>{accept}</div>
                </div>
                <input type="file" accept={accept} style={{ display:"none" }} onChange={e => handleMediaUpload(e, ftype)} disabled={uploading} />
              </label>
              {uploading && <div style={{ color:T.textMuted, fontSize:12, textAlign:"center" }}>{L.loading}</div>}
            </Card>
          ))}
        </div>
      )}

      {/* Voice Notes (UR-13, SR-13.1–13.2) */}
      {tab === "voice" && (
        <Card style={{ maxWidth:480 }}>
          <div style={{ fontWeight:700, fontSize:13, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:20, display:"flex", alignItems:"center", gap:8 }}>
            <Mic size={15} color={T.red} /> {L.voiceNotes}
          </div>
          <div style={{ textAlign:"center" }}>
            {/* SR-13.1: recording button */}
            <button
              onClick={toggleRecording}
              style={{
                width:72, height:72, borderRadius:"50%",
                background: recording ? T.amber : T.red,
                border:"none", cursor:"pointer",
                display:"flex", alignItems:"center", justifyContent:"center",
                margin:"0 auto 16px",
                boxShadow:`0 0 20px ${recording ? T.amber : T.red}44`,
                animation: recording ? "pulse-red 1s infinite" : "none",
              }}
            >
              <Mic size={28} color="#fff" />
            </button>
            <div style={{ color:T.textMuted, fontSize:13 }}>
              {recording ? "Recording… click to stop" : "Press to record a voice note"}
            </div>

            {/* SR-13.2: saved voice notes */}
            {voiceNotes.length > 0 && (
              <div style={{ marginTop:20 }}>
                <div style={{ fontWeight:700, fontSize:12, textTransform:"uppercase", color:T.textMuted, letterSpacing:"0.08em", marginBottom:8 }}>
                  Saved Notes
                </div>
                {voiceNotes.map((vn, i) => (
                  <div key={i} style={{
                    display:"flex", justifyContent:"space-between", alignItems:"center",
                    padding:"8px 12px", background:T.surfaceAlt, borderRadius:4, marginBottom:6,
                  }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <Mic size={13} color={T.textMuted} />
                      <span style={{ fontSize:12, fontFamily:"'DM Mono',monospace", color:T.textDim }}>{vn.name}</span>
                    </div>
                    <a href={vn.url} download={vn.name}><Btn variant="ghost" icon={Download} size="sm">Save</Btn></a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 15 REPORTS PAGE  (UR-21–24)
   - Daily report from /api/v1/reports/daily (SR-21.1–21.3)
   - Statistical charts (SR-22.1–22.3)
   - Response time trend (SR-23.1–23.2)
   - PDF download from /api/v1/reports/export/pdf (SR-24.1–24.2)
══════════════════════════════════════════════════════════════════════════════ */
const ReportsPage = ({ L, incidents, toast }) => {
  const [tab,         setTab]         = useState("daily");
  const [dailyData,   setDailyData]   = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [pdfLoading,  setPdfLoading]  = useState(false);

  /** SR-21.1: fetch today's daily report */
  const fetchDaily = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/v1/reports/daily");
      setDailyData(data);
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { if (tab === "daily") fetchDaily(); }, [tab, fetchDaily]);

  /** SR-24.1–24.2: download report as PDF */
  const downloadPdf = async () => {
    setPdfLoading(true);
    try {
      const blob = await api.blob("/api/v1/reports/export/pdf");
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `eims_report_${new Date().toISOString().slice(0,10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast("PDF report downloaded.", "success");
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setPdfLoading(false);
    }
  };

  // BUG FIX: response times stabilised with useMemo (not regenerated each render)
  const responseTimes = useMemo(
    () => Object.fromEntries(incidents.map(i => [i.displayId, (Math.random() * 6 + 2).toFixed(1)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <div className="fade-in" style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <SectionTitle icon={BarChart2} title={L.reports} subtitle="Daily reports, statistics, and performance monitoring" />

      <div style={{ display:"flex", gap:6 }}>
        {[["daily",L.dailyReport],["stats","Statistics"],["response",L.responseTimeTrend]].map(([id,label]) => (
          <Btn key={id} variant={tab === id ? "primary" : "ghost"} onClick={() => setTab(id)}>{label}</Btn>
        ))}
        {/* UR-24 Export PDF */}
        <div style={{ marginLeft:"auto" }}>
          <Btn icon={pdfLoading ? RefreshCw : Download} variant="outline" onClick={downloadPdf} disabled={pdfLoading}>
            {pdfLoading ? L.loading : L.exportPDF}
          </Btn>
        </div>
      </div>

      {/* Daily Report (UR-21, SR-21.1–21.3) */}
      {tab === "daily" && (
        <Card>
          {loading ? <LoadingRow L={L} /> : dailyData ? (
            <>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:16, textTransform:"uppercase", letterSpacing:"0.06em" }}>{L.dailyReport}</div>
                  <div style={{ color:T.textMuted, fontSize:12 }}>{dailyData.date}</div>
                </div>
                <div style={{ display:"flex", gap:20 }}>
                  {[["Total",dailyData.total_incidents],[L.active,dailyData.status_breakdown?.active],[L.closed,dailyData.status_breakdown?.closed]].map(([l,v]) => (
                    <div key={l} style={{ textAlign:"center" }}>
                      <div style={{ fontSize:24, fontWeight:700 }}>{v ?? 0}</div>
                      <div style={{ color:T.textMuted, fontSize:11, textTransform:"uppercase" }}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* SR-21.2–21.3: incident list with ID and category */}
              <DataTable
                cols={[L.incidentId, L.category, L.priority, L.status, "Reported"]}
                rows={dailyData.incidents || []}
                renderRow={row => [
                  <Td key="id"><span style={{ fontFamily:"'DM Mono',monospace", color:T.blueLight, fontSize:12 }}>INC-{String(row.id).padStart(3,"0")}</span></Td>,
                  <Td key="cat" style={{ textTransform:"capitalize" }}>{row.category}</Td>,
                  <Td key="pri"><PriorityBadge level={(row.priority||"medium").toLowerCase()} L={L} /></Td>,
                  <Td key="sta"><StatusBadge status={normaliseStatus(row.status)} L={L} /></Td>,
                  <Td key="time" style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:T.textDim }}>
                    {new Date(row.created_at).toLocaleTimeString("en",{hour:"2-digit",minute:"2-digit"})}
                  </Td>,
                ]}
              />
            </>
          ) : (
            <div style={{ textAlign:"center", color:T.textMuted, padding:24 }}>{L.noData}</div>
          )}
        </Card>
      )}

      {/* Statistical charts (UR-22, SR-22.1–22.3) */}
      {tab === "stats" && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          <Card>
            <div style={{ fontWeight:700, fontSize:13, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:14 }}>{L.weeklyStats}</div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={CHART_WEEKLY}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false} />
                <XAxis dataKey="day"  tick={{ fill:T.textMuted, fontSize:11 }} axisLine={false} tickLine={false} />
                <YAxis               tick={{ fill:T.textMuted, fontSize:11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background:T.surfaceAlt, border:`1px solid ${T.border}`, borderRadius:6, fontSize:12 }} />
                <Legend wrapperStyle={{ fontSize:12, color:T.textDim }} />
                <Bar dataKey="incidents" fill={T.red}   radius={[3,3,0,0]} name="Incidents" />
                <Bar dataKey="resolved"  fill={T.green} radius={[3,3,0,0]} name="Resolved" />
              </BarChart>
            </ResponsiveContainer>
          </Card>
          <Card>
            <div style={{ fontWeight:700, fontSize:13, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:14 }}>{L.incidentsByType}</div>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={CHART_BY_TYPE} cx="50%" cy="50%" outerRadius={95} dataKey="value"
                  label={({ name, value }) => `${name} ${value}%`}
                  labelLine={{ stroke:T.borderBright }}
                >
                  {CHART_BY_TYPE.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background:T.surfaceAlt, border:`1px solid ${T.border}`, fontSize:12 }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      {/* Response time trend (UR-23, SR-23.1–23.2) */}
      {tab === "response" && (
        <Card>
          <div style={{ fontWeight:700, fontSize:13, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:14 }}>
            {L.responseTimeTrend} Today
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={CHART_RESPONSE}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false} />
              <XAxis dataKey="time"  tick={{ fill:T.textMuted, fontSize:11 }} axisLine={false} tickLine={false} />
              <YAxis                 tick={{ fill:T.textMuted, fontSize:11 }} axisLine={false} tickLine={false} unit=" min" />
              <Tooltip contentStyle={{ background:T.surfaceAlt, border:`1px solid ${T.border}`, borderRadius:6, fontSize:12 }} />
              <Line type="monotone" dataKey="avg" stroke={T.red} strokeWidth={2} dot={{ fill:T.red, r:4 }} activeDot={{ r:6 }} name="Avg Response (min)" />
            </LineChart>
          </ResponsiveContainer>
          {/* SR-23.1: formula note */}
          <div style={{ color:T.textMuted, fontSize:11, marginTop:10 }}>
            SR-23.1 - Response time = Team Arrival Time − Incident Registration Time
          </div>
        </Card>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 16 RESOURCES PAGE  (UR-26–31)
   Fetches vehicles and equipment from /api/v1/resources/.
   Vehicles: type = "Vehicle" | Equipment: type = "Equipment"
══════════════════════════════════════════════════════════════════════════════ */
const ResourcesPage = ({ L, user, toast }) => {
  const [tab,       setTab]       = useState("vehicles");
  const [resources, setResources] = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);

  const [drills, setDrills] = useState(STATIC_DRILLS);
  const [showDrillForm, setShowDrillForm] = useState(false);
  const [drillForm, setDrillForm] = useState({ title:"", date:"", teams:"" });

  /** Fetch resources list from backend */
  const fetchResources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get("/api/v1/resources/");
      setResources(data.map(normaliseResource));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchResources(); }, [fetchResources]);

  /** SR-26.3 / SR-27.1: update resource status (Admin / Dispatcher) */
  const updateStatus = async (res, newStatus) => {
    try {
      await api.patch(`/api/v1/resources/${res.id}/status`, { status: newStatus });
      setResources(rs => rs.map(r => r.id === res.id ? { ...r, status: newStatus } : r));
      toast("Status updated.", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  };

  /** SR-28.1–28.2: log fuel consumption */
  const logFuel = async (res, amount) => {
    try {
      await api.patch(`/api/v1/resources/${res.id}/fuel`, { fuel_amount: amount });
      setResources(rs => rs.map(r => r.id === res.id ? { ...r, fuel: (r.fuel || 0) + amount } : r));
      toast("Fuel usage recorded.", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  };

  /** SR-31.2: mark inspection complete */
  const markInspection = async (res) => {
    try {
      await api.patch(`/api/v1/resources/${res.id}/inspect`, {});
      setResources(rs => rs.map(r => r.id === res.id ? { ...r, lastInspection: new Date().toISOString() } : r));
      toast("Inspection recorded and reminder cleared.", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  };

  const vehicles  = resources.filter(r => r.type === "Vehicle");
  const equipment = resources.filter(r => r.type === "Equipment");

  return (
    <div className="fade-in" style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <SectionTitle icon={Package} title={L.resources} subtitle="Vehicles, equipment, personnel and scheduling" />

      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
        {[["vehicles",L.vehicles,Truck],["equipment",L.equipment,Package],["personnel",L.personnel,Users],["drills",L.drills,Calendar],["inspections",L.inspection,Shield]].map(([id,label,Icon]) => (
          <Btn key={id} variant={tab === id ? "primary" : "ghost"} icon={Icon} onClick={() => setTab(id)}>{label}</Btn>
        ))}
      </div>

      {loading && <LoadingRow L={L} />}
      {error   && <ErrorMsg message={error} onRetry={fetchResources} L={L} />}

      {/* Vehicles (UR-27, UR-28, SR-27.1–28.2) */}
      {tab === "vehicles" && !loading && (
        <Card>
          <SectionTitle icon={Truck} title={L.vehicles} />
          {vehicles.length === 0
            ? <div style={{ color:T.textMuted, textAlign:"center", padding:24 }}>{L.noData}</div>
            : (
              <DataTable
                cols={["ID","Name","Status",L.fuelLevel,L.maintenance,L.actions]}
                rows={vehicles}
                renderRow={row => {
                  const maintOk = row.status !== "Maintenance";
                  return [
                    <Td key="id"><span style={{ fontFamily:"'DM Mono',monospace", color:T.blueLight, fontSize:12 }}>{row.displayId}</span></Td>,
                    <Td key="name" style={{ fontWeight:600 }}>{row.name}</Td>,
                    <Td key="sta">
                      <select
                        value={row.status}
                        onChange={e => updateStatus(row, e.target.value)}
                        style={{ width:"auto", padding:"3px 8px", fontSize:12 }}
                      >
                        <option>Available</option>
                        <option>Unavailable</option>
                        <option>Maintenance</option>
                      </select>
                    </Td>,
                    <Td key="fuel" style={{ minWidth:120 }}>
                      {row.fuel !== null ? <FuelBar level={Math.min(row.fuel, 100)} /> : <span style={{ color:T.textMuted, fontSize:12 }}>N/A</span>}
                    </Td>,
                    <Td key="maint">
                      <span style={{ color: maintOk ? T.greenLight : T.red, fontWeight:700, fontSize:12 }}>
                        {maintOk ? "OK" : "MAINTENANCE"}
                      </span>
                    </Td>,
                    <Td key="act">
                      <Btn variant="ghost" icon={Fuel} size="sm" onClick={() => logFuel(row, 10)}>+10L</Btn>
                    </Td>,
                  ];
                }}
              />
            )
          }
        </Card>
      )}

      {/* Equipment (UR-26, SR-26.1–26.3) */}
      {tab === "equipment" && !loading && (
        <Card>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
            <SectionTitle icon={Package} title={L.equipment} />
          </div>
          {equipment.length === 0
            ? <div style={{ color:T.textMuted, textAlign:"center", padding:24 }}>{L.noData}</div>
            : (
              <DataTable
                cols={["ID","Name","Status",L.actions]}
                rows={equipment}
                renderRow={row => [
                  <Td key="id"><span style={{ fontFamily:"'DM Mono',monospace", color:T.blueLight, fontSize:12 }}>{row.displayId}</span></Td>,
                  <Td key="name" style={{ fontWeight:600 }}>{row.name}</Td>,
                  <Td key="sta">
                    <select
                      value={row.status}
                      onChange={e => updateStatus(row, e.target.value)}
                      style={{ width:"auto", padding:"3px 8px", fontSize:12 }}
                    >
                      <option>Available</option>
                      <option>Unavailable</option>
                      <option>Maintenance</option>
                    </select>
                  </Td>,
                  <Td key="act">
                    <Btn variant="ghost" icon={Shield} size="sm" onClick={() => markInspection(row)}>Inspect</Btn>
                  </Td>,
                ]}
              />
            )
          }
        </Card>
      )}

      {/* Personnel (UR-29, SR-29.1–29.2) shown from user list */}
      {tab === "personnel" && (
        <Card>
          <div style={{ color:T.textMuted, fontSize:13, marginBottom:8 }}>
            Personnel contact information is managed in the <strong>User Management</strong> page.
          </div>
        </Card>
      )}

      {/* Training Drills (UR-30, SR-30.1–30.2) */}
      {tab === "drills" && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 300px", gap:16 }}>
          <Card>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <span style={{ fontWeight:700, fontSize:13, textTransform:"uppercase", letterSpacing:"0.06em" }}>{L.drills}</span>
              <Btn variant="primary" icon={Plus} onClick={() => setShowDrillForm(true)}>{L.schedDrill}</Btn>
            </div>
            <DataTable
              cols={["ID","Title","Date","Teams"]}
              rows={drills}
              renderRow={row => [
                <Td key="id"><span style={{ fontFamily:"'DM Mono',monospace", color:T.blueLight, fontSize:12 }}>{row.id}</span></Td>,
                <Td key="title" style={{ fontWeight:600 }}>{row.title}</Td>,
                <Td key="date"  style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:T.textDim }}>{row.date}</Td>,
                <Td key="teams" style={{ color:T.textDim, fontSize:12 }}>{row.teams}</Td>,
              ]}
            />
          </Card>

          {/* SR-30.1: drill scheduling form */}
          {showDrillForm && (
            <Card>
              <div style={{ fontWeight:700, fontSize:12, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:12, color:T.textMuted }}>Schedule New Drill</div>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                <input placeholder="Drill title" value={drillForm.title} onChange={e => setDrillForm(f => ({ ...f, title: e.target.value }))} />
                <input type="date" style={{ colorScheme:"dark" }} value={drillForm.date} onChange={e => setDrillForm(f => ({ ...f, date: e.target.value }))} />
                <input placeholder="Teams (e.g. Alpha-1, Medic-2)" value={drillForm.teams} onChange={e => setDrillForm(f => ({ ...f, teams: e.target.value }))} />
                <div style={{ display:"flex", gap:8 }}>
                  <Btn variant="ghost" onClick={() => setShowDrillForm(false)}>{L.cancel}</Btn>
                  <Btn variant="primary" icon={Calendar} onClick={() => {
                    if (!drillForm.title || !drillForm.date) { toast("Title and date are required.", "error"); return; }
                    setDrills(ds => [...ds, { id:`D-${String(ds.length+1).padStart(3,"0")}`, ...drillForm }]);
                    setDrillForm({ title:"", date:"", teams:"" });
                    setShowDrillForm(false);
                    toast("Drill scheduled. (SR-30.2)", "success");
                  }}>{L.schedDrill}</Btn>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Inspections (UR-31, SR-31.1–31.2) */}
      {tab === "inspections" && (
        <Card>
          <div style={{ fontWeight:700, fontSize:13, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:16 }}>{L.inspection}</div>
          {resources.map(r => {
            const dueDate = r.lastInspection
              ? new Date(new Date(r.lastInspection).getTime() + 90*24*3600*1000) // 90-day cycle
              : new Date();
            const daysUntil = Math.round((dueDate - Date.now()) / 86400000);
            return (
              <div key={r.id} style={{
                display:"flex", justifyContent:"space-between", alignItems:"center",
                padding:"12px 14px", background:T.surfaceAlt,
                borderRadius:5, border:`1px solid ${T.border}`, marginBottom:8,
              }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:13 }}>{r.name} - {r.type}</div>
                  <div style={{ color: daysUntil < 7 ? T.red : T.textMuted, fontSize:12 }}>
                    {r.lastInspection
                      ? `Next due: ${dueDate.toLocaleDateString()} (${daysUntil} days)`
                      : "No inspection recorded"
                    }
                  </div>
                </div>
                <Btn variant="ghost" size="sm" icon={Bell} onClick={() => markInspection(r)}>
                  {L.setInspection}
                </Btn>
              </div>
            );
          })}
          {resources.length === 0 && <div style={{ color:T.textMuted, textAlign:"center", padding:24 }}>{L.noData}</div>}
        </Card>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 17 COORDINATION PAGE  (UR-32–36)
   - Share incidents with Hospital, Police, Fire Dept via integration endpoints
   - Weather data display (UR-35, SR-35.1–35.2)
   - Building plan file upload (UR-36, SR-36.1–36.2)
══════════════════════════════════════════════════════════════════════════════ */
const CoordinationPage = ({ L, incidents, toast }) => {
  const [sharedWith,  setSharedWith]  = useState({});
  const [selectedInc, setSelectedInc] = useState(incidents[0]?.backendId?.toString() || "");
  const [uploading,   setUploading]   = useState(false);

  const partners = [
    { id:"hospital", icon:Hospital, label:L.hospital,  color:"#3b82f6",
      endpoint: (inc) => api.post("/api/v1/integrations/hospital/admission",  { patient_id: inc?.backendId, incident_id: inc?.backendId }) },
    { id:"police",   icon:Shield,   label:L.police,    color:"#8b5cf6",
      endpoint: (inc) => api.post("/api/v1/integrations/police/incident-report", { incident_id: inc?.backendId, incident_type: inc?.type }) },
    { id:"fire",     icon:Flame,    label:L.fireDept,  color:T.red,
      endpoint: (inc) => api.post("/api/v1/integrations/fire-department/request",{ incident_id: inc?.backendId, incident_type: inc?.type }) },
  ];

  /** SR-32.1 / SR-33.1 / SR-34.1: share incident with agency */
  const shareWith = async (partner) => {
    const inc = incidents.find(i => i.backendId?.toString() === selectedInc);
    try {
      const result = await partner.endpoint(inc);
      setSharedWith(s => ({ ...s, [partner.id]: result?.case_number || result?.reference_number || selectedInc }));
      toast(`Incident shared with ${partner.label}. (${result?.message || ""})`, "success");
    } catch (e) {
      toast(e.message, "error");
    }
  };

  /** SR-36.1–36.2: upload building plan document */
  const handlePlanUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("incident_id", selectedInc || "1");
      fd.append("file_type",   "document");
      fd.append("file",        file);
      await api.upload("/api/v1/media/upload", fd);
      toast("Building plan uploaded and linked to incident. (SR-36.2)", "success");
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="fade-in" style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <SectionTitle icon={Globe} title={L.coordination} subtitle="Inter-agency coordination, weather data and building plans" />

      {/* Agency coordination (UR-32, 33, 34) */}
      <Card>
        <div style={{ fontWeight:700, fontSize:13, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:16 }}>
          Share Incident With Agencies
        </div>
        <div style={{ marginBottom:16 }}>
          <label style={{ display:"block", fontSize:11, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:6 }}>
            Select Incident
          </label>
          <select value={selectedInc} onChange={e => setSelectedInc(e.target.value)} style={{ maxWidth:400 }}>
            {incidents.filter(i => i.status !== "closed").map(i => (
              <option key={i.backendId} value={i.backendId?.toString()}>{i.displayId} - {i.location.substring(0,40)}</option>
            ))}
          </select>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14 }}>
          {partners.map(p => (
            <div key={p.id} style={{ border:`1px solid ${T.border}`, borderRadius:8, padding:18, textAlign:"center", background:T.surfaceAlt }}>
              <div style={{ background:`${p.color}22`, borderRadius:10, width:48, height:48, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 12px" }}>
                <p.icon size={22} color={p.color} />
              </div>
              <div style={{ fontWeight:700, fontSize:14, marginBottom:6 }}>{p.label}</div>
              {sharedWith[p.id] && (
                <div style={{ color:T.greenLight, fontSize:11, marginBottom:8 }}>✓ Ref: {sharedWith[p.id]}</div>
              )}
              <Btn variant="outline" onClick={() => shareWith(p)} style={{ width:"100%" }}>Share Incident</Btn>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
        {/* Weather (UR-35, SR-35.2) */}
        <Card>
          <div style={{ fontWeight:700, fontSize:13, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:14, display:"flex", alignItems:"center", gap:8 }}>
            <CloudRain size={15} color="#60a5fa" /> {L.weather} Updates
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {[["Temperature","27°C",Thermometer],["Wind Speed","18 km/h NW",Wind],["Visibility","8 km",Eye],["Humidity","65%",Wifi],["Condition","Partly Cloudy",CloudRain]].map(([l,v,Icon]) => (
              <div key={l} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:`1px solid ${T.border}` }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, color:T.textDim, fontSize:13 }}>
                  <Icon size={14} color={T.textMuted} />{l}
                </div>
                <span style={{ fontWeight:700, fontSize:13 }}>{v}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Building Plans (UR-36, SR-36.1–36.2) */}
        <Card>
          <div style={{ fontWeight:700, fontSize:13, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:14, display:"flex", alignItems:"center", gap:8 }}>
            <Building2 size={15} color={T.amber} /> {L.buildingPlans}
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ display:"block", fontSize:11, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:6 }}>
              Associate with Incident
            </label>
            <select value={selectedInc} onChange={e => setSelectedInc(e.target.value)}>
              {incidents.map(i => <option key={i.backendId} value={i.backendId?.toString()}>{i.displayId} - {i.location.substring(0,30)}</option>)}
            </select>
          </div>
          {/* SR-36.1: accept .pdf/.dwg/.png document uploads */}
          <label style={{ cursor:"pointer", display:"block" }}>
            <div
              style={{ border:`2px dashed ${T.border}`, borderRadius:6, padding:24, textAlign:"center", cursor:"pointer", marginBottom:12 }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = T.amber; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; }}
            >
              <Upload size={22} color={T.textMuted} style={{ margin:"0 auto 8px", display:"block" }} />
              <div style={{ color:T.textMuted, fontSize:12 }}>Upload .pdf, .dwg, .png floor plans</div>
            </div>
            <input type="file" accept=".pdf,.dwg,.png" style={{ display:"none" }} onChange={handlePlanUpload} disabled={uploading} />
          </label>
          {uploading && <div style={{ color:T.textMuted, fontSize:12, textAlign:"center" }}>{L.loading}</div>}
        </Card>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 18 - USER MANAGEMENT PAGE  (UR-37–40)
   Fetches users from /api/v1/auth/all_users.
   Admin can create new accounts via /api/v1/auth/register (UR-40).
══════════════════════════════════════════════════════════════════════════════ */
const UsersPage = ({ L, user: currentUser, toast }) => {
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form,    setForm]    = useState({ name:"", email:"", password:"", role:"Citizen" });

  /** SR-38.1–38.2: fetch all users and their roles */
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get("/api/v1/auth/all_users");
      setUsers(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  /** SR-40.1–40.2: create a new user account with assigned role */
  const addUser = async () => {
    if (!form.name || !form.email || !form.password) { toast("Name, email and password are required.", "error"); return; }
    try {
      const created = await api.post("/api/v1/auth/register", form);
      setUsers(u => [...u, created]);
      setForm({ name:"", email:"", password:"", role:"Citizen" });
      setShowAdd(false);
      toast("User created successfully.", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  };

  // SR-39.2: only admins see this page (enforced in sidebar + here as guard)
  if (currentUser?.role !== "Admin") {
    return (
      <div style={{ padding:40, textAlign:"center", color:T.textMuted }}>
        <Shield size={40} style={{ margin:"0 auto 16px", display:"block", color:T.border }} />
        Access restricted to Administrators.
      </div>
    );
  }

  const roleColour = (role) => ({
    Admin: T.red, Dispatcher: T.amberLight, Responder: T.blueLight,
    Citizen: T.greenLight, External: T.purpleLight,
  })[role] || T.textMuted;

  return (
    <div className="fade-in" style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <SectionTitle icon={Users} title={L.users} subtitle="Manage system users, roles and access permissions" />

      {/* SR-38.1: role permission overview */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:14 }}>
        {[
          ["Admin",      "Full system access",             T.red],
          ["Dispatcher", "Incidents + resources",          T.amber],
          ["Responder",  "Incidents + comms",              T.blue],
          ["Citizen",    "Report incidents only",          T.green],
          ["External",   "Coordination only",              T.purple],
        ].map(([role, desc, color]) => (
          <Card key={role} style={{ borderLeft:`3px solid ${color}` }}>
            <div style={{ fontWeight:700, fontSize:14, color }}>{role}</div>
            <div style={{ color:T.textMuted, fontSize:12, marginTop:4 }}>{desc}</div>
          </Card>
        ))}
      </div>

      <Card>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <span style={{ fontWeight:700, fontSize:13, textTransform:"uppercase", letterSpacing:"0.06em" }}>System Users</span>
          <Btn variant="primary" icon={UserPlus} onClick={() => setShowAdd(true)}>{L.addUser}</Btn>
        </div>

        {loading && <LoadingRow L={L} />}
        {error   && <ErrorMsg message={error} onRetry={fetchUsers} L={L} />}

        {!loading && !error && (
          <DataTable
            cols={["ID", L.name, L.role, L.email2, "Contact", "Created"]}
            rows={users}
            renderRow={row => [
              <Td key="id"><span style={{ fontFamily:"'DM Mono',monospace", color:T.blueLight, fontSize:12 }}>U-{String(row.id).padStart(3,"0")}</span></Td>,
              <Td key="name" style={{ fontWeight:600 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{
                    width:28, height:28, borderRadius:"50%", background:T.redDark,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:11, fontWeight:700, flexShrink:0,
                  }}>
                    {(row.name||"?").split(" ").map(w => w[0]).slice(0,2).join("").toUpperCase()}
                  </div>
                  {row.name}
                </div>
              </Td>,
              <Td key="role"><span style={{ color:roleColour(row.role), fontWeight:700, fontSize:12 }}>{row.role}</span></Td>,
              <Td key="email" style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:T.textDim }}>{row.email}</Td>,
              <Td key="contact" style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:T.textDim }}>
                {/* SR-29.1–29.2 contact info */}
                {row.contact_info || "-"}
              </Td>,
              <Td key="created" style={{ fontSize:11, color:T.textMuted }}>
                {row.created_at ? new Date(row.created_at).toLocaleDateString() : "-"}
              </Td>,
            ]}
          />
        )}
      </Card>

      {/* Add User Modal (SR-40.1–40.2) */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={L.addUser} width={420}>
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <div>
            <label style={{ display:"block", fontSize:11, color:T.textMuted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>{L.name}</label>
            <input value={form.name}     onChange={e => setForm(f => ({ ...f, name:     e.target.value }))} placeholder="Full name" />
          </div>
          <div>
            <label style={{ display:"block", fontSize:11, color:T.textMuted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>{L.email}</label>
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email:    e.target.value }))} placeholder="user@eims.gov.lb" />
          </div>
          <div>
            <label style={{ display:"block", fontSize:11, color:T.textMuted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>Password</label>
            <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Temporary password" />
          </div>
          {/* SR-40.2: role assignment */}
          <div>
            <label style={{ display:"block", fontSize:11, color:T.textMuted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>{L.role}</label>
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <option>Admin</option>
              <option>Dispatcher</option>
              <option>Responder</option>
              <option>Citizen</option>
              <option>External</option>
            </select>
          </div>
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <Btn variant="ghost" onClick={() => setShowAdd(false)}>{L.cancel}</Btn>
            <Btn variant="primary" icon={UserPlus} onClick={addUser}>{L.save}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 19 ROOT APPLICATION
   Handles token restoration on mount, periodic incident refresh,
   global toast notifications and the top-level routing between views.
══════════════════════════════════════════════════════════════════════════════ */
export default function App() {
  // Inject global CSS once on mount
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = GLOBAL_CSS;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  const [lang,      setLang]      = useState("en");
  const [user,      setUser]      = useState(null);      // null = not authenticated
  const [view,      setView]      = useState("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const [incidents, setIncidents] = useState([]);
  const [incLoading,setIncLoading]= useState(false);
  const { toasts, push: toast }   = useToasts();

  const L = LABELS[lang];

  // ── On mount: restore session from stored JWT ──────────────────────────
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const payload = decodeJwt(token);
    if (!payload) { dropToken(); return; }
    setUser({
      id:    payload.sub,
      email: payload.email,
      role:  payload.role,
      name:  payload.email.split("@")[0].replace(/[._]/g, " "),
    });
  }, []);

  // ── Fetch incidents from backend (refreshes every 30 s for live updates) ──
  const loadIncidents = useCallback(async () => {
    if (!user) return;
    setIncLoading(true);
    try {
      const data = await api.get("/api/v1/incidents/");
      setIncidents(data.map(normaliseIncident));
    } catch (e) {
      toast("Could not load incidents: " + e.message, "error");
    } finally {
      setIncLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    loadIncidents();
    const id = setInterval(loadIncidents, 30_000); // UR-2: real-time map updates
    return () => clearInterval(id);
  }, [loadIncidents]);

  // ── Not logged in → show login screen ─────────────────────────────────
  if (!user) {
    return (
      <>
        <LoginScreen onLogin={u => { setUser(u); }} lang={lang} setLang={setLang} />
        <ToastContainer toasts={toasts} />
      </>
    );
  }

  // ── Route map (UR-39: restricted pages are guarded inside each component) ─
  const viewMap = {
    dashboard:    <Dashboard        L={L} incidents={incidents} loading={incLoading} />,
    incidents:    <IncidentsPage    L={L} incidents={incidents} setIncidents={setIncidents} user={user} toast={toast} />,
    map:          <MapPage          L={L} incidents={incidents} />,
    comms:        <CommsPage        L={L} user={user} toast={toast} />,
    reports:      <ReportsPage      L={L} incidents={incidents} toast={toast} />,
    resources:    <ResourcesPage    L={L} user={user} toast={toast} />,
    coordination: <CoordinationPage L={L} incidents={incidents} toast={toast} />,
    users:        <UsersPage        L={L} user={user} toast={toast} />,
  };

  const pendingCount = incidents.filter(i => i.status === "pending").length;

  return (
    // UR-44: RTL layout for Arabic
    <div
      dir={lang === "ar" ? "rtl" : "ltr"}
      style={{ display:"flex", height:"100vh", overflow:"hidden", fontFamily:"'Rajdhani','Noto Sans Arabic',sans-serif" }}
    >
      <Sidebar
        view={view} setView={setView} L={L} user={user}
        onLogout={() => { dropToken(); setUser(null); setIncidents([]); }}
        collapsed={collapsed} setCollapsed={setCollapsed}
      />

      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <Topbar view={view} L={L} lang={lang} setLang={setLang} user={user} notifications={pendingCount} />
        <main style={{ flex:1, overflowY:"auto", padding:24 }}>
          {viewMap[view] || <div style={{ color:T.textMuted, padding:20 }}>Page not found.</div>}
        </main>
      </div>

      <ToastContainer toasts={toasts} />
    </div>
  );
}
