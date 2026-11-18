(function () {
  const SIZES = {
    "32": { diameter: 32, cols: 5, rows: 7 },
    "44": { diameter: 44, cols: 4, rows: 5 },
    "58": { diameter: 58, cols: 3, rows: 4 }
  };

  const minScale = 1;
  const maxScale = 4;
  const sheet = document.getElementById("sheet");
  const sizeSelect = document.getElementById("size");
  const heading = document.querySelector(".toolbar h1");
  const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--inset")) || 2;
  const memory = {};
  let currentKey = null;
  let controllers = [];
  let adjustingCell = null;
  let drag = null;

  function sheetScale() {
    const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--scale"));
    return value > 0 ? value : 1;
  }

  function sizeFromHash() {
    const key = location.hash.replace("#", "");
    return SIZES[key] ? key : "32";
  }

  function slotsFor(key) {
    const spec = SIZES[key];
    const total = spec.cols * spec.rows;
    if (!memory[key]) {
      memory[key] = Array.from({ length: total }, function () {
        return { url: null, scale: minScale, x: 0, y: 0 };
      });
    }
    return memory[key];
  }

  function syncHash(key) {
    const next = key === "32" ? location.pathname + location.search : location.pathname + location.search + "#" + key;
    const current = location.pathname + location.search + location.hash;
    if (current !== next) history.replaceState(null, "", next);
  }

  function render(key) {
    if (!SIZES[key]) key = "32";
    if (adjustingCell) adjustingCell.stopAdjust();
    drag = null;
    currentKey = key;
    const spec = SIZES[key];
    const slots = slotsFor(key);
    const square = spec.diameter + inset * 2;
    const title = "Bottons " + spec.diameter + " mm";

    document.title = title + " — A4";
    if (heading) heading.textContent = title;
    sizeSelect.value = key;
    document.documentElement.style.setProperty("--diameter", spec.diameter + "mm");
    sheet.style.gridTemplateColumns = "repeat(" + spec.cols + ", " + square + "mm)";
    sheet.style.gridTemplateRows = "repeat(" + spec.rows + ", " + square + "mm)";
    sheet.replaceChildren();
    controllers = slots.map(function (state, index) {
      return createCell(state, index);
    });
    fit();
  }

  function createCell(state) {
    const cell = document.createElement("div");
    cell.className = "cell";

    const frame = document.createElement("div");
    frame.className = "frame";

    const img = document.createElement("img");
    img.alt = "";
    img.hidden = true;
    img.draggable = false;

    const circle = document.createElement("div");
    circle.className = "circle";

    const controls = document.createElement("div");
    controls.className = "controls";

    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "pick";
    pick.textContent = "Escolher imagem";

    const adjust = document.createElement("button");
    adjust.type = "button";
    adjust.className = "adjust";
    adjust.textContent = "Ajustar";
    adjust.hidden = true;
    adjust.title = "Arraste para mover e use a roda do mouse para ampliar";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "Remover";
    remove.hidden = true;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.tabIndex = -1;

    frame.appendChild(img);
    controls.append(pick, adjust, remove, input);
    cell.append(frame, circle, controls);
    sheet.appendChild(cell);

    const controller = {
      cell: cell,
      frame: frame,
      layout: layoutImage,
      stopAdjust: stopAdjust,
      isAdjusting: function () {
        return cell.classList.contains("is-adjusting");
      },
      clearImage: clearImage,
      zoomAt: zoomAt
    };
    cell.controller = controller;

    function layoutImage() {
      if (img.hidden || !img.naturalWidth) return;
      const frameW = frame.offsetWidth;
      const frameH = frame.offsetHeight;
      if (!frameW || !frameH) return;
      const cover = Math.max(frameW / img.naturalWidth, frameH / img.naturalHeight);
      const width = img.naturalWidth * cover * state.scale;
      const height = img.naturalHeight * cover * state.scale;
      const maxX = Math.max(0, (width - frameW) / 2);
      const maxY = Math.max(0, (height - frameH) / 2);
      state.x = Math.max(-maxX, Math.min(maxX, state.x));
      state.y = Math.max(-maxY, Math.min(maxY, state.y));
      img.style.width = width + "px";
      img.style.height = height + "px";
      img.style.left = (frameW - width) / 2 + state.x + "px";
      img.style.top = (frameH - height) / 2 + state.y + "px";
    }

    function showImage() {
      img.hidden = false;
      pick.textContent = "Trocar";
      adjust.hidden = false;
      remove.hidden = false;
      cell.classList.add("has-image");
      if (img.complete && img.naturalWidth) layoutImage();
    }

    function stopAdjust() {
      cell.classList.remove("is-adjusting");
      frame.classList.remove("is-dragging");
      adjust.textContent = "Ajustar";
      if (adjustingCell === controller) adjustingCell = null;
    }

    function startAdjust() {
      if (adjustingCell && adjustingCell !== controller) adjustingCell.stopAdjust();
      cell.classList.add("is-adjusting");
      adjust.textContent = "Concluir";
      adjustingCell = controller;
    }

    function clearImage() {
      stopAdjust();
      if (state.url) {
        URL.revokeObjectURL(state.url);
        state.url = null;
      }
      state.scale = minScale;
      state.x = 0;
      state.y = 0;
      img.removeAttribute("src");
      img.hidden = true;
      img.style.width = "";
      img.style.height = "";
      img.style.left = "";
      img.style.top = "";
      input.value = "";
      pick.textContent = "Escolher imagem";
      adjust.hidden = true;
      remove.hidden = true;
      cell.classList.remove("has-image");
    }

    function setImage(file) {
      stopAdjust();
      if (state.url) URL.revokeObjectURL(state.url);
      state.url = URL.createObjectURL(file);
      state.scale = minScale;
      state.x = 0;
      state.y = 0;
      img.src = state.url;
      showImage();
    }

    function zoomAt(event) {
      if (!controller.isAdjusting() || img.hidden || !img.naturalWidth) return;
      const frameW = frame.offsetWidth;
      const frameH = frame.offsetHeight;
      const rect = frame.getBoundingClientRect();
      const zoom = sheetScale();
      const pointX = (event.clientX - rect.left) / zoom - frameW / 2;
      const pointY = (event.clientY - rect.top) / zoom - frameH / 2;
      const localX = (pointX - state.x) / state.scale;
      const localY = (pointY - state.y) / state.scale;
      const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
      state.scale = Math.max(minScale, Math.min(maxScale, state.scale * factor));
      state.x = pointX - localX * state.scale;
      state.y = pointY - localY * state.scale;
      layoutImage();
    }

    img.addEventListener("load", layoutImage);

    pick.addEventListener("click", function (event) {
      event.stopPropagation();
      input.click();
    });

    adjust.addEventListener("click", function (event) {
      event.stopPropagation();
      if (controller.isAdjusting()) stopAdjust();
      else startAdjust();
    });

    frame.addEventListener("click", function () {
      if (controller.isAdjusting() || drag) return;
      input.click();
    });

    remove.addEventListener("click", function (event) {
      event.stopPropagation();
      clearImage();
    });

    input.addEventListener("change", function () {
      const file = input.files && input.files[0];
      if (file) setImage(file);
    });

    if (state.url) {
      img.src = state.url;
      showImage();
    }

    return controller;
  }

  sheet.addEventListener("pointerdown", function (event) {
    if (event.button !== 0) return;
    const frame = event.target.closest(".frame");
    if (!frame || !sheet.contains(frame)) return;
    const controller = frame.closest(".cell").controller;
    if (!controller || !controller.isAdjusting()) return;
    const slots = slotsFor(currentKey);
    const index = controllers.indexOf(controller);
    drag = {
      controller: controller,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: slots[index].x,
      originY: slots[index].y
    };
    controller.frame.classList.add("is-dragging");
    event.preventDefault();
  });

  window.addEventListener("pointermove", function (event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const index = controllers.indexOf(drag.controller);
    const state = slotsFor(currentKey)[index];
    const zoom = sheetScale();
    state.x = drag.originX + (event.clientX - drag.startX) / zoom;
    state.y = drag.originY + (event.clientY - drag.startY) / zoom;
    drag.controller.layout();
  });

  window.addEventListener("pointerup", function (event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.controller.frame.classList.remove("is-dragging");
    drag = null;
  });

  sheet.addEventListener("wheel", function (event) {
    const frame = event.target.closest(".frame");
    if (!frame || !sheet.contains(frame)) return;
    const controller = frame.closest(".cell").controller;
    if (!controller || !controller.isAdjusting()) return;
    event.preventDefault();
    controller.zoomAt(event);
  }, { passive: false });

  sizeSelect.addEventListener("change", function () {
    syncHash(sizeSelect.value);
    render(sizeSelect.value);
  });

  window.addEventListener("hashchange", function () {
    const key = sizeFromHash();
    if (key !== currentKey) render(key);
  });

  document.getElementById("print").addEventListener("click", function () {
    if (adjustingCell) adjustingCell.stopAdjust();
    window.print();
  });

  window.addEventListener("beforeprint", function () {
    document.documentElement.style.setProperty("--scale", "1");
    controllers.forEach(function (controller) {
      controller.layout();
    });
  });
  window.addEventListener("afterprint", fit);

  document.getElementById("clear").addEventListener("click", function () {
    controllers.forEach(function (controller) {
      controller.clearImage();
    });
  });

  function fit() {
    const toolbar = document.querySelector(".toolbar");
    const stage = document.querySelector(".stage");
    const toolbarHeight = toolbar ? toolbar.offsetHeight : 0;
    const stageStyle = stage ? getComputedStyle(stage) : null;
    const padX = stageStyle ? parseFloat(stageStyle.paddingLeft) + parseFloat(stageStyle.paddingRight) : 0;
    const padY = stageStyle ? parseFloat(stageStyle.paddingTop) + parseFloat(stageStyle.paddingBottom) : 0;
    const availW = document.documentElement.clientWidth - padX;
    const availH = window.innerHeight - toolbarHeight - padY;
    const viewScale = Math.min(1, availW / sheet.offsetWidth, availH / sheet.offsetHeight);
    document.documentElement.style.setProperty("--scale", String(viewScale > 0 ? viewScale : 1));
    controllers.forEach(function (controller) {
      controller.layout();
    });
  }

  window.addEventListener("resize", fit);
  render(sizeFromHash());
  syncHash(currentKey);
})();
