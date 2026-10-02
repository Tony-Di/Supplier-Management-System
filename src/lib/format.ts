export function formatMoney(value: number) {
  return `$${formatDecimalPrice(value)}`;
}

export function formatDecimalPrice(value: number) {
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
}

export function csvCell(value: string | number | undefined) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function formatMonthTick(dateText: string) {
  const parsedDate = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) return dateText;

  return parsedDate.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

// Today in the viewer's time zone, as a date input writes it.
export function localDateString(now = new Date()) {
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, "0")).join("-");
}

// Whole calendar days in the viewer's time zone. Both days are taken as UTC
// midnights so a daylight-saving change cannot shorten a day.
export function formatSupplierSince(dateText: string | undefined, today = new Date()) {
  if (!dateText) return "";
  const [year, month, day] = dateText.split("-").map(Number);
  const since = Date.UTC(year, month - 1, day);
  const days = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - since) / 86_400_000);
  const date = new Date(since).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${days} ${days === 1 ? "day" : "days"} (${date})`;
}

export function formatAuditDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatAuditValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "-";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
