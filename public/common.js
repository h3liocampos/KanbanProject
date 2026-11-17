(() => {
  "use strict";

  const ROLE_LABELS = { OWNER: "Dono", EDITOR: "Editor", VIEWER: "Leitor" };
  const PRIORITY_LABELS = { LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta" };
  const LABEL_NAMES = { bug: "Bug", feature: "Feature", urgente: "Urgente" };
  const SPRINT_STATUS_LABELS = { PLANNED: "Planejada", ACTIVE: "Ativa", CLOSED: "Encerrada" };

  async function api(path, options = {}) {
    const response = await fetch(`/api${path}`, {
      credentials: "same-origin",
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error || "Não foi possível concluir a operação.");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  // Cria elementos sempre com textContent (sem innerHTML), evitando XSS.
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    let pendingValue;
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "text") el.textContent = value;
      else if (key === "value") pendingValue = value;
      else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? "" : String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    if (pendingValue !== undefined) el.value = pendingValue;
    return el;
  }

  let toastTimer;
  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function parseDateOnly(value) {
    if (!value) return null;
    const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDate(value) {
    const date = parseDateOnly(value);
    return date ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(date) : "";
  }

  function formatDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? ""
      : new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function isOverdue(value) {
    const date = parseDateOnly(value);
    if (!date) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  }

  function initials(name) {
    return String(name || "?").trim().slice(0, 2).toUpperCase();
  }

  window.FB = {
    ROLE_LABELS, PRIORITY_LABELS, LABEL_NAMES, SPRINT_STATUS_LABELS,
    api, h, showToast, formatDate, formatDateTime, isOverdue, initials
  };
})();
