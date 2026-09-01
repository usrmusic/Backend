function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

// Mirrors the legacy Laravel CRM's TodoMail (resources/views/email/todo_mail.blade.php),
// sent to the assigned staff member whenever a new todo is created for an event
// (TodoController::store). Same subject and same Action/Event/Deadline/Comment
// fields, rendered inside the shared USR letter shell for visual parity with
// every other transactional email in this app.
export function buildTodoAssignedEmailBody({ createdPersonName, action, eventLabel, deadlineLabel, comment }) {
  const rows = [];
  rows.push(`<p>${escapeHtml(createdPersonName || "A team member")} has assigned you a task,</p>`);

  const tableRows = [];
  if (action) {
    tableRows.push(
      `<tr><td style="padding:4px 12px 4px 0; font-weight:bold; vertical-align:top;">Action:</td><td style="padding:4px 0;">${escapeHtml(action)}</td></tr>`,
    );
  }
  if (eventLabel) {
    tableRows.push(
      `<tr><td style="padding:4px 12px 4px 0; font-weight:bold; vertical-align:top;">Event:</td><td style="padding:4px 0;">${escapeHtml(eventLabel)}</td></tr>`,
    );
  }
  if (deadlineLabel) {
    tableRows.push(
      `<tr><td style="padding:4px 12px 4px 0; font-weight:bold; vertical-align:top;">Deadline:</td><td style="padding:4px 0;">${escapeHtml(deadlineLabel)}</td></tr>`,
    );
  }
  if (comment) {
    tableRows.push(
      `<tr><td style="padding:4px 12px 4px 0; font-weight:bold; vertical-align:top;">Comment:</td><td style="padding:4px 0;">${escapeHtml(comment)}</td></tr>`,
    );
  }

  if (tableRows.length) {
    rows.push(`<table cellpadding="0" cellspacing="0" role="presentation">${tableRows.join("")}</table>`);
  }

  return rows.join("");
}

export const TODO_ASSIGNED_EMAIL_SUBJECT = "Todo Mail";
