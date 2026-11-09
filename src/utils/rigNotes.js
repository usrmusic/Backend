// Rig notes are copied from equipment onto each event_package when an event is
// booked, so later edits to the equipment's note never reach the copy.
// These helpers decide when a copy is just an out-of-date version of the
// equipment's note (safe to replace) vs. a note deliberately customised for
// one event (must be kept).

const normLine = (s) =>
  String(s)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .trim()
    .toLowerCase();

const toLines = (s) =>
  String(s ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .split(/\r\n|\n|\r/)
    .map(normLine)
    .filter(Boolean);

// A copy is stale when it is blank, or every line in it still appears in the
// equipment's current note (i.e. lines were only added to the equipment since).
export const isStaleCopy = (copy, equipmentNote) => {
  const copyLines = toLines(copy);
  if (copyLines.length === 0) return true;
  const current = new Set(toLines(equipmentNote));
  return copyLines.every((l) => current.has(l));
};

// The note an event should show: the equipment's current note when the event's
// copy is stale, otherwise the event's own customised note.
export const resolveRigNotes = (copy, equipmentNote) => {
  const eq = (equipmentNote ?? "").toString().trim();
  if (eq && isStaleCopy(copy, eq)) return eq;
  return (copy ?? "").toString().trim() || eq || null;
};
