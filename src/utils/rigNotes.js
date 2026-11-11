// Rig notes are copied from equipment onto each event_package when an event is
// booked. Rule for what the Rig List shows for an event item:
//   1. the event item's own rig note, if it has real content
//   2. otherwise the equipment's rig note
// A copy that is blank, or only repeats the item's own name, has no real
// content — the booking just stored the name — so it counts as empty.

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

export const isEmptyCopy = (copy, itemName) => {
  const name = normLine(itemName ?? "");
  return toLines(copy).filter((l) => l !== name).length === 0;
};

export const resolveRigNotes = (copy, equipmentNote, itemName) => {
  if (!isEmptyCopy(copy, itemName)) return String(copy).trim();
  return (equipmentNote ?? "").toString().trim() || (copy ?? "").toString().trim() || null;
};
