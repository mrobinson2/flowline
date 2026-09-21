/* ============================================================================
   UNITS  -  what the numbers on the chart actually mean.
   ----------------------------------------------------------------------------
   The shipped sample data is in business days. A workbook imported from
   Excel is usually in hours.
   Those are different by a factor of eight, so a chart that hard-codes "d"
   after every figure is not a cosmetic problem - it is a slide that says
   6,776 days when it means 6,776 hours.

   So one place decides, from process.units, how time is written:

     abbr        the suffix after a figure            "h"      "d"
     tickSize    spacing of the gridlines             8 (a day) 5 (a week)
     tickLabel   what a gridline is called            "Day 3"  "Wk 3"
     originLabel the left edge                        "Hour 0" "Day 0"
     endLabel    the right edge                       "Hour 6776"
     secondary   the same figure in a unit a director thinks in

   `secondary` is the one worth keeping. 6,776 hours means nothing to an SVP;
   "847 working days" or "≈ 3.9 years" does. The figure is never converted
   behind anyone's back - the primary number stays in the source unit and the
   translation is shown next to it.
   ========================================================================== */
(function (root) {
  const VSM = root.VSM = root.VSM || {};

  /* ---------------------------------------------------------------------
     BUSINESS DAYS, NOT CALENDAR DAYS. Every "day" in this app is a working
     day: 8 hours long, 5 to the week, 21 to the month, 260 to the year. The
     scheduler itself has no calendar in it at all - it adds numbers and never
     knows what weekday anything lands on - so the unit is whatever the data
     declares and these constants are what translate it for a reader.

     The conversions below therefore return CALENDAR spans: 335 business days
     is 16 calendar months, because 21 business days is a calendar month. That
     is the right answer for "how long will this take" and it is the number a
     person means when they say months.

     THE CAVEAT THAT MATTERS. Cycle time is hands-on work and only happens on
     working days, so 8 hours to the day is right for it. Lead time is
     WAITING, and a queue does not pause at 5pm on Friday. Converting waiting
     at 8 hours to the day is only correct if whoever filled the spreadsheet
     entered waits as business-hour equivalents (a two-week wait as 80 hours).
     If anyone entered calendar hours instead (the same wait as 336), that row
     runs three times long. tools/diagnose.js checks which convention a
     workbook actually follows.
     --------------------------------------------------------------------- */
  const HOURS_PER_DAY = 8;        // a working day
  const DAYS_PER_WEEK = 5;        // business days in a week
  const DAYS_PER_MONTH = 21;      // business days in a calendar month
  const DAYS_PER_YEAR = 260;      // business days in a calendar year
  const CALENDAR_RATIO = 7 / 5;   // business days -> calendar days
  const round1 = n => Math.round(n * 10) / 10;

  /* A span of business days, written the way a person would say it. */
  function human(days) {
    if (days >= DAYS_PER_YEAR) return round1(days / DAYS_PER_YEAR) + " years";
    if (days >= DAYS_PER_MONTH) return round1(days / DAYS_PER_MONTH) + " months";
    if (days >= DAYS_PER_WEEK) return round1(days / DAYS_PER_WEEK) + " weeks";
    return round1(days) + " business days";
  }
  const calendarDays = businessDays => Math.round(businessDays * CALENDAR_RATIO);

  function resolve(process, opts) {
    const raw = String((process && (process.units || process.unit)) || "business days").toLowerCase();
    /* hoursPerDay sets the gridline spacing, so a zero, a negative or an
       infinity out of an imported file would make the axis meaningless (and
       used to make the renderer's tick loop unbounded). Anything that is not a
       positive finite number falls back to a working day. */
    const declared = process && Number(process.hoursPerDay);
    const perDay = isFinite(declared) && declared > 0 ? declared : HOURS_PER_DAY;
    const fmt = (opts && opts.fmt) || (n => String(round1(n)));

    if (/hour|hrs?\b/.test(raw)) {
      return {
        id: "hours", abbr: "h", one: "hour", many: "hours", perDay,
        tickSize: perDay,
        tickLabel: i => "Bus. day " + i,
        originLabel: "Hour 0",
        endLabel: total => "Hour " + fmt(total),
        /* hours -> the unit the room thinks in */
        secondary: total => human(total / perDay),
        toDays: v => v / perDay
      };
    }
    if (/week/.test(raw)) {
      return {
        id: "weeks", abbr: "wk", one: "week", many: "weeks", perDay: 1 / DAYS_PER_WEEK,
        tickSize: 4, tickLabel: i => "M" + i, originLabel: "Week 0",
        endLabel: total => "Week " + fmt(total),
        secondary: total => human(total * DAYS_PER_WEEK),
        toDays: v => v * DAYS_PER_WEEK
      };
    }
    return {
      id: "days", abbr: "d", one: "business day", many: "business days", perDay: 1,
      tickSize: DAYS_PER_WEEK,
      tickLabel: i => "Wk " + i,
      originLabel: "Bus. day 0",
      endLabel: total => "Business day " + fmt(total),
      secondary: total => human(total),
      toDays: v => v
    };
  }

  VSM.units = { resolve, human, calendarDays, HOURS_PER_DAY, DAYS_PER_WEEK, DAYS_PER_MONTH, DAYS_PER_YEAR, CALENDAR_RATIO };
  if (typeof module !== "undefined" && module.exports) module.exports = VSM.units;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
