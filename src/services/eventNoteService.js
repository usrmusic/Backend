// Lightweight service for creating event notes; accepts either the global prisma
// client or a transaction client (tx) so callers can use it inside transactions.
export async function createNote(client, { eventId, notes, created_by = null, created_at = null }) {
  if (!client || !client.eventNote) throw new Error('invalid_prisma_client');
  const data = {
    event_id: Number(eventId),
    notes: String(notes),
    created_by: created_by != null ? Number(created_by) : null,
    created_at: created_at || new Date(),
  };
  return client.eventNote.create({ data });
}

export default { createNote };
