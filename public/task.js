(() => {
  "use strict";

  const { api, h, showToast, PRIORITY_LABELS, LABEL_NAMES, formatDateTime, initials } = window.FB;
  const $ = (id) => document.getElementById(id);
  const match = location.pathname.match(/^\/tasks\/([0-9a-f-]{36})\/?$/i);
  const taskId = match ? match[1] : null;
  let data = null;

  const editable = () => data && data.role !== "VIEWER";

  function showState(message, withLogin = false) {
    $("taskView").hidden = true;
    $("stateView").hidden = false;
    $("stateMessage").textContent = message;
    const link = $("stateLink");
    link.hidden = !withLogin && !message;
    link.textContent = withLogin ? "Entrar no FlowBoard" : "Ir para meus quadros";
    link.href = withLogin ? `/?next=${encodeURIComponent(location.pathname)}` : "/";
  }

  async function load() {
    if (!taskId) return showState("Endereço de tarefa inválido.");
    try {
      data = await api(`/tasks/${taskId}`);
    } catch (error) {
      if (error.status === 401) return showState("Faça login para ver esta tarefa.", true);
      if (error.status === 404) return showState("Tarefa não encontrada, ou você não tem acesso a ela.");
      if (data) return showToast(error.message);
      return showState(error.message);
    }
    render();
  }

  // Não sobrescreve o campo que a pessoa está digitando agora.
  function setValue(el, value) {
    if (document.activeElement !== el) el.value = value ?? "";
  }

  function render() {
    const { task, board, columns, members, sprints } = data;
    $("stateView").hidden = true;
    $("taskView").hidden = false;
    document.title = `${task.title} — FlowBoard`;
    $("backLink").href = `/boards/${board.id}`;
    $("crumb").textContent = `${board.name} · TAREFA`;
    $("viewerNote").hidden = editable();
    const me = members.find((m) => String(m.userId) === String(data.currentUserId));
    if (me) {
      $("userChip").hidden = false;
      $("userChip").textContent = me.username;
    }

    setValue($("titleInput"), task.title);
    setValue($("descInput"), task.description);
    setValue($("acceptInput"), task.acceptanceCriteria);
    setValue($("dueInput"), task.dueDate || "");
    setValue($("pointsInput"), task.storyPoints ?? "");

    $("columnSelect").replaceChildren(...columns.map((c) =>
      h("option", { value: c.id, text: c.wipLimit != null ? `${c.name} (WIP ${c.wipLimit})` : c.name })));
    $("columnSelect").value = task.columnId;

    $("assigneeSelect").replaceChildren(
      h("option", { value: "", text: "Sem responsável" }),
      ...members.map((m) => h("option", { value: m.userId, text: `@${m.username}` })));
    $("assigneeSelect").value = task.assignee ? String(task.assignee.id) : "";

    $("prioritySelect").value = task.priority;

    const currentSprint = sprints.find((s) => s.id === task.sprintId);
    $("sprintSelect").replaceChildren(
      h("option", { value: "", text: "Backlog (sem sprint)" }),
      ...sprints.filter((s) => s.status !== "CLOSED" || s.id === task.sprintId)
        .map((s) => h("option", { value: s.id, text: s.name, disabled: s.status === "CLOSED" && s.id !== task.sprintId })));
    $("sprintSelect").value = currentSprint ? currentSprint.id : "";

    renderLabels();
    renderChecklist();
    renderComments();
    renderActivity();

    $("dodPanel").hidden = !board.definitionOfDone;
    $("dodText").textContent = board.definitionOfDone;

    const ro = !editable();
    ["titleInput", "descInput", "acceptInput", "dueInput", "pointsInput", "columnSelect",
      "assigneeSelect", "prioritySelect", "sprintSelect", "checkInput", "commentInput"].forEach((id) => { $(id).disabled = ro; });
    $("checkForm").hidden = ro;
    $("breakBtn").hidden = ro;
    $("commentForm").hidden = ro;
  }

  function renderLabels() {
    const active = new Set(data.task.labels);
    $("labelPicker").replaceChildren(...Object.entries(LABEL_NAMES).map(([key, name]) =>
      h("button", {
        type: "button",
        class: `label-chip ${key} toggle${active.has(key) ? " on" : ""}`,
        "aria-pressed": String(active.has(key)),
        disabled: !editable(),
        text: name,
        onclick: () => {
          const next = new Set(active);
          if (next.has(key)) next.delete(key); else next.add(key);
          patch({ labels: [...next] });
        }
      })));
  }

  function renderChecklist() {
    const items = data.checklist;
    const done = items.filter((i) => i.done).length;
    $("checkProgress").max = Math.max(items.length, 1);
    $("checkProgress").value = done;
    $("checkProgressText").textContent = items.length ? `${done}/${items.length} · ${Math.round((done / items.length) * 100)}%` : "Sem itens";
    $("checklist").replaceChildren(...items.map((item) => {
      const box = h("input", { type: "checkbox", id: `chk-${item.id}`, disabled: !editable(), onchange: (event) => checklistCall(`/checklist/${item.id}`, "PATCH", { done: event.target.checked }) });
      box.checked = item.done;
      return h("li", { class: `check-item${item.done ? " done" : ""}` },
        box,
        h("label", { for: `chk-${item.id}`, text: item.text }),
        editable() ? h("button", { type: "button", class: "delete-btn", title: "Remover item", "aria-label": `Remover ${item.text}`, text: "×", onclick: () => checklistCall(`/checklist/${item.id}`, "DELETE") }) : null);
    }));
  }

  function renderComments() {
    $("commentCount").textContent = data.comments.length ? `(${data.comments.length})` : "";
    const list = $("commentList");
    if (!data.comments.length) {
      list.replaceChildren(h("li", { class: "empty", text: "Nenhum comentário ainda." }));
      return;
    }
    const isOwner = data.role === "OWNER";
    list.replaceChildren(...data.comments.map((comment) => {
      const mine = comment.author && String(comment.author.id) === String(data.currentUserId);
      return h("li", { class: "comment" },
        h("span", { class: "avatar", text: initials(comment.author?.username) }),
        h("div", { class: "comment-body" },
          h("div", { class: "comment-meta" },
            h("strong", { text: comment.author ? `@${comment.author.username}` : "Usuário removido" }),
            h("small", { text: formatDateTime(comment.createdAt) }),
            mine || isOwner ? h("button", { type: "button", class: "delete-btn", title: "Excluir comentário", "aria-label": "Excluir comentário", text: "×", onclick: () => deleteComment(comment) }) : null),
          h("p", { text: comment.body })));
    }));
  }

  function renderActivity() {
    const list = $("activityList");
    if (!data.activity.length) {
      list.replaceChildren(h("li", { class: "activity-item muted", text: "Sem atividades." }));
      return;
    }
    list.replaceChildren(...data.activity.map((item) =>
      h("li", { class: "activity-item" },
        h("div", {},
          h("p", {}, h("strong", { text: item.username ? `@${item.username}` : "Alguém" }), ` ${item.message}`),
          h("small", { text: formatDateTime(item.createdAt) })))));
  }

  async function patch(fields) {
    try {
      await api(`/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(fields) });
      showToast("Alterações salvas.");
    } catch (error) {
      showToast(error.message);
    }
    await load(); // recarrega para refletir o estado real do servidor
  }

  async function checklistCall(path, method, body) {
    try {
      await api(path, { method, body: body ? JSON.stringify(body) : undefined });
    } catch (error) {
      showToast(error.message);
    }
    await load();
  }

  async function deleteComment(comment) {
    if (!confirm("Excluir este comentário?")) return;
    try {
      await api(`/comments/${comment.id}`, { method: "DELETE" });
    } catch (error) {
      showToast(error.message);
    }
    await load();
  }

  $("titleInput").addEventListener("change", () => {
    const title = $("titleInput").value.trim();
    if (!title) {
      showToast("O título não pode ficar vazio.");
      return load();
    }
    patch({ title });
  });
  $("descInput").addEventListener("change", () => patch({ description: $("descInput").value }));
  $("acceptInput").addEventListener("change", () => patch({ acceptanceCriteria: $("acceptInput").value }));
  $("dueInput").addEventListener("change", () => patch({ dueDate: $("dueInput").value || null }));
  $("pointsInput").addEventListener("change", () => patch({ storyPoints: $("pointsInput").value === "" ? null : Number($("pointsInput").value) }));
  $("columnSelect").addEventListener("change", () => patch({ columnId: $("columnSelect").value }));
  $("assigneeSelect").addEventListener("change", () => patch({ assigneeId: $("assigneeSelect").value || null }));
  $("prioritySelect").addEventListener("change", () => patch({ priority: $("prioritySelect").value }));
  $("sprintSelect").addEventListener("change", () => patch({ sprintId: $("sprintSelect").value || null }));

  $("checkForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = $("checkInput").value.trim();
    if (!text) return;
    $("checkInput").value = "";
    await checklistCall(`/tasks/${taskId}/checklist`, "POST", { text });
  });

  // Extra A: gera o checklist com IA (a chamada ao Gemini acontece no back-end).
  $("breakBtn").addEventListener("click", async () => {
    const button = $("breakBtn");
    const label = button.textContent;
    button.disabled = true;
    button.textContent = "Gerando...";
    try {
      const result = await api(`/ai/tasks/${taskId}/subtasks`, { method: "POST", body: "{}" });
      showToast(`${result.items.length} subtarefa(s) criada(s) pela IA.`);
    } catch (error) {
      showToast(error.message);
    }
    button.textContent = label;
    button.disabled = !editable();
    await load();
  });

  $("commentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = $("commentInput").value.trim();
    if (!body) return;
    try {
      await api(`/tasks/${taskId}/comments`, { method: "POST", body: JSON.stringify({ body }) });
      $("commentInput").value = "";
      showToast("Comentário salvo.");
    } catch (error) {
      showToast(error.message);
    }
    await load();
  });

  // Mantém a página em dia quando outra pessoa mexe na tarefa.
  window.addEventListener("focus", () => {
    if (data && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) load();
  });

  load();
})();
