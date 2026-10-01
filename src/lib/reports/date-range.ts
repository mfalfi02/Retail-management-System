const BUSINESS_TIME_ZONE = "Asia/Jakarta";

export function businessDateParts(date: Date) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: BUSINESS_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map(({ type, value }) => [type, value]),
  ) as { year: string; month: string; day: string };
}

export function businessDayStart(date: Date) {
  const { year, month, day } = businessDateParts(date);
  return new Date(`${year}-${month}-${day}T00:00:00+07:00`);
}

export function businessDateRange(value: string, end = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}+07:00`);
  if (Number.isNaN(date.getTime()) || businessDateParts(date).year !== value.slice(0, 4) || businessDateParts(date).month !== value.slice(5, 7) || businessDateParts(date).day !== value.slice(8, 10)) return undefined;
  return date;
}

export function businessDayKey(date: Date) {
  const { year, month, day } = businessDateParts(date);
  return `${year}-${month}-${day}`;
}
